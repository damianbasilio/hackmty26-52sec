"""Merchant descriptor normalization and enrichment features.

Turns a raw bank descriptor (`OXXO TEC 4412 MTY`) into a normalized merchant
key (`oxxo`) plus a best-guess category, and computes the derived features
every engine needs: local-time buckets and per-merchant amount z-scores.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Fixed UTC-6 offset. Monterrey does not observe daylight saving time.
MX_TZ = timezone(timedelta(hours=-6))

_SPANISH_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


@dataclass(frozen=True)
class MerchantGuess:
    normalized_name: str
    display_name: str
    category: str
    is_recurring_biller: bool


# Ordered rules: first regex that matches the cleaned descriptor wins.
# Covers every merchant in /contracts/fixtures/merchants.json plus enough
# generality to normalize descriptors we have not seen yet.
_RULES: list[tuple[re.Pattern[str], MerchantGuess]] = [
    (re.compile(r"^oxxo\b"), MerchantGuess("oxxo", "OXXO", "convenience", False)),
    (re.compile(r"^soriana\b"), MerchantGuess("soriana", "Soriana", "groceries", False)),
    (re.compile(r"^chedraui\b"), MerchantGuess("chedraui", "Chedraui", "groceries", False)),
    (re.compile(r"^rappi\b|^rappi\*"), MerchantGuess("rappi", "Rappi", "delivery", False)),
    (re.compile(r"^didi\b|^didi\*"), MerchantGuess("didi", "DiDi", "transport", False)),
    (re.compile(r"^pemex\b"), MerchantGuess("pemex", "Pemex", "fuel", False)),
    (re.compile(r"^cfe\b"), MerchantGuess("cfe", "CFE", "utilities", True)),
    (re.compile(r"^telmex\b"), MerchantGuess("telmex", "Telmex", "telecom", True)),
    (re.compile(r"^spotify\b"), MerchantGuess("spotify", "Spotify", "streaming", True)),
    (re.compile(r"^netflix\b"), MerchantGuess("netflix", "Netflix", "streaming", True)),
    (re.compile(r"^smart ?fit\b"), MerchantGuess("smart-fit", "Smart Fit", "fitness", True)),
    (
        re.compile(r"^spei enviado renta|^renta depto\b"),
        MerchantGuess("renta-depto", "Renta Depto Contry", "housing", True),
    ),
    # after renta: "SPEI ENVIADO RENTA DEPTO" is the rent, not a P2P transfer
    (
        re.compile(r"^spei enviado\b"),
        MerchantGuess("spei-enviado", "Transferencia enviada", "transfer", False),
    ),
    (
        re.compile(r"^spei recibido\b"),
        MerchantGuess("spei-recibido", "Transferencia recibida", "transfer", False),
    ),
    (
        re.compile(r"^deposito nomina|^nomina\b"),
        MerchantGuess(
            "nomina-tecnologica-del-norte", "Nómina Tecnológica del Norte", "income", True
        ),
    ),
    (
        re.compile(r"^farmacias guadalajara\b"),
        MerchantGuess("farmacias-guadalajara", "Farmacias Guadalajara", "health", False),
    ),
    (re.compile(r"^starbucks\b"), MerchantGuess("starbucks", "Starbucks", "restaurants", False)),
    (
        re.compile(r"^amazon\b|^amzn\b"),
        MerchantGuess("amazon-mx", "Amazon México", "shopping", False),
    ),
    (re.compile(r"^cinepolis\b"), MerchantGuess("cinepolis", "Cinépolis", "shopping", False)),
    (
        re.compile(r"^comision manejo de cuenta\b"),
        MerchantGuess(
            "comision-manejo-de-cuenta", "Comisión por manejo de cuenta", "fees", True
        ),
    ),
]

_STORE_CODE_RE = re.compile(r"\b[a-z]?\d{2,}[a-z0-9]*\b")
_MULTISPACE_RE = re.compile(r"\s+")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _clean(raw_description: str) -> str:
    text = _strip_accents(raw_description).lower().strip()
    text = _STORE_CODE_RE.sub(" ", text)
    text = _MULTISPACE_RE.sub(" ", text).strip()
    return text


def _fallback_guess(cleaned: str) -> MerchantGuess:
    # Unknown descriptor: keep the first couple of words as the slug and
    # leave the category for a human/downstream classifier to fix.
    words = cleaned.split(" ")[:2]
    slug = _SLUG_RE.sub("-", " ".join(words)).strip("-") or "desconocido"
    display = " ".join(w.capitalize() for w in words) or "Desconocido"
    return MerchantGuess(slug, display, "other", False)


def normalize_merchant(raw_description: str) -> MerchantGuess:
    """Best-effort merchant normalization from a raw bank descriptor."""
    cleaned = _clean(raw_description)
    for pattern, guess in _RULES:
        if pattern.search(cleaned):
            return guess
    return _fallback_guess(cleaned)


def to_local(occurred_at: datetime) -> datetime:
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return occurred_at.astimezone(MX_TZ)


def local_hour_of_day(occurred_at: datetime) -> int:
    return to_local(occurred_at).hour


def local_day_of_week(occurred_at: datetime) -> int:
    """Sunday=0 .. Saturday=6, matching JS `Date.getDay()`."""
    return (to_local(occurred_at).weekday() + 1) % 7


def spanish_month_name(occurred_at: datetime) -> str:
    return _SPANISH_MONTHS[to_local(occurred_at).month - 1]


def population_zscores(amounts_cents: list[int]) -> list[float]:
    """Population z-score (ddof=0) of each amount against the whole list.

    Zero when there is no variance (a single value, or every value equal).
    """
    n = len(amounts_cents)
    if n == 0:
        return []
    mean = sum(amounts_cents) / n
    variance = sum((a - mean) ** 2 for a in amounts_cents) / n
    std = variance**0.5
    if std == 0:
        return [0.0 for _ in amounts_cents]
    return [round((a - mean) / std, 2) for a in amounts_cents]


def format_mxn(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    pesos, centavos = divmod(abs(cents), 100)
    return f"{sign}${pesos:,}.{centavos:02d}"
