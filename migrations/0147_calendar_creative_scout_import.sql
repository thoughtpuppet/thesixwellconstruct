PRAGMA foreign_keys = ON;

-- Import the Atlanta Creative Scout events that Sai explicitly approved for
-- the public Studio Calendar. Editorial intelligence remains in
-- calendar_candidate_notes; the public entries contain factual event data only.

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_words_on_wylie','Cabbagetown Initiative','https://cabbagetown.com/wow','official_html','official',1,24,'automatic','static','{}',datetime('now'),datetime('now')),
  ('cal_source_goat_farm','Goat Farm Arts Programming','https://www.thegoatfarm.info/','official_html','official',1,24,'automatic','static','{}',datetime('now'),datetime('now')),
  ('cal_source_sandler_hudson','Sandler Hudson Gallery','https://www.sandlerhudson.com/','official_html','official',1,24,'automatic','static','{}',datetime('now'),datetime('now'));

-- Bring the original verified Scout seeds up to the current source-authority,
-- access, monitoring, and public-ticket model before publication.
UPDATE calendar_candidates
SET access_status='public',access_notes='',audiences_json='["Public"]',
    event_structure=CASE WHEN date_kind='date_range' THEN 'exhibition' ELSE 'single' END,
    source_authority=CASE
      WHEN source_id='cal_source_eyedrum' THEN 'venue_event'
      ELSE 'organizer_event'
    END,
    organizer_url=CASE
      WHEN source_id='cal_source_atlanta_film_society' THEN 'https://www.atlantafilmsociety.org/'
      WHEN source_id='cal_source_voices_in_power' THEN 'https://voicesinpower.com/'
      WHEN source_id='cal_source_eyedrum' THEN 'https://www.eyedrum.org/'
      ELSE organizer_url
    END,
    venue_url=CASE WHEN source_id='cal_source_eyedrum' THEN 'https://www.eyedrum.org/' ELSE venue_url END,
    schedule_status='scheduled',
    ticket_status=CASE WHEN ticket_url<>'' THEN 'on_sale' ELSE 'not_required' END,
    monitoring_enabled=1,next_check_at=datetime('now'),last_check_status='never',updated_at=datetime('now')
