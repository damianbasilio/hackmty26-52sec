from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from app import repository
from app.repository import CustomerResolutionError, SchemaOutdated

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
QUARANTINED_CUSTOMER = {
    "id": "cus_nessie_poisoned",
    "nessie_customer_id": "870d2c18",
    "created_at": "2026-08-01T00:00:00Z",
    "excluded_at": "2026-09-12T20:00:00Z",
    "exclusion_reason": "Renta de -95000000 centavos.",
}


class FakeQuery:
    def __init__(self, rows, missing_column=False):
        self.rows = list(rows)
        self.missing_column = missing_column

    def select(self, *a, **k):
        return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if r.get(field) == value]
        return self

    def is_(self, field, value):
        assert value == "null"
        self.rows = [r for r in self.rows if r.get(field) is None]
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
        if self.missing_column:
            raise APIError({"message": "column customers.excluded_at does not exist", "code": "42703"})
        return SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, customers, missing_column=False):
        self._customers = customers
        self._missing_column = missing_column

    def table(self, name):
        assert name == "customers"
        return FakeQuery(self._customers, self._missing_column)


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


def test_quarantined_customers_dont_make_the_choice_ambiguous(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(
        repository, "get_client", lambda: FakeClient([FIXTURE_CUSTOMER, QUARANTINED_CUSTOMER, SYNCED_CUSTOMER_A])
    )

    result = repository.fetch_current_customer()

    assert result["id"] == "cus_nessie_a"


def test_active_customer_id_never_serves_a_quarantined_customer(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings("cus_nessie_poisoned"))
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([QUARANTINED_CUSTOMER]))

    with pytest.raises(CustomerResolutionError, match="cuarentena"):
        repository.fetch_current_customer()


def test_missing_excluded_at_column_asks_for_the_schema(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: _settings())
    monkeypatch.setattr(repository, "get_client", lambda: FakeClient([SYNCED_CUSTOMER_A], missing_column=True))

    with pytest.raises(SchemaOutdated, match="db/schema.sql"):
        repository.fetch_current_customer()
