PRAGMA foreign_keys = OFF;

-- Closing receptions are distinct dated exhibition programs. Rebuild the two
-- constrained occurrence tables so existing identities, publication state,
-- access facts, ticket facts, and Night Planning metadata remain intact.

CREATE TABLE calendar_candidate_occurrences_0168 (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL DEFAULT '',
  occurrence_type TEXT NOT NULL DEFAULT 'other'
    CHECK (occurrence_type IN ('opening_reception','closing_reception','artist_talk','mixer','screening','performance','workshop','panel','lecture','other')),
  title TEXT NOT NULL DEFAULT '',
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed' CHECK (date_kind IN ('timed','all_day')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','tbd','cancelled')),
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('verified','unverified','needs_verification')),
  verification_notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  access_status TEXT NOT NULL DEFAULT 'public' CHECK (access_status IN ('public','restricted','unknown')),
  access_notes TEXT NOT NULL DEFAULT '',
  audiences_json TEXT NOT NULL DEFAULT '["Public"]',
  ticket_status TEXT NOT NULL DEFAULT 'unknown' CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed')),
  ticket_on_sale_at TEXT,
  ticket_notes TEXT NOT NULL DEFAULT '',
  attendance_mode TEXT NOT NULL DEFAULT 'inferred' CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in')),
  recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180),
  minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720),
  recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720),
  late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1)),
  planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1)),
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  planning_notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE
);

INSERT INTO calendar_candidate_occurrences_0168 (
  id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
  venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,created_at,updated_at,
  access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,attendance_mode,
  recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,late_arrival_allowed,planning_eligible,
  latitude,longitude,planning_notes
)
SELECT
  id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
  venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,created_at,updated_at,
  access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,attendance_mode,
  recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,late_arrival_allowed,planning_eligible,
  latitude,longitude,planning_notes
FROM calendar_candidate_occurrences;

CREATE TABLE calendar_entry_occurrences_0168 (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_occurrence_id TEXT,
  uid TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','cancelled')),
  occurrence_type TEXT NOT NULL DEFAULT 'other'
    CHECK (occurrence_type IN ('opening_reception','closing_reception','artist_talk','mixer','screening','performance','workshop','panel','lecture','other')),
  title TEXT NOT NULL,
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed' CHECK (date_kind IN ('timed','all_day')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  last_modified_at TEXT NOT NULL,
  last_verified_at TEXT,
  access_status TEXT NOT NULL DEFAULT 'public' CHECK (access_status IN ('public','restricted','unknown')),
  access_notes TEXT NOT NULL DEFAULT '',
  audiences_json TEXT NOT NULL DEFAULT '["Public"]',
  ticket_status TEXT NOT NULL DEFAULT 'unknown' CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed')),
  ticket_on_sale_at TEXT,
  ticket_notes TEXT NOT NULL DEFAULT '',
  attendance_mode TEXT NOT NULL DEFAULT 'inferred' CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in')),
  recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180),
  minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720),
  recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720),
  late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1)),
  planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1)),
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  planning_notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_occurrence_id) REFERENCES calendar_candidate_occurrences_0168(id) ON DELETE SET NULL,
  UNIQUE(candidate_occurrence_id)
);

INSERT INTO calendar_entry_occurrences_0168 (
  id,entry_id,candidate_occurrence_id,uid,sequence,status,occurrence_type,title,factual_description,date_kind,
  starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,published_at,last_modified_at,last_verified_at,
  access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,attendance_mode,
  recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,late_arrival_allowed,planning_eligible,
  latitude,longitude,planning_notes
)
SELECT
  id,entry_id,candidate_occurrence_id,uid,sequence,status,occurrence_type,title,factual_description,date_kind,
  starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,published_at,last_modified_at,last_verified_at,
  access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,attendance_mode,
  recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,late_arrival_allowed,planning_eligible,
  latitude,longitude,planning_notes
FROM calendar_entry_occurrences;

DROP TABLE calendar_entry_occurrences;
DROP TABLE calendar_candidate_occurrences;
ALTER TABLE calendar_candidate_occurrences_0168 RENAME TO calendar_candidate_occurrences;
ALTER TABLE calendar_entry_occurrences_0168 RENAME TO calendar_entry_occurrences;

CREATE INDEX idx_calendar_candidate_occurrences_parent
  ON calendar_candidate_occurrences(candidate_id,sort_order,starts_at,id);
CREATE INDEX idx_calendar_candidate_occurrences_identity
  ON calendar_candidate_occurrences(candidate_id,occurrence_type,starts_at)
  WHERE starts_at IS NOT NULL;
CREATE INDEX idx_calendar_entry_occurrences_chronology
  ON calendar_entry_occurrences(starts_at,status,entry_id);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
