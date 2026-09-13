from datetime import date
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import bills, nessie, repository
from app.main import app
from app.models import Merchant
from app.subscriptions_engine import detect_subscriptions

client = TestClient(app)

ACCOUNT_ID = "acc_nessie_n_acc"
TODAY = date(2026, 9, 12)
DISNEY = Merchant(
    id="mer_disney-plus",
    normalized_name="disney-plus",
    display_name="Disney Plus",
    category="other",
    is_recurring_biller=False,
)


def _nessie_bill(**overrides):
    bill = {
        "_id": "n_bill_1",
        "status": "recurring",
        "payee": "Netflix",
        "nickname": "Netflix",
        "creation_date": "2026-06-10",
        "payment_date": "2026-09-10",
        "recurring_date": 10,
        "upcoming_payment_date": "2026-10-10",
        "payment_amount": 239,
        "account_id": "n_acc",
    }
    bill.update(overrides)
    return bill


@pytest.fixture
def nessie_bills(monkeypatch):
    served: list[dict] = []
    monkeypatch.setattr(bills, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
    monkeypatch.setattr(nessie, "get_bills", lambda nessie_account_id: served)
    monkeypatch.setattr(repository, "get_or_create_merchant", lambda payee: DISNEY)
    return served


def _by_name(subscriptions):
    return {s["merchant_display_name"]: s for s in subscriptions}


def test_fixture_account_never_asks_nessie_and_keeps_fixture_copy(
    monkeypatch, merchants, transactions, expected_subscriptions
):
    monkeypatch.setattr(bills, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
    monkeypatch.setattr(nessie, "get_bills", lambda nid: pytest.fail("fixture account has no bills"))

    result = bills.detect_with_bills("acc_checking_0001", transactions, merchants, {}, TODAY)

    assert result == detect_subscriptions("acc_checking_0001", transactions, merchants)
    expected = _by_name(expected_subscriptions)
    for name, sub in _by_name(result).items():
        assert sub["explanation"] == expected[name]["explanation"]


def test_a_bill_confirms_its_subscription_and_the_rest_say_inferred(
    nessie_bills, merchants, transactions, expected_subscriptions
):
    nessie_bills.append(_nessie_bill())

    result = _by_name(bills.detect_with_bills(ACCOUNT_ID, transactions, merchants, {}, TODAY))

    netflix = result["Netflix"]
    assert netflix["confidence"] == 0.99
    assert netflix["next_charge_on"] == "2026-10-10"
    assert netflix["explanation"].startswith("Confirmada: tu banco tiene un pago domiciliado a Netflix por $239.00.")
    assert _by_name(expected_subscriptions)["Netflix"]["explanation"] in netflix["explanation"]
    assert "no coincide" not in netflix["explanation"]
    for name in ("Spotify", "Telmex", "Smart Fit"):
        assert result[name]["explanation"].startswith("Inferida de tu historial"), name


def test_a_bill_that_disagrees_with_the_last_charge_says_so(nessie_bills, merchants, transactions):
    nessie_bills.append(_nessie_bill(payment_amount=199))

    netflix = _by_name(bills.detect_with_bills(ACCOUNT_ID, transactions, merchants, {}, TODAY))["Netflix"]

    assert "lo domiciliado ($199.00) no coincide con el último cobro ($239.00)" in netflix["explanation"]


def test_a_bill_with_no_history_becomes_a_subscription(nessie_bills, merchants, transactions):
    nessie_bills.append(
        _nessie_bill(
            _id="n_bill_2", payee="Disney Plus", payment_amount=179, recurring_date=5, upcoming_payment_date=None
        )
    )
    existing_ids = {("mer_disney-plus", "monthly"): "sub_0099"}

    disney = _by_name(bills.detect_with_bills(ACCOUNT_ID, transactions, merchants, existing_ids, TODAY))["Disney Plus"]

    assert disney["id"] == "sub_0099"
    assert disney["cadence"] == "monthly"
    assert disney["amount_cents"] == 17900
    assert disney["annual_cost_cents"] == 17900 * 12
    assert disney["next_charge_on"] == "2026-10-05"
    assert disney["occurrence_count"] == 0
    assert disney["confidence"] == 0.99
    assert disney["explanation"].startswith("Confirmada: pago domiciliado a Disney Plus")


def test_cancelled_and_one_off_bills_confirm_nothing(nessie_bills, merchants, transactions):
    nessie_bills.append(_nessie_bill(status="cancelled"))
    nessie_bills.append(_nessie_bill(_id="n_bill_3", payee="Spotify", status="pending", recurring_date=None))

    result = _by_name(bills.detect_with_bills(ACCOUNT_ID, transactions, merchants, {}, TODAY))

    assert result["Netflix"]["explanation"].startswith("Inferida")
    assert result["Spotify"]["explanation"].startswith("Inferida")


def test_detect_route_persists_bill_confirmed_subscriptions(nessie_bills, monkeypatch, merchants, transactions):
    nessie_bills.append(_nessie_bill())
    captured = {}
    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: transactions)
    monkeypatch.setattr(repository, "fetch_merchants", lambda: merchants)
    monkeypatch.setattr(repository, "fetch_subscriptions", lambda account_id: [])
    monkeypatch.setattr(repository, "upsert_subscriptions", lambda rows: captured.setdefault("rows", rows))

    res = client.post("/subscriptions/detect", params={"account_id": ACCOUNT_ID})

    assert res.status_code == 200
    assert _by_name(captured["rows"])["Netflix"]["confidence"] == 0.99


def test_detect_route_fails_loudly_when_nessie_bills_are_unreachable(monkeypatch, merchants, transactions):
    def unreachable(nessie_account_id):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(bills, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
    monkeypatch.setattr(nessie, "get_bills", unreachable)
    monkeypatch.setattr(repository, "fetch_transactions", lambda account_id: transactions)
    monkeypatch.setattr(repository, "fetch_merchants", lambda: merchants)
    monkeypatch.setattr(repository, "fetch_subscriptions", lambda account_id: [])
    monkeypatch.setattr(repository, "upsert_subscriptions", lambda rows: pytest.fail("must not persist"))

    res = client.post("/subscriptions/detect", params={"account_id": ACCOUNT_ID})

    assert res.status_code == 502


pytestmark = pytest.mark.usefixtures("account_owner")
