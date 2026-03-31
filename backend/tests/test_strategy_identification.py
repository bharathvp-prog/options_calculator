"""
Tests for the rule-based strategy identification parser.
Covers: ticker extraction, price extraction, date extraction,
sentiment detection, and full strategy identification for all 6 strategy types.
"""

import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.strategy import (
    extract_ticker,
    extract_prices,
    extract_date,
    detect_sentiment,
    identify_strategy,
)


# ── Ticker extraction ────────────────────────────────────────────────────────

class TestExtractTicker:
    def test_uppercase_ticker_in_sentence(self):
        assert extract_ticker("I think AMD will grow to 300") == "AMD"

    def test_dollar_prefix_ticker(self):
        assert extract_ticker("$AAPL will rise by June 2026") == "AAPL"

    def test_multi_word_sentence(self):
        assert extract_ticker("I'm confident NVDA will rally hard") == "NVDA"

    def test_ticker_after_on(self):
        assert extract_ticker("I am bearish on tsla by end of 2026") == "TSLA"

    def test_ticker_after_for(self):
        assert extract_ticker("I want to trade for MSFT by Q1 2026") == "MSFT"

    def test_skips_common_words(self):
        # "I" and "A" should be skipped
        assert extract_ticker("I am bullish AMD will reach 200 by 2026") == "AMD"

    def test_five_letter_ticker(self):
        assert extract_ticker("GOOGL will stay flat around 150 in 2026") == "GOOGL"

    def test_no_ticker_returns_none(self):
        assert extract_ticker("the stock will go up by june 2026") is None


# ── Price extraction ─────────────────────────────────────────────────────────

class TestExtractPrices:
    def test_bare_numbers(self):
        result = extract_prices("AMD will grow to 300 but no more than 400 by June 2028")
        assert result == [300.0, 400.0]

    def test_dollar_prefixed(self):
        result = extract_prices("AAPL will rise to $220 by $250 by mid 2026")
        assert result == [220.0, 250.0]

    def test_skips_years(self):
        result = extract_prices("NVDA will hit 800 by 2026")
        assert result == [800.0]
        assert 2026.0 not in result

    def test_single_price(self):
        assert extract_prices("TSLA will crash to 100 by end of 2025") == [100.0]

    def test_no_prices(self):
        assert extract_prices("AMD will make a big move by June 2026") == []

    def test_decimal_price(self):
        result = extract_prices("AAPL at $182.50 heading to $220.00 by 2026")
        assert 182.5 in result
        assert 220.0 in result

    def test_dollar_prefix_takes_priority(self):
        # When $-prefixed prices exist, bare numbers are ignored
        result = extract_prices("$300 target with max gain at $400 by 2026")
        assert result == [300.0, 400.0]


# ── Date extraction ──────────────────────────────────────────────────────────

class TestExtractDate:
    def test_month_and_year(self):
        assert extract_date("by June 2028") == "2028-06-30"

    def test_january(self):
        assert extract_date("by January 2026") == "2026-01-31"

    def test_abbreviated_month(self):
        assert extract_date("by Dec 2025") == "2025-12-31"

    def test_just_year(self):
        assert extract_date("in 2026") == "2026-12-31"

    def test_end_of_year(self):
        assert extract_date("by end of 2025") == "2025-12-31"

    def test_through_month_year(self):
        assert extract_date("through March 2026") == "2026-03-31"

    def test_no_date_returns_none(self):
        assert extract_date("AMD will grow to 300") is None

    def test_february_leap_year(self):
        assert extract_date("by February 2028") == "2028-02-29"

    def test_february_non_leap_year(self):
        assert extract_date("by February 2027") == "2027-02-28"


# ── Sentiment detection ──────────────────────────────────────────────────────

