import random
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app.ledger import LedgerAccount, Movement
from app.sentinel_engine import Sentinel
from personas import NOW, generate, movement, random_clabe


def _replay(checking: LedgerAccount, movements: list[Movement]) -> tuple[Sentinel, list]:
    sentinel = Sentinel()
    balance = checking.balance_cents - sum(m.amount_cents for m in movements)
    fired = []
    for m in movements:
        balance += m.amount_cents
        fired += sentinel.observe(replace(checking, balance_cents=balance), m)
    return sentinel, fired


def _attack(checking: LedgerAccount, history: list[Movement], steps: list[tuple[int, str, str, str | None]]):
    sentinel, _ = _replay(checking, history)
    balance, fired = checking.balance_cents, []
    for i, (amount, kind, raw, payee) in enumerate(steps):
        balance += amount
        m = movement(f"txn_attack_{i}", checking.id, NOW + timedelta(seconds=40 * i), amount, kind, raw, payee)
        fired += sentinel.observe(replace(checking, balance_cents=balance), m)
    return sentinel, fired


@pytest.mark.parametrize("name", ["ana", "luis"])
def test_normal_history_raises_nothing(name):
    (checking, _), movements = generate()[name]
    assert _replay(checking, movements)[1] == []


def test_transfer_burst_opens_one_incident():
    (checking, _), history = generate()["ana"]
    rng = random.Random(1)
    mules = [random_clabe(rng, "646"), random_clabe(rng, "638"), random_clabe(rng, "646")]
    steps = [(-(checking.balance_cents * pct // 100 // 10_000 * 10_000), "transfer", f"SPEI ENVIADO PAGO SERVICIOS {i + 1}", mules[i % 3])
             for i, pct in enumerate([12, 14, 11, 16, 13])]
    sentinel, fired = _attack(checking, history, steps)
    assert fired
    alerts = list(sentinel.alerts.values())
    assert len(alerts) == 1
    assert "transfer_velocity" in {s["kind"] for s in alerts[0]["signals"]}
    assert alerts[0]["severity"] in ("warning", "critical")
    assert alerts[0]["id"].startswith("alr_shield_")


def test_stolen_card_hopping_giros_is_critical():
    (checking, _), history = generate()["ana"]
    merchants = ["STEREN PLAZA FIESTA", "GOOGLE PLAY GIFT CARD", "JOYERIA LA PERLA GALERIAS", "VOLARIS INTERNET", "BEST BUY SAN PEDRO"]
    steps = [(-max(20_000, checking.balance_cents * pct // 100 // 10_000 * 10_000), "purchase", raw, None)
             for raw, pct in zip(merchants, [2, 5, 14, 11, 20])]
    sentinel, _ = _attack(checking, history, steps)
    alert = next(iter(sentinel.alerts.values()))
    assert alert["severity"] == "critical"
    hop = next(s for s in alert["signals"] if s["kind"] == "category_hop")
    assert "Electrónica" in hop["evidence"]["sequence"]


def test_paying_rent_to_the_usual_clabe_is_never_flagged():
    (checking, _), history = generate()["ana"]
    landlord = next(m.payee_clabe for m in history if m.category == "housing")
    _, fired = _attack(checking, history, [(-(checking.balance_cents * 70 // 100), "transfer", "SPEI ENVIADO RENTA DEPTO", landlord)])
    assert fired == []


def test_off_hours_amplifies_a_real_signal():
    (checking, _), history = generate()["ana"]
    sentinel, _ = _replay(checking, history)
    three_am = datetime(2026, 9, 13, 9, 10, tzinfo=timezone.utc)  # 03:10 in Monterrey
    amount = checking.balance_cents * 60 // 100
    txn = movement("txn_night", checking.id, three_am, -amount, "transfer", "SPEI ENVIADO PAGO URGENTE",
                   random_clabe(random.Random(2), "646"))
    fired = sentinel.observe(replace(checking, balance_cents=checking.balance_cents - amount), txn)
    assert {"new_payee", "off_hours"} <= {s["kind"] for s in fired[-1][1]["signals"]}
