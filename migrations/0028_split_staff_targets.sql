-- Cost splits and rule splits can target a STAFF MEMBER: the piece becomes
-- that person's people cost and spreads via their share % — e.g. one batch
-- salary EFT split across several staff, saved as a monthly rule.
ALTER TABLE cost_splits ADD COLUMN employee_id TEXT REFERENCES employees(id);
ALTER TABLE cost_rule_splits ADD COLUMN employee_id TEXT REFERENCES employees(id);
UPDATE app_meta SET value = '28' WHERE key = 'schema_version';
