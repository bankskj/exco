-- Payment dates on synced sales invoices, so cash already received in the
-- current (not yet closed) month counts in the forecast.
ALTER TABLE xero_txns ADD COLUMN paid_on TEXT;     -- FullyPaidOnDate 'YYYY-MM-DD'
ALTER TABLE xero_txns ADD COLUMN payments TEXT;    -- JSON [{"date":"YYYY-MM-DD","amount":n}] incl VAT

UPDATE app_meta SET value = '27' WHERE key = 'schema_version';
