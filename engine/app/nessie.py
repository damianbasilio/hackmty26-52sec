"""Nessie client. The ONLY place in the repo allowed to talk to api.nessieisreal.com.

Nessie serves plain HTTP. iOS App Transport Security blocks that, so the mobile app
must never call it directly — it calls this engine, which is served over HTTPS.
"""

import httpx

from .config import get_settings


def _client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(
        base_url=s.nessie_base_url,
        params={"key": s.nessie_api_key},
        timeout=10.0,
    )


def get(path: str, **params) -> dict | list:
    with _client() as c:
        r = c.get(path, params=params)
        r.raise_for_status()
        return r.json()


def to_cents(nessie_amount: float) -> int:
    """Nessie returns amounts as floats in pesos. Convert once, here, and never float again."""
    return round(nessie_amount * 100)


def get_customers() -> list[dict]:
    return get("/customers")


def get_accounts_for_customer(customer_id: str) -> list[dict]:
    return get(f"/customers/{customer_id}/accounts")


def get_purchases(account_id: str) -> list[dict]:
    return get(f"/accounts/{account_id}/purchases")


def get_deposits(account_id: str) -> list[dict]:
    return get(f"/accounts/{account_id}/deposits")


def get_withdrawals(account_id: str) -> list[dict]:
    return get(f"/accounts/{account_id}/withdrawals")


def get_transfers(account_id: str) -> list[dict]:
    return get(f"/accounts/{account_id}/transfers")
