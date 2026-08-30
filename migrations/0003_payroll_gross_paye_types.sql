-- Payroll: employee types + gross/PAYE/nett split.
--
-- Employee type drives PAYE: only 'za' employees have PAYE (tax);
-- 'international' and 'freelancer' have no PAYE (nett = gross).
--
-- payroll_entries previously stored a single `amount` = the gross/CTC figure
-- from the sheet. We rename it to `gross` and add `paye`; nett is derived
-- (gross - paye) at read time.

ALTER TABLE employees ADD COLUMN type TEXT NOT NULL DEFAULT 'za';  -- 'za' | 'international' | 'freelancer'

ALTER TABLE payroll_entries RENAME COLUMN amount TO gross;
ALTER TABLE payroll_entries ADD COLUMN paye REAL NOT NULL DEFAULT 0;

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '3');
