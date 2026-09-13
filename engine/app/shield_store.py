"""Shield state per customer, in engine memory.

ponytail: memory, not Supabase. A restart forgets locks, cases and resolutions
(alerts come back on the next sync, unresolved). Same ceiling as transfers.py:
one engine replica. The shield tables go to /db the day it has to survive a deploy.

Every read syncs first: movements the sentinel hasn't seen are observed in order.
Only incidents active in the last 24 h trigger measures, so the first sync after
a restart shows old patterns without locking today's card for them.
"""

from __future__ import annotations

import threading
from dataclasses import replace
from datetime import datetime, timedelta

from . import shield as protection
from .clabe import bank_name, last_four
from .ledger import LedgerAccount, Movement
from .sentinel_engine import Sentinel

ACTIVE_INCIDENT_WINDOW = timedelta(hours=24)
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


class ShieldError(Exception):
    """Message is es-MX and safe to show; status is the HTTP code to answer with."""

    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


class _CustomerState:
    def __init__(self, customer_id: str) -> None:
        self.shield = protection.Shield(customer_id)
        self.sentinel = Sentinel()
        self.seen: set[str] = set()
        self.movements: dict[str, Movement] = {}
        self.own_clabes: set[str] = set()


class ShieldStore:
    def __init__(self) -> None:
        self._states: dict[str, _CustomerState] = {}
        self._lock = threading.RLock()

    def _state(self, customer_id: str) -> _CustomerState:
        if customer_id not in self._states:
            self._states[customer_id] = _CustomerState(customer_id)
        return self._states[customer_id]

    def sync(self, customer_id: str, accounts: list[LedgerAccount], movements: dict[str, list[Movement]], now: datetime) -> None:
        with self._lock:
            state = self._state(customer_id)
            state.own_clabes = {a.clabe for a in accounts if a.clabe}
            for account in accounts:
                rows = sorted((m for m in movements.get(account.id, []) if m.status == "completed"), key=lambda m: m.occurred_at)
                # balance right after each movement, walking back from today's
                after = account.balance_cents
                balances = []
                for m in reversed(rows):
                    balances.append(after)
                    after -= m.amount_cents
                balances.reverse()
                for m, balance in zip(rows, balances):
                    state.movements[m.id] = m
                    if m.id in state.seen:
                        continue
                    state.seen.add(m.id)
                    for _, alert in state.sentinel.observe(replace(account, balance_cents=balance), m):
                        if now - m.occurred_at <= ACTIVE_INCIDENT_WINDOW:
                            protection.on_alert(state.shield, alert, now)

    def alerts(self, customer_id: str, include_resolved: bool = False) -> list[dict]:
        with self._lock:
            rows = [a for a in self._state(customer_id).sentinel.alerts.values() if include_resolved or not a["resolved_at"]]
            return sorted(rows, key=lambda a: (a["resolved_at"] is not None, _SEVERITY_ORDER[a["severity"]], -a["score"]))

    def shield_json(self, customer_id: str) -> dict:
        with self._lock:
            shield = self._state(customer_id).shield
            open_alerts = len(self.alerts(customer_id))
            return {
                "status": "protecting" if shield.card_locked else "attention" if open_alerts else "normal",
                "settings": {"auto_protect": shield.settings.auto_protect},
                "card_locked": shield.card_locked,
                "incident_id": shield.incident_id,
                "open_alerts": open_alerts,
                "blocked_clabes": [{"last_four": last_four(c), "bank": bank_name(c)} for c in sorted(shield.blocked_clabes)],
                "cases": sorted(shield.cases.values(), key=lambda c: c["opened_at"], reverse=True),
                "timeline": list(reversed(shield.timeline))[:40],
            }

    def request_challenge(self, customer_id: str, purpose: str, target: str, now: datetime) -> tuple[dict, str]:
        with self._lock:
            state = self._state(customer_id)
            valid = {
                "confirm_legit": any(a["id"] == target for a in self.alerts(customer_id)),
                "release_protection": target == "shield" and state.shield.card_locked,
                "change_settings": target == "settings",
            }.get(purpose, False)
            if not valid:
                raise ShieldError("No hay nada que verificar para esa acción.", 404)
            return protection.issue_challenge(state.shield, purpose, target, now)

    def _verify(self, state: _CustomerState, body: dict, purpose: str, target: str, now: datetime) -> None:
        if not body.get("challenge_id") or not body.get("code"):
            raise ShieldError("Esta acción necesita tu código de verificación.", 428)
        try:
            protection.verify(state.shield, body["challenge_id"], body["code"], purpose, target, now)
        except protection.VerificationError as exc:
            raise ShieldError(str(exc), 403) from exc

    def resolve_alert(self, customer_id: str, alert_id: str, body: dict, now: datetime) -> dict:
        with self._lock:
            state = self._state(customer_id)
            alert = state.sentinel.alerts.get(alert_id)
            if alert is None:
                raise ShieldError(f"No existe la alerta {alert_id}.", 404)
            if alert["resolved_at"]:
                raise ShieldError("Esa alerta ya estaba resuelta.", 409)
            shield = state.shield
            resolution = body["resolution"]
            case = None
            if resolution == "confirmed_legit":
                self._verify(state, body, "confirm_legit", alert_id, now)
                protection.confirm_legit(shield, alert, now)
            elif resolution == "confirmed_fraud":
                related = [state.movements[i] for i in alert["related_transaction_ids"] if i in state.movements]
                disputed = [{"id": m.id, "amount_cents": m.amount_cents} for m in related if m.amount_cents < 0]
                payees = {m.payee_clabe for m in related if m.payee_clabe and m.payee_clabe not in state.own_clabes}
                case = protection.confirm_fraud(shield, alert, disputed, payees, now)
            else:
                shield.note(now, "dismissed", "Ignoraste una alerta",
                            "Las protecciones activas siguen puestas hasta que las liberes tú.")
            resolved = state.sentinel.resolve(alert_id, resolution, now)
            return {"alert": resolved, "case": case, "shield": self.shield_json(customer_id)}

    def lock_card(self, customer_id: str, now: datetime) -> dict:
        with self._lock:
            shield = self._state(customer_id).shield
            if not shield.card_locked:
                shield.card_locked = True
                shield.note(now, "card_locked", "Bloqueaste tu tarjeta", "Compras y retiros con tarjeta quedan detenidos.")
            return self.shield_json(customer_id)

    def release(self, customer_id: str, body: dict, now: datetime) -> dict:
        with self._lock:
            state = self._state(customer_id)
            self._verify(state, body, "release_protection", "shield", now)
            protection.release(state.shield, now, "Verificaste tu identidad.")
            return self.shield_json(customer_id)

    def update_settings(self, customer_id: str, body: dict, now: datetime) -> dict:
        with self._lock:
            state = self._state(customer_id)
            settings = state.shield.settings
            auto = body.get("auto_protect", settings.auto_protect)
            if settings.auto_protect and not auto:
                self._verify(state, body, "change_settings", "settings", now)
            if auto != settings.auto_protect:
                settings.auto_protect = auto
                state.shield.note(now, "settings", "Cambiaste tu protección",
                                  f"Protección automática {'activada' if auto else 'apagada'}.")
            return self.shield_json(customer_id)
