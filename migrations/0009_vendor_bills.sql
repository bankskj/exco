-- Bill-level history per vendor, refreshed on every Xero sync. Powers the
-- per-vendor history drawer and the mid-month / month-end billing pattern.
CREATE TABLE IF NOT EXISTS vendor_bills (
  id         TEXT PRIMARY KEY,   -- uuid
  vendor_key TEXT NOT NULL,      -- Xero ContactID
  bill_date  TEXT NOT NULL,      -- 'YYYY-MM-DD'
  amount     REAL NOT NULL,
  reference  TEXT,               -- invoice number / reference
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_bills_key ON vendor_bills (vendor_key, bill_date);

UPDATE app_meta SET value = '9' WHERE key = 'schema_version';
