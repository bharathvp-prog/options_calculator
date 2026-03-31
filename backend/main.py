import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from services.options import get_expiry_dates, get_option_chain, find_cheapest

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


# ── Routes ──────────────────────────────────────────────────────────────────

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
