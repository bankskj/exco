-- Raw Xero transactions for the Actuals tab: sales invoices (ACCREC),
-- supplier bills (ACCPAY) and spend-money bank transactions, unfiltered.
CREATE TABLE xero_txns (
  id TEXT PRIMARY KEY,              -- Xero InvoiceID / BankTransactionID
  kind TEXT NOT NULL,               -- 'sale' | 'bill' | 'spend'
  txn_date TEXT NOT NULL,           -- YYYY-MM-DD
  contact TEXT,
  reference TEXT,
  sub_total REAL NOT NULL DEFAULT 0, -- excl VAT (comparable to the P&L)
  total REAL NOT NULL DEFAULT 0,     -- incl VAT
  amount_due REAL NOT NULL DEFAULT 0,
  status TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_xero_txns_date ON xero_txns (txn_date);
