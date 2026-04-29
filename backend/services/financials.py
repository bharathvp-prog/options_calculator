from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import yfinance as yf

FINANCIALS_TABLE = "ticker_financials"
PERIOD_LIMITS = {"annual": 4, "quarterly": 16}
TTL_DAYS = {"annual": 60, "quarterly": 14}
METRIC_KEYS = (
    "revenue",
    "gross_profit",
    "op_expenses",
    "operating_income",
    "net_income",
    "diluted_eps",
)

ROW_ALIASES = {
    "revenue": ["Total Revenue"],
    "gross_profit": ["Gross Profit"],
    "op_expenses": ["Operating Expense"],
    "operating_income": ["Operating Income", "Operating Income or Loss", "EBIT"],
    "net_income": ["Net Income"],
    "diluted_eps": ["Diluted EPS"],
}


class FinancialsCacheError(RuntimeError):
    pass


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except Exception:
        return None


def _raise_cache_error(action: str, exc: Exception):
    raise FinancialsCacheError(f'{action} failed for Supabase table "{FINANCIALS_TABLE}": {exc}') from exc


def ensure_financials_table_available(client):
    if client is None:
        raise FinancialsCacheError(f'Supabase client unavailable for table "{FINANCIALS_TABLE}"')
    try:
        client.table(FINANCIALS_TABLE)\
            .select("ticker")\
            .limit(1)\
            .execute()
    except Exception as exc:
        _raise_cache_error("Preflight check", exc)


def _extract_row(stmt: pd.DataFrame, aliases: list[str], cols: list, scale: float = 1.0) -> list[float | None]:
    for key in aliases:
        if key in stmt.index:
            raw = stmt.loc[key, cols].tolist()[::-1]
            return [None if _safe_float(v) is None else round(_safe_float(v) / scale, 4) for v in raw]
    return [None] * len(cols)


def _format_period_label(row: dict) -> str:
    if row["period_type"] == "quarterly":
        quarter = row.get("fiscal_quarter")
        return f'{row["fiscal_year"]} Q{quarter}' if quarter else str(row["fiscal_year"])
    return str(row["fiscal_year"])


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def _latest_fetched_at(rows: list[dict]) -> datetime | None:
    latest = None
    for row in rows:
        parsed = _parse_iso_dt(row.get("fetched_at"))
        if parsed and (latest is None or parsed > latest):
            latest = parsed
    return latest


def _dataset_is_fresh(rows: list[dict], period_type: str) -> bool:
    if not rows:
        return False
    latest = _latest_fetched_at(rows)
    if latest is None:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(days=TTL_DAYS[period_type])
    return latest >= cutoff


def _group_rows_by_period(rows: list[dict]) -> dict[str, list[dict]]:
    grouped = {"annual": [], "quarterly": []}
    for row in rows:
        period_type = row.get("period_type")
        if period_type in grouped:
            grouped[period_type].append(row)
    for period_type, limit in PERIOD_LIMITS.items():
        grouped[period_type] = sorted(
            grouped[period_type],
            key=lambda r: (r.get("period_end") or "", r.get("fiscal_quarter") or 0),
        )[-limit:]
    return grouped


