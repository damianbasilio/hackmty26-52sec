from fastapi import APIRouter

from .. import repository, transfers

router = APIRouter(tags=["accounts"])


@router.get("/accounts")
def list_accounts() -> list[dict]:
    """Response shape: Account[] in /contracts/types.ts.

    balance_cents on a Nessie account is what's available after transfers:
    Nessie's own balance doesn't move when money leaves (see transfers.py).
    """
    customer = repository.fetch_current_customer()
    if customer is None:
        return []
    return [
        {**account, "balance_cents": transfers.available_balance_cents(account["id"], account["balance_cents"])}
        if account["id"].startswith("acc_nessie_")
        else account
        for account in repository.fetch_accounts(customer["id"])
    ]
