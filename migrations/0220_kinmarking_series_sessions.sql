PRAGMA foreign_keys = ON;

-- A recurring Event date can carry its own public session identity while all
-- operations, correspondence, and Archive ownership remain on one parent Event.
ALTER TABLE event_occurrences
ADD COLUMN session_number TEXT NOT NULL DEFAULT '';

ALTER TABLE event_occurrences
ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Preserve the four existing occurrence identities while consolidating their
-- separate Event records into the first record's canonical identity.
UPDATE event_occurrences
SET session_number = CASE (
      SELECT slug FROM events WHERE events.id=event_occurrences.event_id
    )
      WHEN 'kinmarking-01-skin-as-archive' THEN '01'
      WHEN 'kinmarking-02' THEN '02'
      WHEN 'kinmarking-03' THEN '03'
      WHEN 'kinmarking-04' THEN '04'
      ELSE session_number
    END,
    title = CASE (
      SELECT slug FROM events WHERE events.id=event_occurrences.event_id
    )
      WHEN 'kinmarking-01-skin-as-archive' THEN 'Skin As Archive'
      ELSE title
    END,
    sort_order = CASE (
      SELECT slug FROM events WHERE events.id=event_occurrences.event_id
    )
      WHEN 'kinmarking-01-skin-as-archive' THEN 0
      WHEN 'kinmarking-02' THEN 1
      WHEN 'kinmarking-03' THEN 2
      WHEN 'kinmarking-04' THEN 3
      ELSE sort_order
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (
  SELECT id FROM events WHERE slug IN (
    'kinmarking-01-skin-as-archive','kinmarking-02','kinmarking-03','kinmarking-04'
  )
);

UPDATE event_tickets
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

UPDATE event_waitlist
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

UPDATE event_open_mic_signups
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

UPDATE event_admission_options
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

UPDATE crm_attendance
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

UPDATE event_occurrences
SET event_id=(SELECT id FROM events WHERE slug='kinmarking-01-skin-as-archive')
WHERE event_id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'))
  AND EXISTS(SELECT 1 FROM events WHERE slug='kinmarking-01-skin-as-archive');

-- The child records were announced placeholders with no registrations. Their
-- private draft Archive dossiers cascade with their content identities.
DELETE FROM content_entities
WHERE id IN (SELECT id FROM events WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04'));

DELETE FROM events
WHERE slug IN ('kinmarking-02','kinmarking-03','kinmarking-04');

UPDATE events
SET slug='kinmarking',
    title='KINMARKING',
    description='A participatory memory, archive, and tattoo practice exploring how photographs, documents, objects, stories, inherited symbols, and family histories may be interpreted as marks carried in the skin.',
    is_recurring=1,
    waitlist_enabled=0,
    starts_at=(SELECT starts_at FROM event_occurrences WHERE event_id=events.id ORDER BY sort_order,starts_at LIMIT 1),
    ends_at=(SELECT ends_at FROM event_occurrences WHERE event_id=events.id ORDER BY sort_order,starts_at LIMIT 1),
    status='closed',
    publication_state='announced',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug='kinmarking-01-skin-as-archive';

UPDATE archive_dossiers
SET archive_slug='kinmarking',
    updated_by='migration-0220',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE entity_id=(SELECT id FROM events WHERE slug='kinmarking');
