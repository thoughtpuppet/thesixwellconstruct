-- Give the existing second and third dates their edition names without
-- changing occurrence identities, schedules, registration, or publication.
UPDATE event_occurrences
SET title = CASE session_number
      WHEN '02' THEN 'Color as Inheritance'
      WHEN '03' THEN 'Symbols as Language'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND session_number IN ('02', '03')
  AND title = '';
