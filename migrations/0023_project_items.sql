-- Allocation line items from the Xero "Project Financials" export (the API
-- doesn't expose them) — keyed by project name to match the grouped view.
CREATE TABLE xero_project_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  item_type TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  charge REAL NOT NULL DEFAULT 0,
  invoiced REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_project_items_name ON xero_project_items (project_name);
