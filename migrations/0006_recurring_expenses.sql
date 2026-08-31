-- Recurring expenses tracker. Rows come from manual capture or Xero sync
-- (Repeating Invoices of type ACCPAY = repeating bills).

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id              TEXT PRIMARY KEY,          -- uuid
  name            TEXT NOT NULL,             -- what it is (e.g. 'Google Workspace')
  vendor          TEXT,
  category        TEXT,
  amount          REAL NOT NULL DEFAULT 0,   -- per occurrence, incl tax
  frequency       TEXT NOT NULL DEFAULT 'monthly',
                  -- 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual'
  interval_months REAL NOT NULL DEFAULT 1,   -- occurrence interval in months (weekly ≈ 12/52)
  next_date       TEXT,                      -- next occurrence 'YYYY-MM-DD'
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'xero'
  xero_id         TEXT UNIQUE,               -- Xero RepeatingInvoiceID
  currency        TEXT NOT NULL DEFAULT 'ZAR',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Xero connection state lives in app_meta:
--   xero_refresh_token, xero_access_token, xero_access_expires (unix ms),
--   xero_tenant_id, xero_org_name, xero_last_sync

UPDATE app_meta SET value = '6' WHERE key = 'schema_version';
