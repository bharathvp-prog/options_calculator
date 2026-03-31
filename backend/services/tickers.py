import json
import requests
from datetime import datetime, timedelta
from pathlib import Path

CACHE_FILE = Path(__file__).parent.parent / "data" / "tickers_cache.json"
CACHE_TTL_DAYS = 7

_tickers: list[dict] = []

# Popular tickers bundled as fallback — used if remote fetch fails and no cache exists
_FALLBACK = [
    {"symbol": "AAPL", "name": "Apple Inc."},
    {"symbol": "MSFT", "name": "Microsoft Corp"},
    {"symbol": "GOOGL", "name": "Alphabet Inc."},
    {"symbol": "AMZN", "name": "Amazon.com Inc."},
    {"symbol": "NVDA", "name": "NVIDIA Corp"},
    {"symbol": "META", "name": "Meta Platforms Inc."},
    {"symbol": "TSLA", "name": "Tesla Inc."},
    {"symbol": "BRK.B", "name": "Berkshire Hathaway Inc."},
    {"symbol": "JPM", "name": "JPMorgan Chase & Co."},
    {"symbol": "V", "name": "Visa Inc."},
    {"symbol": "UNH", "name": "UnitedHealth Group Inc."},
    {"symbol": "XOM", "name": "Exxon Mobil Corp"},
    {"symbol": "MA", "name": "Mastercard Inc."},
    {"symbol": "LLY", "name": "Eli Lilly and Co."},
    {"symbol": "JNJ", "name": "Johnson & Johnson"},
    {"symbol": "HD", "name": "Home Depot Inc."},
    {"symbol": "PG", "name": "Procter & Gamble Co."},
    {"symbol": "AVGO", "name": "Broadcom Inc."},
    {"symbol": "MRK", "name": "Merck & Co. Inc."},
    {"symbol": "COST", "name": "Costco Wholesale Corp"},
    {"symbol": "ABBV", "name": "AbbVie Inc."},
    {"symbol": "CVX", "name": "Chevron Corp"},
    {"symbol": "CRM", "name": "Salesforce Inc."},
    {"symbol": "AMD", "name": "Advanced Micro Devices Inc."},
    {"symbol": "NFLX", "name": "Netflix Inc."},
    {"symbol": "PEP", "name": "PepsiCo Inc."},
    {"symbol": "TMO", "name": "Thermo Fisher Scientific Inc."},
    {"symbol": "ACN", "name": "Accenture plc"},
    {"symbol": "ADBE", "name": "Adobe Inc."},
    {"symbol": "WMT", "name": "Walmart Inc."},
    {"symbol": "MCD", "name": "McDonald's Corp"},
    {"symbol": "BAC", "name": "Bank of America Corp"},
    {"symbol": "CSCO", "name": "Cisco Systems Inc."},
    {"symbol": "TXN", "name": "Texas Instruments Inc."},
    {"symbol": "INTC", "name": "Intel Corp"},
    {"symbol": "QCOM", "name": "QUALCOMM Inc."},
    {"symbol": "IBM", "name": "International Business Machines Corp"},
    {"symbol": "GS", "name": "Goldman Sachs Group Inc."},
    {"symbol": "MS", "name": "Morgan Stanley"},
    {"symbol": "WFC", "name": "Wells Fargo & Co."},
    {"symbol": "C", "name": "Citigroup Inc."},
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust"},
    {"symbol": "IWM", "name": "iShares Russell 2000 ETF"},
    {"symbol": "GLD", "name": "SPDR Gold Shares"},
    {"symbol": "TLT", "name": "iShares 20+ Year Treasury Bond ETF"},
    {"symbol": "DIS", "name": "Walt Disney Co."},
    {"symbol": "PYPL", "name": "PayPal Holdings Inc."},
    {"symbol": "SQ", "name": "Block Inc."},
    {"symbol": "SHOP", "name": "Shopify Inc."},
    {"symbol": "UBER", "name": "Uber Technologies Inc."},
    {"symbol": "LYFT", "name": "Lyft Inc."},
    {"symbol": "SNAP", "name": "Snap Inc."},
    {"symbol": "TWTR", "name": "Twitter Inc."},
    {"symbol": "COIN", "name": "Coinbase Global Inc."},
    {"symbol": "HOOD", "name": "Robinhood Markets Inc."},
    {"symbol": "PLTR", "name": "Palantir Technologies Inc."},
    {"symbol": "RBLX", "name": "Roblox Corp"},
    {"symbol": "RIVN", "name": "Rivian Automotive Inc."},
    {"symbol": "F", "name": "Ford Motor Co."},
    {"symbol": "GM", "name": "General Motors Co."},
    {"symbol": "BA", "name": "Boeing Co."},
    {"symbol": "CAT", "name": "Caterpillar Inc."},
    {"symbol": "DE", "name": "Deere & Co."},
    {"symbol": "GE", "name": "General Electric Co."},
    {"symbol": "MMM", "name": "3M Co."},
    {"symbol": "RTX", "name": "Raytheon Technologies Corp"},
    {"symbol": "LMT", "name": "Lockheed Martin Corp"},
    {"symbol": "T", "name": "AT&T Inc."},
    {"symbol": "VZ", "name": "Verizon Communications Inc."},
    {"symbol": "CMCSA", "name": "Comcast Corp"},
    {"symbol": "NFLX", "name": "Netflix Inc."},
    {"symbol": "AMGN", "name": "Amgen Inc."},
    {"symbol": "GILD", "name": "Gilead Sciences Inc."},
    {"symbol": "BIIB", "name": "Biogen Inc."},
    {"symbol": "MRNA", "name": "Moderna Inc."},
    {"symbol": "PFE", "name": "Pfizer Inc."},
    {"symbol": "BNTX", "name": "BioNTech SE"},
    {"symbol": "NKE", "name": "Nike Inc."},
    {"symbol": "SBUX", "name": "Starbucks Corp"},
    {"symbol": "TGT", "name": "Target Corp"},
    {"symbol": "LOW", "name": "Lowe's Companies Inc."},
    {"symbol": "AMT", "name": "American Tower Corp"},
    {"symbol": "EQIX", "name": "Equinix Inc."},
    {"symbol": "CCI", "name": "Crown Castle Inc."},
    {"symbol": "O", "name": "Realty Income Corp"},
    {"symbol": "VNQ", "name": "Vanguard Real Estate ETF"},
    {"symbol": "XLF", "name": "Financial Select Sector SPDR Fund"},
    {"symbol": "XLE", "name": "Energy Select Sector SPDR Fund"},
    {"symbol": "XLK", "name": "Technology Select Sector SPDR Fund"},
    {"symbol": "XLV", "name": "Health Care Select Sector SPDR Fund"},
    {"symbol": "ARKK", "name": "ARK Innovation ETF"},
    {"symbol": "SOFI", "name": "SoFi Technologies Inc."},
    {"symbol": "AFRM", "name": "Affirm Holdings Inc."},
    {"symbol": "DKNG", "name": "DraftKings Inc."},
    {"symbol": "Z", "name": "Zillow Group Inc."},
    {"symbol": "ABNB", "name": "Airbnb Inc."},
]


