from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import repository
from ..anomalies_engine import scan_anomalies
from ..bills import detect_with_bills

router = APIRouter(prefix="/anomalies", tags=["anomalies"])

VALID_RESOLUTIONS = {"dismissed", "confirmed_fraud", "confirmed_legit"}


@router.get("")
def list_alerts(account_id: str, include_resolved: bool = False) -> list[dict]:
    """Alert feed, most severe first. Response shape: AnomalyAlert[] in /contracts/types.ts."""
    return repository.fetch_anomaly_alerts(account_id, include_resolved)


@router.post("/scan")
def scan(account_id: str) -> list[dict]:
    """Score every recent movement and persist new alerts."""
    transactions = repository.fetch_transactions(account_id)
    if not transactions:
        raise HTTPException(status_code=404, detail="No transactions for this account")

    now = datetime.now(timezone.utc)
    merchants = repository.fetch_merchants()
    existing_subscriptions = repository.fetch_subscriptions(account_id)
    existing_subscription_ids = {
        (row["merchant_id"], row["cadence"]): row["id"] for row in existing_subscriptions
    }
    # Same detection /subscriptions/detect persists, so the upsert below
    # doesn't overwrite a bill-confirmed explanation with an inferred one.
    subscriptions = detect_with_bills(
        account_id, transactions, merchants, existing_subscription_ids, now.date()
    )
    # A price-hike alert links subscription_id by FK, so whatever we just
    # detected has to actually exist in the table — don't assume
    # /subscriptions/detect already ran.
    repository.upsert_subscriptions(subscriptions)

    existing = repository.fetch_anomaly_alerts(account_id, include_resolved=True)
    existing_ids = {
        row["transaction_id"]: row["id"]
        for row in existing
        if row["transaction_id"] and row["resolved_at"] is None
    }
    resolved_transaction_ids = {
        row["transaction_id"] for row in existing if row["transaction_id"] and row["resolved_at"] is not None
    }

    alerts = scan_anomalies(
        account_id,
        transactions,
        merchants,
        subscriptions,
        now,
        existing_ids,
        resolved_transaction_ids,
    )
    return repository.upsert_anomaly_alerts(alerts)


@router.post("/{alert_id}/resolve")
def resolve_alert(alert_id: str, resolution: str) -> dict:
    """resolution is one of dismissed | confirmed_fraud | confirmed_legit."""
    if resolution not in VALID_RESOLUTIONS:
        raise HTTPException(status_code=422, detail=f"resolution must be one of {sorted(VALID_RESOLUTIONS)}")
    resolved_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    alert = repository.resolve_anomaly_alert(alert_id, resolution, resolved_at)
    if alert is None:
        raise HTTPException(status_code=404, detail=f"No existe la alerta {alert_id}")
    return alert
