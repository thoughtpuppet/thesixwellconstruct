PRAGMA foreign_keys = ON;

-- Reconcile the historical Atlanta Creative Scout chat with the Studio feed.
-- Existing published entries remain untouched. Newly recovered events enter
-- the private approval queue; only Studio approval can create public entries.

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_adama','African Diaspora Art Museum of Atlanta','https://www.adamatl.org/events',
   'official_html','official',1,24,'automatic','static','{}',datetime('now'),datetime('now')),
  ('cal_source_plaza_theatre','Plaza Theatre','https://www.plazaatlanta.com/special-events/',
   'official_html','official',1,12,'automatic','dynamic-fallback','{}',datetime('now'),datetime('now')),
  ('cal_source_pollinator','The Pollinator Art Space','https://thepollinatorartspace.com/',
   'official_html','official',1,24,'automatic','static','{}',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,access_status,access_notes,audiences_json,
   discovery_url,organizer_url,venue_url,source_authority,source_resolution_notes,
   schedule_status,ticket_status,ticket_notes,monitoring_enabled,monitoring_cadence_hours,next_check_at,
   first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_adama_mending_to_preserve_2026','cal_source_adama','mending-to-preserve-opening-reception-2026',
   'https://www.adamatl.org/events/mending-to-preserve-opening-reception','',
   'Mending to Preserve — Opening Reception','African Diaspora Art Museum of Atlanta',
   'Opening reception for Selorm Attikpo''s multimedia exhibition preserving Accra hip-hop history through photography, mended artworks, archival materials, recordings, and community stories.',
   'single','timed','2026-08-21T18:00:00-04:00','2026-08-21T20:00:00-04:00','America/New_York',
   'ADAMA at Pittsburgh Yards','352 University Avenue SW, Atlanta, GA 30310','Atlanta','GA',
   '["art","poetry-music"]','["exhibition","experimental-event"]',1,'candidate','verified',
   'Date, 6–8 PM time, address, artist, and program description confirmed on ADAMA''s official event page.',
   0.99,'seed','creative_scout','public','Public opening reception.','["Public"]','',
   'https://www.adamatl.org/','https://www.adamatl.org/','venue_event',
   'Confirmed on the venue and organizer''s exact official event page.','scheduled','unknown','No ticket requirement is stated on the official event page.',
   1,24,strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),'2026-08-19T23:39:49.262Z','2026-08-20T00:00:00Z',datetime('now'),datetime('now')),

  ('cal_candidate_gulch_i_remember_when','cal_source_pollinator','i-remember-when-2026',
   'https://thepollinatorartspace.com/current-exhibition#a720cd50-024d-41e9-9609-6ad95ebb2b6b','',
   'I Remember When — Group Exhibition Opening','The Pollinator Art Space',
   'Opening reception for I Remember When, an exhibition focused on nostalgia and moments of the imagination across sculpture, painting, psychological imagery, and an animated Procreate short film.',
   'single','timed','2026-08-21T18:00:00-04:00','2026-08-21T21:00:00-04:00','America/New_York',
   'The Pollinator Art Space','1200 Foster Street NW, Studio 109, Atlanta, GA 30318','Atlanta','GA',
   '["art"]','["exhibition"]',0,'candidate','verified',
   'Exhibition dates, artists, media, venue, and description confirmed on The Pollinator Art Space official exhibition page; the opening time is retained from the verified Studio record.',
   0.95,'seed','creative_scout','public','Public opening reception.','["Public"]',
   'https://www.instagram.com/p/Dbi0R1FRx96/','https://thepollinatorartspace.com/','https://thepollinatorartspace.com/','venue_event',
   'The official venue page supports the exhibition; discovery provenance remains private.','scheduled','not_required','No ticket requirement is stated by the venue.',
   1,24,strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),'2026-08-19T23:39:49.262Z','2026-08-20T00:00:00Z',datetime('now'),datetime('now')),

  ('cal_candidate_plaza_film_love_milestones_2026','cal_source_plaza_theatre','film-love-milestones-2026',
   'https://www.plazaatlanta.com/movie/film-love-milestones/','https://www.plazaatlanta.com/movie/film-love-milestones/',
   'Film Love: Milestones','Film Love and Plaza Theatre',
   'A 195-minute 16mm screening that combines fiction, documentary, reenactment, archival footage, and layered sound while following communities negotiating political and personal change.',
   'single','timed','2026-08-27T19:00:00-04:00','2026-08-27T22:15:00-04:00','America/New_York',
   'Plaza Theatre','1049 Ponce De Leon Avenue NE, Atlanta, GA 30306','Atlanta','GA',
   '["film"]','["screening","experimental-event"]',1,'candidate','verified',
   'Date, 7 PM showtime, 195-minute runtime, venue, format, and description confirmed on Plaza Theatre''s exact event page.',
   0.99,'seed','creative_scout','public','Public ticketed screening.','["Public"]','',
   'https://www.plazaatlanta.com/','https://www.plazaatlanta.com/','venue_event',
   'Confirmed on the venue''s exact official event and ticket page.','scheduled','on_sale','Tickets are available from the official Plaza event page.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-19T23:39:49.262Z','2026-08-20T00:00:00Z',datetime('now'),datetime('now')),

  ('cal_candidate_plaza_lockjaw_2026','cal_source_plaza_theatre','lockjaw-sabrina-greco-2026',
   'https://www.plazaatlanta.com/movie/lockjaw/','https://www.plazaatlanta.com/movie/lockjaw/',
   'Lockjaw w/ Sabrina Greco','Plaza Theatre',
   'A 77-minute micro-independent comedy about a woman trying to reconnect with friends while recovering from an accident that left her jaw wired shut, presented with filmmaker Sabrina Greco.',
   'single','timed','2026-09-08T19:00:00-04:00','2026-09-08T20:17:00-04:00','America/New_York',
   'Plaza Theatre','1049 Ponce De Leon Avenue NE, Atlanta, GA 30306','Atlanta','GA',
   '["film"]','["screening"]',1,'candidate','verified',
   'Date, 7 PM showtime, 77-minute runtime, title, venue, and synopsis confirmed on Plaza Theatre''s exact event page.',
   0.98,'seed','creative_scout','public','Public ticketed screening.','["Public"]','',
   'https://www.plazaatlanta.com/','https://www.plazaatlanta.com/','venue_event',
   'Confirmed on the venue''s exact official event and ticket page.','scheduled','on_sale','Tickets are available from the official Plaza event page.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-19T23:39:49.262Z','2026-08-20T00:00:00Z',datetime('now'),datetime('now')),

  ('cal_candidate_miya_bailey_today_tomorrow_2026',NULL,'',
   'https://happeningnext.com/event/today-and-tomorrow-%E2%80%A2-9-11-eid1ef0l48eugar','',
   'Today and Tomorrow — Miya Bailey','Miya Bailey',
   'A reported tenth solo exhibition by Atlanta artist Miya Bailey, presented through a community-rooted art space with proceeds reported to support the Walker & Peters Program.',
   'single','timed','2026-09-11T19:00:00-04:00','2026-09-11T23:00:00-04:00','America/New_York',
   'Old Rabbit Art Gallery','309A Peters Street SW, Atlanta, GA 30313','Atlanta','GA',
   '["art"]','["exhibition"]',0,'needs_verification','needs_verification',
   'The date, time, address, solo-exhibition framing, and benefit claim currently come from a secondary event listing. Confirm them through Miya Bailey, Old Rabbit Art Gallery, or Walker & Peters before publication.',
   0.62,'seed','creative_scout','unknown','Attendance and admission details have not been confirmed.','[]',
   'https://happeningnext.com/event/today-and-tomorrow-%E2%80%A2-9-11-eid1ef0l48eugar','','','unresolved',
   'Secondary discovery lead retained privately; an organizer or venue event announcement is still required.',
   'scheduled','unknown','Ticket and admission details have not been confirmed.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-19T23:39:49.262Z',NULL,datetime('now'),datetime('now')),

  ('cal_candidate_plaza_faust_nebulous_2026','cal_source_plaza_theatre','faust-nebulous-orchestra-2026',
   'https://www.plazaatlanta.com/movie/faust-100th-anniversary-w-the-nebulous-orchestra-live/','https://www.plazaatlanta.com/movie/faust-100th-anniversary-w-the-nebulous-orchestra-live/',
   'Faust 100th Anniversary w/ The Nebulous Orchestra LIVE','Plaza Theatre and The Nebulous Orchestra',
   'A centennial screening of F.W. Murnau''s silent film Faust with a new live experimental electronic score performed by Atlanta composers and musicians in The Nebulous Orchestra.',
   'single','timed','2026-10-27T19:30:00-04:00','2026-10-27T21:26:00-04:00','America/New_York',
   'Plaza Theatre','1049 Ponce De Leon Avenue NE, Atlanta, GA 30306','Atlanta','GA',
   '["film","poetry-music"]','["screening","performance","experimental-event"]',1,'candidate','verified',
   'Date, 7:30 PM showtime, 116-minute runtime, live-score format, venue, and $25 ticket price confirmed on Plaza Theatre''s exact event page.',
   0.99,'seed','creative_scout','public','Public ticketed screening and live performance.','["Public"]','',
   'https://www.plazaatlanta.com/','https://www.plazaatlanta.com/','venue_event',
   'Confirmed on the venue''s exact official event and ticket page.','scheduled','on_sale','Official page states that $25 tickets are on sale.',
   1,12,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'),'2026-08-19T23:39:49.262Z','2026-08-20T00:00:00Z',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_adama_mending_to_preserve_2026',
   'Exceptionally close to interests in memory, documentation, Black cultural history, and systems of preservation.',
   'Attend/Network + Future Six.Well Programming',
   'Study how archival media, oral history, photography, sound, and community gathering share one exhibition framework.',
   'Selorm Attikpo; ADAMA.','Backfilled from the Atlanta Creative Event Alerts chat; private Studio intelligence only.',datetime('now')),
  ('cal_candidate_gulch_i_remember_when',
   'Memory and imagination move across sculpture, painting, psychological imagery, and animation without collapsing into one medium.',
   'Inspiration + Attend/Network',
   'Study how a group exhibition creates a shared conceptual field across distinct media.',
   'The Pollinator Art Space; Sabre Esler; participating artists.','Backfilled from the Atlanta Creative Event Alerts chat; private Studio intelligence only.',datetime('now')),
  ('cal_candidate_plaza_film_love_milestones_2026',
   'The work mixes fiction, documentary, archival material, 16mm image, and layered sound; Film Love''s framing is also a useful screening model.',
   'Inspiration + Future Six.Well Programming',
   'Study the curated introduction and discussion around a long-form, formally hybrid film.',
   'Film Love; Andy Ditzler; Plaza Theatre.','Backfilled from the Atlanta Creative Event Alerts chat; private Studio intelligence only.',datetime('now')),
  ('cal_candidate_plaza_lockjaw_2026',
   'A micro-independent film turns bodily constraint into a communication device, and the filmmaker''s presence creates a direct learning opportunity.',
   'Attend/Network + Inspiration',
   'Study how filmmaker-attended screenings make a small release more conversational and useful.',
   'Sabrina Greco; Plaza Theatre.','Backfilled from the Atlanta Creative Event Alerts chat; private Studio intelligence only.',datetime('now')),
  ('cal_candidate_miya_bailey_today_tomorrow_2026',
   'The reported artist-led exhibition and community-benefit structure suggest a strong cultural-infrastructure model, but the event facts still require an original source.',
   'Attend/Network + organizational research after verification',
   'Study the relationship among a solo exhibition, neighborhood art spaces, and support for the Walker & Peters Program.',
   'Miya Bailey; Old Rabbit Art Gallery; Walker & Peters Program.',
   'Backfilled from a secondary listing in the Atlanta Creative Event Alerts chat. Do not publish until an organizer or venue confirms it.',datetime('now')),
  ('cal_candidate_plaza_faust_nebulous_2026',
   'Surreal silent cinema paired with a newly performed experimental electronic score is a particularly strong film-and-music hybrid.',
   'Inspiration + Future Six.Well Programming',
   'Study how a live original score changes the audience''s relationship to a canonical film.',
   'The Nebulous Orchestra; Plaza Theatre.','Backfilled from the Atlanta Creative Event Alerts chat; private Studio intelligence only.',datetime('now'));

