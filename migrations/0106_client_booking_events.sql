CREATE TABLE IF NOT EXISTS booking_client_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  submission_id TEXT NOT NULL,
  booking_token_id TEXT,
  appointment_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('booking_link_opened', 'square_checkout_redirected')
  ),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_token_id) REFERENCES booking_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_client_events_submission_created
  ON booking_client_events(submission_id, created_at);

CREATE INDEX IF NOT EXISTS idx_booking_client_events_token_created
  ON booking_client_events(booking_token_id, created_at);

CREATE INDEX IF NOT EXISTS idx_booking_client_events_appointment_created
  ON booking_client_events(appointment_id, created_at);
