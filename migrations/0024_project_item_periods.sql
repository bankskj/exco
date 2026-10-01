-- Project allocation imports are period-aware: a single-month export tags its
-- lines to that month, and imports for different periods accumulate.
ALTER TABLE xero_project_items ADD COLUMN period_label TEXT NOT NULL DEFAULT '';
ALTER TABLE xero_project_items ADD COLUMN period_month TEXT NOT NULL DEFAULT '';
