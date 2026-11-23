-- Due date on synced Xero documents: places open sales invoices in the
-- forecast month they are expected to be paid. Filled on the next sync.
ALTER TABLE xero_txns ADD COLUMN due_date TEXT;

UPDATE app_meta SET value = '26' WHERE key = 'schema_version';
