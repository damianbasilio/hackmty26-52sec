import pytest
from fastapi.testclient import TestClient

from app import ledger, repository
from app.main import app
from app.routers import shield as shield_router
from app.shield_store import ShieldStore
from personas import generate

client = TestClient(app)


@pytest.fixture
def ana(monkeypatch):
    accounts, history = generate()["ana"]
    monkeypatch.setattr(ledger, "load_accounts", lambda customer_id: accounts)
    monkeypatch.setattr(ledger, "load_movements", lambda account_id: history if account_id == accounts[0].id else [])
    monkeypatch.setattr(shield_router, "store", ShieldStore())
    return accounts


def test_forecast_route_serves_the_contract_shape(ana):
    res = client.get("/forecast", params={"account_id": ana[0].id})
    assert res.status_code == 200
    body = res.json()
    assert body["account_id"] == ana[0].id and len(body["daily"]) == 30
    assert {"summary", "streams", "spending", "recommendations"} <= body.keys()


def test_forecast_of_someone_elses_account_is_a_404(ana, monkeypatch):
    monkeypatch.setattr(repository, "fetch_account", lambda account_id: {"id": account_id, "customer_id": "cus_other"})
    assert client.get("/forecast", params={"account_id": ana[0].id}).status_code == 404


def test_shield_routes(ana):
    shield = client.get("/shield").json()
    assert shield["status"] == "normal" and shield["settings"] == {"auto_protect": True}
    assert client.get("/shield/alerts").json() == []

    assert client.post("/shield/lock-card").json()["card_locked"] is True
    assert client.post("/shield/release", json={}).status_code == 428
    issued = client.post("/shield/challenges", json={"purpose": "release_protection", "target": "shield"})
    assert issued.status_code == 201 and "code_hash" not in issued.json()["challenge"]
    verification = {"challenge_id": issued.json()["challenge"]["id"], "code": issued.json()["code"]}
    released = client.post("/shield/release", json=verification)
    assert released.status_code == 200 and released.json()["card_locked"] is False

    assert client.post("/shield/alerts/alr_nope/resolve", json={"resolution": "dismissed"}).status_code == 404
    assert client.post("/shield/challenges", json={"purpose": "approve_transfer", "target": "x"}).status_code == 422


pytestmark = pytest.mark.usefixtures("account_owner")
