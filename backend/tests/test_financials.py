from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from services import financials


def _sample_row(period_type: str, period_end: str, fiscal_year: int, fiscal_quarter=None, fetched_at=None, **overrides):
    base = {
        "ticker": "AAPL",
        "period_type": period_type,
        "period_end": period_end,
        "fiscal_year": fiscal_year,
        "fiscal_quarter": fiscal_quarter,
        "revenue": 100.0,
        "gross_profit": 40.0,
        "op_expenses": 15.0,
        "operating_income": 25.0,
        "net_income": 20.0,
        "diluted_eps": 1.25,
        "shares_outstanding": 1000,
        "current_price": 200.0,
        "year_end_price": 180.0 if period_type == "annual" else None,
        "fetched_at": fetched_at or datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }
    base.update(overrides)
    return base


def test_build_statement_rows_derives_op_expenses_and_eps():
    stmt = pd.DataFrame({
        pd.Timestamp("2024-12-31"): {
            "Total Revenue": 150_000_000,
            "Gross Profit": 60_000_000,
            "Operating Income": 20_000_000,
            "Net Income": 15_000_000,
        },
        pd.Timestamp("2023-12-31"): {
            "Total Revenue": 120_000_000,
            "Gross Profit": 48_000_000,
            "Operating Income": 16_000_000,
            "Net Income": 12_000_000,
        },
    })

    rows = financials._build_statement_rows(
        stmt,
        "AAPL",
        "annual",
        shares_outstanding=10_000_000,
        current_price=180.5,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )

    assert [row["fiscal_year"] for row in rows] == [2023, 2024]
    assert [row["op_expenses"] for row in rows] == [32.0, 40.0]
    assert [row["diluted_eps"] for row in rows] == [1.2, 1.5]


def test_build_financial_response_returns_nested_and_legacy_shapes():
    rows = [
        _sample_row("annual", "2023-12-31", 2023, year_end_price=175.0),
        _sample_row("annual", "2024-12-31", 2024, year_end_price=205.0),
        _sample_row("quarterly", "2024-03-31", 2024, fiscal_quarter=1, revenue=90.0, year_end_price=None),
        _sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2, revenue=95.0, year_end_price=None),
    ]

    payload = financials.build_financial_response("AAPL", rows)

    assert payload["annual"]["periods"] == ["2023", "2024"]
    assert payload["quarterly"]["periods"] == ["2024 Q1", "2024 Q2"]
    assert payload["years"] == ["2023", "2024"]
    assert payload["year_end_prices"] == [175.0, 205.0]
    assert payload["current_price"] == 200.0


def test_build_financial_response_limits_and_sorts_periods():
    rows = []
    for year in range(2018, 2026):
        rows.append(_sample_row("annual", f"{year}-12-31", year, year_end_price=float(year)))
    for quarter_idx, period_end in enumerate([
        "2020-03-31", "2020-06-30", "2020-09-30", "2020-12-31",
        "2021-03-31", "2021-06-30", "2021-09-30", "2021-12-31",
        "2022-03-31", "2022-06-30", "2022-09-30", "2022-12-31",
        "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31",
        "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
        "2025-03-31", "2025-06-30",
    ], start=1):
        year = int(period_end[:4])
        fiscal_quarter = ((int(period_end[5:7]) - 1) // 3) + 1
        rows.append(_sample_row("quarterly", period_end, year, fiscal_quarter=fiscal_quarter, revenue=float(quarter_idx)))

    payload = financials.build_financial_response("AAPL", rows)

    assert payload["annual"]["periods"] == ["2022", "2023", "2024", "2025"]
    assert len(payload["quarterly"]["periods"]) == 16
    assert payload["quarterly"]["periods"][0] == "2021 Q3"
    assert payload["quarterly"]["periods"][-1] == "2025 Q2"


def test_cached_financials_need_refresh_checks_annual_and_quarterly_ttls():
    fresh = datetime.now(timezone.utc).isoformat()
    stale_annual = (datetime.now(timezone.utc) - timedelta(days=61)).isoformat()
    stale_quarterly = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()

    assert financials.cached_financials_need_refresh([
        _sample_row("annual", "2024-12-31", 2024, fetched_at=fresh),
        _sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2, fetched_at=fresh),
    ]) is False

    assert financials.cached_financials_need_refresh([
        _sample_row("annual", "2024-12-31", 2024, fetched_at=stale_annual),
        _sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2, fetched_at=fresh),
    ]) is True

    assert financials.cached_financials_need_refresh([
        _sample_row("annual", "2024-12-31", 2024, fetched_at=fresh),
        _sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2, fetched_at=stale_quarterly),
    ]) is True


