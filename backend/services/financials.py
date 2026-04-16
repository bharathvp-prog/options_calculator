import pandas as pd
import yfinance as yf

ROW_ALIASES = {
    "revenue":          ["Total Revenue"],
    "gross_profit":     ["Gross Profit"],
    "op_expenses":      ["Operating Expense"],
    "operating_income": ["Operating Income", "Operating Income or Loss", "EBIT"],
    "net_income":       ["Net Income"],
    "diluted_eps":      ["Diluted EPS"],
}


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except Exception:
        return None


def _extract_row(stmt: pd.DataFrame, aliases: list[str], cols: list, scale: float = 1.0) -> list[float | None]:
    for key in aliases:
        if key in stmt.index:
            raw = stmt.loc[key, cols].tolist()[::-1]  # ascending (oldest first)
            return [None if _safe_float(v) is None else round(_safe_float(v) / scale, 4) for v in raw]
    return [None] * len(cols)


def get_financial_history(ticker: str) -> dict:
    """
    Fetch up to 4 years of annual P&L from yfinance.
    Returns a dict with years, revenue, gross_profit, op_expenses,
    operating_income, net_income, diluted_eps (all in $M except EPS),
    plus shares_outstanding (raw int) and current_price.
    Raises ValueError if no income statement data is available.
    """
    t = yf.Ticker(ticker.upper())
    stmt = t.income_stmt
    if stmt is None or stmt.empty:
        raise ValueError(f"No income statement data for {ticker}")

    # Columns are Timestamps in descending order; take up to 4 most recent
    cols = list(stmt.columns[:4])
    years = [str(c.year) for c in cols][::-1]  # ascending

    revenue          = _extract_row(stmt, ROW_ALIASES["revenue"], cols, scale=1e6)
    gross_profit     = _extract_row(stmt, ROW_ALIASES["gross_profit"], cols, scale=1e6)
    operating_income = _extract_row(stmt, ROW_ALIASES["operating_income"], cols, scale=1e6)
    net_income       = _extract_row(stmt, ROW_ALIASES["net_income"], cols, scale=1e6)
    diluted_eps      = _extract_row(stmt, ROW_ALIASES["diluted_eps"], cols, scale=1.0)

    # op_expenses: try direct row first, then derive from gross_profit - operating_income
    op_expenses = _extract_row(stmt, ROW_ALIASES["op_expenses"], cols, scale=1e6)
    if all(v is None for v in op_expenses):
        op_expenses = [
            round(gp - oi, 4) if gp is not None and oi is not None else None
            for gp, oi in zip(gross_profit, operating_income)
        ]

    # EPS fallback: derive from net_income / shares if row is missing
    shares = None
    try:
        shares = t.info.get("sharesOutstanding")
    except Exception:
        pass

    if all(v is None for v in diluted_eps) and shares:
        diluted_eps = [
            round((ni * 1e6) / shares, 4) if ni is not None else None
            for ni in net_income
        ]

    current_price = None
    try:
        current_price = float(t.fast_info.last_price)
    except Exception:
        pass

    # Year-end closing prices for each historical year (one batch call)
    year_end_prices = []
    try:
        hist_data = t.history(period="6y", interval="1d")
        for year in years:
            yr_data = hist_data[hist_data.index.year == int(year)]
            if not yr_data.empty:
                year_end_prices.append(round(float(yr_data["Close"].iloc[-1]), 2))
            else:
                year_end_prices.append(None)
    except Exception:
        year_end_prices = [None] * len(years)

    return {
        "years":              years,
        "revenue":            revenue,
        "gross_profit":       gross_profit,
        "op_expenses":        op_expenses,
        "operating_income":   operating_income,
        "net_income":         net_income,
        "diluted_eps":        diluted_eps,
        "shares_outstanding": shares,
        "current_price":      current_price,
        "year_end_prices":    year_end_prices,
    }
