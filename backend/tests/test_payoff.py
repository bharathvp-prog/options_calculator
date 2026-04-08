"""
Tests for payoff calculation logic (services/payoff.py).
Each strategy is tested with exact analytical values so regressions are caught immediately.

Strategies covered:
  - Bull Call Spread
  - Bear Put Spread
  - Long Call
  - Long Put
  - Long Straddle
  - Long Strangle
  - Iron Condor
  - Ratio spread (qty > 1)
  - Credit spread (net_cost_dollars < 0)
"""

import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.payoff import OptionLeg, compute_pnl_at, compute_payoff_table


# ── Helpers ──────────────────────────────────────────────────────────────────

def approx(val, tolerance=0.01):
    """Return a range check for floating-point comparisons."""
    return pytest.approx(val, abs=tolerance)


# ── Bull Call Spread ─────────────────────────────────────────────────────────
#
# Setup: Buy $300 call, Sell $400 call
# Net debit: $7.00 ask - $2.00 bid = $5.00 → net_cost_dollars = $500
#
# Key values at expiry:
#   stock < $300  → max loss = -$500
#   stock = $305  → breakeven  ($300+$5 net debit)
#   $300 < stock < $400 → profit = (stock - 300)*100 - 500
#   stock >= $400 → max profit = (400-300)*100 - 500 = $9,500

