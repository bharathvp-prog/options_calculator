"""
Oxas Stock Screener — Nightly Refresh Script
=============================================
Fetches price/momentum, fundamentals, and options signals for ~13k US-listed
tickers and upserts them into Supabase.

Run locally:
    cd backend
    python scripts/refresh_screener.py

Deployed as a GCP Cloud Run Job triggered nightly at 02:00 UTC.

Environment variables required:
    SUPABASE_URL          — Supabase project URL
    SUPABASE_SERVICE_KEY  — Service role key (full DB access)

Optional (reads ticker list from cache if available):
    TICKERS_CACHE_PATH    — default: data/tickers_cache.json
"""

import os
import sys
import json
import time
import logging
import math
import warnings
from datetime import datetime, timezone, date
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

# Suppress yfinance noise
warnings.filterwarnings("ignore", category=FutureWarning)
yf.set_tz_cache_location("/tmp/yf_tz_cache")

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("refresh")

# ── Config ───────────────────────────────────────────────────────────────────

BATCH_SIZE_PHASE1 = 500     # tickers per yf.download() call
WORKERS_PHASE2    = 12      # concurrent .info fetches
WORKERS_PHASE3    = 8       # concurrent options chain fetches
DELAY_PHASE2      = 0.15    # seconds between Phase 2 worker starts
UPSERT_BATCH      = 150     # rows per Supabase upsert call

# ── Load env ─────────────────────────────────────────────────────────────────

load_dotenv()

# ── Supabase ─────────────────────────────────────────────────────────────────

def get_client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def upsert_batch(client, rows: list[dict]):
    """Upsert a batch of rows to screener_tickers, retrying once on failure."""
    if not rows:
        return
    # Deduplicate by ticker — concurrent workers can produce the same ticker twice
    # in one batch, which causes Postgres "cannot affect row a second time" error
    deduped = list({row["ticker"]: row for row in rows}.values())
    try:
        client.table("screener_tickers").upsert(deduped, on_conflict="ticker").execute()
    except Exception as e:
        logger.warning("Upsert failed (%s), retrying in 5s…", e)
        time.sleep(5)
        client.table("screener_tickers").upsert(deduped, on_conflict="ticker").execute()


# ── Ticker list ───────────────────────────────────────────────────────────────

def load_tickers() -> list[str]:
    cache_path = os.getenv("TICKERS_CACHE_PATH", "data/tickers_cache.json")
    if Path(cache_path).exists():
        with open(cache_path) as f:
            data = json.load(f)
        tickers = [t["symbol"] for t in data.get("tickers", [])]
        logger.info("Loaded %d tickers from %s", len(tickers), cache_path)
        return tickers

    # Fallback: fetch from SEC EDGAR
    logger.warning("Ticker cache not found at %s — fetching from SEC EDGAR", cache_path)
    try:
        import requests
        resp = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "Oxas/1.0 contact@example.com"},
            timeout=30,
        )
        data = resp.json()
        tickers = [v["ticker"] for v in data.values() if v.get("ticker")]
        logger.info("Fetched %d tickers from SEC EDGAR", len(tickers))
        return tickers
    except Exception as e:
        logger.error("Could not load tickers: %s", e)
        sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe(val, default=None):
    """Return val if it's a finite number, else default."""
    if val is None:
        return default
    try:
        f = float(val)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _pct_change(series: pd.Series, n: int) -> float | None:
    """Percentage change over the last n periods."""
    if len(series) < n + 1:
        return None
    old = series.iloc[-(n + 1)]
    new = series.iloc[-1]
    if old == 0 or pd.isna(old) or pd.isna(new):
        return None
    return _safe((new - old) / old)


# ── Phase 1: Price & Momentum ─────────────────────────────────────────────────

