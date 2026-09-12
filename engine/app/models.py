"""Internal dataclasses used between the Supabase repository and the engines.

Not the public API shape (that's /contracts/types.ts) — these are convenience
containers for computation. Routers serialize engine output into the exact
contract dicts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Merchant:
    id: str
    normalized_name: str
    display_name: str
    category: str
    is_recurring_biller: bool


@dataclass(frozen=True)
class Transaction:
    id: str
    account_id: str
    amount_cents: int
    type: str
    status: str
    raw_description: str
    occurred_at: datetime


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
