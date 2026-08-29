PRAGMA foreign_keys = ON;

-- Register the public place page in the canonical Places catalogue used by
-- Studio. The source-rich historical presentation remains the static Archive
-- page at /archive/places/jr-erikson-building/.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('place-jr-erikson-building','place','node-archive','public',1,0,datetime('now'),NULL,'','migration-0196','migration-0196',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  visibility=excluded.visibility,
  search_visibility=excluded.search_visibility,
  featured=excluded.featured,
  public_at=COALESCE(content_entities.public_at,excluded.public_at),
  archived_at=NULL,
  updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO places
  (id,name,slug,public_location,private_location,privacy,state,created_at,updated_at)
VALUES
  ('place-jr-erikson-building','J.R. Erikson Co. Building','jr-erikson-building','364 Nelson Street SW, Atlanta, GA 30313','','public','published',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  slug=excluded.slug,
  public_location=excluded.public_location,
  private_location=excluded.private_location,
  privacy=excluded.privacy,
  state=excluded.state,
  updated_at=excluded.updated_at;