def _build_statement_rows(
    stmt: pd.DataFrame,
    ticker: str,
    period_type: str,
    shares_outstanding: int | None,
    current_price: float | None,
    fetched_at: str,
) -> list[dict]:
    if stmt is None or stmt.empty:
        return []

    limit = PERIOD_LIMITS[period_type]
    cols = list(stmt.columns[:limit])
    revenue = _extract_row(stmt, ROW_ALIASES["revenue"], cols, scale=1e6)
    gross_profit = _extract_row(stmt, ROW_ALIASES["gross_profit"], cols, scale=1e6)
    operating_income = _extract_row(stmt, ROW_ALIASES["operating_income"], cols, scale=1e6)
    net_income = _extract_row(stmt, ROW_ALIASES["net_income"], cols, scale=1e6)
    diluted_eps = _extract_row(stmt, ROW_ALIASES["diluted_eps"], cols, scale=1.0)

    op_expenses = _extract_row(stmt, ROW_ALIASES["op_expenses"], cols, scale=1e6)
    if all(v is None for v in op_expenses):
        op_expenses = [
            round(gp - oi, 4) if gp is not None and oi is not None else None
            for gp, oi in zip(gross_profit, operating_income)
        ]

    if all(v is None for v in diluted_eps) and shares_outstanding:
        diluted_eps = [
            round((ni * 1e6) / shares_outstanding, 4) if ni is not None else None
            for ni in net_income
        ]

    rows: list[dict] = []
    for idx, col in enumerate(cols[::-1]):
        ts = pd.Timestamp(col)
        quarter = ((ts.month - 1) // 3) + 1 if period_type == "quarterly" else None
        rows.append({
            "ticker": ticker,
            "period_type": period_type,
            "period_end": ts.date().isoformat(),
            "fiscal_year": int(ts.year),
            "fiscal_quarter": quarter,
            "revenue": revenue[idx],
            "gross_profit": gross_profit[idx],
            "op_expenses": op_expenses[idx],
            "operating_income": operating_income[idx],
            "net_income": net_income[idx],
            "diluted_eps": diluted_eps[idx],
            "shares_outstanding": shares_outstanding,
            "current_price": current_price,
            "year_end_price": None,
            "fetched_at": fetched_at,
            "source": "yfinance",
        })
    return rows


def _attach_year_end_prices(ticker_obj, annual_rows: list[dict]):
    if not annual_rows:
        return
    try:
        hist_data = ticker_obj.history(period="6y", interval="1d")
        for row in annual_rows:
            year_data = hist_data[hist_data.index.year == int(row["fiscal_year"])]
            row["year_end_price"] = (
                round(float(year_data["Close"].iloc[-1]), 2)
                if not year_data.empty else None
            )
    except Exception:
        for row in annual_rows:
            row["year_end_price"] = None


def fetch_live_financial_rows(ticker: str) -> tuple[list[dict], list[dict]]:
    clean = ticker.upper().strip()
    ticker_obj = yf.Ticker(clean)
    annual_stmt = ticker_obj.income_stmt
    if annual_stmt is None or annual_stmt.empty:
        raise ValueError(f"No income statement data for {ticker}")

    quarterly_stmt = ticker_obj.quarterly_income_stmt
    shares_outstanding = None
    try:
        shares_outstanding = ticker_obj.info.get("sharesOutstanding")
    except Exception:
        pass

    current_price = None
    try:
        current_price = _safe_float(ticker_obj.fast_info.last_price)
    except Exception:
        pass

    fetched_at = datetime.now(timezone.utc).isoformat()
    annual_rows = _build_statement_rows(
        annual_stmt, clean, "annual", shares_outstanding, current_price, fetched_at
    )
    quarterly_rows = _build_statement_rows(
        quarterly_stmt, clean, "quarterly", shares_outstanding, current_price, fetched_at
    )
    _attach_year_end_prices(ticker_obj, annual_rows)
    return annual_rows, quarterly_rows


def read_cached_financial_rows(client, ticker: str) -> list[dict]:
    if client is None:
        return []
    try:
        resp = client.table(FINANCIALS_TABLE)\
            .select("*")\
            .eq("ticker", ticker.upper().strip())\
            .order("period_end")\
            .execute()
        return resp.data or []
    except Exception as exc:
        _raise_cache_error("Read", exc)


def upsert_financial_rows(client, rows: list[dict]):
    if client is None or not rows:
        return
    payload = []
    for row in rows:
        payload.append({
            "ticker": row["ticker"],
            "period_type": row["period_type"],
            "period_end": row["period_end"],
            "fiscal_year": row["fiscal_year"],
            "fiscal_quarter": row["fiscal_quarter"],
            "revenue": row["revenue"],
            "gross_profit": row["gross_profit"],
            "op_expenses": row["op_expenses"],
            "operating_income": row["operating_income"],
            "net_income": row["net_income"],
            "diluted_eps": row["diluted_eps"],
            "shares_outstanding": row["shares_outstanding"],
            "current_price": row["current_price"],
            "year_end_price": row["year_end_price"],
            "fetched_at": row["fetched_at"],
            "source": row["source"],
        })
    try:
        client.table(FINANCIALS_TABLE).upsert(
            payload,
            on_conflict="ticker,period_type,period_end",
        ).execute()
    except Exception as exc:
        _raise_cache_error("Upsert", exc)


def prune_financial_rows(client, ticker: str, rows: list[dict]):
    if client is None or not rows:
        return
    grouped = _group_rows_by_period(rows)
    clean = ticker.upper().strip()
    for period_type, period_rows in grouped.items():
        if not period_rows:
            continue
        cutoff = period_rows[0]["period_end"]
        try:
            client.table(FINANCIALS_TABLE)\
                .delete()\
                .eq("ticker", clean)\
                .eq("period_type", period_type)\
                .lt("period_end", cutoff)\
                .execute()
        except Exception as exc:
            _raise_cache_error("Prune", exc)


def build_financial_response(ticker: str, rows: list[dict]) -> dict:
    grouped = _group_rows_by_period(rows)

    def build_dataset(period_rows: list[dict]) -> dict:
        dataset = {
            "periods": [_format_period_label(row) for row in period_rows],
        }
        for key in METRIC_KEYS:
            dataset[key] = [row.get(key) for row in period_rows]
        return dataset

    annual_rows = grouped["annual"]
    quarterly_rows = grouped["quarterly"]
    annual = build_dataset(annual_rows)
    quarterly = build_dataset(quarterly_rows)

    latest_row = (annual_rows or quarterly_rows)
    latest_row = latest_row[-1] if latest_row else {}

    return {
        "ticker": ticker.upper().strip(),
        "annual": annual,
        "quarterly": quarterly,
        "years": annual["periods"],
        "revenue": annual["revenue"],
        "gross_profit": annual["gross_profit"],
        "op_expenses": annual["op_expenses"],
        "operating_income": annual["operating_income"],
        "net_income": annual["net_income"],
        "diluted_eps": annual["diluted_eps"],
        "shares_outstanding": latest_row.get("shares_outstanding"),
        "current_price": latest_row.get("current_price"),
        "year_end_prices": [row.get("year_end_price") for row in annual_rows],
    }


def cached_financials_need_refresh(rows: list[dict]) -> bool:
    grouped = _group_rows_by_period(rows)
    return not (
        _dataset_is_fresh(grouped["annual"], "annual")
        and _dataset_is_fresh(grouped["quarterly"], "quarterly")
    )


def refresh_financial_cache_for_ticker(ticker: str, client) -> bool:
    annual_rows, quarterly_rows = fetch_live_financial_rows(ticker)
    rows = annual_rows + quarterly_rows
    upsert_financial_rows(client, rows)
    prune_financial_rows(client, ticker, rows)
    return True


def get_financial_history(ticker: str, read_client=None, write_client=None) -> dict:
    clean = ticker.upper().strip()
    cached_rows = read_cached_financial_rows(read_client, clean)
    if not cached_financials_need_refresh(cached_rows):
        return build_financial_response(clean, cached_rows)

    annual_rows, quarterly_rows = fetch_live_financial_rows(clean)
    fresh_rows = annual_rows + quarterly_rows

    if write_client is not None:
        upsert_financial_rows(write_client, fresh_rows)
        prune_financial_rows(write_client, clean, fresh_rows)
        refreshed_rows = read_cached_financial_rows(write_client, clean)
        if refreshed_rows:
            return build_financial_response(clean, refreshed_rows)

    return build_financial_response(clean, fresh_rows)
