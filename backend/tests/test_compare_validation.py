"""
Tests for backend/services/validation.py

Covers spread_validity_error: detects degenerate leg combinations that would produce
wrong net cost / max profit in the compare endpoint.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.validation import spread_validity_error


def _leg(option_type, side, strike, ask=5.0, bid=4.0):
    return {"option_type": option_type, "side": side, "strike": strike, "ask": ask, "bid": bid}


class TestSpreadValidityError:
    def test_valid_bull_call_spread(self):
        """Buy call $300, sell call $400 — different strikes, both priceable."""
        legs = [_leg("call", "buy", 300.0), _leg("call", "sell", 400.0)]
        assert spread_validity_error(legs) is None

    def test_same_strike_call_spread_is_degenerate(self):
        """Both legs resolve to $150 (highest available) — degenerate, should error."""
        legs = [_leg("call", "buy", 150.0), _leg("call", "sell", 150.0)]
        assert spread_validity_error(legs) is not None

    def test_same_strike_put_spread_is_degenerate(self):
        """Buy put and sell put at same strike — degenerate."""
        legs = [_leg("put", "buy", 100.0), _leg("put", "sell", 100.0)]
        assert spread_validity_error(legs) is not None

    def test_sell_leg_zero_bid_is_valid(self):
        """Sell leg with bid=0: we receive nothing, but spread is not degenerate."""
        legs = [_leg("call", "buy", 300.0, ask=3.0), _leg("call", "sell", 400.0, bid=0.0)]
        assert spread_validity_error(legs) is None

    def test_straddle_same_strike_is_valid(self):
        """Buy call + buy put at same strike — straddle, no sell legs, valid."""
        legs = [_leg("call", "buy", 200.0), _leg("put", "buy", 200.0)]
        assert spread_validity_error(legs) is None

    def test_iron_condor_valid(self):
        """Full iron condor with distinct strikes — valid."""
        legs = [
            _leg("put",  "buy",  180.0),
            _leg("put",  "sell", 190.0),
            _leg("call", "sell", 210.0),
            _leg("call", "buy",  220.0),
        ]
        assert spread_validity_error(legs) is None

    def test_iron_condor_call_legs_same_strike_is_degenerate(self):
        """Iron condor where buy call and sell call both hit $220 — degenerate."""
        legs = [
            _leg("put",  "buy",  180.0),
            _leg("put",  "sell", 190.0),
            _leg("call", "sell", 220.0),
            _leg("call", "buy",  220.0),
        ]
        assert spread_validity_error(legs) is not None

    def test_single_long_call_valid(self):
        """Single buy call — no sell side, not a degenerate spread."""
        legs = [_leg("call", "buy", 200.0, ask=10.0)]
        assert spread_validity_error(legs) is None

    def test_error_message_is_string(self):
        """Error result is a non-empty string, not just a truthy value."""
        legs = [_leg("call", "buy", 150.0), _leg("call", "sell", 150.0)]
        err = spread_validity_error(legs)
        assert isinstance(err, str) and len(err) > 0
