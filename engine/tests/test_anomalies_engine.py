from datetime import datetime, timezone

from app.anomalies_engine import scan_anomalies
from app.subscriptions_engine import detect_subscriptions

ACCOUNT_ID = "acc_checking_0001"
NOW = datetime(2026, 9, 12, 15, 0, 0, tzinfo=timezone.utc)


def _scan(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    return scan_anomalies(ACCOUNT_ID, transactions, merchants, subs, NOW)


def test_flags_exactly_the_three_seed_transactions(transactions, merchants, expected_anomaly_alerts):
    alerts = _scan(transactions, merchants)
    got_txn_ids = {a["transaction_id"] for a in alerts}
    expected_txn_ids = {a["transaction_id"] for a in expected_anomaly_alerts}
    assert got_txn_ids == expected_txn_ids
    assert len(alerts) == 3


def test_signal_kinds_match_per_transaction(transactions, merchants, expected_anomaly_alerts):
    alerts = {a["transaction_id"]: a for a in _scan(transactions, merchants)}
    for expected in expected_anomaly_alerts:
        got = alerts[expected["transaction_id"]]
        got_kinds = {s["kind"] for s in got["signals"]}
        expected_kinds = {s["kind"] for s in expected["signals"]}
        assert got_kinds == expected_kinds, expected["transaction_id"]


def test_title_and_actions_match_fixture(transactions, merchants, expected_anomaly_alerts):
    alerts = {a["transaction_id"]: a for a in _scan(transactions, merchants)}
    for expected in expected_anomaly_alerts:
        got = alerts[expected["transaction_id"]]
        assert got["title"] == expected["title"], expected["transaction_id"]
        assert got["explanation"] == expected["explanation"], expected["transaction_id"]
        assert got["suggested_action"] == expected["suggested_action"], expected["transaction_id"]


def test_every_alert_has_spanish_copy(transactions, merchants):
    for alert in _scan(transactions, merchants):
        assert alert["title"]
        assert alert["explanation"]
        assert alert["suggested_action"]
        assert alert["severity"] in {"info", "warning", "critical"}
        assert 0 <= alert["score"] <= 100


def test_reuses_existing_alert_id_instead_of_duplicating(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    first_pass = {a["transaction_id"]: a["id"] for a in scan_anomalies(ACCOUNT_ID, transactions, merchants, subs, NOW)}
    existing_ids = first_pass

    second_pass = scan_anomalies(ACCOUNT_ID, transactions, merchants, subs, NOW, existing_ids)

    assert len(second_pass) == 3
    for alert in second_pass:
        assert alert["id"] == first_pass[alert["transaction_id"]]


def test_skips_transactions_the_user_already_resolved(transactions, merchants):
    subs = detect_subscriptions(ACCOUNT_ID, transactions, merchants)
    first_pass = scan_anomalies(ACCOUNT_ID, transactions, merchants, subs, NOW)
    resolved_txn_id = first_pass[0]["transaction_id"]

    second_pass = scan_anomalies(
        ACCOUNT_ID, transactions, merchants, subs, NOW, {}, {resolved_txn_id}
    )

    assert resolved_txn_id not in {a["transaction_id"] for a in second_pass}
    assert len(second_pass) == 2
