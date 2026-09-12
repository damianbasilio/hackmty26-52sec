from fastapi import APIRouter

from .. import repository

router = APIRouter(tags=["accounts"])


@router.get("/accounts")
def list_accounts() -> list[dict]:
    """Response shape: Account[] in /contracts/types.ts."""
    customer = repository.fetch_current_customer()
    if customer is None:
        return []
    return repository.fetch_accounts(customer["id"])
