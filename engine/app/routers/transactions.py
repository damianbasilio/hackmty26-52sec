from fastapi import APIRouter, Query

from .. import repository

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
def list_transactions(
    account_id: str,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Enriched movements, newest first. Response shape: EnrichedTransaction[].

    `from`/`to` are inclusive calendar days (YYYY-MM-DD).
    """
    return repository.fetch_enriched_transactions(account_id, from_, to, limit)
