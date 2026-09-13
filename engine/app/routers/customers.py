from fastapi import APIRouter, Depends

from ..auth import current_customer

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("/me")
def get_current_customer(customer: dict = Depends(current_customer)) -> dict:
    """Response shape: Customer in /contracts/types.ts."""
    return customer
