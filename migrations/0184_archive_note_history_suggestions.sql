PRAGMA foreign_keys = ON;

-- Journal entries can propose factual Item History, but only Studio approval
-- creates or replaces the canonical entity_activity record.
CREATE TABLE archive_note_history_suggestions (
  id TEXT PRIMARY KEY,
  note_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  activity_id TEXT,
  activity_type TEXT NOT NULL DEFAULT 'milestone',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  source_note_updated_at TEXT NOT NULL,
  source_note_signature TEXT NOT NULL,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(note_entity_id,target_entity_id),
  UNIQUE(activity_id),
  FOREIGN KEY(note_entity_id) REFERENCES archive_notes(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(target_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(activity_id) REFERENCES entity_activity(id) ON DELETE SET NULL
);

CREATE INDEX idx_archive_note_history_suggestions_note
  ON archive_note_history_suggestions(note_entity_id,status,updated_at);

CREATE INDEX idx_archive_note_history_suggestions_target
  ON archive_note_history_suggestions(target_entity_id,status,updated_at);
