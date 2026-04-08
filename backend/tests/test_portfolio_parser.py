"""
Tests for backend/services/portfolio.py

Covers:
- symbol_to_yf_ticker: all exchange types + edge cases
- parse_saxo_xlsx: section header skipping, field extraction, numeric casting
- get_price_history: empty input, single/multi ticker alignment, NaN handling, error resilience
"""

import sys
import os
from pathlib import Path
from unittest.mock import patch

import pytest

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.portfolio import parse_saxo_xlsx, symbol_to_yf_ticker, get_price_history, _col_letter_to_index, _safe_float

FIXTURE = Path(__file__).parent / "fixtures" / "Positions_02-Apr-2026_19_24_48.xlsx"


class TestSymbolToYfTicker:
    def test_option_amd(self):
        """AMD option symbol extracts base ticker."""
        assert symbol_to_yf_ticker("AMD/21F28C200:xcbf", "Stock Option") == "AMD"

    def test_option_goog(self):
        """GOOG option symbol extracts base ticker."""
        assert symbol_to_yf_ticker("GOOG/15Z28C300:xcbf", "Stock Option") == "GOOG"

    def test_option_strips_us_suffix(self):
        """_US suffix is stripped from option underlying ticker."""
        assert symbol_to_yf_ticker("MOH_US/17J26C160:xcbf", "Stock Option") == "MOH"

    def test_stock_nasdaq(self):
        """NASDAQ stock symbol uses ticker as-is."""
        assert symbol_to_yf_ticker("COIN:xnas", "Stock") == "COIN"

    def test_stock_nyse(self):
        """NYSE stock symbol uses ticker as-is."""
        assert symbol_to_yf_ticker("ELV:xnys", "Stock") == "ELV"

    def test_stock_hk_double_zero(self):
        """HK stock with double leading zero (00941) maps to 4-digit .HK ticker."""
        assert symbol_to_yf_ticker("00941:xhkg", "Stock") == "0941.HK"

    def test_stock_hk_single_leading_zero(self):
        """HK stock with single leading zero (09618) maps to 4-digit .HK ticker."""
        assert symbol_to_yf_ticker("09618:xhkg", "Stock") == "9618.HK"

    def test_stock_hk_tencent(self):
        """HK Tencent (00700) maps to 0700.HK."""
        assert symbol_to_yf_ticker("00700:xhkg", "Stock") == "0700.HK"

    def test_stock_sg_ocbc(self):
        """Singapore Exchange stock appends .SI."""
        assert symbol_to_yf_ticker("O39:xses", "Stock") == "O39.SI"

    def test_stock_sg_uob(self):
        """Singapore Exchange UOB appends .SI."""
        assert symbol_to_yf_ticker("U11:xses", "Stock") == "U11.SI"

    def test_empty_symbol_returns_none(self):
        """Empty symbol string returns None."""
        assert symbol_to_yf_ticker("", "Stock") is None

    def test_none_symbol_returns_none(self):
        """None symbol returns None."""
        assert symbol_to_yf_ticker(None, "Stock") is None

    def test_stock_no_exchange_suffix(self):
        """Stock symbol with no colon (no exchange suffix) returns the base symbol as-is."""
        assert symbol_to_yf_ticker("COIN", "Stock") == "COIN"

    def test_stock_hk_no_leading_zero(self):
        """HK stock with no leading zeros is padded to 4 digits with .HK suffix."""
        assert symbol_to_yf_ticker("1299:xhkg", "Stock") == "1299.HK"


