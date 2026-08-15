-- Optional Acuity-style multi-session private booking links.
-- A client can select several dates for one appointment type and pay all
-- per-session deposits through one Square checkout. Each date remains its own
-- appointment after payment.

ALTER TABLE booking_tokens ADD COLUMN allow_multiple_sessions INTEGER NOT NULL DEFAULT 0
  CHECK (allow_multiple_sessions IN (0, 1));

ALTER TABLE booking_tokens ADD COLUMN max_sessions INTEGER NOT NULL DEFAULT 1
  CHECK (max_sessions BETWEEN 1 AND 24);

ALTER TABLE tattoo_session_plans ADD COLUMN booking_allow_multiple_sessions INTEGER;

ALTER TABLE tattoo_session_plans ADD COLUMN booking_max_sessions INTEGER;

ALTER TABLE appointments ADD COLUMN checkout_group_id TEXT;

ALTER TABLE appointments ADD COLUMN checkout_group_position INTEGER NOT NULL DEFAULT 1
  CHECK (checkout_group_position >= 1);

ALTER TABLE appointments ADD COLUMN checkout_group_size INTEGER NOT NULL DEFAULT 1
  CHECK (checkout_group_size BETWEEN 1 AND 24);

UPDATE appointments
SET checkout_group_id = id
WHERE checkout_group_id IS NULL;

DROP INDEX IF EXISTS idx_appointments_one_active_token_hold;
DROP INDEX IF EXISTS idx_appointments_one_active_submission_hold;

-- The first appointment is the checkout-group guard. Later positions belong
-- to the same guarded checkout and can coexist without permitting a parallel
-- checkout for the token or submission.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_token_hold
  ON appointments(booking_token_id)
  WHERE booking_token_id IS NOT NULL
    AND checkout_group_position = 1
    AND status IN ('pending_deposit','deposit_pending')
    AND hold_state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_submission_hold
  ON appointments(submission_id, purpose)
  WHERE submission_id IS NOT NULL
    AND replacement_for_appointment_id IS NULL
    AND checkout_group_position = 1
    AND status IN ('pending_deposit','deposit_pending')
    AND hold_state = 'active';

CREATE INDEX IF NOT EXISTS idx_appointments_checkout_group
  ON appointments(checkout_group_id, checkout_group_position);