WHERE id IN (
  'cal_candidate_sound_vision','cal_candidate_lost_shadows','cal_candidate_voices_power',
  'cal_candidate_eyedrum_anniversary','cal_candidate_eyedrum_winter'
) AND status<>'published';

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,access_status,access_notes,audiences_json,
   organizer_url,venue_url,source_authority,schedule_status,ticket_status,ticket_notes,
   monitoring_enabled,monitoring_cadence_hours,next_check_at,first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_words_on_wylie','cal_source_words_on_wylie','words-on-wylie-2026',
   'https://cabbagetown.com/wow','https://cabbagetown.com/wow','Words on Wylie 2026','Cabbagetown Initiative',
   'The second annual public reading pairs poets with Forward Warrior murals and includes visual descriptions and recorded or virtual presentation options supporting blind and visually impaired audiences.',
   'single','timed','2026-09-19T17:00:00-04:00',NULL,'America/New_York','Wylie Street Arts Ecosystem near the Krog Street Tunnel','Wylie Street SE, Atlanta, GA 30316','Atlanta','GA',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, format, and public access were confirmed on the official Words on Wylie page.',
   0.98,'seed','creative_scout','public','Public event; RSVP and participation details are available on the official page.','["Public"]',
   'https://cabbagetown.com/','https://cabbagetown.com/wow','organizer_event','scheduled','registration_open','RSVP and poet participation information are available on the official event page.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_gulch_grrl_live','cal_source_goat_farm','cut-corners-presents-grrl',
   'https://www.thegoatfarm.info/events/cut-corners-presents-grrl','https://www.thegoatfarm.info/events/cut-corners-presents-grrl','Cut Corners Presents: GRRL','Cut Corners and Goat Farm',
   'An experimental electronic performance combining boundary-pushing music, immersive visuals, artist installations, movement, and an original stage environment.',
   'single','timed','2026-08-22T20:00:00-04:00','2026-08-22T23:59:00-04:00','America/New_York','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318','Atlanta','GA',
   '["art","poetry-music","creative-technology"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, admission, artists, and format were confirmed on the official Goat Farm event page.',
   0.99,'seed','creative_scout','public','All ages 18+ admission policy and parking details are listed on the official event page.','["Public"]',
   'https://cutcornersatl.com/','https://www.thegoatfarm.info/','venue_event','scheduled','on_sale','Tickets are listed at $20 on the official event page.',
   1,12,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_leaflet_riso','cal_source_goat_farm','leaflet-women-in-riso',
   'https://www.thegoatfarm.info/events/leaflet-women-in-riso','','Leaflet: Women in RISO','Posy Press and Goat Farm',
   'Three Atlanta-based women discuss community-building through risograph printing in an artist talk, moderated panel, and live printing demonstration.',
   'single','timed','2026-09-08T18:00:00-04:00','2026-09-08T21:00:00-04:00','America/New_York','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318','Atlanta','GA',
   '["art","art-making"]','["lecture-talk","panel","workshop"]',1,'candidate','verified','Date, time, venue, participants, and format were confirmed on Goat Farm’s official arts-programming calendar.',
   0.97,'seed','creative_scout','public','Public event; consult the official event page for admission details.','["Public"]',
   'https://www.posypress.co/','https://www.thegoatfarm.info/','venue_event','scheduled','unknown','Admission details were not stated in the source copy.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_site_2026','cal_source_goat_farm','site-2026',
   'https://www.thegoatfarm.info/events/site-2026','https://www.thegoatfarm.info/events/site-2026','SITE 2026','Goat Farm',
   'A one-night campus-wide exhibition of contemporary art, performance, music, film, installation, open studios, experimentation, and site-responsive commissions by more than 50 artists.',
   'single','timed','2026-10-03T17:00:00-04:00','2026-10-03T23:00:00-04:00','America/New_York','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318','Atlanta','GA',
   '["art","film","poetry-music","creative-technology"]','["exhibition","screening","performance","experimental-event"]',1,'candidate','verified','Date, time, venue, lineup, format, and ticket availability were confirmed on the official SITE event page.',
   0.99,'seed','creative_scout','public','All ages; children 12 and under enter free.','["Public"]',
   'https://www.thegoatfarm.info/','https://www.thegoatfarm.info/','venue_event','scheduled','on_sale','Tickets are linked from the official event page.',
   1,12,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_chamber_cartel_pleiades','cal_source_goat_farm','chamber-cartel-pleiades',
   'https://www.thegoatfarm.info/events/chamber-cartel-pleiades','https://www.thegoatfarm.info/events/chamber-cartel-pleiades','Chamber Cartel: Pleiades','Chamber Cartel and Goat Farm',
   'Six percussionists perform Iannis Xenakis’s Pleiades on more than 50 instruments, including six specially built microtonally tuned metal keyboards known as Sixxen.',
   'single','timed','2026-10-24T19:00:00-04:00','2026-10-24T21:00:00-04:00','America/New_York','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318','Atlanta','GA',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, ensemble, program, admission, and instrumentation were confirmed on the official Goat Farm event page.',
   0.98,'seed','creative_scout','public','All ages.','["Public"]',
   'https://chambercartel.com/','https://www.thegoatfarm.info/','venue_event','scheduled','on_sale','General admission is $20; student admission is $15.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_gulch_measure_without','cal_source_sandler_hudson','a-measure-without-2026',
   'https://www.sandlerhudson.com/','','A Measure Without','Sandler Hudson Gallery',
   'A group exhibition featuring In Kyoung Chun, Krista Clark, and Amy Pleasant. The artists use negative space, flattened figures, architectural language, material layering, and temporary walls that restructure the viewer’s experience.',
   'exhibition','date_range','2026-08-20','2026-09-19','America/New_York','Sandler Hudson Gallery','739 Trabert Avenue NW, Suite B, Atlanta, GA 30318','Atlanta','GA',
   '["art"]','["exhibition"]',1,'candidate','verified','Exhibition dates, opening reception, artists, address, and curatorial description were confirmed on the official gallery website.',
   0.98,'seed','creative_scout','public','Opening reception: August 20, 6–9 PM. Regular gallery hours apply afterward.','["Public"]',
   'https://www.sandlerhudson.com/','https://www.sandlerhudson.com/contact-us','venue_event','scheduled','not_required','No ticket requirement is stated by the gallery.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_eyedrum_bryan_day','cal_source_eyedrum','bryan-day-shrimp-ring-klimchak-alexandria-smith',
   'https://www.eyedrum.org/calendar-events-performances-art-music/bryan-day-shrimp-ring-klimchak-alexandria-smith','','Bryan Day, Shrimp Ring, Klimchak & Alexandria Smith','Eyedrum',
   'A sound-art program featuring invented instruments, scavenged electronics, constructivist sound sculpture, everyday objects, interaction-based scores, and improvisation exploring timbre, perception, communication, and reflection.',
   'single','timed','2026-09-17T20:00:00-04:00','2026-09-17T22:30:00-04:00','America/New_York','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','Atlanta','GA',
   '["art","poetry-music","creative-technology"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, artists, materials, and program descriptions were confirmed on the official Eyedrum event page.',
   0.99,'seed','creative_scout','public','Public event; consult the official page for admission details.','["Public"]',
   'https://www.eyedrum.org/','https://www.eyedrum.org/','venue_event','scheduled','unknown','Admission information was not stated on the event page.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_eyedrum_wheelchair_sports','cal_source_eyedrum','gaelynn-lea-wheelchair-sports-camp',
   'https://www.eyedrum.org/calendar-events-performances-art-music/gaelynn-lea-wheelchair-sports-camp','https://www.eyedrum.org/calendar-events-performances-art-music/gaelynn-lea-wheelchair-sports-camp','Wheelchair Sports Camp with Gaelynn Lea','Eyedrum',
   'A wheelchair-accessible, all-ages pairing of disability-led queer punk-powered hip-hop with experimental fiddle, songwriting, and arts-accessibility advocacy.',
   'single','timed','2026-10-10T20:00:00-04:00','2026-10-10T22:30:00-04:00','America/New_York','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','Atlanta','GA',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, accessibility, admission, age policy, and artist descriptions were confirmed on the official Eyedrum event page.',
   0.99,'seed','creative_scout','public','Wheelchair accessible and all ages.','["Public"]',
   'https://www.eyedrum.org/','https://www.eyedrum.org/','venue_event','scheduled','on_sale','Advance tickets are $15; admission is $20 at the door.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now')),

  ('cal_candidate_eyedrum_akchamel','cal_source_eyedrum','akchamel-w-franks',
   'https://www.eyedrum.org/calendar-events-performances-art-music/akchamel-w-franks','https://www.eyedrum.org/calendar-events-performances-art-music/akchamel-w-franks','AK’chamel with Franks','Eyedrum',
   'A masked, hypnotic, droning psychedelic-folk performance structured as ritual and theatrical atmosphere rather than a conventional concert.',
   'single','timed','2026-11-07T20:00:00-05:00','2026-11-07T23:00:00-05:00','America/New_York','Eyedrum','515 Ralph David Abernathy Boulevard SW, Atlanta, GA 30312','Atlanta','GA',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, time, venue, ticket availability, and performance description were confirmed on the official Eyedrum event page.',
   0.98,'seed','creative_scout','public','Public event.','["Public"]',
   'https://www.eyedrum.org/','https://www.eyedrum.org/','venue_event','scheduled','on_sale','Tickets are linked from the official event page.',
   1,24,datetime('now'),datetime('now'),datetime('now'),datetime('now'),datetime('now'));

