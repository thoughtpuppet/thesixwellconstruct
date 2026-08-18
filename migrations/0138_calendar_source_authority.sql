PRAGMA foreign_keys = ON;

-- Discovery publications, newsletters, aggregators, and social posts are leads,
-- not public event authorities. Keep the lead privately on the candidate while
-- an approved snapshot carries only direct organizer, venue, or authorized
-- ticket-host references.

ALTER TABLE calendar_candidates ADD COLUMN discovery_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN organizer_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN venue_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN source_authority TEXT NOT NULL DEFAULT 'unresolved'
  CHECK (source_authority IN ('organizer_event','venue_event','official_calendar','authorized_ticket_host','unresolved'));
ALTER TABLE calendar_candidates ADD COLUMN source_resolution_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_entries ADD COLUMN organizer_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN venue_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN source_authority TEXT NOT NULL DEFAULT 'unresolved'
  CHECK (source_authority IN ('organizer_event','venue_event','official_calendar','authorized_ticket_host','unresolved'));

ALTER TABLE calendar_candidate_links ADD COLUMN link_role TEXT NOT NULL DEFAULT 'supporting'
  CHECK (link_role IN ('organizer','venue','ticket','supporting','discovery'));
ALTER TABLE calendar_entry_links ADD COLUMN link_role TEXT NOT NULL DEFAULT 'supporting'
  CHECK (link_role IN ('organizer','venue','ticket','supporting'));

-- Existing candidates tied to a registered first-party source retain their
-- verified standing. Discovery sources and unattributed manual leads remain
-- unresolved until Studio records the true original source.
UPDATE calendar_candidates
SET source_authority='official_calendar',
    organizer_url=source_url,
    source_resolution_notes='Backfilled from a registered direct source.'
WHERE source_url<>''
  AND source_id IN (
    SELECT id FROM calendar_sources
    WHERE source_type<>'discovery' AND trust_level IN ('official','trusted')
  );

UPDATE calendar_candidates
SET discovery_url=source_url,
    source_authority='unresolved',
    source_resolution_notes='Secondary discovery lead retained privately; resolve an original event source before publication.'
WHERE source_url LIKE '%gulchmagazine.com%'
   OR source_id IN (
     SELECT id FROM calendar_sources
     WHERE source_type='discovery' OR trust_level='discovery'
   );

UPDATE calendar_entries
SET organizer_url=source_url,
    source_authority='official_calendar'
WHERE source_url<>'';

UPDATE calendar_candidate_links
SET link_role='discovery',include_public=0
WHERE url LIKE '%instagram.com/%'
   OR url LIKE '%threads.net/%'
   OR url LIKE '%tiktok.com/%'
   OR url LIKE '%gulchmagazine.com/%'
   OR url LIKE '%artsatl.org/%';
