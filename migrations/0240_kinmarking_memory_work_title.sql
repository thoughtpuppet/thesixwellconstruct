-- Rename edition 01 without changing its occurrence, schedule, or reservations.
UPDATE event_occurrences
SET title = 'Memory Work & Tattooing',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND session_number = '01'
  AND title IN ('Skin As Archive', 'Oral Histories & Tattooing');

-- Keep edition-scoped collaborator credits on the current canonical URL.
UPDATE collaborator_credits
SET route = '/events/kinmarking-01-memory-work-and-tattooing/'
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND edition_number = '01'
  AND route IN (
    '/events/kinmarking-01-skin-as-archive/',
    '/events/kinmarking-01-oral-histories-and-tattooing/'
  );
