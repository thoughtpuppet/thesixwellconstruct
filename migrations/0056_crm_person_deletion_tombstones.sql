PRAGMA foreign_keys = ON;

-- Keep only source record keys after a Studio user deletes a CRM person. This
-- prevents an old appointment, ticket, or order replay from recreating the
-- deleted profile while allowing genuinely new qualifying activity to do so.
CREATE TABLE IF NOT EXISTS crm_deleted_person_sources (
  source_provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (source_provider, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_deleted_person_sources_deleted
  ON crm_deleted_person_sources(deleted_at DESC);
