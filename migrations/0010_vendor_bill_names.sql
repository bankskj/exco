-- Vendor name denormalised onto stored bills so the monthly expense log
-- can render without a Xero call.
ALTER TABLE vendor_bills ADD COLUMN vendor_name TEXT NOT NULL DEFAULT '';

UPDATE app_meta SET value = '10' WHERE key = 'schema_version';
