-- When a payroll employee is made inactive, record the date: the capture
-- grid blanks months after it and forecasts exclude them.
ALTER TABLE employees ADD COLUMN inactive_date TEXT;
UPDATE app_meta SET value = '17' WHERE key = 'schema_version';
