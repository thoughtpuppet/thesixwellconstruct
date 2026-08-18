PRAGMA foreign_keys = ON;

-- A related program can have its own official detail page and a separate
-- registration destination. Keep both on the occurrence instead of inheriting
-- the parent exhibition URL.
UPDATE calendar_candidate_occurrences
SET source_url='https://high.org/event/behind-the-scenes-with-walter-wick/',
    ticket_url='https://my.high.org/169092/169739',
    verification_notes='Date, time, venue, pricing, event details, and the public registration destination were verified on the official High Museum event page.',
    updated_at=datetime('now')
WHERE candidate_id IN (
  SELECT id FROM calendar_candidates
  WHERE lower(title) LIKE 'i spy! walter wick%hidden wonders'
)
AND lower(title) LIKE 'behind the scenes with walter wick%';

-- Keep the candidate's pending snapshot aligned so approving it cannot restore
-- the homepage-level source or discard the occurrence registration URL.
UPDATE calendar_candidate_revisions
SET snapshot_json=json_set(
      snapshot_json,
      '$.occurrences[0].sourceUrl','https://high.org/event/behind-the-scenes-with-walter-wick/',
      '$.occurrences[0].ticketUrl','https://my.high.org/169092/169739',
      '$.occurrences[0].verificationNotes','Date, time, venue, pricing, event details, and the public registration destination were verified on the official High Museum event page.'
    )
WHERE candidate_id IN (
  SELECT id FROM calendar_candidates
  WHERE lower(title) LIKE 'i spy! walter wick%hidden wonders'
)
AND json_extract(snapshot_json,'$.occurrences[0].title') LIKE 'Behind the Scenes with Walter Wick%';

-- If the candidate was approved between discovery and this migration, update
-- the already-public occurrence and advance its calendar sequence.
UPDATE calendar_entry_occurrences
SET source_url='https://high.org/event/behind-the-scenes-with-walter-wick/',
    ticket_url='https://my.high.org/169092/169739',
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE candidate_occurrence_id IN (
  SELECT o.id
  FROM calendar_candidate_occurrences o
  JOIN calendar_candidates c ON c.id=o.candidate_id
  WHERE lower(c.title) LIKE 'i spy! walter wick%hidden wonders'
    AND lower(o.title) LIKE 'behind the scenes with walter wick%'
)
AND (
  source_url<>'https://high.org/event/behind-the-scenes-with-walter-wick/'
  OR ticket_url<>'https://my.high.org/169092/169739'
);

UPDATE calendar_candidates
SET updated_at=datetime('now')
WHERE lower(title) LIKE 'i spy! walter wick%hidden wonders';
