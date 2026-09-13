"""My money in 30 days: personal cashflow forecast and advice the customer can act on.

Deterministic on purpose: every number traces back to movements in the ledger,
so the app can always answer "¿por qué me dices que me faltan $1,200?".

Response shape: CashflowForecast in /contracts/types.ts.
"""

from __future__ import annotations

import math
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from statistics import mean, median, pstdev

from .enrichment import format_mxn, to_local
from .ledger import (
    ESSENTIAL_CATEGORIES,
    INCOME_CATEGORIES,
    PAUSABLE_CATEGORIES,
    LedgerAccount,
    Movement,
    category_label,
    spanish_day,
)

HORIZON_DAYS = 30
BASELINE_DAYS = 56  # eight samples per weekday
MIN_BASELINE_DAYS = 14
MIN_OCCURRENCES = 3
MAX_AMOUNT_CV = 0.35
Z_LOW = 1.28  # lower band ~ P10 of cumulative variable flow
BUFFER_DAYS = 7
ROUND_CENTS = 10_000  # advice in whole hundreds of pesos
MIN_SPEND_WINDOW_DAYS = 7
SAVE_MAX_SHARE_OF_BALANCE = 0.30
CREEP_MIN_PREV_CENTS = 50_000
CREEP_THRESHOLD = 0.20

_STEP_DAYS = {"weekly": 7, "biweekly": 14, "semimonthly": 15, "monthly": 30}
_MONTHLY_FACTOR = {"weekly": 30 / 7, "biweekly": 30 / 14, "semimonthly": 2, "monthly": 1}
_CADENCE_ES = {"weekly": "semanal", "biweekly": "catorcenal", "semimonthly": "quincenal", "monthly": "mensual"}


@dataclass(frozen=True)
class Stream:
    label: str
    category: str
    cadence: str
    # signed: negative = money out
    amount_cents: int
    # day-of-month anchors for semimonthly/monthly; 31 means "last day"
    anchors: tuple[int, ...]
    last_date: date
    txn_ids: frozenset[str]

    @property
    def monthly_cents(self) -> int:
        return round(self.amount_cents * _MONTHLY_FACTOR[self.cadence])

    def dates_between(self, start: date, end: date) -> list[date]:
        if self.cadence in ("weekly", "biweekly"):
            step = timedelta(days=_STEP_DAYS[self.cadence])
            out, d = [], self.last_date + step
            while d <= end:
                if d >= start:
                    out.append(d)
                d += step
            return out
        out, y, m = [], start.year, start.month
        while date(y, m, 1) <= end:
            for anchor in self.anchors:
                d = date(y, m, min(anchor, monthrange(y, m)[1]))
                if start <= d <= end and d > self.last_date:
                    out.append(d)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        return sorted(out)


def local_date(dt: datetime) -> date:
    return to_local(dt).date()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _floor_round(cents: int) -> int:
    return max(0, cents) // ROUND_CENTS * ROUND_CENTS


def _anchor_groups(days_of_month: list[int]) -> list[int]:
    # 28-31 collapse to "month end" so a payroll on the last day is one anchor
    values = sorted(31 if d >= 28 else d for d in days_of_month)
    groups: list[list[int]] = [[values[0]]]
    for v in values[1:]:
        if v - groups[-1][-1] <= 3:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [31 if median(g) >= 28 else round(median(g)) for g in groups]


