import random
from datetime import timedelta

import pytest

from app import shield as protection
from app.shield_store import ShieldError, ShieldStore
from personas import NOW, generate, movement, random_clabe


def _card_testing(checking):
    merchants = ["STEREN PLAZA FIESTA", "GOOGLE PLAY GIFT CARD", "JOYERIA LA PERLA GALERIAS", "VOLARIS INTERNET", "BEST BUY SAN PEDRO"]
    return [movement(f"txn_card_{i}", checking.id, NOW - timedelta(minutes=10) + timedelta(seconds=40 * i),
                     -max(20_000, checking.balance_cents * pct // 100 // 10_000 * 10_000), "purchase", raw)
            for i, (raw, pct) in enumerate(zip(merchants, [2, 5, 14, 11, 20]))]


def _transfer_burst(checking):
    rng = random.Random(1)
    mules = [random_clabe(rng, "646"), random_clabe(rng, "638"), random_clabe(rng, "646")]
    return [movement(f"txn_burst_{i}", checking.id, NOW - timedelta(minutes=10) + timedelta(seconds=40 * i),
                     -(checking.balance_cents * pct // 100 // 10_000 * 10_000), "transfer",
                     f"SPEI ENVIADO PAGO SERVICIOS {i + 1}", mules[i % 3])
            for i, pct in enumerate([12, 14, 11, 16, 13])]


def _store_with(name: str, attack, now=NOW) -> tuple[ShieldStore, str]:
    accounts, history = generate()[name]
    store = ShieldStore()
    store.sync(f"cus_{name}", accounts, {accounts[0].id: history + attack(accounts[0])}, now)
    return store, f"cus_{name}"


def test_challenge_codes_expire_run_out_and_are_single_use():
    shield = protection.Shield("cus_x")
    challenge, code = protection.issue_challenge(shield, "release_protection", "shield", NOW)
    wrong = "000000" if code != "000000" else "111111"
    with pytest.raises(protection.VerificationError, match="2 intento"):
        protection.verify(shield, challenge["id"], wrong, "release_protection", "shield", NOW)
    with pytest.raises(protection.VerificationError, match="nuevo"):
        protection.verify(shield, challenge["id"], code, "confirm_legit", "shield", NOW)
    protection.verify(shield, challenge["id"], code, "release_protection", "shield", NOW)
    with pytest.raises(protection.VerificationError):
        protection.verify(shield, challenge["id"], code, "release_protection", "shield", NOW)

    challenge, code = protection.issue_challenge(shield, "release_protection", "shield", NOW)
    with pytest.raises(protection.VerificationError, match="expiró"):
        protection.verify(shield, challenge["id"], code, "release_protection", "shield", NOW + timedelta(minutes=6))

    challenge, code = protection.issue_challenge(shield, "release_protection", "shield", NOW)
    for _ in range(2):
        with pytest.raises(protection.VerificationError):
            protection.verify(shield, challenge["id"], wrong, "release_protection", "shield", NOW)
    with pytest.raises(protection.VerificationError, match="Demasiados"):
        protection.verify(shield, challenge["id"], wrong, "release_protection", "shield", NOW)


def test_critical_pattern_today_locks_the_card():
    store, customer = _store_with("ana", _card_testing)
    shield = store.shield_json(customer)
    assert shield["card_locked"] and shield["status"] == "protecting"
    assert shield["open_alerts"] == 1
    assert [e["kind"] for e in shield["timeline"]][:2] == ["card_locked", "alert"]


def test_an_old_pattern_is_shown_but_locks_nothing():
    store, customer = _store_with("ana", _card_testing, now=NOW + timedelta(days=3))
    shield = store.shield_json(customer)
    assert not shield["card_locked"] and shield["status"] == "attention"
    assert shield["timeline"] == []


def test_syncing_twice_does_not_duplicate_alerts():
    accounts, history = generate()["ana"]
    movements = {accounts[0].id: history + _transfer_burst(accounts[0])}
    store = ShieldStore()
    store.sync("cus_ana", accounts, movements, NOW)
    store.sync("cus_ana", accounts, movements, NOW)
    assert len(store.alerts("cus_ana")) == 1


def test_saying_it_was_me_needs_the_code_and_then_unlocks():
    store, customer = _store_with("ana", _card_testing)
    alert = store.alerts(customer)[0]
    with pytest.raises(ShieldError) as missing:
        store.resolve_alert(customer, alert["id"], {"resolution": "confirmed_legit"}, NOW)
    assert missing.value.status == 428

    challenge, code = store.request_challenge(customer, "confirm_legit", alert["id"], NOW)
    body = {"resolution": "confirmed_legit", "challenge_id": challenge["id"], "code": code}
    result = store.resolve_alert(customer, alert["id"], body, NOW)
    assert result["alert"]["resolution"] == "confirmed_legit"
    assert not result["shield"]["card_locked"]
    assert store.alerts(customer) == []


def test_saying_it_was_not_me_opens_a_case_with_the_payees():
    store, customer = _store_with("ana", _transfer_burst)
    alert = store.alerts(customer)[0]
    result = store.resolve_alert(customer, alert["id"], {"resolution": "confirmed_fraud"}, NOW)
    case = result["case"]
    assert case["id"].startswith("ACL-") and case["disputed_cents"] > 0
    assert result["shield"]["card_locked"]
    assert len(result["shield"]["blocked_clabes"]) == 3
    assert any("CONDUSEF" in step for step in case["next_steps"])
    with pytest.raises(ShieldError) as again:
        store.resolve_alert(customer, alert["id"], {"resolution": "dismissed"}, NOW)
    assert again.value.status == 409


def test_turning_protection_off_needs_the_code_turning_it_on_does_not():
    store = ShieldStore()
    with pytest.raises(ShieldError) as missing:
        store.update_settings("cus_x", {"auto_protect": False}, NOW)
    assert missing.value.status == 428
    challenge, code = store.request_challenge("cus_x", "change_settings", "settings", NOW)
    off = store.update_settings("cus_x", {"auto_protect": False, "challenge_id": challenge["id"], "code": code}, NOW)
    assert off["settings"]["auto_protect"] is False
    assert store.update_settings("cus_x", {"auto_protect": True}, NOW)["settings"]["auto_protect"] is True


def test_locking_is_free_unlocking_needs_the_code():
    store = ShieldStore()
    assert store.lock_card("cus_x", NOW)["card_locked"]
    with pytest.raises(ShieldError):
        store.release("cus_x", {}, NOW)
    challenge, code = store.request_challenge("cus_x", "release_protection", "shield", NOW)
    assert not store.release("cus_x", {"challenge_id": challenge["id"], "code": code}, NOW)["card_locked"]
    with pytest.raises(ShieldError) as nothing:
        store.request_challenge("cus_x", "release_protection", "shield", NOW)
    assert nothing.value.status == 404


def test_customers_never_see_each_other():
    store, ana = _store_with("ana", _card_testing)
    assert store.alerts("cus_luis") == []
    with pytest.raises(ShieldError) as other:
        store.resolve_alert("cus_luis", store.alerts(ana)[0]["id"], {"resolution": "dismissed"}, NOW)
    assert other.value.status == 404
