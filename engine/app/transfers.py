"""Real P2P transfers: Supabase is the record, Nessie is the bank.

A Nessie `transfer` has no payee — it is a one-sided entry — so a P2P transfer
is two Nessie writes: a withdrawal on the payer and, only when the payee is a
Nessie account we hold, a deposit on the payee. A payee at another bank gets
the withdrawal alone, and the receipt says which side was recorded.

Nessie has no idempotency keys and no DELETE. Every write carries
"REF:<transfer id>" in its description, so a retry finds its own earlier write
before making a new one instead of charging twice.

Nessie's balance field didn't move across 27 completed movements on the live
API, so it is read as the account's standing balance, not a running one:
available = that balance - outgoing pending/completed transfers + deposits
this engine recorded. A pending row holds its amount until it resolves.

The per-account lock serializes transfers inside one engine process. Running
more than one replica needs a database-side claim instead.
"""

from __future__ import annotations

import threading
import unicodedata
from collections import defaultdict
from datetime import datetime

import httpx
from pydantic import BaseModel, Field, StrictInt

from . import nessie, nessie_sync, repository
from .enrichment import format_mxn

TRANSFER_REF = nessie_sync.TRANSFER_REF
# Client-generated idempotency keys: transfers, splits and participants.
ID_PATTERN = r"^[A-Za-z0-9_-]{8,80}$"
# nessie_sync._map_account ids every synced account this way; anything else is fixture data
_NESSIE_ACCOUNT_ID_PREFIX = "acc_nessie_"


class TransferError(Exception):
    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class TransferNotFound(TransferError):
    status_code = 404


class TransferConflict(TransferError):
    status_code = 409


class TransferRejected(TransferError):
    status_code = 422


class NessieUnavailable(TransferError):
    status_code = 502


class TransferInFlight(TransferError):
    status_code = 503


class TransferRequest(BaseModel):
    # Client-generated idempotency key. When the app inserted the pending row
    # itself (db/README.md), this is that row's id.
    id: str = Field(pattern=ID_PATTERN)
    account_id: str
    payee_account_id: str | None = None
    payee_name: str = Field(min_length=1, max_length=80)
    payee_bank: str | None = Field(default=None, max_length=80)
    payee_last_four: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    amount_cents: StrictInt = Field(gt=0)
    concept: str = Field(default="", max_length=140)


_account_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _account_lock(account_id: str) -> threading.Lock:
    with _locks_guard:
        return _account_locks[account_id]


def transfer_ref(transfer_id: str) -> str:
    return f"{TRANSFER_REF}{transfer_id}"


def available_balance_cents(account_id: str, base_cents: int, exclude_transfer_id: str | None = None) -> int:
    return (
        base_cents
        - repository.sum_outgoing_transfer_holds_cents(account_id, exclude_transfer_id)
        + repository.sum_incoming_transfer_deposits_cents(account_id, TRANSFER_REF)
    )


def execute_transfer(req: TransferRequest, payer_customer_id: str, now: datetime) -> dict:
    payer = nessie_account(req.account_id, "origen")
    if payer["customer_id"] != payer_customer_id:
        raise TransferRejected("La cuenta de origen no pertenece a este cliente.")
    payee = nessie_account(req.payee_account_id, "destino") if req.payee_account_id else None
    if payee is not None and payee["id"] == payer["id"]:
        raise TransferRejected("La cuenta de origen y la de destino son la misma.")

    with _account_lock(payer["id"]):
        transfer = repository.fetch_transfer(req.id)
        if transfer is not None:
            _ensure_same_request(transfer, req)
        if transfer is None or transfer["status"] == "pending":
            transfer = _settle_payer_side(req, transfer, payer, now)
        if transfer["status"] == "completed" and payee is not None:
            _settle_payee_side(transfer, payer, payee, now)
        return receipt(transfer, payer, payee)


def nessie_account(account_id: str, role: str) -> dict:
    account = repository.fetch_account(account_id)
    if account is None:
        raise TransferNotFound(f"No existe la cuenta de {role} {account_id}.")
    if not account["id"].startswith(_NESSIE_ACCOUNT_ID_PREFIX) or not account.get("nessie_account_id"):
        raise TransferRejected(
            f"La cuenta de {role} es de datos de demostración: no está ligada a Nessie "
            "y no puede mover dinero real."
        )
    return account


def receipt(transfer: dict, payer: dict, payee: dict | None) -> dict:
    completed = transfer["status"] == "completed"
    if not completed:
        reason = transfer.get("failure_reason") or "la transferencia no se completó"
        payee_side = {"recorded": False, "transaction_id": None, "explanation": f"No se movió dinero: {reason}"}
    elif payee is None:
        bank = transfer.get("payee_bank") or "otro banco"
        payee_side = {
            "recorded": False,
            "transaction_id": None,
            "explanation": (
                f"{transfer['payee_name']} cobra en {bank}. Registramos el retiro en tu cuenta de "
                "Nessie; el depósito del otro lado lo aplica su banco y no pasa por nosotros."
            ),
        }
    else:
        deposit = repository.find_transaction_by_ref(payee["id"], transfer_ref(transfer["id"]))
        payee_side = {
            "recorded": deposit is not None,
            "transaction_id": deposit["id"] if deposit else None,
            "explanation": (
                f"Depositado en la cuenta ·· {payee['last_four']} en Nessie."
                if deposit
                else f"El retiro ya salió, pero el depósito en la cuenta ·· {payee['last_four']} "
                "no se confirmó. Reintenta con el mismo id para completarlo."
            ),
        }
    return {
        **transfer,
        "payer_side": {
            "recorded": completed,
            "nessie_withdrawal_id": transfer.get("nessie_transfer_id"),
            "transaction_id": transfer.get("transaction_id"),
        },
        "payee_side": payee_side,
        "available_balance_cents": available_balance_cents(payer["id"], payer["balance_cents"]),
    }


