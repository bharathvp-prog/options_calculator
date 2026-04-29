import math
from datetime import date
from typing import Any


def _safe_float(value: Any) -> float | None:
    try:
        result = float(value)
        return None if math.isnan(result) else result
    except Exception:
        return None


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def bs_price(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float | None:
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return None
    try:
        sqrt_T = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
        d2 = d1 - sigma * sqrt_T
        disc_K = K * math.exp(-r * T)
        if option_type == "call":
            return S * _normal_cdf(d1) - disc_K * _normal_cdf(d2)
        return disc_K * _normal_cdf(-d2) - S * _normal_cdf(-d1)
    except Exception:
        return None


def bs_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> dict:
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    try:
        sqrt_T = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
        d2 = d1 - sigma * sqrt_T
        nd1 = _normal_pdf(d1)
        if option_type == "call":
            delta = _normal_cdf(d1)
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) - r * K * math.exp(-r * T) * _normal_cdf(d2)) / 365
        else:
            delta = _normal_cdf(d1) - 1
            theta = (-(S * nd1 * sigma) / (2 * sqrt_T) + r * K * math.exp(-r * T) * _normal_cdf(-d2)) / 365
        gamma = nd1 / (S * sigma * sqrt_T)
        vega = S * nd1 * sqrt_T / 100
        return {
            "delta": round(delta, 4),
            "gamma": round(gamma, 4),
            "theta": round(theta, 4),
            "vega": round(vega, 4),
        }
    except Exception:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}


def years_to_expiry(expiry: str, today: date | None = None) -> float:
    today = today or date.today()
    try:
        exp_date = date.fromisoformat(expiry)
        return max((exp_date - today).days, 0) / 365.0
    except Exception:
        return 0.0


def _get_row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def _is_valid_iv(iv: float | None) -> bool:
    return iv is not None and 0.01 <= iv <= 5.0


def _price_bounds(S: float, K: float, T: float, r: float, option_type: str) -> tuple[float, float] | tuple[None, None]:
    if S <= 0 or K <= 0 or T < 0:
        return None, None
    disc_K = K * math.exp(-r * T)
    if option_type == "call":
        lower = max(0.0, S - disc_K)
        upper = S
    else:
        lower = max(0.0, disc_K - S)
        upper = disc_K
    return lower, upper


def _pick_price_sources(row: dict[str, Any], lower_bound: float, upper_bound: float) -> list[tuple[str, float]]:
    prices: list[tuple[str, float]] = []
    bid = _safe_float(_get_row_value(row, "bid"))
    ask = _safe_float(_get_row_value(row, "ask"))
    if bid is not None and ask is not None and bid > 0 and ask > 0 and ask >= bid:
        mid = (bid + ask) / 2.0
        if lower_bound - 0.01 <= mid <= upper_bound + 0.01:
            prices.append(("mid", mid))

    last = _safe_float(_get_row_value(row, "lastPrice", "last"))
    if last is not None and last > 0 and lower_bound - 0.01 <= last <= upper_bound + 0.5:
        prices.append(("last", last))
    return prices


def _iv_matches_price(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str,
    price: float,
) -> bool:
    theo = bs_price(S, K, T, r, sigma, option_type)
    if theo is None:
        return False
    tolerance = max(0.5, 0.5 * max(price, theo, 1.0))
    return abs(theo - price) <= tolerance


def _solve_implied_vol(
    target_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str,
) -> float | None:
    if target_price <= 0 or T <= 0 or S <= 0 or K <= 0:
        return None
    low = 1e-4
    high = 5.0
    low_price = bs_price(S, K, T, r, low, option_type)
    high_price = bs_price(S, K, T, r, high, option_type)
    if low_price is None or high_price is None:
        return None
    if target_price < low_price - 0.01 or target_price > high_price + 0.01:
        return None

    for _ in range(80):
        mid = (low + high) / 2.0
        mid_price = bs_price(S, K, T, r, mid, option_type)
        if mid_price is None:
            return None
        if abs(mid_price - target_price) < 1e-4:
            return mid
        if mid_price > target_price:
            high = mid
        else:
            low = mid
    return (low + high) / 2.0


