-- Per-vendor tracking rules for the Xero recurring-expense detection.
--   rule 'track'   → always import this vendor (even under the 3-month threshold)
--   rule 'exclude' → never import (and remove any synced row); reason records why
-- Vendors with no rule follow the default: billed in 3+ of the last 6 months.

CREATE TABLE IF NOT EXISTS vendor_rules (
  vendor_key TEXT PRIMARY KEY,  -- Xero ContactID
  name       TEXT NOT NULL,
  rule       TEXT NOT NULL,     -- 'track' | 'exclude'
  reason     TEXT,              -- 'manual' | 'payroll match' | 'contractor prefix'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE app_meta SET value = '7' WHERE key = 'schema_version';
