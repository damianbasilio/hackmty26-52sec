"""Nessie bills: the bank's own record of a recurring payment.

Only accounts synced from Nessie have bills. The fixture account's
nessie_account_id is a placeholder, so it skips the bill check entirely and
keeps the fixture subscriptions exactly as they are.

Field names follow Nessie's Bill (status, payee, payment_amount,
recurring_date, upcoming_payment_date). The live key had zero bills when this
was written, so that shape is the documented one, not one seen on the wire.
"""

from __future__ import annotations

from datetime import date

import httpx
from fastapi import HTTPException

from . import nessie, repository
from .config import get_settings
from .enrichment import normalize_merchant
from .models import Merchant, Transaction
from .subscriptions_engine import detect_subscriptions, reconcile_with_bills

# nessie_sync._map_account ids a synced account "acc_nessie_<nessie id>"
_NESSIE_ACCOUNT_ID_PREFIX = "acc_nessie_"


def detect_with_bills(
    account_id: str,
    transactions: list[Transaction],
    merchants: dict[str, Merchant],
    existing_ids: dict[tuple[str, str], str],
    today: date,
) -> list[dict]:
    detected = detect_subscriptions(account_id, transactions, merchants, existing_ids)
    bills = fetch_recurring_bills(account_id)
    if bills is None:
        return detected

    merchants = dict(merchants)
    for bill in bills:
        normalized_name = normalize_merchant(bill["payee"]).normalized_name
        if normalized_name not in merchants:
            merchants[normalized_name] = repository.get_or_create_merchant(bill["payee"])
    return reconcile_with_bills(account_id, detected, bills, merchants, transactions, existing_ids, today)


def fetch_recurring_bills(account_id: str) -> list[dict] | None:
    """Live recurring bills in cents, or None when this account has no bill source."""
    if not account_id.startswith(_NESSIE_ACCOUNT_ID_PREFIX) or not get_settings().nessie_api_key:
        return None
    try:
        raw = nessie.get_bills(account_id.removeprefix(_NESSIE_ACCOUNT_ID_PREFIX))
    except httpx.HTTPError as exc:
        # Failing beats labelling every subscription "inferida" because Nessie was slow.
        raise HTTPException(
            status_code=502,
            detail="Nessie no respondió al consultar los pagos domiciliados; intenta de nuevo.",
        ) from exc
    return [_to_cents(bill) for bill in raw if _is_recurring(bill)]


def _is_recurring(bill: dict) -> bool:
    status = (bill.get("status") or "").lower()
    return status != "cancelled" and (status == "recurring" or bool(bill.get("recurring_date")))


def _to_cents(bill: dict) -> dict:
    return {
        "id": bill["_id"],
        "payee": bill.get("payee") or bill.get("nickname") or "",
        "amount_cents": nessie.to_cents(bill.get("payment_amount") or 0),
        "recurring_day": bill.get("recurring_date"),
        "next_payment_on": _day(bill.get("upcoming_payment_date")),
        "first_on": _day(bill.get("creation_date")),
        "last_paid_on": _day(bill.get("payment_date")),
    }


def _day(value: str | None) -> str | None:
    return value[:10] if value else None
