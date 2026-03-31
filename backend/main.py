import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import yfinance as yf
from datetime import date
from services.options import get_expiry_dates, get_option_chain, find_cheapest, pick_horizon_expiries, get_options_for_expiry
from services.tickers import load_tickers, search_tickers
from services.strategy import identify_strategy
from services.payoff import OptionLeg, compute_payoff_table

load_dotenv()

# Initialize Firebase Admin SDK
_firebase_cert = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase_config.json")
if os.path.exists(_firebase_cert):
    cred = credentials.Certificate(_firebase_cert)
    firebase_admin.initialize_app(cred)
else:
    print(
        f"WARNING: Firebase service account not found at '{_firebase_cert}'. "
        "Auth will be disabled — all requests will be accepted. "
        "Set FIREBASE_SERVICE_ACCOUNT_PATH or place firebase_config.json in backend/."
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


def verify_token(authorization: str = Header(default=None)) -> dict:
    if not firebase_admin._apps:
        # Firebase not configured — dev mode, skip auth
        return {"uid": "dev", "email": "dev@local"}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return firebase_auth.verify_id_token(token)
    except Exception:
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
        print(f"Could not fetch current price for {result.get('ticker')}: {e}")
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

                df["strike_diff"] = (df["strike"] - target_strike).abs()
                best_row = df.loc[df["strike_diff"].idxmin()].to_dict()

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
                print(f"Error fetching leg for {payload.ticker} {expiry}: {e}")
                cheapest = None

            if cheapest is None:
                valid = False
                break

            leg_results.append({**cheapest, "side": leg.side, "qty": leg.qty})
            price = cheapest["ask"] if leg.side == "buy" else cheapest["bid"]
            total_cost += price * leg.qty if leg.side == "buy" else -price * leg.qty

        if not valid:
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
        raise HTTPException(status_code=404, detail="No options found for any time horizon")

    valid_cpd = [r for r in results if r.get("cost_per_day") and r["cost_per_day"] > 0]
    best_expiry = min(valid_cpd, key=lambda r: r["cost_per_day"])["expiry"] if valid_cpd else None
    for r in results:
        r["best_value"] = (r["expiry"] == best_expiry)

    return {"ticker": payload.ticker.upper(), "horizons": results}


@app.get("/api/tickers/search")
def ticker_search(q: str = Query(default="", min_length=0)):
    return {"results": search_tickers(q, limit=10)}


@app.get("/api/options/expiries")
def get_expiries(ticker: str = Query(..., description="Stock ticker symbol")):
    try:
        clean_ticker = ticker.upper().split(":")[0].strip()
        expiries = get_expiry_dates(clean_ticker)
        return {"ticker": clean_ticker, "expiries": expiries}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/search")
def search_cheapest(payload: SearchRequest, authorization: str = Header(default=None)):
    verify_token(authorization)

    import traceback

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
        except Exception as e:
            print(f"Error fetching leg {i} ({leg.ticker}): {e}")
            traceback.print_exc()
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
        except Exception as e:
            print(f"Error finding cheapest for leg {i} ({leg.ticker}): {e}")
            traceback.print_exc()

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
