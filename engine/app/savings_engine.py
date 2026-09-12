"""Savings rule suggestions, derived from what the other engines already found."""

from __future__ import annotations

from datetime import datetime, timezone

from .enrichment import format_mxn, normalize_merchant
from .models import Merchant, Transaction

ROUND_UP_TARGET_CENTS = 1000
FIXED_RECURRING_AMOUNT_CENTS = 50000
# Suggested cap: 10% above the highest recent month, rounded to whole pesos.
SPEND_CAP_MARGIN_NUM = 11
SPEND_CAP_MARGIN_DEN = 10

FIXED_CATEGORIES = {
    "housing", "telecom", "utilities", "streaming", "fitness", "fees", "insurance",
}


def suggest_savings_rules(
    account_id: str,
    transactions: list[Transaction],
    merchants: dict[str, Merchant],
    subscriptions: list[dict],
    existing_rules: list[dict],
    savings_account_id: str | None,
    now: datetime,
) -> list[dict]:
    existing_by_subscription = {
        r["subscription_id"] for r in existing_rules if r.get("subscription_id")
    }
    existing_kinds = {r["kind"] for r in existing_rules if r["status"] in ("active", "suggested")}
    existing_cap_categories = {
        r["category"]
        for r in existing_rules
        if r["kind"] == "spend_cap" and r["status"] in ("active", "suggested")
    }

    suggestions: list[dict] = []

    for sub in subscriptions:
        if sub["status"] != "unused" or sub["id"] in existing_by_subscription:
            continue
        suggestions.append(
            _base_rule(
                account_id,
                rule_id=f"svr_cancel_{sub['id']}",
                destination_account_id=None,
                kind="cancel_subscription",
                title=f"Cancelar {sub['merchant_display_name']}",
                description=(
                    f"Llevas {sub['occurrence_count']} cargos pagando {sub['merchant_display_name']} "
                    f"sin señales de que lo uses. Cancelarlo libera {format_mxn(sub['amount_cents'])} al mes."
                ),
                amount_cents=sub["amount_cents"],
                cadence=sub["cadence"],
                category=sub["category"],
                subscription_id=sub["id"],
                projected_annual_savings_cents=sub["annual_cost_cents"],
                now=now,
            )
        )

    purchases = [t for t in transactions if t.type == "purchase" and t.status == "completed"]

    if "round_up" not in existing_kinds and savings_account_id and purchases:
        annual_estimate = _estimate_round_up_annual(purchases)
        suggestions.append(
            _base_rule(
                account_id,
                rule_id=f"svr_roundup_{account_id}",
                destination_account_id=savings_account_id,
                kind="round_up",
                title="Redondeo de cada compra",
                description=(
                    f"Cada compra se redondea al siguiente múltiplo de "
                    f"{format_mxn(ROUND_UP_TARGET_CENTS)} y la diferencia se va a tu ahorro."
                ),
                round_to_cents=ROUND_UP_TARGET_CENTS,
                projected_annual_savings_cents=annual_estimate,
                now=now,
            )
        )

    deposits = [t for t in transactions if t.type == "deposit" and t.status == "completed"]
    if "fixed_recurring" not in existing_kinds and savings_account_id and deposits:
        suggestions.append(
            _base_rule(
                account_id,
                rule_id=f"svr_fixed_{account_id}",
                destination_account_id=savings_account_id,
                kind="fixed_recurring",
                title=f"Apartar {format_mxn(FIXED_RECURRING_AMOUNT_CENTS)} cada quincena",
                description=(
                    f"Al día siguiente de cada nómina movemos {format_mxn(FIXED_RECURRING_AMOUNT_CENTS)} "
                    "a tu cuenta de ahorro."
                ),
                amount_cents=FIXED_RECURRING_AMOUNT_CENTS,
                cadence="biweekly",
                projected_annual_savings_cents=FIXED_RECURRING_AMOUNT_CENTS * 26,
                now=now,
            )
        )

    top_category = _top_variable_category(purchases, merchants)
    if top_category and top_category[0] not in existing_cap_categories:
        category, monthly_total = top_category
        padded = monthly_total * SPEND_CAP_MARGIN_NUM // SPEND_CAP_MARGIN_DEN
        cap = (padded + 50) // 100 * 100
        suggestions.append(
            _base_rule(
                account_id,
                rule_id=f"svr_cap_{account_id}_{category}",
                destination_account_id=savings_account_id,
                kind="spend_cap",
                title=f"Tope de {format_mxn(cap)} al mes en {category}",
                description=(
                    f"Te avisamos cuando tu gasto en {category} pase de {format_mxn(cap)} en el mes."
                ),
                amount_cents=cap,
                cadence="monthly",
                category=category,
                projected_annual_savings_cents=cap * 15 // 100 * 12,
                now=now,
            )
        )

    return suggestions


def _estimate_round_up_annual(purchases: list[Transaction]) -> int:
    remainders = [(-t.amount_cents) % ROUND_UP_TARGET_CENTS for t in purchases]
    round_ups = [ROUND_UP_TARGET_CENTS - r if r else 0 for r in remainders]
    if not purchases:
        return 0
    span_days = max(1, (purchases[-1].occurred_at - purchases[0].occurred_at).days)
    total = sum(round_ups)
    return round(total * 365 / span_days)


def _top_variable_category(
    purchases: list[Transaction], merchants: dict[str, Merchant]
) -> tuple[str, int] | None:
    totals: dict[str, int] = {}
    for t in purchases:
        guess = normalize_merchant(t.raw_description)
        merchant = merchants.get(guess.normalized_name)
        category = merchant.category if merchant else guess.category
        if category in FIXED_CATEGORIES:
            continue
        totals[category] = totals.get(category, 0) + (-t.amount_cents)
    if not totals:
        return None
    category = max(totals, key=totals.get)
    return category, totals[category]


def _base_rule(
    account_id: str,
    *,
    rule_id: str,
    kind: str,
    title: str,
    description: str,
    now: datetime,
    destination_account_id: str | None = None,
    amount_cents: int | None = None,
    percent: float | None = None,
    round_to_cents: int | None = None,
    cadence: str | None = None,
    category: str | None = None,
    subscription_id: str | None = None,
    projected_annual_savings_cents: int = 0,
) -> dict:
    return {
        "id": rule_id,
        "account_id": account_id,
        "destination_account_id": destination_account_id,
        "kind": kind,
        "title": title,
        "description": description,
        "status": "suggested",
        "amount_cents": amount_cents,
        "percent": percent,
        "round_to_cents": round_to_cents,
        "cadence": cadence,
        "category": category,
        "subscription_id": subscription_id,
        "projected_annual_savings_cents": projected_annual_savings_cents,
        "saved_to_date_cents": 0,
        "created_at": _iso(now),
        "activated_at": None,
    }


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
