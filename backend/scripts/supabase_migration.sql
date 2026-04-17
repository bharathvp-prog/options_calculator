-- ============================================================
-- Oxas Stock Screener — Supabase Migration
-- Run this in the Supabase SQL Editor (one-time setup)
-- ============================================================

-- ── 1. screener_tickers ─────────────────────────────────────
-- One row per US-listed ticker, upserted nightly by the refresh job.

CREATE TABLE IF NOT EXISTS screener_tickers (
  ticker             TEXT PRIMARY KEY,
  name               TEXT,

  -- Price & momentum (Phase 1)
  current_price      NUMERIC(12,4),
  price_1d_chg_pct   NUMERIC(8,4),
  price_5d_chg_pct   NUMERIC(8,4),
  price_1mo_chg_pct  NUMERIC(8,4),
  price_3mo_chg_pct  NUMERIC(8,4),
  ma_50              NUMERIC(12,4),
  ma_200             NUMERIC(12,4),
  week_52_high       NUMERIC(12,4),
  week_52_low        NUMERIC(12,4),
  pct_from_52w_high  NUMERIC(8,4),
  pct_from_52w_low   NUMERIC(8,4),
  volume_today       BIGINT,
  avg_volume_30d     BIGINT,
  volume_ratio       NUMERIC(8,4),

  -- Fundamentals (Phase 2)
  market_cap         BIGINT,
  pe_ratio           NUMERIC(10,4),
  forward_pe         NUMERIC(10,4),
  price_to_book      NUMERIC(10,4),
  price_to_sales     NUMERIC(10,4),
  dividend_yield     NUMERIC(8,4),
  revenue_growth     NUMERIC(8,4),
  earnings_growth    NUMERIC(8,4),
  profit_margin      NUMERIC(8,4),
  debt_to_equity     NUMERIC(10,4),
  return_on_equity   NUMERIC(10,4),
  sector             TEXT,
  industry           TEXT,

  -- Options signals (Phase 3 — NULL if not options-eligible)
  has_options        BOOLEAN DEFAULT FALSE,
  iv_current         NUMERIC(8,4),
  iv_52w_high        NUMERIC(8,4),
  iv_52w_low         NUMERIC(8,4),
  iv_rank            NUMERIC(6,2),   -- 0–100
  put_call_ratio     NUMERIC(8,4),

  -- Progress tracking
  refreshed_at       TIMESTAMPTZ,
  phase1_ok          BOOLEAN DEFAULT FALSE,
  phase2_ok          BOOLEAN DEFAULT FALSE,
  phase3_ok          BOOLEAN DEFAULT FALSE
);

-- Indexes for fast screener range queries
CREATE INDEX IF NOT EXISTS idx_st_market_cap         ON screener_tickers (market_cap);
CREATE INDEX IF NOT EXISTS idx_st_pe_ratio           ON screener_tickers (pe_ratio);
CREATE INDEX IF NOT EXISTS idx_st_forward_pe         ON screener_tickers (forward_pe);
CREATE INDEX IF NOT EXISTS idx_st_price_to_book      ON screener_tickers (price_to_book);
CREATE INDEX IF NOT EXISTS idx_st_price_to_sales     ON screener_tickers (price_to_sales);
CREATE INDEX IF NOT EXISTS idx_st_dividend_yield     ON screener_tickers (dividend_yield);
CREATE INDEX IF NOT EXISTS idx_st_revenue_growth     ON screener_tickers (revenue_growth);
CREATE INDEX IF NOT EXISTS idx_st_earnings_growth    ON screener_tickers (earnings_growth);
CREATE INDEX IF NOT EXISTS idx_st_profit_margin      ON screener_tickers (profit_margin);
CREATE INDEX IF NOT EXISTS idx_st_debt_to_equity     ON screener_tickers (debt_to_equity);
CREATE INDEX IF NOT EXISTS idx_st_return_on_equity   ON screener_tickers (return_on_equity);
CREATE INDEX IF NOT EXISTS idx_st_pct_from_52w_high  ON screener_tickers (pct_from_52w_high);
CREATE INDEX IF NOT EXISTS idx_st_price_1mo_chg      ON screener_tickers (price_1mo_chg_pct);
CREATE INDEX IF NOT EXISTS idx_st_price_3mo_chg      ON screener_tickers (price_3mo_chg_pct);
CREATE INDEX IF NOT EXISTS idx_st_volume_ratio       ON screener_tickers (volume_ratio);
CREATE INDEX IF NOT EXISTS idx_st_iv_rank            ON screener_tickers (iv_rank);
CREATE INDEX IF NOT EXISTS idx_st_put_call_ratio     ON screener_tickers (put_call_ratio);
CREATE INDEX IF NOT EXISTS idx_st_sector             ON screener_tickers (sector);
CREATE INDEX IF NOT EXISTS idx_st_has_options        ON screener_tickers (has_options);
CREATE INDEX IF NOT EXISTS idx_st_refreshed_at       ON screener_tickers (refreshed_at);
CREATE INDEX IF NOT EXISTS idx_st_phase1_ok          ON screener_tickers (phase1_ok);

