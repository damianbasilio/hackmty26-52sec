from types import SimpleNamespace

import pytest

from app import repository
from app.repository import CustomerResolutionError

# The fixture customer carries a fabricated nessie_customer_id too (see
# contracts/fixtures/customers.json), so only the "cus_nessie_" id prefix
# nessie_sync.py actually writes can tell a real sync apart from it.
FIXTURE_CUSTOMER = {
    "id": "cus_0001",
    "nessie_customer_id": "1daa70b4a1daa70b4a1daa70",
    "created_at": "2026-07-01T00:00:00Z",
}
SYNCED_CUSTOMER_A = {
    "id": "cus_nessie_a",
    "nessie_customer_id": "n_a",
    "created_at": "2026-09-01T00:00:00Z",
}
SYNCED_CUSTOMER_B = {
    "id": "cus_nessie_b",
    "nessie_customer_id": "n_b",
    "created_at": "2026-09-05T00:00:00Z",
}


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *a, **k):
        return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if r.get(field) == value]
        return self

    def like(self, field, pattern):
        assert pattern.endswith("%")
        prefix = pattern[:-1]
        self.rows = [r for r in self.rows if str(r.get(field, "")).startswith(prefix)]
        return self

    def order(self, field, **k):
        self.rows = sorted(self.rows, key=lambda r: r.get(field))
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, customers):
        self._customers = customers

    def table(self, name):
        assert name == "customers"
        return FakeQuery(self._customers)


def _settings(active_customer_id: str = ""):
    return SimpleNamespace(active_customer_id=active_customer_id)


def test_active_customer_id_env_wins_over_everything(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings("cus_nessie_b"))
    monkeypatch.setattr(
        repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER, SYNCED_CUSTOMER_A, SYNCED_CUSTOMER_B])
    )

    result = repository.fetch_current_customer()

    assert result["id"] == "cus_nessie_b"


def test_active_customer_id_raises_when_not_found(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings("cus_does_not_exist"))
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER]))

    with pytest.raises(CustomerResolutionError):
        repository.fetch_current_customer()


def test_synced_customer_wins_over_fixture_customer_by_default(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER, SYNCED_CUSTOMER_A]))

    result = repository.fetch_current_customer()

    assert result["id"] == "cus_nessie_a"


def test_multiple_synced_customers_without_env_var_raises(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(
        repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER, SYNCED_CUSTOMER_A, SYNCED_CUSTOMER_B])
    )

    with pytest.raises(CustomerResolutionError):
        repository.fetch_current_customer()


def test_falls_back_to_fixture_customer_when_nothing_synced(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER]))

    result = repository.fetch_current_customer()

    assert result["id"] == "cus_0001"


def test_returns_none_when_no_customers_at_all(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([]))

    assert repository.fetch_current_customer() is None
