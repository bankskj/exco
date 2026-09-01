-- Deal-level references: quote number, invoice number, and the deal date.
ALTER TABLE commissions ADD COLUMN quote_no TEXT;
ALTER TABLE commissions ADD COLUMN invoice_no TEXT;
ALTER TABLE commissions ADD COLUMN deal_date TEXT;  -- 'YYYY-MM-DD'
UPDATE app_meta SET value = '15' WHERE key = 'schema_version';
