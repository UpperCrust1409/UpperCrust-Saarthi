-- ============================================================
--  SAARTHI PMS — PostgreSQL Schema
--  Run once on your Supabase / Neon / Railway Postgres instance
-- ============================================================

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,          -- bcrypt hash
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'team',   -- 'admin' | 'team'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_login  TIMESTAMPTZ
);

-- UPLOAD LOGS
CREATE TABLE IF NOT EXISTS upload_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  client_count  INT DEFAULT 0,
  stock_count   INT DEFAULT 0,
  status        TEXT DEFAULT 'processing',  -- 'processing' | 'success' | 'error'
  error_message TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- CLIENTS (one row per portfolio / sheet)
CREATE TABLE IF NOT EXISTS clients (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  sheet_name             TEXT,
  total_invested         NUMERIC DEFAULT 0,
  total_invested_holdings NUMERIC DEFAULT 0,
  total_current          NUMERIC DEFAULT 0,
  total_current_holdings NUMERIC DEFAULT 0,
  total_pnl              NUMERIC DEFAULT 0,
  total_pnl_pct          NUMERIC DEFAULT 0,
  realized_gain          NUMERIC DEFAULT 0,
  cash                   NUMERIC DEFAULT 0,
  has_true_cost          BOOLEAN DEFAULT FALSE,
  investment_date        DATE,
  upload_id              UUID REFERENCES upload_logs(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_upload ON clients(upload_id);

-- HOLDINGS (one row per stock per client)
CREATE TABLE IF NOT EXISTS holdings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,
  name           TEXT,
  qty            NUMERIC DEFAULT 0,
  unit_cost      NUMERIC DEFAULT 0,
  total_cost     NUMERIC DEFAULT 0,
  market_price   NUMERIC DEFAULT 0,
  market_value   NUMERIC DEFAULT 0,
  pnl            NUMERIC DEFAULT 0,
  pnl_pct        NUMERIC DEFAULT 0,
  holding_pct    NUMERIC DEFAULT 0,
  asset_class    TEXT,
  upload_id      UUID REFERENCES upload_logs(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holdings_client ON holdings(client_id);
CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
CREATE INDEX IF NOT EXISTS idx_holdings_upload ON holdings(upload_id);

-- STOCKS (aggregated view per upload — pre-computed for fast API)
CREATE TABLE IF NOT EXISTS stocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol         TEXT NOT NULL,
  name           TEXT,
  total_value    NUMERIC DEFAULT 0,
  total_cost     NUMERIC DEFAULT 0,
  client_count   INT DEFAULT 0,
  upload_id      UUID REFERENCES upload_logs(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stocks_upload ON stocks(upload_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_symbol_upload ON stocks(symbol, upload_id);

-- STOCK CLIENT MAP (which clients hold each stock)
CREATE TABLE IF NOT EXISTS stock_clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    UUID REFERENCES stocks(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT,
  qty         NUMERIC DEFAULT 0,
  cost        NUMERIC DEFAULT 0,
  value       NUMERIC DEFAULT 0,
  pnl         NUMERIC DEFAULT 0,
  pnl_pct     NUMERIC DEFAULT 0,
  allocation_pct NUMERIC DEFAULT 0,
  upload_id   UUID REFERENCES upload_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sc_stock ON stock_clients(stock_id);
CREATE INDEX IF NOT EXISTS idx_sc_upload ON stock_clients(upload_id);

-- SECTOR LIMITS (user-configurable, persisted server-side)
CREATE TABLE IF NOT EXISTS sector_limits (
  sector   TEXT PRIMARY KEY,
  pct      NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert defaults
INSERT INTO sector_limits (sector, pct) VALUES
  ('Defence Manufacturing', 0.25),
  ('Precious Metals',       0.25),
  ('Infrastructure',        0.20),
  ('BFSI',                  0.20),
  ('Energy',                0.20),
  ('default',               0.15)
ON CONFLICT (sector) DO NOTHING;

-- STOCK TAGS (user-managed sector/mcap overrides)
CREATE TABLE IF NOT EXISTS stock_tags (
  symbol     TEXT PRIMARY KEY,
  sector     TEXT,
  mcap       TEXT,
  hidden     BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LATEST UPLOAD VIEW (helper)
CREATE OR REPLACE VIEW latest_upload AS
  SELECT * FROM upload_logs
  WHERE status = 'success'
  ORDER BY uploaded_at DESC
  LIMIT 1;
