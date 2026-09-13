from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import repository, splits, transfers
from app.main import app
from app.routers import splits as splits_router

client = TestClient(app)

CREATOR = {"id": "cus_nessie_ana", "first_name": "Ana Sofía"}
CREATOR_ACCOUNT = {
    "id": "acc_nessie_ana",
    "customer_id": CREATOR["id"],
    "nessie_account_id": "n_ana",
    "last_four": "1111",
    "balance_cents": 100000,
}
BETO_ACCOUNT = {
    "id": "acc_nessie_beto",
    "customer_id": "cus_nessie_beto",
    "nessie_account_id": "n_beto",
    "last_four": "2222",
    "balance_cents": 100000,
}
FIXTURE_ACCOUNT = {
    "id": "acc_checking_0001",
    "customer_id": CREATOR["id"],
    "nessie_account_id": "317169ce3317169ce3317169",
    "last_four": "0001",
    "balance_cents": 2313600,
}


class World:
    def __init__(self, monkeypatch):
        self.accounts = {a["id"]: a for a in (CREATOR_ACCOUNT, BETO_ACCOUNT, FIXTURE_ACCOUNT)}
        self.splits: dict[str, dict] = {}
        self.participants: dict[str, dict] = {}
        self.transfer_calls: list = []
        self.transfer_status = "completed"
        self.now = datetime(2026, 9, 12, 18, 0, tzinfo=timezone.utc)
        self.caller = CREATOR

        m = monkeypatch
        m.setattr(splits_router, "get_settings", lambda: SimpleNamespace(nessie_api_key="k"))
        m.setattr(splits_router, "datetime", SimpleNamespace(now=lambda tz: self.now))
        m.setattr(repository, "fetch_current_customer", lambda: self.caller)
        m.setattr(repository, "fetch_account", lambda account_id: self.accounts.get(account_id))
        m.setattr(
            repository,
            "fetch_customer",
            lambda customer_id: {"id": customer_id} if customer_id.startswith("cus_") else None,
        )
        m.setattr(repository, "fetch_split", lambda split_id: self.splits.get(split_id))
        m.setattr(repository, "fetch_open_split_by_code", self._open_by_code)
        m.setattr(repository, "insert_split", self._insert_split)
        m.setattr(repository, "update_split", self._update(self.splits))
        m.setattr(repository, "fetch_split_participants", self._participants_of)
        m.setattr(repository, "fetch_split_participant", lambda pid: self.participants.get(pid))
        m.setattr(repository, "insert_split_participant", self._insert_participant)
        m.setattr(repository, "update_split_participant", self._update(self.participants))
        m.setattr(transfers, "execute_transfer", self._execute_transfer)

    def _open_by_code(self, code):
        return next((s for s in self.splits.values() if s["code"] == code and s["status"] == "open"), None)

    def _insert_split(self, row):
        if row["id"] in self.splits or self._open_by_code(row["code"]):
            raise repository.DuplicateRow(row["id"])
        self.splits[row["id"]] = dict(row, settled_at=None)
        return dict(self.splits[row["id"]])

    def _participants_of(self, split_id):
        return [dict(p) for p in self.participants.values() if p["split_request_id"] == split_id]

    def _insert_participant(self, row):
        if row["id"] in self.participants:
            raise repository.DuplicateRow(row["id"])
        self.participants[row["id"]] = {"paid_at": None, "transfer_id": None, **row}
        return dict(self.participants[row["id"]])

    @staticmethod
    def _update(table):
        def update(row_id, fields):
            table[row_id].update(fields)
            return dict(table[row_id])

        return update

    def _execute_transfer(self, req, payer_customer_id, now):
        self.transfer_calls.append(req)
        return {"id": req.id, "status": self.transfer_status, "amount_cents": req.amount_cents}


@pytest.fixture
def world(monkeypatch):
    return World(monkeypatch)


def _create(total_cents=10001, **overrides):
    body = {"id": "spl_test_0001", "account_id": CREATOR_ACCOUNT["id"], "title": "Tacos", "total_cents": total_cents}
    body.update(overrides)
    return client.post("/splits", json=body)


def _as(world, customer_id, send):
    world.caller = {"id": customer_id}
    try:
        return send()
    finally:
        world.caller = CREATOR


def _join(world, participant_id, name, **overrides):
    code = next(iter(world.splits.values()))["code"]
    body = {"code": code, "participant_id": participant_id, "display_name": name}
    body.update(overrides)
    return _as(world, f"cus_nessie_{name.lower()}", lambda: client.post("/splits/join", json=body))


def _pay(world, participant_id, transfer_id="trf_split_0001", account_id=BETO_ACCOUNT["id"], payer="cus_nessie_beto"):
    return _as(
        world,
        payer,
        lambda: client.post(
            f"/splits/spl_test_0001/participants/{participant_id}/pay",
            json={"transfer_id": transfer_id, "account_id": account_id},
        ),
    )


