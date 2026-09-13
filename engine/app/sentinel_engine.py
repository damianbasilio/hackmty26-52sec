"""Behavioral sentinel: scores every movement as it lands.

Patterns, not single charges (anomalies_engine already covers duplicates and
per-merchant outliers): transfer bursts, merchant-category hops, large amounts
to never-seen CLABEs and fast balance drains.

Output is ShieldAlert in /contracts/types.ts: AnomalyAlert with transaction_id
set to the movement that opened the incident and the rest in
related_transaction_ids.
"""

from __future__ import annotations

from bisect import insort
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import median

from .clabe import bank_name, last_four
from .enrichment import format_mxn, to_local
from .ledger import LedgerAccount, Movement, category_label, spanish_time

# past one monthly cycle, or every first rent/supplier payment reads as a new payee
MIN_BASELINE_DAYS = 35
INCIDENT_WINDOW = timedelta(minutes=60)
VELOCITY_WINDOW = timedelta(minutes=60)
HOP_WINDOW = timedelta(minutes=30)
DRAIN_WINDOW = timedelta(hours=24)
VELOCITY_MIN_TRANSFERS = 3
HOP_MIN_CATEGORIES = 3
NEW_PAYEE_MULTIPLE = 3
NEW_PAYEE_BALANCE_SHARE = 0.20
DRAIN_BALANCE_SHARE = 0.50
DRAIN_OVER_HEAVIEST_DAY = 1.5
# a small account can be emptied without beating its payroll day
DRAIN_SEVERE_SHARE = 0.80
# per-hour shares are too thin (rent always at 12:30 is 1 row a month): use the active span
OFF_HOURS_SHARE = 0.01
OFF_HOURS_TOLERANCE = 1
OFF_HOURS_MIN_HISTORY = 50
EXTRA_SIGNAL_POINTS = 8
# charged by the merchant on its own schedule (Netflix bills at 3 AM): says nothing
# about when the customer is awake and using the account
_MERCHANT_INITIATED = {"streaming", "fitness", "telecom", "utilities", "fees"}

# which story the title tells when strengths tie
_DOMINANCE = ["balance_drain", "transfer_velocity", "new_payee", "category_hop", "off_hours"]


@dataclass(frozen=True)
class Baseline:
    ready: bool
    max_transfers_per_hour: int
    max_categories_per_30min: int
    known_payees: frozenset[str]
    known_counterparties: frozenset[str]
    known_categories: frozenset[str]
    median_transfer_out_cents: int
    heaviest_day_out_cents: int
    hour_share: dict[int, float]
    history_size: int


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _payee_key(t: Movement) -> str:
    return t.payee_clabe or t.counterparty


def _is_transfer_out(t: Movement) -> bool:
    return t.type == "transfer" and t.amount_cents < 0


def _is_usual_outflow(t: Movement, b: Baseline) -> bool:
    # transfers are identified by CLABE; everything else by merchant
    if _is_transfer_out(t):
        return _payee_key(t) in b.known_payees
    return t.counterparty in b.known_counterparties


def _max_in_window(times: list[datetime], window: timedelta) -> int:
    best, left = 0, 0
    for right, t in enumerate(times):
        while t - times[left] > window:
            left += 1
        best = max(best, right - left + 1)
    return best


def _max_distinct_in_window(items: list[tuple[datetime, str]], window: timedelta) -> int:
    best, left = 0, 0
    for right in range(len(items)):
        while items[right][0] - items[left][0] > window:
            left += 1
        best = max(best, len({c for _, c in items[left:right + 1]}))
    return best