def _resolve_iv_without_interpolation(
    current_price: float,
    strike: float,
    T: float,
    r: float,
    option_type: str,
    row: dict[str, Any],
) -> dict[str, Any]:
    raw_iv = _safe_float(_get_row_value(row, "impliedVolatility", "iv"))
    lower_bound, upper_bound = _price_bounds(current_price, strike, T, r, option_type)
    if lower_bound is None or upper_bound is None:
        return {"iv": raw_iv if _is_valid_iv(raw_iv) else None, "iv_source": "yahoo", "iv_raw": raw_iv, "price_source": None}

    prices = _pick_price_sources(row, lower_bound, upper_bound)

    if _is_valid_iv(raw_iv):
        if not prices:
            return {"iv": raw_iv, "iv_source": "yahoo", "iv_raw": raw_iv, "price_source": None}
        for price_source, price in prices:
            if _iv_matches_price(current_price, strike, T, r, raw_iv, option_type, price):
                return {"iv": raw_iv, "iv_source": "yahoo", "iv_raw": raw_iv, "price_source": price_source}

    for price_source, price in prices:
        solved = _solve_implied_vol(price, current_price, strike, T, r, option_type)
        if _is_valid_iv(solved):
            return {
                "iv": solved,
                "iv_source": f"implied_from_{price_source}",
                "iv_raw": raw_iv,
                "price_source": price_source,
            }

    return {"iv": None, "iv_source": None, "iv_raw": raw_iv, "price_source": None}


def _interpolate_neighbor_iv(
    current_price: float,
    strike: float,
    T: float,
    r: float,
    option_type: str,
    sibling_rows: list[dict[str, Any]],
) -> tuple[float | None, str | None]:
    candidates: list[tuple[float, float]] = []
    for sibling in sibling_rows:
        sibling_strike = _safe_float(_get_row_value(sibling, "strike"))
        if sibling_strike is None or sibling_strike == strike:
            continue
        resolved = _resolve_iv_without_interpolation(current_price, sibling_strike, T, r, option_type, sibling)
        sibling_iv = resolved.get("iv")
        if _is_valid_iv(sibling_iv):
            candidates.append((sibling_strike, sibling_iv))

    if not candidates:
        return None, None

    candidates.sort(key=lambda item: item[0])
    lower = next((item for item in reversed(candidates) if item[0] < strike), None)
    upper = next((item for item in candidates if item[0] > strike), None)

    if lower and upper and upper[0] != lower[0]:
        weight = (strike - lower[0]) / (upper[0] - lower[0])
        return lower[1] + weight * (upper[1] - lower[1]), "interpolated"

    nearest = lower or upper or min(candidates, key=lambda item: abs(item[0] - strike))
    return nearest[1], "nearest_strike"


def compute_option_metrics(
    current_price: float | None,
    strike: float | None,
    T: float,
    r: float,
    option_type: str,
    row: dict[str, Any],
    sibling_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result = {
        "iv": None,
        "iv_raw": _safe_float(_get_row_value(row, "impliedVolatility", "iv")),
        "iv_source": None,
        "price_source": None,
        "delta_status": "missing_inputs",
        "delta": None,
        "gamma": None,
        "theta": None,
        "vega": None,
    }

    if current_price is None or strike is None or current_price <= 0 or strike <= 0 or T <= 0:
        return result

    resolved = _resolve_iv_without_interpolation(current_price, strike, T, r, option_type, row)
    sigma = resolved.get("iv")
    iv_source = resolved.get("iv_source")

    if sigma is None and sibling_rows:
        sigma, iv_source = _interpolate_neighbor_iv(current_price, strike, T, r, option_type, sibling_rows)
        resolved["price_source"] = None

    result["iv"] = round(sigma, 6) if sigma is not None else None
    result["iv_source"] = iv_source
    result["price_source"] = resolved.get("price_source")

    if sigma is None:
        result["delta_status"] = "missing_iv"
        return result

    greeks = bs_greeks(current_price, strike, T, r, sigma, option_type)
    result.update(greeks)
    result["delta_status"] = "ok" if iv_source == "yahoo" else "fallback"
    return result
