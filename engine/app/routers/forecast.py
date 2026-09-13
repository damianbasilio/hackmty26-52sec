from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import ledger
from ..auth import current_customer, owned_account_id
from ..forecast_engine import build_forecast

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("")
def get_forecast(account_id: str = Depends(owned_account_id), customer: dict = Depends(current_customer)) -> dict:
    """My money in 30 days. Response shape: CashflowForecast in /contracts/types.ts."""
    accounts = ledger.load_accounts(customer["id"])
    account = next((a for a in accounts if a.id == account_id), None)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No existe la cuenta {account_id}.")
    movements = ledger.load_movements(account_id)
    if not movements:
        raise HTTPException(status_code=404, detail="Todavía no hay movimientos para pronosticar tu saldo.")
    savings = [a for a in accounts if a.type == "savings" and a.id != account_id]
    return build_forecast(account, movements, datetime.now(timezone.utc), savings)
