from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import nessie, repository
from app.main import app
from app.routers import accounts

client = TestClient(app)

FIXTURE_CUSTOMER = {"id": "cus_0001", "nessie_customer_id": "placeholder0000000000000"}
NESSIE_CUSTOMER = {"id": "cus_nessie_abc", "nessie_customer_id": "abc"}


def _stub(monkeypatch, customer, existing=()):
    inserted = []
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)
    monkeypatch.setattr(repository, "fetch_accounts", lambda customer_id: list(existing))
    monkeypatch.setattr(repository, "insert_account", lambda row: inserted.append(row) or row)
    return inserted


def test_fixture_customer_gets_a_supabase_only_savings_account(monkeypatch):
    inserted = _stub(monkeypatch, FIXTURE_CUSTOMER)
    monkeypatch.setattr(nessie, "create_account", lambda *args: (_ for _ in ()).throw(AssertionError("no Nessie")))

    res = client.post("/accounts", json={"nickname": "  Fondo   de emergencia "})

    assert res.status_code == 201
    [row] = inserted
    assert row["id"].startswith("acc_savings_")
    assert row["nickname"] == "Fondo de emergencia"
    assert row["type"] == "savings"
    assert row["balance_cents"] == 0
    assert len(row["last_four"]) == 4 and row["last_four"].isdigit()


def test_nessie_customer_opens_the_account_in_nessie_with_an_ascii_name(monkeypatch):
    inserted = _stub(monkeypatch, NESSIE_CUSTOMER)
    monkeypatch.setattr(accounts, "get_settings", lambda: SimpleNamespace(nessie_api_key="key"))
    calls = []

    def create_account(customer_id, account_type, nickname, balance):
        calls.append((customer_id, account_type, nickname, balance))
        return {"_id": "n123", "type": "Savings", "nickname": nickname, "balance": 0, "account_number": "5550001234567891"}

    monkeypatch.setattr(nessie, "create_account", create_account)

    res = client.post("/accounts", json={"nickname": "Viaje a Cancún"})

    assert res.status_code == 201
    assert calls == [("abc", "Savings", "Viaje a Cancun", 0)]
    [row] = inserted
    assert row["id"] == "acc_nessie_n123"
    assert row["nickname"] == "Viaje a Cancún"
    assert row["last_four"] == "7891"


def test_a_repeated_name_is_409(monkeypatch):
    inserted = _stub(monkeypatch, FIXTURE_CUSTOMER, existing=[{"nickname": "Ahorro Meta Viaje"}])

    res = client.post("/accounts", json={"nickname": "ahorro meta viaje"})

    assert res.status_code == 409
    assert inserted == []


def test_a_blank_name_is_422(monkeypatch):
    inserted = _stub(monkeypatch, FIXTURE_CUSTOMER)

    res = client.post("/accounts", json={"nickname": "   "})

    assert res.status_code == 422
    assert inserted == []
