-- Separate internal review work, recorded decisions, and explicit client communication.
-- Historical notification and SMS consent records remain untouched.

ALTER TABLE submissions ADD COLUMN decision_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN decided_at TEXT;
ALTER TABLE submissions ADD COLUMN decision_client_message TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_submissions_decision_revision
  ON submissions(id, decision_revision);