class TestBullCallSpread:
    LEGS = [
        OptionLeg(option_type="call", side="buy",  strike=300.0),
        OptionLeg(option_type="call", side="sell", strike=400.0),
    ]
    NET_COST = 500.0  # $5 net debit × 100

    def test_max_loss_below_lower_strike(self):
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-500.0)
        assert compute_pnl_at(self.LEGS, 299.0, self.NET_COST) == approx(-500.0)

    def test_at_lower_strike(self):
        assert compute_pnl_at(self.LEGS, 300.0, self.NET_COST) == approx(-500.0)

    def test_breakeven(self):
        # Breakeven = lower_strike + net_debit = 300 + 5 = $305
        assert compute_pnl_at(self.LEGS, 305.0, self.NET_COST) == approx(0.0)

    def test_profit_in_range(self):
        assert compute_pnl_at(self.LEGS, 350.0, self.NET_COST) == approx(4500.0)

    def test_at_upper_strike(self):
        # At $400: buy intrinsic = $10,000, sell intrinsic = $0 → net = $9,500
        assert compute_pnl_at(self.LEGS, 400.0, self.NET_COST) == approx(9500.0)

    def test_max_profit_above_upper_strike(self):
        # Capped at $9,500 regardless of how high the stock goes
        assert compute_pnl_at(self.LEGS, 500.0, self.NET_COST) == approx(9500.0)
        assert compute_pnl_at(self.LEGS, 1000.0, self.NET_COST) == approx(9500.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_profit"] == approx(9500.0)
        assert result["max_loss"] == approx(-500.0)
        assert len(result["breakevens"]) == 1
        assert result["breakevens"][0] == approx(305.0, tolerance=1.0)
        assert result["max_roi"] == approx(1900.0, tolerance=5.0)  # 9500/500 × 100


# ── Bear Put Spread ──────────────────────────────────────────────────────────
#
# Setup: Buy $150 put, Sell $100 put
# Net cost: $3.00 → net_cost_dollars = $300
#
# Key values at expiry:
#   stock >= $150 → max loss = -$300
#   stock = $147  → breakeven  ($150 - $3)
#   $100 < stock < $150 → profit = (150 - stock)*100 - 300
#   stock <= $100 → max profit = (150-100)*100 - 300 = $4,700

class TestBearPutSpread:
    LEGS = [
        OptionLeg(option_type="put", side="buy",  strike=150.0),
        OptionLeg(option_type="put", side="sell", strike=100.0),
    ]
    NET_COST = 300.0  # $3 net debit × 100

    def test_max_loss_above_higher_strike(self):
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-300.0)
        assert compute_pnl_at(self.LEGS, 151.0, self.NET_COST) == approx(-300.0)

    def test_at_higher_strike(self):
        assert compute_pnl_at(self.LEGS, 150.0, self.NET_COST) == approx(-300.0)

    def test_breakeven(self):
        # Breakeven = higher_strike - net_debit = 150 - 3 = $147
        assert compute_pnl_at(self.LEGS, 147.0, self.NET_COST) == approx(0.0)

    def test_profit_in_range(self):
        assert compute_pnl_at(self.LEGS, 125.0, self.NET_COST) == approx(2200.0)

    def test_at_lower_strike(self):
        # At $100: buy intrinsic = $5,000, sell intrinsic = $0 → net = $4,700
        assert compute_pnl_at(self.LEGS, 100.0, self.NET_COST) == approx(4700.0)

    def test_max_profit_below_lower_strike(self):
        assert compute_pnl_at(self.LEGS, 50.0, self.NET_COST) == approx(4700.0)
        assert compute_pnl_at(self.LEGS, 0.0,  self.NET_COST) == approx(4700.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_profit"] == approx(4700.0)
        assert result["max_loss"]   == approx(-300.0)
        assert len(result["breakevens"]) == 1
        assert result["breakevens"][0] == approx(147.0, tolerance=1.0)


# ── Long Call ────────────────────────────────────────────────────────────────
#
# Setup: Buy $200 call
# Net cost: $10.00 → net_cost_dollars = $1,000
#
# Key values:
#   stock <= $200 → max loss = -$1,000
#   stock = $210  → breakeven  ($200 + $10)
#   stock > $210  → unlimited upside

class TestLongCall:
    LEGS = [OptionLeg(option_type="call", side="buy", strike=200.0)]
    NET_COST = 1000.0

    def test_max_loss_below_strike(self):
        assert compute_pnl_at(self.LEGS, 100.0, self.NET_COST) == approx(-1000.0)
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-1000.0)

    def test_breakeven(self):
        assert compute_pnl_at(self.LEGS, 210.0, self.NET_COST) == approx(0.0)

    def test_profit_above_breakeven(self):
        assert compute_pnl_at(self.LEGS, 250.0, self.NET_COST) == approx(4000.0)
        assert compute_pnl_at(self.LEGS, 300.0, self.NET_COST) == approx(9000.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_loss"] == approx(-1000.0)
        assert len(result["breakevens"]) == 1
        assert result["breakevens"][0] == approx(210.0, tolerance=1.0)
        # No hard cap on profit — sampled max should be positive
        assert result["max_profit"] > 0


# ── Long Put ─────────────────────────────────────────────────────────────────
#
# Setup: Buy $150 put
# Net cost: $8.00 → net_cost_dollars = $800
#
# Key values:
#   stock >= $150 → max loss = -$800
#   stock = $142  → breakeven  ($150 - $8)
#   stock < $142  → profit grows as stock falls

class TestLongPut:
    LEGS = [OptionLeg(option_type="put", side="buy", strike=150.0)]
    NET_COST = 800.0

    def test_max_loss_above_strike(self):
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-800.0)
        assert compute_pnl_at(self.LEGS, 150.0, self.NET_COST) == approx(-800.0)

    def test_breakeven(self):
        assert compute_pnl_at(self.LEGS, 142.0, self.NET_COST) == approx(0.0)

    def test_profit_below_breakeven(self):
        assert compute_pnl_at(self.LEGS, 100.0, self.NET_COST) == approx(4200.0)
        assert compute_pnl_at(self.LEGS,  50.0, self.NET_COST) == approx(9200.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_loss"] == approx(-800.0)
        assert len(result["breakevens"]) == 1
        assert result["breakevens"][0] == approx(142.0, tolerance=1.0)
        assert result["max_profit"] > 0


# ── Long Straddle ────────────────────────────────────────────────────────────
#
# Setup: Buy $200 call + Buy $200 put (same strike)
# Net cost: $10 call + $10 put = $20 → net_cost_dollars = $2,000
#
# Key values:
#   stock = $200  → P&L = 0 + 0 - 2000 = -$2,000 (max loss = ATM)
#   stock = $180  → put intrinsic = $2,000 → P&L = $0 (lower breakeven)
#   stock = $220  → call intrinsic = $2,000 → P&L = $0 (upper breakeven)
#   stock = $150  → put intrinsic = $5,000 → P&L = $3,000
#   stock = $250  → call intrinsic = $5,000 → P&L = $3,000

class TestLongStraddle:
    LEGS = [
        OptionLeg(option_type="call", side="buy", strike=200.0),
        OptionLeg(option_type="put",  side="buy", strike=200.0),
    ]
    NET_COST = 2000.0

    def test_max_loss_at_strike(self):
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-2000.0)

    def test_lower_breakeven(self):
        # Lower breakeven = strike - net_debit_per_share = 200 - 20 = $180
        assert compute_pnl_at(self.LEGS, 180.0, self.NET_COST) == approx(0.0)

    def test_upper_breakeven(self):
        # Upper breakeven = strike + net_debit_per_share = 200 + 20 = $220
        assert compute_pnl_at(self.LEGS, 220.0, self.NET_COST) == approx(0.0)

    def test_profit_below_lower_breakeven(self):
        assert compute_pnl_at(self.LEGS, 150.0, self.NET_COST) == approx(3000.0)

    def test_profit_above_upper_breakeven(self):
        assert compute_pnl_at(self.LEGS, 250.0, self.NET_COST) == approx(3000.0)

    def test_symmetry(self):
        # P&L is symmetric around the strike
        pnl_down = compute_pnl_at(self.LEGS, 160.0, self.NET_COST)
        pnl_up   = compute_pnl_at(self.LEGS, 240.0, self.NET_COST)
        assert pnl_down == approx(pnl_up)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_loss"] == approx(-2000.0)
        assert len(result["breakevens"]) == 2
        be = sorted(result["breakevens"])
        assert be[0] == approx(180.0, tolerance=2.0)
        assert be[1] == approx(220.0, tolerance=2.0)


