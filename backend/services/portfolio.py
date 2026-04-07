import io
import logging
import zipfile
import xml.etree.ElementTree as ET
import yfinance as yf

_log = logging.getLogger(__name__)

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _col_letter_to_index(letters: str) -> int:
    """Convert column letter(s) like 'A', 'B', 'AB' to 0-based index."""
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
    return idx - 1


def _parse_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        with archive.open("xl/sharedStrings.xml") as f:
            root = ET.parse(f).getroot()
    except KeyError:
        return []
    strings = []
    ns = {"s": _NS}
    for si in root.findall("s:si", ns):
        parts = si.findall(".//s:t", ns)
        strings.append("".join(t.text or "" for t in parts))
    return strings


def _parse_sheet_rows(archive: zipfile.ZipFile, shared_strings: list[str]) -> list[list]:
    with archive.open("xl/worksheets/sheet1.xml") as f:
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


_HEADERS_WANTED = {
    "Instrument": "instrument",
    "L/S": "l_s",
    "Quantity": "quantity",
    "Open price": "open_price",
    "Current price": "current_price",
    "P/L (SGD)": "pnl_sgd",
    "Market value (SGD)": "market_value_sgd",
    "Asset type": "asset_type",
    "Symbol": "symbol",
    "Expiry": "expiry",
    "Call/Put": "call_put",
    "Strike": "strike",
    "Underlying price": "underlying_price",
    "Currency": "currency",
    "Value date": "value_date",
}

_NUMERIC_FIELDS = {"quantity", "open_price", "current_price", "pnl_sgd",
                   "market_value_sgd", "strike", "underlying_price"}


def parse_saxo_xlsx(file_bytes: bytes) -> list[dict]:
    """Parse a Saxo Bank positions .xlsx export and return a list of position dicts."""
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
        shared_strings = _parse_shared_strings(archive)
        rows = _parse_sheet_rows(archive, shared_strings)

    if not rows:
        return []

    # Build column index from header row
    header_row = rows[0]
    col_index: dict[str, int] = {}
    for i, cell in enumerate(header_row):
        cell_str = str(cell).strip()
        if cell_str in _HEADERS_WANTED:
            col_index[cell_str] = i

    # Resolve all column indices once — constant for the whole file
    instr_idx = col_index.get("Instrument")
    field_col: dict[str, int | None] = {h: col_index.get(h) for h in _HEADERS_WANTED}

    positions = []
    for row in rows[1:]:
        instrument = str(row[instr_idx]).strip() if instr_idx is not None and instr_idx < len(row) else ""

        # Skip empty rows and section header rows (contain parentheses like "Listed options (20)")
        if not instrument or "(" in instrument:
            continue

        pos: dict = {}
        for header, field in _HEADERS_WANTED.items():
            idx = field_col[header]
            val = str(row[idx]).strip() if idx is not None and idx < len(row) else ""
            if field in _NUMERIC_FIELDS:
                pos[field] = _safe_float(val)
            else:
                pos[field] = val

        positions.append(pos)

    return positions


def symbol_to_yf_ticker(symbol: str, asset_type: str) -> str | None:
    """Convert a Saxo Bank symbol to a yfinance-compatible ticker."""
    if not symbol:
        return None

    if asset_type == "Stock Option":
        # e.g. "AMD/21F28C200:xcbf" → "AMD"
        # e.g. "MOH_US/17J26C160:xcbf" → "MOH"
        base = symbol.split("/")[0]
        return base.replace("_US", "")

    # Stock: e.g. "COIN:xnas", "00941:xhkg", "O39:xses"
    parts = symbol.split(":")
    base = parts[0]
    suffix = parts[1].lower() if len(parts) > 1 else ""

    if suffix == "xhkg":
        # Strip leading zeros, pad to 4 digits
        numeric = base.lstrip("0") or "0"
        return numeric.zfill(4) + ".HK"
    elif suffix == "xses":
        return base + ".SI"
    else:
        # xnas, xnys, etc. — use as-is
        return base


def get_price_history(tickers: list[str], days: int = 7) -> tuple[list[str], dict[str, list[float | None]]]:
    """Fetch up to `days` trading days of closing prices for each ticker via yfinance.

    Returns a tuple of (dates, prices) where dates is a list of ISO date strings
    and prices is a dict mapping ticker → list of closing prices (None where unavailable).
    Both lists are aligned: prices[ticker][i] corresponds to dates[i].
    """
    unique = list(dict.fromkeys(t for t in tickers if t))
    if not unique:
        return [], {}

    fetch_period = f"{days + 7}d"  # fetch extra days to cover weekends/holidays

    def _safe(v) -> float | None:
        try:
            f = float(v)
            return round(f, 4) if f == f else None  # NaN check
        except Exception:
            return None

    try:
        if len(unique) == 1:
            df = yf.download(unique[0], period=fetch_period, interval="1d",
                             progress=False, auto_adjust=True)
            closes = df["Close"].dropna().tail(days)
            dates = [d.strftime("%Y-%m-%d") for d in closes.index]
            return dates, {unique[0]: [_safe(v) for v in closes.tolist()]}

        # Multi-ticker: yf returns MultiIndex columns; df["Close"] is a DataFrame
        # with tickers as columns. Use group_by="column" (default) — not group_by="ticker".
        df = yf.download(unique, period=fetch_period, interval="1d",
                         progress=False, auto_adjust=True)
        # Drop rows where ALL tickers are NaN (weekends/holidays), then take last N days
        closes_df = df["Close"].dropna(how="all").tail(days)
        dates = [d.strftime("%Y-%m-%d") for d in closes_df.index]
        result: dict[str, list[float | None]] = {}
        for ticker in unique:
            try:
                result[ticker] = [_safe(v) for v in closes_df[ticker].tolist()]
            except Exception:
                result[ticker] = [None] * len(dates)
        return dates, result
    except Exception as e:
        _log.error("get_price_history failed: %s", e, exc_info=True)
        return [], {}
