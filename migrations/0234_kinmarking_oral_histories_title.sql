-- Rename the first edition while preserving its occurrence identity, schedule,
-- registration state, and existing links. Keep later Studio title edits intact.
UPDATE event_occurrences
SET title = 'Oral Histories & Tattooing',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND session_number = '01'
  AND title = 'Skin As Archive';