# ── Long Strangle ────────────────────────────────────────────────────────────
#
# Setup: Buy $250 call (OTM) + Buy $150 put (OTM)
# Net cost: $4 call + $4 put = $8 → net_cost_dollars = $800
#
# Key values:
#   $150 <= stock <= $250  → P&L = -$800 (both OTM)
#   stock = $142           → lower breakeven  ($150 - $8)
#   stock = $258           → upper breakeven  ($250 + $8)

class TestLongStrangle:
    LEGS = [
        OptionLeg(option_type="call", side="buy", strike=250.0),
        OptionLeg(option_type="put",  side="buy", strike=150.0),
    ]
    NET_COST = 800.0  # $4 each × 2 × 100

    def test_max_loss_between_strikes(self):
        assert compute_pnl_at(self.LEGS, 150.0, self.NET_COST) == approx(-800.0)
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-800.0)
        assert compute_pnl_at(self.LEGS, 250.0, self.NET_COST) == approx(-800.0)

    def test_lower_breakeven(self):
        # put breakeven = put_strike - net_debit_per_share = 150 - 8 = $142
        assert compute_pnl_at(self.LEGS, 142.0, self.NET_COST) == approx(0.0)

    def test_upper_breakeven(self):
        # call breakeven = call_strike + net_debit_per_share = 250 + 8 = $258
        assert compute_pnl_at(self.LEGS, 258.0, self.NET_COST) == approx(0.0)

    def test_profit_below_lower_breakeven(self):
        assert compute_pnl_at(self.LEGS, 100.0, self.NET_COST) == approx(4200.0)

    def test_profit_above_upper_breakeven(self):
        assert compute_pnl_at(self.LEGS, 300.0, self.NET_COST) == approx(4200.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_loss"] == approx(-800.0)
        assert len(result["breakevens"]) == 2
        be = sorted(result["breakevens"])
        assert be[0] == approx(142.0, tolerance=2.0)
        assert be[1] == approx(258.0, tolerance=2.0)


# ── Iron Condor ──────────────────────────────────────────────────────────────
#
# Setup: Buy $180 put, Sell $190 put, Sell $210 call, Buy $220 call
# Net cost: buy_wings_ask ($2 + $2) - sell_wings_bid ($4 + $4) = -$4 → net_cost_dollars = -$400 (credit)
#
# Key values:
#   $190 <= stock <= $210  → max profit = net_credit = +$400
#   stock = $186            → lower breakeven  ($190 - $4 credit)
#   stock = $214            → upper breakeven  ($210 + $4 credit)
#   stock <= $180 or >= $220 → max loss = -(wing_width × 100) + credit = -$600

class TestIronCondor:
    LEGS = [
        OptionLeg(option_type="put",  side="buy",  strike=180.0),
        OptionLeg(option_type="put",  side="sell", strike=190.0),
        OptionLeg(option_type="call", side="sell", strike=210.0),
        OptionLeg(option_type="call", side="buy",  strike=220.0),
    ]
    NET_COST = -400.0  # net credit of $4 × 100

    def test_max_profit_in_range(self):
        assert compute_pnl_at(self.LEGS, 190.0, self.NET_COST) == approx(400.0)
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(400.0)
        assert compute_pnl_at(self.LEGS, 210.0, self.NET_COST) == approx(400.0)

    def test_lower_breakeven(self):
        # sell_put_strike - net_credit_per_share = 190 - 4 = $186
        assert compute_pnl_at(self.LEGS, 186.0, self.NET_COST) == approx(0.0)

    def test_upper_breakeven(self):
        # sell_call_strike + net_credit_per_share = 210 + 4 = $214
        assert compute_pnl_at(self.LEGS, 214.0, self.NET_COST) == approx(0.0)

    def test_max_loss_below_put_wing(self):
        # max_loss = -(190-180)*100 + 400 = -$600
        assert compute_pnl_at(self.LEGS, 180.0, self.NET_COST) == approx(-600.0)
        assert compute_pnl_at(self.LEGS, 160.0, self.NET_COST) == approx(-600.0)

    def test_max_loss_above_call_wing(self):
        assert compute_pnl_at(self.LEGS, 220.0, self.NET_COST) == approx(-600.0)
        assert compute_pnl_at(self.LEGS, 240.0, self.NET_COST) == approx(-600.0)

    def test_partial_loss_put_side(self):
        # At $185: sell_put(190) intrinsic = 500, buy_put(180) = 0 → loss = 500 + credit 400 = -$100
        assert compute_pnl_at(self.LEGS, 185.0, self.NET_COST) == approx(-100.0)

    def test_partial_loss_call_side(self):
        # At $215: sell_call(210) intrinsic = 500, buy_call(220) = 0 → loss = 500 - credit = -$100
        assert compute_pnl_at(self.LEGS, 215.0, self.NET_COST) == approx(-100.0)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_profit"] == approx(400.0)
        assert result["max_loss"]   == approx(-600.0)
        # ROI uses abs(max_loss) as basis for credit spreads
        assert result["max_roi"] == approx(66.7, tolerance=2.0)  # 400/600 × 100
        assert len(result["breakevens"]) == 2
        be = sorted(result["breakevens"])
        assert be[0] == approx(186.0, tolerance=1.0)
        assert be[1] == approx(214.0, tolerance=1.0)


# ── Ratio Spread (qty > 1) ───────────────────────────────────────────────────
#
# Setup: Buy 2× $300 call, Sell 1× $400 call  (ratio back spread)
# Net cost: e.g. 2 × $7 ask - 1 × $2 bid = $12 → net_cost_dollars = $1,200
#
# At $450:
#   2× buy call(300): 2 × max(450-300,0) × 100 = $30,000
#   1× sell call(400): -max(450-400,0) × 100 = -$5,000
#   P&L = $25,000 - $1,200 = $23,800

class TestRatioSpread:
    LEGS = [
        OptionLeg(option_type="call", side="buy",  strike=300.0, qty=2),
        OptionLeg(option_type="call", side="sell", strike=400.0, qty=1),
    ]
    NET_COST = 1200.0  # (2 × $7 - 1 × $2) × 100

    def test_below_both_strikes(self):
        # Both OTM → lose full premium
        assert compute_pnl_at(self.LEGS, 200.0, self.NET_COST) == approx(-1200.0)

    def test_at_lower_strike(self):
        assert compute_pnl_at(self.LEGS, 300.0, self.NET_COST) == approx(-1200.0)

    def test_between_strikes(self):
        # At $350: buy intrinsic = 2 × 5000 = $10,000, sell = 0 → P&L = $8,800
        assert compute_pnl_at(self.LEGS, 350.0, self.NET_COST) == approx(8800.0)

    def test_at_upper_strike(self):
        # At $400: buy = 2 × 10,000 = $20,000, sell = 0 → P&L = $18,800
        assert compute_pnl_at(self.LEGS, 400.0, self.NET_COST) == approx(18800.0)

    def test_above_upper_strike_accelerates(self):
        # At $450: buy = 2 × 15,000 = $30,000, sell = $5,000 → P&L = $23,800
        assert compute_pnl_at(self.LEGS, 450.0, self.NET_COST) == approx(23800.0)
        # Ratio spread has net-long delta above upper strike, so profit keeps growing
        assert compute_pnl_at(self.LEGS, 500.0, self.NET_COST) > compute_pnl_at(self.LEGS, 450.0, self.NET_COST)

    def test_payoff_table_metrics(self):
        result = compute_payoff_table(self.LEGS, self.NET_COST)
        assert result["max_loss"] == approx(-1200.0)
        assert result["max_profit"] > 0


# ── Qty = 2 uniform (scaling) ────────────────────────────────────────────────
#
# Buying 2 contracts of a Long Call should exactly double the P&L vs qty=1.

class TestQtyScaling:
    def test_double_qty_doubles_pnl(self):
        legs_x1 = [OptionLeg(option_type="call", side="buy", strike=200.0, qty=1)]
        legs_x2 = [OptionLeg(option_type="call", side="buy", strike=200.0, qty=2)]
        net_cost_x1 = 1000.0
        net_cost_x2 = 2000.0

        for price in [150.0, 210.0, 250.0, 300.0]:
            pnl_x1 = compute_pnl_at(legs_x1, price, net_cost_x1)
            pnl_x2 = compute_pnl_at(legs_x2, price, net_cost_x2)
            assert pnl_x2 == approx(pnl_x1 * 2)


# ── compute_payoff_table — edge cases ────────────────────────────────────────

class TestPayoffTableEdgeCases:
    def test_custom_price_range(self):
        legs = [OptionLeg(option_type="call", side="buy", strike=200.0)]
        result = compute_payoff_table(legs, 1000.0, price_range=(100.0, 300.0))
        prices = list(result["payoff_at"].keys())
        assert min(prices) == approx(100.0)
        assert max(prices) == approx(300.0)

    def test_num_points_respected(self):
        legs = [OptionLeg(option_type="call", side="buy", strike=200.0)]
        result = compute_payoff_table(legs, 1000.0, num_points=11)
        assert len(result["payoff_at"]) == 11

    def test_zero_cost_strategy(self):
        # A zero-cost collar or synthetic — net_cost = 0
        legs = [
            OptionLeg(option_type="call", side="buy",  strike=200.0),
            OptionLeg(option_type="put",  side="sell", strike=200.0),
        ]
        pnl = compute_pnl_at(legs, 250.0, 0.0)
        # buy call(200) = $5,000, sell put(200) = 0 at $250, net = $5,000
        assert pnl == approx(5000.0)

    def test_all_legs_otm_returns_full_loss(self):
        # Bull call spread where stock never moves
        legs = [
            OptionLeg(option_type="call", side="buy",  strike=300.0),
            OptionLeg(option_type="call", side="sell", strike=400.0),
        ]
        assert compute_pnl_at(legs, 100.0, 500.0) == approx(-500.0)

    def test_empty_legs_uses_default_price_range(self):
        """compute_payoff_table with no legs falls back to the default (0, 200) range without error."""
        result = compute_payoff_table([], 0.0)
        prices = list(result["payoff_at"].keys())
        assert len(prices) > 0
        assert min(prices) == approx(0.0)
        assert max(prices) == approx(200.0)
        # No intrinsic on any leg → P&L is 0 everywhere
        assert result["max_profit"] == approx(0.0)
        assert result["max_loss"]   == approx(0.0)
        assert result["breakevens"] == []
        assert result["max_roi"] is None  # basis = 0, so ROI is undefined


# ── Mixed per-leg qty ────────────────────────────────────────────────────────
#
# Verify that each leg's qty multiplier applies independently, not uniformly.

class TestMixedQtyLegs:
    def test_different_qty_per_leg(self):
        """3× buy call(200), 1× sell call(300) — each qty applies to its own intrinsic."""
        # At $350:
        #   3× buy call(200): 3 × max(350-200, 0) × 100 = $45,000
        #   1× sell call(300): -1 × max(350-300, 0) × 100 = -$5,000
        #   P&L = 45,000 - 5,000 - 2,000 (net_cost) = $38,000
        legs = [
            OptionLeg(option_type="call", side="buy",  strike=200.0, qty=3),
            OptionLeg(option_type="call", side="sell", strike=300.0, qty=1),
        ]
        assert compute_pnl_at(legs, 350.0, 2000.0) == approx(38000.0)

    def test_mixed_qty_put_side(self):
        """1× buy put(150), 2× sell put(100) — net short put position at lower strikes."""
        # At $80:
        #   1× buy put(150): max(150-80, 0) × 100 = $7,000
        #   2× sell put(100): -2 × max(100-80, 0) × 100 = -$4,000
        #   P&L = 7,000 - 4,000 - 500 (net_cost) = $2,500
        legs = [
            OptionLeg(option_type="put", side="buy",  strike=150.0, qty=1),
            OptionLeg(option_type="put", side="sell", strike=100.0, qty=2),
        ]
        assert compute_pnl_at(legs, 80.0, 500.0) == approx(2500.0)
