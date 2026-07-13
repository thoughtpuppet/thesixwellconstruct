PRAGMA foreign_keys = ON;

-- Legend is a standalone Connections node. It shares the Construct/About
-- palette without becoming an About or Tattoo entity, and it is not added to
-- the homepage node ring.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('node-legend','construct_node',NULL,'public',0,datetime('now'),'migration-0032','migration-0032',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO construct_nodes
  (id,name,slug,route,color,state,homepage_enabled,sort_order,created_at,updated_at)
VALUES
  ('node-legend','LEGEND','legend','/legend/','#FCB467','published',0,10,datetime('now'),datetime('now'));

UPDATE construct_nodes
SET name='LEGEND',slug='legend',route='/legend/',color='#FCB467',state='published',homepage_enabled=0,updated_at=datetime('now')
WHERE id='node-legend';

UPDATE content_entities
SET node_id='node-legend',updated_by='migration-0032',updated_at=datetime('now')
WHERE entity_type='visual_symbol' AND COALESCE(node_id,'')<>'node-legend';
