-- Repair Monday Night Creative Music occurrence instants that were displayed as
-- UTC clock values in Studio and then saved as Atlanta-local clock values.
-- The affected Eyedrum listings are Monday 8:00 PM–10:30 PM performances; the
-- corrupted rows read Tuesday 12:00 AM–2:30 AM with an EDT offset.

UPDATE calendar_entry_occurrences
SET starts_at = replace(datetime(substr(starts_at, 1, 19), '-4 hours'), ' ', 'T') || '-04:00',
    ends_at = CASE
      WHEN ends_at IS NULL OR ends_at = '' THEN ends_at
      ELSE replace(datetime(substr(ends_at, 1, 19), '-4 hours'), ' ', 'T') || '-04:00'
    END,
    sequence = sequence + 1,
    last_modified_at = datetime('now')
WHERE candidate_occurrence_id IN (
  SELECT occurrence.id
  FROM calendar_candidate_occurrences occurrence
  JOIN calendar_candidates parent ON parent.id = occurrence.candidate_id
  WHERE parent.source_event_id = 'eyedrum-series-monday-night-creative-music'
    AND occurrence.starts_at GLOB '????-??-??T00:00:00-04:00'
);

UPDATE calendar_candidate_occurrences
SET starts_at = replace(datetime(substr(starts_at, 1, 19), '-4 hours'), ' ', 'T') || '-04:00',
    ends_at = CASE
      WHEN ends_at IS NULL OR ends_at = '' THEN ends_at
      ELSE replace(datetime(substr(ends_at, 1, 19), '-4 hours'), ' ', 'T') || '-04:00'
    END,
    updated_at = datetime('now')
WHERE candidate_id IN (
  SELECT id
  FROM calendar_candidates
  WHERE source_event_id = 'eyedrum-series-monday-night-creative-music'
)
  AND starts_at GLOB '????-??-??T00:00:00-04:00';

UPDATE calendar_candidates
SET starts_at = (
      SELECT min(substr(starts_at, 1, 10))
      FROM calendar_candidate_occurrences
      WHERE candidate_id = calendar_candidates.id
        AND status <> 'cancelled'
        AND starts_at IS NOT NULL
        AND starts_at <> ''
    ),
    ends_at = (
      SELECT max(substr(starts_at, 1, 10))
      FROM calendar_candidate_occurrences
      WHERE candidate_id = calendar_candidates.id
        AND status <> 'cancelled'
        AND starts_at IS NOT NULL
        AND starts_at <> ''
    ),
    updated_at = datetime('now')
WHERE source_event_id = 'eyedrum-series-monday-night-creative-music'
  AND EXISTS (
    SELECT 1
    FROM calendar_candidate_occurrences
    WHERE candidate_id = calendar_candidates.id
  );

UPDATE calendar_entries
SET starts_at = (
      SELECT starts_at
      FROM calendar_candidates
      WHERE id = calendar_entries.candidate_id
    ),
    ends_at = (
      SELECT ends_at
      FROM calendar_candidates
      WHERE id = calendar_entries.candidate_id
    ),
    sequence = sequence + 1,
    last_modified_at = datetime('now')
WHERE candidate_id IN (
  SELECT id
  FROM calendar_candidates
  WHERE source_event_id = 'eyedrum-series-monday-night-creative-music'
);
