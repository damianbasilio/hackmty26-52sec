from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import nessie
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
def seed_nessie(confirm: bool = False) -> dict[str, str]:
    """Create one demo customer/account/history directly in Nessie.

    Writes external, hard-to-undo data (there's no DELETE on this API), so it
    requires ?confirm=true — a plain retry or an app calling this by mistake
    should not silently create a customer.

    Also refuses outright if this API key already has any customers: Nessie
    has no upsert-by-name, so a second call would duplicate the demo customer
    instead of topping up the first one, and if the key isn't fresh those
    could be real customers we have no business writing over. Run
    POST /sync/nessie/seed once, then POST /sync/nessie to pull it into
    Supabase.
    """
    _require_nessie()
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Pasa ?confirm=true para confirmar: esto crea un cliente/cuenta/historial "
            "nuevos directamente en Nessie y no se puede deshacer (esta API no tiene DELETE).",
        )
    if nessie.get_customers():
        raise HTTPException(
            status_code=409,
            detail="Esta API key de Nessie ya tiene clientes — de un /sync/nessie/seed anterior "
            "o de datos reales. No se vuelve a sembrar para no duplicar la demo ni escribir "
            "encima de datos que no son nuestros.",
        )
    return seed_demo_data(datetime.now(timezone.utc))
