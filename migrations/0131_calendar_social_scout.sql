-- Platform-aware private social discovery for the Atlanta Calendar Scout.
-- Social evidence never joins the public calendar snapshot tables.

ALTER TABLE calendar_candidates
  ADD COLUMN discovery_channel TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_scout_profiles
  ADD COLUMN social_settings_json TEXT NOT NULL DEFAULT '{"threads":{"keywords":[],"tags":[],"cadenceHours":24,"perRunLimit":6},"instagram":{"keywords":[],"tags":[],"cadenceHours":24,"perRunLimit":6},"tiktok":{"keywords":[],"tags":[],"cadenceHours":24,"perRunLimit":6}}';

CREATE TABLE IF NOT EXISTS calendar_social_sources (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('threads','instagram','tiktok')),
  name TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'trusted' CHECK (trust_level IN ('official','trusted','discovery')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  cadence_hours INTEGER NOT NULL DEFAULT 24 CHECK (cadence_hours >= 1),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  last_http_status INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_calendar_social_sources_due
  ON calendar_social_sources(platform, enabled, last_attempt_at);

CREATE TABLE IF NOT EXISTS calendar_candidate_social_evidence (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  social_source_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('threads','instagram','tiktok')),
  post_id TEXT NOT NULL DEFAULT '',
  post_url TEXT NOT NULL,
  author_handle TEXT NOT NULL DEFAULT '',
  author_display_name TEXT NOT NULL DEFAULT '',
  author_is_verified INTEGER NOT NULL DEFAULT 0 CHECK (author_is_verified IN (0,1)),
  posted_at TEXT,
  caption_excerpt TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  evidence_role TEXT NOT NULL DEFAULT 'discovery' CHECK (evidence_role IN ('discovery','official','corroboration')),
  corroboration_state TEXT NOT NULL DEFAULT 'needed' CHECK (corroboration_state IN ('complete','needed','not_required')),
  provenance_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (social_source_id) REFERENCES calendar_social_sources(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_social_evidence_post
  ON calendar_candidate_social_evidence(candidate_id, platform, post_id)
  WHERE post_id <> '';

CREATE INDEX IF NOT EXISTS idx_calendar_social_evidence_candidate
  ON calendar_candidate_social_evidence(candidate_id, created_at);

CREATE TABLE IF NOT EXISTS calendar_scout_connectors (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT '',
  connector_type TEXT NOT NULL CHECK (connector_type IN ('direct','web_search','api')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  cadence_hours INTEGER NOT NULL DEFAULT 24 CHECK (cadence_hours >= 1),
  per_run_limit INTEGER NOT NULL DEFAULT 6 CHECK (per_run_limit BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('ready','disabled','authentication_failed','rate_limited','unavailable')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO calendar_scout_connectors
  (id,platform,connector_type,enabled,cadence_hours,per_run_limit,status,created_at,updated_at)
VALUES
  ('direct','','direct',1,24,20,'ready',datetime('now'),datetime('now')),
  ('general_web','','web_search',1,24,20,'unavailable',datetime('now'),datetime('now')),
  ('threads_api','threads','api',0,24,6,'disabled',datetime('now'),datetime('now')),
  ('instagram_api','instagram','api',0,24,6,'disabled',datetime('now'),datetime('now')),
  ('threads_web','threads','web_search',0,24,6,'disabled',datetime('now'),datetime('now')),
  ('instagram_web','instagram','web_search',0,24,6,'disabled',datetime('now'),datetime('now')),
  ('tiktok_web','tiktok','web_search',0,24,6,'disabled',datetime('now'),datetime('now'));