def _ensure_same_request(transfer: dict, req: TransferRequest) -> None:
    if (
        transfer["account_id"] != req.account_id
        or transfer["payee_account_id"] != req.payee_account_id
        or transfer["amount_cents"] != req.amount_cents
    ):
        raise TransferConflict(
            f"El id {req.id} ya se usó para otra transferencia con otra cuenta o monto. "
            "Genera un id nuevo para una transferencia nueva."
        )


def _settle_payer_side(req: TransferRequest, transfer: dict | None, payer: dict, now: datetime) -> dict:
    ref = transfer_ref(req.id)
    withdrawal = _find_by_ref(_nessie_read(lambda: nessie.get_withdrawals(payer["nessie_account_id"])), ref)

    if withdrawal is None:
        live = _nessie_read(lambda: nessie.get_account(payer["nessie_account_id"]))
        available = available_balance_cents(
            payer["id"], nessie.to_cents(live.get("balance") or 0), exclude_transfer_id=req.id
        )
        if req.amount_cents > available:
            reason = (
                f"Fondos insuficientes: tienes {format_mxn(available)} disponibles y la "
                f"transferencia es de {format_mxn(req.amount_cents)}."
            )
            if transfer is None:
                raise TransferRejected(reason)
            return repository.update_transfer(req.id, {"status": "failed", "failure_reason": reason})

        if transfer is None:
            transfer = _insert_pending(req, now)

        descriptor = _descriptor("SPEI ENVIADO", req.payee_name, ref)
        day = now.date().isoformat()
        try:
            created = nessie.create_withdrawal(
                payer["nessie_account_id"], nessie.from_cents(req.amount_cents), day, descriptor
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise _in_flight(req.id) from exc
            return repository.update_transfer(
                req.id,
                {
                    "status": "failed",
                    "failure_reason": f"Nessie rechazó el retiro (HTTP {exc.response.status_code}).",
                },
            )
        except httpx.TransportError as exc:
            raise _in_flight(req.id) from exc
        # Our own values are the fallback in case Nessie's echo omits a field.
        withdrawal = {
            "description": descriptor,
            "transaction_date": day,
            "status": "completed",
            "amount": nessie.from_cents(req.amount_cents),
            **created,
        }
    elif transfer is None:
        transfer = _insert_pending(req, now)

    ledger_row = nessie_sync.map_withdrawal(payer["id"], withdrawal)
    repository.upsert_raw_transactions([ledger_row])
    nessie_sync.enrich_account_transactions(payer["id"])
    return repository.update_transfer(
        req.id,
        {
            "status": "completed",
            "nessie_transfer_id": withdrawal["_id"],
            "transaction_id": ledger_row["id"],
            "failure_reason": None,
            "completed_at": _z(now),
        },
    )


def _settle_payee_side(transfer: dict, payer: dict, payee: dict, now: datetime) -> None:
    ref = transfer_ref(transfer["id"])
    if repository.find_transaction_by_ref(payee["id"], ref) is not None:
        return
    amount_cents = transfer["amount_cents"]
    try:
        deposit = _find_by_ref(nessie.get_deposits(payee["nessie_account_id"]), ref)
        if deposit is None:
            customer = repository.fetch_customer(payer["customer_id"]) or {}
            payer_name = f"{customer.get('first_name', '')} {customer.get('last_name', '')}"
            descriptor = _descriptor("SPEI RECIBIDO", payer_name, ref)
            day = now.date().isoformat()
            created = nessie.create_deposit(
                payee["nessie_account_id"], nessie.from_cents(amount_cents), day, descriptor
            )
            deposit = {
                "description": descriptor,
                "transaction_date": day,
                "status": "completed",
                "amount": nessie.from_cents(amount_cents),
                **created,
            }
    except httpx.HTTPError:
        # The money already left the payer. The receipt reports this side as
        # unconfirmed and a retry with the same id reconciles it by REF.
        return
    repository.upsert_raw_transactions([nessie_sync.map_deposit(payee["id"], deposit)])
    nessie_sync.enrich_account_transactions(payee["id"])


def _insert_pending(req: TransferRequest, now: datetime) -> dict:
    row = {
        "id": req.id,
        "account_id": req.account_id,
        "payee_account_id": req.payee_account_id,
        "payee_name": req.payee_name,
        "payee_bank": req.payee_bank,
        "payee_last_four": req.payee_last_four,
        "amount_cents": req.amount_cents,
        "concept": req.concept,
        "status": "pending",
        "created_at": _z(now),
    }
    try:
        return repository.insert_transfer(row)
    except repository.DuplicateRow:
        # the app inserted the same id between our read and this write
        existing = repository.fetch_transfer(req.id)
        _ensure_same_request(existing, req)
        return existing


def _nessie_read(read):
    try:
        return read()
    except httpx.HTTPError as exc:
        raise NessieUnavailable(f"Nessie no respondió ({exc.__class__.__name__}); no se movió dinero.") from exc


def _in_flight(transfer_id: str) -> TransferInFlight:
    return TransferInFlight(
        f"Nessie no confirmó el retiro de la transferencia {transfer_id} y no sabemos si se aplicó. "
        "Reintenta con el mismo id: la conciliamos sin cobrar dos veces."
    )


def _find_by_ref(rows: list[dict], ref: str) -> dict | None:
    return next((row for row in rows if (row.get("description") or "").endswith(ref)), None)


def _descriptor(prefix: str, name: str, ref: str) -> str:
    # ASCII only: a non-ASCII name is how customer 870d2c18 ended up corrupted in Nessie
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return f"{prefix} {' '.join(ascii_name.split())}{ref}"


def _z(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
