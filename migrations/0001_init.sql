-- Exco initial schema
-- Foundational tables only. Accounts / Payroll / HR domain tables are added
-- in later migrations when we build each section's functionality.

-- Simple key/value store for app-level metadata & settings.
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Central registry of files stored in the R2 bucket (exco-uploads).
-- Rows here link an uploaded object to whatever record references it.
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,               -- uuid
  r2_key      TEXT NOT NULL UNIQUE,           -- object key in the R2 bucket
  filename    TEXT NOT NULL,
  content_type TEXT,
  size_bytes  INTEGER,
  section     TEXT,                           -- 'accounts' | 'payroll' | 'hr'
  ref_id      TEXT,                           -- id of the record it belongs to
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_section_ref ON documents (section, ref_id);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1');
