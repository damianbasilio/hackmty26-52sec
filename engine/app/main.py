from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import anomalies, savings, score, subscriptions

settings = get_settings()

app = FastAPI(
    title="52sec intelligence engine",
    version="0.1.0",
    description="Subscription, anomaly, score and savings engines. Only caller of the Nessie API.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.engine_cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(subscriptions.router)
app.include_router(anomalies.router)
app.include_router(score.router)
app.include_router(savings.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "version": app.version,
        "nessie_configured": bool(settings.nessie_api_key),
        "supabase_configured": bool(settings.supabase_url and settings.supabase_service_role_key),
    }
