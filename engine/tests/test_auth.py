from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import auth, repository
from app.main import app

client = TestClient(app)

ANA = {"id": "cus_ana"}


@pytest.fixture(autouse=True)
def require_auth(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(engine_require_auth=True))
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: pytest.fail("no single-tenant fallback"))
    monkeypatch.setattr(repository, "fetch_auth_user_id", lambda token: "user_ana" if token == "good" else None)
    monkeypatch.setattr(repository, "fetch_customer_by_auth_user", lambda user_id: ANA if user_id == "user_ana" else None)
    monkeypatch.setattr(
        repository,
        "fetch_account",
        lambda account_id: {"acc_ana": {"id": "acc_ana", "customer_id": "cus_ana"},
                            "acc_beto": {"id": "acc_beto", "customer_id": "cus_beto"}}.get(account_id),
    )
    monkeypatch.setattr(repository, "fetch_enriched_transactions", lambda *args: [])


def test_no_token_is_401():
    assert client.get("/customers/me").status_code == 401


def test_a_bad_token_is_401():
    assert client.get("/customers/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_a_good_token_resolves_its_own_customer():
    res = client.get("/customers/me", headers={"Authorization": "Bearer good"})

    assert res.status_code == 200
    assert res.json()["id"] == "cus_ana"


def test_someone_elses_account_is_indistinguishable_from_a_missing_one():
    headers = {"Authorization": "Bearer good"}

    assert client.get("/transactions", params={"account_id": "acc_ana"}, headers=headers).status_code == 200
    assert client.get("/transactions", params={"account_id": "acc_beto"}, headers=headers).status_code == 404
    assert client.get("/transactions", params={"account_id": "acc_nadie"}, headers=headers).status_code == 404
