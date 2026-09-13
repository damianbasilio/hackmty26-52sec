"""Movements as the forecast and shield engines read them.

Built from enriched_transactions plus the transfers table. Two refinements on top
of the merchant enrichment, local to these engines:
- a SPEI keeps the person's name as counterparty (and the CLABE when we sent it):
  `spei-enviado` alone would make every payee look like the one you always pay.
- the four categories a stolen card shops in (electronics, jewelry, gift cards,
  travel) are split out of `other`, or a card-testing run reads as one giro.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime

from . import repository, transfers
from .enrichment import normalize_merchant, to_local
from .models import parse_iso

CATEGORY_LABELS = {
    "groceries": "Súper",
    "convenience": "Tiendas de conveniencia",
    "restaurants": "Restaurantes y café",
    "delivery": "Comida a domicilio",
    "transport": "Transporte",
    "fuel": "Gasolina",
    "utilities": "Luz y agua",
    "telecom": "Internet y telefonía",
    "streaming": "Streaming",
    "fitness": "Gimnasio",
    "housing": "Vivienda",
    "health": "Salud",
    "shopping": "Compras",
    "education": "Educación",
    "insurance": "Seguros",
    "fees": "Comisiones",
    "income": "Ingresos",
    "transfer": "Transferencias",
    "cash": "Efectivo",
    "other": "Otros",
    "electronics": "Electrónica",
    "jewelry": "Joyería",
    "gift_cards": "Tarjetas de regalo",
    "travel": "Viajes",
}

INCOME_CATEGORIES = {"income"}
# never suggested as something to pause or cut
ESSENTIAL_CATEGORIES = {"housing", "utilities", "telecom", "health", "insurance", "education", "fees", "groceries"}
# what a person can pause this month without consequences beyond losing the service
PAUSABLE_CATEGORIES = {"streaming", "fitness"}

_SHIELD_CATEGORIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^best buy|^apple store|^steren"), "electronics"),
    (re.compile(r"^joyeria\b"), "jewelry"),
    (re.compile(r"gift ?card|tarjeta regalo|^google play|^xbox|^playstation"), "gift_cards"),
    (re.compile(r"^aeromexico|^volaris|^vivaaerobus|^booking"), "travel"),
]
_SPEI = re.compile(r"^spei (enviado|recibido) (.+)")
_REF = re.compile(r"\s+REF:\S+$")
_SLUG = re.compile(r"[^a-z0-9]+")
_STORE_CODE = re.compile(r"\b[a-z]?\d{2,}[a-z0-9]*\b")
_NESSIE_ACCOUNT_ID_PREFIX = "acc_nessie_"

_SPANISH_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


@dataclass(frozen=True)
class Movement:
    id: str
    account_id: str
    # positive = money in, negative = money out
    amount_cents: int
    type: str
    status: str
    raw_description: str
    occurred_at: datetime
    # merchant or payee key, e.g. "rappi" or "mariana-lopez"
    counterparty: str
    category: str
    display_name: str
    payee_clabe: str | None = None


@dataclass
class LedgerAccount:
    id: str
    customer_id: str
    nickname: str
    type: str
    last_four: str
    clabe: str | None
    balance_cents: int


def category_label(category: str) -> str:
    return CATEGORY_LABELS.get(category, CATEGORY_LABELS["other"])


def spanish_day(day: date | datetime) -> str:
    return f"{day.day} de {_SPANISH_MONTHS[day.month - 1]}"


def spanish_time(moment: datetime) -> str:
    local = to_local(moment)
    period = "AM" if local.hour < 12 else "PM"
    return f"{local.hour % 12 or 12}:{local.minute:02d} {period}"


def _clean(raw: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", raw) if not unicodedata.combining(c)).lower()
    return " ".join(_STORE_CODE.sub(" ", text).split())


def classify(raw_description: str, category: str | None = None, display_name: str | None = None) -> tuple[str, str, str]:
    """raw descriptor (+ what enrichment already stored) -> (counterparty, category, display name)."""
    raw = _REF.sub("", raw_description)
    cleaned = _clean(raw)
    if spei := _SPEI.match(cleaned):
        name = spei.group(2)
        # the rent goes by SPEI too, and enrichment already knows it
        guess = normalize_merchant(raw)
        if guess.category not in ("transfer", "other"):
            return guess.normalized_name, category or guess.category, display_name or guess.display_name
        slug = _SLUG.sub("-", name).strip("-") or "desconocido"
        return slug, category or guess.category, " ".join(w.capitalize() for w in name.split())
    guess = normalize_merchant(raw)
    resolved = category or guess.category
    if resolved == "other":
        resolved = next((c for pattern, c in _SHIELD_CATEGORIES if pattern.search(cleaned)), "other")
    return guess.normalized_name, resolved, display_name or guess.display_name


def movement_from_row(row: dict, payee_clabe: str | None = None) -> Movement:
    counterparty, category, display = classify(row["raw_description"], row.get("category"), row.get("merchant_display_name"))
    return Movement(
        id=row["id"],
        account_id=row["account_id"],
        amount_cents=row["amount_cents"],
        type=row["type"],
        status=row["status"],
        raw_description=row["raw_description"],
        occurred_at=parse_iso(row["occurred_at"]),
        counterparty=counterparty,
        category=category,
        display_name=display,
        payee_clabe=payee_clabe,
    )


def load_accounts(customer_id: str) -> list[LedgerAccount]:
    return [
        LedgerAccount(
            id=a["id"],
            customer_id=a["customer_id"],
            nickname=a["nickname"],
            type=a["type"],
            last_four=a["last_four"],
            clabe=a.get("clabe"),
            # same number /accounts shows: Nessie's balance doesn't move when a transfer leaves
            balance_cents=transfers.available_balance_cents(a["id"], a["balance_cents"])
            if a["id"].startswith(_NESSIE_ACCOUNT_ID_PREFIX) and a.get("nessie_account_id")
            else a["balance_cents"],
        )
        for a in repository.fetch_accounts(customer_id)
    ]


def load_movements(account_id: str) -> list[Movement]:
    clabes = {
        t["transaction_id"]: t["payee_clabe"]
        for t in repository.fetch_transfers(account_id)
        if t.get("transaction_id") and t.get("payee_clabe")
    }
    rows = repository.fetch_enriched_transactions(account_id, None, None, None)
    return sorted((movement_from_row(r, clabes.get(r["id"])) for r in rows), key=lambda m: m.occurred_at)
