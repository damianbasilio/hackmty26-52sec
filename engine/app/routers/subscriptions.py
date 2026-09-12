from fastapi import APIRouter, HTTPException

from .. import repository
from ..subscriptions_engine import detect_subscriptions

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("")
def list_subscriptions(account_id: str) -> list[dict]:
    """Detected recurring charges. Response shape: Subscription[] in /contracts/types.ts."""
    return repository.fetch_subscriptions(account_id)


@router.post("/detect")
def detect(account_id: str) -> list[dict]:
    """Re-run cadence detection over the account history and upsert subscriptions."""
    transactions = repository.fetch_transactions(account_id)
    if not transactions:
        raise HTTPException(status_code=404, detail="No transactions for this account")

    merchants = repository.fetch_merchants()
    existing = repository.fetch_subscriptions(account_id)
    existing_ids = {(row["merchant_id"], row["cadence"]): row["id"] for row in existing}

    detected = detect_subscriptions(account_id, transactions, merchants, existing_ids)
    return repository.upsert_subscriptions(detected)
