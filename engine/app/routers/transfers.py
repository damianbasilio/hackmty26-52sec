from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import clabe, repository, transfers
from ..auth import current_customer, owned_account_id
from ..config import get_settings
from ..transfers import TransferRequest

router = APIRouter(prefix="/transfers", tags=["transfers"])


@router.post("")
def create_transfer(req: TransferRequest, customer: dict = Depends(current_customer)) -> dict:
    """Moves real money and returns the receipt.

    The payee is a CLABE, or one of your own accounts by id. A CLABE of ours
    gets a withdrawal on the payer and a deposit on the payee in Nessie; one
    from another bank gets the withdrawal alone. Idempotent by `id`: send the
    same body again after a network error and it reconciles instead of
    charging twice. `status` in the body says completed or failed;
    `payer_side`/`payee_side` say which Nessie write actually happened.
    """
    if not get_settings().nessie_api_key:
        raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
    if req.payee_clabe:
        req = _resolve_clabe(req)
    elif req.payee_account_id:
        payee = repository.fetch_account(req.payee_account_id)
        if payee is None or payee["customer_id"] != customer["id"]:
            raise HTTPException(status_code=422, detail="Para enviar a otra persona usa su CLABE.")
    else:
        raise HTTPException(status_code=422, detail="Indica la CLABE de quien recibe.")
    return transfers.execute_transfer(req, customer["id"], datetime.now(timezone.utc))


@router.get("")
def list_transfers(account_id: str = Depends(owned_account_id)) -> list[dict]:
    """Transfers sent from this account, newest first."""
    return repository.fetch_transfers(account_id)


@router.get("/{transfer_id}")
def get_transfer(transfer_id: str, customer: dict = Depends(current_customer)) -> dict:
    """The same receipt POST /transfers returned."""
    transfer = repository.fetch_transfer(transfer_id)
    payer = repository.fetch_account(transfer["account_id"]) if transfer else None
    if payer is None or payer["customer_id"] != customer["id"]:
        raise HTTPException(status_code=404, detail=f"No existe la transferencia {transfer_id}")
    payee = repository.fetch_account(transfer["payee_account_id"]) if transfer["payee_account_id"] else None
    return transfers.receipt(transfer, payer, payee)


def _resolve_clabe(req: TransferRequest) -> TransferRequest:
    if not clabe.is_valid(req.payee_clabe):
        raise HTTPException(status_code=422, detail="La CLABE no es válida: revisa los 18 dígitos.")
    payee = repository.fetch_account_by_clabe(req.payee_clabe)
    if payee is None and req.payee_clabe.startswith(clabe.BANK_CODE):
        raise HTTPException(status_code=422, detail="No existe ninguna cuenta con esa CLABE.")
    return req.model_copy(
        update={
            "payee_account_id": payee["id"] if payee else None,
            "payee_last_four": clabe.last_four(req.payee_clabe),
            "payee_bank": clabe.bank_name(req.payee_clabe),
        }
    )
