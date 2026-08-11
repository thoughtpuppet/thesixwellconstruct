CREATE TABLE IF NOT EXISTS maze_submission_revisions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  files_json TEXT NOT NULL DEFAULT '[]',
  maze_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  UNIQUE (submission_id, revision_number),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_maze_submission_revisions_submission
  ON maze_submission_revisions(submission_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS maze_submission_edit_tokens (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_maze_submission_edit_tokens_status
  ON maze_submission_edit_tokens(status, updated_at DESC);

ALTER TABLE maze_archive_entries ADD COLUMN source_revision_number INTEGER;

UPDATE document_template_revisions
SET content_json = json_set(
      content_json,
      '$.copy.intro',
      'A record of the submitted Maze image, optional meaning and description, and practical details provided for Studio review.',
      '$.copy.compositionHeading',
      'Meaning and description'
    ),
    updated_at = datetime('now')
WHERE template_key = 'tattoo_maze_brief_pdf'
  AND status IN ('draft', 'published');
