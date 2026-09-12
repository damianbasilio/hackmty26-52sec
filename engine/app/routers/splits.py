from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import repository, splits
from ..config import get_settings
from ..splits import SplitCreate, SplitJoin, SplitPayment

router = APIRouter(prefix="/splits", tags=["splits"])


@router.post("")
def create_split(req: SplitCreate) -> dict:
    """Opens a split with a 4-digit code that expires in 15 minutes. Idempotent by `id`."""
    customer = repository.fetch_current_customer()
    if customer is None:
        raise HTTPException(status_code=404, detail="No hay cliente sembrado todavía")
    return splits.create_split(req, customer, datetime.now(timezone.utc))


@router.post("/join")
def join_split(req: SplitJoin) -> dict:
    """Joins by code and re-splits evenly. Idempotent by `participant_id`."""
    return splits.join_split(req, datetime.now(timezone.utc))


@router.get("/by-code/{code}")
def get_split_by_code(code: str) -> dict:
    """What someone about to join sees: total, who's in, and each share."""
    split = repository.fetch_open_split_by_code(code)
    if split is None:
        raise HTTPException(status_code=404, detail=f"El código {code} no corresponde a ninguna división abierta.")
    now = datetime.now(timezone.utc)
    return splits.split_view(split, repository.fetch_split_participants(split["id"]), now)


@router.get("/{split_id}")
def get_split(split_id: str) -> dict:
    split = repository.fetch_split(split_id)
    if split is None:
        raise HTTPException(status_code=404, detail=f"No existe la división {split_id}.")
    now = datetime.now(timezone.utc)
    return splits.split_view(split, repository.fetch_split_participants(split_id), now)


@router.post("/{split_id}/participants/{participant_id}/pay")
def pay_share(split_id: str, participant_id: str, req: SplitPayment) -> dict:
    """Pays one share with a real transfer into the split's account.

    Idempotent by `transfer_id`, same as POST /transfers. Returns the transfer
    receipt and the split as it stands after the payment.
    """
    if not get_settings().nessie_api_key:
        raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
    return splits.pay_share(split_id, participant_id, req, datetime.now(timezone.utc))
