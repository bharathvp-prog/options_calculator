# Oxas — Project Guide for Claude

## What this project is
Oxas is an options strategy tool. Users build multi-leg options strategies (calls/puts, buy/sell sides), and the app scans live Yahoo Finance data to surface the cheapest matching contracts per leg. It calculates net debit across the full strategy.

## Stack

### Frontend
- React 19 + Vite 8
- Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no `tailwind.config.js` needed)
- React Router v7
- Firebase Auth (email/password + Google)
- `motion/react` for animations
- Path alias: `@` → `frontend/src/`

### Backend
- Python + FastAPI
- `yfinance` for live option chain data
- Firebase Admin SDK for token verification
- `uvicorn` dev server

## Folder structure
```
options_calculator/
├── CLAUDE.md                        # imports claude/project.md
├── claude/                          # all project config for Claude
│   └── project.md                   # this file
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                  # reusable UI primitives (text-rotate, parallax-floating)
│   │   │   ├── LandingPage.jsx
│   │   │   ├── LoginPage.jsx
│   │   │   ├── AppPage.jsx
│   │   │   ├── LegForm.jsx          # form to add a strategy leg
│   │   │   ├── LegList.jsx          # list of added legs + search trigger
│   │   │   ├── ResultsTable.jsx     # results from /api/search
│   │   │   └── ProtectedRoute.jsx
│   │   ├── hooks/
│   │   ├── lib/utils.js             # cn() helper
│   │   ├── firebase.js
│   │   └── main.jsx
│   └── vite.config.js
└── backend/
    ├── main.py                      # FastAPI app + routes
    └── services/
        ├── options.py               # yfinance logic
        └── tickers.py               # ticker search
```

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/options/expiries?ticker=AAPL` | Returns available expiry dates for a ticker |
| GET | `/api/tickers/search?q=app` | Ticker autocomplete search |
| POST | `/api/search` | Find cheapest contracts per leg |

### POST /api/search payload
```json
{
  "legs": [
    {
      "ticker": "AAPL",
      "expiry_from": "2024-06-01",
      "expiry_to": "2024-09-30",
      "strike_min": 180,
      "strike_max": 200,
      "option_type": "call",
      "side": "buy"
    }
  ],
  "sort_by": "ask",
  "same_expiry": false
}
```

### POST /api/search response
Returns `legs[]`, `net_debit`, `total_ask`, `total_sell_bid`, `total_mid`, `forced_expiry`.

## Design system
- **Theme:** Dark — base background `#0a0a0f`, primary accent `indigo-600/500`
- **Cards/panels:** `bg-white/[0.02] border border-white/8 rounded-2xl`
- **Inputs:** `bg-white/5 border border-white/10 rounded-xl text-white` with `focus:ring-indigo-500/50`
- **Primary button:** `bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-500/20`
- **Call badge:** `bg-emerald-500/15 text-emerald-400 border-emerald-500/20`
- **Put badge:** `bg-rose-500/15 text-rose-400 border-rose-500/20`
- **Buy badge:** `bg-sky-500/15 text-sky-400 border-sky-500/20`
- **Sell badge:** `bg-amber-500/15 text-amber-400 border-amber-500/20`
- **Brand name:** Oxas (always, everywhere)

## Dev commands
```bash
# Frontend
cd frontend && npm run dev        # runs on http://localhost:5173

# Backend
cd backend && uvicorn main:app --reload   # runs on http://localhost:8000
# or if uvicorn not on PATH:
cd backend && python -m uvicorn main:app --reload
```

## Auth
- Firebase auth is optional in dev — if `firebase_config.json` is missing, the backend skips token verification and accepts all requests
- Frontend reads Firebase config from `frontend/.env` (see `.env.example`)

## Key conventions
- All components are `.jsx` (not `.tsx`) — this is not a TypeScript project
- Use relative imports from `@/` alias inside `frontend/src/`
- New reusable UI primitives go in `frontend/src/components/ui/`
- Keep components focused — don't add features beyond what's asked
- Don't add comments unless logic is non-obvious
