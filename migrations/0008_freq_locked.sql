-- Manual frequency override protection: when a user sets a row's frequency,
-- lock it so the monthly Xero sync doesn't overwrite their judgement.
ALTER TABLE recurring_expenses ADD COLUMN freq_locked INTEGER NOT NULL DEFAULT 0;

UPDATE app_meta SET value = '8' WHERE key = 'schema_version';
