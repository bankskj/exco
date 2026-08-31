-- P&L-derived monthly actuals, refreshed on every Xero sync. This is the
-- single source of truth the cashflow screens read for past months, so
-- Cashflow, Income and the Xero dashboard all agree by construction.
CREATE TABLE IF NOT EXISTS cf_actuals (
  month      TEXT PRIMARY KEY,  -- 'YYYY-MM'
  income     REAL NOT NULL DEFAULT 0,  -- Total income (P&L)
  staff      REAL NOT NULL DEFAULT 0,  -- salaries/wages/PAYE/UIF... accounts
  dev        REAL NOT NULL DEFAULT 0,  -- developer/contractor/freelance/consulting accounts
  other      REAL NOT NULL DEFAULT 0,  -- all remaining expense accounts (COS + opex)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE app_meta SET value = '11' WHERE key = 'schema_version';
