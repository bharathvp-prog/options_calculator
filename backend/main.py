import os
import re
import math
import time
from typing import Any
from concurrent.futures import ThreadPoolExecutor
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth, firestore
from fastapi import FastAPI, HTTPException, Header, Query, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import yfinance as yf
from datetime import date, datetime, timezone
from services.options import get_expiry_dates, get_option_chain, find_cheapest, pick_horizon_expiries, get_options_for_expiry
from services.tickers import load_tickers, search_tickers
from services.strategy import identify_strategy
from services.payoff import OptionLeg, compute_payoff_table
from services.portfolio import parse_saxo_xlsx, symbol_to_yf_ticker, get_price_history
from services.historical import parse_historical_xlsx
from services.validation import spread_validity_error
from services.supabase_client import get_supabase
from services.financials import get_financial_history
import uuid as _uuid

load_dotenv()

from logging_config import setup_logging
setup_logging()
import logging
logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK
import json as _json
_firebase_json_env = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
_firebase_cert_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase_config.json")
if _firebase_json_env:
    cred = credentials.Certificate(_json.loads(_firebase_json_env))
    firebase_admin.initialize_app(cred)
elif os.path.exists(_firebase_cert_path):
    cred = credentials.Certificate(_firebase_cert_path)
    firebase_admin.initialize_app(cred)
else:
    logger.warning(
        "Firebase service account not found. "
        "Auth is disabled — all requests will be accepted. "
        "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.",
    )

app = FastAPI(title="ArkenVault API")

@app.on_event("startup")
async def startup_event():
    # Load tickers in a background thread so startup isn't blocked
    import threading
    threading.Thread(target=load_tickers, daemon=True).start()

