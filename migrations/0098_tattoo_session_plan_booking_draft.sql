-- Persist Studio booking-link choices with the reviewed tattoo session plan.
-- These are draft controls only; saving them does not create access or notify a client.

ALTER TABLE tattoo_session_plans ADD COLUMN booking_purpose TEXT;

ALTER TABLE tattoo_session_plans ADD COLUMN allowed_booking_types_json TEXT;

ALTER TABLE tattoo_session_plans ADD COLUMN booking_link_expires_at TEXT;

ALTER TABLE tattoo_session_plans ADD COLUMN booking_link_revoke_existing INTEGER;
