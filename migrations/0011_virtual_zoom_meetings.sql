INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at
) VALUES (
  'consult_virtual', 'tattooing', 'Virtual Consultation',
  'A public video-call consultation for placement, cover-up review, or project planning before a tattoo date is set.',
  45, 2000, 'USD', 1, 7, datetime('now'), datetime('now')
);

CREATE TABLE IF NOT EXISTS appointment_meetings (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'zoom',
  provider_meeting_id TEXT,
  join_url TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  UNIQUE (appointment_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_appointment_meetings_appointment
  ON appointment_meetings(appointment_id, provider);
