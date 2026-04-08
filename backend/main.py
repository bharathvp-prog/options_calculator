import os
import time
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

load_dotenv()

from logging_config import setup_logging
setup_logging()
import logging
logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK
_firebase_cert = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase_config.json")
if os.path.exists(_firebase_cert):
    cred = credentials.Certificate(_firebase_cert)
    firebase_admin.initialize_app(cred)
else:
    logger.warning(
        "Firebase service account not found at '%s'. "
        "Auth is disabled — all requests will be accepted. "
        "Set FIREBASE_SERVICE_ACCOUNT_PATH or place firebase_config.json in backend/.",
        _firebase_cert,
    )

app = FastAPI(title="Options Calculator API")

@app.on_event("startup")
async def startup_event():
    # Load tickers in a background thread so startup isn't blocked
    import threading
    threading.Thread(target=load_tickers, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
