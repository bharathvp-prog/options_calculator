"""
Pure payoff calculation functions — no yfinance or FastAPI dependencies.
Used by the /api/strategy/compare endpoint and the test suite.
"""

from dataclasses import dataclass


@dataclass
class OptionLeg:
    option_type: str   # "call" or "put"
    side: str          # "buy" or "sell"
    strike: float
    qty: int = 1


def compute_pnl_at(legs: list[OptionLeg], stock_price: float, net_cost_dollars: float) -> float:
    """
    Compute P&L (in dollars) at expiry for a given stock price.

    Args:
        legs: list of OptionLeg with actual strike prices
        stock_price: underlying price at expiry
        net_cost_dollars: total cost paid per contract unit (positive = debit, negative = credit)

    Returns:
        P&L in dollars. Positive = profit.
    """
    pnl = 0.0
    for leg in legs:
        k, q = leg.strike, leg.qty
        if leg.option_type == "call":
            intrinsic = max(stock_price - k, 0) * q * 100
        else:
            intrinsic = max(k - stock_price, 0) * q * 100
        pnl += intrinsic if leg.side == "buy" else -intrinsic
    pnl -= net_cost_dollars
    return round(pnl, 2)


def compute_payoff_table(
    legs: list[OptionLeg],
    net_cost_dollars: float,
    price_range: tuple[float, float] | None = None,
    num_points: int = 21,
) -> dict:
    """
    Compute full P&L table and summary metrics for a multi-leg strategy.

    Args:
        legs: list of OptionLeg with actual strikes
        net_cost_dollars: total cost paid (positive = debit, negative = credit)
        price_range: (min_price, max_price) to sample; auto-calculated from strikes if None
        num_points: number of stock price sample points

    Returns:
        {
            payoff_at: {price: pnl},
            max_profit: float,
            max_loss: float,
            max_roi: float | None,
            breakevens: list[float],
        }
    """
    if price_range is None:
        strikes = [l.strike for l in legs]
        if strikes:
            s_min = min(strikes) * 0.5
            s_max = max(strikes) * 1.5
        else:
            s_min, s_max = 0.0, 200.0
    else:
        s_min, s_max = price_range

    evenly_spaced = [round(s_min + i * (s_max - s_min) / (num_points - 1), 4) for i in range(num_points)]
    # Always include the actual strikes so P&L kinks are sampled accurately
    all_strikes = [l.strike for l in legs]
    all_prices = sorted(set(evenly_spaced + all_strikes))
    prices = [p for p in all_prices if s_min <= p <= s_max]
    payoff_at = {p: compute_pnl_at(legs, p, net_cost_dollars) for p in prices}

    pnl_values = list(payoff_at.values())
    max_profit = max(pnl_values)
    max_loss = min(pnl_values)

    basis = net_cost_dollars if net_cost_dollars > 0 else abs(max_loss)
    max_roi = round(max_profit / basis * 100, 1) if basis else None

    # Approximate breakevens by linear interpolation between adjacent sample points
    breakevens = []
    items = sorted(payoff_at.items())
    for i in range(len(items) - 1):
        p1, v1 = items[i]
        p2, v2 = items[i + 1]
        if (v1 < 0 <= v2) or (v2 < 0 <= v1):
            if v2 != v1:
                be = p1 + (p2 - p1) * (-v1) / (v2 - v1)
                breakevens.append(round(be, 4))

    return {
        "payoff_at": payoff_at,
        "max_profit": round(max_profit, 2),
        "max_loss": round(max_loss, 2),
        "max_roi": max_roi,
        "breakevens": breakevens,
    }