-- ── Options Greeks columns (added after initial migration) ───────────────────
-- ATM call greeks computed via Black-Scholes during Phase 3 of the nightly refresh.
-- Uses nearest expiry with 10–60 DTE; falls back to nearest available expiry.
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS atm_theta        NUMERIC(10,4);   -- abs daily decay ($/share, positive)
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS atm_gamma        NUMERIC(10,6);   -- delta sensitivity per $1 move
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS atm_vega         NUMERIC(10,4);   -- premium change per 1% IV move ($/share)
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS expected_move_1m NUMERIC(8,4);    -- 1-sigma 30-day move as decimal (0.08 = 8%)

CREATE INDEX IF NOT EXISTS idx_st_atm_theta     ON screener_tickers (atm_theta);
CREATE INDEX IF NOT EXISTS idx_st_atm_gamma     ON screener_tickers (atm_gamma);
CREATE INDEX IF NOT EXISTS idx_st_expected_move ON screener_tickers (expected_move_1m);

-- ── Stock page info columns (added for Supabase-first stock lookup) ──────────
-- Populated by Phase 2 of the nightly refresh so get_stock() can avoid live .info calls.
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS long_name        TEXT;
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS country          TEXT;
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS website          TEXT;
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS employees        INTEGER;
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS previous_close   NUMERIC(12,4);
ALTER TABLE screener_tickers ADD COLUMN IF NOT EXISTS options_expiries JSONB;  -- ["2025-05-16","2025-06-20",...]


-- ── 2. user_screener_presets ─────────────────────────────────
-- Per-user saved screener filter configurations.

CREATE TABLE IF NOT EXISTS user_screener_presets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid        TEXT NOT NULL,
  name       TEXT NOT NULL,
  filters    JSONB NOT NULL DEFAULT '[]',
  sort_field TEXT DEFAULT 'market_cap',
  sort_dir   TEXT DEFAULT 'desc',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usp_uid ON user_screener_presets (uid);


-- ── 3. global_screener_presets ───────────────────────────────
-- Seed presets visible to all users.

CREATE TABLE IF NOT EXISTS global_screener_presets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  filters       JSONB NOT NULL DEFAULT '[]',
  sort_field    TEXT DEFAULT 'market_cap',
  sort_dir      TEXT DEFAULT 'desc',
  display_order INT DEFAULT 0
);

-- Seed global presets (idempotent — skip if already seeded)
INSERT INTO global_screener_presets (name, description, filters, sort_field, sort_dir, display_order)
SELECT * FROM (VALUES
  (
    'Undervalued Growth',
    'Profitable companies trading cheaply with strong revenue growth',
    '[{"field":"pe_ratio","op":"lte","value":20},{"field":"revenue_growth","op":"gte","value":0.10},{"field":"market_cap","op":"gte","value":1000000000}]'::jsonb,
    'revenue_growth', 'desc', 1
  ),
  (
    'High IV Rank',
    'Options-eligible stocks with elevated implied volatility — potential premium sellers',
    '[{"field":"has_options","op":"eq","value":true},{"field":"iv_rank","op":"gte","value":70}]'::jsonb,
    'iv_rank', 'desc', 2
  ),
  (
    'Momentum Leaders',
    'Stocks with strong 3-month price momentum and above-average volume',
    '[{"field":"price_3mo_chg_pct","op":"gte","value":0.15},{"field":"volume_ratio","op":"gte","value":1.5}]'::jsonb,
    'price_3mo_chg_pct', 'desc', 3
  ),
  (
    'Dividend Income',
    'Established dividend payers with manageable debt',
    '[{"field":"dividend_yield","op":"gte","value":0.03},{"field":"debt_to_equity","op":"lte","value":1.0},{"field":"market_cap","op":"gte","value":500000000}]'::jsonb,
    'dividend_yield', 'desc', 4
  ),
  (
    'Deep Value',
    'Stocks trading below book value with positive profit margins',
    '[{"field":"price_to_book","op":"lte","value":1.5},{"field":"pe_ratio","op":"lte","value":15},{"field":"profit_margin","op":"gte","value":0.05}]'::jsonb,
    'pe_ratio', 'asc', 5
  )
) AS v(name, description, filters, sort_field, sort_dir, display_order)
WHERE NOT EXISTS (SELECT 1 FROM global_screener_presets LIMIT 1);
