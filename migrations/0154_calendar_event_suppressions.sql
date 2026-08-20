PRAGMA foreign_keys = ON;

-- A permanent calendar deletion removes the candidate and any published
-- snapshot. When requested, retain only a minimal exact-event tombstone so
-- Scout intake cannot silently recreate the deleted record.

CREATE TABLE calendar_event_suppressions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'studio'
);

CREATE TABLE calendar_event_suppression_keys (
  suppression_id TEXT NOT NULL,
  identity_hash TEXT NOT NULL UNIQUE,
  identity_kind TEXT NOT NULL
    CHECK (identity_kind IN ('source_event','source_url','semantic')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (suppression_id,identity_hash),
  FOREIGN KEY (suppression_id) REFERENCES calendar_event_suppressions(id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_event_suppressions_created
  ON calendar_event_suppressions(created_at DESC,id DESC);

ALTER TABLE calendar_scout_runs
  ADD COLUMN suppressed_count INTEGER NOT NULL DEFAULT 0;
