import yfinance as yf
import pandas as pd
from datetime import date, timedelta

HORIZON_TARGETS = [
    ("1 month", 30),
    ("3 months", 90),
    ("6 months", 180),
    ("1 year", 365),
    ("2 years", 730),
]


def pick_horizon_expiries(all_expiries: list[str]) -> dict[str, str]:
    """Pick one representative expiry per time horizon bucket. Returns {label: expiry}."""
    today = date.today()
    valid = [e for e in all_expiries if (date.fromisoformat(e) - today).days >= 7]
    if not valid:
        return {}

    result = {}
    for label, target_days in HORIZON_TARGETS:
        target = today + timedelta(days=target_days)
        closest = min(valid, key=lambda e: abs((date.fromisoformat(e) - target).days))
        result[label] = closest

    latest = max(valid, key=lambda e: date.fromisoformat(e))
    result["Latest available"] = latest

    # Deduplicate — keep first occurrence of each expiry
    seen: set[str] = set()
    deduped = {}
    for label, expiry in result.items():
        if expiry not in seen:
            seen.add(expiry)
            deduped[label] = expiry
    return deduped


def get_options_for_expiry(
    ticker_obj,
    expiry: str,
    option_type: str,
    strike_min: float | None = None,
    strike_max: float | None = None,
) -> pd.DataFrame:
    """Fetch and filter option chain for one specific expiry date."""
    chain = ticker_obj.option_chain(expiry)
    df = (chain.calls if option_type == "call" else chain.puts).copy()
    df["expiration"] = expiry
    df["option_type"] = option_type

    if strike_min is not None:
        df = df[df["strike"] >= strike_min]
    if strike_max is not None:
        df = df[df["strike"] <= strike_max]

    if df.empty:
        return df

    df["mid"] = (df["bid"] + df["ask"]) / 2
    df["spread"] = df["ask"] - df["bid"]
    return df.reset_index(drop=True)


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
