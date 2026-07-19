CREATE TABLE IF NOT EXISTS tattoo_build_drafts (
  id TEXT PRIMARY KEY,
  draft_kind TEXT NOT NULL CHECK (draft_kind IN ('build_brief', 'maze_design')),
  owner_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'submitted', 'revoked', 'expired')),
  submission_id TEXT,
  expires_at TEXT NOT NULL,
  last_emailed_at TEXT,
  submitted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tattoo_build_drafts_token
  ON tattoo_build_drafts(token_hash);

CREATE INDEX IF NOT EXISTS idx_tattoo_build_drafts_owner
  ON tattoo_build_drafts(owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tattoo_build_drafts_expiry
  ON tattoo_build_drafts(status, expires_at);

CREATE TABLE IF NOT EXISTS tattoo_build_draft_email_attempts (
  id TEXT PRIMARY KEY,
  draft_id TEXT,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES tattoo_build_drafts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tattoo_build_draft_attempt_email
  ON tattoo_build_draft_email_attempts(email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tattoo_build_draft_attempt_ip
  ON tattoo_build_draft_email_attempts(ip_hash, created_at DESC);
