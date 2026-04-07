# Oxas — Project Guide for Claude

## What this project is
Oxas is an AI-assisted options strategy tool. Users describe a market view in plain English (e.g. "I'm confident AMD will grow to 250 but no more than 300 by June 2028"), the app identifies the right strategy, then scans live Yahoo Finance data to find the cheapest matching contracts. Results are compared across expiry horizons (1mo / 3mo / 6mo / 1yr / 2yr / latest) with cost-per-day and payoff analytics.

The app also includes a **Portfolio** feature: users upload a Saxo Bank `.xlsx` positions export, which is parsed and stored in Firestore. The portfolio page shows grouped positions (options/stocks), historical 7-day trend tables with day-over-day color coding, a 2W change summary column, and a 14-day inline SVG chart.

## Stack

### Frontend
- React 19 + Vite 8
- Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no `tailwind.config.js` needed)
- React Router v7
- Firebase Auth (email/password + Google)
- `motion/react` for animations
- Path alias: `@` → `frontend/src/`

### Backend
- Python 3.13 + FastAPI
- `yfinance` for live option chain data + portfolio price history
- Firebase Admin SDK for token verification + Firestore for portfolio persistence
- `uvicorn` dev server
- `pytest` for testing

## Folder structure
```
options_calculator/
├── CLAUDE.md                          # imports claude/project.md
├── claude/
│   └── project.md                     # this file
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                    # reusable UI primitives
│   │   │   ├── LandingPage.jsx
│   │   │   ├── LoginPage.jsx
│   │   │   ├── AppShell.jsx           # sidebar layout + theme toggle
│   │   │   ├── DashboardPage.jsx      # portfolio widget + sparklines
│   │   │   ├── OptionsPage.jsx        # main strategy builder page
│   │   │   ├── PortfolioPage.jsx      # portfolio upload, table, trend, chart
│   │   │   ├── ViewInput.jsx          # NL market view input (+ voice)
│   │   │   ├── StrategyProposal.jsx   # proposed strategy + qty controls
│   │   │   ├── ComparisonView.jsx     # multi-horizon results table
│   │   │   ├── PayoffCalculator.jsx   # P&L grid (modal)
│   │   │   ├── LegForm.jsx            # manual leg builder form
│   │   │   ├── LegList.jsx            # manual leg list + search
│   │   │   ├── ResultsTable.jsx       # manual mode results
│   │   │   └── ProtectedRoute.jsx
│   │   ├── hooks/
│   │   │   └── useSpeechRecognition.js
│   │   ├── lib/
│   │   │   ├── utils.js               # cn() helper
│   │   │   └── theme.js               # getStoredTheme / applyTheme / toggleTheme
│   │   ├── firebase.js
│   │   ├── index.css                  # Tailwind + html.light theme overrides
│   │   └── main.jsx
│   └── vite.config.js
└── backend/
    ├── main.py                        # FastAPI app + all routes
    ├── pytest.ini                     # test config (testpaths = tests)
    ├── services/
    │   ├── options.py                 # yfinance helpers + horizon picker
    │   ├── strategy.py                # rule-based NL parser
    │   ├── payoff.py                  # pure payoff math (OptionLeg, compute_pnl_at, compute_payoff_table)
    │   ├── tickers.py                 # ticker autocomplete
    │   └── portfolio.py               # Saxo xlsx parser + yf ticker mapping + price history
    └── tests/
        ├── test_strategy_identification.py   # 52 tests: parser + strategy routing
        ├── test_payoff.py                    # 55 tests: every strategy at exact values
        └── test_portfolio_parser.py          # symbol mapping + xlsx parsing tests
```

## User flow (Smart mode)
1. User types (or speaks) a market view → `POST /api/strategy/identify`
2. Rule-based parser returns strategy name, description, proposed legs with strike hints
3. User adjusts leg quantities (1–10×) to express conviction (ratio spreads)
4. Clicks "Compare across time horizons" → `POST /api/strategy/compare`
5. Comparison table shows 1mo / 3mo / 6mo / 1yr / 2yr / latest-available rows:
   - DTE (color-coded: green >90d, amber >30d, red <30d)
   - Net cost ($), $/day (value metric), max profit, max ROI, breakeven(s)
   - "Best value" badge on lowest $/day row
6. Click a row → leg detail panel expands inline
7. Click "View P/L" → `PayoffCalculator` modal with P&L bar chart at 21 stock prices

**Manual mode** (toggle in header): `LegForm` + `LegList` → `POST /api/search` → `ResultsTable`

## User flow (Portfolio)
1. User uploads a Saxo Bank positions `.xlsx` → `POST /api/portfolio/upload`
2. Backend parses the file, maps symbols to yfinance tickers, persists to Firestore
3. `GET /api/portfolio` loads positions on subsequent visits
4. `PortfolioPage` groups positions: Listed options → Stocks
5. Trend view: `GET /api/portfolio/prices?days=14` fetches 14-day price history
   - Options: scaled by ratio of historic underlying price to `pos.underlying_price`
   - Stocks: scaled by ratio of historic close to last yfinance close (anchors to Saxo market value)
   - Day-over-day color coding (emerald = up, rose = down, gray = first day)
   - "2W Chg (SGD)" summary column (emerald if ≥0, rose if <0)