-- Create reviewable revisions only for records that are not already public.
INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at,change_set_json)
SELECT
  'cal_revision_backfill_'||c.id,c.id,
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
  'Recovered a historical Atlanta Creative Scout report into the private Studio approval queue.',
  'migration-0151',datetime('now'),'[]'
FROM calendar_candidates c
WHERE c.id IN (
  'cal_candidate_adama_mending_to_preserve_2026','cal_candidate_gulch_i_remember_when',
  'cal_candidate_plaza_film_love_milestones_2026','cal_candidate_plaza_lockjaw_2026',
  'cal_candidate_miya_bailey_today_tomorrow_2026','cal_candidate_plaza_faust_nebulous_2026'
)
  AND c.status IN ('candidate','needs_verification')
  AND c.pending_revision_id='';

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_backfill_'||id,updated_at=datetime('now')
WHERE id IN (
  'cal_candidate_adama_mending_to_preserve_2026','cal_candidate_gulch_i_remember_when',
  'cal_candidate_plaza_film_love_milestones_2026','cal_candidate_plaza_lockjaw_2026',
  'cal_candidate_miya_bailey_today_tomorrow_2026','cal_candidate_plaza_faust_nebulous_2026'
)
  AND status IN ('candidate','needs_verification')
  AND pending_revision_id=''
  AND EXISTS (SELECT 1 FROM calendar_candidate_revisions r WHERE r.id='cal_revision_backfill_'||calendar_candidates.id);

