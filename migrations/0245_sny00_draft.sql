-- Review draft only. Applying this does not open registration or publish a page.
-- Keep the 2027 annual SNY showcase and the existing Signal & Symbol intact.
-- A matching name/date requires reconciliation instead of a duplicate record.
INSERT OR IGNORE INTO site_visibility_rules(path,visibility,scope,updated_by,updated_at)
VALUES('/events/sny-00','hidden','descendants','migration-0245',datetime('now'));

INSERT INTO events (
  id,slug,title,description,details,starts_at,ends_at,location,price_cents,currency,
  capacity,max_seats_per_order,status,publication_state,waitlist_enabled,
  private_rsvp_enabled,created_at,updated_at
)
SELECT 'evt_sny_00','sny-00','SNY 00',
  'A small Signal & Symbol gathering.',
  'A green[field] introduction, KINMARKING, and a presentation by Saiel Solehman. A site presentation may be included if ready.',
  '2026-11-06T18:30:00-05:00','2026-11-06T21:30:00-05:00','',0,'USD',
  0,1,'closed','draft',0,1,datetime('now'),datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM events e WHERE e.slug='sny-00'
    OR lower(replace(replace(e.title,' ',''),'-',''))='sny00'
    OR julianday(e.starts_at)=julianday('2026-11-06T18:30:00-05:00')
    OR EXISTS (SELECT 1 FROM event_occurrences o WHERE o.event_id=e.id
      AND julianday(o.starts_at)=julianday('2026-11-06T18:30:00-05:00'))
)
ON CONFLICT DO NOTHING;

INSERT OR IGNORE INTO content_entities (
  id,entity_type,node_id,visibility,search_visibility,public_at,
  created_by,updated_by,created_at,updated_at
)
SELECT id,'event','node-events','internal',0,NULL,'migration-0245','migration-0245',
  datetime('now'),datetime('now') FROM events
WHERE id='evt_sny_00' AND slug='sny-00' AND publication_state='draft';

INSERT INTO event_occurrences (
  id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,
  sort_order,created_at,updated_at
)
SELECT 'occ_sny_00_2026_11_06',id,starts_at,ends_at,'',0,1,'closed',0,
  datetime('now'),datetime('now') FROM events
WHERE id='evt_sny_00' AND slug='sny-00' AND private_rsvp_enabled=1
  AND NOT EXISTS (SELECT 1 FROM event_occurrences WHERE event_id='evt_sny_00')
ON CONFLICT DO NOTHING;
