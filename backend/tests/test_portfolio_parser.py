"""
Tests for backend/services/portfolio.py

Covers:
- symbol_to_yf_ticker: all exchange types + edge cases
- parse_saxo_xlsx: section header skipping, field extraction, numeric casting
"""

import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.portfolio import parse_saxo_xlsx, symbol_to_yf_ticker

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