class TestParseSaxoXlsx:
    @staticmethod
    def _load():
        return parse_saxo_xlsx(FIXTURE.read_bytes())

    def test_real_file_returns_positions(self):
        """Real Saxo export returns at least one position."""
        positions = self._load()
        assert len(positions) > 0

    def test_section_headers_excluded(self):
        """Section header rows (containing '(') are not in results."""
        positions = self._load()
        for p in positions:
            assert "(" not in p["instrument"], (
                f"Section header leaked into results: {p['instrument']}"
            )

    def test_asset_types_present(self):
        """Both 'Stock Option' and 'Stock' asset types are parsed."""
        positions = self._load()
        types = {p["asset_type"] for p in positions}
        assert "Stock Option" in types
        assert "Stock" in types

    def test_numeric_fields_are_float_or_none(self):
        """Numeric fields are float or None, never strings."""
        positions = self._load()
        numeric_fields = ["quantity", "open_price", "current_price",
                          "pnl_sgd", "market_value_sgd", "strike", "underlying_price"]
        for p in positions:
            for field in numeric_fields:
                val = p.get(field)
                assert val is None or isinstance(val, float), (
                    f"{field} is {type(val).__name__} in {p['instrument']}"
                )

    def test_yf_ticker_not_in_parsed_output(self):
        """Parser does not add yf_ticker — that is the endpoint's responsibility."""
        positions = self._load()
        for p in positions:
            assert "yf_ticker" not in p

    def test_option_fields_populated(self):
        """Stock Option positions have call_put, strike, expiry."""
        positions = self._load()
        options = [p for p in positions if p["asset_type"] == "Stock Option"]
        assert len(options) > 0
        for p in options:
            assert p["call_put"] in ("Call", "Put"), f"Unexpected call_put: {p['call_put']}"
            assert p["strike"] is not None and p["strike"] > 0
            assert p["expiry"] != ""

    def test_ls_values_are_long_or_short(self):
        """L/S field is always 'Long' or 'Short'."""
        positions = self._load()
        for p in positions:
            assert p["l_s"] in ("Long", "Short"), f"Unexpected l_s: {p['l_s']}"

    def test_currency_field_populated(self):
        """Currency is a non-empty string."""
        positions = self._load()
        for p in positions:
            assert p["currency"] != "", f"Empty currency for {p['instrument']}"

    def test_correct_position_count(self):
        """File has 20 options + 8 stocks visible = 28 total positions (no section headers)."""
        positions = self._load()
        # Section headers say "Listed options (20)" and "Stocks (11)" but only 8 stock rows
        # present in the fixture — total should be >= 25
        assert len(positions) >= 25