_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
_allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info("%s %s → %d (%.1fms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


def verify_token(authorization: str = Header(default=None)) -> dict:
    if not firebase_admin._apps:
        # Firebase not configured — dev mode, skip auth
        return {"uid": "dev", "email": "dev@local"}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return firebase_auth.verify_id_token(token)
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ── Models ──────────────────────────────────────────────────────────────────

class Leg(BaseModel):
    ticker: str
    expiry_from: str
    expiry_to: str
    strike_min: float | None = None
    strike_max: float | None = None
    option_type: str  # "call" or "put"
    side: str = "buy"  # "buy" or "sell"


class SearchRequest(BaseModel):
    legs: list[Leg]
    sort_by: str = "ask"
    same_expiry: bool = False


class StrategyRequest(BaseModel):
    view: str


class StrategyCompareLeg(BaseModel):
    option_type: str  # "call" or "put"
    side: str         # "buy" or "sell"
    strike_hint: float | None = None
    qty: int = 1      # number of contracts


class StrategyCompareRequest(BaseModel):
    ticker: str
    legs: list[StrategyCompareLeg]
    sort_by: str = "ask"


class CyclingPosition(BaseModel):
    id: str
    ticker: str
    expiry: str
    strike: float
    premium: float
    entry_date: str
    units: int
    locked: bool = False


class CyclingDoc(BaseModel):
    cash_secured_puts: list[CyclingPosition] = []
    covered_calls: list[CyclingPosition] = []


class ScenarioCells(BaseModel):
    revenue:          list[float | None]
    gross_profit:     list[float | None]
    op_expenses:      list[float | None]
    operating_income: list[float | None]
    net_income:       list[float | None]
    diluted_eps:      list[float | None]


class ScenarioInput(BaseModel):
    revenue_cagr:              float = 0
    gross_margin_target:       float = 0
    opex_cagr:                 float = 0
    tax_rate:                  float | None = None
    pe_multiple:               float = 0
    cells:                     ScenarioCells
    revenue_growth_by_year:    list[float] | None = None
    gross_margin_by_year:      list[float] | None = None
    opex_growth_by_year:       list[float] | None = None
    tax_rate_by_year:          list[float] | None = None
    pe_by_year:                list[float] | None = None


class PlanSaveRequest(BaseModel):
    id:                  str | None = None
    name:                str
    ticker:              str
    shares_outstanding:  int | None = None
    current_price:       float | None = None
    historical:          dict
    scenarios:           dict[str, ScenarioInput]  # keys: "bear", "base", "bull"
    input_mode:          str | None = None
    avg_tax_rate:        float | None = None
    notes:               str | None = None


# ── Firestore ───────────────────────────────────────────────────────────────

def get_firestore():
    if not firebase_admin._apps:
        return None
    return firestore.client()


# ── Routes ──────────────────────────────────────────────────────────────────

@app.post("/api/strategy/identify")
def strategy_identify(payload: StrategyRequest):
    if not payload.view.strip():
        raise HTTPException(status_code=400, detail="View cannot be empty")
    result = identify_strategy(payload.view)
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    
    # Try fetching the current stock price
    try:
        t_obj = yf.Ticker(result["ticker"])
        cp = None
        try:
            cp = getattr(t_obj.fast_info, "last_price", None)
        except Exception:
            pass
            
        if cp is None or str(cp).lower() == "nan":
            df_hist = t_obj.history(period="1d")
            if not df_hist.empty:
                cp = df_hist["Close"].iloc[-1]
                
        if cp is not None:
            result["current_price"] = float(cp)
        else:
            result["current_price"] = None
    except Exception as e:
        logger.warning("Could not fetch current price for %s: %s", result.get("ticker"), e)
        result["current_price"] = None

    return result


@app.post("/api/strategy/compare")
def strategy_compare(payload: StrategyCompareRequest, authorization: str = Header(default=None)):
    verify_token(authorization)

    ticker_obj = yf.Ticker(payload.ticker.upper())
    try:
        all_expiries = list(ticker_obj.options)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch options for {payload.ticker}: {e}")

    horizons = pick_horizon_expiries(all_expiries)
    today_date = date.today()
    results = []
    skipped = []

    for label, expiry in horizons.items():
        dte = (date.fromisoformat(expiry) - today_date).days
        leg_results = []
        total_cost = 0.0
        valid = True

        for leg in payload.legs:
            try:
                # Get the whole chain for this expiry and match the closest strike
                df = get_options_for_expiry(ticker_obj, expiry, leg.option_type, None, None)
                if df.empty:
                    valid = False
                    break

                target_strike = leg.strike_hint
                if target_strike is None:
                    # Default to At-The-Money (ATM) if no hint provided
                    try:
                        target_strike = ticker_obj.fast_info.get("lastPrice")
                    except Exception:
                        target_strike = None
                    if target_strike is None:
                        try:
                            target_strike = ticker_obj.history(period="1d")["Close"].iloc[-1]
                        except Exception:
                            target_strike = df["strike"].median() # Safe fallback

                # Only consider rows that have a usable price for this leg side
                price_col = "ask" if leg.side == "buy" else "bid"
                df_priceable = df[df[price_col] > 0]
                if df_priceable.empty:
                    # Fall back to any row with a last traded price
                    df_priceable = df[df["lastPrice"] > 0]
                if df_priceable.empty:
                    valid = False
                    break
                df_priceable = df_priceable.copy()
                df_priceable["strike_diff"] = (df_priceable["strike"] - target_strike).abs()
                best_row = df_priceable.loc[df_priceable["strike_diff"].idxmin()].to_dict()

                def safe_val(val, default_val, cast_type):
                    try:
                        if val is None or str(val).lower() == "nan": return default_val
                        return cast_type(val)
                    except Exception:
                        return default_val

                cheapest = {
                    "contractSymbol": safe_val(best_row.get("contractSymbol"), "", str),
                    "expiration": safe_val(best_row.get("expiration"), expiry, str),
                    "strike": safe_val(best_row.get("strike"), 0.0, float),
                    "option_type": safe_val(best_row.get("option_type"), leg.option_type, str),
                    "bid": safe_val(best_row.get("bid"), 0.0, float),
                    "ask": safe_val(best_row.get("ask"), 0.0, float),
                    "mid": safe_val(best_row.get("mid"), 0.0, float),
                    "spread": safe_val(best_row.get("spread"), 0.0, float),
                    "lastPrice": safe_val(best_row.get("lastPrice"), 0.0, float),
                    "volume": safe_val(best_row.get("volume"), 0, int),
                    "openInterest": safe_val(best_row.get("openInterest"), 0, int),
                    "impliedVolatility": safe_val(best_row.get("impliedVolatility"), 0.0, float),
                }
            except Exception as e:
                logger.error("Error fetching leg for %s %s", payload.ticker, expiry, exc_info=True)
                cheapest = None

            if cheapest is None:
                valid = False
                break

            leg_results.append({**cheapest, "side": leg.side, "qty": leg.qty})
            if leg.side == "buy":
                price = cheapest["ask"] if cheapest["ask"] > 0 else cheapest["lastPrice"]
            else:
                price = cheapest["bid"] if cheapest["bid"] > 0 else cheapest["lastPrice"]
            total_cost += price * leg.qty if leg.side == "buy" else -price * leg.qty

        if not valid:
            continue

        err = spread_validity_error(leg_results)
        if err:
            skipped.append({"label": label, "expiry": expiry, "reason": err})
            continue

        net_debit = round(total_cost, 4)
        net_cost_dollars = round(net_debit * 100, 2)
        cost_per_day = round(net_cost_dollars / dte, 4) if dte > 0 and net_cost_dollars > 0 else None

        payoff_legs = [
            OptionLeg(
                option_type=pl.option_type,
                side=pl.side,
                strike=lr["strike"],
                qty=pl.qty,
            )
            for pl, lr in zip(payload.legs, leg_results)
        ]
        payoff = compute_payoff_table(payoff_legs, net_cost_dollars)
        payoff_at = payoff["payoff_at"]
        max_profit = payoff["max_profit"]
        max_loss = payoff["max_loss"]
        max_roi = payoff["max_roi"]
        breakevens = payoff["breakevens"]

        results.append({
            "label": label,
            "expiry": expiry,
            "dte": dte,
            "legs": leg_results,
            "net_debit": net_debit,
            "net_cost_dollars": net_cost_dollars,
            "cost_per_day": cost_per_day,
            "max_profit": round(max_profit, 2) if max_profit is not None else None,
            "max_loss": round(max_loss, 2) if max_loss is not None else None,
            "max_roi": max_roi,
            "breakevens": breakevens,
            "payoff_at": payoff_at,
        })

    if not results:
        reasons = "; ".join(sorted(set(s["reason"] for s in skipped))) if skipped else "unknown"
        raise HTTPException(
            status_code=404,
            detail=(
                f"No priceable contracts found for any horizon. {reasons}. "
                "Try strike targets closer to the current price."
            ),
        )

    valid_cpd = [r for r in results if r.get("cost_per_day") and r["cost_per_day"] > 0]
    best_expiry = min(valid_cpd, key=lambda r: r["cost_per_day"])["expiry"] if valid_cpd else None
    for r in results:
        r["best_value"] = (r["expiry"] == best_expiry)

    return {"ticker": payload.ticker.upper(), "horizons": results, "skipped": skipped}


@app.get("/api/tickers/search")
def ticker_search(q: str = Query(default="", min_length=0)):
    return {"results": search_tickers(q, limit=10)}


@app.get("/api/options/expiries")
def get_expiries(ticker: str = Query(..., description="Stock ticker symbol")):
    try:
        clean_ticker = ticker.upper().split(":")[0].strip()
        expiries = get_expiry_dates(clean_ticker)

        current_price = None
        try:
            t_obj = yf.Ticker(clean_ticker)
            cp = getattr(t_obj.fast_info, "last_price", None)
            if cp is None or str(cp).lower() == "nan":
                df_hist = t_obj.history(period="1d")
                if not df_hist.empty:
                    cp = float(df_hist["Close"].iloc[-1])
            if cp is not None:
                current_price = float(cp)
        except Exception:
            pass

        return {"ticker": clean_ticker, "expiries": expiries, "current_price": current_price}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


def _safe_float(v):
    """Return None if v is None or NaN, else float(v)."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _yf_ticker(symbol: str) -> yf.Ticker:
    return yf.Ticker(symbol)


import threading
_yf_info_lock = threading.Lock()


# ── Company description cache (60-day TTL — descriptions rarely change) ───────
import json as _json
from pathlib import Path as _Path

_COMPANY_CACHE_FILE = _Path(__file__).parent / "data" / "company_cache.json"
_COMPANY_CACHE_TTL_DAYS = 60


def _load_company_cache() -> dict:
    if not _COMPANY_CACHE_FILE.exists():
        return {}
    try:
        return _json.loads(_COMPANY_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_company_cache(cache: dict):
    _COMPANY_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _COMPANY_CACHE_FILE.write_text(_json.dumps(cache, indent=2), encoding="utf-8")


@app.get("/api/stock/{ticker}")
def get_stock(ticker: str):
    clean = ticker.upper().strip()
    if not re.match(r'^[A-Z0-9.\-]{1,10}$', clean):
        raise HTTPException(status_code=400, detail=f"Invalid ticker format: {ticker}")

    t = _yf_ticker(clean)

    # ── Fetch info (serialised to avoid crumb race), then history+options in parallel ──
    def _fetch_info():
        with _yf_info_lock:
            try:
                return t.info or {}
            except Exception:
                logger.warning("yfinance .info failed for %s", clean)
                return {}

    def _fetch_history():
        try:
            df = t.history(period="1y").dropna(subset=["Close"])
            return (
                [d.strftime("%Y-%m-%d") for d in df.index],
                [round(float(v), 4) for v in df["Close"]],
            )
        except Exception:
            return [], []

    def _fetch_options():
        try:
            expiries = list(t.options)
            if expiries:
                chain = t.option_chain(expiries[0])
                return expiries, chain.calls, chain.puts
            return [], None, None
        except Exception:
            return [], None, None

    info = _fetch_info()
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_history = ex.submit(_fetch_history)
        f_options = ex.submit(_fetch_options)
        history_dates, history_prices = f_history.result()
        options_expiries, calls_df, puts_df = f_options.result()

    # ── Price ─────────────────────────────────────────────────────────────────
    current_price = None
    market_cap = None
    fifty_two_week_high = None
    fifty_two_week_low = None
    try:
        fi = t.fast_info
        current_price = _safe_float(getattr(fi, "last_price", None))
        market_cap = _safe_float(getattr(fi, "market_cap", None))
        fifty_two_week_high = _safe_float(getattr(fi, "year_high", None) or getattr(fi, "fifty_two_week_high", None))
        fifty_two_week_low = _safe_float(getattr(fi, "year_low", None) or getattr(fi, "fifty_two_week_low", None))
    except Exception:
        pass

    # ── Fundamentals (from parallel info fetch) ───────────────────────────────
    name = info.get("longName") or info.get("shortName") or clean
    sector = info.get("sector") or None
    industry = info.get("industry") or None
    pe_ratio = _safe_float(info.get("trailingPE"))
    forward_pe = _safe_float(info.get("forwardPE"))
    previous_close = _safe_float(info.get("previousClose"))
    avg_volume = _safe_float(info.get("averageVolume"))
    volume = _safe_float(info.get("volume"))
    if current_price is None:
        current_price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    if fifty_two_week_high is None:
        fifty_two_week_high = _safe_float(info.get("fiftyTwoWeekHigh"))
    if fifty_two_week_low is None:
        fifty_two_week_low = _safe_float(info.get("fiftyTwoWeekLow"))

    # Fallback price from history
    if current_price is None and history_prices:
        current_price = history_prices[-1]

    if current_price is None:
        raise HTTPException(status_code=404, detail=f"No data found for ticker: {clean}")

    change = None
    change_pct = None
    if previous_close is not None and previous_close != 0:
        change = round(current_price - previous_close, 4)
        change_pct = round(change / previous_close * 100, 4)

    # ── Options IV (from parallel options fetch) ──────────────────────────────
    nearest_expiry_iv = None
    if options_expiries and calls_df is not None and puts_df is not None:
        try:
            if not calls_df.empty and not puts_df.empty:
                all_strikes = sorted(calls_df["strike"].tolist())
                atm = min(all_strikes, key=lambda s: abs(s - current_price))
                atm_idx = all_strikes.index(atm)
                nearby = all_strikes[max(0, atm_idx - 5): atm_idx + 6]
                call_ivs = calls_df[calls_df["strike"].isin(nearby)]["impliedVolatility"].dropna().tolist()
                put_ivs = puts_df[puts_df["strike"].isin(nearby)]["impliedVolatility"].dropna().tolist()
                avg_call_iv = round(sum(call_ivs) / len(call_ivs), 4) if len(call_ivs) >= 2 else None
                avg_put_iv = round(sum(put_ivs) / len(put_ivs), 4) if len(put_ivs) >= 2 else None
                ivs = [v for v in [avg_call_iv, avg_put_iv] if v is not None]
                nearest_expiry_iv = {
                    "expiry": options_expiries[0],
                    "avg_call_iv": avg_call_iv,
                    "avg_put_iv": avg_put_iv,
                    "avg_iv": round(sum(ivs) / len(ivs), 4) if ivs else None,
                }
        except Exception:
            pass

    # ── Company static info (cached 60 days) ─────────────────────────────────
    company_cache = _load_company_cache()
    cache_entry = company_cache.get(clean, {})
    cache_age_days = (
        (datetime.now() - datetime.fromisoformat(cache_entry["cached_at"])).days
        if "cached_at" in cache_entry else 999
    )
    cache_has_data = any(cache_entry.get(k) for k in ["description", "employees", "website", "country"])
    if cache_age_days < _COMPANY_CACHE_TTL_DAYS and cache_has_data:
        description = cache_entry.get("description")
        employees = cache_entry.get("employees")
        website = cache_entry.get("website")
        country = cache_entry.get("country")
    else:
        description = info.get("longBusinessSummary") or None
        employees = info.get("fullTimeEmployees") or None
        website = info.get("website") or None
        country = info.get("country") or None
        if any([description, employees, website, country]):
            company_cache[clean] = {
                "description": description, "employees": employees,
                "website": website, "country": country,
                "cached_at": datetime.now().isoformat(),
            }
            _save_company_cache(company_cache)

    return {
        "ticker": clean,
        "name": name,
        "sector": sector,
        "industry": industry,
        "current_price": current_price,
        "change": change,
        "change_pct": change_pct,
        "market_cap": market_cap,
        "pe_ratio": pe_ratio,
        "forward_pe": forward_pe,
        "fifty_two_week_high": fifty_two_week_high,
        "fifty_two_week_low": fifty_two_week_low,
        "volume": volume,
        "avg_volume": avg_volume,
        "history_dates": history_dates,
        "history_prices": history_prices,
        "options_expiries": options_expiries,
        "nearest_expiry_iv": nearest_expiry_iv,
        "description": description,
        "employees": employees,
        "website": website,
        "country": country,
    }


@app.get("/api/stock/{ticker}/news")
def get_stock_news(ticker: str):
    import urllib.request
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    clean = ticker.upper().strip()
    if not re.match(r'^[A-Z0-9.\-]{1,10}$', clean):
        raise HTTPException(status_code=400, detail=f"Invalid ticker format: {ticker}")
    news = []
    try:
        rss_url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={clean}&region=US&lang=en-US"
        req = urllib.request.Request(rss_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            xml_bytes = resp.read()
        root = ET.fromstring(xml_bytes)
        ns = {"dc": "http://purl.org/dc/elements/1.1/"}
        for item in root.findall(".//item")[:6]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            publisher = (item.findtext("dc:creator", namespaces=ns) or "Yahoo Finance").strip()
            pub_date_str = item.findtext("pubDate") or ""
            published_at = None
            if pub_date_str:
                try:
                    published_at = parsedate_to_datetime(pub_date_str).isoformat()
                except Exception:
                    pass
            if title and link:
                news.append({
                    "title": title,
                    "publisher": publisher,
                    "link": link,
                    "published_at": published_at,
                })
    except Exception:
        pass
    return {"news": news}


def _bs_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> dict:
    """Black-Scholes Greeks. T in years, sigma as decimal (e.g. 0.30)."""
    import math
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    try:
        sqrt_T = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
        d2 = d1 - sigma * sqrt_T
        # Standard normal CDF via erf
        def _N(x):
            return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))
        # Standard normal PDF
        def _n(x):
            return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)
        nd1 = _n(d1)
        if option_type == "call":
            delta = _N(d1)
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) - r * K * math.exp(-r * T) * _N(d2)) / 365
        else:
            delta = _N(d1) - 1
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) + r * K * math.exp(-r * T) * _N(-d2)) / 365
        gamma = nd1 / (S * sigma * sqrt_T)
        vega = S * nd1 * sqrt_T / 100  # per 1% move in IV
        return {
            "delta": round(delta, 4),
            "gamma": round(gamma, 4),
            "theta": round(theta, 4),
            "vega": round(vega, 4),
        }
    except Exception:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}


@app.get("/api/stock/{ticker}/chain")
def get_option_chain_for_expiry(ticker: str, expiry: str):
    """Return calls + puts for a specific expiry, ±4 strikes around current price, with BS Greeks."""
    clean = ticker.upper().strip()
    if not re.match(r'^[A-Z0-9.\-]{1,10}$', clean):
        raise HTTPException(status_code=400, detail=f"Invalid ticker format: {ticker}")
    try:
        t = _yf_ticker(clean)
        fi = t.fast_info
        current_price = _safe_float(getattr(fi, "last_price", None))

        chain = t.option_chain(expiry)
        calls_df = chain.calls.copy()
        puts_df = chain.puts.copy()

        # DTE in years for Black-Scholes
        today = date.today()
        try:
            exp_date = date.fromisoformat(expiry)
            T = max((exp_date - today).days, 0) / 365.0
        except Exception:
            T = 0.0
        R = 0.045  # risk-free rate (~current US 3-month T-bill)

        def _serialize_chain(df, option_type: str):
            if df.empty:
                return []
            rows = []
            for _, row in df.iterrows():
                def sv(v, cast=float):
                    try:
                        val = cast(v)
                        return None if (val != val) else val
                    except Exception:
                        return None
                strike = sv(row.get("strike"))
                bid = sv(row.get("bid"))
                ask = sv(row.get("ask"))
                if bid == 0.0:
                    bid = None
                if ask == 0.0:
                    ask = None
                mid = round((bid + ask) / 2, 4) if bid is not None and ask is not None else None
                iv = sv(row.get("impliedVolatility"))
                if iv is not None and iv < 0.001:
                    iv = None
                greeks = (
                    _bs_greeks(current_price, strike, T, R, iv, option_type)
                    if current_price and strike and iv and T > 0
                    else {"delta": None, "gamma": None, "theta": None, "vega": None}
                )
                rows.append({
                    "strike": strike,
                    "bid": bid,
                    "ask": ask,
                    "mid": mid,
                    "last": sv(row.get("lastPrice")),
                    "iv": iv,
                    "delta": greeks["delta"],
                    "gamma": greeks["gamma"],
                    "theta": greeks["theta"],
                    "vega": greeks["vega"],
                    "volume": sv(row.get("volume"), int),
                    "open_interest": sv(row.get("openInterest"), int),
                    "in_the_money": bool(row.get("inTheMoney", False)),
                })
            return rows

        all_calls = _serialize_chain(calls_df, "call")
        all_puts = _serialize_chain(puts_df, "put")

        # Pick 8 strikes closest to current price
        if current_price and all_calls:
            strikes = sorted(set(r["strike"] for r in all_calls if r["strike"] is not None))
            if strikes:
                atm_idx = min(range(len(strikes)), key=lambda i: abs(strikes[i] - current_price))
                selected = set(strikes[max(0, atm_idx - 4): atm_idx + 4])
                all_calls = [r for r in all_calls if r["strike"] in selected]
                all_puts = [r for r in all_puts if r["strike"] in selected]

        return {
            "expiry": expiry,
            "current_price": current_price,
            "calls": all_calls,
            "puts": all_puts,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
def search_cheapest(payload: SearchRequest, authorization: str = Header(default=None)):
    verify_token(authorization)

    # Fetch all matching DataFrames per leg
    leg_dfs = []
    for i, leg in enumerate(payload.legs):
        try:
            df = get_option_chain(
                ticker=leg.ticker.upper(),
                expiry_from=leg.expiry_from,
                expiry_to=leg.expiry_to,
                strike_min=leg.strike_min,
                strike_max=leg.strike_max,
                option_type=leg.option_type,
            )
        except Exception:
            logger.error("Error fetching leg %d (%s)", i, leg.ticker, exc_info=True)
            df = None
        leg_dfs.append(df)

    # If same_expiry: find the common expiry date that minimises net debit
    forced_expiry = None
    if payload.same_expiry and len(payload.legs) > 1:
        expiry_sets = []
        for df in leg_dfs:
            if df is not None and not df.empty:
                expiry_sets.append(set(df["expiration"].unique()))
        if expiry_sets:
            common = expiry_sets[0].intersection(*expiry_sets[1:])
            if common:
                best_expiry = None
                best_net = None
                for exp in sorted(common):
                    net = 0.0
                    valid = True
                    for df, leg in zip(leg_dfs, payload.legs):
                        if df is None or df.empty:
                            valid = False
                            break
                        sub = df[df["expiration"] == exp]
                        cheapest = find_cheapest(sub, sort_by=payload.sort_by)
                        if cheapest is None:
                            valid = False
                            break
                        price = cheapest["ask"] if leg.side == "buy" else cheapest["bid"]
                        net += price if leg.side == "buy" else -price
                    if valid and (best_net is None or net < best_net):
                        best_net = net
                        best_expiry = exp
                forced_expiry = best_expiry

    # Now find cheapest per leg (filtered to forced_expiry if set)
    results = []
    total_buy_ask = 0.0
    total_sell_bid = 0.0
    total_mid = 0.0

    for i, (leg, df) in enumerate(zip(payload.legs, leg_dfs)):
        cheapest = None
        try:
            if df is not None and not df.empty:
                filtered = df[df["expiration"] == forced_expiry] if forced_expiry else df
                cheapest = find_cheapest(filtered, sort_by=payload.sort_by)
        except Exception:
            logger.error("Error finding cheapest for leg %d (%s)", i, leg.ticker, exc_info=True)

        result = {"leg_index": i, "ticker": leg.ticker.upper(), "side": leg.side}
        if cheapest:
            result.update(cheapest)
            if leg.side == "buy":
                total_buy_ask += cheapest["ask"]
            else:
                total_sell_bid += cheapest["bid"]
            total_mid += cheapest["mid"] if leg.side == "buy" else -cheapest["mid"]
        else:
            result["error"] = "No options found matching the specified parameters"

        results.append(result)

    net_debit = round(total_buy_ask - total_sell_bid, 4)

    return {
        "legs": results,
        "net_debit": net_debit,
        "total_ask": round(total_buy_ask, 4),
        "total_sell_bid": round(total_sell_bid, 4),
        "total_mid": round(total_mid, 4),
        "forced_expiry": forced_expiry,
    }


# ── Portfolio endpoints ──────────────────────────────────────────────────────

@app.post("/api/portfolio/upload")
async def portfolio_upload(
    file: UploadFile = File(...),
    authorization: str = Header(default=None),
):
    user = verify_token(authorization)
    uid = user["uid"]

    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")

    content = await file.read()
    try:
        positions = parse_saxo_xlsx(content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")

    for p in positions:
        p["yf_ticker"] = symbol_to_yf_ticker(p.get("symbol", ""), p.get("asset_type", ""))

    stock_tickers = list(dict.fromkeys(
        p["yf_ticker"] for p in positions
        if p.get("asset_type") != "Stock Option" and p.get("yf_ticker")
    ))
    has_options_cache: dict[str, bool] = {}
    for t in stock_tickers:
        try:
            has_options_cache[t] = bool(yf.Ticker(t).options)
        except Exception:
            logger.warning("Failed to check options for %s", t, exc_info=True)
            has_options_cache[t] = False

    for p in positions:
        if p.get("asset_type") == "Stock Option":
            p["has_options"] = True
        else:
            p["has_options"] = has_options_cache.get(p.get("yf_ticker"), False)

    all_tickers = list(dict.fromkeys(p["yf_ticker"] for p in positions if p.get("yf_ticker")))
    price_dates, price_data = get_price_history(all_tickers, days=14) if all_tickers else ([], {})

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {"uploaded_at": uploaded_at, "positions": positions,
           "price_dates": price_dates, "price_data": price_data}

    db = get_firestore()
    if db is not None:
        db.collection("portfolios").document(uid).set(doc, merge=True)

    return {"uploaded_at": uploaded_at, "count": len(positions)}


@app.get("/api/portfolio")
def portfolio_get(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        return {"positions": [], "uploaded_at": None}

    doc_ref = db.collection("portfolios").document(uid)
    doc = doc_ref.get()
    if not doc.exists:
        return {"positions": [], "uploaded_at": None}

    data = doc.to_dict()
    return {
        "positions": data.get("positions", []),
        "uploaded_at": data.get("uploaded_at"),
        "price_dates": data.get("price_dates", []),
        "price_data": data.get("price_data", {}),
    }


@app.get("/api/portfolio/prices")
def portfolio_prices(authorization: str = Header(default=None), days: int = Query(default=7)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        return {"dates": [], "prices": {}}

    doc_ref = db.collection("portfolios").document(uid)
    doc = doc_ref.get()
    if not doc.exists:
        return {"dates": [], "prices": {}}

    positions = doc.to_dict().get("positions", [])
    tickers = list(dict.fromkeys(
        p["yf_ticker"] for p in positions if p.get("yf_ticker")
    ))
    if not tickers:
        return {"dates": [], "prices": {}}

    dates, prices = get_price_history(tickers, days=days)
    return {"dates": dates, "prices": prices}


@app.post("/api/portfolio/refresh")
def portfolio_refresh(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")

    doc_ref = db.collection("portfolios").document(uid)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="No portfolio found")

    positions = doc.to_dict().get("positions", [])
    tickers = list(dict.fromkeys(p["yf_ticker"] for p in positions if p.get("yf_ticker")))

    latest_prices: dict[str, float] = {}
    if tickers:
        _, price_map = get_price_history(tickers, days=1)
        for ticker, vals in price_map.items():
            if vals and vals[-1] is not None:
                latest_prices[ticker] = vals[-1]

    for pos in positions:
        yf_ticker = pos.get("yf_ticker")
        new_price = latest_prices.get(yf_ticker) if yf_ticker else None
        if new_price is None:
            continue

        if pos.get("asset_type") == "Stock Option":
            pos["underlying_price"] = round(new_price, 4)
        else:
            old_price = pos.get("current_price")
            if not old_price:
                continue
            qty_fx = (pos.get("market_value_sgd") or 0) / old_price
            pos["current_price"] = round(new_price, 4)
            pos["market_value_sgd"] = round(new_price * qty_fx, 2)
            open_price = pos.get("open_price") or 0
            if pos.get("l_s") == "Short":
                pos["pnl_sgd"] = round((open_price - new_price) * qty_fx, 2)
            else:
                pos["pnl_sgd"] = round((new_price - open_price) * qty_fx, 2)

    stock_tickers_r = list(dict.fromkeys(
        p["yf_ticker"] for p in positions
        if p.get("asset_type") != "Stock Option" and p.get("yf_ticker")
    ))
    has_options_r: dict[str, bool] = {}
    for t in stock_tickers_r:
        try:
            has_options_r[t] = bool(yf.Ticker(t).options)
        except Exception:
            logger.warning("Failed to check options for %s", t, exc_info=True)
            has_options_r[t] = False

    for pos in positions:
        if pos.get("asset_type") == "Stock Option":
            pos["has_options"] = True
        else:
            pos["has_options"] = has_options_r.get(pos.get("yf_ticker"), False)

    price_dates, price_data = get_price_history(tickers, days=14) if tickers else ([], {})

    refreshed_at = datetime.now(timezone.utc).isoformat()
    doc_ref.set({"uploaded_at": refreshed_at, "positions": positions,
                 "price_dates": price_dates, "price_data": price_data}, merge=True)
    return {"uploaded_at": refreshed_at, "positions": positions,
            "price_dates": price_dates, "price_data": price_data}


class CashPayload(BaseModel):
    amount: float
    date: str  # ISO date string e.g. "2026-04-01"


@app.get("/api/portfolio/cash")
def portfolio_cash_get(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        return {"cash_history": []}

    doc = db.collection("portfolios").document(uid).get()
    if not doc.exists:
        return {"cash_history": []}

    data = doc.to_dict()
    history = data.get("cash_history", [])
    # Migrate legacy cash_sgd field (single value, no date)
    if not history and "cash_sgd" in data and data["cash_sgd"]:
        history = [{"date": "2000-01-01", "amount": data["cash_sgd"]}]
    # Seed default starting balance if no history recorded yet
    if not history:
        history = [{"date": "2026-03-01", "amount": 81000.0}]
        db.collection("portfolios").document(uid).set({"cash_history": history}, merge=True)
    return {"cash_history": sorted(history, key=lambda e: e["date"])}


@app.patch("/api/portfolio/cash")
def portfolio_cash_update(payload: CashPayload, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")

    doc = db.collection("portfolios").document(uid).get()
    data = doc.to_dict() if doc.exists else {}
    history = data.get("cash_history", [])
    # Remove any existing entry for the same date, then append
    history = [e for e in history if e["date"] != payload.date]
    history.append({"date": payload.date, "amount": payload.amount})
    history.sort(key=lambda e: e["date"])
    db.collection("portfolios").document(uid).set({"cash_history": history}, merge=True)
    return {"cash_history": history}


# ── Options chain helpers ────────────────────────────────────────────────────

@app.get("/api/options/strikes")
def get_strikes(
    ticker: str = Query(...),
    expiry: str = Query(...),
    option_type: str = Query(...),
):
    try:
        df = get_options_for_expiry(yf.Ticker(ticker.upper()), expiry, option_type)
        if df.empty:
            raise HTTPException(status_code=404, detail="No options found for this expiry")
        strikes = sorted(df["strike"].unique().tolist())
        return {"strikes": strikes}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/options/contract")
def get_contract(
    ticker: str = Query(...),
    expiry: str = Query(...),
    strike: float = Query(...),
    option_type: str = Query(...),
):
    try:
        df = get_options_for_expiry(yf.Ticker(ticker.upper()), expiry, option_type)
        if df.empty:
            raise HTTPException(status_code=404, detail="No options found for this expiry")
        matching = df[df["strike"] == strike]
        if matching.empty:
            raise HTTPException(status_code=404, detail=f"No contract found for strike {strike}")
        row = matching.iloc[0]

        import math
        def safe(v, cast=float):
            try:
                f = cast(v)
                return None if (isinstance(f, float) and math.isnan(f)) else f
            except Exception:
                return None

        bid = safe(row["bid"])
        ask = safe(row["ask"])
        last = safe(row["lastPrice"])
        bid = bid if bid and bid > 0 else None
        ask = ask if ask and ask > 0 else None
        last = last if last and last > 0 else None
        mid = round((bid + ask) / 2, 4) if bid and ask else None
        premium = mid if mid is not None else last

        return {
            "bid": bid,
            "ask": ask,
            "lastPrice": last,
            "mid": mid,
            "premium": premium,
            "premium_source": "mid" if mid is not None else "ltp",
            "impliedVolatility": safe(row["impliedVolatility"]),
            "volume": safe(row["volume"], int) or 0,
            "openInterest": safe(row["openInterest"], int) or 0,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Cycling endpoints ────────────────────────────────────────────────────────

@app.get("/api/cycling")
def cycling_get(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        return {"cash_secured_puts": [], "covered_calls": []}

    doc = db.collection("cycling").document(uid).get()
    if not doc.exists:
        return {"cash_secured_puts": [], "covered_calls": []}

    data = doc.to_dict()
    return {
        "cash_secured_puts": data.get("cash_secured_puts", []),
        "covered_calls": data.get("covered_calls", []),
    }


@app.post("/api/cycling")
def cycling_save(payload: CyclingDoc, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")

    db.collection("cycling").document(uid).set({
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cash_secured_puts": [p.dict() for p in payload.cash_secured_puts],
        "covered_calls": [p.dict() for p in payload.covered_calls],
    })
    return {"ok": True}


@app.get("/api/fx/usdsgd")
def get_usdsgd_rate():
    db = get_firestore()
    cache_doc = None

    # Check Firestore cache
    if db is not None:
        try:
            cache_doc = db.collection("fx_cache").document("USDSGD").get()
            if cache_doc.exists:
                cached = cache_doc.to_dict()
                updated_at = cached.get("updated_at")
                rate = cached.get("rate")
                if updated_at and rate:
                    age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(updated_at)).days
                    if age_days < 7:
                        return {"rate": rate}
        except Exception:
            logger.warning("Failed to read FX cache from Firestore", exc_info=True)

    # Fetch fresh rate
    rate = None
    try:
        rate = float(yf.Ticker("USDSGD=X").fast_info["last_price"])
    except Exception:
        logger.warning("Failed to fetch USDSGD rate from yfinance", exc_info=True)

    # Persist to Firestore if we got a rate
    if rate is not None and db is not None:
        try:
            db.collection("fx_cache").document("USDSGD").set({
                "rate": rate,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.warning("Failed to write FX cache to Firestore", exc_info=True)

    return {"rate": rate}


# ── Historical Performance endpoints ─────────────────────────────────────────

class LockPayload(BaseModel):
    month: str   # "YYYY-MM"
    locked: bool


@app.post("/api/historical/upload")
async def historical_upload(
    file: UploadFile = File(...),
    authorization: str = Header(default=None),
):
    user = verify_token(authorization)
    uid = user["uid"]

    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")

    content = await file.read()
    try:
        parsed = parse_historical_xlsx(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")

    db = get_firestore()
    existing: dict = {}
    if db is not None:
        doc = db.collection("portfolios").document(uid).get()
        if doc.exists:
            existing = doc.to_dict().get("historical_performance", {})

    skipped_months: list[str] = []
    merged = dict(existing)
    for month, data in parsed.items():
        stored = existing.get(month, {})
        if stored.get("locked"):
            skipped_months.append(month)
            continue
        data["locked"] = stored.get("locked", False)
        merged[month] = data

    uploaded_at = datetime.now(timezone.utc).isoformat()
    if db is not None:
        db.collection("portfolios").document(uid).set(
            {"historical_performance": merged, "historical_uploaded_at": uploaded_at},
            merge=True,
        )

    return {
        "uploaded_at": uploaded_at,
        "months_updated": len(parsed) - len(skipped_months),
        "skipped_months": sorted(skipped_months),
    }


@app.get("/api/historical")
def historical_get(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        return {"historical_performance": {}, "uploaded_at": None}

    doc = db.collection("portfolios").document(uid).get()
    if not doc.exists:
        return {"historical_performance": {}, "uploaded_at": None}

    data = doc.to_dict()
    return {
        "historical_performance": data.get("historical_performance", {}),
        "uploaded_at": data.get("historical_uploaded_at"),
    }


@app.post("/api/historical/lock")
def historical_lock(payload: LockPayload, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")

    doc = db.collection("portfolios").document(uid).get()
    perf: dict = doc.to_dict().get("historical_performance", {}) if doc.exists else {}

    if payload.month not in perf:
        raise HTTPException(status_code=404, detail=f"Month {payload.month} not found")

    perf[payload.month]["locked"] = payload.locked
    db.collection("portfolios").document(uid).set(
        {"historical_performance": perf}, merge=True
    )
    return {"month": payload.month, "locked": payload.locked}


# ── Screener models ──────────────────────────────────────────────────────────

# Whitelist of fields users may filter on — prevents field injection attacks.
ALLOWED_SCREENER_FIELDS: set[str] = {
    "current_price", "price_1d_chg_pct", "price_5d_chg_pct",
    "price_1mo_chg_pct", "price_3mo_chg_pct",
    "ma_50", "ma_200", "week_52_high", "week_52_low",
    "pct_from_52w_high", "pct_from_52w_low",
    "volume_today", "avg_volume_30d", "volume_ratio",
    "market_cap", "pe_ratio", "forward_pe", "price_to_book", "price_to_sales",
    "dividend_yield", "revenue_growth", "earnings_growth", "profit_margin",
    "debt_to_equity", "return_on_equity", "sector", "industry",
    "has_options", "iv_current", "iv_rank", "put_call_ratio",
    "atm_theta", "atm_gamma", "atm_vega", "expected_move_1m",
}

ALLOWED_SORT_FIELDS: set[str] = ALLOWED_SCREENER_FIELDS | {"ticker", "name"}

# Static field metadata served to the frontend
SCREENER_FIELDS_META = [
    # Fundamentals
    {"key": "market_cap",       "label": "Market Cap",       "type": "number",  "category": "Fundamentals", "formatter": "market_cap"},
    {"key": "pe_ratio",         "label": "P/E Ratio",        "type": "number",  "category": "Fundamentals"},
    {"key": "forward_pe",       "label": "Forward P/E",      "type": "number",  "category": "Fundamentals"},
    {"key": "price_to_book",    "label": "Price / Book",     "type": "number",  "category": "Fundamentals"},
    {"key": "price_to_sales",   "label": "Price / Sales",    "type": "number",  "category": "Fundamentals"},
    {"key": "dividend_yield",   "label": "Dividend Yield",   "type": "number",  "category": "Fundamentals", "formatter": "percent"},
    {"key": "revenue_growth",   "label": "Revenue Growth",   "type": "number",  "category": "Fundamentals", "formatter": "percent"},
    {"key": "earnings_growth",  "label": "Earnings Growth",  "type": "number",  "category": "Fundamentals", "formatter": "percent"},
    {"key": "profit_margin",    "label": "Profit Margin",    "type": "number",  "category": "Fundamentals", "formatter": "percent"},
    {"key": "debt_to_equity",   "label": "Debt / Equity",    "type": "number",  "category": "Fundamentals"},
    {"key": "return_on_equity", "label": "Return on Equity", "type": "number",  "category": "Fundamentals", "formatter": "percent"},
    {"key": "sector",           "label": "Sector",           "type": "enum",    "category": "Fundamentals",
     "options": ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
                 "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate",
                 "Technology", "Utilities"]},
    {"key": "industry",         "label": "Industry",         "type": "text",    "category": "Fundamentals"},
    # Price & Momentum
    {"key": "current_price",      "label": "Price",           "type": "number",  "category": "Price & Momentum", "formatter": "price"},
    {"key": "price_1d_chg_pct",   "label": "1D Change",       "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "price_5d_chg_pct",   "label": "5D Change",       "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "price_1mo_chg_pct",  "label": "1M Change",       "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "price_3mo_chg_pct",  "label": "3M Change",       "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "pct_from_52w_high",  "label": "% from 52W High", "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "pct_from_52w_low",   "label": "% from 52W Low",  "type": "number",  "category": "Price & Momentum", "formatter": "percent"},
    {"key": "ma_50",              "label": "50D MA",           "type": "number",  "category": "Price & Momentum", "formatter": "price"},
    {"key": "ma_200",             "label": "200D MA",          "type": "number",  "category": "Price & Momentum", "formatter": "price"},
    {"key": "volume_today",       "label": "Volume",           "type": "number",  "category": "Price & Momentum", "formatter": "volume"},
    {"key": "avg_volume_30d",     "label": "Avg Volume (30D)", "type": "number",  "category": "Price & Momentum", "formatter": "volume"},
    {"key": "volume_ratio",       "label": "Volume Ratio",     "type": "number",  "category": "Price & Momentum"},
    # Options Signals
    {"key": "has_options",      "label": "Has Listed Options", "type": "boolean", "category": "Options Signals", "requires_options": True},
    {"key": "iv_rank",          "label": "IV Rank (0–100)",    "type": "number",  "category": "Options Signals", "requires_options": True},
    {"key": "iv_current",       "label": "Current IV",         "type": "number",  "category": "Options Signals", "requires_options": True, "formatter": "percent"},
    {"key": "put_call_ratio",   "label": "Put/Call Ratio",     "type": "number",  "category": "Options Signals", "requires_options": True},
    {"key": "atm_theta",        "label": "ATM Theta ($/day)",  "type": "number",  "category": "Options Signals", "requires_options": True},
    {"key": "atm_gamma",        "label": "ATM Gamma",          "type": "number",  "category": "Options Signals", "requires_options": True},
    {"key": "atm_vega",         "label": "ATM Vega ($/1% IV)", "type": "number",  "category": "Options Signals", "requires_options": True},
    {"key": "expected_move_1m", "label": "Expected Move 1M",   "type": "number",  "category": "Options Signals", "requires_options": True, "formatter": "percent"},
]


class ScreenerFilter(BaseModel):
    field: str
    op: str      # "gte" | "lte" | "eq" | "neq" | "in"
    value: Any = None


class ScreenerRunRequest(BaseModel):
    filters: list[ScreenerFilter] = []
    sort_field: str = "market_cap"
    sort_dir: str = "desc"
    page: int = 1
    page_size: int = 50


class SavePresetRequest(BaseModel):
    name: str
    filters: list[ScreenerFilter] = []
    sort_field: str = "market_cap"
    sort_dir: str = "desc"


# ── Screener routes ──────────────────────────────────────────────────────────

@app.get("/api/screener/fields")
def screener_fields():
    return {"fields": SCREENER_FIELDS_META}


@app.get("/api/screener/init")
def screener_init(authorization: str = Header(default=None)):
    """Single endpoint that returns fields + status + presets in one call.
    DB queries run concurrently to minimise round-trip latency on page load."""
    sb = get_supabase()

    # Resolve uid from token (optional auth — same pattern as presets endpoint)
    uid = None
    try:
        if firebase_admin._apps and authorization and authorization.startswith("Bearer "):
            decoded = firebase_auth.verify_id_token(authorization.removeprefix("Bearer ").strip())
            uid = decoded["uid"]
        elif not firebase_admin._apps:
            uid = "dev"
    except Exception:
        pass

    phase1_count = 0
    global_presets = []
    user_presets = []

    if sb:
        def fetch_count():
            r = sb.table("screener_tickers").select("ticker", count="exact").eq("phase1_ok", True).execute()
            return r.count or 0

        def fetch_global():
            r = sb.table("global_screener_presets").select("*").order("display_order").execute()
            return r.data or []

        def fetch_user():
            if not uid:
                return []
            r = sb.table("user_screener_presets").select("*").eq("uid", uid).order("updated_at", desc=True).execute()
            return r.data or []

        with ThreadPoolExecutor(max_workers=3) as pool:
            f_count  = pool.submit(fetch_count)
            f_global = pool.submit(fetch_global)
            f_user   = pool.submit(fetch_user)
            try: phase1_count  = f_count.result(timeout=10)
            except Exception as e: logger.warning("screener_init count error: %s", e)
            try: global_presets = f_global.result(timeout=10)
            except Exception as e: logger.warning("screener_init global error: %s", e)
            try: user_presets   = f_user.result(timeout=10)
            except Exception as e: logger.debug("screener_init user error: %s", e)

    return {
        "fields":       SCREENER_FIELDS_META,
        "phase1_count": phase1_count,
        "available":    sb is not None,
        "global":       global_presets,
        "user":         user_presets,
    }


@app.get("/api/screener/status")
def screener_status():
    sb = get_supabase()
    if sb is None:
        return {"total": 0, "phase1_count": 0, "last_updated": None, "available": False}
    try:
        total_resp = sb.table("screener_tickers").select("ticker", count="exact").execute()
        p1_resp = sb.table("screener_tickers").select("ticker", count="exact").eq("phase1_ok", True).execute()
        last_resp = sb.table("screener_tickers").select("refreshed_at").order("refreshed_at", desc=True).limit(1).execute()
        last_updated = last_resp.data[0]["refreshed_at"] if last_resp.data else None
        return {
            "total": total_resp.count or 0,
            "phase1_count": p1_resp.count or 0,
            "last_updated": last_updated,
            "available": True,
        }
    except Exception as e:
        logger.warning("screener_status error: %s", e)
        return {"total": 0, "phase1_count": 0, "last_updated": None, "available": False}


@app.post("/api/screener/run")
def screener_run(payload: ScreenerRunRequest):
    sb = get_supabase()
    if sb is None:
        return {"results": [], "total": 0, "page": payload.page, "available": False}

    # Validate filters against whitelist
    for f in payload.filters:
        if f.field not in ALLOWED_SCREENER_FIELDS:
            raise HTTPException(status_code=400, detail=f"Unknown filter field: {f.field}")
        if f.op not in {"gte", "lte", "eq", "neq", "in"}:
            raise HTTPException(status_code=400, detail=f"Unknown operator: {f.op}")

    if payload.sort_field not in ALLOWED_SORT_FIELDS:
        raise HTTPException(status_code=400, detail=f"Unknown sort field: {payload.sort_field}")

    page_size = min(max(1, payload.page_size), 200)
    start = (payload.page - 1) * page_size
    end = start + page_size - 1

    try:
        q = sb.table("screener_tickers").select("*", count="exact").eq("phase1_ok", True)

        for f in payload.filters:
            if f.op == "gte":
                q = q.gte(f.field, f.value)
            elif f.op == "lte":
                q = q.lte(f.field, f.value)
            elif f.op == "eq":
                q = q.eq(f.field, f.value)
            elif f.op == "neq":
                q = q.neq(f.field, f.value)
            elif f.op == "in":
                vals = f.value if isinstance(f.value, list) else [f.value]
                q = q.in_(f.field, vals)

        q = q.order(payload.sort_field, desc=(payload.sort_dir == "desc"))
        q = q.range(start, end)
        resp = q.execute()

        return {
            "results": resp.data or [],
            "total": resp.count or 0,
            "page": payload.page,
            "page_size": page_size,
            "available": True,
        }
    except Exception as e:
        logger.error("screener_run error: %s", e)
        raise HTTPException(status_code=500, detail="Screener query failed")


@app.get("/api/screener/presets")
def screener_presets_get(authorization: str = Header(default=None)):
    sb = get_supabase()
    if sb is None:
        return {"global": [], "user": []}

    try:
        global_resp = sb.table("global_screener_presets")\
            .select("*")\
            .order("display_order")\
            .execute()
        global_presets = global_resp.data or []
    except Exception as e:
        logger.warning("screener global presets error: %s", e)
        global_presets = []

    user_presets = []
    # Try to get user presets — optional auth
    try:
        if firebase_admin._apps and authorization and authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip()
            decoded = firebase_auth.verify_id_token(token)
            uid = decoded["uid"]
            user_resp = sb.table("user_screener_presets")\
                .select("*")\
                .eq("uid", uid)\
                .order("updated_at", desc=True)\
                .execute()
            user_presets = user_resp.data or []
        elif not firebase_admin._apps:
            # Dev mode — return dev user's presets
            user_resp = sb.table("user_screener_presets")\
                .select("*")\
                .eq("uid", "dev")\
                .order("updated_at", desc=True)\
                .execute()
            user_presets = user_resp.data or []
    except Exception as e:
        logger.debug("screener user presets error (non-fatal): %s", e)

    return {"global": global_presets, "user": user_presets}


@app.post("/api/screener/presets")
def screener_preset_save(payload: SavePresetRequest, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Preset name cannot be empty")

    sb = get_supabase()
    if sb is None:
        raise HTTPException(status_code=503, detail="Screener storage unavailable")

    try:
        resp = sb.table("user_screener_presets").insert({
            "uid":        uid,
            "name":       payload.name.strip(),
            "filters":    [f.model_dump() for f in payload.filters],
            "sort_field": payload.sort_field,
            "sort_dir":   payload.sort_dir,
        }).execute()
        return resp.data[0] if resp.data else {}
    except Exception as e:
        logger.error("screener preset save error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save preset")


@app.delete("/api/screener/presets/{preset_id}")
def screener_preset_delete(preset_id: str, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]

    sb = get_supabase()
    if sb is None:
        raise HTTPException(status_code=503, detail="Screener storage unavailable")

    try:
        # Only delete if it belongs to this user
        sb.table("user_screener_presets")\
            .delete()\
            .eq("id", preset_id)\
            .eq("uid", uid)\
            .execute()
        return {"ok": True}
    except Exception as e:
        logger.error("screener preset delete error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete preset")


# ── Plans ────────────────────────────────────────────────────────────────────

@app.get("/api/financials/{ticker}")
def get_financials(ticker: str, authorization: str = Header(default=None)):
    verify_token(authorization)
    clean = ticker.upper().strip()
    if not re.match(r'^[A-Z0-9.\-]{1,10}$', clean):
        raise HTTPException(status_code=400, detail="Invalid ticker")
    try:
        data = get_financial_history(clean)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("financials fetch error for %s: %s", clean, e)
        raise HTTPException(status_code=500, detail="Failed to fetch financial data")
    return {"ticker": clean, **data}


@app.get("/api/plans/tickers")
def plans_tickers(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]
    db = get_firestore()
    if db is None:
        return {"tickers": []}
    doc = db.collection("user_plans").document(uid).get()
    if not doc.exists:
        return {"tickers": []}
    plans = doc.to_dict().get("plans", [])
    return {"tickers": list(dict.fromkeys(p["ticker"] for p in plans))}


@app.get("/api/plans")
def plans_list(authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]
    db = get_firestore()
    if db is None:
        return {"plans": []}
    doc = db.collection("user_plans").document(uid).get()
    if not doc.exists:
        return {"plans": []}
    raw_plans = doc.to_dict().get("plans", [])
    result = []
    for p in raw_plans:
        scenarios = p.get("scenarios", {})
        implied = {}
        upside = {}
        current = p.get("current_price")
        for s in ("bear", "base", "bull"):
            sc = scenarios.get(s, {})
            eps_list = sc.get("cells", {}).get("diluted_eps", [])
            pe_by_year = sc.get("pe_by_year")
            pe = (pe_by_year[-1] if pe_by_year else None) or sc.get("pe_multiple") or 0
            if eps_list and len(eps_list) >= 5 and pe:
                ip = round(eps_list[4] * pe, 2) if eps_list[4] is not None else None
                implied[s] = ip
                upside[s] = round((ip - current) / current, 4) if (ip is not None and current) else None
        result.append({
            "id":            p["id"],
            "name":          p["name"],
            "ticker":        p["ticker"],
            "current_price": current,
            "updated_at":    p.get("updated_at"),
            "implied":       implied,
            "upside":        upside,
        })
    return {"plans": result}


@app.get("/api/plans/{plan_id}")
def plan_get(plan_id: str, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]
    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    doc = db.collection("user_plans").document(uid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="No plans found")
    plans = doc.to_dict().get("plans", [])
    for p in plans:
        if p.get("id") == plan_id:
            return p
    raise HTTPException(status_code=404, detail="Plan not found")


@app.post("/api/plans")
def plan_save(payload: PlanSaveRequest, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]
    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")

    now = datetime.now(timezone.utc).isoformat()
    doc_ref = db.collection("user_plans").document(uid)
    doc = doc_ref.get()
    plans = doc.to_dict().get("plans", []) if doc.exists else []

    plan_dict = payload.model_dump()
    plan_dict["updated_at"] = now

    if not payload.id:
        plan_dict["id"] = str(_uuid.uuid4())
        plan_dict["created_at"] = now
        plans.append(plan_dict)
    else:
        idx = next((i for i, p in enumerate(plans) if p.get("id") == payload.id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Plan not found")
        plan_dict["created_at"] = plans[idx].get("created_at", now)
        plans[idx] = plan_dict

    doc_ref.set({"plans": plans}, merge=True)
    return plan_dict


@app.delete("/api/plans/{plan_id}")
def plan_delete(plan_id: str, authorization: str = Header(default=None)):
    user = verify_token(authorization)
    uid = user["uid"]
    db = get_firestore()
    if db is None:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    doc_ref = db.collection("user_plans").document(uid)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Plan not found")
    plans = [p for p in doc.to_dict().get("plans", []) if p.get("id") != plan_id]
    doc_ref.set({"plans": plans}, merge=True)
    return {"ok": True}