def run_phase1(tickers: list[str], client) -> list[str]:
    """
    Download 1-year daily OHLCV for all tickers in batches of BATCH_SIZE_PHASE1.
    Computes: current_price, daily/weekly/monthly/quarterly changes, MA50/200,
              52W high/low, volume metrics.
    Returns list of tickers with phase1_ok=True.
    """
    logger.info("=== Phase 1: Price & Momentum (%d tickers, batch=%d) ===", len(tickers), BATCH_SIZE_PHASE1)
    successful = []
    batches = [tickers[i:i + BATCH_SIZE_PHASE1] for i in range(0, len(tickers), BATCH_SIZE_PHASE1)]

    for batch_num, batch in enumerate(batches, 1):
        logger.info("Phase 1 batch %d/%d (%d tickers)…", batch_num, len(batches), len(batch))
        try:
            df = yf.download(
                tickers=" ".join(batch),
                period="1y",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        except Exception as e:
            logger.warning("Batch %d download failed: %s", batch_num, e)
            continue

        if df.empty:
            continue

        # Normalise to MultiIndex if single ticker came back as flat columns
        if not isinstance(df.columns, pd.MultiIndex):
            df.columns = pd.MultiIndex.from_tuples([(col, batch[0]) for col in df.columns])

        rows = []
        for ticker in batch:
            try:
                if ticker not in df.columns.get_level_values(1):
                    continue
                close = df["Close"][ticker].dropna()
                volume = df["Volume"][ticker].dropna()
                if len(close) < 5:
                    continue

                last_price = _safe(close.iloc[-1])
                if not last_price:
                    continue

                ma50 = _safe(close.rolling(50).mean().iloc[-1])
                ma200 = _safe(close.rolling(200).mean().iloc[-1])
                high52 = _safe(close.rolling(min(252, len(close))).max().iloc[-1])
                low52  = _safe(close.rolling(min(252, len(close))).min().iloc[-1])

                vol_today = _safe(volume.iloc[-1])
                avg_vol   = _safe(volume.rolling(30).mean().iloc[-1])
                vol_ratio = _safe(vol_today / avg_vol) if avg_vol and avg_vol > 0 else None

                rows.append({
                    "ticker":            ticker,
                    "current_price":     last_price,
                    "price_1d_chg_pct":  _pct_change(close, 1),
                    "price_5d_chg_pct":  _pct_change(close, 5),
                    "price_1mo_chg_pct": _pct_change(close, 21),
                    "price_3mo_chg_pct": _pct_change(close, 63),
                    "ma_50":             ma50,
                    "ma_200":            ma200,
                    "week_52_high":      high52,
                    "week_52_low":       low52,
                    "pct_from_52w_high": _safe((last_price - high52) / high52) if high52 else None,
                    "pct_from_52w_low":  _safe((last_price - low52) / low52) if low52 else None,
                    "volume_today":      int(vol_today) if vol_today else None,
                    "avg_volume_30d":    int(avg_vol) if avg_vol else None,
                    "volume_ratio":      vol_ratio,
                    "refreshed_at":      datetime.now(timezone.utc).isoformat(),
                    "phase1_ok":         True,
                })
                successful.append(ticker)
            except Exception as e:
                logger.debug("Phase 1 ticker %s error: %s", ticker, e)

        # Upsert this batch
        for i in range(0, len(rows), UPSERT_BATCH):
            upsert_batch(client, rows[i:i + UPSERT_BATCH])

        logger.info("Phase 1 batch %d done — %d/%d succeeded", batch_num, len(rows), len(batch))

    logger.info("Phase 1 complete: %d/%d tickers succeeded", len(successful), len(tickers))
    return successful


# ── Phase 2: Fundamentals ─────────────────────────────────────────────────────

_PHASE2_INFO_KEYS = {
    "shortName":                       "name",
    "trailingPE":                      "pe_ratio",
    "forwardPE":                       "forward_pe",
    "priceToBook":                     "price_to_book",
    "priceToSalesTrailing12Months":    "price_to_sales",
    "dividendYield":                   "dividend_yield",
    "revenueGrowth":                   "revenue_growth",
    "earningsGrowth":                  "earnings_growth",
    "profitMargins":                   "profit_margin",
    "debtToEquity":                    "debt_to_equity",
    "returnOnEquity":                  "return_on_equity",
    "sector":                          "sector",
    "industry":                        "industry",
    "marketCap":                       "market_cap",
}


def _fetch_fundamentals(ticker: str) -> dict | None:
    try:
        info = yf.Ticker(ticker).info
        if not info or info.get("trailingPE") is None and info.get("marketCap") is None:
            return None
        row: dict = {"ticker": ticker, "phase2_ok": True}
        for src, dst in _PHASE2_INFO_KEYS.items():
            val = info.get(src)
            if dst == "name":
                row[dst] = val
            elif dst in ("sector", "industry"):
                row[dst] = val if isinstance(val, str) else None
            elif dst == "market_cap":
                row[dst] = int(val) if val and math.isfinite(float(val)) else None
            else:
                row[dst] = _safe(val)
        return row
    except Exception:
        return None


def run_phase2(tickers: list[str], client) -> list[str]:
    """
    Fetch .info for each ticker (fundamentals) with ThreadPoolExecutor.
    Rate-limited to avoid Yahoo Finance throttling.
    """
    logger.info("=== Phase 2: Fundamentals (%d tickers, workers=%d) ===", len(tickers), WORKERS_PHASE2)
    successful = []
    pending_rows = []

    with ThreadPoolExecutor(max_workers=WORKERS_PHASE2) as pool:
        futures = {}
        for i, ticker in enumerate(tickers):
            time.sleep(DELAY_PHASE2)
            futures[pool.submit(_fetch_fundamentals, ticker)] = ticker

        for n, future in enumerate(as_completed(futures), 1):
            ticker = futures[future]
            try:
                row = future.result()
                if row:
                    pending_rows.append(row)
                    successful.append(ticker)
            except Exception as e:
                logger.debug("Phase 2 %s: %s", ticker, e)

            if len(pending_rows) >= UPSERT_BATCH:
                upsert_batch(client, pending_rows)
                pending_rows = []

            if n % 500 == 0:
                logger.info("Phase 2 progress: %d/%d (%.1f%%)", n, len(tickers), 100 * n / len(tickers))

    if pending_rows:
        upsert_batch(client, pending_rows)

    logger.info("Phase 2 complete: %d/%d tickers succeeded", len(successful), len(tickers))
    return successful


# ── Black-Scholes Greeks ─────────────────────────────────────────────────────
# Local copy of _bs_greeks from main.py — kept here to avoid import coupling.

def _bs_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> dict:
    """Black-Scholes Greeks. T in years, sigma as decimal (e.g. 0.30)."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    try:
        sqrt_T = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
        d2 = d1 - sigma * sqrt_T
        def _N(x): return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))
        def _n(x): return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)
        nd1 = _n(d1)
        if option_type == "call":
            delta = _N(d1)
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) - r * K * math.exp(-r * T) * _N(d2)) / 365
        else:
            delta = _N(d1) - 1
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) + r * K * math.exp(-r * T) * _N(-d2)) / 365
        gamma = nd1 / (S * sigma * sqrt_T)
        vega  = S * nd1 * sqrt_T / 100  # per 1% move in IV
        return {
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "theta": round(theta, 4),
            "vega":  round(vega,  4),
        }
    except Exception:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}


def _atm_greeks_from_chain(calls_df, current_price: float, dte: int, iv_current: float) -> dict:
    """
    Given a calls DataFrame, compute ATM Black-Scholes greeks.
    Returns dict with atm_theta, atm_gamma, atm_vega, or Nones on failure.
    """
    try:
        strikes = sorted(calls_df["strike"].tolist())
        atm_strike = min(strikes, key=lambda k: abs(k - current_price))
        T = max(dte, 1) / 365.0
        g = _bs_greeks(current_price, atm_strike, T, 0.045, iv_current, "call")
        return {
            "atm_theta": abs(g["theta"]) if g["theta"] is not None else None,
            "atm_gamma": g["gamma"],
            "atm_vega":  g["vega"],
        }
    except Exception:
        return {"atm_theta": None, "atm_gamma": None, "atm_vega": None}


# ── Phase 3: Options Signals ──────────────────────────────────────────────────

def _compute_iv_rank(ticker: str, iv_current: float, client) -> tuple[float, float, float]:
    """
    Return (iv_rank, new_52w_high, new_52w_low).
    Reads existing rolling min/max from Supabase to maintain the 52-week window.
    """
    try:
        resp = client.table("screener_tickers")\
            .select("iv_52w_high,iv_52w_low")\
            .eq("ticker", ticker)\
            .single()\
            .execute()
        existing = resp.data or {}
    except Exception:
        existing = {}

    old_high = existing.get("iv_52w_high") or iv_current
    old_low  = existing.get("iv_52w_low") or iv_current

    new_high = max(old_high, iv_current)
    new_low  = min(old_low, iv_current)

    denom = new_high - new_low
    iv_rank = round((iv_current - new_low) / denom * 100, 1) if denom > 0.001 else 50.0
    iv_rank = max(0.0, min(100.0, iv_rank))

    return iv_rank, new_high, new_low


def _fetch_options_signals(ticker: str, client) -> dict | None:
    try:
        t = yf.Ticker(ticker)
        expiries = t.options
        if not expiries:
            return {"ticker": ticker, "has_options": False, "phase3_ok": True}

        # Use the nearest 2 expiries for put/call ratio; nearest for IV
        expiry = expiries[0]
        chain  = t.option_chain(expiry)
        calls  = chain.calls
        puts   = chain.puts

        if calls.empty and puts.empty:
            return {"ticker": ticker, "has_options": True, "phase3_ok": True}

        # Put/call OI ratio (use up to 2 expiries)
        total_call_oi = calls["openInterest"].sum() if not calls.empty else 0
        total_put_oi  = puts["openInterest"].sum()  if not puts.empty  else 0
        if len(expiries) > 1:
            try:
                chain2 = t.option_chain(expiries[1])
                total_call_oi += chain2.calls["openInterest"].sum()
                total_put_oi  += chain2.puts["openInterest"].sum()
            except Exception:
                pass
        put_call = _safe(total_put_oi / total_call_oi) if total_call_oi > 0 else None

        # IV: average ATM calls (±2 strikes around midpoint)
        try:
            all_strikes = sorted(calls["strike"].tolist())
            mid_idx = len(all_strikes) // 2
            atm_strikes = all_strikes[max(0, mid_idx - 2): mid_idx + 3]
            atm_calls = calls[calls["strike"].isin(atm_strikes)]
            iv_vals = atm_calls["impliedVolatility"].dropna()
            iv_current = _safe(iv_vals.mean())
        except Exception:
            iv_current = None

        if iv_current and iv_current > 0:
            iv_rank, iv_high, iv_low = _compute_iv_rank(ticker, iv_current, client)
        else:
            iv_rank = iv_high = iv_low = None

        # ── Greeks & expected move ─────────────────────────────────────────────
        atm_theta = atm_gamma = atm_vega = expected_move_1m = None
        if iv_current and iv_current > 0:
            # Expected 1-sigma move over 30 calendar days
            expected_move_1m = _safe(iv_current * math.sqrt(30 / 252))

            # Get current price
            try:
                last_price = _safe(t.fast_info.last_price)
            except Exception:
                last_price = None

            if last_price and last_price > 0:
                # Find best expiry for greeks: prefer 10–60 DTE
                today = datetime.now(timezone.utc).date()
                greeks_calls = calls   # default: reuse nearest-expiry chain
                greeks_dte = 30
                for exp in expiries:
                    try:
                        dte = (date.fromisoformat(exp) - today).days
                        if 10 <= dte <= 60:
                            if exp != expiry:
                                greeks_calls = t.option_chain(exp).calls
                            greeks_dte = dte
                            break
                    except Exception:
                        continue

                g = _atm_greeks_from_chain(greeks_calls, last_price, greeks_dte, iv_current)
                atm_theta = g["atm_theta"]
                atm_gamma = g["atm_gamma"]
                atm_vega  = g["atm_vega"]

        return {
            "ticker":           ticker,
            "has_options":      True,
            "iv_current":       iv_current,
            "iv_52w_high":      iv_high,
            "iv_52w_low":       iv_low,
            "iv_rank":          iv_rank,
            "put_call_ratio":   put_call,
            "atm_theta":        atm_theta,
            "atm_gamma":        atm_gamma,
            "atm_vega":         atm_vega,
            "expected_move_1m": expected_move_1m,
            "phase3_ok":        True,
        }
    except Exception as e:
        logger.debug("Phase 3 %s: %s", ticker, e)
        return None


# ── Greeks-only backfill ──────────────────────────────────────────────────────

def _fetch_greeks_only(ticker: str, current_price: float | None) -> dict | None:
    """Lightweight fetch: compute ATM greeks + expected move for a single ticker.
    Used by the --greeks-only backfill run."""
    try:
        t = yf.Ticker(ticker)
        expiries = t.options
        if not expiries:
            return None

        if not current_price or current_price <= 0:
            try:
                current_price = _safe(t.fast_info.last_price)
            except Exception:
                return None
        if not current_price or current_price <= 0:
            return None

        # ATM IV from nearest expiry
        chain = t.option_chain(expiries[0])
        calls = chain.calls
        if calls.empty:
            return None
        try:
            all_strikes = sorted(calls["strike"].tolist())
            mid_idx = len(all_strikes) // 2
            atm_s = all_strikes[max(0, mid_idx - 2): mid_idx + 3]
            iv_vals = calls[calls["strike"].isin(atm_s)]["impliedVolatility"].dropna()
            iv_current = _safe(iv_vals.mean())
        except Exception:
            iv_current = None

        if not iv_current or iv_current <= 0:
            return None

        expected_move_1m = _safe(iv_current * math.sqrt(30 / 252))

        # Find best expiry for greeks (10–60 DTE)
        today = datetime.now(timezone.utc).date()
        greeks_calls = calls
        greeks_dte = 30
        for exp in expiries:
            try:
                dte = (date.fromisoformat(exp) - today).days
                if 10 <= dte <= 60:
                    if exp != expiries[0]:
                        greeks_calls = t.option_chain(exp).calls
                    greeks_dte = dte
                    break
            except Exception:
                continue

        g = _atm_greeks_from_chain(greeks_calls, current_price, greeks_dte, iv_current)
        return {
            "ticker":           ticker,
            "atm_theta":        g["atm_theta"],
            "atm_gamma":        g["atm_gamma"],
            "atm_vega":         g["atm_vega"],
            "expected_move_1m": expected_move_1m,
        }
    except Exception as e:
        logger.debug("Greeks-only %s: %s", ticker, e)
        return None


def run_greeks_only(client) -> int:
    """
    One-off backfill: compute ATM greeks for all options-eligible tickers in DB.
    Writes only atm_theta, atm_gamma, atm_vega, expected_move_1m.
    Safe to re-run — overwrites previous values.
    """
    logger.info("=== Greeks Backfill: querying options-eligible tickers from DB ===")
    try:
        resp = client.table("screener_tickers")\
            .select("ticker,current_price")\
            .eq("has_options", True)\
            .eq("phase1_ok", True)\
            .execute()
        rows = resp.data or []
    except Exception as e:
        logger.error("Could not fetch tickers: %s", e)
        return 0

    price_map = {r["ticker"]: r.get("current_price") for r in rows}
    tickers = list(price_map.keys())
    logger.info("Greeks backfill: %d tickers", len(tickers))

    successful = 0
    pending_rows: list[dict] = []

    with ThreadPoolExecutor(max_workers=WORKERS_PHASE3) as pool:
        futures = {pool.submit(_fetch_greeks_only, t, price_map[t]): t for t in tickers}
        for n, future in enumerate(as_completed(futures), 1):
            ticker = futures[future]
            try:
                row = future.result()
                if row:
                    pending_rows.append(row)
                    successful += 1
            except Exception as e:
                logger.debug("Greeks backfill %s: %s", ticker, e)

            if len(pending_rows) >= UPSERT_BATCH:
                upsert_batch(client, pending_rows)
                pending_rows = []

            if n % 100 == 0:
                logger.info("Greeks backfill: %d/%d done", n, len(tickers))

    if pending_rows:
        upsert_batch(client, pending_rows)

    logger.info("Greeks backfill complete: %d/%d tickers updated", successful, len(tickers))
    return successful


def run_phase3(tickers: list[str], client) -> int:
    """
    Fetch options signals for the given tickers.
    Returns count of tickers processed successfully.
    """
    logger.info("=== Phase 3: Options Signals (%d tickers, workers=%d) ===", len(tickers), WORKERS_PHASE3)
    successful = 0
    pending_rows = []

    with ThreadPoolExecutor(max_workers=WORKERS_PHASE3) as pool:
        futures = {pool.submit(_fetch_options_signals, t, client): t for t in tickers}

        for n, future in enumerate(as_completed(futures), 1):
            ticker = futures[future]
            try:
                row = future.result()
                if row:
                    pending_rows.append(row)
                    successful += 1
            except Exception as e:
                logger.debug("Phase 3 %s outer: %s", ticker, e)

            if len(pending_rows) >= UPSERT_BATCH:
                upsert_batch(client, pending_rows)
                pending_rows = []

            if n % 200 == 0:
                logger.info("Phase 3 progress: %d/%d", n, len(tickers))

    if pending_rows:
        upsert_batch(client, pending_rows)

    logger.info("Phase 3 complete: %d tickers processed", successful)
    return successful


# ── Identify options-eligible tickers ────────────────────────────────────────

def get_options_eligible(client, phase1_tickers: list[str]) -> list[str]:
    """
    Query Supabase for tickers already known to have options (from prior runs).
    For tickers not yet checked, check yfinance directly (batched).
    Returns a combined list of options-eligible tickers.
    """
    try:
        resp = client.table("screener_tickers")\
            .select("ticker")\
            .eq("has_options", True)\
            .execute()
        known_eligible = {r["ticker"] for r in (resp.data or [])}
    except Exception:
        known_eligible = set()

    # For tickers not in DB yet, quickly check eligibility
    unchecked = [t for t in phase1_tickers if t not in known_eligible]
    logger.info("Checking options eligibility for %d unchecked tickers…", len(unchecked))

    newly_eligible = []
    for i, ticker in enumerate(unchecked):
        try:
            if yf.Ticker(ticker).options:
                newly_eligible.append(ticker)
        except Exception:
            pass
        if i % 500 == 0 and i > 0:
            logger.info("Eligibility check: %d/%d", i, len(unchecked))

    all_eligible = list(known_eligible.union(set(newly_eligible)))
    # Only keep tickers that are in our current phase1 set
    all_eligible = [t for t in all_eligible if t in set(phase1_tickers)]
    logger.info("Options-eligible tickers: %d", len(all_eligible))
    return all_eligible


# ── Ticker lists ──────────────────────────────────────────────────────────────

# Top 10 tickers used for --test mode
TEST_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "JPM", "V"]

# ~500 large-cap US stocks (S&P 500 approximate) used for --large-cap mode.
# Deduplicated with dict.fromkeys to preserve order and eliminate any accidental repeats.
LARGE_CAP_TICKERS = list(dict.fromkeys([
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CSCO", "ADBE", "CRM", "AMD", "ACN",
    "TXN", "QCOM", "NOW", "INTU", "AMAT", "INTC", "MU", "ADI", "LRCX", "KLAC",
    "SNPS", "CDNS", "MRVL", "APH", "TEL", "HPQ", "HPE", "GLW", "KEYS", "FFIV",
    "AKAM", "CTSH", "CDW", "WDC", "STX", "NTAP", "SWKS", "QRVO", "TER", "MPWR",
    "ENPH", "FSLR", "ROP", "IT", "PTC", "GDDY", "GEN", "PAYC", "VRSN",
    "ZBRA", "TDY", "TYL", "TRMB", "FIS", "FISV", "FLT", "GPN", "JKHY", "EPAM",
    # Large tech / mega cap
    "GOOGL", "GOOG", "META", "AMZN", "TSLA", "NFLX", "PLTR", "UBER", "ABNB",
    # Semiconductors
    "LRCX", "ENTG", "ONTO", "COHR", "WOLF", "MKSI",
    # Financials
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "C", "AXP",
    "BLK", "SCHW", "CB", "MMC", "AON", "ICE", "CME", "MCO", "SPGI", "PGR",
    "TRV", "ALL", "MET", "PRU", "AFL", "AIG", "HIG", "COF", "SYF",
    "USB", "PNC", "TFC", "FITB", "KEY", "HBAN", "RF", "CFG", "MTB", "ZION",
    "BK", "STT", "TROW", "BEN", "AMP", "RJF", "NDAQ", "CBOE", "MSCI", "VRSK",
    "IVZ", "WTW", "ERIE", "RNR", "RE", "CINF",
    # Healthcare
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "DHR", "PFE", "AMGN",
    "BMY", "GILD", "REGN", "VRTX", "ISRG", "SYK", "MDT", "BSX", "ZBH", "EW",
    "BAX", "DXCM", "IDXX", "A", "IQV", "CRL", "HOLX", "ALGN", "PODD", "INCY",
    "BIIB", "MRNA", "ILMN", "MTD", "COO", "TFX", "HUM", "CI", "CVS", "MCK",
    "CENC", "CAH", "HSIC", "DGX", "LH", "HCA", "UHS", "ENSG", "MOH", "CNC",
    "RMD", "GEHC", "STE", "RVTY", "WST", "BIO",
    # Consumer Discretionary
    "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "CMG", "ROST", "YUM",
    "EBAY", "MGM", "WYNN", "LVS", "CZR", "MAR", "HLT", "CCL", "RCL", "NCLH",
    "LULU", "ULTA", "ORLY", "AZO", "AAP", "GPC", "CPRT", "KMX", "AN",
    "F", "GM", "APTV", "BWA", "LEA", "MGA", "DHI", "LEN", "PHM", "NVR", "TOL",
    "WHR", "SWK", "ALLE", "DRI", "EAT", "EXPE", "TRIP", "LYFT", "DASH",
    "ETSY", "W", "RH", "WSM", "BBY", "DG", "DLTR", "TSCO",
    # Consumer Staples
    "WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "KHC", "GIS",
    "KLG", "CAG", "CPB", "HRL", "MKC", "CL", "CHD", "EL", "KR", "SFM",
    "TAP", "STZ", "BF-B", "CLX", "KMB", "TSN", "SYY", "USFD", "PPC",
    "HSY", "SJM", "THS", "BGS", "COTY", "SPB",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "VLO", "PSX", "OXY", "HAL",
    "BKR", "DVN", "APA", "FANG", "LNG", "EQT", "AR", "RRC",
    "KMI", "WMB", "OKE", "EPD", "ET", "PAA", "NOV", "FTI",
    "DK", "MTDR", "CTRA", "SM",
    # Industrials
    "RTX", "HON", "UNP", "LMT", "UPS", "BA", "CAT", "DE", "GE", "MMM",
    "FDX", "CSX", "NSC", "GD", "NOC", "LHX", "HII", "ETN", "EMR", "PH",
    "ITW", "CMI", "ROK", "DOV", "AME", "FAST", "GWW", "XYL", "WM", "RSG",
    "OTIS", "CARR", "TT", "JCI", "VRT", "LDOS", "BAH", "CACI", "SAIC",
    "EXPD", "XPO", "JBHT", "WERN", "URI", "PWR", "FIX", "GNRC", "AOS",
    "NDSN", "RRX", "AXTA", "HXL", "TDG", "HWM",
    # Materials
    "LIN", "APD", "SHW", "ECL", "PPG", "FCX", "NEM", "NUE", "CF", "MOS",
    "ALB", "EMN", "FMC", "CE", "IFF", "PKG", "IP", "SON", "SEE",
    "ATI", "AA", "MLM", "VMC", "EXP", "RPM", "CC",
    # Communication Services
    "DIS", "CMCSA", "T", "VZ", "CHTR", "TMUS", "SNAP", "PINS", "WBD",
    "FOX", "FOXA", "OMC", "TTWO", "EA", "RBLX", "NYT",
    "SIRI", "LUMN", "MTCH", "IAC", "ZM",
    # Utilities
    "NEE", "DUK", "SO", "AEP", "EXC", "XEL", "SRE", "WEC", "DTE", "ED",
    "ES", "FE", "EIX", "PPL", "PCG", "D", "AWK", "CMS", "ATO", "NI",
    "LNT", "EVRG", "PNW", "AES", "AEE", "CNP", "ETR",
    # Real Estate
    "AMT", "PLD", "CCI", "EQIX", "PSA", "O", "SPG", "AVB", "EQR",
    "VTR", "WY", "ARE", "MAA", "UDR", "CPT", "SUI", "ELS", "INVH",
    "BXP", "SLG", "KIM", "REG", "FRT", "NNN", "IRM", "EXR", "CUBE",
    "WELL", "DOC", "COLD", "STAG", "TRNO", "AMH",
]))


# ── Main ──────────────────────────────────────────────────────────────────────

def main(test: bool = False, large_cap: bool = False, greeks_only: bool = False):
    start = time.time()
    client = get_client()

    if greeks_only:
        logger.info("Oxas screener greeks backfill — %s UTC", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"))
        run_greeks_only(client)
        logger.info("Greeks backfill complete in %.1f minutes.", (time.time() - start) / 60)
        return

    if test:
        mode = "TEST (10 tickers)"
    elif large_cap:
        mode = f"LARGE-CAP ({len(LARGE_CAP_TICKERS)} tickers)"
    else:
        mode = "FULL"
    logger.info("Oxas screener refresh started [%s] — %s UTC", mode, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"))

    if test:
        tickers = TEST_TICKERS
    elif large_cap:
        tickers = LARGE_CAP_TICKERS
    else:
        tickers = load_tickers()

    # Phase 1
    p1_tickers = run_phase1(tickers, client)

    # Phase 2
    run_phase2(p1_tickers, client)

    # Phase 3 — options signals (includes greeks going forward)
    # Skip eligibility scan in test/large-cap mode and run Phase 3 on all Phase 1 tickers
    eligible = p1_tickers if (test or large_cap) else get_options_eligible(client, p1_tickers)
    run_phase3(eligible, client)

    elapsed = time.time() - start
    logger.info(
        "Refresh complete in %.1f minutes. Phase1=%d tickers, options=%d tickers.",
        elapsed / 60, len(p1_tickers), len(eligible),
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Oxas screener refresh")
    parser.add_argument("--test",        action="store_true", help="Run on top 10 tickers only")
    parser.add_argument("--large-cap",   action="store_true", help="Run on ~500 large-cap stocks (S&P 500 approx)")
    parser.add_argument("--greeks-only", action="store_true", help="Backfill ATM greeks for options-eligible tickers already in DB")
    args = parser.parse_args()
    main(test=args.test, large_cap=args.large_cap, greeks_only=args.greeks_only)
