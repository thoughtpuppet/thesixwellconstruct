PRAGMA foreign_keys = OFF;

-- Blackboard fragments begin as independent Studio records. A fragment may be
-- left unmapped, then assigned to one physical Blackboard and any number of
-- that Blackboard's dated states. Existing owners are preserved.
CREATE TABLE archive_blackboard_fragments_next (
  id TEXT PRIMARY KEY,
  record_entity_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  master_media_id TEXT,
  edit_source_media_id TEXT,
  derivative_media_id TEXT,
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','day','month','year','circa','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(record_entity_id) REFERENCES archive_blackboard_records(record_entity_id) ON DELETE SET NULL,
  FOREIGN KEY(master_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(edit_source_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(derivative_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(master_media_id IS NULL OR derivative_media_id IS NULL OR master_media_id<>derivative_media_id)
);

WITH ranked_fragments AS (
  SELECT fragment.*,
    ROW_NUMBER() OVER (PARTITION BY fragment.slug ORDER BY fragment.created_at,fragment.id) slug_rank
  FROM archive_blackboard_fragments fragment
)
INSERT INTO archive_blackboard_fragments_next (
  id,record_entity_id,slug,title,caption,body,master_media_id,edit_source_media_id,
  derivative_media_id,occurred_at,date_precision,date_label,state,public_visible,
  sort_order,created_by,updated_by,created_at,updated_at,published_at
)
SELECT
  id,record_entity_id,
  CASE WHEN slug_rank=1 THEN slug ELSE slug||'-legacy-'||replace(lower(id),'_','-') END,
  title,caption,body,master_media_id,COALESCE(derivative_media_id,master_media_id),
  derivative_media_id,occurred_at,date_precision,date_label,state,public_visible,
  sort_order,created_by,updated_by,created_at,updated_at,published_at
FROM ranked_fragments;

CREATE TABLE archive_blackboard_fragment_states_next (
  fragment_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  PRIMARY KEY(fragment_id,state_id),
  FOREIGN KEY(fragment_id) REFERENCES archive_blackboard_fragments(id) ON DELETE CASCADE,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE
);

INSERT INTO archive_blackboard_fragment_states_next
  (fragment_id,state_id,note,sort_order,created_by,created_at)
SELECT fragment_id,state_id,note,sort_order,created_by,created_at
FROM archive_blackboard_fragment_states;

-- Hotspot masks are cropped to these computed bounds. The PNG is the public
-- interaction mask; the editable recipe remains an authenticated Studio field.
CREATE TABLE archive_blackboard_fragment_placements_next (
  fragment_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  x_percent REAL NOT NULL CHECK(x_percent >= 0 AND x_percent <= 100),
  y_percent REAL NOT NULL CHECK(y_percent >= 0 AND y_percent <= 100),
  width_percent REAL NOT NULL CHECK(width_percent > 0 AND width_percent <= 100),
  height_percent REAL NOT NULL CHECK(height_percent > 0 AND height_percent <= 100),
  hotspot_mask_media_id TEXT,
  hotspot_recipe_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(fragment_id,state_id),
  FOREIGN KEY(fragment_id,state_id) REFERENCES archive_blackboard_fragment_states(fragment_id,state_id) ON DELETE CASCADE,
  FOREIGN KEY(hotspot_mask_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(x_percent + width_percent <= 100),
  CHECK(y_percent + height_percent <= 100)
);

INSERT INTO archive_blackboard_fragment_placements_next (
  fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,
  hotspot_mask_media_id,hotspot_recipe_json,sort_order,created_by,updated_by,created_at,updated_at
)
SELECT
  fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,
  NULL,NULL,sort_order,created_by,updated_by,created_at,updated_at
FROM archive_blackboard_fragment_placements;

DROP TABLE archive_blackboard_fragment_placements;
DROP TABLE archive_blackboard_fragment_states;
DROP TABLE archive_blackboard_fragments;
ALTER TABLE archive_blackboard_fragments_next RENAME TO archive_blackboard_fragments;
ALTER TABLE archive_blackboard_fragment_states_next RENAME TO archive_blackboard_fragment_states;
ALTER TABLE archive_blackboard_fragment_placements_next RENAME TO archive_blackboard_fragment_placements;

CREATE INDEX idx_archive_blackboard_fragments_public
  ON archive_blackboard_fragments(record_entity_id,state,public_visible,occurred_at,sort_order);
CREATE INDEX idx_archive_blackboard_fragments_library
  ON archive_blackboard_fragments(state,record_entity_id,updated_at,sort_order);
CREATE INDEX idx_archive_blackboard_fragment_states_state
  ON archive_blackboard_fragment_states(state_id,sort_order,fragment_id);
CREATE INDEX idx_archive_blackboard_fragment_placements_state
  ON archive_blackboard_fragment_placements(state_id,sort_order,fragment_id);
CREATE INDEX idx_archive_blackboard_fragment_placements_mask
  ON archive_blackboard_fragment_placements(hotspot_mask_media_id)
  WHERE hotspot_mask_media_id IS NOT NULL;

-- Every save is a new nondestructive edit revision. Large alpha masks and
-- rendered outputs remain R2-backed Digital assets; D1 stores their lineage and
-- the compact normalized crop/brush recipe only.
CREATE TABLE archive_blackboard_fragment_edits (
  id TEXT PRIMARY KEY,
  fragment_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  source_media_id TEXT NOT NULL,
  alpha_mask_media_id TEXT,
  output_media_id TEXT NOT NULL,
  recipe_json TEXT NOT NULL DEFAULT '{}',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(fragment_id,revision_number),
  FOREIGN KEY(fragment_id) REFERENCES archive_blackboard_fragments(id) ON DELETE CASCADE,
  FOREIGN KEY(source_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(alpha_mask_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(output_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_archive_blackboard_fragment_edits_current
  ON archive_blackboard_fragment_edits(fragment_id)
  WHERE is_current=1;
CREATE INDEX idx_archive_blackboard_fragment_edits_output
  ON archive_blackboard_fragment_edits(output_media_id,fragment_id);

-- Existing public derivatives remain the current display and become a legacy
-- revision without pretending that an editable mask or crop recipe existed.
INSERT INTO archive_blackboard_fragment_edits (
  id,fragment_id,revision_number,source_media_id,alpha_mask_media_id,
  output_media_id,recipe_json,is_current,created_at,updated_at
)
SELECT
  'blackboard-fragment-edit-'||replace(fragment.id,'/','-')||'-1',
  fragment.id,1,COALESCE(fragment.edit_source_media_id,fragment.derivative_media_id),
  NULL,fragment.derivative_media_id,'{"version":1,"mode":"legacy-import"}',1,
  fragment.created_at,fragment.updated_at
FROM archive_blackboard_fragments fragment
WHERE fragment.derivative_media_id IS NOT NULL;

PRAGMA foreign_keys = ON;