def test_create_opens_a_split_with_a_code_and_a_paid_creator(world):
    res = _create()

    assert res.status_code == 200
    split = res.json()
    assert len(split["code"]) == 4 and split["code"].isdigit()
    assert split["code_active"] is True
    [creator] = split["participants"]
    assert creator["is_creator"] is True
    assert creator["share_cents"] == 10001
    assert creator["paid_at"] is not None
    assert split["outstanding_cents"] == 0


def test_create_is_idempotent_by_id(world):
    first = _create().json()
    second = _create().json()

    assert second["code"] == first["code"]
    assert len(world.splits) == 1
    assert len(world.participants) == 1


def test_reusing_a_split_id_for_another_total_is_a_conflict(world):
    _create()

    assert _create(total_cents=500).status_code == 409


def test_code_collision_rolls_a_new_code(world, monkeypatch):
    world.splits["spl_other_0001"] = {"id": "spl_other_0001", "code": "4821", "status": "open"}
    codes = iter(["4821", "7310"])
    monkeypatch.setattr(splits, "new_code", lambda: next(codes))

    assert _create().json()["code"] == "7310"


def test_fixture_accounts_cannot_collect_real_money(world):
    assert _create(account_id=FIXTURE_ACCOUNT["id"]).status_code == 422


def test_joining_splits_evenly_with_leftover_cents_to_the_earliest(world):
    _create(total_cents=10001)
    world.now += timedelta(seconds=10)
    _join(world, "spp_beto_0001", "Beto")
    world.now += timedelta(seconds=10)
    res = _join(world, "spp_luis_0001", "Luis")

    shares = [p["share_cents"] for p in res.json()["split"]["participants"]]
    assert shares == [3334, 3334, 3333]
    assert sum(shares) == 10001
    assert res.json()["participant"]["share_cents"] == 3333


def test_joining_twice_returns_the_same_participant(world):
    _create()
    _join(world, "spp_beto_0001", "Beto")
    _join(world, "spp_beto_0001", "Beto")

    assert len(world.participants) == 2


def test_unknown_code_is_404_and_expired_code_is_410(world):
    real_code = _create().json()["code"]
    unknown_code = "0000" if real_code != "0000" else "1111"

    assert _join(world, "spp_beto_0001", "Beto", code=unknown_code).status_code == 404

    world.now += splits.CODE_TTL + timedelta(seconds=1)
    assert _join(world, "spp_beto_0001", "Beto").status_code == 410


def test_nobody_joins_after_someone_paid(world):
    _create()
    _join(world, "spp_beto_0001", "Beto")
    _join(world, "spp_luis_0001", "Luis")
    _pay(world, "spp_beto_0001")

    # Luis hasn't paid, so the split is still open — but the shares are frozen
    assert _join(world, "spp_carla_0001", "Carla").status_code == 409


def test_paying_a_share_transfers_it_into_the_split_account_and_settles(world):
    _create(total_cents=10000)
    _join(world, "spp_beto_0001", "Beto")

    res = _pay(world, "spp_beto_0001")

    assert res.status_code == 200
    [call] = world.transfer_calls
    assert call.amount_cents == 5000
    assert call.account_id == BETO_ACCOUNT["id"]
    assert call.payee_account_id == CREATOR_ACCOUNT["id"]
    split = res.json()["split"]
    assert split["status"] == "settled"
    assert split["outstanding_cents"] == 0
    assert world.participants["spp_beto_0001"]["transfer_id"] == "trf_split_0001"


def test_retrying_a_payment_replays_the_same_transfer(world):
    _create(total_cents=10000)
    _join(world, "spp_beto_0001", "Beto")
    _pay(world, "spp_beto_0001")

    res = _pay(world, "spp_beto_0001")

    assert res.status_code == 200
    assert {call.id for call in world.transfer_calls} == {"trf_split_0001"}
    assert _pay(world, "spp_beto_0001", transfer_id="trf_split_0002").status_code == 409


def test_a_failed_transfer_leaves_the_share_unpaid(world):
    _create(total_cents=10000)
    _join(world, "spp_beto_0001", "Beto")
    world.transfer_status = "failed"

    res = _pay(world, "spp_beto_0001")

    assert res.json()["transfer"]["status"] == "failed"
    assert world.participants["spp_beto_0001"]["paid_at"] is None
    assert res.json()["split"]["status"] == "open"


def test_the_creator_does_not_pay_themselves(world):
    _create()

    assert _pay(world, "spp_spl_test_0001_creator").status_code == 422
    assert world.transfer_calls == []


def test_a_known_participant_pays_only_from_their_own_account(world):
    _create()
    _join(world, "spp_luis_0001", "Luis", customer_id="cus_nessie_beto")

    assert _pay(world, "spp_luis_0001").status_code == 422
    assert world.transfer_calls == []


def test_nobody_pays_from_an_account_that_isnt_theirs(world):
    _create()
    _join(world, "spp_beto_0001", "Beto")

    assert _pay(world, "spp_beto_0001", payer="cus_nessie_luis").status_code == 422
    assert world.transfer_calls == []


def test_the_joiner_is_whoever_calls_not_the_body(world):
    _create()
    _join(world, "spp_luis_0001", "Luis", customer_id=CREATOR["id"])

    assert world.participants["spp_luis_0001"]["customer_id"] == "cus_nessie_luis"
