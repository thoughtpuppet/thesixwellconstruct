CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  source_path TEXT,
  subject TEXT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  contact_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  request_meta_json TEXT NOT NULL DEFAULT '{}',
  files_json TEXT NOT NULL DEFAULT '[]',
  internal_notes TEXT NOT NULL DEFAULT '',
  booking_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON submissions(created_at);

CREATE INDEX IF NOT EXISTS idx_submissions_status_created_at
  ON submissions(status, created_at);

CREATE INDEX IF NOT EXISTS idx_submissions_type_created_at
  ON submissions(type, created_at);

CREATE INDEX IF NOT EXISTS idx_submissions_contact_email
  ON submissions(contact_email);

CREATE TABLE IF NOT EXISTS submission_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_events_submission_created_at
  ON submission_events(submission_id, created_at);
