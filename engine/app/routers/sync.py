from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..nessie_sync import seed_demo_data, sync_all

router = APIRouter(prefix="/sync", tags=["sync"])


def _require_nessie() -> None:
    if not get_settings().nessie_api_key:
        raise HTTPException(
            status_code=503,
            detail="Nessie no está configurado (falta NESSIE_API_KEY). Corre el contenedor "
            "con --env-file .env o exporta la variable.",
        )


@router.post("/nessie")
def sync_nessie() -> dict[str, int]:
    """Pull every customer/account/transaction Nessie has for this API key into Supabase.

    Idempotent — safe to call again to pick up new Nessie activity.
    """
    _require_nessie()
    return sync_all()


@router.post("/nessie/seed")
def seed_nessie() -> dict[str, str]:
    """Create one demo customer/account/history directly in Nessie.

    Only useful the first time: this key ships with zero customers of its own,
    unlike Supabase, which starts from /contracts/fixtures. Calling this twice
    adds a second demo customer instead of topping up the first one — Nessie
    has no upsert-by-name to key off. Follow with POST /sync/nessie to pull it
    into Supabase.
    """
    _require_nessie()
    return seed_demo_data(datetime.now(timezone.utc))
