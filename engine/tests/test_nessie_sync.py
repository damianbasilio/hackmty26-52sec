from datetime import datetime, timezone

from app import nessie, nessie_sync, repository

NESSIE_CUSTOMER = {
    "_id": "n_cus_1",
    "first_name": "Juan",
    "last_name": "Perez",
    "phone_number": "5512345678",
}
NESSIE_ACCOUNT = {
    "_id": "n_acc_1",
    "type": "Checking",
    "nickname": "Cuenta Nessie",
    "balance": 1234.56,
    "account_number": "0000123456789012",
}
NESSIE_PURCHASE = {
    "_id": "n_txn_purchase_1",
    "amount": 45.5,
    "status": "completed",
    "description": "OXXO TEC 4412 MTY",
    "purchase_date": "2026-01-05",
}
NESSIE_DEPOSIT = {
    "_id": "n_txn_deposit_1",
    "amount": 1000.0,
    "status": "completed",
    "description": "NOMINA",
    "transaction_date": "2026-01-01",
}
# Transfers are the one resource whose GET rows key off "id", not "_id", and
# carry no payer_id/payee_id — verified against the live API.
NESSIE_TRANSFER_OUT = {
    "id": "n_txn_transfer_1",
    "amount": 200.0,
    "status": "completed",
    "description": "TRANSFERENCIA",
    "transaction_date": "2026-01-02",
}


def _patch_nessie(monkeypatch):
    monkeypatch.setattr(nessie, "get_customers", lambda: [NESSIE_CUSTOMER])
    monkeypatch.setattr(nessie, "get_accounts_for_customer", lambda customer_id: [NESSIE_ACCOUNT])
    monkeypatch.setattr(nessie, "get_purchases", lambda account_id: [NESSIE_PURCHASE])
    monkeypatch.setattr(nessie, "get_deposits", lambda account_id: [NESSIE_DEPOSIT])
    monkeypatch.setattr(nessie, "get_withdrawals", lambda account_id: [])
    monkeypatch.setattr(nessie, "get_transfers", lambda account_id: [NESSIE_TRANSFER_OUT])


def _patch_repository(monkeypatch, written):
    monkeypatch.setattr(repository, "fetch_excluded_nessie_customers", lambda: {})
    monkeypatch.setattr(
        repository, "upsert_customer", lambda row: written.setdefault("customer", row) or row
    )
    monkeypatch.setattr(
        repository,
        "upsert_accounts",
        lambda rows: written.setdefault("accounts", rows) and rows,
    )
    monkeypatch.setattr(
        repository,
        "upsert_raw_transactions",
        lambda rows: written.setdefault("transactions", rows) and rows,
    )
    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: [])
    monkeypatch.setattr(repository, "fetch_merchants", lambda: {})
    monkeypatch.setattr(
        repository,
        "upsert_transaction_enrichment",
        lambda rows: written.setdefault("enrichment", rows),
    )


def test_sync_all_reports_counts(monkeypatch):
    _patch_nessie(monkeypatch)
    _patch_repository(monkeypatch, {})

    result = nessie_sync.sync_all()

    assert result == {"customers": 1, "accounts": 1, "transactions": 3, "excluded": [], "suspicious": []}


def test_amounts_convert_to_cents_exactly_once(monkeypatch):
    _patch_nessie(monkeypatch)
    written: dict = {}
    _patch_repository(monkeypatch, written)

    nessie_sync.sync_all()

    txns = {t["nessie_transaction_id"]: t for t in written["transactions"]}
    assert txns["n_txn_purchase_1"]["amount_cents"] == -4550
    assert txns["n_txn_deposit_1"]["amount_cents"] == 100000
    # A transfer only ever posts to the account it came from -> always money out.
    assert txns["n_txn_transfer_1"]["amount_cents"] == -20000
    for row in written["transactions"]:
        assert isinstance(row["amount_cents"], int)