def detect_streams(movements: list[Movement], as_of: date) -> list[Stream]:
    groups: dict[tuple[str, bool], list[Movement]] = defaultdict(list)
    for t in movements:
        if t.status == "completed":
            groups[(t.counterparty, t.amount_cents > 0)].append(t)

    streams = []
    for txns in groups.values():
        if len(txns) < MIN_OCCURRENCES:
            continue
        txns.sort(key=lambda t: t.occurred_at)
        days = [local_date(t.occurred_at) for t in txns]
        gap = median((b - a).days for a, b in zip(days, days[1:]))
        amounts = [abs(t.amount_cents) for t in txns]
        if pstdev(amounts) / mean(amounts) > MAX_AMOUNT_CV:
            continue

        anchors: tuple[int, ...] = ()
        if 6 <= gap <= 8:
            cadence = "weekly"
        elif 13 <= gap <= 17:
            by_day = _anchor_groups([d.day for d in days])
            cadence = "semimonthly" if len(by_day) == 2 else "biweekly"
            anchors = tuple(by_day) if cadence == "semimonthly" else ()
        elif 27 <= gap <= 33:
            cadence = "monthly"
            anchors = (_anchor_groups([d.day for d in days])[0],)
        else:
            continue
        # a stream that skipped more than half a cycle has probably stopped
        if (as_of - days[-1]).days > 1.5 * _STEP_DAYS[cadence]:
            continue

        sign = 1 if txns[-1].amount_cents > 0 else -1
        streams.append(
            Stream(
                label=txns[-1].display_name,
                category=txns[-1].category,
                cadence=cadence,
                amount_cents=sign * round(median(amounts[-3:])),
                anchors=anchors,
                last_date=days[-1],
                txn_ids=frozenset(t.id for t in txns),
            )
        )
    return sorted(streams, key=lambda s: s.amount_cents)


@dataclass(frozen=True)
class _Profile:
    inflow: dict[int, int]
    outflow: dict[int, int]
    sigma: float


def _weekday_profile(movements: list[Movement], streams: list[Stream], as_of: date) -> _Profile:
    recurring = set().union(*(s.txn_ids for s in streams)) if streams else set()
    completed = [t for t in movements if t.status == "completed"]
    first = min((local_date(t.occurred_at) for t in completed), default=as_of)
    span = max(MIN_BASELINE_DAYS, min(BASELINE_DAYS, (as_of - first).days))
    dates = [as_of - timedelta(days=i) for i in range(span, 0, -1)]  # today is partial

    day_in: dict[date, int] = defaultdict(int)
    day_out: dict[date, int] = defaultdict(int)
    for t in completed:
        if t.id in recurring:
            continue
        d = local_date(t.occurred_at)
        if t.amount_cents > 0:
            day_in[d] += t.amount_cents
        else:
            day_out[d] += -t.amount_cents

    by_wd_in: dict[int, list[int]] = defaultdict(list)
    by_wd_out: dict[int, list[int]] = defaultdict(list)
    for d in dates:
        by_wd_in[d.weekday()].append(day_in[d])
        by_wd_out[d.weekday()].append(day_out[d])
    inflow = {wd: round(mean(v)) for wd, v in by_wd_in.items()}
    outflow = {wd: round(mean(v)) for wd, v in by_wd_out.items()}
    residuals = [(day_in[d] - day_out[d]) - (inflow[d.weekday()] - outflow[d.weekday()]) for d in dates]
    return _Profile(inflow, outflow, pstdev(residuals) if len(residuals) > 1 else 0.0)


def _project(balance_cents: int, streams: list[Stream], profile: _Profile, as_of: date, horizon_days: int) -> list[dict]:
    start, end = as_of + timedelta(days=1), as_of + timedelta(days=horizon_days)
    events_by_day: dict[date, list[dict]] = defaultdict(list)
    for s in streams:
        for d in s.dates_between(start, end):
            events_by_day[d].append({"label": s.label, "category": s.category, "amount_cents": s.amount_cents})

    daily, expected = [], balance_cents
    for i in range(1, horizon_days + 1):
        d = as_of + timedelta(days=i)
        events = events_by_day.get(d, [])
        inflow = profile.inflow.get(d.weekday(), 0) + sum(e["amount_cents"] for e in events if e["amount_cents"] > 0)
        outflow = profile.outflow.get(d.weekday(), 0) - sum(e["amount_cents"] for e in events if e["amount_cents"] < 0)
        expected += inflow - outflow
        band = round(Z_LOW * profile.sigma * math.sqrt(i))
        daily.append(
            {
                "date": d.isoformat(),
                "expected_balance_cents": expected,
                "low_balance_cents": expected - band,
                "high_balance_cents": expected + band,
                "inflow_cents": inflow,
                "outflow_cents": outflow,
                "events": events,
            }
        )
    return daily


