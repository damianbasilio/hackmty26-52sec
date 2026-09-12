from datetime import datetime, timezone

from app.savings_engine import suggest_savings_rules
from app.subscriptions_engine import detect_subscriptions

ACCOUNT_ID = "acc_checking_0001"
SAVINGS_ACCOUNT_ID = "acc_savings_0001"
NOW = datetime(2026, 9, 12, 15, 0, 0, tzinfo=timezone.utc)


def test_suggests_cancelling_the_unused_subscription(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    suggestions = suggest_savings_rules(
        ACCOUNT_ID, transactions, merchants, subs, [], SAVINGS_ACCOUNT_ID, NOW
    )
    cancel_rules = [s for s in suggestions if s["kind"] == "cancel_subscription"]
    assert len(cancel_rules) == 1
    assert cancel_rules[0]["subscription_id"] == next(
        s["id"] for s in subs if s["status"] == "unused"
    )


def test_suggests_round_up_and_fixed_recurring_when_absent(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    suggestions = suggest_savings_rules(
        ACCOUNT_ID, transactions, merchants, subs, [], SAVINGS_ACCOUNT_ID, NOW
    )
    kinds = {s["kind"] for s in suggestions}
    assert "round_up" in kinds
    assert "fixed_recurring" in kinds
    assert "spend_cap" in kinds


def test_skips_kinds_that_already_exist(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    existing = [
        {
            "kind": "round_up",
            "status": "active",
            "category": None,
            "subscription_id": None,
        }
    ]
    suggestions = suggest_savings_rules(
        ACCOUNT_ID, transactions, merchants, subs, existing, SAVINGS_ACCOUNT_ID, NOW
    )
    assert "round_up" not in {s["kind"] for s in suggestions}


def test_every_rule_has_spanish_copy(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    suggestions = suggest_savings_rules(
        ACCOUNT_ID, transactions, merchants, subs, [], SAVINGS_ACCOUNT_ID, NOW
    )
    for rule in suggestions:
        assert rule["title"]
        assert rule["description"]
        assert rule["status"] == "suggested"
