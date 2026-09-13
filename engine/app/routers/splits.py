from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import repository, splits
from ..auth import current_customer
from ..config import get_settings
from ..splits import SplitCreate, SplitJoin, SplitPayment

router = APIRouter(prefix="/splits", tags=["splits"])


@router.post("")
def create_split(req: SplitCreate, customer: dict = Depends(current_customer)) -> dict:
    """Opens a split with a 4-digit code that expires in 15 minutes. Idempotent by `id`."""
    return splits.create_split(req, customer, datetime.now(timezone.utc))


@router.post("/join")
def join_split(req: SplitJoin, customer: dict = Depends(current_customer)) -> dict:
    """Joins by code and re-splits evenly. Idempotent by `participant_id`.

    Whoever calls is who joins: a customer_id in the body is ignored.
    """
    return splits.join_split(req.model_copy(update={"customer_id": customer["id"]}), datetime.now(timezone.utc))


@router.get("/by-code/{code}")
def get_split_by_code(code: str, _: dict = Depends(current_customer)) -> dict:
    """What someone about to join sees: total, who's in, and each share."""
    split = repository.fetch_open_split_by_code(code)
    if split is None:
        raise HTTPException(status_code=404, detail=f"El código {code} no corresponde a ninguna división abierta.")
    now = datetime.now(timezone.utc)
    return splits.split_view(split, repository.fetch_split_participants(split["id"]), now)


@router.get("/{split_id}")
def get_split(split_id: str, customer: dict = Depends(current_customer)) -> dict:
    split = repository.fetch_split(split_id)
    participants = repository.fetch_split_participants(split_id) if split else []
    if split is None or (
        split["created_by"] != customer["id"] and all(p["customer_id"] != customer["id"] for p in participants)
    ):
        raise HTTPException(status_code=404, detail=f"No existe la división {split_id}.")
    return splits.split_view(split, participants, datetime.now(timezone.utc))


@router.post("/{split_id}/participants/{participant_id}/pay")
def pay_share(
    split_id: str, participant_id: str, req: SplitPayment, customer: dict = Depends(current_customer)
) -> dict:
    """Pays one share with a real transfer from your account into the split's account.

    Idempotent by `transfer_id`, same as POST /transfers. Returns the transfer
    receipt and the split as it stands after the payment.
    """
    if not get_settings().nessie_api_key:
        raise HTTPException(status_code=503, detail="Nessie no está configurado (falta NESSIE_API_KEY).")
    return splits.pay_share(split_id, participant_id, req, customer, datetime.now(timezone.utc))
