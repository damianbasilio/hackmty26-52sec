"""Cashflow health score: 300-850, five weighted components."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev

from .enrichment import format_mxn, normalize_merchant
from .models import Merchant, Transaction

SCORE_FLOOR = 300
SCORE_CEIL = 850
SCORE_SPAN = SCORE_CEIL - SCORE_FLOOR  # 550

FIXED_CATEGORIES = {
    "housing", "telecom", "utilities", "streaming", "fitness",
    "fees", "insurance",
}

# Component weights must sum to 1.
_WEIGHTS = {
    "income_stability": 0.25,
    "spending_discipline": 0.25,
    "buffer_days": 0.20,
    "recurring_load": 0.20,
    "overdraft_risk": 0.10,
}

_LABELS = {
    "income_stability": "Estabilidad de ingresos",
    "spending_discipline": "Disciplina de gasto",
    "buffer_days": "Colchón de días",
    "recurring_load": "Carga de pagos fijos",
    "overdraft_risk": "Riesgo de sobregiro",
}

_BAND_THRESHOLDS = [
    (580, "poor"),
    (670, "fair"),
    (740, "good"),
    (800, "very_good"),
]

BUFFER_DAYS_TARGET = 35
LATE_FEE_PENALTY = 12
OVERDRAFT_PENALTY = 40
SPENDING_GROWTH_PENALTY = 2.4
INCOME_GAP_PENALTY_PER_DAY = 6
CADENCE_DAY_GUESSES = [7, 14, 30]


def _round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def _day_start(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)


def _prior_month_start(month_start: datetime) -> datetime:
    if month_start.month == 1:
        return month_start.replace(year=month_start.year - 1, month=12)
    return month_start.replace(month=month_start.month - 1)


def _band(score: int) -> str:
    band = "excellent"
    for threshold, name in _BAND_THRESHOLDS:
        if score < threshold:
            band = name
            break
    return band


def _income_stability(deposits: list[Transaction]) -> tuple[int, str]:
    if len(deposits) < 2:
        return 50, "Muy poco historial de nómina para evaluar estabilidad."

    amounts = [d.amount_cents for d in deposits]
    amount_cv = pstdev(amounts) / mean(amounts) if mean(amounts) else 0

    gaps = [
        (b.occurred_at - a.occurred_at).days for a, b in zip(deposits, deposits[1:])
    ]
    expected_gap = min(CADENCE_DAY_GUESSES, key=lambda g: abs(g - mean(gaps)))
    mean_gap_deviation = mean(abs(g - expected_gap) for g in gaps)

    value = 100 - mean_gap_deviation * INCOME_GAP_PENALTY_PER_DAY - amount_cv * 100
    value = max(0, min(100, _round_half_up(value)))

    amount = format_mxn(round(mean(amounts)))
    explanation = f"Nómina regular de {amount} cada {expected_gap} días en los últimos {len(deposits)} depósitos."
    return value, explanation


def _spending_discipline(purchases: list[Transaction], period_end: datetime) -> tuple[int, str]:
    def variable_total(start: datetime, end: datetime) -> int:
        total = 0
        for t in purchases:
            if not (start <= t.occurred_at < end):
                continue
            guess = normalize_merchant(t.raw_description)
            if guess.category in FIXED_CATEGORIES:
                continue
            total += -t.amount_cents
        return total

    period_end_day = _day_start(period_end)
    current_start = period_end_day.replace(day=1)
    days_elapsed = (period_end_day - current_start).days + 1
    prior_start = _prior_month_start(current_start)
    prior_end = prior_start + timedelta(days=days_elapsed)

    current = variable_total(current_start, period_end_day + timedelta(days=1))
    prior = variable_total(prior_start, prior_end)

    if prior == 0:
        value = 80 if current == 0 else 60
        explanation = "Sin gasto variable comparable del periodo anterior."
        return value, explanation

    growth_percent = (current - prior) / prior * 100
    value = max(0, min(100, _round_half_up(100 - growth_percent * SPENDING_GROWTH_PENALTY)))

    if growth_percent >= 0:
        explanation = f"Gasto variable subió {round(growth_percent)}% contra el periodo anterior."
    else:
        explanation = f"Gasto variable bajó {round(-growth_percent)}% contra el periodo anterior."
    return value, explanation


def _buffer_days(balance_cents: int, all_out: list[Transaction], period_end: datetime) -> tuple[int, str]:
    period_end_day = _day_start(period_end)
    month_start = period_end_day.replace(day=1)
    days_elapsed = (period_end_day - month_start).days + 1
    month_end = period_end_day + timedelta(days=1)
    month_spend = sum(-t.amount_cents for t in all_out if month_start <= t.occurred_at < month_end)
    if month_spend <= 0:
        return 100, "Sin gasto registrado este mes; tu colchón cubre todo."

    daily_spend = month_spend / days_elapsed
    buffer_days = balance_cents / daily_spend
    value = max(0, min(100, _round_half_up(100 * buffer_days / BUFFER_DAYS_TARGET)))
    explanation = (
        f"Tu saldo cubre {round(buffer_days)} días de gasto promedio; la meta sana son 30."
    )
    return value, explanation


def _recurring_load(
    transactions: list[Transaction], merchants: dict[str, Merchant], monthly_income_cents: int
) -> tuple[int, str]:
    latest_by_merchant: dict[str, int] = {}
    for t in sorted(transactions, key=lambda t: t.occurred_at):
        if t.type not in ("purchase", "transfer", "fee") or t.status != "completed":
            continue
        guess = normalize_merchant(t.raw_description)
        merchant = merchants.get(guess.normalized_name)
        is_recurring = merchant.is_recurring_biller if merchant else guess.is_recurring_biller
        if not is_recurring:
            continue
        latest_by_merchant[guess.normalized_name] = -t.amount_cents

    recurring_total = sum(latest_by_merchant.values())
    if monthly_income_cents <= 0:
        return 0, "Sin ingreso detectado para calcular carga de pagos fijos."

    percent = recurring_total / monthly_income_cents * 100
    value = max(0, min(100, _round_half_up(percent)))
    explanation = f"Renta y suscripciones se llevan {round(percent)}% de tu ingreso mensual."
    return value, explanation


def _overdraft_risk(transactions: list[Transaction], balance_cents: int) -> tuple[int, str]:
    fee_count = sum(1 for t in transactions if t.type == "fee" and t.status == "completed")
    overdraft_count = sum(1 for t in transactions if t.status == "cancelled")
    value = max(0, min(100, 100 - fee_count * LATE_FEE_PENALTY - overdraft_count * OVERDRAFT_PENALTY))
    if overdraft_count == 0:
        explanation = (
            f"Cero sobregiros y {fee_count} comisión(es) por manejo de cuenta en el periodo."
            if fee_count
            else "Cero sobregiros y cero comisiones en el periodo."
        )
    else:
        explanation = f"{overdraft_count} sobregiro(s) detectados en el periodo."
    return value, explanation


def compute_score(
    account_id: str,
    transactions: list[Transaction],
    merchants: dict[str, Merchant],
    balance_cents: int,
    period_start: datetime,
    period_end: datetime,
    previous_score: int | None,
) -> dict:
    deposits = sorted(
        (t for t in transactions if t.type == "deposit" and t.status == "completed"),
        key=lambda t: t.occurred_at,
    )
    purchases = [t for t in transactions if t.type == "purchase" and t.status == "completed"]
    all_out = [t for t in transactions if t.amount_cents < 0 and t.status == "completed"]

    monthly_income_cents = round(mean(d.amount_cents for d in deposits)) * 2 if deposits else 0

    income_value, income_expl = _income_stability(deposits)
    spending_value, spending_expl = _spending_discipline(purchases, period_end)
    buffer_value, buffer_expl = _buffer_days(balance_cents, all_out, period_end)
    recurring_value, recurring_expl = _recurring_load(transactions, merchants, monthly_income_cents)
    overdraft_value, overdraft_expl = _overdraft_risk(transactions, balance_cents)

    raw = {
        "income_stability": (income_value, income_expl),
        "spending_discipline": (spending_value, spending_expl),
        "buffer_days": (buffer_value, buffer_expl),
        "recurring_load": (recurring_value, recurring_expl),
        "overdraft_risk": (overdraft_value, overdraft_expl),
    }

    components = []
    total_points = 0
    for key, (value, explanation) in raw.items():
        weight = _WEIGHTS[key]
        points = _round_half_up(value * weight * SCORE_SPAN / 100)
        total_points += points
        components.append(
            {
                "key": key,
                "label": _LABELS[key],
                "value": value,
                "weight": weight,
                "points": points,
                "explanation": explanation,
            }
        )

    score = max(SCORE_FLOOR, min(SCORE_CEIL, SCORE_FLOOR + total_points))
    band = _band(score)

    weakest = min(components, key=lambda c: c["value"] * c["weight"])
    top_actions = _top_actions(raw)

    return {
        "id": f"cfs_{account_id}_{period_end.date().isoformat()}",
        "account_id": account_id,
        "score": score,
        "previous_score": previous_score,
        "band": band,
        "components": components,
        "explanation": _summary(score, band, weakest),
        "top_actions": top_actions,
        "period_start": period_start.date().isoformat(),
        "period_end": period_end.date().isoformat(),
        "computed_at": _iso(period_end),
    }


def _summary(score: int, band: str, weakest: dict) -> str:
    return (
        f"Tu salud financiera está en {_band_es(band)}. El área que más te resta puntos ahora es "
        f"{weakest['label'].lower()}; mejorarla es lo que más rápido te sube de banda."
    )


def _band_es(band: str) -> str:
    return {
        "poor": "un momento delicado",
        "fair": "un punto razonable",
        "good": "buen camino",
        "very_good": "muy buen camino",
        "excellent": "excelente forma",
    }[band]


def _top_actions(raw: dict[str, tuple[int, str]]) -> list[str]:
    ranked = sorted(raw.items(), key=lambda kv: kv[1][0])
    actions = []
    for key, _ in ranked[:3]:
        if key == "recurring_load":
            actions.append("Revisar y cancelar suscripciones que no uses para bajar tus pagos fijos.")
        elif key == "buffer_days":
            actions.append("Automatizar una transferencia periódica a tu cuenta de ahorro.")
        elif key == "spending_discipline":
            actions.append("Poner un tope mensual a tus categorías de gasto variable más altas.")
        elif key == "overdraft_risk":
            actions.append("Configurar una alerta de saldo bajo para evitar comisiones.")
        elif key == "income_stability":
            actions.append("Registrar todos tus ingresos para que el score refleje tu nómina real.")
    return actions


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
