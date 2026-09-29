-- Pipeline → forecast must be controlled: a deal only feeds the cash forecast
-- when explicitly included (defaults on to preserve current behaviour).
ALTER TABLE commissions ADD COLUMN include_forecast INTEGER NOT NULL DEFAULT 1;
