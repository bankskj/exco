-- Debtors by billing month (invoice cohorts), refreshed on sync:
-- billed = sum of ACCREC invoice totals raised that month,
-- paid   = amount of those invoices collected so far,
-- due    = still outstanding today.
CREATE TABLE IF NOT EXISTS cf_debtors (
  month      TEXT PRIMARY KEY,
  billed     REAL NOT NULL DEFAULT 0,
  paid       REAL NOT NULL DEFAULT 0,
  due        REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
UPDATE app_meta SET value = '13' WHERE key = 'schema_version';
