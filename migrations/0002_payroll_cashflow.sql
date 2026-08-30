-- Exco: Payroll + Cashflow (Accounts) domain model
-- Normalized (line-item x month) so we can capture, edit, total, trend, and forecast.

-- ==========================================================================
-- PAYROLL
-- ==========================================================================

CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,            -- uuid
  name        TEXT NOT NULL,
  mentor      TEXT,                        -- director / mentor (Kevin, Walter, Dom, Tania, Danie...)
  ctc         REAL,                        -- gross salary / CTC baseline (monthly)
  status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'inactive'
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One editable pay amount per employee per month.
CREATE TABLE IF NOT EXISTS payroll_entries (
  id          TEXT PRIMARY KEY,            -- uuid
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,               -- 'YYYY-MM'
  amount      REAL NOT NULL DEFAULT 0,
  note        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_entries (period);
CREATE INDEX IF NOT EXISTS idx_payroll_emp    ON payroll_entries (employee_id);

-- ==========================================================================
-- CASHFLOW (Accounts)
-- ==========================================================================

-- Line items. kind drives whether a value adds to income or subtracts as a cost.
CREATE TABLE IF NOT EXISTS cf_categories (
  id           TEXT PRIMARY KEY,           -- uuid
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- 'income' | 'cost'
  grp          TEXT,                        -- grouping label (e.g. 'Operating costs', 'Recurring income', 'Pipeline')
  is_recurring INTEGER NOT NULL DEFAULT 0, -- 1 => forecast auto-carries the last known value forward
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One value per line item per month, flagged actual vs forecast.
CREATE TABLE IF NOT EXISTS cf_entries (
  id          TEXT PRIMARY KEY,            -- uuid
  category_id TEXT NOT NULL REFERENCES cf_categories(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,               -- 'YYYY-MM'
  amount      REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'actual',  -- 'actual' | 'forecast'
  note        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category_id, period)
);

CREATE INDEX IF NOT EXISTS idx_cf_period ON cf_entries (period);
CREATE INDEX IF NOT EXISTS idx_cf_cat    ON cf_entries (category_id);

-- App settings used by cashflow (opening balance, scenario knobs, fiscal start).
-- Stored in the existing app_meta key/value table:
--   cf_opening_balance   : opening cash on hand (number)
--   cf_opening_period    : 'YYYY-MM' the opening balance applies at the start of
--   cf_horizon_months    : how many months to forecast forward (default 12)
--   cf_best_income_pct / cf_best_cost_pct   : best-case scenario adjustments (%)
--   cf_worst_income_pct / cf_worst_cost_pct : worst-case scenario adjustments (%)
INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('cf_opening_balance', '1000000'),
  ('cf_opening_period',  '2025-03'),
  ('cf_actuals_through', '2026-02'),
  ('cf_horizon_months',  '12'),
  ('cf_best_income_pct', '10'),
  ('cf_best_cost_pct',   '5'),
  ('cf_worst_income_pct','15'),
  ('cf_worst_cost_pct',  '10'),
  ('schema_version',     '2');

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
