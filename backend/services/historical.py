import io
import logging
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

_SHEET_NAME = "Aggregated Amounts"

_COST_TYPES = {
    "CFD Cash Adjustment",
    "Client CFD Finance Cost",
    "Client Commission Credit",
    "Client Custody Fee",
    "Client Interest",
    "Commission",
    "CurrencyConversion",
    "Exchange Fee",
    "GST on Client Custody Fee",
    "GST on Commission",
    "Hong Kong Stamp Duty",
}

_DIVIDEND_TYPES = {
    "Corporate Actions - Cash Dividends",
    "Corporate Actions - Withholding Tax",
}

_LEG_TYPES = {"Premium", "Share Amount"}

_HEADERS_WANTED = {
    "Date",
    "Amount Type Name",
    "Amount Client Currency",
    "Unified Instrument Code (UIC)",
    "Instrument SubType",
    "Instrument Symbol",
}


def _col_letter_to_index(letters: str) -> int:
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
    return idx - 1


def _parse_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        with archive.open("xl/sharedStrings.xml") as f:
            root = ET.parse(f).getroot()
    except KeyError:
        logger.debug("No sharedStrings.xml in archive (all values are inline).")
        return []
    ns = {"s": _NS}
    strings = []
    for si in root.findall("s:si", ns):
        parts = si.findall(".//s:t", ns)
        strings.append("".join(t.text or "" for t in parts))
    return strings


def _find_sheet_path(archive: zipfile.ZipFile, sheet_name: str) -> str:
    """Resolve the xl/worksheets/sheetN.xml path for a named sheet."""
    with archive.open("xl/workbook.xml") as f:
        root = ET.parse(f).getroot()

    sheet_rid = None
    for sheet in root.iter():
        if sheet.tag.endswith("}sheet") or sheet.tag == "sheet":
            if sheet.get("name") == sheet_name:
                sheet_rid = sheet.get("{%s}id" % _NS_R)
                break

    if sheet_rid is None:
        raise ValueError(f"Sheet '{sheet_name}' not found in workbook")

    with archive.open("xl/_rels/workbook.xml.rels") as f:
        root = ET.parse(f).getroot()

    for rel in root.iter():
        if rel.tag.endswith("}Relationship") or rel.tag == "Relationship":
            if rel.get("Id") == sheet_rid:
                target = rel.get("Target", "")
                # Target may be relative like "worksheets/sheet2.xml"
                if not target.startswith("xl/"):
                    target = "xl/" + target
                return target

    raise ValueError(f"Could not resolve sheet path for r:id={sheet_rid}")


def _parse_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list]:
    with archive.open(sheet_path) as f:
        root = ET.parse(f).getroot()

    ns = {"s": _NS}
    rows = []
    for row_el in root.findall(".//s:row", ns):
        cells: dict[int, str] = {}
        max_col = -1
        for c in row_el.findall("s:c", ns):
            ref = c.get("r", "")
            col_letters = "".join(ch for ch in ref if ch.isalpha())
            col_idx = _col_letter_to_index(col_letters)
            if col_idx > max_col:
                max_col = col_idx
            t = c.get("t", "")
            v_el = c.find("s:v", ns)
            is_el = c.find("s:is", ns)
            if t == "s" and v_el is not None and v_el.text:
                cells[col_idx] = shared_strings[int(v_el.text)]
            elif t == "inlineStr" and is_el is not None:
                t_el = is_el.find("s:t", ns)
                cells[col_idx] = t_el.text or "" if t_el is not None else ""
            elif v_el is not None and v_el.text:
                cells[col_idx] = v_el.text
            else:
                cells[col_idx] = ""
        rows.append([cells.get(i, "") for i in range(max_col + 1)])
    return rows