def build_forecast(
    account: LedgerAccount,
    movements: list[Movement],
    now: datetime,
    savings: list[LedgerAccount] = (),
    horizon_days: int = HORIZON_DAYS,
) -> dict:
    as_of = local_date(now)
    streams = detect_streams(movements, as_of)
    profile = _weekday_profile(movements, streams, as_of)
    balance = account.balance_cents
    daily = _project(balance, streams, profile, as_of, horizon_days)

    completed = [t for t in movements if t.status == "completed"]
    last30 = [t for t in completed if as_of - timedelta(days=30) <= local_date(t.occurred_at) < as_of]
    prev30 = [t for t in completed if as_of - timedelta(days=60) <= local_date(t.occurred_at) < as_of - timedelta(days=30)]
    avg_daily_out = sum(-t.amount_cents for t in last30 if t.amount_cents < 0) / 30
    buffer_cents = round(avg_daily_out * BUFFER_DAYS)

    min_expected = min(daily, key=lambda d: d["expected_balance_cents"])
    min_low = min(daily, key=lambda d: d["low_balance_cents"])
    shortfall = next((d for d in daily if d["low_balance_cents"] < buffer_cents), None)
    payday = next(
        (d for d in daily for e in d["events"] if e["amount_cents"] > 0 and e["category"] in INCOME_CATEGORIES), None
    )
    safe_to_spend, spend_days, spend_until = _safe_to_spend(daily, balance, buffer_cents)

    low = min_low["low_balance_cents"]
    low_day = spanish_day(date.fromisoformat(min_low["date"]))
    if low < 0:
        status = "critical"
        status_explanation = f"Si gastas como de costumbre, tu saldo podría quedar en {format_mxn(low)} el {low_day}."
    elif shortfall:
        status = "watch"
        status_explanation = (
            f"Tu saldo podría bajar a {format_mxn(low)} el {low_day}, menos de lo que gastas en {BUFFER_DAYS} días."
        )
    else:
        status = "healthy"
        status_explanation = f"Aun con un mes de gasto alto, tu saldo no bajaría de {format_mxn(low)}."

    spending = _spending(last30, prev30, streams)
    return {
        "account_id": account.id,
        "generated_at": _iso(now),
        "as_of": as_of.isoformat(),
        "horizon_days": horizon_days,
        "currency": "MXN",
        "start_balance_cents": balance,
        "buffer_cents": buffer_cents,
        "status": status,
        "status_explanation": status_explanation,
        "summary": {
            "safe_to_spend_daily_cents": safe_to_spend,
            "safe_to_spend_days": spend_days,
            "safe_to_spend_until": spend_until,
            "next_income_on": payday["date"] if payday else None,
            "next_income_cents": sum(
                e["amount_cents"] for e in payday["events"] if e["amount_cents"] > 0 and e["category"] in INCOME_CATEGORIES
            ) if payday else None,
            "min_expected_balance_cents": min_expected["expected_balance_cents"],
            "min_expected_on": min_expected["date"],
            "min_low_balance_cents": low,
            "min_low_on": min_low["date"],
            "end_expected_balance_cents": daily[-1]["expected_balance_cents"],
            "first_shortfall_on": shortfall["date"] if shortfall else None,
        },
        "daily": daily,
        "streams": [
            {
                "label": s.label,
                "category": s.category,
                "category_label": category_label(s.category),
                "cadence": s.cadence,
                "cadence_label": _CADENCE_ES[s.cadence],
                "amount_cents": s.amount_cents,
                "monthly_cents": s.monthly_cents,
            }
            for s in streams
        ],
        "spending": spending,
        "recommendations": _recommendations(account, savings, daily, as_of, buffer_cents, shortfall, min_low, payday, spending),
    }


