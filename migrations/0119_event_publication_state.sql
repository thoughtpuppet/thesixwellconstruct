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

DROP TRIGGER IF EXISTS trg_connections_events_insert;
DROP TRIGGER IF EXISTS trg_connections_events_update;

CREATE TRIGGER trg_events_legacy_draft_status
AFTER INSERT ON events
WHEN NEW.status = 'draft' BEGIN
  UPDATE events SET status = 'closed' WHERE id = NEW.id;
END;

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

CREATE TRIGGER trg_connections_events_insert
AFTER INSERT ON events BEGIN
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
  VALUES (
    NEW.id,
    'event',
    'node-events',
    CASE WHEN NEW.publication_state IN ('announced','published') THEN 'public' ELSE 'internal' END,
    CASE WHEN NEW.publication_state IN ('announced','published') THEN 1 ELSE 0 END,
    CASE WHEN NEW.publication_state IN ('announced','published') THEN NEW.updated_at ELSE NULL END,
    'events',
    'events',
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER trg_connections_events_update
AFTER UPDATE OF publication_state,updated_at ON events BEGIN
  UPDATE content_entities SET
    visibility = CASE WHEN NEW.publication_state IN ('announced','published') THEN 'public' ELSE 'internal' END,
    search_visibility = CASE WHEN NEW.publication_state IN ('announced','published') THEN 1 ELSE 0 END,
    public_at = CASE
      WHEN NEW.publication_state IN ('announced','published') THEN COALESCE(public_at,NEW.updated_at)
      ELSE public_at
    END,
    updated_by = 'events',
    updated_at = NEW.updated_at
  WHERE id = NEW.id;
END;
