from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/savings", tags=["savings"])

NOT_READY = "Engine not implemented yet. App should keep reading /contracts/fixtures."


@router.get("/rules")
def list_rules(account_id: str) -> list[dict]:
    """Active and suggested rules. Response shape: SavingsRule[] in /contracts/types.ts."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/suggest")
def suggest_rules(account_id: str) -> list[dict]:
    """Derive new savings suggestions from subscriptions and spending patterns."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/rules/{rule_id}/activate")
def activate_rule(rule_id: str, destination_account_id: str) -> dict:
    raise HTTPException(status_code=501, detail=NOT_READY)