def build_baseline(history: list[Movement]) -> Baseline:
    done = [t for t in history if t.status == "completed"]
    if not done:
        return Baseline(False, 0, 0, frozenset(), frozenset(), frozenset(), 0, 0, {}, 0)
    span_days = (done[-1].occurred_at - done[0].occurred_at).days
    transfers = [t for t in done if _is_transfer_out(t)]
    purchases = [(t.occurred_at, t.category) for t in done if t.type == "purchase"]

    day_out: dict = defaultdict(int)
    hours: dict[int, int] = defaultdict(int)
    active = [t for t in done if t.amount_cents < 0 and t.category not in _MERCHANT_INITIATED]
    for t in active:
        hours[to_local(t.occurred_at).hour] += 1
    for t in done:
        if t.amount_cents < 0:
            day_out[to_local(t.occurred_at).date()] += -t.amount_cents

    return Baseline(
        ready=span_days >= MIN_BASELINE_DAYS,
        max_transfers_per_hour=_max_in_window([t.occurred_at for t in transfers], VELOCITY_WINDOW),
        max_categories_per_30min=_max_distinct_in_window(purchases, HOP_WINDOW),
        known_payees=frozenset(_payee_key(t) for t in transfers),
        known_counterparties=frozenset(t.counterparty for t in done if t.amount_cents < 0),
        known_categories=frozenset(c for _, c in purchases),
        median_transfer_out_cents=round(median(-t.amount_cents for t in transfers)) if transfers else 0,
        heaviest_day_out_cents=max(day_out.values(), default=0),
        hour_share={h: n / len(active) for h, n in hours.items()} if active else {},
        history_size=len(active),
    )


class Sentinel:
    def __init__(self) -> None:
        self._history: dict[str, list[Movement]] = defaultdict(list)
        self._baselines: dict[tuple[str, object], Baseline] = {}
        self.alerts: dict[str, dict] = {}
        self._strengths: dict[str, dict[str, int]] = {}
        self._open: dict[str, str] = {}

    def observe(self, account: LedgerAccount, txn: Movement) -> list[tuple[str, dict]]:
        """account.balance_cents must already include txn. Returns ('created'|'updated', alert)."""
        history = self._history[account.id]
        insort(history, txn, key=lambda t: t.occurred_at)
        if txn.status != "completed" or txn.amount_cents >= 0:
            return []
        baseline = self._baseline(account.id, txn.occurred_at)
        # the usual supplier or merchant never opens or extends an incident, even mid-attack
        if not baseline.ready or _is_usual_outflow(txn, baseline):
            return []

        recent = [
            t for t in history
            if t.status == "completed" and txn.occurred_at - DRAIN_WINDOW < t.occurred_at <= txn.occurred_at
        ]
        found = [
            s for s in (
                _transfer_velocity(txn, recent, baseline),
                _category_hop(txn, recent, baseline),
                _new_payee(txn, account, baseline),
                _balance_drain(recent, account, baseline),
            )
            if s
        ]
        if not found:
            return []
        if off := _off_hours(txn, baseline):
            found.append(off)
        return [self._merge(account, txn, found)]

    def resolve(self, alert_id: str, resolution: str, now: datetime) -> dict | None:
        alert = self.alerts.get(alert_id)
        if alert is None:
            return None
        alert["resolution"] = resolution
        alert["resolved_at"] = _iso(now)
        if self._open.get(alert["account_id"]) == alert_id:
            del self._open[alert["account_id"]]
        return alert

    def _baseline(self, account_id: str, at: datetime) -> Baseline:
        # cut at the start of yesterday: an attack in progress never trains its own baseline
        cutoff_day = to_local(at).date() - timedelta(days=1)
        key = (account_id, cutoff_day)
        if key not in self._baselines:
            self._baselines[key] = build_baseline(
                [t for t in self._history[account_id] if to_local(t.occurred_at).date() < cutoff_day]
            )
        return self._baselines[key]

    def _merge(self, account: LedgerAccount, txn: Movement, found: list[dict]) -> tuple[str, dict]:
        open_id = self._open.get(account.id)
        alert = self.alerts.get(open_id) if open_id else None
        if alert and txn.occurred_at - _parse(alert["updated_at"]) > INCIDENT_WINDOW:
            alert = None

        if alert is None:
            alert = {
                "id": f"alr_shield_{txn.id}",
                "account_id": account.id,
                "transaction_id": txn.id,
                "subscription_id": None,
                "detected_at": _iso(txn.occurred_at),
                "resolved_at": None,
                "resolution": None,
                "related_transaction_ids": [],
            }
            self.alerts[alert["id"]] = alert
            self._strengths[alert["id"]] = {}
            self._open[account.id] = alert["id"]
            event = "created"
        else:
            event = "updated"

        strengths = self._strengths[alert["id"]]
        signals = {s["kind"]: s for s in alert.get("signals", [])}
        related = alert["related_transaction_ids"]
        for s in found:
            for txn_id in [*s.get("txn_ids", []), txn.id]:
                if txn_id not in related:
                    related.append(txn_id)
            if s["strength"] >= strengths.get(s["kind"], 0):
                strengths[s["kind"]] = s["strength"]
                signals[s["kind"]] = {k: v for k, v in s.items() if k not in ("strength", "txn_ids")}

        total = sum(strengths.values())
        ordered = sorted(signals.values(), key=lambda s: (-strengths[s["kind"]], _DOMINANCE.index(s["kind"])))
        for s in ordered:
            s["weight"] = round(strengths[s["kind"]] / total, 2)
        score = min(100, max(strengths.values()) + EXTRA_SIGNAL_POINTS * (len(strengths) - 1))

        title, explanation, action = _copy(ordered)
        alert.update(
            {
                "severity": "critical" if score >= 80 else "warning" if score >= 40 else "info",
                "score": score,
                "signals": ordered,
                "title": title,
                "explanation": explanation,
                "suggested_action": action,
                "updated_at": _iso(txn.occurred_at),
            }
        )
        return event, alert


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _transfer_velocity(txn: Movement, recent: list[Movement], b: Baseline) -> dict | None:
    if not _is_transfer_out(txn):
        return None
    window = [t for t in recent if _is_transfer_out(t) and t.occurred_at > txn.occurred_at - VELOCITY_WINDOW]
    threshold = max(VELOCITY_MIN_TRANSFERS, b.max_transfers_per_hour + 2)
    if len(window) < threshold:
        return None
    total = -sum(t.amount_cents for t in window)
    return {
        "kind": "transfer_velocity",
        "strength": min(100, 60 + 10 * (len(window) - threshold)),
        "label": f"{len(window)} transferencias en 60 min",
        "txn_ids": [t.id for t in window],
        "evidence": {
            "transfers_in_window": len(window),
            "window_minutes": 60,
            "total_cents": total,
            "usual_max_per_hour": b.max_transfers_per_hour,
            "distinct_payees": len({_payee_key(t) for t in window}),
        },
    }


