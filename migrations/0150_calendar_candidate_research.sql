PRAGMA foreign_keys = ON;

-- Candidate-specific Scout conversations are private Studio records. Research
-- proposals never update a candidate until a Studio user applies selected
-- changes, and candidate media never becomes public until entry approval.

CREATE TABLE calendar_candidate_research_threads (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE
);

CREATE TABLE calendar_candidate_research_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  body TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  response_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES calendar_candidate_research_threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_research_messages_thread
  ON calendar_candidate_research_messages(thread_id,created_at,id);

CREATE TABLE calendar_candidate_research_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed')),
  model TEXT NOT NULL,
  query_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES calendar_candidate_research_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_message_id) REFERENCES calendar_candidate_research_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_message_id) REFERENCES calendar_candidate_research_messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_calendar_research_runs_thread
  ON calendar_candidate_research_runs(thread_id,started_at DESC,id DESC);

CREATE TABLE calendar_candidate_research_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','partially_applied','applied','dismissed')),
  findings_json TEXT NOT NULL DEFAULT '[]',
  changes_json TEXT NOT NULL DEFAULT '[]',
  applied_change_ids_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES calendar_candidate_research_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_message_id) REFERENCES calendar_candidate_research_messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_research_proposals_thread
  ON calendar_candidate_research_proposals(thread_id,created_at DESC,id DESC);

CREATE TABLE calendar_research_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('event','source')),
  candidate_id TEXT,
  source_id TEXT,
  instruction TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','pending','dismissed')),
  origin_message_id TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (origin_message_id) REFERENCES calendar_candidate_research_messages(id) ON DELETE SET NULL,
  CHECK (
    (scope='event' AND candidate_id IS NOT NULL AND source_id IS NULL) OR
    (scope='source' AND source_id IS NOT NULL)
  ),
  UNIQUE (scope,candidate_id,source_id,fingerprint)
);

CREATE INDEX idx_calendar_research_rules_candidate
  ON calendar_research_rules(candidate_id,status,created_at);
CREATE INDEX idx_calendar_research_rules_source
  ON calendar_research_rules(source_id,status,created_at);
CREATE UNIQUE INDEX idx_calendar_research_rules_event_fingerprint
  ON calendar_research_rules(candidate_id,fingerprint) WHERE scope='event';
CREATE UNIQUE INDEX idx_calendar_research_rules_source_fingerprint
  ON calendar_research_rules(source_id,fingerprint) WHERE scope='source';

CREATE TABLE calendar_candidate_media (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  provenance_url TEXT NOT NULL DEFAULT '',
  media_role TEXT NOT NULL DEFAULT 'gallery'
    CHECK (media_role IN ('primary','flyer','gallery','supporting')),
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  include_public INTEGER NOT NULL DEFAULT 0 CHECK (include_public IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,media_id)
);

CREATE INDEX idx_calendar_candidate_media_order
  ON calendar_candidate_media(candidate_id,sort_order,id);

CREATE TABLE calendar_entry_media (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_media_id TEXT,
  media_id TEXT NOT NULL,
  media_role TEXT NOT NULL DEFAULT 'gallery'
    CHECK (media_role IN ('primary','flyer','gallery','supporting')),
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_media_id) REFERENCES calendar_candidate_media(id) ON DELETE SET NULL,
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  UNIQUE (entry_id,media_id)
);

CREATE INDEX idx_calendar_entry_media_order
  ON calendar_entry_media(entry_id,sort_order,id);

-- Preserve every existing flyer as the first item in the new media model.
INSERT OR IGNORE INTO calendar_candidate_media
  (id,candidate_id,media_id,source_url,provenance_url,media_role,alt_text,caption,include_public,sort_order,created_at,updated_at)
SELECT 'cal_candidate_media_' || c.id,c.id,c.flyer_media_id,c.flyer_source_url,c.flyer_provenance_url,
       'flyer',COALESCE(m.alt_text,''),COALESCE(m.caption,''),c.flyer_public_approved,0,
       COALESCE(c.created_at,datetime('now')),COALESCE(c.updated_at,datetime('now'))
FROM calendar_candidates c
JOIN media_assets m ON m.id=c.flyer_media_id
WHERE c.flyer_media_id IS NOT NULL AND c.flyer_media_id<>'';

INSERT OR IGNORE INTO calendar_entry_media
  (id,entry_id,candidate_media_id,media_id,media_role,alt_text,caption,sort_order)
SELECT 'cal_entry_media_' || e.id,e.id,cm.id,e.flyer_media_id,'flyer',e.flyer_alt_text,
       COALESCE(m.caption,''),0
FROM calendar_entries e
JOIN media_assets m ON m.id=e.flyer_media_id
LEFT JOIN calendar_candidate_media cm
  ON cm.candidate_id=e.candidate_id AND cm.media_id=e.flyer_media_id
WHERE e.flyer_media_id IS NOT NULL AND e.flyer_media_id<>'';
