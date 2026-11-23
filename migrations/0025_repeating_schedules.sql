-- Xero repeating-invoice schedules (sales ACCREC + bills ACCPAY), refreshed
-- daily. Future invoices are projected from these at read time, so the
-- forecast always rolls forward from today without a re-sync.
CREATE TABLE IF NOT EXISTS xero_repeating (
  xero_id      TEXT PRIMARY KEY,          -- RepeatingInvoiceID
  type         TEXT NOT NULL,             -- 'ACCREC' (sales) | 'ACCPAY' (bills)
  status       TEXT NOT NULL,             -- 'AUTHORISED' | 'DRAFT' (creates drafts → lower confidence)
  contact      TEXT,
  reference    TEXT,
  sub_total    REAL NOT NULL DEFAULT 0,   -- per invoice, excl VAT (matches the P&L basis)
  total        REAL NOT NULL DEFAULT 0,   -- per invoice, incl VAT
  currency     TEXT NOT NULL DEFAULT 'ZAR',
  unit         TEXT NOT NULL,             -- 'WEEKLY' | 'MONTHLY'
  period       INTEGER NOT NULL DEFAULT 1,
  next_date    TEXT,                      -- next scheduled invoice date 'YYYY-MM-DD'
  end_date     TEXT,                      -- schedule end, NULL = open-ended
  due_day      INTEGER,                   -- payment terms: day number
  due_type     TEXT,                      -- DAYSAFTERBILLDATE | DAYSAFTERBILLMONTH | OFCURRENTMONTH | OFFOLLOWINGMONTH
  synced_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE app_meta SET value = '25' WHERE key = 'schema_version';
