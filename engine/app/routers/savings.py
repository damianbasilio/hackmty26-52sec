from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import repository
from ..savings_engine import suggest_savings_rules
from ..subscriptions_engine import detect_subscriptions

router = APIRouter(prefix="/savings", tags=["savings"])


@router.get("/rules")
def list_rules(account_id: str) -> list[dict]:
    """Active and suggested rules. Response shape: SavingsRule[] in /contracts/types.ts."""
    return repository.fetch_savings_rules(account_id)


@router.post("/suggest")
def suggest_rules(account_id: str) -> list[dict]:
    """Derive new savings suggestions from subscriptions and spending patterns."""
    account = repository.fetch_account(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Unknown account")

    transactions = repository.fetch_transactions(account_id)
    if not transactions:
        raise HTTPException(status_code=404, detail="No transactions for this account")

    merchants = repository.fetch_merchants()
    existing_subscriptions = repository.fetch_subscriptions(account_id)
    existing_subscription_ids = {
        (row["merchant_id"], row["cadence"]): row["id"] for row in existing_subscriptions
    }
    subscriptions = detect_subscriptions(account_id, transactions, merchants, existing_subscription_ids)
    existing_rules = repository.fetch_savings_rules(account_id)
    savings_account_id = repository.fetch_savings_account_id(account["customer_id"])

    suggestions = suggest_savings_rules(
        account_id,
        transactions,
        merchants,
        subscriptions,
        existing_rules,
        savings_account_id,
        datetime.now(timezone.utc),
    )
    return repository.upsert_savings_rules(suggestions)


@router.post("/rules/{rule_id}/activate")
def activate_rule(rule_id: str, destination_account_id: str) -> dict:
    activated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return repository.activate_savings_rule(rule_id, destination_account_id, activated_at)
