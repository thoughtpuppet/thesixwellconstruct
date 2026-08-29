PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS archive_visual_analysis_runs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('art_work','portfolio_item','flash_item','merch_item')),
  entity_id TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','ready','active','needs_confirmation','rejected','superseded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  raw_result_json TEXT NOT NULL DEFAULT '',
  normalized_suggestions_json TEXT NOT NULL DEFAULT '[]',
  descriptor_suggestions_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, source_fingerprint, model_name, prompt_version),
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_visual_analysis_runs_queue
  ON archive_visual_analysis_runs(status, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_archive_visual_analysis_runs_entity
  ON archive_visual_analysis_runs(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS archive_visual_color_entity_assignments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('art_work','portfolio_item','flash_item','merch_item')),
  entity_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  strength TEXT NOT NULL CHECK(strength IN ('dominant','supporting','accent')),
  display_order INTEGER NOT NULL DEFAULT 0,
  source_run_id TEXT,
  origin TEXT NOT NULL DEFAULT 'automatic' CHECK(origin IN ('automatic','studio')),
  updated_by TEXT NOT NULL DEFAULT 'automatic',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, family_id),
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(family_id) REFERENCES archive_color_families(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_run_id) REFERENCES archive_visual_analysis_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_visual_color_entity_family
  ON archive_visual_color_entity_assignments(family_id, strength, display_order);

CREATE TABLE IF NOT EXISTS archive_work_descriptor_entity_assignments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('art_work','portfolio_item','flash_item','merch_item')),
  entity_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  source_run_id TEXT,
  origin TEXT NOT NULL DEFAULT 'automatic' CHECK(origin IN ('automatic','studio')),
  updated_by TEXT NOT NULL DEFAULT 'automatic',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, term_id),
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(term_id) REFERENCES archive_work_descriptor_terms(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_run_id) REFERENCES archive_visual_analysis_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_work_descriptor_entity_term
  ON archive_work_descriptor_entity_assignments(term_id, entity_type);