def test_cached_financials_need_refresh_when_period_type_missing():
    fresh = datetime.now(timezone.utc).isoformat()
    annual_only = [_sample_row("annual", "2024-12-31", 2024, fetched_at=fresh)]
    quarterly_only = [_sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2, fetched_at=fresh)]

    assert financials.cached_financials_need_refresh(annual_only) is True
    assert financials.cached_financials_need_refresh(quarterly_only) is True


def test_get_financial_history_uses_cache_when_fresh(monkeypatch):
    cached_rows = [
        _sample_row("annual", "2024-12-31", 2024),
        _sample_row("quarterly", "2024-06-30", 2024, fiscal_quarter=2),
    ]

    monkeypatch.setattr(financials, "read_cached_financial_rows", lambda client, ticker: cached_rows)

    def fail_fetch(_ticker):
        raise AssertionError("live fetch should not be used for fresh cache")

    monkeypatch.setattr(financials, "fetch_live_financial_rows", fail_fetch)

    payload = financials.get_financial_history("AAPL", read_client=object(), write_client=object())
    assert payload["annual"]["periods"] == ["2024"]


def test_get_financial_history_refreshes_when_quarterly_missing(monkeypatch):
    cached_rows = [_sample_row("annual", "2024-12-31", 2024)]
    fresh_rows = [
        _sample_row("annual", "2024-12-31", 2024),
        _sample_row("quarterly", "2024-09-30", 2024, fiscal_quarter=3),
    ]

    responses = [cached_rows, fresh_rows]
    monkeypatch.setattr(financials, "read_cached_financial_rows", lambda client, ticker: responses.pop(0))
    monkeypatch.setattr(financials, "fetch_live_financial_rows", lambda ticker: (fresh_rows[:1], fresh_rows[1:]))
    monkeypatch.setattr(financials, "upsert_financial_rows", lambda client, rows: None)
    monkeypatch.setattr(financials, "prune_financial_rows", lambda client, ticker, rows: None)

    payload = financials.get_financial_history("AAPL", read_client=object(), write_client=object())
    assert payload["quarterly"]["periods"] == ["2024 Q3"]


def test_get_financial_history_refreshes_when_stale(monkeypatch):
    stale_rows = [
        _sample_row(
            "annual",
            "2024-12-31",
            2024,
            fetched_at=(datetime.now(timezone.utc) - timedelta(days=61)).isoformat(),
        ),
        _sample_row(
            "quarterly",
            "2024-06-30",
            2024,
            fiscal_quarter=2,
            fetched_at=(datetime.now(timezone.utc) - timedelta(days=15)).isoformat(),
        ),
    ]
    fresh_rows = [
        _sample_row("annual", "2024-12-31", 2024),
        _sample_row("quarterly", "2024-09-30", 2024, fiscal_quarter=3),
    ]
    calls = {"upserted": False, "pruned": False}

    responses = [stale_rows, fresh_rows]

    def fake_read(_client, _ticker):
        return responses.pop(0)

    monkeypatch.setattr(financials, "read_cached_financial_rows", fake_read)
    monkeypatch.setattr(financials, "fetch_live_financial_rows", lambda ticker: (fresh_rows[:1], fresh_rows[1:]))
    monkeypatch.setattr(financials, "upsert_financial_rows", lambda client, rows: calls.__setitem__("upserted", True))
    monkeypatch.setattr(financials, "prune_financial_rows", lambda client, ticker, rows: calls.__setitem__("pruned", True))

    payload = financials.get_financial_history("AAPL", read_client=object(), write_client=object())

    assert calls["upserted"] is True
    assert calls["pruned"] is True
    assert payload["quarterly"]["periods"] == ["2024 Q3"]


