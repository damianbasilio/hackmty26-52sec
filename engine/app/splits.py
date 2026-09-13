"""Bill splitting on top of real transfers.

The tables are lane A's (db/schema.sql). join_split() and rebalance_split() in
SQL resolve the caller through auth.uid(), which is null under the service
role, so the engine does both itself with the same rule: even shares, leftover
cents one at a time to whoever joined first. sum(share_cents) == total_cents.

The creator already paid the bill, so their row is born paid. Everybody else
pays their share with a transfer into the split's account; once every row is
paid the split is settled. Shares freeze at the first payment: nobody can join
after that, or someone who already paid would owe a different amount.
"""

from __future__ import annotations

import secrets
import threading
from collections import defaultdict
from datetime import datetime, timedelta

from pydantic import BaseModel, Field, StrictInt

from . import repository, transfers
from .models import parse_iso
from .transfers import ID_PATTERN, TransferError, TransferRequest

CODE_TTL = timedelta(minutes=15)
_CODE_ATTEMPTS = 10


class SplitError(TransferError):
    pass


class SplitNotFound(SplitError):
    status_code = 404


class SplitConflict(SplitError):
    status_code = 409


class SplitCodeExpired(SplitError):
    status_code = 410


class SplitRejected(SplitError):
    status_code = 422