6. 14-day inline SVG area chart shows total portfolio value over time
7. "Refresh prices" → `POST /api/portfolio/refresh` updates underlying prices from yfinance and re-persists

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/tickers/search?q=app` | Ticker autocomplete |
| GET  | `/api/options/expiries?ticker=AAPL` | Available expiry dates |
| POST | `/api/strategy/identify` | NL view → strategy proposal |
| POST | `/api/strategy/compare` | Strategy legs → multi-horizon results + payoff |
| POST | `/api/search` | Manual mode: cheapest contracts per leg |
| POST | `/api/portfolio/upload` | Upload Saxo xlsx, parse + persist positions |
| GET  | `/api/portfolio` | Fetch stored positions for current user |
| GET  | `/api/portfolio/prices?days=14` | Fetch N-day price history for portfolio tickers |
| POST | `/api/portfolio/refresh` | Refresh latest prices from yfinance, re-persist |

### POST /api/strategy/identify
```json
// Request
{ "view": "I'm confident AMD will grow to 250 but no more than 300 by June 2028" }

// Response
{
  "strategy_name": "Bull Call Spread",
  "description": "...",
  "ticker": "AMD",
  "same_expiry": true,
  "legs": [
    { "option_type": "call", "side": "buy",  "strike_hint": 300, "expiry_from": "2025-03-31", "expiry_to": "2028-06-30" },
    { "option_type": "call", "side": "sell", "strike_hint": 400, "expiry_from": "2025-03-31", "expiry_to": "2028-06-30" }
  ]
}
```

### POST /api/strategy/compare
```json
// Request
{
  "ticker": "AMD",
  "legs": [
    { "option_type": "call", "side": "buy",  "strike_hint": 300, "qty": 1 },
    { "option_type": "call", "side": "sell", "strike_hint": 400, "qty": 1 }
  ],
  "sort_by": "ask"
}