class TestDetectSentiment:
    def test_bullish_grow(self):
        assert detect_sentiment("AMD will grow to 300 by 2026") == "bullish"

    def test_bullish_rise(self):
        assert detect_sentiment("I think AAPL will rise significantly") == "bullish"

    def test_bullish_confident(self):
        assert detect_sentiment("I am confident NVDA will climb to 500") == "bullish"

    def test_bearish_crash(self):
        assert detect_sentiment("TSLA will crash below 100") == "bearish"

    def test_bearish_fall(self):
        assert detect_sentiment("I think AAPL will fall to 150") == "bearish"

    def test_bearish_drop(self):
        assert detect_sentiment("NVDA will drop to 400 by year end") == "bearish"

    def test_volatile_big_move(self):
        assert detect_sentiment("TSLA will make a big move after earnings") == "volatile"

    def test_volatile_earnings(self):
        assert detect_sentiment("AMD earnings announcement could swing it hard") == "volatile"

    def test_neutral_flat(self):
        assert detect_sentiment("AAPL will stay flat around 220") == "neutral"

    def test_neutral_stable(self):
        assert detect_sentiment("MSFT will remain stable sideways in 2026") == "neutral"


# ── Full strategy identification ─────────────────────────────────────────────

class TestIdentifyStrategy:
    # ── Bull Call Spread ──────────────────────────────────────────────────────

    def test_bull_call_spread_two_prices(self):
        result = identify_strategy("I'm confident AMD will grow to 300 but no more than 400 by June 2028")
        assert result["strategy_name"] == "Bull Call Spread"
        assert result["ticker"] == "AMD"
        assert result["same_expiry"] is True
        assert len(result["legs"]) == 2
        buy_leg = next(l for l in result["legs"] if l["side"] == "buy")
        sell_leg = next(l for l in result["legs"] if l["side"] == "sell")
        assert buy_leg["option_type"] == "call"
        assert sell_leg["option_type"] == "call"
        assert buy_leg["strike_hint"] == 300.0
        assert sell_leg["strike_hint"] == 400.0
        assert result["legs"][0]["expiry_to"] == "2028-06-30"

    def test_bull_call_spread_capped_single_price(self):
        result = identify_strategy("AAPL will rise to 200 with limited upside by March 2026")
        assert result["strategy_name"] == "Bull Call Spread"
        assert result["ticker"] == "AAPL"
        buy_leg = next(l for l in result["legs"] if l["side"] == "buy")
        assert buy_leg["strike_hint"] == 200.0

    def test_bull_call_spread_dollar_prices(self):
        result = identify_strategy("I expect NVDA to rally from $800 up to $1000 by December 2025")
        assert result["strategy_name"] == "Bull Call Spread"
        assert result["ticker"] == "NVDA"

    # ── Long Call ─────────────────────────────────────────────────────────────

    def test_long_call_single_price_no_cap(self):
        result = identify_strategy("AMD will grow to 300 by June 2026")
        assert result["strategy_name"] == "Long Call"
        assert result["ticker"] == "AMD"
        assert result["same_expiry"] is False
        assert len(result["legs"]) == 1
        assert result["legs"][0]["side"] == "buy"
        assert result["legs"][0]["option_type"] == "call"
        assert result["legs"][0]["strike_hint"] == 300.0

    def test_long_call_no_price(self):
        result = identify_strategy("I am bullish on MSFT by end of 2026")
        assert result["strategy_name"] == "Long Call"
        assert result["ticker"] == "MSFT"
        assert result["legs"][0]["strike_hint"] is None

    # ── Bear Put Spread ───────────────────────────────────────────────────────

    def test_bear_put_spread_two_prices(self):
        result = identify_strategy("TSLA will crash from 200 down to 100 by end of 2025")
        assert result["strategy_name"] == "Bear Put Spread"
        assert result["ticker"] == "TSLA"
        assert result["same_expiry"] is True
        assert len(result["legs"]) == 2
        buy_leg = next(l for l in result["legs"] if l["side"] == "buy")
        sell_leg = next(l for l in result["legs"] if l["side"] == "sell")
        assert buy_leg["option_type"] == "put"
        assert sell_leg["option_type"] == "put"
        # Buy the higher-strike put, sell the lower-strike put
        assert buy_leg["strike_hint"] > sell_leg["strike_hint"]

    # ── Long Put ──────────────────────────────────────────────────────────────

    def test_long_put_single_price(self):
        result = identify_strategy("NVDA will crash below 80 by end of 2025")
        assert result["strategy_name"] == "Long Put"
        assert result["ticker"] == "NVDA"
        assert result["same_expiry"] is False
        assert len(result["legs"]) == 1
        assert result["legs"][0]["side"] == "buy"
        assert result["legs"][0]["option_type"] == "put"
        assert result["legs"][0]["strike_hint"] == 80.0

    def test_long_put_no_price(self):
        result = identify_strategy("I am bearish on AAPL by June 2026")
        assert result["strategy_name"] == "Long Put"
        assert result["legs"][0]["strike_hint"] is None

    # ── Long Straddle ─────────────────────────────────────────────────────────

    def test_long_straddle_no_price(self):
        result = identify_strategy("TSLA will make a big move after earnings in January 2026")
        assert result["strategy_name"] == "Long Straddle"
        assert result["ticker"] == "TSLA"
        assert result["same_expiry"] is True
        assert len(result["legs"]) == 2
        types = {l["option_type"] for l in result["legs"]}
        assert types == {"call", "put"}
        sides = {l["side"] for l in result["legs"]}
        assert sides == {"buy"}

    def test_long_straddle_earnings(self):
        result = identify_strategy("AMD earnings catalyst could swing the stock either way by February 2026")
        assert result["strategy_name"] == "Long Straddle"
        assert result["ticker"] == "AMD"

    # ── Long Strangle ─────────────────────────────────────────────────────────

    def test_long_strangle_two_prices(self):
        result = identify_strategy("TSLA will swing big — either to 300 or down to 150 after earnings in March 2026")
        assert result["strategy_name"] == "Long Strangle"
        assert result["ticker"] == "TSLA"
        assert result["same_expiry"] is True
        assert len(result["legs"]) == 2
        types = {l["option_type"] for l in result["legs"]}
        assert types == {"call", "put"}
        # Call strike should be the higher price, put strike the lower
        call_leg = next(l for l in result["legs"] if l["option_type"] == "call")
        put_leg = next(l for l in result["legs"] if l["option_type"] == "put")
        assert call_leg["strike_hint"] == 300.0
        assert put_leg["strike_hint"] == 150.0

    # ── Iron Condor ───────────────────────────────────────────────────────────

    def test_iron_condor_two_prices(self):
        result = identify_strategy("AAPL will stay flat between 200 and 240 through March 2026")
        assert result["strategy_name"] == "Iron Condor"
        assert result["ticker"] == "AAPL"
        assert result["same_expiry"] is True
        assert len(result["legs"]) == 4
        sides = [l["side"] for l in result["legs"]]
        assert sides.count("buy") == 2
        assert sides.count("sell") == 2

    def test_iron_condor_single_price(self):
        result = identify_strategy("MSFT will stay flat around 400 by December 2025")
        assert result["strategy_name"] == "Iron Condor"
        assert result["ticker"] == "MSFT"
        assert len(result["legs"]) == 4

    def test_iron_condor_sideways(self):
        result = identify_strategy("AAPL will remain stable sideways around 220 through March 2026")
        assert result["strategy_name"] == "Iron Condor"

    # ── Error cases ───────────────────────────────────────────────────────────

    def test_error_no_ticker(self):
        result = identify_strategy("the stock will go up to 300 by June 2026")
        assert "error" in result

    def test_error_no_date(self):
        result = identify_strategy("AMD will grow to 300")
        assert "error" in result

    def test_error_empty_string(self):
        result = identify_strategy("")
        assert "error" in result

    # ── Expiry dates ──────────────────────────────────────────────────────────

    def test_expiry_from_is_today_format(self):
        from datetime import datetime
        result = identify_strategy("AMD will grow to 300 by June 2028")
        today = datetime.today().strftime("%Y-%m-%d")
        assert result["legs"][0]["expiry_from"] == today

    def test_expiry_to_is_parsed_date(self):
        result = identify_strategy("AMD will grow to 300 by June 2028")
        assert result["legs"][0]["expiry_to"] == "2028-06-30"
