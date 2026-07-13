PRAGMA foreign_keys = ON;

-- Canonical runtime palette. CSS custom properties remain the client fallback.
UPDATE construct_nodes SET color='#6E0404',updated_at=datetime('now') WHERE id='node-tattoos';
UPDATE construct_nodes SET color='#0039BD',updated_at=datetime('now') WHERE id='node-art';
UPDATE construct_nodes SET color='#F08000',updated_at=datetime('now') WHERE id='node-merch';
UPDATE construct_nodes SET color='#FCB467',updated_at=datetime('now') WHERE id='node-about';
UPDATE construct_nodes SET color='#005D25',updated_at=datetime('now') WHERE id='node-events';
UPDATE construct_nodes SET color='#A22F8D',updated_at=datetime('now') WHERE id='node-music';
UPDATE construct_nodes SET color='#FFE7CA',updated_at=datetime('now') WHERE id='node-writings';
UPDATE construct_nodes SET color='#6D3D15',updated_at=datetime('now') WHERE id='node-archive';
UPDATE construct_nodes SET color='#00857A',updated_at=datetime('now') WHERE id='node-film';

-- Events predate the entity registry. Register existing and future events so they
-- can participate in Connections without changing the ticketing data model.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
SELECT id,'event','node-events',CASE WHEN status IN ('open','closed') THEN 'public' ELSE 'internal' END,
  CASE WHEN status IN ('open','closed') THEN 1 ELSE 0 END,
  CASE WHEN status IN ('open','closed') THEN COALESCE(updated_at,datetime('now')) ELSE NULL END,
  'migration-0030','migration-0030',created_at,updated_at
FROM events;

CREATE TRIGGER IF NOT EXISTS trg_connections_events_insert
AFTER INSERT ON events BEGIN
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
  VALUES (NEW.id,'event','node-events',CASE WHEN NEW.status IN ('open','closed') THEN 'public' ELSE 'internal' END,
    CASE WHEN NEW.status IN ('open','closed') THEN 1 ELSE 0 END,
    CASE WHEN NEW.status IN ('open','closed') THEN NEW.updated_at ELSE NULL END,
    'events','events',NEW.created_at,NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_connections_events_update
AFTER UPDATE OF status,updated_at ON events BEGIN
  UPDATE content_entities SET
    visibility=CASE WHEN NEW.status IN ('open','closed') THEN 'public' ELSE 'internal' END,
    search_visibility=CASE WHEN NEW.status IN ('open','closed') THEN 1 ELSE 0 END,
    public_at=CASE WHEN NEW.status IN ('open','closed') THEN COALESCE(public_at,NEW.updated_at) ELSE public_at END,
    updated_by='events',updated_at=NEW.updated_at
  WHERE id=NEW.id;
END;
