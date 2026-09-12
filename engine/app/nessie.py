"""Nessie client. The ONLY place in the repo allowed to talk to api.nessieisreal.com.

Nessie serves plain HTTP. iOS App Transport Security blocks that, so the mobile app
must never call it directly — it calls this engine, which is served over HTTPS.

Field shapes below are verified against the live API (2026-09-12), not just the
public docs — a few things the docs don't mention: POST responses wrap the row in
`objectCreated`; TransferCreate takes no payer_id/payee_id and its GET rows key
off `id` instead of `_id` like every other resource; account_number is always
server-generated, ignoring whatever you send.
"""

import httpx

from .config import get_settings


def _client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(
        base_url=s.nessie_base_url,
        params={"key": s.nessie_api_key},
        # Nessie's gateway is noticeably slow on some requests (cold starts);
        # 10s wasn't enough headroom during live testing against the real API.
        timeout=30.0,
    )


def get(path: str, **params) -> dict | list:
    with _client() as c:
        r = c.get(path, params=params)
        r.raise_for_status()
        return r.json()


def post(path: str, body: dict) -> dict:
    with _client() as c:
        r = c.post(path, json=body)
        r.raise_for_status()
        return r.json()["objectCreated"]


def to_cents(nessie_amount: float) -> int:
    """Nessie returns amounts as floats in pesos. Convert once, here, and never float again."""
    return round(nessie_amount * 100)


def from_cents(cents: int) -> float:
    """The inverse, for the one place we write TO Nessie: seeding demo data."""
    return cents / 100


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


def create_customer(first_name: str, last_name: str, address: dict) -> dict:
    return post("/customers", {"first_name": first_name, "last_name": last_name, "address": address})


def create_account(customer_id: str, account_type: str, nickname: str, balance: float) -> dict:
    return post(
        f"/customers/{customer_id}/accounts",
        {"type": account_type, "nickname": nickname, "rewards": 0, "balance": balance},
    )


def create_merchant(name: str) -> dict:
    return post("/merchants", {"name": name})


def create_deposit(account_id: str, amount: float, transaction_date: str, description: str) -> dict:
    return post(
        f"/accounts/{account_id}/deposits",
        {
            "medium": "balance",
            "amount": amount,
            "transaction_date": transaction_date,
            "status": "completed",
            "description": description,
        },
    )


def create_purchase(
    account_id: str, merchant_id: str, amount: float, purchase_date: str, description: str
) -> dict:
    return post(
        f"/accounts/{account_id}/purchases",
        {
            "merchant_id": merchant_id,
            "medium": "balance",
            "amount": amount,
            "purchase_date": purchase_date,
            "status": "completed",
            "description": description,
        },
    )


def create_transfer(account_id: str, amount: float, transaction_date: str, description: str) -> dict:
    # No payee — TransferCreate rejects payer_id/payee_id/medium as extra fields.
    return post(
        f"/accounts/{account_id}/transfers",
        {
            "amount": amount,
            "transaction_date": transaction_date,
            "status": "completed",
            "description": description,
        },
    )
