import json
from pathlib import Path

import pytest

from app.models import Merchant, Transaction, parse_iso

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
ACCOUNT_ID = "acc_checking_0001"


def load_fixture(name: str) -> list[dict]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


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
