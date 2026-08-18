PRAGMA foreign_keys = ON;

-- Atlanta Calendar is an editorial curation layer. It intentionally does not
-- duplicate Six.Well's operational events, occurrences, tickets, or RSVPs.

CREATE TABLE calendar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'official_html'
    CHECK (source_type IN ('official_html','calendar','json','rss','discovery')),
  trust_level TEXT NOT NULL DEFAULT 'official'
    CHECK (trust_level IN ('official','trusted','discovery')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  cadence_hours INTEGER NOT NULL DEFAULT 24,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  last_http_status INTEGER,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_candidates (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  source_event_id TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  organizer TEXT NOT NULL DEFAULT '',
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed'
    CHECK (date_kind IN ('timed','all_day','date_range')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Atlanta',
  region TEXT NOT NULL DEFAULT 'GA',
  subjects_json TEXT NOT NULL DEFAULT '[]',
  formats_json TEXT NOT NULL DEFAULT '[]',
  is_experimental INTEGER NOT NULL DEFAULT 0 CHECK (is_experimental IN (0,1)),
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','published','rejected','cancelled','duplicate','needs_verification')),
  verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('verified','unverified','needs_verification')),
  verification_notes TEXT NOT NULL DEFAULT '',
  confidence REAL,
  duplicate_of TEXT NOT NULL DEFAULT '',
  public_entry_id TEXT NOT NULL DEFAULT '',
  pending_revision_id TEXT NOT NULL DEFAULT '',
  rejection_reason TEXT NOT NULL DEFAULT '',
  discovered_by TEXT NOT NULL DEFAULT 'manual'
    CHECK (discovered_by IN ('manual','seed','source_monitor','openai_web_search')),
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_calendar_candidates_source_identity
  ON calendar_candidates(source_id,source_event_id)
  WHERE source_id IS NOT NULL AND source_event_id<>'';
CREATE INDEX idx_calendar_candidates_review
  ON calendar_candidates(status,verification_state,starts_at,updated_at);
CREATE INDEX idx_calendar_candidates_source_url
  ON calendar_candidates(source_url);

CREATE TABLE calendar_candidate_notes (
  candidate_id TEXT PRIMARY KEY,
  private_rationale TEXT NOT NULL DEFAULT '',
  attendance_use TEXT NOT NULL DEFAULT '',
  programming_ideas TEXT NOT NULL DEFAULT '',
  potential_collaborators TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE
);

CREATE TABLE calendar_candidate_revisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  revision_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (revision_state IN ('pending','approved','rejected','superseded')),
  snapshot_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,revision_number)
);