class SplitCreate(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    # Where the shares land: the creator's own Nessie account.
    account_id: str
    title: str = Field(default="", max_length=80)
    total_cents: StrictInt = Field(gt=0)
    creator_name: str | None = Field(default=None, min_length=1, max_length=80)


class SplitJoin(BaseModel):
    code: str = Field(pattern=r"^[0-9]{4}$")
    participant_id: str = Field(pattern=ID_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    # null for a guest who banks elsewhere
    customer_id: str | None = None


class SplitPayment(BaseModel):
    transfer_id: str = Field(pattern=ID_PATTERN)
    account_id: str


_split_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _split_lock(split_id: str) -> threading.Lock:
    with _locks_guard:
        return _split_locks[split_id]


def new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def shares_for(total_cents: int, count: int) -> list[int]:
    base, remainder = divmod(total_cents, count)
    return [base + (1 if index < remainder else 0) for index in range(count)]


def split_view(split: dict, participants: list[dict], now: datetime) -> dict:
    ordered = sorted(participants, key=_join_order)
    paid_cents = sum(p["share_cents"] for p in ordered if p["paid_at"])
    return {
        **split,
        "participants": ordered,
        "paid_cents": paid_cents,
        "outstanding_cents": split["total_cents"] - paid_cents,
        "code_active": split["status"] == "open" and parse_iso(split["code_expires_at"]) > now,
    }


def create_split(req: SplitCreate, customer: dict, now: datetime) -> dict:
    account = transfers.nessie_account(req.account_id, "cobro")
    if account["customer_id"] != customer["id"]:
        raise SplitRejected("La cuenta de cobro no pertenece a este cliente.")

    with _split_lock(req.id):
        split = repository.fetch_split(req.id) or _insert_split(req, customer, now)
        if split["account_id"] != req.account_id or split["total_cents"] != req.total_cents:
            raise SplitConflict(
                f"El id {req.id} ya se usó para otra división con otra cuenta o total. "
                "Genera un id nuevo para una división nueva."
            )
        participants = repository.fetch_split_participants(req.id)
        if not any(p["is_creator"] for p in participants):
            # a retry after a crash between the two inserts lands here too
            creator = repository.insert_split_participant(
                {
                    "id": f"spp_{req.id}_creator",
                    "split_request_id": req.id,
                    "customer_id": customer["id"],
                    "display_name": req.creator_name or customer.get("first_name") or "Tú",
                    "share_cents": req.total_cents,
                    "is_creator": True,
                    "paid_at": _z(now),
                    "joined_at": _z(now),
                }
            )
            participants = _rebalance(split, participants + [creator])
        return split_view(split, participants, now)


def join_split(req: SplitJoin, now: datetime) -> dict:
    split = repository.fetch_open_split_by_code(req.code)
    if split is None:
        raise SplitNotFound(f"El código {req.code} no corresponde a ninguna división abierta.")
    if req.customer_id is not None and req.customer_id == split["created_by"]:
        raise SplitRejected("Quien creó la división ya está en ella.")

    with _split_lock(split["id"]):
        participants = repository.fetch_split_participants(split["id"])
        mine = next(
            (
                p
                for p in participants
                if p["id"] == req.participant_id
                or (req.customer_id is not None and p["customer_id"] == req.customer_id)
            ),
            None,
        )
        if mine is None:
            if repository.fetch_split_participant(req.participant_id) is not None:
                raise SplitConflict(f"El participant_id {req.participant_id} ya es de otra división.")
            if parse_iso(split["code_expires_at"]) <= now:
                raise SplitCodeExpired(
                    f"El código {req.code} expiró. Pide uno nuevo a quien creó la división."
                )
            if any(p["paid_at"] and not p["is_creator"] for p in participants):
                raise SplitConflict("Alguien ya pagó su parte; el reparto ya no puede cambiar.")
            if req.customer_id is not None and repository.fetch_customer(req.customer_id) is None:
                raise SplitNotFound(f"No existe el cliente {req.customer_id}.")
            try:
                mine = repository.insert_split_participant(
                    {
                        "id": req.participant_id,
                        "split_request_id": split["id"],
                        "customer_id": req.customer_id,
                        "display_name": req.display_name,
                        "share_cents": 0,
                        "is_creator": False,
                        "joined_at": _z(now),
                    }
                )
            except repository.DuplicateRow as exc:
                raise SplitConflict("Ese participante ya se unió a la división.") from exc
            participants = _rebalance(split, participants + [mine])
            mine = next(p for p in participants if p["id"] == req.participant_id)
        return {"participant": mine, "split": split_view(split, participants, now)}


def pay_share(split_id: str, participant_id: str, req: SplitPayment, caller: dict, now: datetime) -> dict:
    with _split_lock(split_id):
        split = repository.fetch_split(split_id)
        if split is None:
            raise SplitNotFound(f"No existe la división {split_id}.")
        participants = repository.fetch_split_participants(split_id)
        participant = next((p for p in participants if p["id"] == participant_id), None)
        if participant is None:
            raise SplitNotFound(f"{participant_id} no participa en la división {split_id}.")
        if participant["is_creator"]:
            raise SplitRejected("Quien creó la división ya pagó la cuenta completa.")
        if participant["paid_at"] and participant["transfer_id"] != req.transfer_id:
            raise SplitConflict(f"{participant['display_name']} ya pagó su parte con otra transferencia.")
        if split["status"] != "open" and not participant["paid_at"]:
            raise SplitRejected(f"La división está {split['status']} y ya no recibe pagos.")

        payer = transfers.nessie_account(req.account_id, "origen")
        if payer["customer_id"] != caller["id"]:
            raise SplitRejected("La cuenta de origen no es tuya.")
        if participant["customer_id"] and payer["customer_id"] != participant["customer_id"]:
            raise SplitRejected("La cuenta de origen no es de este participante.")
        receiver = transfers.nessie_account(split["account_id"], "cobro")
        creator = next((p for p in participants if p["is_creator"]), None)
        title = split["title"] or "gasto compartido"

        receipt = transfers.execute_transfer(
            TransferRequest(
                id=req.transfer_id,
                account_id=payer["id"],
                payee_account_id=receiver["id"],
                payee_name=creator["display_name"] if creator else "Quien creó la división",
                payee_last_four=receiver["last_four"],
                amount_cents=participant["share_cents"],
                concept=f"División: {title}"[:140],
            ),
            payer["customer_id"],
            now,
        )

        if receipt["status"] == "completed" and not participant["paid_at"]:
            participant = repository.update_split_participant(
                participant_id, {"paid_at": _z(now), "transfer_id": req.transfer_id}
            )
            participants = [participant if p["id"] == participant_id else p for p in participants]
            if all(p["paid_at"] for p in participants):
                split = repository.update_split(split_id, {"status": "settled", "settled_at": _z(now)})
        return {"transfer": receipt, "split": split_view(split, participants, now)}


def _insert_split(req: SplitCreate, customer: dict, now: datetime) -> dict:
    for _ in range(_CODE_ATTEMPTS):
        try:
            return repository.insert_split(
                {
                    "id": req.id,
                    "account_id": req.account_id,
                    "created_by": customer["id"],
                    "title": req.title,
                    "total_cents": req.total_cents,
                    "code": new_code(),
                    "code_expires_at": _z(now + CODE_TTL),
                    "status": "open",
                    "created_at": _z(now),
                }
            )
        except repository.DuplicateRow:
            existing = repository.fetch_split(req.id)
            if existing is not None:
                return existing
            # another open split holds this code: roll again
    raise SplitConflict("No pudimos generar un código libre; intenta de nuevo.")


def _rebalance(split: dict, participants: list[dict]) -> list[dict]:
    ordered = sorted(participants, key=_join_order)
    result = []
    for participant, share in zip(ordered, shares_for(split["total_cents"], len(ordered))):
        if participant["share_cents"] != share:
            participant = repository.update_split_participant(participant["id"], {"share_cents": share})
        result.append(participant)
    return result


def _join_order(participant: dict) -> tuple:
    # Parsed, not compared as text: rows we wrote say "Z", rows Postgres returns say "+00:00".
    return (parse_iso(participant["joined_at"]), participant["id"])


def _z(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
