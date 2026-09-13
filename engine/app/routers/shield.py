from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import ledger
from ..auth import current_customer
from ..shield_store import ShieldStore

router = APIRouter(prefix="/shield", tags=["shield"])

store = ShieldStore()


class Verification(BaseModel):
    challenge_id: str | None = None
    code: str | None = Field(default=None, pattern=r"^\s*\d{6}\s*$")


class ResolveIn(Verification):
    resolution: Literal["dismissed", "confirmed_fraud", "confirmed_legit"]


class ChallengeIn(BaseModel):
    purpose: Literal["release_protection", "confirm_legit", "change_settings"]
    target: str = Field(min_length=1, max_length=120)


class SettingsIn(Verification):
    auto_protect: bool | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def synced_customer(customer: dict = Depends(current_customer)) -> dict:
    """The sentinel sees every movement the customer has before answering."""
    accounts = ledger.load_accounts(customer["id"])
    store.sync(customer["id"], accounts, {a.id: ledger.load_movements(a.id) for a in accounts}, _now())
    return customer


@router.get("")
def get_shield(customer: dict = Depends(synced_customer)) -> dict:
    """Response shape: Shield in /contracts/types.ts."""
    return store.shield_json(customer["id"])


@router.get("/alerts")
def list_alerts(include_resolved: bool = False, customer: dict = Depends(synced_customer)) -> list[dict]:
    """Behavior patterns, most severe first. Response shape: ShieldAlert[]."""
    return store.alerts(customer["id"], include_resolved)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str, body: ResolveIn, customer: dict = Depends(synced_customer)) -> dict:
    """«Sí fui yo» needs a verification code; «No fui yo» and «Ignorar» never do."""
    return store.resolve_alert(customer["id"], alert_id, body.model_dump(), _now())


@router.post("/lock-card")
def lock_card(customer: dict = Depends(current_customer)) -> dict:
    return store.lock_card(customer["id"], _now())


@router.post("/release")
def release(body: Verification, customer: dict = Depends(current_customer)) -> dict:
    return store.release(customer["id"], body.model_dump(), _now())


@router.patch("/settings")
def update_settings(body: SettingsIn, customer: dict = Depends(current_customer)) -> dict:
    """Turning automatic protection off needs a verification code; turning it on doesn't."""
    return store.update_settings(customer["id"], body.model_dump(exclude_none=True), _now())


@router.post("/challenges", status_code=201)
def create_challenge(body: ChallengeIn, customer: dict = Depends(synced_customer)) -> dict:
    challenge, code = store.request_challenge(customer["id"], body.purpose, body.target, _now())
    # ponytail: there is no SMS or push channel yet, so the code comes back here and the app
    # unlocks it with the device PIN. Once a channel exists, drop `code` from this response.
    return {"challenge": challenge, "code": code}
