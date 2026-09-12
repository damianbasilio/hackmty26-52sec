"""Subscription detection: cadence + stable amount + minimum occurrences."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from .enrichment import format_mxn, normalize_merchant, spanish_month_name
from .models import Merchant, Transaction

MIN_OCCURRENCES = 3
CONFIDENCE_BASE = 0.7
CONFIDENCE_PER_OCCURRENCE = 0.09
CONFIDENCE_CAP = 0.99

# (cadence, min_days, max_days): a gap qualifies for a cadence when it falls
# in this range. All gaps for a merchant must land in the *same* bucket.
_CADENCE_RANGES: list[tuple[str, int, int]] = [
    ("weekly", 5, 9),
    ("biweekly", 10, 18),
    ("monthly", 25, 35),
    ("bimonthly", 50, 70),
    ("quarterly", 80, 100),
    ("annual", 350, 380),
]

_OCCURRENCES_PER_YEAR = {
    "weekly": 52,
    "biweekly": 26,
    "monthly": 12,
    "bimonthly": 6,
    "quarterly": 4,
    "annual": 1,
}

_CADENCE_LABEL = {
    "weekly": "semanal",
    "biweekly": "quincenal",
    "monthly": "mensual",
    "bimonthly": "bimestral",
    "quarterly": "trimestral",
    "annual": "anual",
}

_CADENCE_UNIT_PLURAL = {
    "weekly": "semanas",
    "biweekly": "quincenas",
    "monthly": "meses",
    "bimonthly": "bimestres",
    "quarterly": "trimestres",
    "annual": "años",
}


def _cadence_bucket(gap_days: float) -> str | None:
    for cadence, low, high in _CADENCE_RANGES:
        if low <= gap_days <= high:
            return cadence
    return None


def _add_cadence(occurred_at: datetime, cadence: str) -> datetime:
    if cadence == "weekly":
        return occurred_at + timedelta(days=7)
    if cadence == "biweekly":
        return occurred_at + timedelta(days=14)
    if cadence == "quarterly":
        return _add_months(occurred_at, 3)
    if cadence == "bimonthly":
        return _add_months(occurred_at, 2)
    if cadence == "annual":
        return _add_months(occurred_at, 12)
    return _add_months(occurred_at, 1)


def _add_months(occurred_at: datetime, months: int) -> datetime:
    month_index = occurred_at.month - 1 + months
    year = occurred_at.year + month_index // 12
    month = month_index % 12 + 1
    day = min(occurred_at.day, calendar.monthrange(year, month)[1])
    return occurred_at.replace(year=year, month=month, day=day)


def _explanation(
    *,
    cadence: str,
    amount_cents: int,
    occurrence_count: int,
    price_increase_detected: bool,
    previous_amount_cents: int | None,
    status: str,
    last_charge_at: datetime,
    first_charge_at: datetime,
) -> str:
    label = _CADENCE_LABEL[cadence]
    day = last_charge_at.day
    if price_increase_detected:
        return (
            f"Cargo {label} detectado los días {day} de cada mes; el último subió "
            f"de {format_mxn(previous_amount_cents)} a {format_mxn(amount_cents)}."
        )
    if status == "unused":
        return (
            f"Cargo {label} constante de {format_mxn(amount_cents)} los días {day}, "
            f"pero no vemos gastos cerca del gimnasio desde {spanish_month_name(first_charge_at)}."
        )
    unit = _CADENCE_UNIT_PLURAL[cadence]
    return (
        f"Cargo {label} constante de {format_mxn(amount_cents)} detectado en "
        f"{occurrence_count} {unit} seguidos."
    )


def detect_subscriptions(
    account_id: str,
    transactions: list[Transaction],
    merchants: dict[str, Merchant],
    existing_ids: dict[tuple[str, str], str] | None = None,
) -> list[dict]:
    existing_ids = existing_ids or {}
    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for txn in transactions:
        if txn.type != "purchase" or txn.status != "completed":
            continue
        guess = normalize_merchant(txn.raw_description)
        by_merchant[guess.normalized_name].append(txn)

    subscriptions: list[dict] = []
    for normalized_name, txns in by_merchant.items():
        merchant = merchants.get(normalized_name)
        if merchant is None or len(txns) < MIN_OCCURRENCES:
            continue

        txns = sorted(txns, key=lambda t: t.occurred_at)
        gaps = [
            (b.occurred_at - a.occurred_at).total_seconds() / 86400
            for a, b in zip(txns, txns[1:])
        ]
        buckets = {_cadence_bucket(g) for g in gaps}
        if len(buckets) != 1 or None in buckets:
            continue
        cadence = buckets.pop()

        amounts = [-t.amount_cents for t in txns]  # magnitudes; purchases are negative
        if any(a != amounts[0] for a in amounts[:-1]):
            continue  # every charge but the last must match — no erratic pricing

        amount_cents = amounts[-1]
        previous_amount_cents = amounts[-2] if amounts[-1] != amounts[-2] else None
        price_delta_cents = (
            amount_cents - previous_amount_cents if previous_amount_cents is not None else None
        )
        price_increase_detected = bool(price_delta_cents and price_delta_cents > 0)

        occurrence_count = len(txns)
        confidence = round(
            min(CONFIDENCE_CAP, CONFIDENCE_BASE + CONFIDENCE_PER_OCCURRENCE * occurrence_count),
            2,
        )

        if price_increase_detected:
            status = "price_increased"
        elif merchant.category == "fitness":
            # gym charges have no independent usage signal in our data —
            # flag them so the user can confirm they're still going.
            status = "unused"
        else:
            status = "active"

        last_charge_at = txns[-1].occurred_at
        first_charge_at = txns[0].occurred_at
        next_charge_on = _add_cadence(last_charge_at, cadence).date().isoformat()

        sub_id = existing_ids.get((merchant.id, cadence), f"sub_{account_id}_{merchant.id}_{cadence}")
        subscriptions.append(
            {
                "id": sub_id,
                "account_id": account_id,
                "merchant_id": merchant.id,
                "merchant_display_name": merchant.display_name,
                "category": merchant.category,
                "cadence": cadence,
                "amount_cents": amount_cents,
                "previous_amount_cents": previous_amount_cents,
                "price_delta_cents": price_delta_cents,
                "price_increase_detected": price_increase_detected,
                "first_charge_at": _iso(first_charge_at),
                "last_charge_at": _iso(last_charge_at),
                "next_charge_on": next_charge_on,
                "occurrence_count": occurrence_count,
                "confidence": confidence,
                "status": status,
                "annual_cost_cents": amount_cents * _OCCURRENCES_PER_YEAR[cadence],
                "explanation": _explanation(
                    cadence=cadence,
                    amount_cents=amount_cents,
                    occurrence_count=occurrence_count,
                    price_increase_detected=price_increase_detected,
                    previous_amount_cents=previous_amount_cents,
                    status=status,
                    last_charge_at=last_charge_at,
                    first_charge_at=first_charge_at,
                ),
            }
        )

    subscriptions.sort(key=lambda s: s["next_charge_on"])
    return subscriptions


def reconcile_with_bills(
    account_id: str,
    subscriptions: list[dict],
    bills: list[dict],
    merchants: dict[str, Merchant],
    transactions: list[Transaction],
    existing_ids: dict[tuple[str, str], str],
    today: date,
) -> list[dict]:
    """A bill is the bank's own record of a recurring payment, so it outranks cadence.

    `bills` come from bills.py already in cents. Every subscription comes back
    labelled in its explanation: confirmed by a bill, or inferred from history.
    A bill with no detected subscription becomes one on its own.
    """
    merchants_by_id = {m.id: m for m in merchants.values()}
    bills_by_merchant: dict[str, dict] = {}
    for bill in bills:
        merchant = merchants.get(normalize_merchant(bill["payee"]).normalized_name)
        if merchant is not None:
            bills_by_merchant.setdefault(merchant.id, bill)

    reconciled = []
    for sub in subscriptions:
        bill = bills_by_merchant.pop(sub["merchant_id"], None)
        if bill is None:
            reconciled.append(
                {
                    **sub,
                    "explanation": "Inferida de tu historial: no hay un pago domiciliado que la "
                    f"confirme. {sub['explanation']}",
                }
            )
            continue
        explanation = (
            f"Confirmada: tu banco tiene un pago domiciliado a {bill['payee']} por "
            f"{format_mxn(bill['amount_cents'])}. {sub['explanation']}"
        )
        if bill["amount_cents"] != sub["amount_cents"]:
            explanation += (
                f" Ojo: lo domiciliado ({format_mxn(bill['amount_cents'])}) no coincide con el "
                f"último cobro ({format_mxn(sub['amount_cents'])})."
            )
        reconciled.append(
            {
                **sub,
                "confidence": CONFIDENCE_CAP,
                "next_charge_on": bill["next_payment_on"] or sub["next_charge_on"],
                "explanation": explanation,
            }
        )

    for merchant_id, bill in bills_by_merchant.items():
        reconciled.append(
            _subscription_from_bill(
                account_id, merchants_by_id[merchant_id], bill, transactions, existing_ids, today
            )
        )

    reconciled.sort(key=lambda s: s["next_charge_on"])
    return reconciled


def _subscription_from_bill(
    account_id: str,
    merchant: Merchant,
    bill: dict,
    transactions: list[Transaction],
    existing_ids: dict[tuple[str, str], str],
    today: date,
) -> dict:
    charges = sorted(
        (
            t
            for t in transactions
            if t.type == "purchase"
            and t.status == "completed"
            and normalize_merchant(t.raw_description).normalized_name == merchant.normalized_name
        ),
        key=lambda t: t.occurred_at,
    )
    fallback_day = bill["last_paid_on"] or bill["first_on"] or today.isoformat()
    first_charge_at = charges[0].occurred_at if charges else _day_start(bill["first_on"] or fallback_day)
    last_charge_at = charges[-1].occurred_at if charges else _day_start(fallback_day)
    next_charge_on = bill["next_payment_on"] or _next_monthly_day(bill["recurring_day"], today)
    amount_cents = bill["amount_cents"]
    # Nessie bills recur on a day of the month, so their cadence is always monthly.
    return {
        "id": existing_ids.get((merchant.id, "monthly"), f"sub_{account_id}_{merchant.id}_monthly"),
        "account_id": account_id,
        "merchant_id": merchant.id,
        "merchant_display_name": merchant.display_name,
        "category": merchant.category,
        "cadence": "monthly",
        "amount_cents": amount_cents,
        "previous_amount_cents": None,
        "price_delta_cents": None,
        "price_increase_detected": False,
        "first_charge_at": _iso(first_charge_at),
        "last_charge_at": _iso(last_charge_at),
        "next_charge_on": next_charge_on,
        "occurrence_count": len(charges),
        "confidence": CONFIDENCE_CAP,
        "status": "active",
        "annual_cost_cents": amount_cents * _OCCURRENCES_PER_YEAR["monthly"],
        "explanation": (
            f"Confirmada: pago domiciliado a {bill['payee']} por {format_mxn(amount_cents)} cada mes, "
            f"el día {date.fromisoformat(next_charge_on).day}. Todavía no la vemos como cargo "
            "constante en tu historial."
        ),
    }


def _next_monthly_day(day_of_month: int | None, today: date) -> str:
    if not day_of_month:
        return today.isoformat()
    candidate = today.replace(day=min(day_of_month, calendar.monthrange(today.year, today.month)[1]))
    if candidate < today:
        next_month = _add_months(datetime(today.year, today.month, 1), 1)
        last_day = calendar.monthrange(next_month.year, next_month.month)[1]
        candidate = date(next_month.year, next_month.month, min(day_of_month, last_day))
    return candidate.isoformat()


def _day_start(day: str) -> datetime:
    return datetime.fromisoformat(f"{day}T00:00:00+00:00")


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
