-- Expected payment date on a deal: feeds the cashflow forecast as pipeline income.
ALTER TABLE commissions ADD COLUMN expected_payment TEXT;
