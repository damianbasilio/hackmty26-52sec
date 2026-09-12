from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..nessie_sync import sync_all

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/nessie")
def sync_nessie() -> dict[str, int]:
    """Pull every customer/account/transaction Nessie has for this API key into Supabase.

    Idempotent — safe to call again to pick up new Nessie activity.
    """
    if not get_settings().nessie_api_key:
        raise HTTPException(
            status_code=503,
            detail="Nessie no está configurado (falta NESSIE_API_KEY). Corre el contenedor "
            "con --env-file .env o exporta la variable.",
        )
    return sync_all()
