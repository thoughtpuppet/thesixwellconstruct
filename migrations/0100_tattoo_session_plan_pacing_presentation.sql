-- Studio explicitly controls which optional pacing prompts a client sees.
-- NULL preserves the legacy behavior for existing plans by deriving the
-- presentation from the appointment types approved for that client.

ALTER TABLE tattoo_session_plans
  ADD COLUMN present_longer_session_option INTEGER
  CHECK (present_longer_session_option IS NULL OR present_longer_session_option IN (0,1));

ALTER TABLE tattoo_session_plans
  ADD COLUMN present_shorter_sessions_option INTEGER
  CHECK (present_shorter_sessions_option IS NULL OR present_shorter_sessions_option IN (0,1));
