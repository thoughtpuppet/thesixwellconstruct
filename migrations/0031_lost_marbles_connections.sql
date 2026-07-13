PRAGMA foreign_keys = ON;

-- Merchandise remains operationally owned by Shopify. This registry supplies
-- stable Construct identities, routes, imagery, and publication state.
CREATE TABLE IF NOT EXISTS merch_items (
  id TEXT PRIMARY KEY,
  shopify_handle TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired','archived')),
  route TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('merch-lostmarbles-hoodie','merch_item','node-merch','public',1,datetime('now'),'migration-0031','migration-0031',datetime('now'),datetime('now')),
  ('merch-marbles-print','merch_item','node-merch','public',1,datetime('now'),'migration-0031','migration-0031',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO merch_items
  (id,shopify_handle,title,product_type,state,route,image_url,alt_text,sort_order,created_at,updated_at)
VALUES
  ('merch-lostmarbles-hoodie','lostmarbles-hoodie','LOST MARBLES. Hoodie','apparel','published','/merch/lostmarbles-hoodie.html','/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg','LOST MARBLES. Hoodie, derived from the Lost Marbles painting',1,datetime('now'),datetime('now')),
  ('merch-marbles-print','marbles-print','Marbles. Print','print','published','/merch/marbles-print.html','/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg','Marbles archival print',2,datetime('now'),datetime('now'));

-- Existing public, handcrafted links are imported privately for Studio review.
INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
VALUES
  ('connection-marbles-hoodie-art','merch-lostmarbles-hoodie','art-marbles','rel-derived-from',0,'Migrated from the legacy origin and related blocks.',1,'migration-0031',datetime('now'),datetime('now')),
  ('connection-marbles-print-art','merch-marbles-print','art-marbles','rel-derived-from',0,'Migrated from the legacy origin and related blocks.',2,'migration-0031',datetime('now'),datetime('now')),
  ('connection-marbles-art-archive','art-marbles','marbles-source-thread','rel-documented-by',0,'Migrated from the Marbles Source Thread archive record.',3,'migration-0031',datetime('now'),datetime('now')),
  ('connection-marbles-hoodie-print','merch-lostmarbles-hoodie','merch-marbles-print','rel-related-to',0,'Migrated from reciprocal product related blocks.',4,'migration-0031',datetime('now'),datetime('now'));
