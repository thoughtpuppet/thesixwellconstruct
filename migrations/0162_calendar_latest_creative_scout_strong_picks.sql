PRAGMA foreign_keys = ON;

-- Reconcile the five genuinely missing events from the August 21 Atlanta
-- Creative Event Alerts report. Event facts enter the private candidate queue;
-- strategy, inspiration, networking, and collaborator notes stay in the
-- private notes/Strong Picks tables. This migration never writes public entries.

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_poetic_jazz','Poetic Jazz','https://www.poeticjazz.org/events/','official_html','official',1,24,'automatic','static',
   '{"organizer":"Poetic Jazz","organizerUrl":"https://www.poeticjazz.org/","city":"Atlanta","region":"GA","perRunLimit":20}',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,access_status,access_notes,audiences_json,
   discovery_url,organizer_url,venue_url,source_authority,source_resolution_notes,
   schedule_status,ticket_status,ticket_notes,monitoring_enabled,monitoring_cadence_hours,next_check_at,
   first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_spelman_between_here_infinity_2026','cal_source_spelman_exhibitions','between-here-infinity-2026',
   'https://www.spelman.edu/news/2026/08/spelman-museum-celebrates-30-years-of-black-womens-art-with-between-here-infinity-celebrating-30-years-of-the-spelman-college-art-collection.html','',
   'Between Here & Infinity: Celebrating 30 Years of the Spelman College Art Collection','Spelman College Museum of Fine Art',
   'A two-gallery exhibition of nearly 70 works by Black women from the Spelman College Art Collection. The first gallery opens September 9 and the second opens October 1; public museum hours are Wednesday through Saturday, noon to 5 PM.',
   'exhibition','date_range','2026-09-09','2026-12-05','America/New_York','Spelman College Museum of Fine Art','440 Westview Drive SW, Atlanta, GA 30310','Atlanta','GA',
   '["art"]','["exhibition"]',0,'candidate','verified','Dates, museum hours, two-gallery structure, collection scope, and participating-artist context were confirmed in Spelman College''s official announcement.',
   0.98,'seed','scheduled_chat','unknown','The official announcement establishes public museum hours but does not state admission requirements.','[]',
   'https://www.artsatl.org/the-2026-fall-arts-preview-our-picks-in-art-design/','https://www.spelman.edu/museum-of-fine-art/','https://www.spelman.edu/museum-of-fine-art/','organizer_event',
   'The official Spelman announcement is canonical; the ChatGPT scout report remains private discovery provenance.','scheduled','unknown','No ticket or admission requirement is stated in the official announcement.',
   1,24,strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),'2026-08-21T22:35:04.515Z','2026-08-21T22:35:04.515Z',datetime('now'),datetime('now')),

  ('cal_candidate_eyedrum_chamber_cartel_benator_2026','cal_source_eyedrum','chamber-cartel-jordan-benator-2026',
   'https://www.eyedrum.org/calendar-events-performances-art-music/monday-night-creative-music-series-chamber-cartel-plus-jordan-benator','',
   'Chamber Cartel + Jordan Benator: Three World Premieres','Eyedrum and Chamber Cartel',
   'A Monday Night Creative Music program presenting three newly commissioned works with prepared piano, percussion, quasi-jazz, open instrumentation, and variable-duration composition.',
   'single','timed','2026-08-31T20:00:00-04:00','2026-08-31T22:30:00-04:00','America/New_York','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','Atlanta','GA',
   '["poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, commissioned-work framing, and program details were confirmed on Eyedrum''s exact official event page.',
   0.99,'seed','scheduled_chat','unknown','The official event page confirms the program but admission requirements still need a Studio check.','[]',
   '','https://www.eyedrum.org/','https://www.eyedrum.org/','venue_event','Confirmed on the venue''s exact official event page.','scheduled','unknown','Ticket or door details are not stated in the retained report.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-21T22:35:04.515Z','2026-08-21T22:35:04.515Z',datetime('now'),datetime('now')),

  ('cal_candidate_plaza_gandahar_2026','cal_source_plaza_theatre','gandahar-4k-2026',
   'https://www.plazaatlanta.com/movie/gandahar-4k/','https://www.plazaatlanta.com/movie/gandahar-4k/',
   'Gandahar — 4K Restoration','Plaza Theatre',
   'A 4K restoration of René Laloux''s surreal animated science-fiction film, featuring mutated beings, alternative civilizations, time travel, and environments designed by comic artist Caza.',
   'single','all_day','2026-09-04',NULL,'America/New_York','Plaza Theatre','1049 Ponce De Leon Avenue NE, Atlanta, GA 30306','Atlanta','GA',
   '["film"]','["screening","experimental-event"]',1,'needs_verification','needs_verification','The official Plaza page confirms the film and September 4 opening date, but exact showtimes were still unpublished when the Scout reported it.',
   0.78,'seed','scheduled_chat','unknown','Public ticketing is expected through Plaza Theatre, but a specific showtime and seat inventory must be confirmed.','[]',
   '','https://www.plazaatlanta.com/','https://www.plazaatlanta.com/','venue_event','The venue page is canonical; keep private until a specific performance time is available.','scheduled','not_yet_on_sale','Showtimes and ticket availability were TBA in the Scout report.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-21T22:35:04.515Z',NULL,datetime('now'),datetime('now')),

  ('cal_candidate_artists_afternoon_writing_narrative_2026','cal_source_artsatl_art_design','artists-afternoon-writing-our-own-narrative-2026',
   'https://www.artsatl.org/event/artists-in-the-afternoon-writing-our-own-narrative/','',
   'Artists in the Afternoon: Writing Our Own Narrative','Artists in the Afternoon',
   'A free afternoon program for LGBTQ and POC writers, filmmakers, producers, and emerging storytellers focused on representation and creative ownership, featuring writer-producer Rasheed Newson.',
   'single','timed','2026-09-05T13:00:00-04:00','2026-09-05T17:00:00-04:00','America/New_York','The Starling Atlanta Midtown','','Atlanta','GA',
   '["film"]','["panel","lecture-talk"]',0,'needs_verification','needs_verification','Date, time, venue, free-access claim, audience, and participant details currently come from the ARTS ATL listing. Confirm them on an organizer or venue event page before publication.',
   0.68,'seed','scheduled_chat','public','ARTS ATL reports the event as free; Studio must confirm any registration requirement.','["Public"]',
   'https://www.artsatl.org/event/artists-in-the-afternoon-writing-our-own-narrative/','','','unresolved','ARTS ATL is a discovery source for this record; an original organizer or venue source is still required.','scheduled','unknown','No original registration or ticket page has been retained yet.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-21T22:35:04.515Z',NULL,datetime('now'),datetime('now')),

  ('cal_candidate_poetic_jazz_under_stars_2026','cal_source_poetic_jazz','poetic-jazz-under-the-stars-092226',
   'https://www.poeticjazz.org/events/092226','https://www.poeticjazz.org/events/092226',
   'Poetic Jazz: Under the Stars','Poetic Jazz',
   'A spoken-word program in which featured poets perform with a house band that receives their work only days beforehand and creates the accompaniment without rehearsal.',
   'single','timed','2026-09-22T20:00:00-04:00','2026-09-22T22:00:00-04:00','America/New_York','Trade & Tempo','552 Decatur Street SE, Atlanta, GA 30312','Atlanta','GA',
   '["poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, 7:30 PM seating, 8–10 PM performance, venue, ticket range, and program format were confirmed on Poetic Jazz''s official event page.',
   0.99,'seed','scheduled_chat','public','Public ticketed performance.','["Public"]','',
   'https://www.poeticjazz.org/','https://www.poeticjazz.org/','organizer_event','Confirmed on the organizer''s exact official event and ticket page.','scheduled','on_sale','Official tickets are listed at $28–$30.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-21T22:35:04.515Z','2026-08-21T22:35:04.515Z',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_spelman_between_here_infinity_2026','Major inspiration and curatorial reference; its layered Root / Threshold / Interior / Expanse / Horizon structure is especially useful.','Inspiration + Attend/Network','Study how a collection anniversary becomes a multi-room conceptual progression rather than a chronological survey.','Spelman College Museum of Fine Art; participating artists.','Private intelligence from the Atlanta Creative Event Alerts report; never expose publicly.',datetime('now')),
  ('cal_candidate_eyedrum_chamber_cartel_benator_2026','The commissioning model and Larvae''s idea-developing-in-real-time structure are particularly relevant.','Attend + Future Six.Well Programming','Study how three premieres share a bill while keeping open instrumentation and variable duration legible to an audience.','Chamber Cartel; Jordan Benator; Eyedrum.','Private intelligence from the Atlanta Creative Event Alerts report; never expose publicly.',datetime('now')),
  ('cal_candidate_plaza_gandahar_2026','Pure visual inspiration and a strong experimental-animation attendance pick.','Inspiration + Attend','Study Laloux and Caza''s world-building, mutated bodies, and alternative-civilization visual language.','Plaza Theatre; film-programming contacts.','Private intelligence from the Atlanta Creative Event Alerts report; never expose publicly.',datetime('now')),
  ('cal_candidate_artists_afternoon_writing_narrative_2026','Potentially useful film and media relationships around representation and creative ownership.','Attend/Network','Study how working writers and producers frame ownership for emerging storytellers without turning the program into a generic industry panel.','Rasheed Newson; participating writers and producers.','Private intelligence from the Atlanta Creative Event Alerts report; never expose publicly.',datetime('now')),
  ('cal_candidate_poetic_jazz_under_stars_2026','The strongest programming model in this batch: improvisation happens between poets and musicians who receive the work only days beforehand.','Attend/Network + Future Six.Well Programming','Compare its poet-and-band improvisation structure with Six.Well formats that translate sensory or literary input into participant-made visual responses.','Poetic Jazz; house-band musicians; featured poets; Trade & Tempo.','Private intelligence from the Atlanta Creative Event Alerts report; never expose publicly.',datetime('now'));

INSERT OR IGNORE INTO calendar_scout_runs
  (id,run_kind,status,model,started_at,completed_at,sources_searched_json,citations_json,
   candidate_count,duplicate_count,failure_count,source_results_json,openai_usage_json,strong_pick_count,material_update_count)
VALUES
  ('cal_run_scheduled_chat_20260821_latest','scheduled','completed','scheduled-chat-scout','2026-08-21T22:35:04.515Z','2026-08-21T22:35:04.515Z',
   '["Atlanta Creative Event Alerts"]','[]',5,5,0,'[{"channel":"scheduled_chat","status":"completed","candidates":5,"duplicates":5,"strongPicks":5}]','{}',5,0);

INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at,change_set_json)
SELECT
  'cal_revision_latest_scout_'||c.id,c.id,
  (SELECT COALESCE(MAX(revision_number),0)+1 FROM calendar_candidate_revisions WHERE candidate_id=c.id),
  'pending',
  json_object(
    'title',c.title,'organizer',c.organizer,'factualDescription',c.factual_description,'eventStructure',c.event_structure,
    'accessStatus',c.access_status,'accessNotes',c.access_notes,'audiences',json(c.audiences_json),
    'dateKind',c.date_kind,'startsAt',c.starts_at,'endsAt',c.ends_at,'timezone',c.timezone,
    'venueName',c.venue_name,'venueAddress',c.venue_address,'city',c.city,'region',c.region,
    'subjects',json(c.subjects_json),'formats',json(c.formats_json),'experimental',json(iif(c.is_experimental=1,'true','false')),
    'sourceUrl',c.source_url,'ticketUrl',c.ticket_url,'scheduleStatus',c.schedule_status,
    'ticketStatus',c.ticket_status,'ticketOnSaleAt',c.ticket_on_sale_at,'ticketNotes',c.ticket_notes,
    'organizerUrl',c.organizer_url,'venueUrl',c.venue_url,'sourceAuthority',c.source_authority,
    'sourceResolutionNotes',c.source_resolution_notes,'occurrences',json_array()
  ),
  json_array(json_object('url',CASE WHEN c.discovery_url<>'' THEN c.discovery_url ELSE c.source_url END,
                              'sourceId',c.source_id,'verifiedAt',c.last_verified_at)),
  'Recovered a missing Atlanta Creative Event Alerts Strong Pick into the private Studio approval queue.',
  'migration-0162',datetime('now'),'[]'