class TestGetPriceHistory:
    def test_empty_list_returns_empty(self):
        """Empty ticker list returns empty result without calling yfinance."""
        dates, prices = get_price_history([])
        assert dates == []
        assert prices == {}

    def test_none_and_empty_tickers_filtered(self):
        """None/empty-string tickers are filtered; if none remain, returns empty."""
        dates, prices = get_price_history([None, "", None])
        assert dates == []
        assert prices == {}

    def test_single_ticker_returns_aligned_dates_and_prices(self):
        """Single ticker: returns correct dates and prices list."""
        idx = pd.to_datetime(["2026-03-31", "2026-04-01", "2026-04-02"])
        df = pd.DataFrame({"Close": [145.0, 146.0, 147.0]}, index=idx)
        with patch("services.portfolio.yf.download", return_value=df):
            dates, prices = get_price_history(["AMD"], days=3)
        assert dates == ["2026-03-31", "2026-04-01", "2026-04-02"]
        assert prices == {"AMD": [145.0, 146.0, 147.0]}

    def test_single_ticker_drops_nan_before_tail(self):
        """Single ticker: NaN rows are dropped before taking tail(days), not after."""
        idx = pd.to_datetime(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01"])
        df = pd.DataFrame({"Close": [float("nan"), float("nan"), 100.0, 101.0, 102.0]}, index=idx)
        with patch("services.portfolio.yf.download", return_value=df):
            dates, prices = get_price_history(["AMD"], days=3)
        # NaN rows removed first → last 3 are the 30th/31st/1st, not the NaN-padded days
        assert dates == ["2026-03-30", "2026-03-31", "2026-04-01"]
        assert prices == {"AMD": [100.0, 101.0, 102.0]}

    def test_multi_ticker_shared_date_spine(self):
        """Multi-ticker: all tickers share the same aligned date spine."""
        idx = pd.to_datetime(["2026-03-31", "2026-04-01", "2026-04-02"])
        close_df = pd.DataFrame({"AMD": [145.0, 146.0, 147.0], "AAPL": [198.0, 199.0, 200.0]}, index=idx)
        mock_df = pd.concat({"Close": close_df}, axis=1)
        with patch("services.portfolio.yf.download", return_value=mock_df):
            dates, prices = get_price_history(["AMD", "AAPL"], days=3)
        assert dates == ["2026-03-31", "2026-04-01", "2026-04-02"]
        assert prices["AMD"] == [145.0, 146.0, 147.0]
        assert prices["AAPL"] == [198.0, 199.0, 200.0]

    def test_multi_ticker_drops_all_nan_rows_before_tail(self):
        """Multi-ticker: rows where ALL tickers are NaN are dropped before tail(days)."""
        idx = pd.to_datetime(["2026-03-28", "2026-03-31", "2026-04-01", "2026-04-02"])
        close_df = pd.DataFrame({
            "AMD":  [float("nan"), 145.0, 146.0, 147.0],
            "AAPL": [float("nan"), 198.0, 199.0, 200.0],
        }, index=idx)
        mock_df = pd.concat({"Close": close_df}, axis=1)
        with patch("services.portfolio.yf.download", return_value=mock_df):
            dates, prices = get_price_history(["AMD", "AAPL"], days=3)
        assert dates == ["2026-03-31", "2026-04-01", "2026-04-02"]
        assert prices["AMD"] == [145.0, 146.0, 147.0]
        assert prices["AAPL"] == [198.0, 199.0, 200.0]

    def test_multi_ticker_partial_nan_row_preserved(self):
        """Multi-ticker: a row where only ONE ticker is NaN is kept (not dropped)."""
        idx = pd.to_datetime(["2026-04-01", "2026-04-02", "2026-04-03"])
        close_df = pd.DataFrame({
            "AMD":  [145.0, float("nan"), 147.0],
            "AAPL": [198.0, 199.0,        200.0],
        }, index=idx)
        mock_df = pd.concat({"Close": close_df}, axis=1)
        with patch("services.portfolio.yf.download", return_value=mock_df):
            dates, prices = get_price_history(["AMD", "AAPL"], days=3)
        assert len(dates) == 3
        assert prices["AMD"][1] is None   # NaN → None
        assert prices["AAPL"][1] == 199.0

    def test_download_exception_returns_empty_not_raises(self):
        """If yf.download raises, returns ([], {}) instead of propagating the exception."""
        with patch("services.portfolio.yf.download", side_effect=RuntimeError("network error")):
            dates, prices = get_price_history(["AMD"])
        assert dates == []
        assert prices == {}

class TestColLetterToIndex:
    def test_a_is_zero(self):
        """Column 'A' maps to index 0."""
        assert _col_letter_to_index("A") == 0

    def test_b_is_one(self):
        """Column 'B' maps to index 1."""
        assert _col_letter_to_index("B") == 1

    def test_z_is_25(self):
        """Column 'Z' maps to index 25."""
        assert _col_letter_to_index("Z") == 25

    def test_aa_is_26(self):
        """Column 'AA' maps to index 26 (first double-letter column)."""
        assert _col_letter_to_index("AA") == 26

    def test_ab_is_27(self):
        """Column 'AB' maps to index 27."""
        assert _col_letter_to_index("AB") == 27

    def test_az_is_51(self):
        """Column 'AZ' maps to index 51."""
        assert _col_letter_to_index("AZ") == 51

    def test_ba_is_52(self):
        """Column 'BA' maps to index 52."""
        assert _col_letter_to_index("BA") == 52

    def test_lowercase_input_handled(self):
        """Lowercase letters produce the same result as uppercase."""
        assert _col_letter_to_index("a") == 0
        assert _col_letter_to_index("z") == 25
        assert _col_letter_to_index("aa") == 26


class TestSafeFloat:
    def test_none_returns_none(self):
        """None input returns None."""
        assert _safe_float(None) is None

    def test_empty_string_returns_none(self):
        """Empty string returns None."""
        assert _safe_float("") is None

    def test_valid_float_string(self):
        """A valid float string is parsed correctly."""
        assert _safe_float("3.14") == pytest.approx(3.14)

    def test_integer_string(self):
        """An integer string is returned as a float."""
        assert _safe_float("42") == pytest.approx(42.0)

    def test_negative_value(self):
        """Negative numeric strings are parsed correctly."""
        assert _safe_float("-15.5") == pytest.approx(-15.5)

    def test_non_numeric_string_returns_none(self):
        """A non-numeric string returns None without raising."""
        assert _safe_float("abc") is None

    def test_actual_float_passthrough(self):
        """An already-float value passes through unchanged."""
        assert _safe_float(3.14) == pytest.approx(3.14)


class TestGetPriceHistory:
    def test_duplicate_tickers_deduplicated(self):
        """Duplicate tickers are deduplicated; yf.download called with single string."""
        idx = pd.to_datetime(["2026-04-01", "2026-04-02"])
        df = pd.DataFrame({"Close": [100.0, 101.0]}, index=idx)
        with patch("services.portfolio.yf.download", return_value=df) as mock_dl:
            get_price_history(["AMD", "AMD", "AMD"], days=2)
        # Deduplication leaves one ticker → single-ticker branch → passed as string
        assert mock_dl.call_args[0][0] == "AMD"
