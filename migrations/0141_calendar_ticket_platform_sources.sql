PRAGMA foreign_keys = ON;

-- Ticket platforms are discovery systems. Their listing pages and organizer
-- profiles remain private provenance; only exact event pages can become an
-- authorized ticket-host source, and those still require organizer or venue
-- support before publication.

UPDATE calendar_sources
SET enabled=0,source_type='discovery',trust_level='discovery',updated_at=datetime('now')
WHERE url IN ('https://www.eventbrite.com/','https://eventbrite.com/')
  AND EXISTS (
    SELECT 1 FROM calendar_sources
    WHERE url='https://www.eventbrite.com/d/ga--atlanta/events/'
  );

UPDATE calendar_sources
SET name='Eventbrite Atlanta',url='https://www.eventbrite.com/d/ga--atlanta/events/',
    source_type='discovery',trust_level='discovery',enabled=1,cadence_hours=24,
    adapter_key='automatic',render_mode='dynamic-fallback',
    adapter_config_json='{"platform":"eventbrite","maxChildren":20}',updated_at=datetime('now')
WHERE url IN ('https://www.eventbrite.com/','https://eventbrite.com/')
  AND NOT EXISTS (
    SELECT 1 FROM calendar_sources
    WHERE url='https://www.eventbrite.com/d/ga--atlanta/events/'
  );

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_eventbrite_atlanta','Eventbrite Atlanta','https://www.eventbrite.com/d/ga--atlanta/events/',
   'discovery','discovery',1,24,'automatic','dynamic-fallback',
   '{"platform":"eventbrite","maxChildren":20}',datetime('now'),datetime('now')),
  ('cal_source_posh_atlanta','Posh Atlanta','https://posh.vip/explore?location=%7B%22type%22%3A%22preset%22%2C%22location%22%3A%22Atlanta%22%2C%22lat%22%3A33.749%2C%22long%22%3A-84.388%7D',
   'discovery','discovery',1,24,'automatic','dynamic-fallback',
   '{"platform":"posh","city":"Atlanta","region":"GA","maxChildren":20,"eventUrls":["https://posh.vip/e/open-house-art-auction"]}',datetime('now'),datetime('now'));

UPDATE calendar_sources
SET name='Eventbrite Atlanta',source_type='discovery',trust_level='discovery',enabled=1,cadence_hours=24,
    adapter_key='automatic',render_mode='dynamic-fallback',
    adapter_config_json='{"platform":"eventbrite","maxChildren":20}',updated_at=datetime('now')
WHERE url='https://www.eventbrite.com/d/ga--atlanta/events/';

UPDATE calendar_sources
SET name='Posh Atlanta',source_type='discovery',trust_level='discovery',enabled=1,cadence_hours=24,
    adapter_key='automatic',render_mode='dynamic-fallback',
    adapter_config_json='{"platform":"posh","city":"Atlanta","region":"GA","maxChildren":20,"eventUrls":["https://posh.vip/e/open-house-art-auction"]}',updated_at=datetime('now')
WHERE url='https://posh.vip/explore?location=%7B%22type%22%3A%22preset%22%2C%22location%22%3A%22Atlanta%22%2C%22lat%22%3A33.749%2C%22long%22%3A-84.388%7D';

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,access_status,access_notes,audiences_json,
   discovery_url,organizer_url,venue_url,source_authority,source_resolution_notes,
   first_seen_at,created_at,updated_at)
SELECT
  'cal_candidate_posh_orca_open_house_2026',id,'posh-open-house-art-auction',
  'https://posh.vip/e/open-house-art-auction','https://posh.vip/e/open-house-art-auction',
  'Open House & Art Showcase','ORCA',
  'An open-house networking and art experience with a silent art auction, wine, hors d''oeuvres, and shuttle parking.',
  'single','timed','2026-08-23T16:00:00-04:00','2026-08-23T19:00:00-04:00','America/New_York',
  'Open House','6000 Lake Forrest Dr NW, Sandy Springs, GA 30328, USA','Sandy Springs','GA',
  '["art"]','["exhibition"]',0,'needs_verification','needs_verification',
  'The exact Posh page and flyer establish the title, date, 4:00 PM-7:00 PM end time, address, silent auction, and shuttle parking. Confirm ORCA or the venue on an official website before publication.',
  0.72,'seed','direct','public',
  'RSVP through Posh. A shuttle will be provided for guests from the parking location shown on the flyer.','["Public"]',
  'https://posh.vip/explore?location=%7B%22type%22%3A%22preset%22%2C%22location%22%3A%22Atlanta%22%2C%22lat%22%3A33.749%2C%22long%22%3A-84.388%7D','','','authorized_ticket_host',
  'The exact Posh ticket page supplies event facts, but an official organizer or venue website is still required.',
  datetime('now'),datetime('now'),datetime('now')
FROM calendar_sources
WHERE url='https://posh.vip/explore?location=%7B%22type%22%3A%22preset%22%2C%22location%22%3A%22Atlanta%22%2C%22lat%22%3A33.749%2C%22long%22%3A-84.388%7D';

INSERT OR IGNORE INTO calendar_candidate_links
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role)
VALUES
  ('cal_link_posh_orca_group','cal_candidate_posh_orca_open_house_2026','ORCA on Posh',
   'https://posh.vip/g/orca','https://posh.vip/e/open-house-art-auction',0,0,datetime('now'),datetime('now'),'discovery');
