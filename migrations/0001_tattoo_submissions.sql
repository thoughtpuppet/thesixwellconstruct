CREATE TABLE IF NOT EXISTS tattoo_submissions (
  id TEXT PRIMARY KEY,
  form_type TEXT NOT NULL CHECK (form_type IN ('standard', 'flash', 'special_project')),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'approved', 'rejected', 'archived')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  pronouns TEXT,
  instagram TEXT,
  placement TEXT,
  size TEXT,
  budget_range TEXT,
  timeline TEXT,
  project_title TEXT,
  reference_urls TEXT,
  message TEXT NOT NULL,
  source_path TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tattoo_submissions_status_created
  ON tattoo_submissions (status, created_at);

CREATE INDEX IF NOT EXISTS idx_tattoo_submissions_email
  ON tattoo_submissions (email);

CREATE TABLE IF NOT EXISTS tattoo_action_tokens (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES tattoo_submissions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tattoo_action_tokens_submission
  ON tattoo_action_tokens (submission_id);

CREATE TABLE IF NOT EXISTS tattoo_booking_tokens (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  appointment_type_id TEXT,
  acuity_url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES tattoo_submissions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tattoo_booking_tokens_submission
  ON tattoo_booking_tokens (submission_id);

CREATE TABLE IF NOT EXISTS tattoo_audit_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES tattoo_submissions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tattoo_audit_events_submission_created
  ON tattoo_audit_events (submission_id, created_at);
