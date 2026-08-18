PRAGMA foreign_keys = ON;

-- Migration 0136 added attendance eligibility after some candidates had
-- already been published. Bring those existing public snapshots into line
-- with their approved candidate facts and advance the calendar revision so
-- subscribed clients can retrieve the corrected access information.
UPDATE calendar_entries
SET access_status=(
      SELECT c.access_status
      FROM calendar_candidates c
      WHERE c.id=calendar_entries.candidate_id
    ),
    access_notes=(
      SELECT c.access_notes
      FROM calendar_candidates c
      WHERE c.id=calendar_entries.candidate_id
    ),
    audiences_json=(
      SELECT c.audiences_json
      FROM calendar_candidates c
      WHERE c.id=calendar_entries.candidate_id
    ),
    sequence=sequence+1,
    last_modified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    last_verified_at=(
      SELECT c.last_verified_at
      FROM calendar_candidates c
      WHERE c.id=calendar_entries.candidate_id
    )
WHERE EXISTS (
  SELECT 1
  FROM calendar_candidates c
  WHERE c.id=calendar_entries.candidate_id
    AND c.public_entry_id=calendar_entries.id
    AND (
      c.access_status<>calendar_entries.access_status
      OR c.access_notes<>calendar_entries.access_notes
      OR c.audiences_json<>calendar_entries.audiences_json
    )
);
