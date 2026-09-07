PRAGMA foreign_keys = ON;

-- ATLWKNDR's official schedule lists fourteen 2026 programs as scheduled.
-- Reconcile the published festival to that schedule, preserve the five valid
-- public occurrence identities already in production, and remove three known
-- duplicate occurrence snapshots created by incomplete aggregator refreshes.
CREATE TABLE _migration_0224_atlwkndr_programs (
  program_key TEXT PRIMARY KEY,
  candidate_occurrence_id TEXT NOT NULL,
  entry_occurrence_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  factual_description TEXT NOT NULL,
  occurrence_type TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  venue_name TEXT NOT NULL,
  venue_address TEXT NOT NULL,
  ticket_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO _migration_0224_atlwkndr_programs
  (program_key,candidate_occurrence_id,entry_occurrence_id,source_event_id,title,factual_description,
   occurrence_type,starts_at,ends_at,venue_name,venue_address,ticket_url,sort_order)
VALUES
  ('lovesexy','cal_occurrence_0785ad1c-ad58-4ff7-b32e-e63e7eba4bb7','cal_entry_occurrence_40aa5b4d-d6e8-4166-b244-8ef66a75160f','atlwkndr-2026-lovesexy','LOVESEXY — The Prince Tribute Party','ATLWKNDR''s Thursday-night Prince tribute party with DJs Salah Ananse and DJ Kemit.','performance','2026-09-03T21:00:00-04:00','2026-09-04T02:00:00-04:00','Knock Music House','1789 Cheshire Bridge Rd NE, Atlanta, GA 30324','https://www.eventbrite.com/e/1997638433329',0),
  ('welcome-home','cal_occurrence_atlwkndr_2026_welcome_home','cal_entry_occurrence_atlwkndr_2026_welcome_home','atlwkndr-2026-welcome-home','Welcome Home: The ATLWKNDR Check In Session','ATLWKNDR check-in session presented by African Ancestry, with DJs Amar Mansoor, DJ LA, Cha Cha Jones, and more. Check-in runs from 2 PM to 8 PM.','mixer','2026-09-04T13:00:00-04:00','2026-09-04T21:00:00-04:00','Rolling Out Live','770 English Ave, Atlanta, GA','https://www.eventbrite.com/e/1999053355399',1),
  ('distinctive','cal_occurrence_atlwkndr_2026_distinctive','cal_entry_occurrence_atlwkndr_2026_distinctive','atlwkndr-2026-distinctive','DISTINCTIVE w/ Joe Claussell','ATLWKNDR Friday-night party with Kai Alcé, Joe Claussell, CTRLZORA, and Playr1.','performance','2026-09-04T22:00:00-04:00','2026-09-05T03:00:00-04:00','Lunchbox','50 Lower Alabama Rd, Underground Atlanta, Atlanta, GA','',2),
  ('atl-dance-sessions','cal_occurrence_atlwkndr_2026_atl_dance_sessions','cal_entry_occurrence_atlwkndr_2026_atl_dance_sessions','atlwkndr-2026-atl-dance-sessions','DJ Kemit Presents: ATL Dance Sessions','ATLWKNDR edition of ATL Dance Sessions with DJ Kemit, Just One, and Andrew Marriott.','performance','2026-09-04T22:00:00-04:00','2026-09-05T02:00:00-04:00','Westside Motor Lounge','725 Echo St NW, Atlanta, GA 30318','',3),
  ('soul-variations','cal_occurrence_atlwkndr_2026_soul_variations','cal_entry_occurrence_atlwkndr_2026_soul_variations','atlwkndr-2026-soul-variations','Soul Variations — DAH Afterhours','ATLWKNDR afterhours party with Tyrone Francis, Yusef, and Selectress Kae. The organizer lists the ending as “until.”','performance','2026-09-05T00:00:00-04:00',NULL,'Space 323','323 Walker St SW, Atlanta, GA','https://events.ticketleap.com/tickets/lushvybez/soul-variations-presents-till-dah-break-of-dawn',4),
  ('moods-music','cal_occurrence_atlwkndr_2026_moods_music','cal_entry_occurrence_atlwkndr_2026_moods_music','atlwkndr-2026-moods-music','Moods Music ATLWKNDR In-Store','No-cover ATLWKNDR in-store program with DJs Reddz, Skyywalker, and Big Ted.','performance','2026-09-05T13:00:00-04:00','2026-09-05T17:00:00-04:00','Moods Music','1131 Euclid Ave NE, Atlanta, GA','',5),
  ('crates','cal_occurrence_atlwkndr_2026_crates','cal_entry_occurrence_atlwkndr_2026_crates','atlwkndr-2026-crates','Crates ATLWKNDR In-Store','No-cover ATLWKNDR in-store program with DJs Jason Staten and DJ Euts.','performance','2026-09-05T13:00:00-04:00','2026-09-05T17:00:00-04:00','Moods Music','1131 Euclid Ave NE, Atlanta, GA','',6),
  ('sunset-city-groove','cal_occurrence_3dab0aea-6895-423f-b6bc-155925d66c66','cal_entry_occurrence_0b08247e-ffd0-45e4-830c-102f471566c3','atlwkndr-2026-sunset-city-groove','Sunset City Groove — Official ATLWKNDR Day Party','ATLWKNDR''s official Saturday day party with Beloved, Ash Lauryn, and more.','performance','2026-09-05T13:00:00-04:00','2026-09-05T21:00:00-04:00','Westside Motor Lounge','725 Echo St NW, Atlanta, GA 30318','https://www.eventbrite.com/e/1998404459534',7),
  ('house-rules','cal_occurrence_atlwkndr_2026_house_rules','cal_entry_occurrence_atlwkndr_2026_house_rules','atlwkndr-2026-house-rules','House Rules Dance Battle','ATLWKNDR house dance battle at Rolling Out Live.','performance','2026-09-05T14:00:00-04:00','2026-09-05T18:00:00-04:00','Rolling Out Live','770 English Ave, Atlanta, GA','',8),
  ('good-life','cal_occurrence_atlwkndr_2026_good_life','cal_entry_occurrence_atlwkndr_2026_good_life','atlwkndr-2026-good-life','Good Life','ATLWKNDR Saturday party with Kai Alcé, DJ Kemit, and Alton Miller.','performance','2026-09-05T19:00:00-04:00','2026-09-06T01:00:00-04:00','Block & Drum','5105 Peachtree Blvd, Building B, Chamblee, GA','',9),
  ('afrique-electrique','cal_occurrence_6951adde-8180-4d47-9310-b8f4ff71a79c','cal_entry_occurrence_adc3b79f-e918-4293-9974-b923f652c871','atlwkndr-2026-afrique-electrique','Afrique Electrique','ATLWKNDR Saturday-night party with resident Salah Ananse and guests Ian Friday, Stan Zeff, and more.','performance','2026-09-05T21:00:00-04:00','2026-09-06T02:00:00-04:00','Westside Motor Lounge','725 Echo St NW, Atlanta, GA 30318','https://www.eventbrite.com/e/1998675262513',10),
  ('house-in-the-park','cal_occurrence_694b378d-be17-41d1-a1f9-b4dad31542a7','cal_entry_occurrence_a6cd8407-1c72-4e04-834c-53d3d60c7031','atlwkndr-2026-house-in-the-park','House in the Park','ATLWKNDR''s Sunday program in Grant Park, with main-stage and Disco Tent DJ lineups. General admission is included with the Weekender pass.','performance','2026-09-06T12:00:00-04:00','2026-09-06T20:00:00-04:00','Grant Park','537 Park Ave SE, Atlanta, GA','https://www.houseinthepark.org/tickets',11),
  ('house-after-party','cal_occurrence_atlwkndr_2026_house_after_party','cal_entry_occurrence_atlwkndr_2026_house_after_party','atlwkndr-2026-house-in-the-park-after-party','House in the Park After Party','ATLWKNDR''s official Sunday-night House in the Park after party.','performance','2026-09-06T23:00:00-04:00','2026-09-07T03:00:00-04:00','Westside Motor Lounge','725 Echo St NW, Atlanta, GA 30318','',12),
  ('recovery','cal_occurrence_6c591fce-9777-486a-860d-ca2625df1e01','cal_entry_occurrence_5498065e-a0e0-4a46-a308-6f86d83e6e55','atlwkndr-2026-recovery','RECOVERY: Wellness Retreat & The Official ATLWKNDR Closing Dance Party','ATLWKNDR''s Monday wellness retreat and official closing dance party.','performance','2026-09-07T13:00:00-04:00','2026-09-07T21:00:00-04:00','Westside Motor Lounge','725 Echo St NW, Atlanta, GA 30318','https://www.eventbrite.com/e/1996760438222',13);

UPDATE calendar_candidate_revisions
SET revision_state='superseded',reviewed_at=datetime('now')
WHERE candidate_id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2'
  AND revision_state='pending';

UPDATE calendar_candidates
SET source_id=NULL,
    source_event_id='atlwkndr-2026-official-schedule',
    source_url='https://www.atlwkndr.com/schedule',
    ticket_url='https://www.atlwkndr.com/tickets',
    title='The Atlanta Weekender — ATLWKNDR 2026',
    organizer='ATLWKNDR',
    factual_description='ATLWKNDR is a five-day Atlanta festival of soul, house, Afro, dance, in-store programs, wellness, and related gatherings.',
    event_structure='series',collection_kind='festival',date_kind='date_range',
    starts_at='2026-09-03',ends_at='2026-09-07',timezone='America/New_York',
    city='Atlanta',region='GA',subjects_json='["poetry-music","art"]',formats_json='["performance","experimental-event"]',
    status='published',verification_state='verified',schedule_status='scheduled',
    verification_notes='The complete fourteen-program schedule was reconciled to ATLWKNDR''s official 2026 schedule.',
    organizer_url='https://www.atlwkndr.com/',source_authority='official_calendar',
    source_resolution_notes='The official ATLWKNDR schedule is authoritative for program presence, dates, times, and venues. Aggregator absence is not cancellation evidence.',
    pending_revision_id='',last_checked_at=datetime('now'),last_check_status='unchanged',
    last_check_summary='Reconciled all fourteen programs to the official ATLWKNDR 2026 schedule; no programs are cancelled.',
    monitoring_enabled=0,next_check_at=NULL,last_verified_at=datetime('now'),updated_at=datetime('now')
WHERE id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2';

UPDATE calendar_entries
SET sequence=sequence+1,status='published',source_url='https://www.atlwkndr.com/schedule',
    ticket_url='https://www.atlwkndr.com/tickets',title='The Atlanta Weekender — ATLWKNDR 2026',organizer='ATLWKNDR',
    factual_description='ATLWKNDR is a five-day Atlanta festival of soul, house, Afro, dance, in-store programs, wellness, and related gatherings.',
    event_structure='series',collection_kind='festival',date_kind='date_range',starts_at='2026-09-03',ends_at='2026-09-07',
    timezone='America/New_York',city='Atlanta',region='GA',subjects_json='["poetry-music","art"]',formats_json='["performance","experimental-event"]',
    organizer_url='https://www.atlwkndr.com/',source_authority='official_calendar',schedule_status='scheduled',
    last_modified_at=datetime('now'),last_verified_at=datetime('now')
WHERE id='cal_entry_c02e15a6-b684-44ae-a6c4-1021245fa709'
  AND candidate_id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2';

-- These three rows are duplicate snapshots of LOVESEXY and Recovery, not
-- distinct organizer-listed programs. The surviving public UIDs remain stable.
DELETE FROM calendar_entry_occurrences
WHERE candidate_occurrence_id IN (
  'cal_occurrence_3f807c90-65fb-40bf-86fa-33ad8c30237c',
  'cal_occurrence_dc3d73f5-fd82-47a5-a697-32121c0f04c7',
  'cal_occurrence_d8985830-455d-4e3a-9dc9-e5639ac0f472'
);

DELETE FROM calendar_candidate_occurrences
WHERE candidate_id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2'
  AND id IN (
    'cal_occurrence_3f807c90-65fb-40bf-86fa-33ad8c30237c',
    'cal_occurrence_dc3d73f5-fd82-47a5-a697-32121c0f04c7',
    'cal_occurrence_d8985830-455d-4e3a-9dc9-e5639ac0f472'
  );

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   created_at,updated_at,access_status,audiences_json,ticket_status,include_public,source_presence_state,
   missing_complete_runs,last_source_seen_at)
