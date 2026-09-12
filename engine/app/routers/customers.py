from fastapi import APIRouter, HTTPException

from .. import repository

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("/me")
def get_current_customer() -> dict:
    """Response shape: Customer in /contracts/types.ts."""
    customer = repository.fetch_current_customer()
    if customer is None:
        raise HTTPException(status_code=404, detail="No hay cliente sembrado todavía")
    return customer
