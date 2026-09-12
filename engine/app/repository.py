"""Supabase access. Server-side only, uses the service role key.

Every table here mirrors /db/schema.sql. Engines never talk to Supabase
directly — they call these functions so the wire format stays in one place.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from .config import get_settings
from .enrichment import normalize_merchant
from .models import Merchant, Transaction, parse_iso


class SupabaseNotConfigured(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "Supabase no está configurado (falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY). "
            "Corre el contenedor con --env-file .env o exporta esas variables."
        )


@lru_cache
def get_client() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise SupabaseNotConfigured()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def fetch_current_customer() -> dict | None:
    """Single-tenant demo: the engine serves one customer, the oldest seeded row."""
    res = get_client().table("customers").select("*").order("created_at").limit(1).execute()
    return res.data[0] if res.data else None


def fetch_accounts(customer_id: str) -> list[dict]:
    res = (
        get_client()
        .table("accounts")
        .select("*")
        .eq("customer_id", customer_id)
        .order("created_at")
        .execute()
    )
    return res.data


def fetch_enriched_transactions(
    account_id: str, date_from: str | None, date_to: str | None, limit: int | None
) -> list[dict]:
    query = get_client().table("enriched_transactions").select("*").eq("account_id", account_id)
    if date_from:
        query = query.gte("occurred_at", f"{date_from}T00:00:00Z")
    if date_to:
        query = query.lte("occurred_at", f"{date_to}T23:59:59Z")
    query = query.order("occurred_at", desc=True)
    if limit is not None:
        query = query.limit(limit)
    return query.execute().data


def fetch_account(account_id: str) -> dict | None:
    res = (
        get_client()
        .table("accounts")
        .select("id,customer_id,balance_cents,created_at")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def fetch_savings_account_id(customer_id: str) -> str | None:
    res = (
        get_client()
        .table("accounts")
        .select("id")
        .eq("customer_id", customer_id)
        .eq("type", "savings")
        .limit(1)
        .execute()
    )
    return res.data[0]["id"] if res.data else None


def fetch_transactions(account_id: str) -> list[Transaction]:
    res = (
        get_client()
        .table("transactions")
        .select("id,account_id,amount_cents,type,status,raw_description,occurred_at")
        .eq("account_id", account_id)
        .eq("status", "completed")
        .order("occurred_at")
        .execute()
    )
    return [
        Transaction(
            id=row["id"],
            account_id=row["account_id"],
            amount_cents=row["amount_cents"],
            type=row["type"],
            status=row["status"],
            raw_description=row["raw_description"],
            occurred_at=parse_iso(row["occurred_at"]),
        )
        for row in res.data
    ]


def fetch_merchants() -> dict[str, Merchant]:
    res = get_client().table("merchants").select("*").execute()
    return {
        row["normalized_name"]: Merchant(
            id=row["id"],
            normalized_name=row["normalized_name"],
            display_name=row["display_name"],
            category=row["category"],
            is_recurring_biller=row["is_recurring_biller"],
        )
        for row in res.data
    }


def get_or_create_merchant(raw_description: str) -> Merchant:
    """Look up the merchant for a descriptor, creating it if enrichment saw a new one."""
    guess = normalize_merchant(raw_description)
    existing = (
        get_client()
        .table("merchants")
        .select("*")
        .eq("normalized_name", guess.normalized_name)
        .limit(1)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        return Merchant(
            id=row["id"],
            normalized_name=row["normalized_name"],
            display_name=row["display_name"],
            category=row["category"],
            is_recurring_biller=row["is_recurring_biller"],
        )
    inserted = (
        get_client()
        .table("merchants")
        .insert(
            {
                "id": f"mer_{guess.normalized_name}",
                "normalized_name": guess.normalized_name,
                "display_name": guess.display_name,
                "category": guess.category,
                "raw_descriptor_samples": [raw_description],
                "is_recurring_biller": guess.is_recurring_biller,
            }
        )
        .execute()
    )
    row = inserted.data[0]
    return Merchant(
        id=row["id"],
        normalized_name=row["normalized_name"],
        display_name=row["display_name"],
        category=row["category"],
        is_recurring_biller=row["is_recurring_biller"],
    )


def upsert_transaction_enrichment(rows: list[dict]) -> None:
    if not rows:
        return
    get_client().table("transaction_enrichment").upsert(rows, on_conflict="transaction_id").execute()


# subscriptions has no category/merchant_display_name columns — they're
# denormalized from merchants (already joined on merchant_id) rather than
# duplicated in storage, matching every other table's split between raw and
# derived data.
_SUBSCRIPTION_DENORMALIZED_FIELDS = ("category", "merchant_display_name")


def _flatten_subscription(row: dict) -> dict:
    merchant = row.pop("merchants", None) or {}
    row["category"] = merchant.get("category")
    row["merchant_display_name"] = merchant.get("display_name")
    return row


def fetch_subscriptions(account_id: str) -> list[dict]:
    res = (
        get_client()
        .table("subscriptions")
        .select("*, merchants(category,display_name)")
        .eq("account_id", account_id)
        .order("next_charge_on")
        .execute()
    )
    return [_flatten_subscription(row) for row in res.data]


def upsert_subscriptions(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    db_rows = [
        {k: v for k, v in row.items() if k not in _SUBSCRIPTION_DENORMALIZED_FIELDS} for row in rows
    ]
    get_client().table("subscriptions").upsert(db_rows, on_conflict="account_id,merchant_id,cadence").execute()
    # Return what we already computed (full contract shape) rather than
    # re-reading — the DB row is missing the denormalized fields anyway.
    return rows


def fetch_anomaly_alerts(account_id: str, include_resolved: bool) -> list[dict]:
    query = (
        get_client()
        .table("anomaly_alerts")
        .select("*")
        .eq("account_id", account_id)
    )
    if not include_resolved:
        query = query.is_("resolved_at", "null")
    res = query.order("score", desc=True).order("detected_at", desc=True).execute()
    return res.data


def upsert_anomaly_alerts(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    res = get_client().table("anomaly_alerts").upsert(rows, on_conflict="id").execute()
    return res.data


def resolve_anomaly_alert(alert_id: str, resolution: str, resolved_at: str) -> dict:
    res = (
        get_client()
        .table("anomaly_alerts")
        .update({"resolution": resolution, "resolved_at": resolved_at})
        .eq("id", alert_id)
        .execute()
    )
    return res.data[0]


def fetch_latest_cashflow_score(account_id: str) -> dict | None:
    res = (
        get_client()
        .table("cashflow_scores")
        .select("*")
        .eq("account_id", account_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def upsert_cashflow_score(row: dict) -> dict:
    res = (
        get_client()
        .table("cashflow_scores")
        .upsert(row, on_conflict="account_id,period_end")
        .execute()
    )
    return res.data[0]


def fetch_savings_rules(account_id: str) -> list[dict]:
    res = (
        get_client()
        .table("savings_rules")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at")
        .execute()
    )
    return res.data


def upsert_savings_rules(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    res = get_client().table("savings_rules").upsert(rows, on_conflict="id").execute()
    return res.data


def activate_savings_rule(rule_id: str, destination_account_id: str, activated_at: str) -> dict:
    res = (
        get_client()
        .table("savings_rules")
        .update(
            {
                "status": "active",
                "destination_account_id": destination_account_id,
                "activated_at": activated_at,
            }
        )
        .eq("id", rule_id)
        .execute()
    )
    return res.data[0]