SELECT
  p.candidate_occurrence_id,'cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2',p.source_event_id,p.occurrence_type,
  p.title,p.factual_description,'timed',p.starts_at,p.ends_at,'America/New_York',p.venue_name,p.venue_address,
  'https://www.atlwkndr.com/schedule',p.ticket_url,'scheduled','verified',
  'Verified against ATLWKNDR''s official 2026 schedule.',p.sort_order,datetime('now'),datetime('now'),
  'public','["Public"]','unknown',1,'present',0,datetime('now')
FROM _migration_0224_atlwkndr_programs p
WHERE EXISTS (SELECT 1 FROM calendar_candidates WHERE id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2');

UPDATE calendar_candidate_occurrences
SET source_event_id=(SELECT p.source_event_id FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    occurrence_type=(SELECT p.occurrence_type FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    title=(SELECT p.title FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    factual_description=(SELECT p.factual_description FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    date_kind='timed',
    starts_at=(SELECT p.starts_at FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    ends_at=(SELECT p.ends_at FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    timezone='America/New_York',
    venue_name=(SELECT p.venue_name FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    venue_address=(SELECT p.venue_address FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    source_url='https://www.atlwkndr.com/schedule',
    ticket_url=(SELECT p.ticket_url FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    status='scheduled',verification_state='verified',verification_notes='Verified against ATLWKNDR''s official 2026 schedule.',
    sort_order=(SELECT p.sort_order FROM _migration_0224_atlwkndr_programs p WHERE p.candidate_occurrence_id=calendar_candidate_occurrences.id),
    access_status='public',audiences_json='["Public"]',include_public=1,source_presence_state='present',
    missing_complete_runs=0,last_source_seen_at=datetime('now'),updated_at=datetime('now')
WHERE candidate_id='cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2'
  AND id IN (SELECT candidate_occurrence_id FROM _migration_0224_atlwkndr_programs);

INSERT OR IGNORE INTO calendar_entry_occurrences
  (id,entry_id,candidate_occurrence_id,uid,sequence,status,occurrence_type,title,factual_description,date_kind,
   starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,published_at,last_modified_at,last_verified_at,
   access_status,audiences_json,ticket_status)
SELECT
  p.entry_occurrence_id,'cal_entry_c02e15a6-b684-44ae-a6c4-1021245fa709',p.candidate_occurrence_id,
  p.entry_occurrence_id || '@thesixwellconstruct.com',0,'published',p.occurrence_type,p.title,p.factual_description,'timed',
  p.starts_at,p.ends_at,'America/New_York',p.venue_name,p.venue_address,'https://www.atlwkndr.com/schedule',p.ticket_url,
  datetime('now'),datetime('now'),datetime('now'),'public','["Public"]','unknown'
FROM _migration_0224_atlwkndr_programs p
WHERE EXISTS (SELECT 1 FROM calendar_entries WHERE id='cal_entry_c02e15a6-b684-44ae-a6c4-1021245fa709');

UPDATE calendar_entry_occurrences
SET sequence=sequence+CASE WHEN status='cancelled' THEN 1 ELSE 0 END,status='published',
    occurrence_type=(SELECT p.occurrence_type FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    title=(SELECT p.title FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    factual_description=(SELECT p.factual_description FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    date_kind='timed',
    starts_at=(SELECT p.starts_at FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    ends_at=(SELECT p.ends_at FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    timezone='America/New_York',
    venue_name=(SELECT p.venue_name FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    venue_address=(SELECT p.venue_address FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    source_url='https://www.atlwkndr.com/schedule',
    ticket_url=(SELECT p.ticket_url FROM _migration_0224_atlwkndr_programs p WHERE p.entry_occurrence_id=calendar_entry_occurrences.id),
    access_status='public',audiences_json='["Public"]',last_modified_at=datetime('now'),last_verified_at=datetime('now')
WHERE entry_id='cal_entry_c02e15a6-b684-44ae-a6c4-1021245fa709'
  AND id IN (SELECT entry_occurrence_id FROM _migration_0224_atlwkndr_programs);

DROP TABLE _migration_0224_atlwkndr_programs;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