def _load_from_cache() -> list[dict] | None:
    if not CACHE_FILE.exists():
        return None
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        updated_at = datetime.fromisoformat(data["updated_at"])
        if datetime.now() - updated_at < timedelta(days=CACHE_TTL_DAYS):
            return data["tickers"]
        print("Ticker cache is stale — will refresh.")
    except Exception:
        pass
    return None


def _save_to_cache(tickers: list[dict]):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps({"updated_at": datetime.now().isoformat(), "tickers": tickers}, indent=2),
        encoding="utf-8",
    )


def _fetch_remote() -> list[dict]:
    """Fetch from NASDAQ trader files via plain HTTP."""
    sources = [
        # (url, symbol_col, name_col, test_issue_col)
        ("http://ftp.nasdaqtrader.com/SymbolDirectory/nasdaqlisted.txt", 0, 1, 3),
        ("http://ftp.nasdaqtrader.com/SymbolDirectory/otherlisted.txt", 0, 1, 6),
    ]
    seen: set[str] = set()
    results: list[dict] = []
    for url, sym_col, name_col, test_col in sources:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        for line in resp.text.splitlines():
            parts = line.strip().split("|")
            if len(parts) <= max(sym_col, name_col):
                continue
            symbol = parts[sym_col].strip()
            name = parts[name_col].strip()
            if not symbol or symbol in ("Symbol", "ACT Symbol", "File Creation Time"):
                continue
            if len(parts) > test_col and parts[test_col].strip() == "Y":
                continue
            if symbol not in seen:
                seen.add(symbol)
                results.append({"symbol": symbol, "name": name})
    return sorted(results, key=lambda x: x["symbol"])


def load_tickers():
    global _tickers

    # 1. Use valid cache if available
    cached = _load_from_cache()
    if cached:
        _tickers = cached
        print(f"Loaded {len(_tickers)} tickers from cache.")
        return

    # 2. Try remote fetch
    print("Fetching ticker list from NASDAQ...")
    try:
        fetched = _fetch_remote()
        if fetched:
            _tickers = fetched
            _save_to_cache(_tickers)
            print(f"Loaded {len(_tickers)} tickers and saved to cache.")
            return
    except Exception as e:
        print(f"Remote ticker fetch failed: {e}")

    # 3. Fall back to bundled list
    print("Using built-in fallback ticker list.")
    _tickers = sorted(_FALLBACK, key=lambda x: x["symbol"])


def search_tickers(query: str, limit: int = 10) -> list[dict]:
    if not query:
        return []
    q = query.upper()
    starts = [t for t in _tickers if t["symbol"].startswith(q)]
    if len(starts) >= limit:
        return starts[:limit]
    name_matches = [
        t for t in _tickers
        if q in t["name"].upper() and not t["symbol"].startswith(q)
    ]
    return (starts + name_matches)[:limit]