WITH approved_notes(source_url,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes) AS (
  VALUES
    ('https://cabbagetown.com/wow','Poetry responding to murals, accessibility, and public art form a distinctive cross-medium model.','Attend and network.','Study ekphrasis, accessible descriptions, archives, and public-space pacing.','Cabbagetown Initiative; Forward Warrior; participating muralists and poets.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.thegoatfarm.info/events/cut-corners-presents-grrl','Experimental electronic music, visual installation, movement, and spatial design converge in one environment.','Attend and network.','Study Cut Corners’ integration of stage design, installation, sound, and audience movement.','Cut Corners; Goat Farm; participating installation artists.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.thegoatfarm.info/events/leaflet-women-in-riso','Community print culture and a live material demonstration connect publishing, visual art, and artist education.','Attend and network.','Study the artist-talk, panel, and live-demonstration sequence.','Posy Press; Goat Farm; participating RISO artists.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.thegoatfarm.info/events/site-2026','Campus-wide site-responsive commissions across art, film, performance, music, and installation strongly match Six.Well’s creative-systems research.','Attend and network.','Study concurrent activation of a twelve-acre campus and movement between disciplines.','Goat Farm; SITE artists; Living Walls; L42i; Sound Service.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.thegoatfarm.info/events/chamber-cartel-pleiades','Large-scale percussion, microtonal instruments, and sensory intensity offer a strong experimental performance reference.','Attend for research.','Study spatial sound, unusual instrumentation, duration, and audience focus.','Chamber Cartel; Caleb Herron; Goat Farm.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.sandlerhudson.com/','Negative space, architecture, temporary walls, and perceptual restructuring directly connect to current visual and built-environment interests.','Attend opening and network.','Study how temporary architecture changes the reading of individual works.','Sandler Hudson Gallery; Whitespace Gallery; featured artists.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.eyedrum.org/calendar-events-performances-art-music/bryan-day-shrimp-ring-klimchak-alexandria-smith','Invented instruments, everyday materials, sound sculpture, interaction, perception, and communication make this an exceptionally close match.','Attend and network.','Study object-to-sound translation and structured improvisation.','Bryan Day; Erin Demastes; Dylan Burchett; Klimchak; Alexandria Smith; Eyedrum.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.eyedrum.org/calendar-events-performances-art-music/gaelynn-lea-wheelchair-sports-camp','Queer and disability-led performance, accessibility, hip-hop, punk, installation, theater, and film create a strong community-centered model.','Attend and network.','Study accessibility as a core programming structure rather than an accommodation layer.','Wheelchair Sports Camp; Gaelynn Lea; Eyedrum.','Private Scout intelligence; never return from public APIs.'),
    ('https://www.eyedrum.org/calendar-events-performances-art-music/akchamel-w-franks','Masked ritual, droning psychedelic folk, and theatrical atmosphere strongly align with neo-surreal and ceremonial presentation.','Attend for inspiration.','Study how costume, anonymity, duration, and atmosphere transform a concert into a constructed encounter.','AK’chamel; Franks; Eyedrum.','Private Scout intelligence; never return from public APIs.')
)
INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
SELECT c.id,n.private_rationale,n.attendance_use,n.programming_ideas,n.potential_collaborators,n.internal_notes,datetime('now')
FROM approved_notes n
JOIN calendar_candidates c ON rtrim(c.source_url,'/')=rtrim(n.source_url,'/');