def _category_hop(txn: Movement, recent: list[Movement], b: Baseline) -> dict | None:
    if txn.type != "purchase":
        return None
    # a stolen card shops at merchants the customer never used; the usual coffee
    # run between them is noise, not part of the hop
    window = [
        t for t in recent
        if t.type == "purchase" and t.occurred_at > txn.occurred_at - HOP_WINDOW and not _is_usual_outflow(t, b)
    ]
    sequence = list(dict.fromkeys(t.category for t in window))
    threshold = max(HOP_MIN_CATEGORIES, b.max_categories_per_30min + 2)
    if len(sequence) < threshold:
        return None
    novel = [c for c in sequence if c not in b.known_categories]
    return {
        "kind": "category_hop",
        "strength": min(100, 55 + 10 * (len(sequence) - threshold) + 8 * len(novel)),
        "label": f"{len(sequence)} giros en 30 min",
        "txn_ids": [t.id for t in window],
        "evidence": {
            "categories_in_window": len(sequence),
            "window_minutes": 30,
            "sequence": " → ".join(category_label(c) for c in sequence),
            "new_categories": len(novel),
            "total_cents": -sum(t.amount_cents for t in window),
        },
    }


def _new_payee(txn: Movement, account: LedgerAccount, b: Baseline) -> dict | None:
    if not _is_transfer_out(txn) or _payee_key(txn) in b.known_payees:
        return None
    amount = -txn.amount_cents
    balance_before = account.balance_cents + amount
    share = amount / balance_before if balance_before > 0 else 1.0
    big_vs_usual = b.median_transfer_out_cents and amount >= NEW_PAYEE_MULTIPLE * b.median_transfer_out_cents
    if share < NEW_PAYEE_BALANCE_SHARE and not big_vs_usual:
        return None
    bank = bank_name(txn.payee_clabe) if txn.payee_clabe else "banco desconocido"
    return {
        "kind": "new_payee",
        "strength": min(100, 45 + round(40 * min(1.0, share / 0.5))),
        "label": f"Destinatario nuevo en {bank}",
        "evidence": {
            "amount_cents": amount,
            "payee_bank": bank,
            "payee_last_four": last_four(txn.payee_clabe) if txn.payee_clabe else None,
            "pct_of_balance": round(share, 3),
            "usual_transfer_cents": b.median_transfer_out_cents,
        },
    }


