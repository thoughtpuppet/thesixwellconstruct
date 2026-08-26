PRAGMA foreign_keys = ON;

-- First-class authored Notes can stand alone, link to more than one Construct
-- entity, and appear as evidence inside an Origin Thread without becoming a
-- dossier-owned material.
CREATE TABLE archive_notes (
  entity_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'concept-note',
  source_app TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  source_created_at TEXT,
  source_modified_at TEXT,
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_notes_public
  ON archive_notes(state,public_visible,sort_order,source_created_at,created_at);

CREATE TABLE archive_note_assets (
  id TEXT PRIMARY KEY,
  note_entity_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  asset_token TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'inline-image'
    CHECK(role IN ('inline-image','inline-document','source-provenance')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_text_override TEXT NOT NULL DEFAULT '',
  caption_override TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(note_entity_id,asset_token),
  UNIQUE(note_entity_id,media_id,role),
  FOREIGN KEY(note_entity_id) REFERENCES archive_notes(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_archive_note_assets_note
  ON archive_note_assets(note_entity_id,public_visible,sort_order,id);
CREATE INDEX idx_archive_note_assets_media
  ON archive_note_assets(media_id,note_entity_id,public_visible);

CREATE TABLE archive_note_links (
  note_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship_role TEXT NOT NULL DEFAULT 'context'
    CHECK(relationship_role IN ('inception','development','reference','context')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(note_entity_id,target_entity_id,relationship_role),
  FOREIGN KEY(note_entity_id) REFERENCES archive_notes(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(target_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_archive_note_primary_link
  ON archive_note_links(note_entity_id) WHERE is_primary=1;
CREATE INDEX idx_archive_note_links_target
  ON archive_note_links(target_entity_id,public_visible,sort_order,note_entity_id);

-- Make Notes the fourth public way of reading the Archive and keep the older
-- lenses in their existing relative order.
UPDATE construct_pathways
SET name='Notes',route='/archive/notes/',color='#6D3D15',state='published',
    homepage_enabled=1,sort_order=4,updated_at=datetime('now')
WHERE id='path-archive-08';

UPDATE construct_pathways
SET sort_order=CASE id
    WHEN 'path-archive-01' THEN 1
    WHEN 'path-archive-02' THEN 2
    WHEN 'path-archive-03' THEN 3
    WHEN 'path-archive-04' THEN 5
    WHEN 'path-archive-05' THEN 6
    WHEN 'path-archive-06' THEN 7
    WHEN 'path-archive-07' THEN 8
  END,
  updated_at=datetime('now')
WHERE id IN (
  'path-archive-01','path-archive-02','path-archive-03','path-archive-04',
  'path-archive-05','path-archive-06','path-archive-07'
);
