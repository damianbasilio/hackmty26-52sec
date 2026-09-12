"""Anomaly scanning: duplicate charges, amount outliers, odd hours, price hikes."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .enrichment import (
    format_mxn,
    local_hour_of_day,
    normalize_merchant,
    population_zscores,
    spanish_month_name,
    to_local,
)
from .models import Merchant, Transaction

DUPLICATE_WINDOW_MINUTES = 30
VELOCITY_WINDOW_MINUTES = 10
VELOCITY_MIN_CHARGES = 2
OUTLIER_ZSCORE_THRESHOLD = 2.0
OUTLIER_MIN_OCCURRENCES = 3
UNUSUAL_HOUR_TOLERANCE = 3
# Needs a deeper history than the amount check: two data points are too thin
# a baseline to call a visiting hour "usual".
UNUSUAL_HOUR_MIN_OCCURRENCES = 5

# base 0..100 severity per signal kind, weighted by the signal's own weight
# inside the alert. Tuned so a lone duplicate charge already reads critical.
_SIGNAL_BASE_SCORE = {
    "duplicate_charge": 95,
    "velocity_spike": 80,
    "amount_outlier": 70,
    "unusual_hour": 55,
    "subscription_price_hike": 58,
}

_MULTIPLE_WORDS = {2: "dos", 3: "tres", 4: "cuatro", 5: "cinco", 6: "seis", 7: "siete", 8: "ocho"}


def _severity(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 40:
        return "warning"
    return "info"


def scan_anomalies(
    account_id: str,
    transactions: list[Transaction],
    merchants: dict[str, Merchant],
    subscriptions: list[dict],
    now: datetime,
    existing_ids: dict[str, str] | None = None,
    resolved_transaction_ids: set[str] | None = None,
) -> list[dict]:
    existing_ids = existing_ids or {}
    resolved_transaction_ids = resolved_transaction_ids or set()
    purchases = [t for t in transactions if t.type == "purchase" and t.status == "completed"]

    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for txn in purchases:
        guess = normalize_merchant(txn.raw_description)
        by_merchant[guess.normalized_name].append(txn)

    signals_by_txn: dict[str, list[dict]] = defaultdict(list)

    for normalized_name, txns in by_merchant.items():
        merchant = merchants.get(normalized_name)
        display_name = merchant.display_name if merchant else txns[0].raw_description
        txns = sorted(txns, key=lambda t: t.occurred_at)

        _detect_duplicates_and_velocity(txns, display_name, signals_by_txn)

        if len(txns) >= OUTLIER_MIN_OCCURRENCES:
            _detect_amount_outliers(txns, signals_by_txn)
        if len(txns) >= UNUSUAL_HOUR_MIN_OCCURRENCES:
            _detect_unusual_hours(txns, signals_by_txn)

    _detect_subscription_price_hikes(transactions, subscriptions, signals_by_txn)

    txns_by_id = {t.id: t for t in transactions}
    sub_by_id = {s["id"]: s for s in subscriptions}
    alerts = [
        _build_alert(account_id, txns_by_id[txn_id], signals, sub_by_id, now, existing_ids.get(txn_id))
        for txn_id, signals in signals_by_txn.items()
        # Don't resurface something the user already dismissed or confirmed.
        if txn_id not in resolved_transaction_ids
    ]

    alerts.sort(key=lambda a: (-a["score"], a["detected_at"]))
    return alerts


def _detect_duplicates_and_velocity(
    txns: list[Transaction], display_name: str, signals_by_txn: dict[str, list[dict]]
) -> None:
    for txn in txns:
        dup_window_start = txn.occurred_at - timedelta(minutes=DUPLICATE_WINDOW_MINUTES)
        same_amount_prior = [
            other
            for other in txns
            if other.id != txn.id
            and dup_window_start <= other.occurred_at < txn.occurred_at
            and other.amount_cents == txn.amount_cents
        ]
        if not same_amount_prior:
            continue

        original = same_amount_prior[-1]
        minutes_apart = round((txn.occurred_at - original.occurred_at).total_seconds() / 60)
        signals_by_txn[txn.id].append(
            {
                "kind": "duplicate_charge",
                "weight": 0.7,
                "label": "Cargo duplicado",
                "evidence": {
                    "original_transaction_id": original.id,
                    "minutes_apart": minutes_apart,
                    "amount_cents": txn.amount_cents,
                },
            }
        )

        vel_window_start = txn.occurred_at - timedelta(minutes=VELOCITY_WINDOW_MINUTES)
        charges_in_window = 1 + len(
            [
                other
                for other in txns
                if other.id != txn.id and vel_window_start <= other.occurred_at <= txn.occurred_at
            ]
        )
        if charges_in_window >= VELOCITY_MIN_CHARGES:
            signals_by_txn[txn.id].append(
                {
                    "kind": "velocity_spike",
                    "weight": 0.3,
                    "label": f"{charges_in_window} cargos en {VELOCITY_WINDOW_MINUTES} min",
                    "evidence": {
                        "charges_in_window": charges_in_window,
                        "window_minutes": VELOCITY_WINDOW_MINUTES,
                        "merchant": display_name,
                    },
                }
            )


def _detect_amount_outliers(txns: list[Transaction], signals_by_txn: dict[str, list[dict]]) -> None:
    magnitudes = [-t.amount_cents for t in txns]
    zscores = population_zscores(magnitudes)
    for txn, magnitude, z in zip(txns, magnitudes, zscores):
        if abs(z) < OUTLIER_ZSCORE_THRESHOLD:
            continue
        others = [m for m, other in zip(magnitudes, txns) if other.id != txn.id]
        merchant_mean = round(sum(others) / len(others)) if others else 0
        multiple = round(magnitude / merchant_mean) if merchant_mean else 0
        signals_by_txn[txn.id].append(
            {
                "kind": "amount_outlier",
                "weight": 0.6,
                "label": f"{multiple}x tu gasto normal aquí",
                "evidence": {
                    "amount_cents": txn.amount_cents,
                    "merchant_mean_cents": merchant_mean,
                    "zscore": z,
                },
            }
        )


def _detect_unusual_hours(txns: list[Transaction], signals_by_txn: dict[str, list[dict]]) -> None:
    hours = [local_hour_of_day(t.occurred_at) for t in txns]
    for i, txn in enumerate(txns):
        others = [h for j, h in enumerate(hours) if j != i]
        low = min(others) - UNUSUAL_HOUR_TOLERANCE
        high = max(others) + UNUSUAL_HOUR_TOLERANCE
        hour = hours[i]
        if low <= hour <= high:
            continue
        local_dt = to_local(txn.occurred_at)
        period = "AM" if local_dt.hour < 12 else "PM"
        hour12 = local_dt.hour % 12 or 12
        signals_by_txn[txn.id].append(
            {
                "kind": "unusual_hour",
                "weight": 0.4,
                "label": f"Compra a las {hour12}:{local_dt.minute:02d} {period}",
                "evidence": {
                    "hour_of_day": hour,
                    "usual_hours": f"{max(min(others), 0):02d}:00-{max(others) + 4:02d}:00",
                },
            }
        )


def _detect_subscription_price_hikes(
    transactions: list[Transaction], subscriptions: list[dict], signals_by_txn: dict[str, list[dict]]
) -> None:
    for sub in subscriptions:
        if not sub["price_increase_detected"]:
            continue
        candidates = [
            t
            for t in transactions
            if t.type == "purchase"
            and t.status == "completed"
            and -t.amount_cents == sub["amount_cents"]
            and t.occurred_at.isoformat() == sub["last_charge_at"].replace("Z", "+00:00")
        ]
        if not candidates:
            continue
        txn = candidates[0]
        percent = round(sub["price_delta_cents"] / sub["previous_amount_cents"], 3)
        signals_by_txn[txn.id].append(
            {
                "kind": "subscription_price_hike",
                "weight": 1.0,
                "label": f"{sub['merchant_display_name']} subió {format_mxn(sub['price_delta_cents'])}",
                "evidence": {
                    "previous_amount_cents": sub["previous_amount_cents"],
                    "amount_cents": sub["amount_cents"],
                    "percent": percent,
                },
                "subscription_id": sub["id"],
            }
        )


def _build_alert(
    account_id: str,
    txn: Transaction,
    signals: list[dict],
    sub_by_id: dict[str, dict],
    now: datetime,
    existing_id: str | None,
) -> dict:
    kinds = {s["kind"] for s in signals}
    subscription_id = next((s.get("subscription_id") for s in signals if s.get("subscription_id")), None)
    clean_signals = [{k: v for k, v in s.items() if k != "subscription_id"} for s in signals]

    score = max(0, min(100, round(sum(s["weight"] * _SIGNAL_BASE_SCORE[s["kind"]] for s in signals))))

    title, explanation, suggested_action = _copy_for(txn, kinds, signals, sub_by_id.get(subscription_id))

    return {
        "id": existing_id or f"alr_{txn.id}",
        "account_id": account_id,
        "transaction_id": txn.id,
        "subscription_id": subscription_id,
        "severity": _severity(score),
        "score": score,
        "signals": clean_signals,
        "title": title,
        "explanation": explanation,
        "suggested_action": suggested_action,
        "detected_at": _iso(now),
        "resolved_at": None,
        "resolution": None,
    }


def _copy_for(
    txn: Transaction, kinds: set[str], signals: list[dict], subscription: dict | None
) -> tuple[str, str, str]:
    guess = normalize_merchant(txn.raw_description)
    display_name = guess.display_name

    if "duplicate_charge" in kinds:
        dup = next(s for s in signals if s["kind"] == "duplicate_charge")
        minutes = dup["evidence"]["minutes_apart"]
        amount = format_mxn(abs(txn.amount_cents))
        title = f"Cargo duplicado en {display_name}"
        explanation = (
            f"{display_name} te cobró {amount} dos veces el {txn.occurred_at.day} de "
            f"{spanish_month_name(txn.occurred_at)} con {minutes} minutos de diferencia. Normalmente "
            "solo hay un cargo por pedido, así que probablemente uno sea un error."
        )
        suggested_action = f"Reportar el segundo cargo con {display_name}"
        return title, explanation, suggested_action

    if "amount_outlier" in kinds:
        outlier = next(s for s in signals if s["kind"] == "amount_outlier")
        amount = format_mxn(abs(txn.amount_cents))
        mean = format_mxn(outlier["evidence"]["merchant_mean_cents"])
        multiple = round(abs(txn.amount_cents) / outlier["evidence"]["merchant_mean_cents"])
        title = f"Compra inusual en {display_name}"
        explanation = (
            f"Gastaste {amount} en {display_name}, casi {_spell_multiple(multiple)} veces tu promedio "
            f"de {mean} en esa tienda"
        )
        if "unusual_hour" in kinds:
            explanation += ", y a una hora en la que casi nunca compras ahí."
        else:
            explanation += "."
        explanation += " Revísalo para descartar un cargo que no hiciste."
        suggested_action = "Confirmar si reconoces la compra"
        return title, explanation, suggested_action

    if "subscription_price_hike" in kinds and subscription is not None:
        prev = format_mxn(subscription["previous_amount_cents"])
        curr = format_mxn(subscription["amount_cents"])
        percent = round(subscription["price_delta_cents"] / subscription["previous_amount_cents"] * 100)
        annual_extra = format_mxn(subscription["price_delta_cents"] * 12)
        title = f"{subscription['merchant_display_name']} subió de precio"
        explanation = (
            f"{subscription['merchant_display_name']} pasó de {prev} a {curr} este mes, un {percent}% "
            f"más. Son {annual_extra} extra al año si lo dejas igual."
        )
        suggested_action = "Comparar plan o cancelar"
        return title, explanation, suggested_action

    title = f"Movimiento inusual en {display_name}"
    explanation = f"Detectamos algo fuera de patrón en un cargo de {display_name}."
    suggested_action = "Revisar el movimiento"
    return title, explanation, suggested_action


def _spell_multiple(multiple: int) -> str:
    return _MULTIPLE_WORDS.get(multiple, str(multiple))


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
