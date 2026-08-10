-- Separate the editorial visibility of an event from its operational state.
-- Announced events are public records without active registration actions.

ALTER TABLE events
ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft'
CHECK (publication_state IN ('draft','announced','published'));

UPDATE events
SET publication_state = CASE
  WHEN status = 'draft' THEN 'draft'
  ELSE 'published'
END;

UPDATE events
SET status = 'closed'
WHERE status = 'draft';

UPDATE content_entities
SET
  visibility = CASE
    WHEN EXISTS (
      SELECT 1 FROM events
      WHERE events.id = content_entities.id
        AND events.publication_state IN ('announced','published')
    ) THEN 'public'
    ELSE 'internal'
  END,
  search_visibility = CASE
    WHEN EXISTS (
      SELECT 1 FROM events
      WHERE events.id = content_entities.id
        AND events.publication_state IN ('announced','published')
    ) THEN 1
    ELSE 0
  END,
  public_at = CASE
    WHEN EXISTS (
      SELECT 1 FROM events
      WHERE events.id = content_entities.id
        AND events.publication_state IN ('announced','published')
    ) THEN COALESCE(public_at, datetime('now'))
    ELSE public_at
  END,
  updated_by = 'migration-0119',
  updated_at = datetime('now')
WHERE entity_type = 'event';
