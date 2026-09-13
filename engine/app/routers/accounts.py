import secrets
import unicodedata

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import nessie, nessie_sync, repository, transfers
from ..config import get_settings

router = APIRouter(tags=["accounts"])

# nessie_sync._map_customer ids a synced customer this way. The fixture customer
# also carries a placeholder nessie_customer_id, so that column alone can't tell.
_NESSIE_CUSTOMER_ID_PREFIX = "cus_nessie_"


class AccountCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)


@router.get("/accounts")
def list_accounts() -> list[dict]:
    """Response shape: Account[] in /contracts/types.ts.

    balance_cents on a Nessie account is what's available after transfers:
    Nessie's own balance doesn't move when money leaves (see transfers.py).
    """
    customer = repository.fetch_current_customer()
    if customer is None:
        return []
    return [
        {**account, "balance_cents": transfers.available_balance_cents(account["id"], account["balance_cents"])}
        if account["id"].startswith("acc_nessie_")
        else account
        for account in repository.fetch_accounts(customer["id"])
    ]


@router.post("/accounts", status_code=201)
def create_savings_account(req: AccountCreate) -> dict:
    """Opens one more savings account, starting at zero. Response shape: Account.

    A customer synced from Nessie gets the account opened in Nessie too, so
    transfers into it are real. Fixture and signup customers aren't in Nessie:
    their account lives only in Supabase, same as the checking they already have.
    """
    customer = repository.fetch_current_customer()
    if customer is None:
        raise HTTPException(status_code=404, detail="No hay cliente sembrado todavía")

    nickname = " ".join(req.nickname.split())
    if not nickname:
        raise HTTPException(status_code=422, detail="Ponle un nombre a tu cuenta de ahorro.")
    if any(a["nickname"].casefold() == nickname.casefold() for a in repository.fetch_accounts(customer["id"])):
        raise HTTPException(status_code=409, detail="Ya tienes una cuenta con ese nombre.")

    if customer["id"].startswith(_NESSIE_CUSTOMER_ID_PREFIX) and customer.get("nessie_customer_id"):
        if not get_settings().nessie_api_key:
            raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
        try:
            created = nessie.create_account(customer["nessie_customer_id"], "Savings", _ascii(nickname), 0)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Nessie no pudo abrir la cuenta. Inténtalo de nuevo.") from exc
        # Nessie gets the ASCII name; the app keeps the one the user typed.
        row = {**nessie_sync.map_account(customer["id"], created), "type": "savings", "nickname": nickname}
    else:
        row = {
            "id": f"acc_savings_{secrets.token_hex(12)}",
            "customer_id": customer["id"],
            "nickname": nickname,
            "type": "savings",
            "last_four": f"{secrets.randbelow(10000):04d}",
            "balance_cents": 0,
        }
    return repository.insert_account(row)


def _ascii(text: str) -> str:
    # a non-ASCII name is how customer 870d2c18 ended up corrupted in Nessie
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
