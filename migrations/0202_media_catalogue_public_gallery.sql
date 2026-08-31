-- Relational Media Catalogue and independently curated public Gallery.
-- Media Assets remain reusable files; Gallery entries and Archive subjects keep
-- their own identities, publication states, and relationship semantics.

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_source_url
  ON media_assets(source_url) WHERE source_url <> '';

ALTER TABLE media_upload_sessions ADD COLUMN sha256 TEXT;
ALTER TABLE media_upload_sessions ADD COLUMN source_class TEXT NOT NULL DEFAULT 'creative'
  CHECK(source_class IN ('creative','site_asset'));

CREATE TABLE IF NOT EXISTS media_catalogue_entries (
  catalogue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id TEXT NOT NULL UNIQUE,
  entity_id TEXT NOT NULL UNIQUE,
  source_class TEXT NOT NULL DEFAULT 'creative'
    CHECK(source_class IN ('creative','site_asset')),
  sha256 TEXT,
  original_format TEXT NOT NULL DEFAULT '',
  import_source TEXT NOT NULL DEFAULT '',
  embedded_capture_at TEXT,
  embedded_capture_timezone TEXT NOT NULL DEFAULT '',
  camera_make TEXT NOT NULL DEFAULT '',
  camera_model TEXT NOT NULL DEFAULT '',
  editing_software TEXT NOT NULL DEFAULT '',
  orientation TEXT NOT NULL DEFAULT '',
  color_profile TEXT NOT NULL DEFAULT '',
  metadata_review_state TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(metadata_review_state IN ('unreviewed','reviewed','redacted')),
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'system',
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_catalogue_sha256
  ON media_catalogue_entries(sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_catalogue_class
  ON media_catalogue_entries(source_class,metadata_review_state,catalogue_id DESC);

CREATE TABLE IF NOT EXISTS media_creator_handoffs (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  creator_type TEXT NOT NULL,
  suggested_title TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','completed','cancelled','expired')),
  completed_entity_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(completed_entity_id) REFERENCES content_entities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_media_creator_handoffs_pending
  ON media_creator_handoffs(state,expires_at,media_id);

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
SELECT
  'media-catalogue-'||m.id,'media_asset',NULL,'internal',0,0,'',
  'migration-0202','migration-0202',m.created_at,m.updated_at
FROM media_assets m
ORDER BY m.created_at,m.id;

INSERT OR IGNORE INTO media_catalogue_entries
  (media_id,entity_id,source_class,original_format,import_source,created_by,updated_by,created_at,updated_at)
SELECT
  m.id,'media-catalogue-'||m.id,
  CASE
    WHEN lower(m.source_url) LIKE '/assets/entry-room/%'
      OR lower(m.source_url) LIKE '/assets/audio/%'
      OR lower(m.source_url) LIKE '/assets/home-ghost/%'
      OR lower(m.source_url) LIKE '/assets/previews/%'
    THEN 'site_asset' ELSE 'creative' END,
  CASE WHEN instr(m.original_filename,'.')>0 THEN lower(substr(m.original_filename,instr(m.original_filename,'.')+1)) ELSE '' END,
  CASE WHEN m.source_url<>'' THEN 'repository' ELSE 'studio-upload' END,
  'migration-0202','migration-0202',m.created_at,m.updated_at
FROM media_assets m
ORDER BY m.created_at,m.id;

CREATE TRIGGER IF NOT EXISTS media_catalogue_asset_insert
AFTER INSERT ON media_assets
BEGIN
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
  VALUES
    ('media-catalogue-'||NEW.id,'media_asset',NULL,'internal',0,0,'',COALESCE(NEW.created_by,'system'),COALESCE(NEW.created_by,'system'),NEW.created_at,NEW.updated_at);
  INSERT OR IGNORE INTO media_catalogue_entries
    (media_id,entity_id,source_class,original_format,import_source,created_by,updated_by,created_at,updated_at)
  VALUES
    (NEW.id,'media-catalogue-'||NEW.id,'creative',
     CASE WHEN instr(NEW.original_filename,'.')>0 THEN lower(substr(NEW.original_filename,instr(NEW.original_filename,'.')+1)) ELSE '' END,
     CASE WHEN NEW.source_url<>'' THEN 'repository' ELSE 'studio-upload' END,
     COALESCE(NEW.created_by,'system'),COALESCE(NEW.created_by,'system'),NEW.created_at,NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS media_catalogue_asset_delete
AFTER DELETE ON media_assets
BEGIN
  DELETE FROM content_entities WHERE id='media-catalogue-'||OLD.id AND entity_type='media_asset';
END;

CREATE TABLE IF NOT EXISTS gallery_entries (
  media_id TEXT PRIMARY KEY,
  display_media_id TEXT NOT NULL,
  poster_media_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  accessibility_text TEXT NOT NULL DEFAULT '',
  accessibility_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(accessibility_status IN ('unreviewed','described','captioned','transcribed','silent','ambient')),
  caption TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  rights_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(rights_status IN ('unreviewed','owned','permission','licensed','public-domain','restricted')),
  date_precision TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(date_precision IN ('unreviewed','undated','year','approximate','exact','range')),
  date_label TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  focal_x REAL NOT NULL DEFAULT 0.5 CHECK(focal_x>=0 AND focal_x<=1),
  focal_y REAL NOT NULL DEFAULT 0.5 CHECK(focal_y>=0 AND focal_y<=1),
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK(state IN ('draft','published','hidden','archived')),
  published_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(display_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(poster_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gallery_entries_public
  ON gallery_entries(state,published_at DESC,media_id);

CREATE TABLE IF NOT EXISTS gallery_lenses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO gallery_lenses(id,slug,name,description,sort_order,state,created_at,updated_at) VALUES
  ('gallery-lens-works','works-constructions','Works & Constructions','Finished and evolving works, designs, objects, and visual constructions.',10,'active',datetime('now'),datetime('now')),
  ('gallery-lens-making','making','Making','Process, tools, screens, printing, assembly, and material development.',20,'active',datetime('now'),datetime('now')),
  ('gallery-lens-studio','studio-life','Studio Life','Candid and situated views of work, people, and daily studio life.',30,'active',datetime('now'),datetime('now')),
  ('gallery-lens-ephemera','ephemera-documents','Ephemera & Documents','Flyers, scans, notes, packaging, proofs, and other documentary matter.',40,'active',datetime('now'),datetime('now'));

CREATE TABLE IF NOT EXISTS gallery_entry_lenses (
  media_id TEXT NOT NULL,
  lens_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(media_id,lens_id),
  FOREIGN KEY(media_id) REFERENCES gallery_entries(media_id) ON DELETE CASCADE,
  FOREIGN KEY(lens_id) REFERENCES gallery_lenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gallery_sets (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  set_type TEXT NOT NULL CHECK(set_type IN ('series','session')),
  cover_media_id TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('undated','year','approximate','exact','range')),
  date_label TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  published_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(cover_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gallery_sets_public
  ON gallery_sets(state,published_at DESC,sort_order,slug);

CREATE TRIGGER IF NOT EXISTS gallery_set_slug_immutable
BEFORE UPDATE OF slug ON gallery_sets
WHEN NEW.slug<>OLD.slug
BEGIN
  SELECT RAISE(ABORT,'Gallery set slugs are permanent');
END;

CREATE TABLE IF NOT EXISTS gallery_set_items (
  set_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(set_id,media_id),
  FOREIGN KEY(set_id) REFERENCES gallery_sets(id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES gallery_entries(media_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gallery_set_items_order
  ON gallery_set_items(set_id,sort_order,media_id);

CREATE TRIGGER IF NOT EXISTS gallery_entry_publish_insert_guard
BEFORE INSERT ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)='' OR trim(NEW.accessibility_text)=''
  OR NEW.accessibility_status='unreviewed'
  OR NEW.rights_status IN ('unreviewed','restricted')
  OR NEW.date_precision='unreviewed'
  OR NOT EXISTS(
    SELECT 1 FROM media_assets display
    WHERE display.id=NEW.display_media_id AND display.state='active'
      AND display.privacy='public' AND display.public_presentation='inline'
      AND NOT EXISTS(SELECT 1 FROM media_asset_variants pair WHERE pair.master_media_id=display.id)
  )
  OR (
    NEW.accessibility_status IN ('captioned','transcribed')
    AND EXISTS(SELECT 1 FROM media_assets source WHERE source.id=NEW.display_media_id AND (source.mime_type LIKE 'audio/%' OR source.mime_type LIKE 'video/%'))
    AND NOT EXISTS(SELECT 1 FROM media_assets source WHERE source.id=NEW.display_media_id AND source.transcript_status='ready' AND trim(source.transcript)<>'')
  )
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires reviewed copy, accessibility, rights, date, and an eligible public display asset');
END;

CREATE TRIGGER IF NOT EXISTS gallery_entry_publish_update_guard
BEFORE UPDATE ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)='' OR trim(NEW.accessibility_text)=''
  OR NEW.accessibility_status='unreviewed'
  OR NEW.rights_status IN ('unreviewed','restricted')
  OR NEW.date_precision='unreviewed'
  OR NOT EXISTS(
    SELECT 1 FROM media_assets display
    WHERE display.id=NEW.display_media_id AND display.state='active'
      AND display.privacy='public' AND display.public_presentation='inline'
      AND NOT EXISTS(SELECT 1 FROM media_asset_variants pair WHERE pair.master_media_id=display.id)
  )
  OR (
    NEW.accessibility_status IN ('captioned','transcribed')
    AND EXISTS(SELECT 1 FROM media_assets source WHERE source.id=NEW.display_media_id AND (source.mime_type LIKE 'audio/%' OR source.mime_type LIKE 'video/%'))
    AND NOT EXISTS(SELECT 1 FROM media_assets source WHERE source.id=NEW.display_media_id AND source.transcript_status='ready' AND trim(source.transcript)<>'')
  )
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires reviewed copy, accessibility, rights, date, and an eligible public display asset');
END;

CREATE TRIGGER IF NOT EXISTS gallery_display_media_update_guard
BEFORE UPDATE OF state,privacy,public_presentation ON media_assets
WHEN (NEW.state<>'active' OR NEW.privacy<>'public' OR NEW.public_presentation<>'inline')
  AND EXISTS(SELECT 1 FROM gallery_entries entry WHERE entry.display_media_id=NEW.id AND entry.state='published')
BEGIN
  SELECT RAISE(ABORT,'published gallery display asset must remain active, public, and inline');
END;

INSERT OR IGNORE INTO relationship_types
  (id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('rel-depicts','depicts','Depicts','Depicted in','The media visibly depicts the connected subject.',1,62,datetime('now'),datetime('now')),
  ('rel-process-of','process-of','Process of','Has process media','The media documents the making or development of the connected subject.',1,63,datetime('now'),datetime('now')),
  ('rel-alternate-of','alternate-of','Alternate of','Has alternate','The media is an alternate treatment, export, crop, or presentation of the connected media.',1,64,datetime('now'),datetime('now')),
  ('rel-documents','documents','Documents','Documented by','The media records evidence, context, or an appearance of the connected subject.',1,65,datetime('now'),datetime('now'));

CREATE TABLE IF NOT EXISTS construct_utility_links (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  route TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6D3D15',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO construct_utility_links(id,label,route,color,state,sort_order,created_at,updated_at)
VALUES('utility-gallery','Gallery','/gallery/','#6D3D15','published',10,datetime('now'),datetime('now'));
