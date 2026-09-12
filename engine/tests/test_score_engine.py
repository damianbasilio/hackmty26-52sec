from datetime import datetime, timezone

from app.score_engine import compute_score

ACCOUNT_ID = "acc_checking_0001"
BALANCE_CENTS = 2313600
PERIOD_START = datetime(2026, 6, 14, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 9, 12, 15, 0, 0, tzinfo=timezone.utc)


def test_seed_data_scores_671(transactions, merchants):
    result = compute_score(
        ACCOUNT_ID, transactions, merchants, BALANCE_CENTS, PERIOD_START, PERIOD_END, None
    )
    assert result["score"] == 671
    assert result["band"] == "good"


def test_weights_sum_to_one(transactions, merchants):
    result = compute_score(
        ACCOUNT_ID, transactions, merchants, BALANCE_CENTS, PERIOD_START, PERIOD_END, None
    )
    total_weight = sum(c["weight"] for c in result["components"])
    assert round(total_weight, 6) == 1.0


def test_points_are_consistent_with_score(transactions, merchants):
    result = compute_score(
        ACCOUNT_ID, transactions, merchants, BALANCE_CENTS, PERIOD_START, PERIOD_END, None
    )
    assert 300 + sum(c["points"] for c in result["components"]) == result["score"]
    assert 300 <= result["score"] <= 850


def test_every_component_has_spanish_explanation(transactions, merchants):
    result = compute_score(
        ACCOUNT_ID, transactions, merchants, BALANCE_CENTS, PERIOD_START, PERIOD_END, None
    )
    for component in result["components"]:
        assert component["explanation"]
    assert result["explanation"]
    assert len(result["top_actions"]) > 0
