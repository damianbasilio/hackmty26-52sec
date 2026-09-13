from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient

from app import clabe, nessie, repository
from app.main import app
from app.routers import accounts

client = TestClient(app)

NESSIE_CUSTOMER = {"id": "cus_nessie_abc", "nessie_customer_id": "abc"}
NESSIE_CHECKING = {
    "id": "acc_nessie_chk",
    "customer_id": NESSIE_CUSTOMER["id"],
    "nickname": "Ahorro Meta Viaje",
    "nessie_account_id": "n_chk",
    "clabe": clabe.from_account_number("5550000000001111"),
    "balance_cents": 0,
}


def _nessie_404(*args):
    request = httpx.Request("GET", "http://api.nessieisreal.com/customers/x")
    raise httpx.HTTPStatusError("nope", request=request, response=httpx.Response(404, request=request))


def _stub(monkeypatch, customer, accounts_by_call):
    calls = iter(accounts_by_call)
    last = []
    inserted = []

    def fetch_accounts(customer_id):
        last[:] = next(calls, last)
        return list(last)

    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)
    monkeypatch.setattr(repository, "fetch_customer", lambda customer_id: customer)
    monkeypatch.setattr(repository, "fetch_accounts", fetch_accounts)
    monkeypatch.setattr(repository, "insert_account", lambda row: inserted.append(row) or row)
    monkeypatch.setattr(repository, "sum_outgoing_transfer_holds_cents", lambda *a: 0)
    monkeypatch.setattr(repository, "sum_incoming_transfer_deposits_cents", lambda *a: 0)
    monkeypatch.setattr(accounts, "get_settings", lambda: SimpleNamespace(nessie_api_key="key"))
    return inserted


def test_savings_account_opens_in_nessie_with_an_ascii_name_and_a_clabe(monkeypatch):
    inserted = _stub(monkeypatch, NESSIE_CUSTOMER, [[NESSIE_CHECKING]])
    calls = []

    def create_account(customer_id, account_type, nickname, balance):
        calls.append((customer_id, account_type, nickname, balance))
        return {"_id": "n123", "type": "Savings", "nickname": nickname, "balance": 0, "account_number": "5550001234567891"}

    monkeypatch.setattr(nessie, "create_account", create_account)

    res = client.post("/accounts", json={"nickname": "  Viaje a   Cancún "})

    assert res.status_code == 201
    assert calls == [("abc", "Savings", "Viaje a Cancun", 0)]
    [row] = inserted
    assert row["id"] == "acc_nessie_n123"
    assert row["nickname"] == "Viaje a Cancún"
    assert row["type"] == "savings"
    assert row["last_four"] == "7891"
    assert clabe.is_valid(row["clabe"]) and clabe.last_four(row["clabe"]) == "7891"


def test_first_accounts_read_opens_checking_in_nessie_and_drops_the_empty_placeholder(monkeypatch):
    signup = {"id": "cus_abc", "first_name": "Ana Sofía", "last_name": "Treviño", "nessie_customer_id": "fixture-made-up"}
    placeholder = {"id": "acc_checking_abc", "customer_id": "cus_abc", "nickname": "Cuenta de cheques", "nessie_account_id": None}
    opened = {
        "id": "acc_nessie_n9",
        "customer_id": "cus_abc",
        "nickname": "Cuenta de cheques",
        "nessie_account_id": "n9",
        "clabe": clabe.from_account_number("5550009999990042"),
        "balance_cents": 0,
    }
    _stub(monkeypatch, signup, [[placeholder], [opened]])
    created_customers, upserted, deleted, linked = [], [], [], []
    monkeypatch.setattr(nessie, "get_customer", _nessie_404)
    monkeypatch.setattr(
        nessie, "create_customer", lambda first, last, address: created_customers.append((first, last)) or {"_id": "nc1"}
    )
    monkeypatch.setattr(
        nessie,
        "create_account",
        lambda cid, kind, nickname, balance: {"_id": "n9", "type": kind, "balance": 0, "account_number": "5550009999990042"},
    )
    monkeypatch.setattr(repository, "update_customer", lambda cid, fields: linked.append(fields) or fields)
    monkeypatch.setattr(repository, "upsert_accounts", lambda rows: upserted.extend(rows) or rows)
    monkeypatch.setattr(repository, "account_has_activity", lambda account_id: False)
    monkeypatch.setattr(repository, "delete_account", deleted.append)

    res = client.get("/accounts")

    assert res.status_code == 200
    assert [a["id"] for a in res.json()] == ["acc_nessie_n9"]
    assert created_customers == [("Ana Sofia", "Trevino")]
    assert linked == [{"nessie_customer_id": "nc1"}]
    [row] = upserted
    assert row["type"] == "checking" and clabe.is_valid(row["clabe"])
    assert deleted == ["acc_checking_abc"]


def test_a_repeated_name_is_409(monkeypatch):
    inserted = _stub(monkeypatch, NESSIE_CUSTOMER, [[NESSIE_CHECKING]])

    res = client.post("/accounts", json={"nickname": "ahorro meta viaje"})

    assert res.status_code == 409
    assert inserted == []


def test_a_blank_name_is_422(monkeypatch):
    inserted = _stub(monkeypatch, NESSIE_CUSTOMER, [[NESSIE_CHECKING]])

    res = client.post("/accounts", json={"nickname": "   "})

    assert res.status_code == 422
    assert inserted == []
