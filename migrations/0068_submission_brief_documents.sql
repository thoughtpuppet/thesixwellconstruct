CREATE TABLE IF NOT EXISTS document_template_revisions (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  content_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  UNIQUE(template_key, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_template_one_draft
  ON document_template_revisions(template_key) WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS document_template_one_published
  ON document_template_revisions(template_key) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS document_template_history
  ON document_template_revisions(template_key, revision DESC);

CREATE TABLE IF NOT EXISTS submission_brief_documents (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('build', 'maze')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  template_key TEXT NOT NULL,
  template_revision INTEGER NOT NULL DEFAULT 0,
  template_snapshot_json TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  storage_key TEXT,
  file_name TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size INTEGER,
  content_sha256 TEXT,
  client_access_status TEXT NOT NULL DEFAULT 'disabled' CHECK (client_access_status IN ('active', 'revoked', 'disabled')),
  access_version INTEGER NOT NULL DEFAULT 1 CHECK (access_version > 0),
  failure_message TEXT,
  generated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  UNIQUE(submission_id, document_kind)
);

CREATE INDEX IF NOT EXISTS submission_brief_documents_submission
  ON submission_brief_documents(submission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS submission_brief_documents_status
  ON submission_brief_documents(status, updated_at DESC);
