# ArkenVault — Hosting Reference

## Decision Log

**Chosen stack:** Vercel (frontend) + Render free tier (backend)  
**Decided:** 2026-04-16  
**Rationale:** Zero cost for early public testing. Vercel rewrites proxy `/api/*` to Render so no frontend code changes needed. Render free tier cold starts (~30–60s after 15 min idle) are acceptable at this stage.

**Options considered:**
| Option | Stack | Cost | Cold Starts | Notes |
|---|---|---|---|---|
| **A (chosen)** | Vercel + Render | $0 | Yes (~30–60s) | No credit card needed |
| B | Vercel + Railway | ~$0–5/mo | No | $5/mo credit usually sufficient |
| C | Vercel + Fly.io | $0 | No (if configured) | 256 MB RAM tight for yfinance+pandas |
| D | Full Vercel serverless | $0 | No | FastAPI startup events + file caching break; not viable |

**Upgrade path:** If cold starts become a problem, switch backend to Railway (Option B): create Railway service from same GitHub repo, copy env vars, update `vercel.json` destination URL.

---

## Live URLs

| Service | URL |
|---|---|
| Frontend (Vercel) | https://arkenvault.vercel.app |
| Backend (Render) | https://arkenvault-api.onrender.com |

---

## Architecture

```
User → https://arkenvault.vercel.app
           │
           ├── /* (static React)  → Vercel CDN
           └── /api/* (rewrites)  → https://<render-app>.onrender.com/api/*
```

`vercel.json` at project root handles the rewrite. No changes to frontend fetch calls needed.

---

## Environment Variables

### Backend (set in Render dashboard)

| Variable | Value | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full JSON string of `firebase_config.json` | Paste entire file content as one-liner |
| `SUPABASE_URL` | `https://nqoqgywksxudchcomakz.supabase.co` | From `backend/.env` |
| `SUPABASE_ANON_KEY` | (from `backend/.env`) | Public read key |
| `SUPABASE_SERVICE_KEY` | (from `backend/.env`) | Backend write key — keep secret |
| `ALLOWED_ORIGINS` | `https://arkenvault.vercel.app` | Comma-separate to add more origins |

### Frontend (set in Vercel dashboard)

| Variable | Source |
|---|---|
| `VITE_FIREBASE_API_KEY` | `frontend/.env` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `frontend/.env` |
| `VITE_FIREBASE_PROJECT_ID` | `frontend/.env` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `frontend/.env` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `frontend/.env` |
| `VITE_FIREBASE_APP_ID` | `frontend/.env` |

---

## Deployment Steps

### Step 1 — Push to GitHub
Ensure `backend/Dockerfile` and `vercel.json` are committed and pushed.

### Step 2 — Deploy backend on Render
1. [render.com](https://render.com) → New → Web Service → connect GitHub repo
2. Root directory: `backend`
3. Runtime: **Docker** (auto-detects `backend/Dockerfile`)
4. Plan: **Free**
5. Set all backend env vars listed above (except `ALLOWED_ORIGINS` — do this after Step 4)
6. Deploy → copy the assigned URL (e.g. `https://arkenvault-api.onrender.com`)

### Step 3 — Update vercel.json
In `vercel.json`, replace `<your-render-app>` in the rewrite destination with the Render URL from Step 2. Push to GitHub.

### Step 4 — Deploy frontend on Vercel
1. [vercel.com](https://vercel.com) → New Project → import GitHub repo
2. Framework: **Vite** (auto-detected)
3. Build/output handled by `vercel.json`
4. Set all frontend env vars listed above
5. Deploy → copy the Vercel URL (e.g. `https://arkenvault.vercel.app`)

### Step 5 — Wire CORS
On Render → Environment → set `ALLOWED_ORIGINS` to the Vercel URL → trigger Manual Deploy.

---

## Render Free Tier Notes
- Spins down after **15 minutes of inactivity**
- Cold start on first request: **30–60s** (yfinance + pandas + firebase-admin are heavy)
- 750 compute hours/month — sufficient for low-traffic testing
- No persistent disk — all file writes (logs, cache) are ephemeral per deploy

---

## Files Changed for Hosting
| File | Change |
|---|---|
| `backend/main.py` | CORS reads `ALLOWED_ORIGINS` env var; Firebase init reads `FIREBASE_SERVICE_ACCOUNT_JSON` env var |
| `backend/Dockerfile` | New — enables Docker deploy on Render/Railway/Fly |
| `vercel.json` | New — Vercel build config + `/api/*` rewrite to backend |
