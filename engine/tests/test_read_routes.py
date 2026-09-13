import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import repository
from app.routers import accounts as accounts_router
from app.main import app
from app.repository import CustomerResolutionError, SupabaseNotConfigured

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


def _load(name: str):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


client = TestClient(app)


@pytest.fixture(autouse=True)
def owner(monkeypatch):
    customer = _load("customers")[0]
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)
    monkeypatch.setattr(repository, "fetch_account", lambda account_id: {"id": account_id, "customer_id": customer["id"]})


def test_customers_me_returns_the_seeded_customer(monkeypatch):
    customer = _load("customers")[0]
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)

    res = client.get("/customers/me")

    assert res.status_code == 200
    assert res.json()["id"] == "cus_0001"


def test_customers_me_404s_when_nothing_seeded(monkeypatch):
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: None)

    res = client.get("/customers/me")

    assert res.status_code == 404


def test_accounts_returns_the_two_seeded_accounts(monkeypatch):
    customer = _load("customers")[0]
    accounts = _load("accounts")
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)
    monkeypatch.setattr(accounts_router, "ensure_bank_accounts", lambda c: accounts)

    res = client.get("/accounts")

    assert res.status_code == 200
    assert len(res.json()) == 2
    assert {a["id"] for a in res.json()} == {"acc_checking_0001", "acc_savings_0001"}


def test_transactions_returns_the_51_enriched_seed_rows(monkeypatch):
    enriched = _load("enriched_transactions")
    monkeypatch.setattr(
        repository,
        "fetch_enriched_transactions",
        lambda account_id, date_from, date_to, limit: enriched,
    )

    res = client.get("/transactions", params={"account_id": "acc_checking_0001"})

    assert res.status_code == 200
    assert len(res.json()) == 51


def test_transactions_forwards_query_params(monkeypatch):
    captured = {}

    def fake_fetch(account_id, date_from, date_to, limit):
        captured.update(account_id=account_id, date_from=date_from, date_to=date_to, limit=limit)
        return []

    monkeypatch.setattr(repository, "fetch_enriched_transactions", fake_fetch)

    client.get(
        "/transactions",
        params={"account_id": "acc_checking_0001", "from": "2026-08-01", "to": "2026-08-31", "limit": 10},
    )

    assert captured == {
        "account_id": "acc_checking_0001",
        "date_from": "2026-08-01",
        "date_to": "2026-08-31",
        "limit": 10,
    }


def test_customers_me_409s_when_customer_choice_is_ambiguous(monkeypatch):
    def raise_ambiguous():
        raise CustomerResolutionError("Hay más de un cliente sincronizado de Nessie")

    monkeypatch.setattr(repository, "fetch_current_customer", raise_ambiguous)

    res = client.get("/customers/me")

    assert res.status_code == 409
    assert "sincronizado" in res.json()["detail"]


def test_missing_supabase_config_returns_503(monkeypatch):
    def raise_not_configured():
        raise SupabaseNotConfigured()

    monkeypatch.setattr(repository, "get_client", raise_not_configured)
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: repository.get_client())

    res = client.get("/customers/me")

    assert res.status_code == 503
    assert "SUPABASE_URL" in res.json()["detail"]
