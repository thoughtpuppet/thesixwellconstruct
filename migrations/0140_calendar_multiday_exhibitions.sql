PRAGMA foreign_keys = ON;

-- Some imported exhibitions arrived as one timed event whose opening and
-- closing timestamps were months apart. Treat that interval as on-view
-- metadata, not as a continuous event on every day of the month grid.
UPDATE calendar_candidate_revisions
SET snapshot_json=json_set(
      snapshot_json,
      '$.eventStructure','exhibition',
      '$.dateKind','date_range',
      '$.startsAt',substr(json_extract(snapshot_json,'$.startsAt'),1,10),
      '$.endsAt',substr(json_extract(snapshot_json,'$.endsAt'),1,10)
    )
WHERE candidate_id IN (
  SELECT id
  FROM calendar_candidates
  WHERE event_structure='single'
    AND date_kind='timed'
    AND formats_json LIKE '%exhibition%'
    AND ends_at IS NOT NULL
    AND substr(starts_at,1,10)<>substr(ends_at,1,10)
);

UPDATE calendar_entries
SET event_structure='exhibition',
    date_kind='date_range',
    starts_at=substr(starts_at,1,10),
    ends_at=substr(ends_at,1,10),
    sequence=sequence+1,
    last_modified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_structure='single'
  AND date_kind='timed'
  AND formats_json LIKE '%exhibition%'
  AND ends_at IS NOT NULL
  AND substr(starts_at,1,10)<>substr(ends_at,1,10);

UPDATE calendar_candidates
SET event_structure='exhibition',
    date_kind='date_range',
    starts_at=substr(starts_at,1,10),
    ends_at=substr(ends_at,1,10),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_structure='single'
  AND date_kind='timed'
  AND formats_json LIKE '%exhibition%'
  AND ends_at IS NOT NULL
  AND substr(starts_at,1,10)<>substr(ends_at,1,10);
