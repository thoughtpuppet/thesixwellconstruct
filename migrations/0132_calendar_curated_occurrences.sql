PRAGMA foreign_keys = ON;

-- Curated listings keep their schedule separate from Six.Well's operational
-- event_occurrences table. One calendar candidate/entry is the parent event;
-- these rows describe related public programs such as openings and talks.

CREATE TABLE IF NOT EXISTS calendar_candidate_occurrences (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL DEFAULT '',
  occurrence_type TEXT NOT NULL DEFAULT 'other'
    CHECK (occurrence_type IN ('opening_reception','artist_talk','mixer','screening','performance','workshop','panel','lecture','other')),
  title TEXT NOT NULL DEFAULT '',
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed'
    CHECK (date_kind IN ('timed','all_day')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','tbd','cancelled')),
  verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('verified','unverified','needs_verification')),
  verification_notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_candidate_occurrences_parent
  ON calendar_candidate_occurrences(candidate_id,sort_order,starts_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_candidate_occurrences_identity
  ON calendar_candidate_occurrences(candidate_id,occurrence_type,starts_at)
  WHERE starts_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_entry_occurrences (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_occurrence_id TEXT,
  uid TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','cancelled')),
  occurrence_type TEXT NOT NULL DEFAULT 'other'
    CHECK (occurrence_type IN ('opening_reception','artist_talk','mixer','screening','performance','workshop','panel','lecture','other')),
  title TEXT NOT NULL,
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed'
    CHECK (date_kind IN ('timed','all_day')),
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
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_occurrence_id) REFERENCES calendar_candidate_occurrences(id) ON DELETE SET NULL,
  UNIQUE(candidate_occurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_entry_occurrences_chronology
  ON calendar_entry_occurrences(starts_at,status,entry_id);

-- Preserve an existing imported BUGS! candidate when present. A fresh local
-- database receives one private parent candidate for the user-provided facts.
INSERT INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,duplicate_of,public_entry_id,pending_revision_id,rejection_reason,discovered_by,
   discovery_channel,first_seen_at,last_verified_at,created_at,updated_at)
SELECT
  'cal_candidate_you_are_not_alone_bugs',NULL,'','https://www.gulchmagazine.com/','',
  'You Are Not Alone: BUGS!','Georgia State University Perimeter College Fine Arts Gallery',
  'A group exhibition featuring 18 Georgia artists working across photography, painting, sculpture, ceramics, mixed media, and installation. The exhibition considers insects through pollination, labor, decomposition, interdependence, and their essential ecological roles, with related music, theater, and film programming.',
  'date_range','2026-08-17','2026-10-07','America/New_York',
  'Fine Arts Gallery (CF), Georgia State University Perimeter College, Clarkston',
  '3735 Memorial College Drive, Clarkston, GA 30021','Clarkston','GA','["art"]','["exhibition"]',1,
  'needs_verification','needs_verification',
  'Schedule supplied directly for review. Replace the discovery page with an event-specific official organizer, venue, or ticket-host page before publication.',
  NULL,'','','','','manual','manual',datetime('now'),NULL,datetime('now'),datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM calendar_candidates
  WHERE lower(title) LIKE 'you are not alone%bugs%'
);

UPDATE calendar_candidates
SET date_kind='date_range',starts_at='2026-08-17',ends_at='2026-10-07',
    venue_name='Fine Arts Gallery (CF), Georgia State University Perimeter College, Clarkston',
    venue_address='3735 Memorial College Drive, Clarkston, GA 30021',city='Clarkston',region='GA',
    subjects_json='["art"]',formats_json='["exhibition"]',is_experimental=1,updated_at=datetime('now')
WHERE id=(
  SELECT id FROM calendar_candidates
  WHERE lower(title) LIKE 'you are not alone%bugs%'
  ORDER BY created_at LIMIT 1
);

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,
   sort_order,created_at,updated_at)
SELECT
  'cal_occurrence_bugs_opening_2026',id,'opening_reception','Opening Reception',
  'Opening reception for You Are Not Alone: BUGS!.','timed',
  '2026-08-28T19:00:00-04:00','2026-08-28T21:00:00-04:00','America/New_York',
  'Fine Arts Gallery (CF), Georgia State University Perimeter College, Clarkston',
  '3735 Memorial College Drive, Clarkston, GA 30021','','','scheduled','needs_verification',
  'Confirm against an event-specific official page before publication.',0,datetime('now'),datetime('now')
FROM calendar_candidates
WHERE lower(title) LIKE 'you are not alone%bugs%'
ORDER BY created_at LIMIT 1;

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,
   sort_order,created_at,updated_at)
SELECT
  'cal_occurrence_bugs_artist_talk_2026',id,'artist_talk','Artist Talk',
  'Artist talk connected to You Are Not Alone: BUGS!.','timed',
  '2026-09-17T15:00:00-04:00','2026-09-17T17:00:00-04:00','America/New_York',
  'Fine Arts Gallery (CF), Georgia State University Perimeter College, Clarkston',
  '3735 Memorial College Drive, Clarkston, GA 30021','','','scheduled','needs_verification',
  'Confirm against an event-specific official page before publication.',1,datetime('now'),datetime('now')
FROM calendar_candidates
WHERE lower(title) LIKE 'you are not alone%bugs%'
ORDER BY created_at LIMIT 1;

INSERT INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at)
SELECT
  'cal_revision_bugs_schedule_2026',id,
  COALESCE((SELECT MAX(r.revision_number)+1 FROM calendar_candidate_revisions r WHERE r.candidate_id=calendar_candidates.id),1),
  'pending','{}','[{"source":"user-supplied schedule","capturedAt":"2026-08-17"}]',
  'Added exhibition range, opening reception, and artist talk as one related schedule.','migration',datetime('now')
FROM calendar_candidates
WHERE lower(title) LIKE 'you are not alone%bugs%'
  AND NOT EXISTS (SELECT 1 FROM calendar_candidate_revisions WHERE id='cal_revision_bugs_schedule_2026')
ORDER BY created_at LIMIT 1;

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_bugs_schedule_2026'
WHERE id=(SELECT candidate_id FROM calendar_candidate_revisions WHERE id='cal_revision_bugs_schedule_2026');
