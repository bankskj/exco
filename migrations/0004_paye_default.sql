-- Employee-level default PAYE: the standard monthly tax amount for ZA staff.
-- Used to pre-fill the monthly PAYE capture grid; per-month values still win.
ALTER TABLE employees ADD COLUMN paye_default REAL NOT NULL DEFAULT 0;

UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