FROM calendar_candidates c
WHERE c.id IN (
  'cal_candidate_spelman_between_here_infinity_2026','cal_candidate_eyedrum_chamber_cartel_benator_2026',
  'cal_candidate_plaza_gandahar_2026','cal_candidate_artists_afternoon_writing_narrative_2026',
  'cal_candidate_poetic_jazz_under_stars_2026'
)
  AND c.status IN ('candidate','needs_verification')
  AND c.pending_revision_id='';

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_latest_scout_'||id,updated_at=datetime('now')
WHERE id IN (
  'cal_candidate_spelman_between_here_infinity_2026','cal_candidate_eyedrum_chamber_cartel_benator_2026',
  'cal_candidate_plaza_gandahar_2026','cal_candidate_artists_afternoon_writing_narrative_2026',
  'cal_candidate_poetic_jazz_under_stars_2026'
)
  AND status IN ('candidate','needs_verification')
  AND pending_revision_id=''
  AND EXISTS (SELECT 1 FROM calendar_candidate_revisions r WHERE r.id='cal_revision_latest_scout_'||calendar_candidates.id);

INSERT OR IGNORE INTO calendar_scout_strong_picks
  (id,run_id,candidate_id,pick_kind,fingerprint,snapshot_json,changes_json,detected_at,created_at)
