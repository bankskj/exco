-- HR: employee registry + per-employee history (notes/warnings/achievements/contracts).
-- File attachments live in R2 and are registered in the existing `documents` table
-- with section='hr' and ref_id = the note id.

CREATE TABLE IF NOT EXISTS hr_employees (
  id          TEXT PRIMARY KEY,            -- uuid
  name        TEXT NOT NULL,
  email       TEXT,
  position    TEXT,
  team        TEXT,
  manager     TEXT,
  employee_no TEXT,
  start_date  TEXT,                        -- 'YYYY-MM-DD'
  end_date    TEXT,                        -- last working day; NULL = active
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_emp_team ON hr_employees (team);

-- Timeline entries on an employee's file.
CREATE TABLE IF NOT EXISTS hr_notes (
  id          TEXT PRIMARY KEY,            -- uuid
  employee_id TEXT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'note',
              -- 'note' | 'achievement' | 'verbal_warning' | 'written_warning' | 'change' | 'contract'
  title       TEXT NOT NULL,
  body        TEXT,
  note_date   TEXT,                        -- date of the event, 'YYYY-MM-DD'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_notes_emp ON hr_notes (employee_id, note_date);

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
