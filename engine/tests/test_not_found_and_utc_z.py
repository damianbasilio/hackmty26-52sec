from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import repository
from app.main import app
from app.responses import to_utc_z

client = TestClient(app)


class NoMatchingRows:
    """An update on an id that doesn't exist: PostgREST answers 200 with no rows."""

    def table(self, name):
        return self

    def update(self, fields):
        return self

    def eq(self, field, value):
        return self

    def execute(self):
        return SimpleNamespace(data=[])


def test_resolving_an_unknown_alert_is_404_not_500(monkeypatch):
    monkeypatch.setattr(repository, "get_client", lambda: NoMatchingRows())

    res = client.post("/anomalies/alr_does_not_exist/resolve", params={"resolution": "dismissed"})

    assert res.status_code == 404
    assert "alr_does_not_exist" in res.json()["detail"]


def test_activating_an_unknown_savings_rule_is_404_not_500(monkeypatch):
    monkeypatch.setattr(repository, "get_client", lambda: NoMatchingRows())

    res = client.post(
        "/savings/rules/svr_does_not_exist/activate", params={"destination_account_id": "acc_savings_0001"}
    )

    assert res.status_code == 404


def test_supabase_offsets_leave_the_engine_as_z(monkeypatch):
    monkeypatch.setattr(
        repository,
        "fetch_current_customer",
        lambda: {"id": "cus_0001", "created_at": "2026-07-01T00:00:00+00:00"},
    )

    assert client.get("/customers/me").json()["created_at"] == "2026-07-01T00:00:00Z"


def test_nested_rows_and_fractional_seconds_are_normalized(monkeypatch):
    rows = [
        {
            "id": "txn_0001",
            "occurred_at": "2026-09-12T18:04:00.123456+00:00",
            "created_at": "2026-09-12T18:04:00+00:00",
            "raw_description": "PAGO 2026-09-12T18:04:00+00:00 REF",
        }
    ]
    monkeypatch.setattr(repository, "fetch_enriched_transactions", lambda *args: rows)

    [row] = client.get("/transactions", params={"account_id": "acc_checking_0001"}).json()

    assert row["occurred_at"] == "2026-09-12T18:04:00.123456Z"
    assert row["created_at"] == "2026-09-12T18:04:00Z"
    # only whole values are timestamps; text that merely contains one is left alone
    assert row["raw_description"] == "PAGO 2026-09-12T18:04:00+00:00 REF"


def test_only_utc_timestamps_are_rewritten():
    assert to_utc_z("2026-09-12") == "2026-09-12"
    assert to_utc_z("2026-09-12T12:04:00-06:00") == "2026-09-12T12:04:00-06:00"
    assert to_utc_z("2026-09-12T18:04:00Z") == "2026-09-12T18:04:00Z"
    assert to_utc_z({"a": [{"b": "2026-09-12T18:04:00+00:00"}], "n": 671}) == {
        "a": [{"b": "2026-09-12T18:04:00Z"}],
        "n": 671,
    }
