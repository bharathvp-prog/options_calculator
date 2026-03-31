# Oxas — Project Guide for Claude

## What this project is
Oxas is an AI-assisted options strategy tool. Users describe a market view in plain English (e.g. "I'm confident AMD will grow to 300 but no more than 400 by June 2028"), the app identifies the right strategy, then scans live Yahoo Finance data to find the cheapest matching contracts. Results are compared across expiry horizons (1mo / 3mo / 6mo / 1yr / 2yr / latest) with cost-per-day and payoff analytics.

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
- `yfinance` for live option chain data
- Firebase Admin SDK for token verification
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
│   │   │   ├── AppShell.jsx           # sidebar layout wrapper
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── OptionsPage.jsx        # main strategy builder page
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
│   │   ├── lib/utils.js               # cn() helper
│   │   ├── firebase.js
│   │   └── main.jsx
│   └── vite.config.js
└── backend/
    ├── main.py                        # FastAPI app + all routes
    ├── pytest.ini                     # test config (testpaths = tests)
    ├── services/
    │   ├── options.py                 # yfinance helpers + horizon picker
    │   ├── strategy.py                # rule-based NL parser
    │   ├── payoff.py                  # pure payoff math (OptionLeg, compute_pnl_at, compute_payoff_table)
    │   └── tickers.py                 # ticker autocomplete
    └── tests/
        ├── test_strategy_identification.py   # 52 tests: parser + strategy routing
        └── test_payoff.py                    # 55 tests: every strategy at exact values
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

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/tickers/search?q=app` | Ticker autocomplete |
| GET  | `/api/options/expiries?ticker=AAPL` | Available expiry dates |
| POST | `/api/strategy/identify` | NL view → strategy proposal |
| POST | `/api/strategy/compare` | Strategy legs → multi-horizon results + payoff |
| POST | `/api/search` | Manual mode: cheapest contracts per leg |

### POST /api/strategy/identify
```json
// Request
{ "view": "I'm confident AMD will grow to 300 but no more than 400 by June 2028" }

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
py -m pytest          # 107 tests, must all pass before committing
```

A git pre-commit hook enforces this: `.git/hooks/pre-commit` runs the full suite and blocks the commit on failure.

**When adding new features:**
- Any new strategy type → add cases to `tests/test_strategy_identification.py`
- Any change to payoff math → add/update cases in `tests/test_payoff.py`
- Tests must describe the exact scenario in the docstring and assert exact numeric values

## Design system
- **Theme:** Dark — base background `#0a0a0f`, primary accent `indigo-600/500`
- **Cards/panels:** `bg-white/[0.02] border border-white/8 rounded-2xl`
- **Inputs:** `bg-white/5 border border-white/10 rounded-xl text-white` with `focus:ring-indigo-500/50`
- **Primary button:** `bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-500/20`
- **Call badge:** `bg-emerald-500/15 text-emerald-400 border-emerald-500/20`
- **Put badge:** `bg-rose-500/15 text-rose-400 border-rose-500/20`
- **Buy badge:** `bg-sky-500/15 text-sky-400 border-sky-500/20`
- **Sell badge:** `bg-amber-500/15 text-amber-400 border-amber-500/20`
- **Best value badge:** `bg-emerald-500/15 text-emerald-400 border-emerald-500/20`
- **DTE colors:** green >90d · amber >30d · rose <30d
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
