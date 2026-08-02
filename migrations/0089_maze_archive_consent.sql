PRAGMA foreign_keys = ON;

-- Public Maze Archive consideration is optional, versioned, and revocable.
-- Existing submissions are intentionally not backfilled: silence is not consent.
CREATE TABLE IF NOT EXISTS maze_archive_consents (
  submission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'not_granted'
    CHECK(status IN ('not_granted','granted','withdrawn')),
  attribution_mode TEXT NOT NULL DEFAULT 'anonymous'
    CHECK(attribution_mode IN ('anonymous','first_name','display_name')),
  public_credit TEXT NOT NULL DEFAULT 'Anonymous',
  include_explanation INTEGER NOT NULL DEFAULT 0 CHECK(include_explanation IN (0,1)),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_maze_archive_consents_status
  ON maze_archive_consents(status, updated_at);

CREATE TABLE IF NOT EXISTS maze_archive_entries (
  submission_id TEXT PRIMARY KEY,
  archive_entity_id TEXT UNIQUE,
  curation_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(curation_status IN ('candidate','rejected','promoted','withdrawn')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(archive_entity_id) REFERENCES content_entities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_maze_archive_entries_status
  ON maze_archive_entries(curation_status, updated_at);

-- These are normal published Archive collections, not a parallel gallery.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-maze-built-by-artpill','archive_collection','archive','public',1,0,datetime('now'),'Maze Archive authored-work collection.','migration-0089','migration-0089',datetime('now'),datetime('now')),
  ('archive-maze-built-by-others','archive_collection','archive','public',1,0,datetime('now'),'Maze Archive consented community-work collection.','migration-0089','migration-0089',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_collections
  (id,name,slug,description,state,sort_order,created_at,updated_at)
VALUES
  ('archive-maze-built-by-artpill','Built by Art.Pill','maze-built-by-artpill','Published Maze Pattern work authored by Art.Pill.','published',70,datetime('now'),datetime('now')),
  ('archive-maze-built-by-others','Built by Others','maze-built-by-others','Curated Maze Pattern arrangements shared with explicit permission.','published',71,datetime('now'),datetime('now'));

-- The history begins as an internal draft. Studio authors the actual lineage.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-maze-pattern','archive_record','tattoos','internal',0,0,'Private seed for authored Maze Pattern history.','migration-0089','migration-0089',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_records
  (id,slug,title,node_label,record_type,room,summary,body,state,sort_order,created_at,updated_at)
VALUES
  ('archive-maze-pattern','maze-pattern','The Maze Pattern','Art.Pill','maze-pattern','Tattoos','','','draft',70,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO search_documents
  (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
VALUES
  ('archive-maze-pattern','archive_record','tattoos','maze-pattern','The Maze Pattern','','','draft','','','','','','/archive/records/maze-pattern/',datetime('now'));

INSERT OR IGNORE INTO archive_dossiers
  (entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-maze-pattern','maze-pattern','','','','No Maze Pattern evidence has been published yet.','maze-pattern','draft',0,0,70,'migration-0089','migration-0089',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_origin_threads
  (id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('origin-thread-maze-pattern','maze-pattern','The Maze Pattern','','draft',0,70,'migration-0089','migration-0089',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_origin_thread_dossiers
  (thread_id,dossier_entity_id,is_primary,sort_order,created_at)
VALUES
  ('origin-thread-maze-pattern','archive-maze-pattern',1,1,datetime('now'));

-- archive_record dossiers are intentionally not auto-catalogued by the shared
-- insert trigger, so seed the private OBJ identity and first editable state.
INSERT OR IGNORE INTO archive_catalogue_entries
  (entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at)
SELECT
  'archive-maze-pattern','other','other-cultural-object','OBJ',
  COALESCE(MAX(catalogue_number),0)+1,
  'OBJ-'||printf('%03d',COALESCE(MAX(catalogue_number),0)+1),
  1,'I','',NULL,'migration-0089','migration-0089',datetime('now'),datetime('now')
FROM archive_catalogue_entries
WHERE catalogue_prefix='OBJ';

INSERT OR IGNORE INTO archive_object_versions
  (id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-version-initial:archive-maze-pattern','archive-maze-pattern',1,'Version 1','',NULL,'undated','',1,'draft',0,'migration-0089','migration-0089',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_object_states
  (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-state-initial:archive-version-initial:archive-maze-pattern','archive-version-initial:archive-maze-pattern','I',1,'First documented state','','',NULL,'undated','',1,'draft',0,NULL,'migration-0089','migration-0089',datetime('now'),datetime('now'));

UPDATE archive_catalogue_entries
SET current_state_id='archive-state-initial:archive-version-initial:archive-maze-pattern',updated_at=datetime('now')
WHERE entity_id='archive-maze-pattern' AND current_state_id IS NULL;
