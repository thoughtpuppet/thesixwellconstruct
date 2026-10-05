-- Keep edition 01 on November 21, 2026 and move editions 02–04 to the third
-- Saturday every two months. Preserve existing occurrence IDs and operations.
-- Later start/end times and venue arrangements remain separate planning details.
UPDATE event_occurrences
SET starts_at = CASE session_number
      WHEN '02' THEN '2027-01-16T19:00:00.000Z'
      WHEN '03' THEN '2027-03-20T18:00:00.000Z'
      WHEN '04' THEN '2027-05-15T18:00:00.000Z'
    END,
    ends_at = CASE session_number
      WHEN '02' THEN '2027-01-17T00:00:00.000Z'
      WHEN '03' THEN '2027-03-20T23:00:00.000Z'
      WHEN '04' THEN '2027-05-15T23:00:00.000Z'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug = 'kinmarking')
  AND ((session_number = '02' AND starts_at IN ('2027-03-20T18:00:00.000Z','2027-03-20T18:00:00Z'))
    OR (session_number = '03' AND starts_at IN ('2027-07-17T18:00:00.000Z','2027-07-17T18:00:00Z'))
    OR (session_number = '04' AND starts_at IN ('2027-11-20T19:00:00.000Z','2027-11-20T19:00:00Z')));
