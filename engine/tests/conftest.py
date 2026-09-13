import json
import os
from pathlib import Path

import pytest

# Route tests stub fetch_current_customer instead of minting Supabase tokens;
# test_auth.py turns the requirement back on to check the 401s.
os.environ["ENGINE_REQUIRE_AUTH"] = "false"

from app.models import Merchant, Transaction, parse_iso  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
ACCOUNT_ID = "acc_checking_0001"


def load_fixture(name: str) -> list[dict]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def account_owner(monkeypatch):
    """The caller owns whatever account_id the route gets, without touching Supabase."""
    from app import repository

    customer = load_fixture("customers")[0]
    monkeypatch.setattr(repository, "fetch_current_customer", lambda: customer)
    monkeypatch.setattr(repository, "fetch_account", lambda account_id: {"id": account_id, "customer_id": customer["id"]})
    return customer


@pytest.fixture
def merchants() -> dict[str, Merchant]:
    return {
        row["normalized_name"]: Merchant(
            id=row["id"],
            normalized_name=row["normalized_name"],
            display_name=row["display_name"],
            category=row["category"],
            is_recurring_biller=row["is_recurring_biller"],
        )
        for row in load_fixture("merchants")
    }


@pytest.fixture
def transactions() -> list[Transaction]:
    return [
        Transaction(
            id=row["id"],
            account_id=row["account_id"],
            amount_cents=row["amount_cents"],
            type=row["type"],
            status=row["status"],
            raw_description=row["raw_description"],
            occurred_at=parse_iso(row["occurred_at"]),
        )
        for row in load_fixture("transactions")
    ]


@pytest.fixture
def enriched_transactions() -> list[dict]:
    return load_fixture("enriched_transactions")


@pytest.fixture
def expected_subscriptions() -> list[dict]:
    return load_fixture("subscriptions")


@pytest.fixture
def expected_anomaly_alerts() -> list[dict]:
    return load_fixture("anomaly_alerts")


@pytest.fixture
def expected_cashflow_score() -> dict:
    return load_fixture("cashflow_scores")[0]
