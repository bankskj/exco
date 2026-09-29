-- Xero Projects: lifetime totals per project, task detail, and month-end
-- snapshots (each sync stores cumulatives; month deltas build the monthly view).
CREATE TABLE xero_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'ZAR',
  estimate REAL,
  minutes_logged INTEGER NOT NULL DEFAULT 0,
  task_amount REAL NOT NULL DEFAULT 0,
  expense_amount REAL NOT NULL DEFAULT 0,
  invoiced REAL NOT NULL DEFAULT 0,
  to_be_invoiced REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE xero_project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  charge_type TEXT NOT NULL DEFAULT '',
  rate REAL NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  amount_invoiced REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_project_tasks ON xero_project_tasks (project_id);
CREATE TABLE xero_project_snapshots (
  project_id TEXT NOT NULL,
  month TEXT NOT NULL, -- YYYY-MM of the sync that recorded these cumulatives
  charge REAL NOT NULL DEFAULT 0, -- task + expense charge, cumulative
  invoiced REAL NOT NULL DEFAULT 0, -- cumulative
  PRIMARY KEY (project_id, month)
);
