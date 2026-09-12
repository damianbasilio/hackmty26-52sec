from app.subscriptions_engine import detect_subscriptions

ACCOUNT_ID = "acc_checking_0001"


def test_detects_exactly_the_four_seed_subscriptions(merchants, transactions, expected_subscriptions):
    result = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    assert {r["merchant_display_name"] for r in result} == {
        s["merchant_display_name"] for s in expected_subscriptions
    }
    assert len(result) == 4


def test_matches_expected_fields_per_merchant(merchants, transactions, expected_subscriptions):
    result = {r["merchant_display_name"]: r for r in detect_subscriptions(ACCOUNT_ID, transactions, merchants)}
    expected = {s["merchant_display_name"]: s for s in expected_subscriptions}

    for name, exp in expected.items():
        got = result[name]
        assert got["cadence"] == exp["cadence"], name
        assert got["amount_cents"] == exp["amount_cents"], name
        assert got["previous_amount_cents"] == exp["previous_amount_cents"], name
        assert got["price_delta_cents"] == exp["price_delta_cents"], name
        assert got["price_increase_detected"] == exp["price_increase_detected"], name
        assert got["occurrence_count"] == exp["occurrence_count"], name
        assert got["status"] == exp["status"], name
        assert got["annual_cost_cents"] == exp["annual_cost_cents"], name
        assert got["next_charge_on"] == exp["next_charge_on"], name
        assert got["confidence"] == exp["confidence"], name


def test_netflix_price_hike_explanation_matches(merchants, transactions, expected_subscriptions):
    result = {r["merchant_display_name"]: r for r in detect_subscriptions(ACCOUNT_ID, transactions, merchants)}
    expected = {s["merchant_display_name"]: s for s in expected_subscriptions}
    assert result["Netflix"]["explanation"] == expected["Netflix"]["explanation"]
    assert result["Smart Fit"]["explanation"] == expected["Smart Fit"]["explanation"]
    assert result["Spotify"]["explanation"] == expected["Spotify"]["explanation"]
    assert result["Telmex"]["explanation"] == expected["Telmex"]["explanation"]
