from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..auth import owned_account_id
from ..models import parse_iso
from ..score_engine import compute_score

router = APIRouter(prefix="/score", tags=["score"])


@router.get("")
def get_score(account_id: str = Depends(owned_account_id)) -> dict:
    """Latest cashflow health score. Response shape: CashflowScore in /contracts/types.ts."""
    latest = repository.fetch_latest_cashflow_score(account_id)
    if latest is None:
        raise HTTPException(status_code=404, detail="No score computed yet; call /score/compute")
    return latest


@router.post("/compute")
def compute(account_id: str = Depends(owned_account_id)) -> dict:
    """Recompute the 300-850 score plus its weighted component breakdown."""
    account = repository.fetch_account(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Unknown account")

    transactions = repository.fetch_transactions(account_id)
    if not transactions:
        raise HTTPException(status_code=404, detail="No transactions for this account")

    merchants = repository.fetch_merchants()
    previous = repository.fetch_latest_cashflow_score(account_id)

    result = compute_score(
        account_id,
        transactions,
        merchants,
        account["balance_cents"],
        parse_iso(account["created_at"]),
        datetime.now(timezone.utc),
        previous["score"] if previous else None,
    )
    return repository.upsert_cashflow_score(result)
