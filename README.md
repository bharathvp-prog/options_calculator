# ArkenVault

ArkenVault is a full-stack investing workspace focused on options research, portfolio tracking, options wheeling, screening, and scenario planning.

It combines a React frontend with a FastAPI backend and uses live market data, Firebase auth, Firestore persistence, and Supabase-backed screener storage.

## What the app does

- Strategy builder: turn a natural-language market view into an options structure and compare contracts across expiries.
- Portfolio tracker: upload Saxo exports, group positions, refresh prices, and inspect recent portfolio movement.
- Options wheeling: manage covered calls and cash-secured puts, identify uncovered positions, and track planned income.
- Historical performance: upload historical account data and lock snapshots for performance review.
- Stock research: inspect price history, news, option chains, and financial data for a ticker.
- Screener: filter a large US equity universe by price, fundamentals, and options-derived fields.
- Planning: build bull/base/bear scenarios and save per-ticker plans.

## Stack

### Frontend

- React 19
- Vite 8
- React Router 7
- Tailwind CSS v4
- Firebase Web SDK
- Motion
- ECharts

### Backend

- FastAPI
- yfinance
- pandas
- Firebase Admin SDK
- Firestore
- Supabase
- pytest

## Repo layout

```text
options_calculator/
|-- README.md
|-- CLAUDE.md
|-- claude/
|   |-- project.md
|   `-- hosting.md
|-- frontend/
|   |-- package.json
|   |-- vite.config.js
|   `-- src/
|       |-- App.jsx
|       |-- firebase.js
|       |-- index.css
|       `-- components/
|-- backend/
|   |-- main.py
|   |-- requirements.txt
|   |-- pytest.ini
|   |-- services/
|   |-- scripts/
|   `-- tests/
`-- vercel.json
```

## Frontend pages

- `/` landing page
- `/login` auth page
- `/app/options` options strategy builder
- `/app/portfolio` portfolio dashboard
- `/app/wheeling` covered calls and cash-secured puts
- `/app/cash` cash tracking
- `/app/performance` historical performance
- `/app/stock/:ticker` stock research
- `/app/screener` stock screener
- `/app/plans` saved plans
- `/app/plans/:ticker` scenario planning workspace

## Backend modules

- `backend/main.py`: FastAPI app and API routes
- `backend/services/options.py`: options-chain helpers
- `backend/services/option_greeks.py`: Black-Scholes pricing, Greeks, and IV fallback logic
- `backend/services/strategy.py`: natural-language strategy identification
- `backend/services/payoff.py`: pure payoff calculations
- `backend/services/portfolio.py`: Saxo parsing, ticker mapping, price history
- `backend/services/historical.py`: historical upload parsing
- `backend/services/financials.py`: financial history fetches
- `backend/services/tickers.py`: ticker search and caching
- `backend/services/supabase_client.py`: Supabase client bootstrap

## Financials cache

Stock research and planning now use a DB-backed financials cache for income-statement history.

- Runtime path: `/api/financials/{ticker}` reads Supabase first.
- If annual or quarterly financials are missing or stale, the backend live-fetches from Yahoo via `yfinance`, writes the refreshed rows to Supabase, and returns the refreshed result.
- The stock page currently displays:
  - `4` annual periods
  - `16` quarterly periods
- The stock page shows a compact quarterly view inline, with a modal for the full 16-quarter history.
- The nightly screener refresh job includes a financials cache phase for the large-cap universe.

Supabase table required:

- `ticker_financials`

The SQL for this table lives in:

- `backend/scripts/supabase_migration.sql`

Important behavior:

- The nightly refresh now performs a preflight check that `ticker_financials` exists.
- If the table is missing, the financials phase fails fast with a clear error.
- If the table exists, per-ticker financial fetch failures are logged and skipped without stopping the whole refresh.

## Key API areas

- Strategy: `/api/strategy/identify`, `/api/strategy/compare`, `/api/search`
- Market data: `/api/tickers/search`, `/api/options/expiries`, `/api/options/strikes`, `/api/options/contract`
- Stock research: `/api/stock/{ticker}`, `/api/stock/{ticker}/history`, `/api/stock/{ticker}/news`, `/api/stock/{ticker}/chain`
- Portfolio: `/api/portfolio/*`, `/api/portfolio/cash`
- Wheeling: `/api/cycling`, `/api/fx/usdsgd`
- Historical: `/api/historical/*`
- Screener: `/api/screener/*`
- Plans: `/api/plans*`
- Financials: `/api/financials/{ticker}`

## Options Greeks and IV fallback

The project computes contract Greeks with Black-Scholes, but Yahoo option-chain IV can be noisy or wrong for some strikes. To make wheel-tab and screener Greeks more reliable, `backend/services/option_greeks.py` now applies a fallback pipeline:

1. Use Yahoo IV only when it looks valid and is consistent with the contract's observed price.
2. If Yahoo IV is missing or suspicious, infer IV from `mid` when bid and ask are usable.
3. If `mid` is not usable, infer IV from `lastPrice`.
4. If the row itself is unusable, interpolate IV from nearby strikes on the same expiry.

The API now exposes metadata such as:

- `impliedVolatility`
- `impliedVolatilityRaw`
- `iv_source`
- `price_source`
- `delta_status`

This logic is shared by the wheel contract preview, stock-chain Greeks, and the screener bulk options path.

## Local development

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

### Backend

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

## Tests

Run the full backend suite:

```powershell
cd backend
py -m pytest
```

Run the targeted IV/Greeks tests:

```powershell
cd backend
py -m pytest tests/test_option_greeks.py
```

Run the targeted financials cache tests:

```powershell
cd backend
py -m pytest tests/test_financials.py
```

## Environment

### Backend

- `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `ALLOWED_ORIGINS`

### Frontend

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Deployment

Deployment and hosting notes live in [claude/hosting.md](claude/hosting.md).

The current documented setup is:

- Frontend on Vercel
- Backend on Render
- `/api/*` proxied through `vercel.json`

## Documentation index

- Project guide: [claude/project.md](claude/project.md)
- Hosting guide: [claude/hosting.md](claude/hosting.md)
