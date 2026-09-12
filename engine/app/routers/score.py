from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/score", tags=["score"])

NOT_READY = "Engine not implemented yet. App should keep reading /contracts/fixtures."


@router.get("")
def get_score(account_id: str) -> dict:
    """Latest cashflow health score. Response shape: CashflowScore in /contracts/types.ts."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/compute")
def compute_score(account_id: str) -> dict:
    """Recompute the 300-850 score plus its weighted component breakdown."""
    raise HTTPException(status_code=501, detail=NOT_READY)
