PRAGMA foreign_keys = ON;

-- Calendar discovery and source resolution are separate editorial concerns.
-- Keep both instructions editable while retaining deterministic source checks.
ALTER TABLE calendar_scout_profiles
ADD COLUMN scout_brief TEXT NOT NULL DEFAULT 'Find factual Atlanta-metro creative events that fit the weighted subjects, formats, concepts, and geographic rules. Preserve distinct exhibitions, series, and related programs for private Studio review.';

ALTER TABLE calendar_scout_profiles
ADD COLUMN source_resolution_rules TEXT NOT NULL DEFAULT 'Treat magazines, newsletters, aggregators, search results, and social posts as private discovery leads. Search the exact event title, date, organizer, venue, and artist. Prefer an event-specific page on the organizer or venue official domain. Keep an authorized ticket page as the ticket URL or use it as the public source only when no event-specific official page exists and an official organizer or venue website supports it. Never substitute a homepage for an event-specific page. If the chain cannot be established, leave the source unresolved and explain what was searched.';

ALTER TABLE calendar_scout_profiles
ADD COLUMN source_resolution_passes INTEGER NOT NULL DEFAULT 3
  CHECK (source_resolution_passes BETWEEN 1 AND 4);

CREATE TABLE calendar_known_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL DEFAULT 'both'
    CHECK (organization_type IN ('organizer','venue','both')),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  official_domains_json TEXT NOT NULL DEFAULT '[]',
  event_paths_json TEXT NOT NULL DEFAULT '[]',
  trusted_ticket_domains_json TEXT NOT NULL DEFAULT '[]',
  discovery_only_domains_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_known_organizations_enabled_name
  ON calendar_known_organizations(enabled,name);

CREATE TABLE calendar_source_resolution_attempts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  run_id TEXT,
  lead_url TEXT NOT NULL,
  event_title TEXT NOT NULL DEFAULT '',
  search_queries_json TEXT NOT NULL DEFAULT '[]',
  attempted_urls_json TEXT NOT NULL DEFAULT '[]',
  selected_url TEXT NOT NULL DEFAULT '',
  resolution_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (resolution_status IN ('resolved','unresolved','failed')),
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES calendar_scout_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_calendar_source_resolution_attempts_candidate
  ON calendar_source_resolution_attempts(candidate_id,created_at DESC);
CREATE INDEX idx_calendar_source_resolution_attempts_lead
  ON calendar_source_resolution_attempts(lead_url,created_at DESC);