SELECT
  'cal_pick_latest_scout_'||c.id,'cal_run_scheduled_chat_20260821_latest',c.id,'new','scheduled-chat-2026-08-21-'||c.id,
  json_object(
    'title',c.title,'organizer',c.organizer,'factualDescription',c.factual_description,
    'dateKind',c.date_kind,'startsAt',c.starts_at,'endsAt',c.ends_at,'timezone',c.timezone,
    'venueName',c.venue_name,'venueAddress',c.venue_address,'sourceUrl',c.source_url,'ticketUrl',c.ticket_url,
    'ticketStatus',c.ticket_status,'ticketOnSaleAt',c.ticket_on_sale_at,'ticketNotes',c.ticket_notes,
    'subjects',json(c.subjects_json),'formats',json(c.formats_json),
    'privateRationale',COALESCE(n.private_rationale,''),'attendanceUse',COALESCE(n.attendance_use,''),
    'programmingIdeas',COALESCE(n.programming_ideas,''),'potentialCollaborators',COALESCE(n.potential_collaborators,''),
    'occurrences',json_array()
  ),
  '[]','2026-08-21T22:35:04.515Z',datetime('now')
FROM calendar_candidates c
LEFT JOIN calendar_candidate_notes n ON n.candidate_id=c.id
WHERE c.id IN (
  'cal_candidate_spelman_between_here_infinity_2026','cal_candidate_eyedrum_chamber_cartel_benator_2026',
  'cal_candidate_plaza_gandahar_2026','cal_candidate_artists_afternoon_writing_narrative_2026',
  'cal_candidate_poetic_jazz_under_stars_2026'
);