def _balance_drain(recent: list[Movement], account: LedgerAccount, b: Baseline) -> dict | None:
    # rent, payroll and the monthly bills can take most of a thin balance; that's
    # the schedule, not a drain. Only money headed somewhere unusual counts.
    unusual = [t for t in recent if t.amount_cents < 0 and not _is_usual_outflow(t, b)]
    out = -sum(t.amount_cents for t in unusual)
    # money that came in during the window can leave too: without it the share passes 100%
    balance_then = account.balance_cents - sum(t.amount_cents for t in recent)
    available = balance_then + sum(t.amount_cents for t in recent if t.amount_cents > 0)
    if available <= 0:
        return None
    share = out / available
    if share < DRAIN_BALANCE_SHARE:
        return None
    if out < DRAIN_OVER_HEAVIEST_DAY * b.heaviest_day_out_cents and share < DRAIN_SEVERE_SHARE:
        return None
    return {
        "kind": "balance_drain",
        "strength": min(100, 70 + round(30 * min(1.0, (share - 0.5) / 0.4))),
        "label": f"{round(share * 100)}% de lo disponible en 24 h",
        "txn_ids": [t.id for t in unusual],
        "evidence": {
            "outflow_24h_cents": out,
            "available_24h_cents": available,
            "pct_of_available": round(share, 3),
            "heaviest_day_out_cents": b.heaviest_day_out_cents,
        },
    }


def _off_hours(txn: Movement, b: Baseline) -> dict | None:
    hour = to_local(txn.occurred_at).hour
    active = sorted(h for h, share in b.hour_share.items() if share >= OFF_HOURS_SHARE)
    if b.history_size < OFF_HOURS_MIN_HISTORY or not active:
        return None
    if active[0] - OFF_HOURS_TOLERANCE <= hour <= active[-1] + OFF_HOURS_TOLERANCE:
        return None
    return {
        "kind": "off_hours",
        "strength": 30,
        "label": f"A las {spanish_time(txn.occurred_at)}",
        "evidence": {
            "hour_of_day": hour,
            "usual_hours": f"{active[0]:02d}:00-{active[-1] + 1:02d}:00",
        },
    }


def _copy(signals: list[dict]) -> tuple[str, str, str]:
    lead, rest = signals[0], signals[1:]
    e = lead["evidence"]
    if lead["kind"] == "balance_drain":
        title = "Tu dinero está saliendo muy rápido"
        explanation = (
            f"En 24 horas salió el {round(e['pct_of_available'] * 100)}% de tu dinero disponible "
            f"({format_mxn(e['outflow_24h_cents'])} de {format_mxn(e['available_24h_cents'])}) hacia cuentas o "
            f"comercios que no sueles usar. Tu día más pesado antes de esto fue de {format_mxn(e['heaviest_day_out_cents'])}."
        )
        action = "Confirma si fuiste tú"
    elif lead["kind"] == "transfer_velocity":
        title = "Muchas transferencias en poco tiempo"
        explanation = (
            f"Salieron {e['transfers_in_window']} transferencias por {format_mxn(e['total_cents'])} de tu cuenta en "
            f"menos de una hora, a {e['distinct_payees']} cuenta(s). Lo máximo que habías hecho es "
            f"{e['usual_max_per_hour']} por hora."
        )
        action = "Confirma si fuiste tú"
    elif lead["kind"] == "new_payee":
        title = "Envío alto a una cuenta nueva"
        where = f"la CLABE terminada en {e['payee_last_four']} ({e['payee_bank']})" if e["payee_last_four"] else "una cuenta"
        explanation = (
            f"Salieron {format_mxn(e['amount_cents'])} a {where}, a la que nunca le habías enviado dinero. "
            f"Es el {round(e['pct_of_balance'] * 100)}% de tu saldo."
        )
        action = "Confirma si reconoces a quien recibe"
    else:
        title = f"Tu tarjeta compró en {e['categories_in_window']} giros en 30 min"
        explanation = (
            f"Hubo compras en {e['sequence']} en menos de 30 minutos; {e['new_categories']} de esos giros nunca "
            "aparecen en tu historial. Es el patrón de una tarjeta robada probando límites."
        )
        action = "Si no fuiste tú, deja tu tarjeta bloqueada"
    if rest:
        explanation += " Además: " + "; ".join(s["label"] for s in rest) + "."
    return title, explanation, action