def test_ids_are_deterministic_for_idempotent_upserts(monkeypatch):
    _patch_nessie(monkeypatch)
    written: dict = {}
    _patch_repository(monkeypatch, written)

    nessie_sync.sync_all()
    first_ids = sorted(t["id"] for t in written["transactions"])

    nessie_sync.sync_all()
    second_ids = sorted(t["id"] for t in written["transactions"])

    assert first_ids == second_ids


def test_account_last_four_is_always_four_digits(monkeypatch):
    _patch_nessie(monkeypatch)
    written: dict = {}
    _patch_repository(monkeypatch, written)

    nessie_sync.sync_all()

    last_four = written["accounts"][0]["last_four"]
    assert len(last_four) == 4
    assert last_four.isdigit()


def test_enrichment_uses_the_account_local_hour_and_day(monkeypatch):
    from app.models import Merchant, Transaction, parse_iso

    _patch_nessie(monkeypatch)
    written: dict = {}
    _patch_repository(monkeypatch, written)
    monkeypatch.setattr(
        repository,
        "get_or_create_merchant",
        lambda raw_description: Merchant(
            id="mer_oxxo", normalized_name="oxxo", display_name="OXXO",
            category="convenience", is_recurring_biller=False,
        ),
    )

    synced_txn = Transaction(
        id="txn_nessie_n_txn_purchase_1",
        account_id="acc_nessie_n_acc_1",
        amount_cents=-4550,
        type="purchase",
        status="completed",
        raw_description="OXXO TEC 4412 MTY",
        occurred_at=parse_iso("2026-01-05T00:00:00Z"),
    )
    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: [synced_txn])

    nessie_sync.sync_all()

    enrichment = written["enrichment"][0]
    assert enrichment["category"] == "convenience"
    assert enrichment["is_recurring"] is False
    assert 0 <= enrichment["hour_of_day"] <= 23
    assert 0 <= enrichment["day_of_week"] <= 6


def test_seed_demo_data_creates_a_customer_account_and_recognizable_merchants(monkeypatch):
    calls: dict = {"deposits": [], "transfers": [], "purchases": []}

    monkeypatch.setattr(
        nessie, "create_customer", lambda first, last, address: {"_id": "n_cus_seed"}
    )
    monkeypatch.setattr(
        nessie,
        "create_account",
        lambda customer_id, account_type, nickname, balance: {"_id": "n_acc_seed"},
    )
    monkeypatch.setattr(
        nessie, "create_merchant", lambda name: {"_id": f"n_mer_{name.lower()}"}
    )
    monkeypatch.setattr(
        nessie,
        "create_deposit",
        lambda account_id, amount, date, desc: calls["deposits"].append((amount, date, desc)),
    )
    monkeypatch.setattr(
        nessie,
        "create_transfer",
        lambda account_id, amount, date, desc: calls["transfers"].append((amount, date, desc)),
    )
    monkeypatch.setattr(
        nessie,
        "create_purchase",
        lambda account_id, merchant_id, amount, date, desc: calls["purchases"].append(
            (merchant_id, amount, date, desc)
        ),
    )

    result = nessie_sync.seed_demo_data(datetime(2026, 9, 12, tzinfo=timezone.utc))

    assert result == {"customer_id": "n_cus_seed", "account_id": "n_acc_seed"}
    assert len(calls["deposits"]) == len(nessie_sync._SEED_DEPOSITS)
    assert len(calls["transfers"]) == len(nessie_sync._SEED_TRANSFERS)
    expected_purchases = sum(
        len(occurrences)
        for _, occurrences in nessie_sync._SEED_RECURRING_PURCHASES + nessie_sync._SEED_VARIABLE_PURCHASES
    )
    assert len(calls["purchases"]) == expected_purchases
    # Every purchase description must be something enrichment.py already recognizes.
    from app.enrichment import normalize_merchant

    for _, _, _, description in calls["purchases"]:
        assert normalize_merchant(description).category != "other"
