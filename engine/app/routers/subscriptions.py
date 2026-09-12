from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

NOT_READY = "Engine not implemented yet. App should keep reading /contracts/fixtures."


@router.get("")
def list_subscriptions(account_id: str) -> list[dict]:
    """Detected recurring charges. Response shape: Subscription[] in /contracts/types.ts."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/detect")
def detect_subscriptions(account_id: str) -> list[dict]:
    """Re-run cadence detection over the account history and upsert subscriptions."""
    raise HTTPException(status_code=501, detail=NOT_READY)
