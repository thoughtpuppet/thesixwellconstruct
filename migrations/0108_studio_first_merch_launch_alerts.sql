PRAGMA foreign_keys = OFF;

-- Merch is now owned by Studio. Shopify is an optional commerce connection,
-- not the identity or publication source for a product.
DROP TRIGGER IF EXISTS archive_shell_content_entity_insert;
DROP TRIGGER IF EXISTS archive_shell_content_entity_publish;

ALTER TABLE merch_items RENAME TO merch_items_legacy;

CREATE TABLE merch_items (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  shopify_handle TEXT UNIQUE,
  title TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'other',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired','archived')),
  availability_state TEXT NOT NULL DEFAULT 'coming_soon' CHECK(availability_state IN ('coming_soon','available','sold_out')),
  route TEXT NOT NULL,
  source_venture TEXT NOT NULL DEFAULT 'six.well',
  catalog_number TEXT NOT NULL DEFAULT '',
  statement TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  edition_text TEXT NOT NULL DEFAULT '',
  shipping_note TEXT NOT NULL DEFAULT '',
  price_note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  origin_title TEXT NOT NULL DEFAULT '',
  origin_path TEXT NOT NULL DEFAULT '',
  origin_thumb TEXT NOT NULL DEFAULT '',
  origin_meta TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  notify_enabled INTEGER NOT NULL DEFAULT 1 CHECK(notify_enabled IN (0,1)),
  launched_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

INSERT INTO merch_items (
  id,slug,shopify_handle,title,product_type,state,availability_state,route,
  source_venture,catalog_number,statement,description,edition_text,shipping_note,
  price_note,image_url,alt_text,origin_title,origin_path,origin_thumb,origin_meta,
  options_json,notify_enabled,launched_at,sort_order,created_at,updated_at
)
SELECT
  id,shopify_handle,shopify_handle,title,product_type,state,
  CASE WHEN shopify_handle='lostmarbles-hoodie' THEN 'available' ELSE 'coming_soon' END,
  '/merch/'||shopify_handle||'/',
  CASE WHEN shopify_handle IN ('lostmarbles-hoodie','marbles-print') THEN 'thoughtpuppet' ELSE 'six.well' END,
  CASE shopify_handle WHEN 'lostmarbles-hoodie' THEN '05' WHEN 'marbles-print' THEN '06' ELSE '' END,
  '', '',
  CASE shopify_handle WHEN 'lostmarbles-hoodie' THEN 'limited edition - 30 pieces' WHEN 'marbles-print' THEN 'edition of 50' ELSE '' END,
  CASE shopify_handle WHEN 'lostmarbles-hoodie' THEN 'hand-numbered · ships within 2–3 weeks' WHEN 'marbles-print' THEN 'ships flat' ELSE '' END,
  CASE shopify_handle WHEN 'marbles-print' THEN 'giclee archival print. ships flat.' ELSE '' END,
  image_url,alt_text,
  CASE WHEN shopify_handle IN ('lostmarbles-hoodie','marbles-print') THEN 'AM I LOSING MY MARBLES OR HIDING THEM?' ELSE '' END,
  CASE WHEN shopify_handle IN ('lostmarbles-hoodie','marbles-print') THEN '/art/lostmarblespainting.html' ELSE '' END,
  CASE WHEN shopify_handle IN ('lostmarbles-hoodie','marbles-print') THEN '/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg' ELSE '' END,
  CASE WHEN shopify_handle IN ('lostmarbles-hoodie','marbles-print') THEN '2023 · acrylic on wood panel' ELSE '' END,
  '{}',1,
  CASE WHEN shopify_handle='lostmarbles-hoodie' THEN updated_at ELSE NULL END,
  sort_order,created_at,updated_at
FROM merch_items_legacy;

DROP TABLE merch_items_legacy;

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('merch-six-well-clothing','merch_item','node-merch','public',1,datetime('now'),'migration-0108','migration-0108',datetime('now'),datetime('now')),
  ('merch-maze-puffer-jacket','merch_item','node-merch','public',1,datetime('now'),'migration-0108','migration-0108',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO merch_items (
  id,slug,shopify_handle,title,product_type,state,availability_state,route,
  source_venture,catalog_number,statement,description,edition_text,shipping_note,
  price_note,image_url,alt_text,origin_title,origin_path,origin_thumb,origin_meta,
  options_json,notify_enabled,sort_order,created_at,updated_at
)
VALUES
  ('merch-six-well-clothing','six-well-clothing',NULL,'SIX.WELL CLOTHING','apparel','published','coming_soon','/merch/six-well-clothing/',
   'six.well','01','garments from the construct''s own hand','The first Six.Well clothing release is taking form.','coming soon','','','','SIX.WELL CLOTHING coming soon','','','','','{}',1,1,datetime('now'),datetime('now')),
  ('merch-maze-puffer-jacket','maze-puffer-jacket',NULL,'MAZE Puffer Jacket','apparel','published','coming_soon','/merch/maze-puffer-jacket/',
   'art.pill','09','materials behind the marks','A puffer jacket carrying the MAZE study from art.pill.','coming soon','ships within 2–3 weeks','',
   '/assets/flash/IMG_8898.jpg','MAZE Puffer Jacket','MAZE 001','/tattoos/flash/ap-maze-001/','/assets/flash/IMG_8898.jpg','2026 · tattoo flash · art.pill',
   '{"color":["Black"]}',1,9,datetime('now'),datetime('now'));

UPDATE merch_items SET
  slug='lostmarbles-hoodie',route='/merch/lostmarbles-hoodie/',source_venture='thoughtpuppet',catalog_number='05',
  availability_state='available',edition_text='limited edition - 30 pieces',
  shipping_note='hand-numbered · ships within 2–3 weeks',
  origin_title='AM I LOSING MY MARBLES OR HIDING THEM?',origin_path='/art/lostmarblespainting.html',
  origin_thumb='/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg',origin_meta='2023 · acrylic on wood panel',
  sort_order=5,updated_at=datetime('now')
WHERE id='merch-lostmarbles-hoodie';

UPDATE merch_items SET
  slug='marbles-print',route='/merch/marbles-print/',source_venture='thoughtpuppet',catalog_number='06',
  state='draft',availability_state='coming_soon',edition_text='edition of 50',shipping_note='ships flat',
  price_note='giclee archival print. ships flat.',origin_title='AM I LOSING MY MARBLES OR HIDING THEM?',
  origin_path='/art/lostmarblespainting.html',origin_thumb='/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg',
  origin_meta='2023 · acrylic on wood panel',sort_order=6,updated_at=datetime('now')
WHERE id='merch-marbles-print';

UPDATE content_entities SET visibility='internal',search_visibility=0,public_at=NULL,updated_by='migration-0108',updated_at=datetime('now')
WHERE id='merch-marbles-print';

CREATE TABLE merch_launch_alerts (
  id TEXT PRIMARY KEY,
  merch_item_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','sent')),
  token_hash TEXT NOT NULL UNIQUE,
  consent_version TEXT NOT NULL,
  consent_evidence_json TEXT NOT NULL DEFAULT '{}',
  newsletter_requested INTEGER NOT NULL DEFAULT 0 CHECK(newsletter_requested IN (0,1)),
  confirmed_at TEXT,
  cancelled_at TEXT,
  launch_sent_at TEXT,
  last_confirmation_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(merch_item_id) REFERENCES merch_items(id) ON DELETE CASCADE,
  UNIQUE(merch_item_id,email)
);

CREATE INDEX idx_merch_launch_alerts_item_status
  ON merch_launch_alerts(merch_item_id,status,created_at);

CREATE TABLE merch_launch_events (
  id TEXT PRIMARY KEY,
  merch_item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','sending','completed','partial','failed')),
  audience_count INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL,
  audience_snapshot_json TEXT NOT NULL DEFAULT '[]',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(merch_item_id) REFERENCES merch_items(id) ON DELETE CASCADE
);

CREATE TABLE merch_launch_deliveries (
  id TEXT PRIMARY KEY,
  launch_event_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(launch_event_id) REFERENCES merch_launch_events(id) ON DELETE CASCADE,
  FOREIGN KEY(alert_id) REFERENCES merch_launch_alerts(id) ON DELETE CASCADE,
  UNIQUE(launch_event_id,alert_id)
);

CREATE INDEX idx_merch_launch_deliveries_event_status
  ON merch_launch_deliveries(launch_event_id,status,created_at);

-- Archive identities now use the permanent Studio slug, never a Shopify handle.
CREATE TRIGGER archive_shell_content_entity_insert
AFTER INSERT ON content_entities
WHEN NEW.visibility='public' AND NEW.entity_type IN ('art_work','merch_item','portfolio_item','flash_item','event','visual_symbol','writing_work','film_work','music_work')
BEGIN
  INSERT OR IGNORE INTO archive_dossiers
    (entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
  SELECT NEW.id,
    CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=COALESCE(
      (SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),
      (SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),
      (SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) AND other.entity_id<>NEW.id)
    THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id)
    ELSE COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) END,
    CASE NEW.entity_type WHEN 'art_work' THEN 'artwork' WHEN 'merch_item' THEN 'merchandise' WHEN 'portfolio_item' THEN 'tattoo' WHEN 'flash_item' THEN 'flash' WHEN 'event' THEN 'event' WHEN 'visual_symbol' THEN 'symbol' ELSE replace(NEW.entity_type,'_','-') END,
    'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

CREATE TRIGGER archive_shell_content_entity_publish
AFTER UPDATE OF visibility ON content_entities
WHEN NEW.visibility='public' AND NEW.entity_type IN ('art_work','merch_item','portfolio_item','flash_item','event','visual_symbol','writing_work','film_work','music_work')
BEGIN
  INSERT OR IGNORE INTO archive_dossiers
    (entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
  SELECT NEW.id,
    CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=COALESCE(
      (SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),
      (SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),
      (SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) AND other.entity_id<>NEW.id)
    THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id)
    ELSE COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT slug FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) END,
    CASE NEW.entity_type WHEN 'art_work' THEN 'artwork' WHEN 'merch_item' THEN 'merchandise' WHEN 'portfolio_item' THEN 'tattoo' WHEN 'flash_item' THEN 'flash' WHEN 'event' THEN 'event' WHEN 'visual_symbol' THEN 'symbol' ELSE replace(NEW.entity_type,'_','-') END,
    'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

UPDATE archive_dossiers SET archive_slug=(SELECT slug FROM merch_items WHERE merch_items.id=archive_dossiers.entity_id),updated_by='migration-0108',updated_at=datetime('now')
WHERE entity_id IN (SELECT id FROM merch_items);

PRAGMA foreign_keys = ON;
