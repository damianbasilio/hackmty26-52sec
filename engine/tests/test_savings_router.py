import pytest
from fastapi.testclient import TestClient

from app import repository
from app.main import app

client = TestClient(app)

ACCOUNT = {"id": "acc_checking_0001", "customer_id": "cus_0001", "balance_cents": 100000, "created_at": "2026-06-14T17:00:00Z"}


def test_suggest_reuses_existing_subscription_id_no_duplicate_cancel_rule(monkeypatch, transactions, merchants):
    existing_subscription = {
        "id": "sub_0003",
        "merchant_id": "mer_0011",
        "cadence": "monthly",
    }
    existing_rule = {
        "id": "svr_0003",
        "kind": "cancel_subscription",
        "status": "suggested",
        "category": "fitness",
        "subscription_id": "sub_0003",
    }
    captured = {}

    monkeypatch.setattr(repository, "fetch_account", lambda account_id: ACCOUNT)
    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: transactions)
    monkeypatch.setattr(repository, "fetch_merchants", lambda: merchants)
    monkeypatch.setattr(repository, "fetch_subscriptions", lambda account_id: [existing_subscription])
    monkeypatch.setattr(repository, "fetch_savings_rules", lambda account_id: [existing_rule])
    monkeypatch.setattr(repository, "fetch_savings_account_id", lambda customer_id: "acc_savings_0001")
    monkeypatch.setattr(
        repository, "upsert_savings_rules", lambda rows: captured.setdefault("rows", rows) or rows
    )

    res = client.post("/savings/suggest", params={"account_id": "acc_checking_0001"})

    assert res.status_code == 200
    cancel_rules = [r for r in captured["rows"] if r["kind"] == "cancel_subscription"]
    assert cancel_rules == []


pytestmark = pytest.mark.usefixtures("account_owner")
