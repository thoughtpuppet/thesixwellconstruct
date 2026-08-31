PRAGMA foreign_keys = ON;

-- Festival collections keep the established public series model while preserving the
-- semantic difference between a performance run and a multi-program festival.
ALTER TABLE calendar_candidates ADD COLUMN collection_kind TEXT NOT NULL DEFAULT 'none'
  CHECK (collection_kind IN ('none','festival'));
ALTER TABLE calendar_candidates ADD COLUMN parent_collection_candidate_id TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN collection_relation TEXT NOT NULL DEFAULT 'none'
  CHECK (collection_relation IN ('none','preview','related_event'));

ALTER TABLE calendar_entries ADD COLUMN collection_kind TEXT NOT NULL DEFAULT 'none'
  CHECK (collection_kind IN ('none','festival'));
ALTER TABLE calendar_entries ADD COLUMN parent_collection_entry_id TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN collection_relation TEXT NOT NULL DEFAULT 'none'
  CHECK (collection_relation IN ('none','preview','related_event'));

CREATE INDEX idx_calendar_candidates_collection_parent
  ON calendar_candidates(parent_collection_candidate_id,collection_relation,starts_at);
CREATE INDEX idx_calendar_entries_collection_parent
  ON calendar_entries(parent_collection_entry_id,collection_relation,starts_at);

-- Candidate programs can be held privately without blocking an otherwise
-- publishable festival parent. Film membership remains metadata on the
-- ticketed program instead of becoming additional calendar occurrences.
ALTER TABLE calendar_candidate_occurrences ADD COLUMN include_public INTEGER NOT NULL DEFAULT 1
  CHECK (include_public IN (0,1));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN program_items_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE calendar_candidate_occurrences ADD COLUMN source_presence_state TEXT NOT NULL DEFAULT 'present'
  CHECK (source_presence_state IN ('present','missing_once','confirmed_removed'));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN missing_complete_runs INTEGER NOT NULL DEFAULT 0
  CHECK (missing_complete_runs >= 0);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN last_source_seen_at TEXT;

ALTER TABLE calendar_entry_occurrences ADD COLUMN program_items_json TEXT NOT NULL DEFAULT '[]';

-- Every adapter run records what it observed before canonical candidate data
-- is promoted. Browser fallback snapshots are useful diagnostics but are never
-- authoritative and therefore cannot advance the activation streak.
CREATE TABLE calendar_source_automation (
  source_id TEXT PRIMARY KEY,
  automation_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (automation_mode IN ('review','shadow_then_auto','auto')),
  automation_state TEXT NOT NULL DEFAULT 'shadow'
    CHECK (automation_state IN ('shadow','active','paused')),
  required_stable_runs INTEGER NOT NULL DEFAULT 2 CHECK (required_stable_runs BETWEEN 1 AND 10),
  complete_run_streak INTEGER NOT NULL DEFAULT 0 CHECK (complete_run_streak >= 0),
  last_hierarchy_fingerprint TEXT NOT NULL DEFAULT '',
  last_program_count INTEGER NOT NULL DEFAULT 0 CHECK (last_program_count >= 0),
  last_snapshot_id TEXT NOT NULL DEFAULT '',
  last_promoted_snapshot_id TEXT NOT NULL DEFAULT '',
  latest_exception_summary TEXT NOT NULL DEFAULT '',
  authoritative_access TEXT NOT NULL DEFAULT 'unknown'
    CHECK (authoritative_access IN ('unknown','configured','missing','failed')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE
);

CREATE TABLE calendar_source_sync_snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  run_id TEXT NOT NULL DEFAULT '',
  adapter_key TEXT NOT NULL,
  retrieval TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('complete','needs_verification')),
  authoritative INTEGER NOT NULL DEFAULT 0 CHECK (authoritative IN (0,1)),
  hierarchy_fingerprint TEXT NOT NULL DEFAULT '',
  proposal_count INTEGER NOT NULL DEFAULT 0 CHECK (proposal_count >= 0),
  program_count INTEGER NOT NULL DEFAULT 0 CHECK (program_count >= 0),
  held_count INTEGER NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  missing_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
  payload_json TEXT NOT NULL DEFAULT '[]',
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_source_sync_snapshots_source
  ON calendar_source_sync_snapshots(source_id,created_at DESC,id DESC);

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_out_on_film_2026','Out on Film 2026','https://festival.outonfilm.org/',
   'official_html','official',1,24,'automatic','dynamic-fallback',
   '{"internalAdapter":"eventive","eventBucketId":"69b97b21d5d2bc69903d9694","parentSourceEventId":"eventive-bucket-69b97b21d5d2bc69903d9694","festivalTitle":"Out on Film 2026","organizer":"Out on Film","organizerUrl":"https://outonfilm.org/","festivalStart":"2026-09-24","festivalEnd":"2026-10-04","virtualEnd":"2026-10-11","maxPrograms":200,"automationMode":"shadow_then_auto","requiredStableRuns":2}',
   datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_source_automation
  (source_id,automation_mode,automation_state,required_stable_runs,updated_at)
VALUES
  ('cal_source_out_on_film_2026','shadow_then_auto','shadow',2,datetime('now'));

-- The direct connector wakes frequently, while each source's effective
-- cadence decides whether it is actually fetched during a scheduled run.
UPDATE calendar_scout_connectors
SET cadence_hours=6,updated_at=datetime('now')
WHERE id='direct';
