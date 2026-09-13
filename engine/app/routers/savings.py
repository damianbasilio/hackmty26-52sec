from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..auth import current_customer, owned_account_id, owns
from ..bills import detect_with_bills
from ..savings_engine import suggest_savings_rules

router = APIRouter(prefix="/savings", tags=["savings"])


@router.get("/rules")
def list_rules(account_id: str = Depends(owned_account_id)) -> list[dict]:
    """Active and suggested rules. Response shape: SavingsRule[] in /contracts/types.ts."""
    return repository.fetch_savings_rules(account_id)


@router.post("/suggest")
def suggest_rules(account_id: str = Depends(owned_account_id)) -> list[dict]:
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
    now = datetime.now(timezone.utc)
    subscriptions = detect_with_bills(account_id, transactions, merchants, existing_subscription_ids, now.date())
    existing_rules = repository.fetch_savings_rules(account_id)
    savings_account_id = repository.fetch_savings_account_id(account["customer_id"])

    suggestions = suggest_savings_rules(
        account_id,
        transactions,
        merchants,
        subscriptions,
        existing_rules,
        savings_account_id,
        now,
    )
    return repository.upsert_savings_rules(suggestions)


@router.post("/rules/{rule_id}/activate")
def activate_rule(rule_id: str, destination_account_id: str, customer: dict = Depends(current_customer)) -> dict:
    existing = repository.fetch_savings_rule(rule_id)
    if existing is None or not owns(existing["account_id"], customer):
        raise HTTPException(status_code=404, detail=f"No existe la regla de ahorro {rule_id}")
    if not owns(destination_account_id, customer):
        raise HTTPException(status_code=422, detail="El ahorro solo puede ir a una cuenta tuya.")
    activated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rule = repository.activate_savings_rule(rule_id, destination_account_id, activated_at)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"No existe la regla de ahorro {rule_id}")
    return rule
