-- Studio controls whether the optional additional-sketch policy appears in a
-- client's reviewed tattoo budget. Existing and new plans default to omitted.

ALTER TABLE tattoo_session_plans
  ADD COLUMN include_additional_sketch_disclaimer INTEGER NOT NULL DEFAULT 0
  CHECK (include_additional_sketch_disclaimer IN (0,1));
