from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..auth import owned_account_id
from ..bills import detect_with_bills

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("")
def list_subscriptions(account_id: str = Depends(owned_account_id)) -> list[dict]:
    """Detected recurring charges. Response shape: Subscription[] in /contracts/types.ts."""
    return repository.fetch_subscriptions(account_id)


@router.post("/detect")
def detect(account_id: str = Depends(owned_account_id)) -> list[dict]:
    """Re-run cadence detection, cross it with the account's Nessie bills, and upsert."""
    transactions = repository.fetch_transactions(account_id)
    if not transactions:
        raise HTTPException(status_code=404, detail="No transactions for this account")

    merchants = repository.fetch_merchants()
    existing = repository.fetch_subscriptions(account_id)
    existing_ids = {(row["merchant_id"], row["cadence"]): row["id"] for row in existing}

    detected = detect_with_bills(
        account_id, transactions, merchants, existing_ids, datetime.now(timezone.utc).date()
    )
    return repository.upsert_subscriptions(detected)
