import threading
import unicodedata
from collections import defaultdict

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import clabe, nessie, nessie_sync, repository, transfers
from ..auth import current_customer
from ..config import get_settings

router = APIRouter(tags=["accounts"])

_NESSIE_ACCOUNT_ID_PREFIX = "acc_nessie_"
# Nessie requires an address to open a customer; the app never asks for one.
_DEFAULT_ADDRESS = {
    "street_number": "1",
    "street_name": "Av Constitucion",
    "city": "Monterrey",
    "state": "NL",
    "zip": "64000",
}

# ponytail: in-process locks, same ceiling as transfers.py: one engine replica.
_customer_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


class AccountCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)


@router.get("/accounts")
def list_accounts(customer: dict = Depends(current_customer)) -> list[dict]:
    """Response shape: Account[] in /contracts/types.ts.

    The first call for a customer with no Nessie account opens one: Nessie is the
    bank, so an account that isn't there can't send or receive money.
    balance_cents on a Nessie account is what's available after transfers:
    Nessie's own balance doesn't move when money leaves (see transfers.py).
    """
    return [
        {**account, "balance_cents": transfers.available_balance_cents(account["id"], account["balance_cents"])}
        if _is_nessie(account)
        else account
        for account in ensure_bank_accounts(customer)
    ]


@router.post("/accounts", status_code=201)
def create_savings_account(req: AccountCreate, customer: dict = Depends(current_customer)) -> dict:
    """Opens one more savings account in Nessie, starting at zero. Response shape: Account."""
    nickname = " ".join(req.nickname.split())
    if not nickname:
        raise HTTPException(status_code=422, detail="Ponle un nombre a tu cuenta de ahorro.")
    accounts = ensure_bank_accounts(customer)
    if any(a["nickname"].casefold() == nickname.casefold() for a in accounts):
        raise HTTPException(status_code=409, detail="Ya tienes una cuenta con ese nombre.")

    nessie_customer_id = (repository.fetch_customer(customer["id"]) or customer)["nessie_customer_id"]
    created = _nessie_write(lambda: nessie.create_account(nessie_customer_id, "Savings", _ascii(nickname), 0))
    # Nessie gets the ASCII name; the app keeps the one the user typed.
    return repository.insert_account(
        {**nessie_sync.map_account(customer["id"], created), "type": "savings", "nickname": nickname}
    )


def ensure_bank_accounts(customer: dict) -> list[dict]:
    with _customer_lock(customer["id"]):
        accounts = repository.fetch_accounts(customer["id"])
        if not any(_is_nessie(a) for a in accounts):
            _open_checking_in_nessie(customer, accounts)
            accounts = repository.fetch_accounts(customer["id"])
        return [_with_clabe(a) for a in accounts]


def _open_checking_in_nessie(customer: dict, local_accounts: list[dict]) -> None:
    nessie_customer_id = _nessie_customer_id(customer)
    created = _nessie_write(lambda: nessie.create_account(nessie_customer_id, "Checking", "Cuenta de cheques", 0))
    repository.upsert_accounts([{**nessie_sync.map_account(customer["id"], created), "nickname": "Cuenta de cheques"}])
    # The empty placeholder the signup trigger used to open would sit next to
    # the real account forever, with no CLABE and no way to move money.
    for account in local_accounts:
        if not repository.account_has_activity(account["id"]):
            repository.delete_account(account["id"])


def _nessie_customer_id(customer: dict) -> str:
    existing = customer.get("nessie_customer_id")
    if existing:
        try:
            nessie.get_customer(existing)
            return existing
        except httpx.HTTPStatusError as exc:
            # the fixture customer carries a made-up id Nessie never issued
            if exc.response.status_code not in (400, 404):
                raise HTTPException(status_code=502, detail="El banco no respondió. Inténtalo de nuevo.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="El banco no respondió. Inténtalo de nuevo.") from exc
    created = _nessie_write(
        lambda: nessie.create_customer(
            _ascii(customer.get("first_name") or "") or "Cliente",
            _ascii(customer.get("last_name") or "") or "52Pay",
            _DEFAULT_ADDRESS,
        )
    )
    # Saved before the account is opened, so a crash in between doesn't create a second Nessie customer.
    repository.update_customer(customer["id"], {"nessie_customer_id": created["_id"]})
    return created["_id"]


def _with_clabe(account: dict) -> dict:
    """Accounts synced before the clabe column existed get theirs on first read."""
    if account.get("clabe") or not _is_nessie(account):
        return account
    try:
        value = clabe.from_account_number(nessie.get_account(account["nessie_account_id"]).get("account_number"))
    except httpx.HTTPError:
        return account
    return repository.update_account(account["id"], {"clabe": value}) if value else account


def _nessie_write(write):
    if not get_settings().nessie_api_key:
        raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
    try:
        return write()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="El banco no pudo abrir la cuenta. Inténtalo de nuevo.") from exc


def _is_nessie(account: dict) -> bool:
    return account["id"].startswith(_NESSIE_ACCOUNT_ID_PREFIX) and bool(account.get("nessie_account_id"))


def _customer_lock(customer_id: str) -> threading.Lock:
    with _locks_guard:
        return _customer_locks[customer_id]


def _ascii(text: str) -> str:
    # a non-ASCII name is how customer 870d2c18 ended up corrupted in Nessie
    return " ".join(unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().split())
