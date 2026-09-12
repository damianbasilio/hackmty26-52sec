from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .repository import CustomerResolutionError, SupabaseNotConfigured
from .routers import (
    accounts,
    anomalies,
    customers,
    savings,
    score,
    subscriptions,
    sync,
    transactions,
    transfers,
)
from .transfers import TransferError

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


@app.exception_handler(SupabaseNotConfigured)
def handle_supabase_not_configured(request: Request, exc: SupabaseNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(CustomerResolutionError)
def handle_customer_resolution_error(request: Request, exc: CustomerResolutionError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(TransferError)
def handle_transfer_error(request: Request, exc: TransferError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.include_router(customers.router)
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(sync.router)
app.include_router(subscriptions.router)
app.include_router(anomalies.router)
app.include_router(score.router)
app.include_router(savings.router)
app.include_router(transfers.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "version": app.version,
        "nessie_configured": bool(settings.nessie_api_key),
        "supabase_configured": bool(settings.supabase_url and settings.supabase_service_role_key),
    }
