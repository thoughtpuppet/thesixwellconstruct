CREATE TABLE IF NOT EXISTS email_design_revisions (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  profile_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS email_design_one_draft
  ON email_design_revisions(status) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS email_design_one_published
  ON email_design_revisions(status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS email_design_history
  ON email_design_revisions(revision DESC);

ALTER TABLE notification_deliveries ADD COLUMN email_design_revision INTEGER NOT NULL DEFAULT 0;
