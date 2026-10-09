PRAGMA foreign_keys = ON;

-- Remove these doorways from navigation while preserving their records and pages.
UPDATE construct_pathways
SET homepage_enabled=0, updated_at=datetime('now')
WHERE node_id='node-events'
  AND route IN ('/booking/studio/','/archive/events/','/events/ss-and-f-live-audience/');

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('path-events-kinmarking','construct_pathway','node-events','public',0,datetime('now'),'migration-0239','migration-0239',datetime('now'),datetime('now')),
  ('path-events-all-construct-events','construct_pathway','node-events','public',0,datetime('now'),'migration-0239','migration-0239',datetime('now'),datetime('now'));

INSERT INTO construct_pathways
  (id,node_id,name,route,color,state,homepage_enabled,sort_order,created_at,updated_at)
VALUES
  ('path-events-kinmarking','node-events','KINMARKING','/events/kinmarking/','','published',1,4,datetime('now'),datetime('now')),
  ('path-events-all-construct-events','node-events','All Construct Events','/events/','','published',1,5,datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  route=excluded.route,
  state=excluded.state,
  homepage_enabled=excluded.homepage_enabled,
  sort_order=excluded.sort_order,
  updated_at=excluded.updated_at;

-- Navigation revision includes the parent node timestamp.
UPDATE construct_nodes SET updated_at=datetime('now') WHERE id='node-events';
