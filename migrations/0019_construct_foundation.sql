PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  node_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public', 'unlisted', 'internal', 'private')),
  search_visibility INTEGER NOT NULL DEFAULT 0 CHECK (search_visibility IN (0, 1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  public_at TEXT,
  archived_at TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_entities_type_visibility
  ON content_entities(entity_type, visibility, search_visibility);
CREATE INDEX IF NOT EXISTS idx_content_entities_node
  ON content_entities(node_id, entity_type);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  rights_notes TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'internal' CHECK (privacy IN ('public', 'unlisted', 'internal', 'private')),
  consent_status TEXT NOT NULL DEFAULT 'not-required' CHECK (consent_status IN ('not-required', 'required', 'granted', 'denied', 'unknown')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_url <> '' OR storage_key <> '')
);

CREATE INDEX IF NOT EXISTS idx_media_assets_state_privacy
  ON media_assets(state, privacy, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_storage_key
  ON media_assets(storage_key) WHERE storage_key <> '';

CREATE TABLE IF NOT EXISTS entity_media (
  entity_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'gallery',
  sort_order INTEGER NOT NULL DEFAULT 0,
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1)),
  alt_text_override TEXT NOT NULL DEFAULT '',
  caption_override TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, media_id, role),
  FOREIGN KEY (entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_media_entity_order
  ON entity_media(entity_id, role, sort_order);

CREATE TABLE IF NOT EXISTS taxonomy_terms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tag', 'theme')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, slug)
);

CREATE TABLE IF NOT EXISTS entity_terms (
  entity_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, term_id),
  FOREIGN KEY (entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES taxonomy_terms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship_types (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  forward_label TEXT NOT NULL,
  reverse_label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship_type_id TEXT NOT NULL,
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK (public_visible IN (0, 1)),
  internal_notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_entity_id <> target_entity_id),
  UNIQUE (source_entity_id, target_entity_id, relationship_type_id),
  FOREIGN KEY (source_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (relationship_type_id) REFERENCES relationship_types(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_source
  ON entity_relationships(source_entity_id, public_visible, sort_order);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target
  ON entity_relationships(target_entity_id, public_visible, sort_order);

CREATE TABLE IF NOT EXISTS entity_activity (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  place_entity_id TEXT,
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK (public_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (place_entity_id) REFERENCES content_entities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_activity_timeline
  ON entity_activity(entity_id, occurred_at, sort_order);

CREATE TABLE IF NOT EXISTS entity_revisions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, revision_number),
  FOREIGN KEY (entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_revisions_entity
  ON entity_revisions(entity_id, revision_number DESC);

INSERT OR IGNORE INTO relationship_types
  (id, slug, forward_label, reverse_label, sort_order, created_at, updated_at)
VALUES
  ('rel-inspired-by', 'inspired-by', 'Inspired by', 'Inspired', 1, datetime('now'), datetime('now')),
  ('rel-derived-from', 'derived-from', 'Derived from', 'Source for', 2, datetime('now'), datetime('now')),
  ('rel-part-of', 'part-of', 'Part of', 'Contains', 3, datetime('now'), datetime('now')),
  ('rel-belongs-to', 'belongs-to', 'Belongs to', 'Includes', 4, datetime('now'), datetime('now')),
  ('rel-appeared-in', 'appeared-in', 'Appeared in', 'Featured', 5, datetime('now'), datetime('now')),
  ('rel-exhibited-at', 'exhibited-at', 'Exhibited at', 'Exhibited', 6, datetime('now'), datetime('now')),
  ('rel-documented-by', 'documented-by', 'Documented by', 'Documents', 7, datetime('now'), datetime('now')),
  ('rel-uses-symbol', 'uses-symbol', 'Uses symbol', 'Used by', 8, datetime('now'), datetime('now')),
  ('rel-related-to', 'related-to', 'Related to', 'Related to', 9, datetime('now'), datetime('now')),
  ('rel-created-for', 'created-for', 'Created for', 'Commissioned', 10, datetime('now'), datetime('now')),
  ('rel-collaborated-with', 'collaborated-with', 'Collaborated with', 'Collaborated with', 11, datetime('now'), datetime('now')),
  ('rel-version-of', 'version-of', 'Version of', 'Has version', 12, datetime('now'), datetime('now')),
  ('rel-predecessor-of', 'predecessor-of', 'Predecessor of', 'Successor of', 13, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO content_entities
  (id, entity_type, visibility, search_visibility, featured, public_at, archived_at, internal_notes, created_by, updated_by, created_at, updated_at)
SELECT
  id,
  'portfolio_item',
  CASE state WHEN 'published' THEN 'public' ELSE 'internal' END,
  CASE state WHEN 'published' THEN 1 ELSE 0 END,
  0,
  CASE state WHEN 'published' THEN created_at ELSE NULL END,
  CASE state WHEN 'archived' THEN updated_at ELSE NULL END,
  '',
  'migration-0019',
  'migration-0019',
  created_at,
  updated_at
FROM portfolio_items;

INSERT OR IGNORE INTO content_entities
  (id, entity_type, visibility, search_visibility, featured, public_at, archived_at, internal_notes, created_by, updated_by, created_at, updated_at)
SELECT
  id,
  'event',
  CASE status WHEN 'draft' THEN 'internal' ELSE 'public' END,
  CASE status WHEN 'draft' THEN 0 ELSE 1 END,
  0,
  CASE status WHEN 'draft' THEN NULL ELSE created_at END,
  NULL,
  '',
  'migration-0019',
  'migration-0019',
  created_at,
  updated_at
FROM events;

INSERT OR IGNORE INTO media_assets
  (id, source_url, storage_key, original_filename, mime_type, alt_text, caption, privacy, consent_status, state, created_by, created_at, updated_at)
SELECT
  'media-' || id,
  source_url,
  storage_key,
  original_filename,
  content_type,
  alt_text,
  caption,
  CASE state WHEN 'published' THEN 'public' ELSE 'internal' END,
  'unknown',
  CASE state WHEN 'archived' THEN 'archived' ELSE 'active' END,
  'migration-0019',
  created_at,
  updated_at
FROM portfolio_items
WHERE source_url <> '' OR storage_key <> '';

INSERT OR IGNORE INTO entity_media
  (entity_id, media_id, role, sort_order, public_visible, alt_text_override, caption_override, created_at)
SELECT
  id,
  'media-' || id,
  'primary',
  1,
  CASE state WHEN 'published' THEN 1 ELSE 0 END,
  alt_text,
  caption,
  created_at
FROM portfolio_items
WHERE source_url <> '' OR storage_key <> '';
