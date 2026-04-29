# ArkenVault - Project Guide

This file is the repo's internal engineering guide. For the broad project overview, local setup, and deployment summary, see the root [README.md](../README.md).

## Product areas

ArkenVault currently includes six major workflows:

1. Options strategy builder
2. Portfolio tracking
3. Options wheeling
4. Historical performance tracking
5. Stock screener and stock research
6. Scenario planning

## Stack

### Frontend

- React 19 + Vite 8
- Tailwind CSS v4 via `@tailwindcss/vite`
- React Router v7
- Firebase Auth
- `motion`
- `echarts` + `echarts-for-react`
- Path alias `@` -> `frontend/src/`

### Backend

- FastAPI
- yfinance
- pandas
- Firebase Admin SDK
- Firestore
- Supabase
- pytest

## Current frontend routes

- `/`
- `/login`
- `/app/options`
- `/app/portfolio`
- `/app/wheeling`
- `/app/cash`
- `/app/performance`
- `/app/stock`
- `/app/stock/:ticker`
- `/app/screener`
- `/app/plans`
- `/app/plans/:ticker`

## Current frontend pages

- `LandingPage.jsx`
- `LoginPage.jsx`
- `DashboardPage.jsx`
- `OptionsPage.jsx`
- `PortfolioPage.jsx`
- `OptionsCyclingPage.jsx`
- `CashPage.jsx`
- `HistoricalPerformancePage.jsx`
- `StockPage.jsx`
- `ScreenerPage.jsx`
- `PlansPage.jsx`
- `PlanningPage.jsx`

## Current backend services

- `options.py`: option-chain fetch helpers and expiry selection
- `option_greeks.py`: shared Black-Scholes pricing, Greeks, and IV fallback resolution
- `strategy.py`: natural-language strategy identification
- `payoff.py`: pure payoff math
- `portfolio.py`: Saxo parser, ticker mapping, and price history
- `historical.py`: historical workbook parsing
- `financials.py`: financial history
- `tickers.py`: ticker search and SEC cache management
- `validation.py`: strategy validation helpers
- `supabase_client.py`: Supabase bootstrap

## Financials architecture

This is another important recent behavior change.

The app no longer treats `/api/financials/{ticker}` as a pure live Yahoo fetch. It now uses a DB-backed cache in Supabase:

- table: `ticker_financials`
- source for live refresh: `yfinance`
- cache service: `backend/services/financials.py`
- refresh integration: `backend/scripts/refresh_screener.py`

### Runtime behavior

- Read cached annual and quarterly rows from Supabase first.
- If the cache is missing or stale, fetch live annual + quarterly income statements and write them back to Supabase.
- Return nested annual/quarterly datasets plus legacy top-level annual fields used by `PlanningPage.jsx`.

### Current stock-page window

- Annual view: latest `4` years
- Quarterly view: latest `16` quarters
- Quarterly inline card: latest `4` quarters
- Quarterly modal: full `16` quarters

### Refresh-job behavior

- Phase 4 in `refresh_screener.py` refreshes financials for the large-cap universe.
- A preflight check verifies `ticker_financials` exists before the phase starts.
- If the table is missing, the phase fails fast with a clear cache error.
- If the table exists, per-ticker financial failures are logged and skipped.

## API surface

### Strategy

- `POST /api/strategy/identify`
- `POST /api/strategy/compare`
- `POST /api/search`

### Market data and stock research

- `GET /api/tickers/search`
- `GET /api/options/expiries`
- `GET /api/options/strikes`
- `GET /api/options/contract`
- `GET /api/stock/{ticker}`
- `GET /api/stock/{ticker}/history`
- `GET /api/stock/{ticker}/news`
- `GET /api/stock/{ticker}/chain`

### Portfolio and wheeling

- `POST /api/portfolio/upload`
- `GET /api/portfolio`
- `GET /api/portfolio/prices`
- `POST /api/portfolio/refresh`
- `GET /api/portfolio/cash`
- `GET /api/cycling`
- `POST /api/cycling`
- `GET /api/fx/usdsgd`

### Historical performance

- `POST /api/historical/upload`
- `GET /api/historical`
- `POST /api/historical/lock`

### Screener

- `GET /api/screener/fields`
- `GET /api/screener/init`
- `GET /api/screener/status`
- `POST /api/screener/run`
- `GET /api/screener/presets`
- `POST /api/screener/presets`
- `DELETE /api/screener/presets/{preset_id}`

### Planning and financials

- `GET /api/financials/{ticker}`
- `GET /api/plans/tickers`
- `GET /api/plans`
- `GET /api/plans/{plan_id}`
- `POST /api/plans`
- `DELETE /api/plans/{plan_id}`

## Options Greeks and IV fallback

This is an important recent behavior change.

The app still computes Greeks with Black-Scholes, but it no longer blindly trusts Yahoo's `impliedVolatility` value. Shared logic now lives in `backend/services/option_greeks.py` and is used by:

- `/api/options/contract`
- `/api/stock/{ticker}/chain`
- `backend/scripts/refresh_screener.py`

### Fallback pipeline

1. Accept Yahoo IV only if it is valid and consistent with the option's price.
2. If not, infer IV from `mid` when bid/ask are usable.
3. If `mid` is not usable, infer IV from `lastPrice`.
4. If the row is still unusable, interpolate from nearby strikes.

### Metadata now returned

- `impliedVolatility`
- `impliedVolatilityRaw`
- `iv_source`
- `price_source`
- `delta_status`

This is especially relevant in the wheel tab where Yahoo can return placeholder-like IV values or zero bid/ask for some strikes.

## Testing guidance

Run the full backend suite before committing:

```bash
cd backend
pytest -q
```

Targeted options-greeks tests:

```bash
cd backend
pytest tests/test_option_greeks.py -q
```

### When changing logic

- Strategy parser changes -> update `tests/test_strategy_identification.py`
- Payoff math changes -> update `tests/test_payoff.py`
- Portfolio parser changes -> update `tests/test_portfolio_parser.py`
- Historical parsing changes -> update `tests/test_historical_parser.py`
- IV and Greek fallback changes -> update `tests/test_option_greeks.py`
- Financials cache / response-shape changes -> update `tests/test_financials.py`

## Conventions

- Frontend is JSX, not TypeScript.
- Keep `payoff.py` pure and fast to test.
- Shared option-pricing behavior should live in `services/option_greeks.py`, not be duplicated in routes or scripts.
- Prefer updating both `README.md` and this guide when product structure changes materially.

## Related docs

- Root overview: [README.md](../README.md)
- Hosting and deployment: [hosting.md](hosting.md)
