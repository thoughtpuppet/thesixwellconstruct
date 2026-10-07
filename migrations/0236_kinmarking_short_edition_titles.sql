-- Shorten the working edition titles without changing schedules or identities.
-- Preserve subsequent Studio title edits.
UPDATE event_occurrences
SET title = CASE session_number
      WHEN '02' THEN 'Color & Tattooing'
      WHEN '03' THEN 'Iconography & Tattooing'
      WHEN '04' THEN 'Symbolism, Composition & Tattooing'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND ((session_number = '02' AND title IN ('Color as Inheritance', 'Color'))
    OR (session_number = '03' AND title IN ('Symbols as Language', 'Symbols', 'Iconography'))
    OR (session_number = '04' AND title IN ('', 'Symbolism and Composition', 'Symbolism and Composition & Tattooing')));
