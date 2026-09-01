-- Commission tracking: deals move Quote -> PO -> Invoice -> Paid; each deal
-- carries a ledger of transaction lines (the exec's spreadsheet columns).
CREATE TABLE IF NOT EXISTS commissions (
  id         TEXT PRIMARY KEY,   -- uuid
  staff      TEXT NOT NULL,      -- who earns the commission
  allocation TEXT NOT NULL,      -- what it's for, e.g. 'SAP Analyst - Bonus'
  client     TEXT,               -- e.g. 'Illovo'
  po_number  TEXT,               -- client PO
  comm_pct   REAL,               -- commission % of paid value (nullable = fixed amounts in lines)
  stage      TEXT NOT NULL DEFAULT 'quote',  -- 'quote' | 'po' | 'invoice' | 'paid'
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commission_lines (
  id            TEXT PRIMARY KEY,  -- uuid
  commission_id TEXT NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  tx_date       TEXT,              -- 'YYYY-MM-DD'
  reference     TEXT,
  tx_type       TEXT,              -- Quote / Purchase Order / Supplier Invoice / Customer Invoice / Payment / Credit
  allocation    TEXT,
  po_number     TEXT,
  description   TEXT,
  payment       REAL NOT NULL DEFAULT 0,   -- money paid out/received against the deal
  invoice       REAL NOT NULL DEFAULT 0,   -- invoiced value
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comm_lines ON commission_lines (commission_id, tx_date);

UPDATE app_meta SET value = '14' WHERE key = 'schema_version';
