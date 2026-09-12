from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import nessie, nessie_sync, repository
from app.enrichment import normalize_merchant
from app.main import app
from app.routers import transfers as transfers_router

client = TestClient(app)

CUSTOMER_ID = "cus_nessie_ana"
PAYER = {
    "id": "acc_nessie_payer",
    "customer_id": CUSTOMER_ID,
    "nessie_account_id": "n_payer",
    "last_four": "1111",
    "balance_cents": 100000,
}
PAYEE = {
    "id": "acc_nessie_payee",
    "customer_id": "cus_nessie_beto",
    "nessie_account_id": "n_payee",
    "last_four": "2222",
    "balance_cents": 0,
}
# The fixture account carries a fabricated nessie_account_id, like the fixture customer.
FIXTURE_ACCOUNT = {
    "id": "acc_checking_0001",
    "customer_id": CUSTOMER_ID,
    "nessie_account_id": "317169ce3317169ce3317169",
    "last_four": "0001",
    "balance_cents": 2313600,
}


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.nessieisreal.com/x")
    return httpx.HTTPStatusError("nessie", request=request, response=httpx.Response(status, request=request))


class World:
    """In-memory Supabase + Nessie, patched over the real modules."""

    def __init__(self, monkeypatch):
        self.accounts = {a["id"]: dict(a) for a in (PAYER, PAYEE, FIXTURE_ACCOUNT)}
        self.transfers: dict[str, dict] = {}
        self.transactions: dict[str, dict] = {}
        # Nessie reports balances in pesos; 1000 == 100000 cents, same as PAYER.
        self.nessie_balances = {"n_payer": 1000, "n_payee": 0}
        self.withdrawals: dict[str, list[dict]] = {"n_payer": [], "n_payee": []}
        self.deposits: dict[str, list[dict]] = {"n_payer": [], "n_payee": []}
        self.withdrawal_failure: str | None = None
        self.deposit_failure: str | None = None
        self._next_id = 0

        m = monkeypatch
        m.setattr(transfers_router, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
        m.setattr(repository, "fetch_current_customer", lambda: {"id": CUSTOMER_ID})
        m.setattr(repository, "fetch_account", lambda account_id: self.accounts.get(account_id))
        m.setattr(
            repository,
            "fetch_customer",
            lambda customer_id: {"id": customer_id, "first_name": "Ana Sofía", "last_name": "Treviño"},
        )
        m.setattr(repository, "fetch_transfer", lambda transfer_id: self.transfers.get(transfer_id))
        m.setattr(repository, "insert_transfer", self._insert_transfer)
        m.setattr(repository, "update_transfer", self._update_transfer)
        m.setattr(repository, "sum_outgoing_transfer_holds_cents", self._holds)
        m.setattr(repository, "sum_incoming_transfer_deposits_cents", self._incoming)
        m.setattr(repository, "find_transaction_by_ref", self._find_by_ref)
        m.setattr(repository, "upsert_raw_transactions", self._upsert_transactions)
        m.setattr(nessie_sync, "enrich_account_transactions", lambda account_id: None)
        m.setattr(nessie, "get_account", lambda nid: {"_id": nid, "balance": self.nessie_balances[nid]})
        m.setattr(nessie, "get_withdrawals", lambda nid: list(self.withdrawals[nid]))
        m.setattr(nessie, "get_deposits", lambda nid: list(self.deposits[nid]))
        m.setattr(nessie, "create_withdrawal", self._create_withdrawal)
        m.setattr(nessie, "create_deposit", self._create_deposit)

    def _insert_transfer(self, row):
        if row["id"] in self.transfers:
            raise repository.DuplicateRow(row["id"])
        self.transfers[row["id"]] = {"nessie_transfer_id": None, "transaction_id": None, "failure_reason": None, **row}
        return dict(self.transfers[row["id"]])

    def _update_transfer(self, transfer_id, fields):
        self.transfers[transfer_id].update(fields)
        return dict(self.transfers[transfer_id])

    def _holds(self, account_id, exclude_transfer_id=None):
        return sum(
            t["amount_cents"]
            for t in self.transfers.values()
            if t["account_id"] == account_id
            and t["status"] in ("pending", "completed")
            and t["id"] != exclude_transfer_id
        )

    def _incoming(self, account_id, ref_marker):
        return sum(
            t["amount_cents"]
            for t in self.transactions.values()
            if t["account_id"] == account_id and t["amount_cents"] > 0 and ref_marker in t["raw_description"]
        )

    def _find_by_ref(self, account_id, ref):
        return next(
            (t for t in self.transactions.values() if t["account_id"] == account_id and t["raw_description"].endswith(ref)),
            None,
        )

    def _upsert_transactions(self, rows):
        for row in rows:
            self.transactions[row["id"]] = row
        return rows

    def _nessie_row(self, amount, day, description):
        self._next_id += 1
        return {
            "_id": f"n_txn_{self._next_id}",
            "medium": "balance",
            "amount": amount,
            "transaction_date": day,
            "status": "completed",
            "description": description,
        }

    def _create_withdrawal(self, nid, amount, day, description):
        failure, self.withdrawal_failure = self.withdrawal_failure, None
        if failure == "rejected":
            raise _http_error(400)
        if failure == "timeout":
            raise httpx.ReadTimeout("slow gateway")
        row = self._nessie_row(amount, day, description)
        self.withdrawals[nid].append(row)
        if failure == "timeout_after_apply":
            raise httpx.ReadTimeout("slow gateway")
        return row

    def _create_deposit(self, nid, amount, day, description):
        failure, self.deposit_failure = self.deposit_failure, None
        if failure == "timeout":
            raise httpx.ReadTimeout("slow gateway")
        row = self._nessie_row(amount, day, description)
        self.deposits[nid].append(row)
        return row


@pytest.fixture
def world(monkeypatch):
    return World(monkeypatch)


def _body(**overrides):
    body = {
        "id": "trf_test_0001",
        "account_id": PAYER["id"],
        "payee_account_id": PAYEE["id"],
        "payee_name": "Beto Garza",
        "amount_cents": 25050,
        "concept": "Tacos",
    }
    body.update(overrides)
    return body


def test_known_payee_gets_a_withdrawal_and_a_deposit(world):
    res = client.post("/transfers", json=_body())

    assert res.status_code == 200
    receipt = res.json()
    assert receipt["status"] == "completed"
    assert receipt["amount_cents"] == 25050
    assert len(world.withdrawals["n_payer"]) == 1
    assert len(world.deposits["n_payee"]) == 1
    # the float only exists on the wire to Nessie
    assert world.withdrawals["n_payer"][0]["amount"] == 250.5

    payer_row = world.transactions[receipt["transaction_id"]]
    assert payer_row["amount_cents"] == -25050
    assert payer_row["type"] == "transfer"
    assert receipt["payer_side"]["recorded"] is True
    assert receipt["payee_side"]["recorded"] is True
    assert world.transactions[receipt["payee_side"]["transaction_id"]]["amount_cents"] == 25050
    assert receipt["available_balance_cents"] == 100000 - 25050


def test_retrying_the_same_id_never_charges_twice(world):
    first = client.post("/transfers", json=_body())
    second = client.post("/transfers", json=_body())

    assert first.status_code == second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(world.withdrawals["n_payer"]) == 1
    assert len(world.deposits["n_payee"]) == 1


def test_timeout_after_nessie_applied_the_withdrawal_is_reconciled_on_retry(world):
    world.withdrawal_failure = "timeout_after_apply"

    first = client.post("/transfers", json=_body())

    assert first.status_code == 503
    assert world.transfers["trf_test_0001"]["status"] == "pending"

    second = client.post("/transfers", json=_body())

    assert second.status_code == 200
    assert second.json()["status"] == "completed"
    assert len(world.withdrawals["n_payer"]) == 1


def test_insufficient_funds_moves_nothing(world):
    res = client.post("/transfers", json=_body(amount_cents=100001))

    assert res.status_code == 422
    assert "Fondos insuficientes" in res.json()["detail"]
    assert world.withdrawals["n_payer"] == []
    assert world.transfers == {}


def test_pending_transfers_hold_their_funds(world):
    world.transfers["trf_other_0001"] = {
        "id": "trf_other_0001",
        "account_id": PAYER["id"],
        "payee_account_id": None,
        "amount_cents": 80000,
        "status": "pending",
    }

    res = client.post("/transfers", json=_body())

    assert res.status_code == 422
    assert world.withdrawals["n_payer"] == []


def test_external_payee_records_only_the_payer_side(world):
    res = client.post("/transfers", json=_body(payee_account_id=None, payee_bank="BBVA", payee_last_four="3390"))

    assert res.status_code == 200
    receipt = res.json()
    assert receipt["status"] == "completed"
    assert len(world.withdrawals["n_payer"]) == 1
    assert world.deposits["n_payee"] == []
    assert receipt["payer_side"]["recorded"] is True
    assert receipt["payee_side"]["recorded"] is False
    assert "BBVA" in receipt["payee_side"]["explanation"]


def test_reusing_an_id_for_a_different_amount_is_a_conflict(world):
    client.post("/transfers", json=_body())

    res = client.post("/transfers", json=_body(amount_cents=100))

    assert res.status_code == 409
    assert len(world.withdrawals["n_payer"]) == 1


def test_fixture_accounts_cannot_move_real_money(world):
    res = client.post("/transfers", json=_body(account_id=FIXTURE_ACCOUNT["id"]))

    assert res.status_code == 422
    assert "demostración" in res.json()["detail"]


def test_cannot_send_from_another_customers_account(world):
    res = client.post("/transfers", json=_body(account_id=PAYEE["id"], payee_account_id=PAYER["id"]))

    assert res.status_code == 422
    assert world.withdrawals["n_payee"] == []


def test_nessie_rejection_marks_the_transfer_failed_for_good(world):
    world.withdrawal_failure = "rejected"

    first = client.post("/transfers", json=_body())
    second = client.post("/transfers", json=_body())

    assert first.json()["status"] == "failed"
    assert "HTTP 400" in first.json()["failure_reason"]
    assert second.json()["status"] == "failed"
    assert world.withdrawals["n_payer"] == []


def test_float_amounts_are_rejected(world):
    res = client.post("/transfers", json=_body(amount_cents=250.5))

    assert res.status_code == 422
    assert world.transfers == {}


def test_pending_row_inserted_by_the_app_gets_completed(world):
    world.transfers["trf_test_0001"] = {
        "id": "trf_test_0001",
        "account_id": PAYER["id"],
        "payee_account_id": PAYEE["id"],
        "payee_name": "Beto Garza",
        "amount_cents": 25050,
        "status": "pending",
        "nessie_transfer_id": None,
        "transaction_id": None,
        "failure_reason": None,
    }

    res = client.post("/transfers", json=_body())

    assert res.json()["status"] == "completed"
    assert len(world.withdrawals["n_payer"]) == 1


def test_failed_deposit_is_reported_and_finished_by_a_retry(world):
    world.deposit_failure = "timeout"

    first = client.post("/transfers", json=_body())

    assert first.json()["status"] == "completed"
    assert first.json()["payee_side"]["recorded"] is False

    second = client.post("/transfers", json=_body())

    assert second.json()["payee_side"]["recorded"] is True
    assert len(world.withdrawals["n_payer"]) == 1
    assert len(world.deposits["n_payee"]) == 1


def test_accounts_report_balance_after_transfers(world, monkeypatch):
    monkeypatch.setattr(repository, "fetch_accounts", lambda customer_id: [world.accounts[PAYER["id"]], FIXTURE_ACCOUNT])
    client.post("/transfers", json=_body())

    balances = {a["id"]: a["balance_cents"] for a in client.get("/accounts").json()}

    assert balances[PAYER["id"]] == 100000 - 25050
    assert balances[FIXTURE_ACCOUNT["id"]] == FIXTURE_ACCOUNT["balance_cents"]


def test_transfer_descriptors_normalize_as_transfers_not_rent():
    assert normalize_merchant("SPEI ENVIADO BETO GARZA REF:trf_test_0001").category == "transfer"
    assert normalize_merchant("SPEI RECIBIDO ANA SOFIA TREVINO REF:trf_test_0001").category == "transfer"
    assert normalize_merchant("SPEI ENVIADO RENTA DEPTO").category == "housing"


def test_sync_maps_a_tagged_withdrawal_as_a_transfer():
    row = nessie_sync.map_withdrawal(
        "acc_nessie_payer",
        {"_id": "n1", "amount": 250.5, "description": "SPEI ENVIADO BETO REF:trf_test_0001", "transaction_date": "2026-09-12"},
    )

    assert row["type"] == "transfer"
    assert row["amount_cents"] == -25050