CREATE TABLE calendar_entries (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
  uid TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','cancelled')),
  source_url TEXT NOT NULL,
  ticket_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  organizer TEXT NOT NULL DEFAULT '',
  factual_description TEXT NOT NULL DEFAULT '',
  date_kind TEXT NOT NULL DEFAULT 'timed'
    CHECK (date_kind IN ('timed','all_day','date_range')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Atlanta',
  region TEXT NOT NULL DEFAULT 'GA',
  subjects_json TEXT NOT NULL DEFAULT '[]',
  formats_json TEXT NOT NULL DEFAULT '[]',
  is_experimental INTEGER NOT NULL DEFAULT 0 CHECK (is_experimental IN (0,1)),
  published_at TEXT NOT NULL,
  last_modified_at TEXT NOT NULL,
  last_verified_at TEXT,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE RESTRICT
);

CREATE INDEX idx_calendar_entries_chronology ON calendar_entries(starts_at,status);

CREATE TABLE calendar_event_metadata (
  event_id TEXT PRIMARY KEY,
  subjects_json TEXT NOT NULL DEFAULT '[]',
  formats_json TEXT NOT NULL DEFAULT '[]',
  organizer TEXT NOT NULL DEFAULT 'The Six.Well Construct',
  source_url TEXT NOT NULL DEFAULT '',
  include_in_atlanta_calendar INTEGER NOT NULL DEFAULT 1 CHECK (include_in_atlanta_calendar IN (0,1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE calendar_scout_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  model TEXT NOT NULL DEFAULT 'gpt-5.6-terra',
  weighted_subjects_json TEXT NOT NULL,
  weighted_formats_json TEXT NOT NULL,
  positive_concepts_json TEXT NOT NULL,
  negative_terms_json TEXT NOT NULL,
  geographic_rules_json TEXT NOT NULL,
  date_horizon_days INTEGER NOT NULL DEFAULT 240,
  relevance_threshold REAL NOT NULL DEFAULT 0.68,
  duplicate_sensitivity REAL NOT NULL DEFAULT 0.84,
  per_run_limit INTEGER NOT NULL DEFAULT 20,
  source_cadence_hours INTEGER NOT NULL DEFAULT 24,
  web_cadence_hours INTEGER NOT NULL DEFAULT 24,
  last_source_run_at TEXT,
  last_web_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_scout_runs (
  id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('manual','scheduled')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed','disabled')),
  model TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  sources_searched_json TEXT NOT NULL DEFAULT '[]',
  queries_json TEXT NOT NULL DEFAULT '[]',
  citations_json TEXT NOT NULL DEFAULT '[]',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  source_results_json TEXT NOT NULL DEFAULT '[]',
  openai_usage_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_calendar_scout_runs_started ON calendar_scout_runs(started_at DESC);

CREATE TABLE calendar_profile_suggestions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','dismissed')),
  rationale TEXT NOT NULL,
  proposed_patch_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES calendar_scout_profiles(id) ON DELETE CASCADE
);

INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_source_atlanta_film_society','Atlanta Film Society','https://www.atlantafilmsociety.org/upcoming-events','official_html','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_voices_in_power','Voices in Power','https://voicesinpower.com/events/atlanta','official_html','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_eyedrum','Eyedrum','https://www.eyedrum.org/calendar-events-performances-art-music','official_html','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_kai_lin','Kai Lin Art','https://www.kailinart.com/news','official_html','official',1,24,datetime('now'),datetime('now'));

INSERT INTO calendar_scout_profiles
  (id,name,model,weighted_subjects_json,weighted_formats_json,positive_concepts_json,negative_terms_json,geographic_rules_json,date_horizon_days,relevance_threshold,duplicate_sensitivity,per_run_limit,created_at,updated_at)
VALUES
  ('atlanta-default','Atlanta creative ecosystem','gpt-5.6-terra',
   '{"art":1,"film":1,"poetry-music":1,"technology":0.85,"ai":0.9,"creative-technology":1}',
   '{"exhibition":1,"screening":1,"performance":1,"experimental-event":1,"lecture-talk":0.8,"panel":0.75,"workshop":0.75,"conference":0.7}',
   '["experimental","independent","immersive","interdisciplinary","new media","artist talk","creative technology","southern gothic","moving image","poetry","sound art"]',
   '["generic nightlife","cover band","corporate sales","online only","outside Atlanta metro"]',
   '{"metro":"Atlanta","state":"GA","includeOnlineOnly":false,"includeNonLocal":false}',
   240,0.68,0.84,20,datetime('now'),datetime('now'));

INSERT INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,date_kind,starts_at,ends_at,venue_name,venue_address,subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,confidence,discovered_by,first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_sound_vision','cal_source_atlanta_film_society','sound-vision-2026','https://www.atlantafilmsociety.org/upcoming-events/sound-vision','https://www.atlantafilmsociety.org/upcoming-events/sound-vision','SOUND + VISION','Atlanta Film Society','An immersive evening of experimental art, live music, virtual reality, music-video screenings, filmmaker installations, student projects, and sustainable fashion.','timed','2026-09-12T19:00:00-04:00','2026-09-12T23:00:00-04:00','LOOP','665 Marietta Street NW, Atlanta, GA 30313','["art","film","creative-technology"]','["screening","performance","experimental-event"]',1,'candidate','verified','Date, time, venue, description, and ticket information confirmed on the official event page.',0.98,'seed',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_lost_shadows','cal_source_atlanta_film_society','lost-in-the-shadows-2026','https://www.atlantafilmsociety.org/upcoming-events/locals-only-lost-in-the-shadows','https://www.atlantafilmsociety.org/upcoming-events/locals-only-lost-in-the-shadows','LOCALS ONLY: Lost in the Shadows','Atlanta Film Society','A Georgia-filmmaker shorts program centered on Southern Gothic stories, buried histories, cursed families, found artifacts, folk horror, decay, and resurrection.','timed','2026-10-22T19:00:00-04:00','2026-10-22T22:00:00-04:00','Tara Atlanta','2345 Cheshire Bridge Road NE, Atlanta, GA 30324','["film"]','["screening"]',0,'candidate','verified','Date, time, venue, description, and ticket information confirmed on the official event page.',0.97,'seed',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_voices_power','cal_source_voices_in_power','atlanta-2026-09-18','https://voicesinpower.com/events/atlanta','https://voicesinpower.com/events/atlanta','Voices in Power Atlanta','Voices in Power','An Atlanta poetry experience with an open mic, live art, and music. Doors open at 7 PM and the show begins at 8 PM.','timed','2026-09-18T19:00:00-04:00','2026-09-18T23:00:00-04:00','Atlantucky','170 Northside Drive SW, Suite 96, Atlanta, GA 30313','["art","poetry-music"]','["performance"]',0,'candidate','verified','Date, time, venue, and ticket information confirmed on the official Atlanta event page.',0.96,'seed',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_eyedrum_anniversary','cal_source_eyedrum','monday-night-creative-music-2026-09-14','https://www.eyedrum.org/calendar-events-performances-art-music','','Monday Night Creative Music: One Year Anniversary Party','Eyedrum','An anniversary edition of Monday Night Creative Music featuring experimental music, a biofeedback instrument, and visuals.','timed','2026-09-14T20:00:00-04:00','2026-09-14T22:30:00-04:00','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','["art","poetry-music","creative-technology"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, and program details confirmed on the official Eyedrum calendar.',0.95,'seed',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_eyedrum_winter','cal_source_eyedrum','angela-winter-2026-09-21','https://www.eyedrum.org/calendar-events-performances-art-music','','Monday Night Creative Music: Angela Winter + Dylan Mantione + Aaron Kruziki','Eyedrum','An evening of ambient, experimental, and ritual music featuring Angela Winter, Dylan Mantione, and Aaron Kruziki.','timed','2026-09-21T20:00:00-04:00','2026-09-21T22:30:00-04:00','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','["poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, and program details confirmed on the official Eyedrum calendar.',0.94,'seed',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_synergy','cal_source_kai_lin','synergy-unverified','https://www.kailinart.com/news/synergy-opening-at-annex','','SYNERGY','Kai Lin Art','A cited exhibition announcement requiring confirmation before public use.','date_range',NULL,NULL,'ANNEX','','["art"]','["exhibition"]',0,'needs_verification','needs_verification','The cited detail page does not currently expose enough confirmable date information. A confirmed date is required before publication.',0.45,'seed',datetime('now'),NULL,datetime('now'),datetime('now'));

INSERT INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_sound_vision','Strong overlap among experimental art, moving image, sound, immersive media, and fashion.','Attend and study the spatial choreography.','Observe how screenings, installations, performances, and fashion share one environment.','Atlanta Film Society; participating filmmakers and artists.','Private review intelligence; never return from public APIs.',datetime('now')),
  ('cal_candidate_lost_shadows','Regional independent film and Southern Gothic storytelling align with current film and mythology interests.','Attend and research.','Track filmmakers, visual language, and short-program pacing.','Atlanta Film Society; Georgia filmmakers.','Private review intelligence; never return from public APIs.',datetime('now')),
  ('cal_candidate_voices_power','Poetry, music, live art, and open-mic structure overlap with live showcase interests.','Attend and observe community format.','Study hosting rhythm and artist transitions.','Voices in Power; Atlanta poets and live artists.','Private review intelligence; never return from public APIs.',datetime('now')),
  ('cal_candidate_eyedrum_anniversary','Experimental sound and biofeedback visuals connect music, performance, and creative technology.','Attend for inspiration and connections.','Study low-tech and responsive-media presentation.','Eyedrum; Monday Night Creative Music participants.','Private review intelligence; never return from public APIs.',datetime('now')),
  ('cal_candidate_eyedrum_winter','Ambient, ritual, and experimental music align with sound and performance research.','Attend for inspiration.','Study room tone, duration, and performance sequencing.','Eyedrum; featured musicians.','Private review intelligence; never return from public APIs.',datetime('now')),
  ('cal_candidate_synergy','Potential visual-art relevance, but the public facts are not yet sufficient.','Do not act until verified.','','Kai Lin Art.','Needs a confirmed date and current official details.',datetime('now'));

INSERT INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at)
SELECT
  'cal_revision_seed_'||id,id,1,'pending',
  json_object('title',title,'organizer',organizer,'description',factual_description,'dateKind',date_kind,'startsAt',starts_at,'endsAt',ends_at,'timezone',timezone,'venueName',venue_name,'venueAddress',venue_address,'subjects',json(subjects_json),'formats',json(formats_json),'sourceUrl',source_url,'ticketUrl',ticket_url),
  json_array(json_object('url',source_url,'sourceId',source_id,'verifiedAt',last_verified_at)),
  'Initial candidate import','migration-0129',datetime('now')
FROM calendar_candidates;

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_seed_'||id;

-- The Events node's calendar pathway now opens the broader, neutral Atlanta
-- calendar. The dedicated Six.Well Events page and event board remain intact.
UPDATE construct_pathways
SET name='Atlanta calendar',route='/calendar/',updated_at=datetime('now')
WHERE id='path-events-03';