-- The chat reported 21 strong picks across five dated batches. Snapshot the
-- current reconciled candidate facts while retaining the original report date.
WITH historical_pick(candidate_id,detected_at) AS (
  VALUES
    ('cal_candidate_sound_vision','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_lost_shadows','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_voices_power','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_eyedrum_anniversary','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_eyedrum_winter','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_synergy','2026-08-16T01:05:25.551Z'),
    ('cal_candidate_words_on_wylie','2026-08-16T05:27:09.828Z'),
    ('cal_candidate_gulch_grrl_live','2026-08-17T01:12:57.612Z'),
    ('cal_candidate_leaflet_riso','2026-08-17T01:12:57.612Z'),
    ('cal_candidate_site_2026','2026-08-17T01:12:57.612Z'),
    ('cal_candidate_chamber_cartel_pleiades','2026-08-17T01:12:57.612Z'),
    ('cal_candidate_gulch_measure_without','2026-08-18T03:05:05.042Z'),
    ('cal_candidate_eyedrum_bryan_day','2026-08-18T03:05:05.042Z'),
    ('cal_candidate_eyedrum_wheelchair_sports','2026-08-18T03:05:05.042Z'),
    ('cal_candidate_eyedrum_akchamel','2026-08-18T03:05:05.042Z'),
    ('cal_candidate_adama_mending_to_preserve_2026','2026-08-19T23:39:49.262Z'),
    ('cal_candidate_gulch_i_remember_when','2026-08-19T23:39:49.262Z'),
    ('cal_candidate_plaza_film_love_milestones_2026','2026-08-19T23:39:49.262Z'),
    ('cal_candidate_plaza_lockjaw_2026','2026-08-19T23:39:49.262Z'),
    ('cal_candidate_miya_bailey_today_tomorrow_2026','2026-08-19T23:39:49.262Z'),
    ('cal_candidate_plaza_faust_nebulous_2026','2026-08-19T23:39:49.262Z')
)
INSERT OR IGNORE INTO calendar_scout_strong_picks
  (id,run_id,candidate_id,pick_kind,fingerprint,snapshot_json,changes_json,detected_at,created_at)
SELECT
  'cal_pick_backfill_'||h.candidate_id,NULL,c.id,'new','historic-chat-'||h.detected_at||'-'||c.id,
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
  '[]',h.detected_at,h.detected_at
FROM historical_pick h
JOIN calendar_candidates c ON c.id=h.candidate_id
LEFT JOIN calendar_candidate_notes n ON n.candidate_id=c.id;
