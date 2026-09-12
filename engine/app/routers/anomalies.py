from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/anomalies", tags=["anomalies"])

NOT_READY = "Engine not implemented yet. App should keep reading /contracts/fixtures."


@router.get("")
def list_alerts(account_id: str, include_resolved: bool = False) -> list[dict]:
    """Alert feed, most severe first. Response shape: AnomalyAlert[] in /contracts/types.ts."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/scan")
def scan_account(account_id: str) -> list[dict]:
    """Score every recent movement and persist new alerts."""
    raise HTTPException(status_code=501, detail=NOT_READY)


@router.post("/{alert_id}/resolve")
def resolve_alert(alert_id: str, resolution: str) -> dict:
    """resolution is one of dismissed | confirmed_fraud | confirmed_legit."""
    raise HTTPException(status_code=501, detail=NOT_READY)
