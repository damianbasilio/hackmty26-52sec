from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import repository, transfers
from ..config import get_settings
from ..transfers import TransferRequest

router = APIRouter(prefix="/transfers", tags=["transfers"])


@router.post("")
def create_transfer(req: TransferRequest) -> dict:
    """Moves real money and returns the receipt.

    Withdrawal on the payer in Nessie, deposit on the payee when it's an
    account we hold, and the row in `transfers`. Idempotent by `id`: send the
    same body again after a network error and it reconciles instead of
    charging twice. `status` in the body says completed or failed;
    `payer_side`/`payee_side` say which Nessie write actually happened.
    """
    if not get_settings().nessie_api_key:
        raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
    customer = repository.fetch_current_customer()
    if customer is None:
        raise HTTPException(status_code=404, detail="No hay cliente sembrado todavía")
    return transfers.execute_transfer(req, customer["id"], datetime.now(timezone.utc))


@router.get("")
def list_transfers(account_id: str) -> list[dict]:
    """Transfers sent from this account, newest first."""
    return repository.fetch_transfers(account_id)


@router.get("/{transfer_id}")
def get_transfer(transfer_id: str) -> dict:
    """The same receipt POST /transfers returned."""
    transfer = repository.fetch_transfer(transfer_id)
    if transfer is None:
        raise HTTPException(status_code=404, detail=f"No existe la transferencia {transfer_id}")
    payer = repository.fetch_account(transfer["account_id"])
    payee = repository.fetch_account(transfer["payee_account_id"]) if transfer["payee_account_id"] else None
    return transfers.receipt(transfer, payer, payee)
