from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import nessie, nessie_sync, repository
from app.main import app
from app.repository import SchemaOutdated
from app.routers import sync as sync_router

client = TestClient(app)

# The three customers the real API key carries (ids shortened).
CLEAN = {"_id": "c5333ecf", "first_name": "Ana Sofía", "last_name": "Treviño Garza"}
POISONED = {"_id": "870d2c18", "first_name": "Ana Sofia", "last_name": "Trevi�o Garza"}
NO_ACCOUNTS = {"_id": "31715ba5", "first_name": "Ana Sofía", "last_name": "Treviño Garza"}

ACCOUNTS = {
    "c5333ecf": [{"_id": "n_acc_clean", "type": "Checking", "balance": 23136, "account_number": "7330275649798005"}],
    "870d2c18": [{"_id": "n_acc_poison", "type": "Checking", "balance": 23136, "account_number": "7878693342629523"}],
    "31715ba5": [],
}
TRANSFERS = {
    "n_acc_clean": [{"id": "t_rent_ok", "amount": 9500, "description": "SPEI ENVIADO RENTA DEPTO", "transaction_date": "2026-08-01"}],
    # the 100x rent from before the float fix
    "n_acc_poison": [{"id": "t_rent_100x", "amount": 950000, "description": "SPEI ENVIADO RENTA DEPTO", "transaction_date": "2026-08-01"}],
}


def _patch(monkeypatch, excluded):
    written = {"customers": [], "transactions": [], "pulled_accounts_for": []}

    def accounts_for(customer_id):
        written["pulled_accounts_for"].append(customer_id)
        return ACCOUNTS[customer_id]

    monkeypatch.setattr(nessie, "get_customers", lambda: [CLEAN, POISONED, NO_ACCOUNTS])
    monkeypatch.setattr(nessie, "get_accounts_for_customer", accounts_for)
    monkeypatch.setattr(nessie, "get_purchases", lambda nid: [])
    monkeypatch.setattr(nessie, "get_deposits", lambda nid: [])
    monkeypatch.setattr(nessie, "get_withdrawals", lambda nid: [])
    monkeypatch.setattr(nessie, "get_transfers", lambda nid: TRANSFERS[nid])
    monkeypatch.setattr(repository, "fetch_excluded_nessie_customers", lambda: excluded)
    monkeypatch.setattr(repository, "upsert_customer", lambda row: written["customers"].append(row) or row)
    monkeypatch.setattr(repository, "upsert_accounts", lambda rows: rows)
    monkeypatch.setattr(repository, "upsert_raw_transactions", lambda rows: written["transactions"].extend(rows))
    monkeypatch.setattr(nessie_sync, "enrich_account_transactions", lambda account_id: None)
    return written


def test_quarantined_customers_are_skipped_before_anything_is_pulled_or_written(monkeypatch):
    written = _patch(monkeypatch, {"870d2c18": "Renta 100x.", "31715ba5": "Sin cuentas."})

    result = nessie_sync.sync_all()

    assert result["customers"] == 1
    assert result["transactions"] == 1
    assert {e["nessie_customer_id"] for e in result["excluded"]} == {"870d2c18", "31715ba5"}
    assert result["suspicious"] == []
    assert written["pulled_accounts_for"] == ["c5333ecf"]
    assert [c["nessie_customer_id"] for c in written["customers"]] == ["c5333ecf"]
    assert all(abs(t["amount_cents"]) <= 50_000_000 for t in written["transactions"])


def test_unlisted_poison_is_reported_and_never_imported(monkeypatch):
    written = _patch(monkeypatch, {})

    result = nessie_sync.sync_all()

    suspicious = {s["nessie_customer_id"]: s["reasons"] for s in result["suspicious"]}
    assert set(suspicious) == {"870d2c18", "31715ba5"}
    assert any("corrupto" in r for r in suspicious["870d2c18"])
    assert any("-$950,000.00" in r for r in suspicious["870d2c18"])
    assert suspicious["31715ba5"] == ["No tiene ninguna cuenta."]
    assert [c["nessie_customer_id"] for c in written["customers"]] == ["c5333ecf"]
    assert [t["id"] for t in written["transactions"]] == ["txn_nessie_t_rent_ok"]


def test_sync_without_the_quarantine_table_is_a_503_not_a_silent_import(monkeypatch):
    def outdated():
        raise SchemaOutdated("la tabla excluded_nessie_customers")

    monkeypatch.setattr(sync_router, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
    monkeypatch.setattr(repository, "fetch_excluded_nessie_customers", outdated)
    monkeypatch.setattr(nessie, "get_customers", lambda: [POISONED])

    res = client.post("/sync/nessie")

    assert res.status_code == 503
    assert "db/schema.sql" in res.json()["detail"]
