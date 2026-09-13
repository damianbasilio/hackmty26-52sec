import pytest
from fastapi.testclient import TestClient

from app import repository
from app.main import app

client = TestClient(app)


def test_scan_reuses_existing_subscription_id_and_persists_it(monkeypatch, transactions, merchants):
    existing_subscription = {
        "id": "sub_0002",
        "merchant_id": "mer_0010",
        "cadence": "monthly",
        "category": "streaming",
        "merchant_display_name": "Netflix",
    }
    captured = {}

    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: transactions)
    monkeypatch.setattr(repository, "fetch_merchants", lambda: merchants)
    monkeypatch.setattr(repository, "fetch_subscriptions", lambda account_id: [existing_subscription])
    monkeypatch.setattr(
        repository,
        "upsert_subscriptions",
        lambda rows: captured.setdefault("subscriptions", rows) and rows,
    )
    monkeypatch.setattr(repository, "fetch_anomaly_alerts", lambda account_id, include_resolved: [])
    monkeypatch.setattr(
        repository, "upsert_anomaly_alerts", lambda rows: captured.setdefault("alerts", rows) or rows
    )

    res = client.post("/anomalies/scan", params={"account_id": "acc_checking_0001"})

    assert res.status_code == 200
    price_hike = next(s for s in captured["subscriptions"] if s["merchant_display_name"] == "Netflix")
    assert price_hike["id"] == "sub_0002"
    hike_alert = next(a for a in captured["alerts"] if a["subscription_id"] is not None)
    assert hike_alert["subscription_id"] == "sub_0002"


pytestmark = pytest.mark.usefixtures("account_owner")