def test_get_financial_history_raises_when_cache_write_fails(monkeypatch):
    stale_rows = [
        _sample_row(
            "annual",
            "2024-12-31",
            2024,
            fetched_at=(datetime.now(timezone.utc) - timedelta(days=61)).isoformat(),
        ),
        _sample_row(
            "quarterly",
            "2024-06-30",
            2024,
            fiscal_quarter=2,
            fetched_at=(datetime.now(timezone.utc) - timedelta(days=15)).isoformat(),
        ),
    ]
    fresh_rows = [
        _sample_row("annual", "2025-12-31", 2025, year_end_price=210.0),
        _sample_row("quarterly", "2025-03-31", 2025, fiscal_quarter=1, revenue=123.0),
    ]

    monkeypatch.setattr(financials, "read_cached_financial_rows", lambda client, ticker: stale_rows)
    monkeypatch.setattr(financials, "fetch_live_financial_rows", lambda ticker: (fresh_rows[:1], fresh_rows[1:]))

    def boom(*_args, **_kwargs):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(financials, "upsert_financial_rows", boom)

    with pytest.raises(RuntimeError, match="db unavailable"):
        financials.get_financial_history("AAPL", read_client=object(), write_client=object())


class _TableStub:
    def __init__(self):
        self.operations = []
        self.upsert_payload = None
        self.on_conflict = None

    def upsert(self, payload, on_conflict=None):
        self.upsert_payload = payload
        self.on_conflict = on_conflict
        self.operations.append(("upsert", len(payload)))
        return self

    def delete(self):
        self.operations.append(("delete", None))
        return self

    def eq(self, key, value):
        self.operations.append(("eq", key, value))
        return self

    def lt(self, key, value):
        self.operations.append(("lt", key, value))
        return self

    def execute(self):
        self.operations.append(("execute", None))
        return self


class _ClientStub:
    def __init__(self):
        self.table_stub = _TableStub()
        self.last_table = None

    def table(self, name):
        self.last_table = name
        return self.table_stub


def test_upsert_financial_rows_uses_composite_conflict_key():
    client = _ClientStub()
    rows = [
        _sample_row("annual", "2024-12-31", 2024),
        _sample_row("quarterly", "2024-09-30", 2024, fiscal_quarter=3),
    ]

    financials.upsert_financial_rows(client, rows)

    assert client.last_table == financials.FINANCIALS_TABLE
    assert client.table_stub.on_conflict == "ticker,period_type,period_end"
    assert len(client.table_stub.upsert_payload) == 2


def test_read_cached_financial_rows_raises_clear_cache_error():
    class BrokenTable:
        def select(self, *_args, **_kwargs):
            raise RuntimeError("HTTP 404 Not Found")

    class BrokenClient:
        def table(self, _name):
            return BrokenTable()

    with pytest.raises(financials.FinancialsCacheError, match="ticker_financials"):
        financials.read_cached_financial_rows(BrokenClient(), "AAPL")


def test_ensure_financials_table_available_raises_clear_cache_error():
    class BrokenTable:
        def select(self, *_args, **_kwargs):
            raise RuntimeError("HTTP 404 Not Found")

    class BrokenClient:
        def table(self, _name):
            return BrokenTable()

    with pytest.raises(financials.FinancialsCacheError, match="Preflight check"):
        financials.ensure_financials_table_available(BrokenClient())


def test_prune_financial_rows_deletes_older_rows_per_period_type():
    client = _ClientStub()
    rows = [
        _sample_row("annual", "2021-12-31", 2021),
        _sample_row("annual", "2022-12-31", 2022),
        _sample_row("annual", "2023-12-31", 2023),
        _sample_row("annual", "2024-12-31", 2024),
        _sample_row("annual", "2025-12-31", 2025),
        _sample_row("quarterly", "2025-03-31", 2025, fiscal_quarter=1),
        _sample_row("quarterly", "2025-06-30", 2025, fiscal_quarter=2),
    ]

    financials.prune_financial_rows(client, "AAPL", rows)

    assert ("eq", "ticker", "AAPL") in client.table_stub.operations
    assert ("eq", "period_type", "annual") in client.table_stub.operations
    assert ("lt", "period_end", "2022-12-31") in client.table_stub.operations
    assert ("eq", "period_type", "quarterly") in client.table_stub.operations
    assert ("lt", "period_end", "2025-03-31") in client.table_stub.operations
