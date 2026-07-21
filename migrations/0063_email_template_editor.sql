CREATE TABLE IF NOT EXISTS email_template_revisions (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'default',
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  content_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  UNIQUE(template_key, variant, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_template_one_draft
  ON email_template_revisions(template_key, variant) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS email_template_one_published
  ON email_template_revisions(template_key, variant) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS email_template_history
  ON email_template_revisions(template_key, variant, revision DESC);

ALTER TABLE notification_deliveries ADD COLUMN template_variant TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notification_deliveries ADD COLUMN template_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN email_theme TEXT NOT NULL DEFAULT '';

ALTER TABLE crm_communications ADD COLUMN preheader TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_communications ADD COLUMN email_theme TEXT NOT NULL DEFAULT 'construct_studio';