def _safe_to_spend(daily: list[dict], balance: int, buffer_cents: int) -> tuple[int, int, str | None]:
    """Per-day budget for variable spending, after every scheduled payment and the buffer.

    The window ends at the first income at least a week away: a payroll due tomorrow
    would make one day look like it can take the whole balance.
    """
    incomes = [d["date"] for i, d in enumerate(daily) if i >= MIN_SPEND_WINDOW_DAYS - 1
               and any(e["amount_cents"] > 0 and e["category"] in INCOME_CATEGORIES for e in d["events"])]
    until = incomes[0] if incomes else None
    window = [d for d in daily if until is None or d["date"] < until]
    scheduled = sum(e["amount_cents"] for d in window for e in d["events"])
    return max(0, (balance + scheduled - buffer_cents) // len(window)), len(window), until


def _spending(last30: list[Movement], prev30: list[Movement], streams: list[Stream]) -> dict:
    recurring = set().union(*(s.txn_ids for s in streams)) if streams else set()
    recurring_categories = {s.category for s in streams if s.amount_cents < 0}

    def by_category(txns: list[Movement]) -> dict[str, int]:
        totals: dict[str, int] = defaultdict(int)
        for t in txns:
            if t.amount_cents < 0 and t.category != "transfer":
                totals[t.category] += -t.amount_cents
        return totals

    now_cat, prev_cat = by_category(last30), by_category(prev30)
    income = sum(t.amount_cents for t in last30 if t.amount_cents > 0 and t.category in INCOME_CATEGORIES)
    recurring_monthly = -sum(s.monthly_cents for s in streams if s.amount_cents < 0)
    return {
        "income_30d_cents": income,
        "recurring_monthly_cents": recurring_monthly,
        "variable_30d_cents": sum(-t.amount_cents for t in last30 if t.amount_cents < 0 and t.id not in recurring),
        "recurring_ratio": round(recurring_monthly / income, 3) if income else None,
        "categories": [
            {
                "category": cat,
                "label": category_label(cat),
                "last_30d_cents": total,
                "prev_30d_cents": prev_cat.get(cat, 0),
                "change_pct": round((total - prev_cat[cat]) / prev_cat[cat], 3) if prev_cat.get(cat) else None,
                "is_recurring": cat in recurring_categories,
            }
            for cat, total in sorted(now_cat.items(), key=lambda kv: -kv[1])
        ],
    }


def _recommendations(
    account: LedgerAccount,
    savings: list[LedgerAccount],
    daily: list[dict],
    as_of: date,
    buffer_cents: int,
    shortfall: dict | None,
    min_low: dict,
    payday: dict | None,
    spending: dict,
) -> list[dict]:
    recs = []
    low = min_low["low_balance_cents"]
    low_day = date.fromisoformat(min_low["date"])
    pocket = max(savings, key=lambda a: a.balance_cents, default=None)

    if shortfall:
        gap = math.ceil((buffer_cents - low) / ROUND_CENTS) * ROUND_CENTS
        due = max(as_of + timedelta(days=1), date.fromisoformat(shortfall["date"]) - timedelta(days=1))
        payday_note = f", antes de tu nómina del {spanish_day(date.fromisoformat(payday['date']))}" if payday and payday["date"] > min_low["date"] else ""
        movable = min(gap, _floor_round(pocket.balance_cents)) if pocket else 0
        if movable > 0:
            short = gap - movable
            recs.append(
                {
                    "id": "cover_from_savings",
                    "kind": "cover_from_savings",
                    "priority": "high" if low < 0 else "medium",
                    "title": f"Pasa {format_mxn(movable)} de {pocket.nickname} antes del {spanish_day(due)}",
                    "explanation": (
                        f"Si no, tu saldo podría bajar a {format_mxn(low)} el {spanish_day(low_day)}{payday_note}."
                        + (f" Aun así te faltarían {format_mxn(short)}: revisa qué puedes pausar." if short > 0 else "")
                    ),
                    "amount_cents": movable,
                    "due_on": due.isoformat(),
                    "impact_cents": movable,
                    "action": {
                        "type": "move_money",
                        "label": f"Pasar {format_mxn(movable)}",
                        "from_account_id": pocket.id,
                        "to_account_id": account.id,
                        "amount_cents": movable,
                    },
                }
            )
        else:
            recs.append(
                {
                    "id": "shortfall_warning",
                    "kind": "shortfall_warning",
                    "priority": "high" if low < 0 else "medium",
                    "title": f"Te podrían faltar {format_mxn(gap)} antes del {spanish_day(due)}",
                    "explanation": f"Tu saldo podría bajar a {format_mxn(low)} el {spanish_day(low_day)}{payday_note}.",
                    "amount_cents": gap,
                    "due_on": due.isoformat(),
                    "impact_cents": gap,
                    "action": None,
                }
            )

        pausable: dict[str, int] = defaultdict(int)
        for d in daily:
            if d["date"] > min_low["date"]:
                break
            for e in d["events"]:
                if e["amount_cents"] < 0 and e["category"] in PAUSABLE_CATEGORIES:
                    pausable[e["label"]] += -e["amount_cents"]
        if pausable:
            total = sum(pausable.values())
            names = ", ".join(pausable)
            recs.append(
                {
                    "id": "pause_before_low",
                    "kind": "pause_before_low",
                    "priority": "medium",
                    "title": f"Pausa {names} este mes",
                    "explanation": (
                        f"Se cobran {format_mxn(total)} antes de tu punto más bajo del {spanish_day(low_day)}. "
                        "Pausarlos sube tu saldo mínimo en esa misma cantidad."
                    ),
                    "amount_cents": total,
                    "due_on": None,
                    "impact_cents": total,
                    "action": {"type": "open_subscriptions", "label": "Ver suscripciones"},
                }
            )
    elif pocket and low > 2 * buffer_cents:
        keep = round(buffer_cents * 1.5)
        amount = min(_floor_round(low - keep), _floor_round(round(account.balance_cents * SAVE_MAX_SHARE_OF_BALANCE)))
        if amount > 0:
            recs.append(
                {
                    "id": "safe_to_save",
                    "kind": "safe_to_save",
                    "priority": "low",
                    "title": f"Puedes apartar {format_mxn(amount)} hoy",
                    "explanation": (
                        f"Aun con un mes de gasto alto tu saldo no bajaría de {format_mxn(low)}. Apartar esto a "
                        f"{pocket.nickname} te deja más de {format_mxn(keep)} para imprevistos."
                    ),
                    "amount_cents": amount,
                    "due_on": None,
                    "impact_cents": amount,
                    "action": {
                        "type": "move_money",
                        "label": f"Apartar {format_mxn(amount)}",
                        "from_account_id": account.id,
                        "to_account_id": pocket.id,
                        "amount_cents": amount,
                    },
                }
            )

    creeping = [
        c for c in spending["categories"]
        if c["category"] not in ESSENTIAL_CATEGORIES | INCOME_CATEGORIES
        and not c["is_recurring"]
        and c["prev_30d_cents"] >= CREEP_MIN_PREV_CENTS
        and (c["change_pct"] or 0) >= CREEP_THRESHOLD
    ]
    for c in sorted(creeping, key=lambda c: -(c["last_30d_cents"] - c["prev_30d_cents"]))[:2]:
        extra = c["last_30d_cents"] - c["prev_30d_cents"]
        recs.append(
            {
                "id": f"spending_creep:{c['category']}",
                "kind": "spending_creep",
                "priority": "low",
                "title": f"{c['label']}: +{round(c['change_pct'] * 100)}% este mes",
                "explanation": (
                    f"Llevas {format_mxn(c['last_30d_cents'])} en 30 días contra {format_mxn(c['prev_30d_cents'])} "
                    f"en los 30 anteriores. Volver a tu ritmo te deja {format_mxn(extra)} al mes."
                ),
                "amount_cents": extra,
                "due_on": None,
                "impact_cents": extra,
                "action": None,
            }
        )
    return recs
