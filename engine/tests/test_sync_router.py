from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import nessie
from app.main import app
from app.routers import sync as sync_router

client = TestClient(app)


def _settings(nessie_api_key: str = "test_key"):
    return SimpleNamespace(nessie_api_key=nessie_api_key)


def test_seed_requires_confirm(monkeypatch):
    monkeypatch.setattr(sync_router, "get_settings", lambda: _settings())

    res = client.post("/sync/nessie/seed")

    assert res.status_code == 400
    assert "confirm=true" in res.json()["detail"]


def test_seed_refuses_when_nessie_already_has_customers(monkeypatch):
    monkeypatch.setattr(sync_router, "get_settings", lambda: _settings())
    monkeypatch.setattr(nessie, "get_customers", lambda: [{"_id": "existing"}])

    res = client.post("/sync/nessie/seed", params={"confirm": "true"})

    assert res.status_code == 409
    assert "ya tiene clientes" in res.json()["detail"]


def test_seed_succeeds_when_confirmed_and_nessie_is_empty(monkeypatch):
    monkeypatch.setattr(sync_router, "get_settings", lambda: _settings())
    monkeypatch.setattr(nessie, "get_customers", lambda: [])
    monkeypatch.setattr(
        sync_router,
        "seed_demo_data",
        lambda now: {"customer_id": "n_cus", "account_id": "n_acc"},
    )

    res = client.post("/sync/nessie/seed", params={"confirm": "true"})

    assert res.status_code == 200
    assert res.json() == {"customer_id": "n_cus", "account_id": "n_acc"}


def test_seed_requires_nessie_configured(monkeypatch):
    monkeypatch.setattr(sync_router, "get_settings", lambda: _settings(nessie_api_key=""))

    res = client.post("/sync/nessie/seed", params={"confirm": "true"})

    assert res.status_code == 503
