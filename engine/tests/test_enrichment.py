import json
from pathlib import Path

from app.enrichment import normalize_merchant

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


def _merchants() -> list[dict]:
    return json.loads((FIXTURES / "merchants.json").read_text(encoding="utf-8"))


def test_fixture_merchants_present():
    merchants = _merchants()
    assert len(merchants) == 18


def test_normalize_matches_every_fixture_merchant():
    for merchant in _merchants():
        for raw in merchant["raw_descriptor_samples"]:
            guess = normalize_merchant(raw)
            assert guess.normalized_name == merchant["normalized_name"], raw
            assert guess.category == merchant["category"], raw
