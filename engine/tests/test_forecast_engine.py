from datetime import date

import pytest

from app.forecast_engine import Stream, build_forecast, detect_streams, local_date
from personas import NOW, generate


@pytest.fixture(scope="module")
def forecasts() -> dict[str, dict]:
    out = {}
    for name, (accounts, movements) in generate().items():
        checking, savings = accounts
        out[name] = build_forecast(checking, movements, NOW, [savings])
    return out


def test_projection_is_integer_cents_and_ordered(forecasts):
    for f in forecasts.values():
        assert len(f["daily"]) == 30
        for day in f["daily"]:
            for key in ("expected_balance_cents", "low_balance_cents", "high_balance_cents", "inflow_cents", "outflow_cents"):
                assert isinstance(day[key], int), key
            assert day["low_balance_cents"] <= day["expected_balance_cents"] <= day["high_balance_cents"]
        assert isinstance(f["summary"]["safe_to_spend_daily_cents"], int)
        assert f["status_explanation"]
        assert f["generated_at"].endswith("Z")


def test_detects_payroll_and_rent():
    _, movements = generate()["ana"]
    streams = {s.category: s for s in detect_streams(movements, local_date(NOW))}
    assert streams["income"].cadence == "semimonthly" and set(streams["income"].anchors) == {15, 31}
    assert streams["housing"].cadence == "monthly"
    netflix = next(s for s in detect_streams(movements, local_date(NOW)) if s.label == "Netflix")
    assert netflix.amount_cents == -23_900


def test_month_end_anchor_clamps_to_short_months():
    stream = Stream("Nómina", "income", "semimonthly", 100_000, (15, 31), date(2027, 1, 31), frozenset())
    assert stream.dates_between(date(2027, 2, 1), date(2027, 2, 28)) == [date(2027, 2, 15), date(2027, 2, 28)]


def test_payday_tomorrow_does_not_inflate_the_daily_budget(forecasts):
    s = forecasts["ana"]["summary"]
    assert s["next_income_on"] == "2026-09-15"
    assert s["safe_to_spend_until"] == "2026-09-30"
    assert s["safe_to_spend_days"] >= 7
    assert s["safe_to_spend_daily_cents"] < forecasts["ana"]["start_balance_cents"] // 7


def test_healthy_customer_is_offered_a_safe_amount_to_save(forecasts):
    f = forecasts["ana"]
    assert f["status"] == "healthy"
    save = next(r for r in f["recommendations"] if r["kind"] == "safe_to_save")
    action = save["action"]
    assert (action["type"], action["from_account_id"], action["to_account_id"]) == ("move_money", "acc_ana_checking", "acc_ana_savings")
    assert 0 < action["amount_cents"] <= f["start_balance_cents"] * 0.30
    assert action["amount_cents"] % 10_000 == 0
    assert any(r["kind"] == "spending_creep" and "domicilio" in r["title"] for r in f["recommendations"])


def test_short_customer_is_told_to_pull_from_savings_and_what_to_pause(forecasts):
    f = forecasts["luis"]
    assert f["status"] == "critical"
    assert f["summary"]["safe_to_spend_daily_cents"] == 0
    cover = next(r for r in f["recommendations"] if r["kind"] == "cover_from_savings")
    assert cover["priority"] == "high"
    assert cover["action"]["from_account_id"] == "acc_luis_savings" and cover["action"]["amount_cents"] == 250_000
    pause = next(r for r in f["recommendations"] if r["kind"] == "pause_before_low")
    assert not any(word in pause["title"] for word in ("Renta", "CFE", "Telmex", "Soriana"))


def test_irregular_income_has_no_fake_payday(forecasts):
    assert forecasts["luis"]["summary"]["next_income_on"] is None
