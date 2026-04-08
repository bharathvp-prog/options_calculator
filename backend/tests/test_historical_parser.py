"""Tests for services/historical.py — monthly P&L aggregation logic.

These tests call parse_historical_xlsx() indirectly by testing the aggregation
helpers via a synthetic in-memory xlsx built with the same XML structure the
parser expects.
"""
import io
import zipfile
import xml.etree.ElementTree as ET
import pytest
from services.historical import parse_historical_xlsx, _excel_date_to_str


# ── helpers ──────────────────────────────────────────────────────────────────

def _build_xlsx(rows: list[list]) -> bytes:
    """Build a minimal .xlsx with a sheet named 'Aggregated Amounts'.

    Rows are lists of values. All values are written as inline strings to keep
    the fixture code simple (the parser handles the 'inlineStr' cell type).
    """
    NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
    OFF_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

    def _col(n: int) -> str:
        """0-based index → column letter (A, B, ..., Z, AA, ...)."""
        s = ""
        n += 1
        while n:
            n, r = divmod(n - 1, 26)
            s = chr(65 + r) + s
        return s

    # Build sheet XML
    root = ET.Element(f"{{{NS}}}worksheet")
    sd = ET.SubElement(root, f"{{{NS}}}sheetData")
    for ri, row_vals in enumerate(rows, start=1):
        row_el = ET.SubElement(sd, f"{{{NS}}}row", r=str(ri))
        for ci, val in enumerate(row_vals):
            cell_ref = f"{_col(ci)}{ri}"
            c_el = ET.SubElement(row_el, f"{{{NS}}}c", r=cell_ref, t="inlineStr")
            is_el = ET.SubElement(c_el, f"{{{NS}}}is")
            t_el = ET.SubElement(is_el, f"{{{NS}}}t")
            t_el.text = str(val) if val is not None else ""
    sheet_xml = ET.tostring(root, encoding="unicode")

    # Workbook XML referencing the sheet by name
    wb_root = ET.Element(f"{{{NS}}}workbook")
    sheets_el = ET.SubElement(wb_root, f"{{{NS}}}sheets")
    ET.SubElement(
        sheets_el,
        f"{{{NS}}}sheet",
        attrib={"name": "Aggregated Amounts", "sheetId": "1", f"{{{OFF_NS}}}id": "rId1"},
    )
    wb_xml = ET.tostring(wb_root, encoding="unicode")

    # Relationships for workbook
    rel_root = ET.Element(f"{{{REL_NS}}}Relationships")
    ET.SubElement(
        rel_root,
        f"{{{REL_NS}}}Relationship",
        attrib={"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                "Target": "worksheets/sheet1.xml"},
    )
    rel_xml = ET.tostring(rel_root, encoding="unicode")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/workbook.xml", wb_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", rel_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return buf.getvalue()


# Standard header row matching parser expectations
_HEADER = [
    "Date",
    "Booking Account ID",
    "Account Currency",
    "Client Currency",
    "Amount Type Name",
    "Affects Balance",
    "Asset type",
    "Unified Instrument Code (UIC)",
    "Underlying Instrument SubType",
    "Instrument Symbol",
    "Instrument Description",
    "Instrument SubType",
    "Underlying Instrument AssetType",
    "Underlying Instrument Description",
    "Underlying Instrument Symbol",
    "Underlying Instrument Uic",
    "Amount",
    "Amount Account Currency",
    "Amount Client Currency",
    "Cost type",
    "Cost subtype",
]

# Column indices (0-based) matching _HEADER
_DATE_COL = 0
_AMOUNT_TYPE_COL = 4
_UIC_COL = 7
_INSTR_SUBTYPE_COL = 11
_AMOUNT_CLIENT_COL = 18


def _row(date="2026-01-15", amount_type="", uic="", instrument_subtype="", amount=0.0) -> list:
    r = [""] * len(_HEADER)
    r[_DATE_COL] = date
    r[_AMOUNT_TYPE_COL] = amount_type
    r[_UIC_COL] = uic
    r[_INSTR_SUBTYPE_COL] = instrument_subtype
    r[_AMOUNT_CLIENT_COL] = str(amount)
    return r


# ── date helper tests ─────────────────────────────────────────────────────────

def test_excel_date_iso_string():
    assert _excel_date_to_str("2026-01-15") == "2026-01-15"


def test_excel_date_serial():
    # Excel serial 46041 = 2026-01-19 (datetime(1899,12,30) + timedelta(46041))
    result = _excel_date_to_str("46041")
    assert result == "2026-01-19"


def test_excel_date_empty():
    assert _excel_date_to_str("") is None


# ── cost aggregation ──────────────────────────────────────────────────────────

def test_cost_types_summed():
    """All cost-bucket Amount Type Names are aggregated into trading_costs."""
    rows = [
        _HEADER,
        _row(amount_type="Commission", amount=-150.0),
        _row(amount_type="Exchange Fee", amount=-10.0),
        _row(amount_type="GST on Commission", amount=-15.0),
        _row(amount_type="Client Custody Fee", amount=-5.0),
        _row(amount_type="Hong Kong Stamp Duty", amount=-8.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert "2026-01" in result
    assert result["2026-01"]["trading_costs"] == pytest.approx(-188.0)


def test_client_commission_credit_is_positive_cost():
    """Client Commission Credit is a discount — positive value added to costs."""
    rows = [_HEADER, _row(amount_type="Client Commission Credit", amount=50.0)]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["trading_costs"] == pytest.approx(50.0)


# ── dividend aggregation ──────────────────────────────────────────────────────

def test_dividends_summed():
    rows = [
        _HEADER,
        _row(amount_type="Corporate Actions - Cash Dividends", amount=300.0),
        _row(amount_type="Corporate Actions - Withholding Tax", amount=-45.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["dividend_pnl"] == pytest.approx(255.0)


# ── deposit detection ─────────────────────────────────────────────────────────

def test_deposit_detected_by_instrument_subtype():
    """Cash Amount row with Instrument SubType CASHDEPINSTF → deposit."""
    rows = [
        _HEADER,
        _row(amount_type="Cash Amount", instrument_subtype="CASHDEPINSTF", amount=5000.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["deposits"] == pytest.approx(5000.0)


def test_inter_account_transfer_ignored():
    """Cash Amount row without CASHDEPINSTF is ignored (inter-account transfer)."""
    rows = [
        _HEADER,
        _row(amount_type="Cash Amount", instrument_subtype="TRANSFER", amount=5000.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["deposits"] == pytest.approx(0.0)


# ── realized P&L (Premium / Share Amount) ────────────────────────────────────

def test_two_premium_legs_same_uic_is_realized():
    """Two Premium entries for the same UIC in a month → realized P&L."""
    rows = [
        _HEADER,
        _row(amount_type="Premium", uic="AMD-123", amount=-500.0),   # open leg
        _row(amount_type="Premium", uic="AMD-123", amount=700.0),    # close leg
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["realized_pnl"] == pytest.approx(200.0)
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(0.0)


def test_two_share_amount_legs_same_uic_is_realized():
    """Two Share Amount entries for the same UIC → realized P&L."""
    rows = [
        _HEADER,
        _row(amount_type="Share Amount", uic="AAPL-456", amount=-1000.0),
        _row(amount_type="Share Amount", uic="AAPL-456", amount=1200.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["realized_pnl"] == pytest.approx(200.0)
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(0.0)


# ── unrealized P&L (single leg) ──────────────────────────────────────────────

def test_single_premium_leg_is_unrealized():
    """A single Premium entry (only opening leg seen) → unrealized P&L."""
    rows = [
        _HEADER,
        _row(amount_type="Premium", uic="AMD-789", amount=-300.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(-300.0)
    assert result["2026-01"]["realized_pnl"] == pytest.approx(0.0)


def test_single_share_amount_leg_is_unrealized():
    rows = [
        _HEADER,
        _row(amount_type="Share Amount", uic="MSFT-001", amount=-800.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(-800.0)


# ── unrealized P&L (Position Values) ─────────────────────────────────────────

def test_position_values_change_is_unrealized():
    """Position Values: last entry − first entry per UIC per month."""
    rows = [
        _HEADER,
        _row(date="2026-01-02", amount_type="Position Values", uic="AMD", amount=10000.0),
        _row(date="2026-01-31", amount_type="Position Values", uic="AMD", amount=11500.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(1500.0)


def test_position_values_single_entry_ignored():
    """A single Position Values entry has no delta — contributes 0 unrealized."""
    rows = [
        _HEADER,
        _row(date="2026-01-31", amount_type="Position Values", uic="AMD", amount=10000.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(0.0)


def test_position_values_multiple_uics():
    """Position Values change computed independently per UIC and summed."""
    rows = [
        _HEADER,
        _row(date="2026-01-02", amount_type="Position Values", uic="AMD", amount=5000.0),
        _row(date="2026-01-31", amount_type="Position Values", uic="AMD", amount=5500.0),
        _row(date="2026-01-02", amount_type="Position Values", uic="AAPL", amount=8000.0),
        _row(date="2026-01-31", amount_type="Position Values", uic="AAPL", amount=7600.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    # AMD: +500, AAPL: -400 → net -100 wait, 500 + (-400) = 100? No: 500 - 400 = 100
    assert result["2026-01"]["unrealized_pnl"] == pytest.approx(500.0 + (-400.0))


# ── total P&L ─────────────────────────────────────────────────────────────────

def test_total_pnl_excludes_deposits():
    """Total P&L = Realized + Dividend + Unrealized + Costs. Deposits excluded."""
    rows = [
        _HEADER,
        _row(amount_type="Commission", amount=-100.0),
        _row(amount_type="Corporate Actions - Cash Dividends", amount=200.0),
        _row(amount_type="Premium", uic="X", amount=-500.0),   # single leg → unrealized
        _row(amount_type="Cash Amount", instrument_subtype="CASHDEPINSTF", amount=5000.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    m = result["2026-01"]
    assert m["trading_costs"] == pytest.approx(-100.0)
    assert m["dividend_pnl"] == pytest.approx(200.0)
    assert m["unrealized_pnl"] == pytest.approx(-500.0)
    assert m["deposits"] == pytest.approx(5000.0)
    assert m["total_pnl"] == pytest.approx(-100.0 + 200.0 + (-500.0))  # = -400


# ── month grouping ────────────────────────────────────────────────────────────

def test_rows_grouped_by_month():
    """Rows in different months produce separate month keys."""
    rows = [
        _HEADER,
        _row(date="2026-01-15", amount_type="Commission", amount=-50.0),
        _row(date="2026-02-10", amount_type="Commission", amount=-80.0),
    ]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert set(result.keys()) == {"2026-01", "2026-02"}
    assert result["2026-01"]["trading_costs"] == pytest.approx(-50.0)
    assert result["2026-02"]["trading_costs"] == pytest.approx(-80.0)


# ── locked flag ───────────────────────────────────────────────────────────────

def test_new_months_have_locked_false():
    """Freshly parsed months always have locked=False."""
    rows = [_HEADER, _row(amount_type="Commission", amount=-10.0)]
    result = parse_historical_xlsx(_build_xlsx(rows))
    assert result["2026-01"]["locked"] is False


# ── ignored amount types ──────────────────────────────────────────────────────

def test_ignored_types_do_not_affect_totals():
    """Accruals, Net P/L, P/L, Position Exposure, etc. are all ignored."""
    ignored = ["Accruals", "Change in Accruals", "Client CFD Finance",
               "Net P/L", "P/L", "Percent return per Instrument", "Position Exposure"]
    rows = [_HEADER] + [_row(amount_type=t, amount=9999.0) for t in ignored]
    result = parse_historical_xlsx(_build_xlsx(rows))
    m = result["2026-01"]
    assert m["trading_costs"] == pytest.approx(0.0)
    assert m["realized_pnl"] == pytest.approx(0.0)
    assert m["unrealized_pnl"] == pytest.approx(0.0)
    assert m["dividend_pnl"] == pytest.approx(0.0)
    assert m["deposits"] == pytest.approx(0.0)
    assert m["total_pnl"] == pytest.approx(0.0)
