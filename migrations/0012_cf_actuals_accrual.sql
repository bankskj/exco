-- Store both P&L bases per month: cash (paymentsOnly — drives the live
-- cashflow model) and accrual (matches Xero's default P&L reports).
ALTER TABLE cf_actuals ADD COLUMN income_accr REAL NOT NULL DEFAULT 0;
ALTER TABLE cf_actuals ADD COLUMN staff_accr REAL NOT NULL DEFAULT 0;
ALTER TABLE cf_actuals ADD COLUMN dev_accr REAL NOT NULL DEFAULT 0;
ALTER TABLE cf_actuals ADD COLUMN other_accr REAL NOT NULL DEFAULT 0;

UPDATE app_meta SET value = '12' WHERE key = 'schema_version';
