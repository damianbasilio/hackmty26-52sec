"""Subscription detection: cadence + stable amount + minimum occurrences."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import datetime, timedelta, timezone

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


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