-- Sai approved these verified Scout records for the public Studio Calendar.
-- The public rows deliberately copy factual fields only; no private rationale,
-- attendance use, programming ideas, or collaborator notes cross this boundary.
INSERT OR IGNORE INTO calendar_entries
  (id,candidate_id,uid,sequence,status,source_url,ticket_url,schedule_status,ticket_status,ticket_on_sale_at,ticket_notes,
   organizer_url,venue_url,source_authority,title,organizer,factual_description,event_structure,date_kind,
   access_status,access_notes,audiences_json,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,published_at,last_modified_at,last_verified_at)
SELECT
  replace(id,'cal_candidate_','cal_entry_'),id,replace(id,'cal_candidate_','cal_entry_')||'@thesixwellconstruct.com',0,'published',
  source_url,ticket_url,schedule_status,ticket_status,ticket_on_sale_at,ticket_notes,
  organizer_url,venue_url,source_authority,title,organizer,factual_description,event_structure,date_kind,
  access_status,access_notes,audiences_json,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
  subjects_json,formats_json,is_experimental,datetime('now'),datetime('now'),last_verified_at
FROM calendar_candidates
WHERE (id IN (
  'cal_candidate_sound_vision','cal_candidate_lost_shadows','cal_candidate_voices_power',
  'cal_candidate_eyedrum_anniversary','cal_candidate_eyedrum_winter',
  'cal_candidate_words_on_wylie','cal_candidate_gulch_grrl_live','cal_candidate_leaflet_riso',
  'cal_candidate_site_2026','cal_candidate_chamber_cartel_pleiades','cal_candidate_gulch_measure_without',
  'cal_candidate_eyedrum_bryan_day','cal_candidate_eyedrum_wheelchair_sports','cal_candidate_eyedrum_akchamel'
) OR rtrim(source_url,'/') IN (
  'https://cabbagetown.com/wow','https://www.thegoatfarm.info/events/cut-corners-presents-grrl',
  'https://www.thegoatfarm.info/events/leaflet-women-in-riso','https://www.thegoatfarm.info/events/site-2026',
  'https://www.thegoatfarm.info/events/chamber-cartel-pleiades','https://www.sandlerhudson.com',
  'https://www.eyedrum.org/calendar-events-performances-art-music/bryan-day-shrimp-ring-klimchak-alexandria-smith',
  'https://www.eyedrum.org/calendar-events-performances-art-music/gaelynn-lea-wheelchair-sports-camp',
  'https://www.eyedrum.org/calendar-events-performances-art-music/akchamel-w-franks'
)) AND verification_state='verified' AND starts_at IS NOT NULL;