// Response — horizons[] each contains:
{
  "label": "1 year", "expiry": "2026-03-20", "dte": 354,
  "legs": [...],          // actual contracts found
  "net_debit": 5.00,
  "net_cost_dollars": 500.0,
  "cost_per_day": 1.41,
  "max_profit": 9500.0,
  "max_loss": -500.0,
  "max_roi": 1900.0,
  "breakevens": [305.0],
  "payoff_at": { "150.0": -500, "305.0": 0, "400.0": 9500, ... },
  "best_value": true
}
```

### POST /api/search (manual mode)
```json
// Request
{
  "legs": [{ "ticker": "AAPL", "expiry_from": "2025-06-01", "expiry_to": "2025-09-30",
             "strike_min": 180, "strike_max": 200, "option_type": "call", "side": "buy" }],
  "sort_by": "ask",
  "same_expiry": false
}
// Response: legs[], net_debit, total_ask, total_sell_bid, total_mid, forced_expiry
```

### GET /api/portfolio/prices
```json
// Response
{
  "dates": ["2026-03-18", "2026-03-19", ...],   // N trading days
  "prices": { "AMD": [145.2, 147.8, ...], "AAPL": [null, 198.5, ...] }
}
// null = no data for that date (weekend/holiday gap)
```

## Strategies identified by the rule-based parser
| Strategy | Trigger condition |
|---|---|
| Bull Call Spread | Bullish + 2 prices, OR bullish + 1 price + cap keyword |
| Long Call | Bullish + 1 price (no cap), or bullish + no price |
| Bear Put Spread | Bearish + 2 prices |
| Long Put | Bearish + 1 price, or bearish + no price |
| Long Strangle | Volatile sentiment + 2 prices |
| Long Straddle | Volatile sentiment + 0 or 1 price |
| Iron Condor | Neutral/flat sentiment |

## Portfolio parsing (`services/portfolio.py`)

**`parse_saxo_xlsx(file_bytes: bytes) -> list[dict]`**
- Opens xlsx via `io.BytesIO + zipfile.ZipFile`, parses `xl/sharedStrings.xml` + `xl/worksheets/sheet1.xml` using `xml.etree.ElementTree` — no openpyxl needed
- Skips row 1 (headers) and section-header rows (instrument cell contains `"("`)
- Key fields extracted: `instrument`, `l_s`, `quantity`, `open_price`, `current_price`, `pnl_sgd`, `market_value_sgd`, `asset_type`, `symbol`, `expiry`, `call_put`, `strike`, `underlying_price`, `currency`

**`symbol_to_yf_ticker(symbol, asset_type) -> str | None`**
- Options (`"Stock Option"`): `symbol.split("/")[0].replace("_US", "")` → e.g. `"AMD/21F28C200:xcbf"` → `"AMD"`
- Stocks: split on `:`, exchange suffix mapping:
  - `xhkg` → strip leading zeros, zfill(4), add `.HK`
  - `xses` → add `.SI`
  - otherwise → base symbol as-is

**`get_price_history(tickers, days=7) -> tuple[list[str], dict[str, list[float | None]]]`**
- Returns `(dates, prices)`: `dates` = list of N trading day strings, `prices` = `{ticker: [close, ...]}` with `None` for missing days
- Fetches period `days + 7` to cover weekends/holidays, then takes last `days` business days

## Historic MV scaling (PortfolioPage)

`scaledMvForDate(pos, di, dates, prices)`:
- **Stocks**: `ref = priceSeries[last]` (last yfinance close); historic MV = `market_value_sgd × (historicPrice / ref)` — anchors last column exactly to Saxo value
- **Options**: `ref = pos.underlying_price` (Saxo's underlying stock price); historic MV = `market_value_sgd × (historicUnderlyingPrice / ref)` — varies with underlying stock, NOT option premium

## Payoff math (`services/payoff.py`)
`compute_pnl_at(legs, stock_price, net_cost_dollars)` — pure function, no I/O.
`compute_payoff_table(legs, net_cost_dollars, price_range, num_points)` — returns `payoff_at`, `max_profit`, `max_loss`, `max_roi`, `breakevens`.

Key implementation details:
- Strikes are always included as sample points (prevents interpolation error at payoff kinks)
- Breakeven crossing uses strict `v1 < 0 <= v2` to prevent double-counting exact zeros
- Credit strategies (Iron Condor): `net_cost_dollars < 0`; ROI basis = `abs(max_loss)`

## Testing — REQUIRED on every build
```bash
cd backend
py -m pytest          # all tests must pass before committing
```

A git pre-commit hook enforces this: `.git/hooks/pre-commit` runs the full suite and blocks the commit on failure.

**When adding new features:**
- Any new strategy type → add cases to `tests/test_strategy_identification.py`
- Any change to payoff math → add/update cases in `tests/test_payoff.py`
- Portfolio parser changes → update `tests/test_portfolio_parser.py`
- Tests must describe the exact scenario in the docstring and assert exact numeric values

## Design system
- **Theme:** Dark by default — base background `#0a0a0f`, primary accent `indigo-600/500`
- **Light theme:** toggled via `html.light` class on `<html>` element; CSS overrides in `index.css`; persisted to `localStorage` under key `oxas-theme`; applied immediately in `main.jsx` before React renders
- **Theme toggle:** sun/moon icon button in sidebar footer (AppShell); uses `lib/theme.js` helpers
- **Logo:** always `fill="white"` on SVG inside indigo square — do NOT use `fill="currentColor"` (light theme CSS would override it)
- **Cards/panels:** `bg-white/[0.02] border border-white/8 rounded-2xl`
- **Inputs:** `bg-white/5 border border-white/10 rounded-xl text-white` with `focus:ring-indigo-500/50`
- **Primary button:** `bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-500/20`
- **Call badge:** `bg-emerald-500/15 text-emerald-400 border-emerald-500/20`
- **Put badge:** `bg-rose-500/15 text-rose-400 border-rose-500/20`
- **Buy badge:** `bg-sky-500/15 text-sky-400 border-sky-500/20`
- **Sell badge:** `bg-amber-500/15 text-amber-400 border-amber-500/20`
- **Best value badge:** `bg-emerald-500/15 text-emerald-400 border-emerald-500/20`
- **DTE colors:** green >90d · amber >30d · rose <30d
- **Trend cell colors:** emerald = up vs prior day · rose = down · gray = first column or no data
- **2W change column:** emerald if ≥0, rose if <0
- **Brand name:** Oxas (always, everywhere)

## Dev commands
```bash
# Frontend
cd frontend && npm run dev        # http://localhost:5173

# Backend
cd backend && python -m uvicorn main:app --reload   # http://localhost:8000

# Tests (run before every commit)
cd backend && py -m pytest
```

## Auth
- Firebase auth is optional in dev — if `firebase_config.json` is missing, backend accepts all requests
- Frontend reads Firebase config from `frontend/.env` (see `.env.example`)

## Key conventions
- All components are `.jsx` — this is not a TypeScript project
- Use `@/` alias imports inside `frontend/src/`
- New reusable UI primitives go in `frontend/src/components/ui/`
- Keep components focused — don't add features beyond what's asked
- Don't add comments unless logic is non-obvious
- `payoff.py` must stay a pure module (no FastAPI/yfinance imports) so tests run fast
- Light theme: all CSS overrides live in `index.css` under `html.light` selectors — do not add theme logic to components
- Tailwind v4 arbitrary-value class escaping in CSS: `.bg-\[\#0a0a0f\]` (backslash-escape brackets and `#`)
