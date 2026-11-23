-- Client Billing & Cost Allocation module (docs/client-billing.md).
-- Money columns are INTEGER cents (*_c); periods are TEXT 'YYYY-MM'; ids uuid TEXT.
-- The existing employees table is reused as the staff register.

-- ==========================================================================
-- Reporting clients (12) and their projects
-- ==========================================================================

CREATE TABLE clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  short_name  TEXT,
  is_general  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Xero contact -> reporting client
CREATE TABLE client_contacts (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  xero_contact_id TEXT UNIQUE,
  contact_name    TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE projects (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(id),
  name             TEXT NOT NULL,
  code             TEXT,
  is_default       INTEGER NOT NULL DEFAULT 0,
  billing_type     TEXT NOT NULL DEFAULT 'retainer', -- fixed|retainer|time|recurring
  contract_value_c INTEGER,
  start_period     TEXT,
  end_period       TEXT,
  status           TEXT NOT NULL DEFAULT 'open',     -- open|closed
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  UNIQUE (client_id, name)
);
CREATE UNIQUE INDEX ux_projects_default ON projects(client_id) WHERE is_default = 1;

CREATE TABLE project_budgets (
  project_id TEXT NOT NULL REFERENCES projects(id),
  period     TEXT NOT NULL,
  revenue_c  INTEGER NOT NULL DEFAULT 0,
  cost_c     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, period)
);

-- ==========================================================================
-- Chart of accounts mapping
-- ==========================================================================

CREATE TABLE gl_categories (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- revenue|cost
  report_group TEXT NOT NULL,          -- e.g. 'Projects / Development', 'Hosting & Infra'
  treatment    TEXT NOT NULL,          -- revenue: revenue|excluded ; cost: people|direct|overhead|excluded
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

-- ==========================================================================
-- Staff (extends employees)
-- ==========================================================================

ALTER TABLE employees ADD COLUMN default_target TEXT NOT NULL DEFAULT 'general'; -- general|overhead
ALTER TABLE employees ADD COLUMN loading_pct REAL NOT NULL DEFAULT 0;            -- payroll-estimate uplift

-- payee text in Xero -> staff member
CREATE TABLE staff_payees (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  match_text  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  match_mode  TEXT NOT NULL DEFAULT 'contains' -- exact|contains
);

-- one row per target; carried forward if a month has none
CREATE TABLE staff_allocations (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  period      TEXT NOT NULL,
  target_kind TEXT NOT NULL,           -- project|overhead
  project_id  TEXT REFERENCES projects(id),
  pct         REAL NOT NULL CHECK (pct > 0 AND pct <= 100)
);
CREATE UNIQUE INDEX ux_staff_alloc ON staff_allocations
  (employee_id, period, target_kind, IFNULL(project_id, ''));

-- ==========================================================================
-- Ledgers, assignment and rules
-- ==========================================================================

-- Revenue: one row per sales invoice / credit note LINE
CREATE TABLE revenue_lines (
  id              TEXT PRIMARY KEY,
  period          TEXT NOT NULL,
  txn_date        TEXT NOT NULL,
  source          TEXT NOT NULL,        -- xero|csv|manual
  source_ref      TEXT UNIQUE,          -- Xero LineItemID (idempotent upsert key)
  xero_doc_id     TEXT,
  doc_number      TEXT,
  doc_type        TEXT,                 -- ACCREC|ACCRECCREDIT|RECEIVE
  contact_name    TEXT,
  xero_contact_id TEXT,
  client_id       TEXT REFERENCES clients(id),   -- resolved via client_contacts at sync
  project_id      TEXT REFERENCES projects(id),  -- manual override; NULL = client default
  gl_code         TEXT REFERENCES gl_categories(code),
  description     TEXT,
  amount_c        INTEGER NOT NULL,     -- excl VAT, ZAR; credit notes negative
  currency        TEXT DEFAULT 'ZAR',
  fx_rate         REAL,
  amount_fx_c     INTEGER,
  status          TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_rev_period ON revenue_lines(period);

-- Costs: one row per bill line or bank SPEND line
CREATE TABLE cost_lines (
  id          TEXT PRIMARY KEY,
  period      TEXT NOT NULL,
  txn_date    TEXT NOT NULL,
  source      TEXT NOT NULL,            -- xero|csv|manual
  source_ref  TEXT UNIQUE,              -- Xero LineItemID
  xero_doc_id TEXT,
  doc_kind    TEXT,                     -- bill|spend
  supplier    TEXT,
  reference   TEXT,
  description TEXT,
  gl_code     TEXT REFERENCES gl_categories(code),
  employee_id TEXT REFERENCES employees(id), -- set when payee matches staff_payees
  amount_c    INTEGER NOT NULL,
  currency    TEXT DEFAULT 'ZAR',
  fx_rate     REAL,
  amount_fx_c INTEGER,
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_cost_period ON cost_lines(period);

-- Manual assignment of a cost line (overrides rules)
CREATE TABLE cost_splits (
  id           TEXT PRIMARY KEY,
  cost_line_id TEXT NOT NULL REFERENCES cost_lines(id) ON DELETE CASCADE,
  target_kind  TEXT NOT NULL,           -- project|overhead|excluded
  project_id   TEXT REFERENCES projects(id),
  pct          REAL NOT NULL
);

-- Saved rules for recurring provider bills
CREATE TABLE cost_rules (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100,
  supplier_match    TEXT,               -- all given must match (case-insensitive contains)
  description_match TEXT,
  gl_code           TEXT,
  mode              TEXT NOT NULL,      -- percent|fixed
  effective_from    TEXT,
  effective_to      TEXT,
  active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cost_rule_splits (
  id           TEXT PRIMARY KEY,
  rule_id      TEXT NOT NULL REFERENCES cost_rules(id) ON DELETE CASCADE,
  target_kind  TEXT NOT NULL,           -- project|overhead
  project_id   TEXT REFERENCES projects(id),
  pct          REAL,
  fixed_c      INTEGER,
  is_remainder INTEGER NOT NULL DEFAULT 0
);

-- ==========================================================================
-- Period control, overhead basis, snapshots, audit
-- ==========================================================================

CREATE TABLE billing_periods (
  period         TEXT PRIMARY KEY,
  overhead_basis TEXT NOT NULL DEFAULT 'revenue', -- revenue|direct_cost|fixed
  status         TEXT NOT NULL DEFAULT 'open',    -- open|closed
  closed_at      TEXT,
  notes          TEXT
);

CREATE TABLE overhead_fixed_shares (
  period    TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  pct       REAL NOT NULL,
  PRIMARY KEY (period, client_id)
);

-- frozen PeriodResult at close
CREATE TABLE period_snapshots (
  period      TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE billing_audit (
  id          TEXT PRIMARY KEY,
  at          TEXT DEFAULT (datetime('now')),
  actor       TEXT,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT
);

UPDATE app_meta SET value = '25' WHERE key = 'schema_version';
