-- The client's submitted comfort range remains in the submission payload.
-- This reviewed dollar range belongs to the final tattoo session plan.

ALTER TABLE tattoo_session_plans ADD COLUMN approved_budget_min_cents INTEGER
  CHECK (approved_budget_min_cents IS NULL OR approved_budget_min_cents > 0);
ALTER TABLE tattoo_session_plans ADD COLUMN approved_budget_max_cents INTEGER
  CHECK (approved_budget_max_cents IS NULL OR approved_budget_max_cents > 0);
ALTER TABLE tattoo_session_plans ADD COLUMN approved_budget_currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (approved_budget_currency = 'USD');
ALTER TABLE tattoo_session_plans ADD COLUMN budget_acknowledged INTEGER NOT NULL DEFAULT 0
  CHECK (budget_acknowledged IN (0,1));
ALTER TABLE tattoo_session_plans ADD COLUMN budget_acknowledged_at TEXT;