CREATE TABLE IF NOT EXISTS archive_visual_color_controls (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('art_work','portfolio_item','flash_item','merch_item')),
  entity_id TEXT NOT NULL,
  analysis_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(analysis_mode IN ('automatic','paused')),
  has_studio_edits INTEGER NOT NULL DEFAULT 0 CHECK(has_studio_edits IN (0,1)),
  active_run_id TEXT,
  pending_confirmation_run_id TEXT,
  updated_by TEXT NOT NULL DEFAULT 'automatic',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id),
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(active_run_id) REFERENCES archive_visual_analysis_runs(id) ON DELETE SET NULL,
  FOREIGN KEY(pending_confirmation_run_id) REFERENCES archive_visual_analysis_runs(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO archive_work_descriptor_terms
  (id,slug,name,descriptor_kind,description,publication_state,public_visible,sort_order,created_at,updated_at)
VALUES
  ('work-descriptor-medium-flash','flash','Flash','medium','General creative medium.','published',1,25,datetime('now'),datetime('now')),
  ('work-descriptor-medium-merch','merch','Merch','medium','General creative medium.','published',1,27,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_visual_analysis_runs(
  id,entity_type,entity_id,source_manifest_json,source_fingerprint,model_name,model_version,prompt_version,
  status,attempts,raw_result_json,normalized_suggestions_json,descriptor_suggestions_json,error_text,
  started_at,completed_at,reviewed_by,reviewed_at,created_at,updated_at
)
SELECT id,
  CASE work_type WHEN 'painting' THEN 'art_work' ELSE 'portfolio_item' END,
  work_id,source_manifest_json,source_fingerprint,model_name,model_version,prompt_version,
  CASE status WHEN 'approved' THEN 'active' WHEN 'running' THEN 'pending' ELSE status END,
  CASE status WHEN 'running' THEN 0 ELSE attempts END,
  raw_result_json,normalized_suggestions_json,descriptor_suggestions_json,error_text,
  started_at,completed_at,reviewed_by,reviewed_at,created_at,updated_at
FROM archive_visual_color_runs
WHERE work_type IN ('painting','tattoo')
  AND EXISTS(SELECT 1 FROM content_entities entity WHERE entity.id=archive_visual_color_runs.work_id);

INSERT OR IGNORE INTO archive_visual_color_entity_assignments(
  id,entity_type,entity_id,family_id,strength,display_order,source_run_id,origin,updated_by,created_at,updated_at
)
SELECT assignment.id,
  CASE assignment.work_type WHEN 'painting' THEN 'art_work' ELSE 'portfolio_item' END,
  assignment.work_id,assignment.family_id,assignment.strength,assignment.display_order,assignment.source_run_id,
  CASE
    WHEN json_array_length(COALESCE(run.normalized_suggestions_json,'[]'))=(
      SELECT COUNT(*) FROM archive_visual_color_assignments sibling
      WHERE sibling.work_type=assignment.work_type AND sibling.work_id=assignment.work_id
    ) AND NOT EXISTS(
      SELECT 1 FROM archive_visual_color_assignments sibling
      WHERE sibling.work_type=assignment.work_type AND sibling.work_id=assignment.work_id
        AND NOT EXISTS(
          SELECT 1 FROM json_each(COALESCE(run.normalized_suggestions_json,'[]')) suggestion
          WHERE json_extract(suggestion.value,'$.family_id')=sibling.family_id
            AND json_extract(suggestion.value,'$.strength')=sibling.strength
        )
    ) THEN 'automatic' ELSE 'studio' END,
  CASE WHEN assignment.reviewed_by='' THEN 'migration' ELSE assignment.reviewed_by END,
  assignment.created_at,assignment.updated_at
FROM archive_visual_color_assignments assignment
JOIN archive_visual_analysis_runs run ON run.id=assignment.source_run_id;

INSERT OR IGNORE INTO archive_work_descriptor_entity_assignments(
  id,entity_type,entity_id,term_id,source_run_id,origin,updated_by,created_at,updated_at
)
SELECT assignment.id,
  CASE assignment.work_type WHEN 'painting' THEN 'art_work' ELSE 'portfolio_item' END,
  assignment.work_id,assignment.term_id,assignment.source_run_id,
  CASE
    WHEN json_array_length(COALESCE(json_extract(run.descriptor_suggestions_json,'$.term_slugs'),'[]'))=(
      SELECT COUNT(*) FROM archive_work_descriptor_assignments sibling
      WHERE sibling.work_type=assignment.work_type AND sibling.work_id=assignment.work_id
    ) AND NOT EXISTS(
      SELECT 1 FROM archive_work_descriptor_assignments sibling
      JOIN archive_work_descriptor_terms term ON term.id=sibling.term_id
      WHERE sibling.work_type=assignment.work_type AND sibling.work_id=assignment.work_id
        AND NOT EXISTS(
          SELECT 1 FROM json_each(COALESCE(json_extract(run.descriptor_suggestions_json,'$.term_slugs'),'[]')) suggestion
          WHERE suggestion.value=term.slug
        )
    ) THEN 'automatic' ELSE 'studio' END,
  CASE WHEN assignment.reviewed_by='' THEN 'migration' ELSE assignment.reviewed_by END,
  assignment.created_at,assignment.updated_at
FROM archive_work_descriptor_assignments assignment
JOIN archive_visual_analysis_runs run ON run.id=assignment.source_run_id;

INSERT OR IGNORE INTO archive_visual_color_controls(
  entity_type,entity_id,analysis_mode,has_studio_edits,active_run_id,pending_confirmation_run_id,
  updated_by,created_at,updated_at
)
SELECT entity_type,entity_id,'automatic',
  CASE WHEN EXISTS(
    SELECT 1 FROM archive_visual_color_entity_assignments color
    WHERE color.entity_type=entity.entity_type AND color.entity_id=entity.entity_id AND color.origin='studio'
  ) OR EXISTS(
    SELECT 1 FROM archive_work_descriptor_entity_assignments descriptor
    WHERE descriptor.entity_type=entity.entity_type AND descriptor.entity_id=entity.entity_id AND descriptor.origin='studio'
  ) THEN 1 ELSE 0 END,
  (SELECT source_run_id FROM archive_visual_color_entity_assignments color
    WHERE color.entity_type=entity.entity_type AND color.entity_id=entity.entity_id
    ORDER BY color.updated_at DESC LIMIT 1),
  NULL,'migration',datetime('now'),datetime('now')
FROM (
  SELECT entity_type,entity_id FROM archive_visual_color_entity_assignments
  UNION
  SELECT entity_type,entity_id FROM archive_work_descriptor_entity_assignments
) entity;
