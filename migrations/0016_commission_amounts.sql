-- Commission economics: invoice nett (the base commission is paid on) and an
-- editable commission amount (blank = comm_pct x invoice_nett).
ALTER TABLE commissions ADD COLUMN invoice_nett REAL;
ALTER TABLE commissions ADD COLUMN comm_amount REAL;
UPDATE app_meta SET value = '16' WHERE key = 'schema_version';
