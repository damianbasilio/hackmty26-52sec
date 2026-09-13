"""Who is asking. The app sends its Supabase session as `Authorization: Bearer`.

Every route that touches a customer's data depends on current_customer, and
every route that takes an account_id depends on owned_account_id: an account
that isn't yours answers 404, same as one that doesn't exist.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from . import repository
from .config import get_settings


def current_customer(authorization: str | None = Header(default=None)) -> dict:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        user_id = repository.fetch_auth_user_id(token.strip())
        if user_id is None:
            raise HTTPException(status_code=401, detail="Tu sesión expiró. Vuelve a iniciar sesión.")
        customer = repository.fetch_customer_by_auth_user(user_id)
    elif get_settings().engine_require_auth:
        raise HTTPException(status_code=401, detail="Inicia sesión para usar tu cuenta.")
    else:
        # ponytail: single-tenant fallback for curl and local demos; ENGINE_REQUIRE_AUTH=true (default) shuts it.
        customer = repository.fetch_current_customer()
    if customer is None:
        raise HTTPException(status_code=404, detail="Tu usuario no está ligado a ningún cliente.")
    return customer


def owns(account_id: str | None, customer: dict) -> bool:
    account = repository.fetch_account(account_id) if account_id else None
    return account is not None and account["customer_id"] == customer["id"]


def owned_account_id(account_id: str, customer: dict = Depends(current_customer)) -> str:
    if not owns(account_id, customer):
        raise HTTPException(status_code=404, detail=f"No existe la cuenta {account_id}.")
    return account_id