UPDATE calendar_candidates
SET status='published',
    public_entry_id=(SELECT id FROM calendar_entries WHERE candidate_id=calendar_candidates.id),
    pending_revision_id='',rejection_reason='',updated_at=datetime('now')
WHERE (id IN (
  'cal_candidate_sound_vision','cal_candidate_lost_shadows','cal_candidate_voices_power',
  'cal_candidate_eyedrum_anniversary','cal_candidate_eyedrum_winter',
  'cal_candidate_words_on_wylie','cal_candidate_gulch_grrl_live','cal_candidate_leaflet_riso',
  'cal_candidate_site_2026','cal_candidate_chamber_cartel_pleiades','cal_candidate_gulch_measure_without',
  'cal_candidate_eyedrum_bryan_day','cal_candidate_eyedrum_wheelchair_sports','cal_candidate_eyedrum_akchamel'
) OR rtrim(source_url,'/') IN (
  'https://cabbagetown.com/wow','https://www.thegoatfarm.info/events/cut-corners-presents-grrl',
  'https://www.thegoatfarm.info/events/leaflet-women-in-riso','https://www.thegoatfarm.info/events/site-2026',
  'https://www.thegoatfarm.info/events/chamber-cartel-pleiades','https://www.sandlerhudson.com',
  'https://www.eyedrum.org/calendar-events-performances-art-music/bryan-day-shrimp-ring-klimchak-alexandria-smith',
  'https://www.eyedrum.org/calendar-events-performances-art-music/gaelynn-lea-wheelchair-sports-camp',
  'https://www.eyedrum.org/calendar-events-performances-art-music/akchamel-w-franks'
)) AND status<>'published'
  AND EXISTS (SELECT 1 FROM calendar_entries WHERE candidate_id=calendar_candidates.id);

UPDATE calendar_candidate_revisions
SET revision_state='approved',reviewed_at=datetime('now')
WHERE candidate_id IN (
  'cal_candidate_sound_vision','cal_candidate_lost_shadows','cal_candidate_voices_power',
  'cal_candidate_eyedrum_anniversary','cal_candidate_eyedrum_winter'
) AND revision_state='pending'
  AND EXISTS (
    SELECT 1 FROM calendar_candidates c
    WHERE c.id=calendar_candidate_revisions.candidate_id
      AND c.public_entry_id=replace(c.id,'cal_candidate_','cal_entry_')
  );

-- SYNERGY remains in the private queue because the official Kai Lin source no
-- longer exposes a confirmable start date. It must not be published with an
-- invented date.
DELETE FROM calendar_entries WHERE candidate_id='cal_candidate_synergy';

UPDATE calendar_candidates
SET status='needs_verification',verification_state='needs_verification',monitoring_enabled=1,
    public_entry_id='',next_check_at=datetime('now'),updated_at=datetime('now')
WHERE id='cal_candidate_synergy';
