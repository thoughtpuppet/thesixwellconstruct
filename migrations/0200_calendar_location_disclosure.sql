PRAGMA foreign_keys = ON;

-- Some legitimate ticketed events intentionally disclose their physical
-- address only after registration or purchase. Keep that policy distinct
-- from an ordinary missing venue so Studio can verify and publish it without
-- inventing an address, while route planning remains unavailable.
ALTER TABLE calendar_candidates ADD COLUMN location_disclosure TEXT NOT NULL DEFAULT 'public'
  CHECK (location_disclosure IN ('public','after_registration'));
ALTER TABLE calendar_entries ADD COLUMN location_disclosure TEXT NOT NULL DEFAULT 'public'
  CHECK (location_disclosure IN ('public','after_registration'));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN location_disclosure TEXT NOT NULL DEFAULT 'public'
  CHECK (location_disclosure IN ('public','after_registration'));
ALTER TABLE calendar_entry_occurrences ADD COLUMN location_disclosure TEXT NOT NULL DEFAULT 'public'
  CHECK (location_disclosure IN ('public','after_registration'));

-- Backfill only records whose own stored public facts explicitly describe
-- delayed location disclosure. Organizer- or venue-wide records are never
-- inferred from this migration.
UPDATE calendar_candidates
SET location_disclosure='after_registration',updated_at=datetime('now')
WHERE trim(COALESCE(venue_address,''))=''
  AND (
    lower(COALESCE(ticket_notes,'') || ' ' || COALESCE(access_notes,'') || ' ' || COALESCE(factual_description,'')) GLOB '*address*after*ticket*'
    OR lower(COALESCE(ticket_notes,'') || ' ' || COALESCE(access_notes,'') || ' ' || COALESCE(factual_description,'')) GLOB '*location*after*registration*'
  );

UPDATE calendar_candidate_occurrences
SET location_disclosure='after_registration',updated_at=datetime('now')
WHERE trim(COALESCE(venue_address,''))=''
  AND (
    lower(COALESCE(ticket_notes,'') || ' ' || COALESCE(access_notes,'') || ' ' || COALESCE(factual_description,'')) GLOB '*address*after*ticket*'
    OR lower(COALESCE(ticket_notes,'') || ' ' || COALESCE(access_notes,'') || ' ' || COALESCE(factual_description,'')) GLOB '*location*after*registration*'
  );

UPDATE calendar_entries
SET location_disclosure=(
      SELECT c.location_disclosure FROM calendar_candidates c WHERE c.id=calendar_entries.candidate_id
    ),last_modified_at=datetime('now')
WHERE EXISTS (
  SELECT 1 FROM calendar_candidates c
  WHERE c.id=calendar_entries.candidate_id AND c.location_disclosure='after_registration'
);

UPDATE calendar_entry_occurrences
SET location_disclosure=(
      SELECT o.location_disclosure FROM calendar_candidate_occurrences o
      WHERE o.id=calendar_entry_occurrences.candidate_occurrence_id
    ),last_modified_at=datetime('now')
WHERE EXISTS (
  SELECT 1 FROM calendar_candidate_occurrences o
  WHERE o.id=calendar_entry_occurrences.candidate_occurrence_id
    AND o.location_disclosure='after_registration'
);

PRAGMA foreign_keys = ON;
