"""Nessie -> Postgres ingestion.

The float-to-cents conversion happens exactly once, in nessie.to_cents(), right
where each Nessie row is mapped to our schema. Every rebuild afterwards
(enrichment, subscriptions, anomalies, score) reads integers from Postgres and
never touches Nessie or a float again.

Idempotent: every upsert keys off the nessie_*_id unique columns, so running
this twice updates the same rows instead of duplicating them.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import nessie, repository
from .enrichment import local_day_of_week, local_hour_of_day, normalize_merchant, population_zscores
from .models import Transaction

_ACCOUNT_TYPE_MAP = {
    "checking": "checking",
    "savings": "savings",
    "credit card": "credit_card",
}

# transfers.py tags every Nessie write with this plus the transfer id, so a
# synced row and the one the transfer wrote live are the same row.
TRANSFER_REF = " REF:"

# Descriptors match enrichment.py's rules exactly, so the seeded data is
# recognizable by every engine the same way the fixtures are.
_SEED_RECURRING_PURCHASES = [
    ("NETFLIX.COM MX", [(70, 199), (40, 199), (10, 239)]),
    ("SPOTIFY MX P1A2B3", [(70, 119), (40, 119), (10, 119)]),
    ("TELMEX PAGO FIJO 81XXXX", [(70, 639), (40, 639), (10, 639)]),
    ("SMART FIT MEXICO SA", [(70, 449), (40, 449), (10, 449)]),
]
_SEED_VARIABLE_PURCHASES = [
    ("OXXO TEC 4412 MTY", [(65, 87), (50, 62), (35, 94), (20, 73)]),
    ("RAPPI MX CDMX", [(55, 315), (25, 249), (5, 334)]),
    ("SORIANA HIPER CUMBRES", [(48, 1284), (18, 1152)]),
]
_SEED_DEPOSITS = [(75, 14250), (45, 14250), (15, 14250)]
_SEED_TRANSFERS = [(75, 9500), (45, 9500), (15, 9500)]


def sync_all() -> dict[str, int]:
    """Pulls every customer, account and transaction this API key can see."""
    synced = {"customers": 0, "accounts": 0, "transactions": 0}

    for nessie_customer in nessie.get_customers():
        customer = repository.upsert_customer(_map_customer(nessie_customer))
        synced["customers"] += 1

        for nessie_account in nessie.get_accounts_for_customer(nessie_customer["_id"]):
            account = repository.upsert_accounts([_map_account(customer["id"], nessie_account)])[0]
            synced["accounts"] += 1
            synced["transactions"] += _sync_transactions(account["id"], nessie_account["_id"])

    return synced


def seed_demo_data(now: datetime) -> dict:
    """Creates one realistic demo customer + account + history directly in Nessie.

    Nessie ships with none of our own key's customers — unlike Supabase, which
    starts from /contracts/fixtures. Call this once before sync_all() has
    anything to pull. Safe to call more than once, but each call adds a new
    customer rather than topping up an existing one — Nessie has no
    upsert-by-name, so re-running duplicates the demo data.
    """
    customer = nessie.create_customer(
        "Ana Sofía",
        "Treviño Garza",
        {
            "street_number": "100",
            "street_name": "Av. Constitución",
            "city": "Monterrey",
            "state": "NL",
            "zip": "64000",
        },
    )
    account = nessie.create_account(customer["_id"], "Checking", "Cuenta de cheques", 23136)

    def day(days_ago: int) -> str:
        return (now - timedelta(days=days_ago)).date().isoformat()

    for days_ago, amount in _SEED_DEPOSITS:
        nessie.create_deposit(account["_id"], amount, day(days_ago), "DEPOSITO NOMINA TEC DEL NORTE")
    for days_ago, amount in _SEED_TRANSFERS:
        nessie.create_transfer(account["_id"], amount, day(days_ago), "SPEI ENVIADO RENTA DEPTO")

    for description, occurrences in _SEED_RECURRING_PURCHASES + _SEED_VARIABLE_PURCHASES:
        merchant = nessie.create_merchant(description.split(" ")[0].title())
        for days_ago, amount in occurrences:
            nessie.create_purchase(account["_id"], merchant["_id"], amount, day(days_ago), description)

    return {"customer_id": customer["_id"], "account_id": account["_id"]}


def _map_customer(c: dict) -> dict:
    nessie_id = c["_id"]
    first_name = c.get("first_name") or ""
    last_name = c.get("last_name") or ""
    return {
        "id": f"cus_nessie_{nessie_id}",
        "first_name": first_name,
        "last_name": last_name,
        "email": c.get("email") or f"{first_name}.{last_name}@nessie.local".lower(),
        "phone": c.get("phone_number"),
        "nessie_customer_id": nessie_id,
    }


def _map_account(customer_id: str, a: dict) -> dict:
    nessie_id = a["_id"]
    digits = "".join(ch for ch in str(a.get("account_number") or "") if ch.isdigit())
    last_four = (digits[-4:] or "0000").rjust(4, "0")
    return {
        "id": f"acc_nessie_{nessie_id}",
        "customer_id": customer_id,
        "nickname": a.get("nickname") or "Cuenta Nessie",
        "type": _ACCOUNT_TYPE_MAP.get((a.get("type") or "").lower(), "checking"),
        "last_four": last_four,
        "balance_cents": nessie.to_cents(a.get("balance") or 0),
        "nessie_account_id": nessie_id,
    }


def _sync_transactions(account_id: str, nessie_account_id: str) -> int:
    rows = (
        [_map_purchase(account_id, p) for p in nessie.get_purchases(nessie_account_id)]
        + [map_deposit(account_id, d) for d in nessie.get_deposits(nessie_account_id)]
        + [map_withdrawal(account_id, w) for w in nessie.get_withdrawals(nessie_account_id)]
        + [_map_transfer(account_id, t) for t in nessie.get_transfers(nessie_account_id)]
    )
    repository.upsert_raw_transactions(rows)
    enrich_account_transactions(account_id)
    return len(rows)


def _occurred_at(date_str: str | None) -> str:
    # Nessie only gives a calendar day; midnight UTC is the closest honest timestamp.
    day = date_str or datetime.now(timezone.utc).date().isoformat()
    return f"{day}T00:00:00Z"


def _map_purchase(account_id: str, p: dict) -> dict:
    return {
        "id": f"txn_nessie_{p['_id']}",
        "account_id": account_id,
        "amount_cents": -nessie.to_cents(p.get("amount") or 0),
        "type": "purchase",
        "status": (p.get("status") or "completed").lower(),
        "raw_description": p.get("description") or "COMPRA NESSIE",
        "occurred_at": _occurred_at(p.get("purchase_date")),
        "nessie_transaction_id": p["_id"],
    }


def map_deposit(account_id: str, d: dict) -> dict:
    description = d.get("description") or "DEPOSITO NESSIE"
    return {
        "id": f"txn_nessie_{d['_id']}",
        "account_id": account_id,
        "amount_cents": nessie.to_cents(d.get("amount") or 0),
        "type": "transfer" if TRANSFER_REF in description else "deposit",
        "status": (d.get("status") or "completed").lower(),
        "raw_description": description,
        "occurred_at": _occurred_at(d.get("transaction_date")),
        "nessie_transaction_id": d["_id"],
    }


def map_withdrawal(account_id: str, w: dict) -> dict:
    description = w.get("description") or "RETIRO NESSIE"
    return {
        "id": f"txn_nessie_{w['_id']}",
        "account_id": account_id,
        "amount_cents": -nessie.to_cents(w.get("amount") or 0),
        "type": "transfer" if TRANSFER_REF in description else "withdrawal",
        "status": (w.get("status") or "completed").lower(),
        "raw_description": description,
        "occurred_at": _occurred_at(w.get("transaction_date")),
        "nessie_transaction_id": w["_id"],
    }


def _map_transfer(account_id: str, t: dict) -> dict:
    # Nessie's TransferCreate has no payer_id/payee_id and its GET rows key
    # off "id", not "_id" like every other resource — verified against the
    # live API. A transfer only ever posts to the account it was fetched
    # from, so it is always money leaving this account.
    nessie_id = t.get("id") or t["_id"]
    return {
        "id": f"txn_nessie_{nessie_id}",
        "account_id": account_id,
        "amount_cents": -nessie.to_cents(t.get("amount") or 0),
        "type": "transfer",
        "status": (t.get("status") or "completed").lower(),
        "raw_description": t.get("description") or "TRANSFERENCIA NESSIE",
        "occurred_at": _occurred_at(t.get("transaction_date")),
        "nessie_transaction_id": nessie_id,
    }


def enrich_account_transactions(account_id: str) -> None:
    """Mirrors what the seeder writes for fixtures: merchant, category, hour/day, z-score.

    Recomputed over the account's full history each time so a merchant's
    z-scores stay correct as more of its charges arrive.
    """
    transactions = repository.fetch_transactions(account_id)
    merchants = repository.fetch_merchants()

    by_merchant: dict[str, list[Transaction]] = {}
    for txn in transactions:
        guess = normalize_merchant(txn.raw_description)
        by_merchant.setdefault(guess.normalized_name, []).append(txn)

    rows = []
    for normalized_name, txns in by_merchant.items():
        merchant = merchants.get(normalized_name) or repository.get_or_create_merchant(
            txns[0].raw_description
        )
        magnitudes = [-t.amount_cents for t in txns]
        for txn, zscore in zip(txns, population_zscores(magnitudes)):
            rows.append(
                {
                    "transaction_id": txn.id,
                    "account_id": account_id,
                    "merchant_id": merchant.id,
                    "category": merchant.category,
                    "category_confidence": 0.99 if merchant.is_recurring_biller else 0.92,
                    "is_recurring": merchant.is_recurring_biller,
                    "amount_zscore": zscore,
                    "hour_of_day": local_hour_of_day(txn.occurred_at),
                    "day_of_week": local_day_of_week(txn.occurred_at),
                    "occurred_at": txn.occurred_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
            )
    repository.upsert_transaction_enrichment(rows)