def _safe_float(val) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _excel_date_to_str(val: str) -> str | None:
    """Convert a date string or Excel serial number to 'YYYY-MM-DD'."""
    if not val:
        return None
    val_stripped = val.strip()
    # DD-MM-YYYY (Saxo export format, e.g. "02-01-2025")
    if len(val_stripped) == 10 and val_stripped[2] == "-" and val_stripped[5] == "-":
        try:
            return datetime.strptime(val_stripped, "%d-%m-%Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    # ISO string (e.g. "2026-01-15" or "2026-01-15T00:00:00")
    if len(val_stripped) >= 10 and val_stripped[4] == "-":
        try:
            return datetime.fromisoformat(val_stripped[:10]).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Excel serial number (days since Dec 30, 1899)
    try:
        serial = float(val_stripped)
        dt = datetime(1899, 12, 30) + timedelta(days=serial)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def parse_historical_xlsx(file_bytes: bytes) -> dict[str, dict]:
    """Parse a Saxo Bank 'Aggregated Amounts' sheet and return monthly P&L data.

    Returns a dict keyed by 'YYYY-MM' with fields:
        total_pnl, realized_pnl, dividend_pnl, unrealized_pnl,
        trading_costs, deposits, locked (always False for new data)
    """
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
        shared_strings = _parse_shared_strings(archive)
        sheet_path = _find_sheet_path(archive, _SHEET_NAME)
        rows = _parse_sheet_rows(archive, sheet_path, shared_strings)

    if not rows:
        return {}

    # Build column index from header row
    header_row = rows[0]
    col_index: dict[str, int] = {}
    for i, cell in enumerate(header_row):
        cell_str = str(cell).strip()
        if cell_str in _HEADERS_WANTED:
            col_index[cell_str] = i

    def _get(row, col_name: str) -> str:
        idx = col_index.get(col_name)
        if idx is None or idx >= len(row):
            return ""
        return str(row[idx]).strip()

    # Collect all rows grouped by month
    # {month: [{"date", "amount_type", "amount", "uic", "instrument_subtype"}]}
    month_rows: dict[str, list[dict]] = defaultdict(list)

    for row in rows[1:]:
        date_str = _excel_date_to_str(_get(row, "Date"))
        if not date_str:
            continue
        month = date_str[:7]  # YYYY-MM

        amount_type = _get(row, "Amount Type Name")
        if not amount_type:
            continue

        amount = _safe_float(_get(row, "Amount Client Currency")) or 0.0

        month_rows[month].append({
            "date": date_str,
            "amount_type": amount_type,
            "amount": amount,
            "uic": _get(row, "Unified Instrument Code (UIC)"),
            "instrument_subtype": _get(row, "Instrument SubType"),
            "instrument_symbol": _get(row, "Instrument Symbol"),
        })

    result: dict[str, dict] = {}

    for month, rows_m in month_rows.items():
        trading_costs = 0.0
        dividend_pnl = 0.0
        deposits = 0.0
        realized_pnl = 0.0
        unrealized_pnl = 0.0

        # Costs
        for r in rows_m:
            if r["amount_type"] in _COST_TYPES:
                trading_costs += r["amount"]

        # Dividends
        for r in rows_m:
            if r["amount_type"] in _DIVIDEND_TYPES:
                dividend_pnl += r["amount"]

        # Deposits (Cash Amount where Instrument Symbol == CASHDEPINSTF)
        for r in rows_m:
            if r["amount_type"] == "Cash Amount" and r["instrument_symbol"] == "CASHDEPINSTF":
                deposits += r["amount"]

        # Realized / Unrealized from Premium and Share Amount
        # Group by UIC: 2 entries = both legs present → realized; 1 entry → unrealized
        leg_by_uic: dict[str, list[float]] = defaultdict(list)
        for r in rows_m:
            if r["amount_type"] in _LEG_TYPES:
                leg_by_uic[r["uic"]].append(r["amount"])

        for uic, amounts in leg_by_uic.items():
            if len(amounts) == 2:
                realized_pnl += sum(amounts)
            else:
                unrealized_pnl += sum(amounts)

        # Unrealized from Position Values: per UIC, last entry − first entry
        pos_val_by_uic: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for r in rows_m:
            if r["amount_type"] == "Position Values":
                pos_val_by_uic[r["uic"]].append((r["date"], r["amount"]))

        for uic, entries in pos_val_by_uic.items():
            entries.sort(key=lambda x: x[0])
            if len(entries) >= 2:
                unrealized_pnl += entries[-1][1] - entries[0][1]

        total_pnl = realized_pnl + dividend_pnl + unrealized_pnl + trading_costs

        result[month] = {
            "total_pnl": round(total_pnl, 2),
            "realized_pnl": round(realized_pnl, 2),
            "dividend_pnl": round(dividend_pnl, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "trading_costs": round(trading_costs, 2),
            "deposits": round(deposits, 2),
            "locked": False,
        }

    return result
