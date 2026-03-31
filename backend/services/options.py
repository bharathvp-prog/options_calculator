import yfinance as yf
import pandas as pd
from datetime import date


def get_expiry_dates(ticker: str) -> list[str]:
    t = yf.Ticker(ticker)
    return list(t.options)


def get_option_chain(
    ticker: str,
    expiry_from: str,
    expiry_to: str,
    strike_min: float | None,
    strike_max: float | None,
    option_type: str,  # "call" or "put"
) -> pd.DataFrame:
    t = yf.Ticker(ticker)
    all_expiries = t.options

    date_from = date.fromisoformat(expiry_from)
    date_to = date.fromisoformat(expiry_to)

    frames = []
    for exp in all_expiries:
        exp_date = date.fromisoformat(exp)
        if date_from <= exp_date <= date_to:
            chain = t.option_chain(exp)
            df = chain.calls if option_type == "call" else chain.puts
            df = df.copy()
            df["expiration"] = exp
            df["option_type"] = option_type
            frames.append(df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)

    if strike_min is not None:
        combined = combined[combined["strike"] >= strike_min]
    if strike_max is not None:
        combined = combined[combined["strike"] <= strike_max]

    if combined.empty:
        return combined

    combined["mid"] = (combined["bid"] + combined["ask"]) / 2
    combined["spread"] = combined["ask"] - combined["bid"]

    return combined.reset_index(drop=True)


def find_cheapest(df: pd.DataFrame, sort_by: str = "ask") -> dict | None:
    if df.empty:
        return None

    valid_sort = {"ask", "mid", "spread"}
    if sort_by not in valid_sort:
        sort_by = "ask"

    df_valid = df[df[sort_by] > 0].copy()
    if df_valid.empty:
        return None

    row = df_valid.nsmallest(1, sort_by).iloc[0]

    def safe_float(key, default=0.0):
        v = row[key] if key in row.index else default
        try:
            return float(v) if v is not None and str(v) != "nan" else default
        except (TypeError, ValueError):
            return default

    def safe_int(key, default=0):
        v = row[key] if key in row.index else default
        try:
            return int(v) if v is not None and str(v) != "nan" else default
        except (TypeError, ValueError):
            return default

    def safe_str(key, default=""):
        v = row[key] if key in row.index else default
        return str(v) if v is not None else default

    return {
        "contractSymbol": safe_str("contractSymbol"),
        "expiration": safe_str("expiration"),
        "strike": safe_float("strike"),
        "option_type": safe_str("option_type"),
        "bid": safe_float("bid"),
        "ask": safe_float("ask"),
        "mid": safe_float("mid"),
        "spread": safe_float("spread"),
        "lastPrice": safe_float("lastPrice"),
        "volume": safe_int("volume"),
        "openInterest": safe_int("openInterest"),
        "impliedVolatility": safe_float("impliedVolatility"),
    }
