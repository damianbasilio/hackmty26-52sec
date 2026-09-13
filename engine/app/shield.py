"""The shield: what the app does for the customer when the sentinel sees risk.

Every measure is temporary and reversible by the customer after verifying.
Making things safer never needs verification; making them less safe always does.

Verification is checked here, on the server: the transaction PIN in
AuthProvider.verifyTransactionPin lives only on the phone, so a stolen session
token could call the engine without it.

Scope: the shield records and explains, it doesn't sit in the money path. A
locked card or a CLABE marked as fraud is not enforced on /transfers yet.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .clabe import bank_name, last_four
from .enrichment import format_mxn

CHALLENGE_TTL = timedelta(minutes=5)
CHALLENGE_MAX_ATTEMPTS = 3
PURPOSES = {"release_protection", "confirm_legit", "change_settings"}


class VerificationError(Exception):
    """Message is es-MX and safe to show."""


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Settings:
    auto_protect: bool = True


@dataclass
class Shield:
    customer_id: str
    settings: Settings = field(default_factory=Settings)
    card_locked: bool = False
    incident_id: str | None = None
    blocked_clabes: set[str] = field(default_factory=set)
    cases: dict[str, dict] = field(default_factory=dict)
    timeline: list[dict] = field(default_factory=list)
    challenge: dict | None = None

    def note(self, now: datetime, kind: str, title: str, detail: str) -> dict:
        entry = {"at": _iso(now), "kind": kind, "title": title, "detail": detail}
        self.timeline.append(entry)
        return entry


def on_alert(shield: Shield, alert: dict, now: datetime) -> list[dict]:
    """Protective measures for a created or updated incident. Returns the timeline entries it added."""
    if alert["resolved_at"] or alert["severity"] not in ("warning", "critical"):
        return []
    added = []
    if shield.incident_id != alert["id"]:
        shield.incident_id = alert["id"]
        detail = alert["explanation"] if shield.settings.auto_protect else (
            "La protección automática está apagada: no bloqueamos nada. Revisa la alerta.")
        added.append(shield.note(now, "alert", alert["title"], detail))
    # the card is locked only at critical, because that one hurts daily life
    if shield.settings.auto_protect and alert["severity"] == "critical" and not shield.card_locked:
        shield.card_locked = True
        added.append(shield.note(now, "card_locked", "Bloqueamos tu tarjeta temporalmente",
                                 "Compras y retiros con tarjeta quedan detenidos hasta que confirmes qué pasó."))
    return added


def issue_challenge(shield: Shield, purpose: str, target: str, now: datetime) -> tuple[dict, str]:
    if purpose not in PURPOSES:
        raise VerificationError("Esa acción no requiere verificación.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    shield.challenge = {
        "id": f"chl_{secrets.token_hex(8)}",
        "purpose": purpose,
        "target": target,
        "code_hash": _hash(shield.customer_id, code),
        "expires_at": now + CHALLENGE_TTL,
        "attempts_left": CHALLENGE_MAX_ATTEMPTS,
    }
    public = {k: v for k, v in shield.challenge.items() if k != "code_hash"}
    return {**public, "expires_at": _iso(public["expires_at"])}, code


def verify(shield: Shield, challenge_id: str, code: str, purpose: str, target: str, now: datetime) -> None:
    challenge = shield.challenge
    if not challenge or challenge["id"] != challenge_id or challenge["purpose"] != purpose or challenge["target"] != target:
        raise VerificationError("Pide un código nuevo para esta acción.")
    if now > challenge["expires_at"]:
        shield.challenge = None
        raise VerificationError("El código expiró. Pide uno nuevo.")
    if not secrets.compare_digest(challenge["code_hash"], _hash(shield.customer_id, code.strip())):
        challenge["attempts_left"] -= 1
        if challenge["attempts_left"] <= 0:
            shield.challenge = None
            raise VerificationError("Demasiados intentos. Pide un código nuevo.")
        raise VerificationError(f"El código no coincide. Te quedan {challenge['attempts_left']} intento(s).")
    shield.challenge = None


def release(shield: Shield, now: datetime, reason: str) -> list[dict]:
    added = []
    if shield.card_locked:
        shield.card_locked = False
        added.append(shield.note(now, "card_unlocked", "Desbloqueaste tu tarjeta", reason))
    shield.incident_id = None
    return added


def confirm_legit(shield: Shield, alert: dict, now: datetime) -> list[dict]:
    added = [shield.note(now, "verified", "Confirmaste que fuiste tú", f"Marcamos «{alert['title']}» como legítimo.")]
    if shield.incident_id == alert["id"]:
        added += release(shield, now, "Verificaste tu identidad.")
    return added


def confirm_fraud(shield: Shield, alert: dict, disputed: list[dict], payee_clabes: set[str], now: datetime) -> dict:
    """disputed: completed outflows of the incident, as {id, amount_cents}."""
    shield.card_locked = True
    newly_marked = sorted(payee_clabes - shield.blocked_clabes)
    shield.blocked_clabes |= payee_clabes
    disputed_cents = -sum(t["amount_cents"] for t in disputed)
    case_id = f"ACL-{secrets.token_hex(3).upper()}"
    steps = ["Tu tarjeta queda bloqueada hasta que tú la desbloquees con tu código."]
    if newly_marked:
        listed = ", ".join(f"···{last_four(c)} ({bank_name(c)})" for c in newly_marked)
        steps.append(f"Marcamos las CLABEs {listed} como destino del fraude.")
    if disputed_cents:
        steps.append(f"Registramos la aclaración {case_id} por {format_mxn(disputed_cents)}.")
    steps += [
        "Cambia tu contraseña y tu PIN. Nadie de 52Pay te pedirá códigos por llamada o mensaje.",
        "Si no quedas conforme con la respuesta, puedes acudir a la CONDUSEF.",
    ]
    case = {
        "id": case_id,
        "alert_id": alert["id"],
        "status": "open",
        "opened_at": _iso(now),
        "transaction_ids": [t["id"] for t in disputed],
        "disputed_cents": disputed_cents,
        "blocked_clabes": [{"last_four": last_four(c), "bank": bank_name(c)} for c in sorted(payee_clabes)],
        "next_steps": steps,
    }
    shield.cases[case_id] = case
    shield.note(now, "case_opened", f"Abrimos la aclaración {case_id}", steps[-3] if disputed_cents else steps[0])
    return case


def _hash(customer_id: str, code: str) -> str:
    return hashlib.sha256(f"{customer_id}:{code}".encode()).hexdigest()
