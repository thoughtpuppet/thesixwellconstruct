-- 2026-10-16: retain the earlier title migrations and rename only edition 01.
-- Preserve occurrence identity, schedules, reservations, and later Studio edits.
-- The canonical URL remains /events/kinmarking-01-memory-work-and-tattooing/.
UPDATE event_occurrences
SET title = 'Memory Work, Oral Histories and Tattooing',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND session_number = '01'
  AND title IN ('Skin As Archive', 'Oral Histories & Tattooing', 'Memory Work & Tattooing');
