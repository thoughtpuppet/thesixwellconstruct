PRAGMA foreign_keys = OFF;

-- A physical Blackboard is one catalogued Archive record. Dated complete-board
-- photographs document successive states of that record; they are not separate
-- cultural objects. Context photographs belong to the record's Open Notebook.
CREATE TABLE archive_blackboard_records (
  record_entity_id TEXT PRIMARY KEY,
  studio_location TEXT NOT NULL DEFAULT '',
  wall_designation TEXT NOT NULL DEFAULT '',
  orientation_note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(record_entity_id) REFERENCES archive_records(id) ON DELETE CASCADE
);

-- Capture the temporary surface-to-record model before replacing it. The first
-- dated capture becomes the enduring record; later captures become its states.
CREATE TABLE blackboard_capture_merge AS
SELECT
  surface.id surface_id,
  capture.capture_entity_id old_entity_id,
  FIRST_VALUE(capture.capture_entity_id) OVER (
    PARTITION BY surface.id
    ORDER BY COALESCE(object_state.occurred_at,record.date_or_period,record.created_at),capture.created_at
  ) record_entity_id,
  FIRST_VALUE(version.id) OVER (
    PARTITION BY surface.id
    ORDER BY COALESCE(object_state.occurred_at,record.date_or_period,record.created_at),capture.created_at
  ) record_version_id,
  ROW_NUMBER() OVER (
    PARTITION BY surface.id
    ORDER BY COALESCE(object_state.occurred_at,record.date_or_period,record.created_at),capture.created_at
  ) state_order,
  object_state.id old_state_id,
  object_state.lead_material_id,
  object_state.occurred_at,
  object_state.date_precision,
  object_state.date_label,
  surface.slug,surface.title,surface.studio_location,surface.wall_designation,
  surface.orientation_note,surface.summary,surface.sort_order
FROM archive_blackboard_surfaces surface
JOIN archive_blackboard_capture_surfaces capture ON capture.surface_id=surface.id
JOIN archive_records record ON record.id=capture.capture_entity_id
JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=record.id
JOIN archive_object_states object_state ON object_state.id=catalogue.current_state_id
JOIN archive_object_versions version ON version.id=object_state.version_id;

CREATE TABLE blackboard_state_merge AS
SELECT merge_row.*,
  CASE WHEN merge_row.state_order=1 THEN merge_row.old_state_id
    ELSE 'archive-state-blackboard-merged-'||merge_row.old_state_id END new_state_id,
  CASE merge_row.state_order
    WHEN 1 THEN 'I' WHEN 2 THEN 'II' WHEN 3 THEN 'III' WHEN 4 THEN 'IV'
    WHEN 5 THEN 'V' WHEN 6 THEN 'VI' WHEN 7 THEN 'VII' WHEN 8 THEN 'VIII'
    WHEN 9 THEN 'IX' WHEN 10 THEN 'X' ELSE CAST(merge_row.state_order AS TEXT)
  END new_state_roman
FROM blackboard_capture_merge merge_row;

INSERT OR IGNORE INTO archive_blackboard_records
  (record_entity_id,studio_location,wall_designation,orientation_note,sort_order,created_by,updated_by,created_at,updated_at)
SELECT record_entity_id,studio_location,wall_designation,orientation_note,sort_order,
  'migration-0176','migration-0176',datetime('now'),datetime('now')
FROM blackboard_state_merge
GROUP BY surface_id,record_entity_id;

-- Keep the first capture's existing State I and add later states beneath the
-- same Version 1. Existing lead materials remain the public state images.
UPDATE archive_object_states
SET state_roman='I',state_order=1,title='State I',description='Complete Blackboard state documented on '||COALESCE(NULLIF(date_label,''),'an undated capture'),
  sort_order=1,publication_state='published',public_visible=1,updated_by='migration-0176',updated_at=datetime('now')
WHERE id IN (SELECT old_state_id FROM blackboard_state_merge WHERE state_order=1);

INSERT OR IGNORE INTO archive_object_states
  (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,
   publication_state,public_visible,lead_material_id,created_by,updated_by,created_at,updated_at)
SELECT new_state_id,record_version_id,new_state_roman,state_order,'State '||new_state_roman,
  'Complete Blackboard state documented on '||COALESCE(NULLIF(date_label,''),'an undated capture'),'',occurred_at,date_precision,date_label,state_order,
  'published',1,lead_material_id,'migration-0176','migration-0176',datetime('now'),datetime('now')
FROM blackboard_state_merge WHERE state_order>1;

UPDATE archive_materials
SET dossier_entity_id=(SELECT record_entity_id FROM blackboard_state_merge map WHERE map.old_entity_id=archive_materials.dossier_entity_id LIMIT 1),
  state_id=(SELECT new_state_id FROM blackboard_state_merge map WHERE map.old_entity_id=archive_materials.dossier_entity_id LIMIT 1),
  role='blackboard-whole',material_type='artifact',process_phase='captured state',
  state='published',visibility='public',updated_by='migration-0176',updated_at=datetime('now')
WHERE dossier_entity_id IN (SELECT old_entity_id FROM blackboard_state_merge);

UPDATE archive_material_source_contexts
SET board_entity_id=(SELECT record_entity_id FROM blackboard_state_merge map WHERE map.old_entity_id=archive_material_source_contexts.board_entity_id LIMIT 1),
  updated_by='migration-0176',updated_at=datetime('now')
WHERE board_entity_id IN (SELECT old_entity_id FROM blackboard_state_merge);

UPDATE archive_source_material_states
SET state_id=(SELECT new_state_id FROM blackboard_state_merge map WHERE map.old_state_id=archive_source_material_states.state_id LIMIT 1)
WHERE state_id IN (SELECT old_state_id FROM blackboard_state_merge);

UPDATE archive_source_material_sets
SET dossier_entity_id=(SELECT record_entity_id FROM blackboard_state_merge map WHERE map.old_entity_id=archive_source_material_sets.dossier_entity_id LIMIT 1),
  board_entity_id=(SELECT record_entity_id FROM blackboard_state_merge map WHERE map.old_entity_id=archive_source_material_sets.board_entity_id LIMIT 1),
  updated_by='migration-0176',updated_at=datetime('now')
WHERE dossier_entity_id IN (SELECT old_entity_id FROM blackboard_state_merge);

-- Surface context becomes regular Notebook evidence. Its derivative is public;
-- the paired HEIC/TIFF/JPEG master remains hidden through media_asset_variants.
INSERT OR IGNORE INTO archive_materials
  (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,date_precision,date_label,
   visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
SELECT 'archive-material-notebook-'||context.id,map.record_entity_id,context.derivative_media_id,'notebook','process-photo',
  COALESCE(NULLIF(context.title,''),'Blackboard in the studio'),context.caption,'','studio context',context.occurred_at,
  CASE context.date_precision WHEN 'exact' THEN 'exact' WHEN 'year' THEN 'year' WHEN 'range' THEN 'range'
    WHEN 'undated' THEN 'undated' ELSE 'approximate' END,
  context.date_label,CASE WHEN context.state='published' AND context.public_visible=1 AND context.derivative_media_id IS NOT NULL THEN 'public' ELSE 'internal' END,
  context.state,context.sort_order,NULL,'',0,'migration-0176','migration-0176',context.created_at,datetime('now')
FROM archive_blackboard_surface_media context
JOIN (SELECT surface_id,record_entity_id FROM blackboard_state_merge GROUP BY surface_id,record_entity_id) map ON map.surface_id=context.surface_id
WHERE context.derivative_media_id IS NOT NULL;

-- Rebuild fragments against the canonical record and let optional Visible in
-- links name states instead of obsolete capture records.
CREATE TABLE archive_blackboard_fragments_next (
  id TEXT PRIMARY KEY,
  record_entity_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  master_media_id TEXT,
  derivative_media_id TEXT,
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated' CHECK(date_precision IN ('exact','day','month','year','circa','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(record_entity_id,slug),
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(record_entity_id) REFERENCES archive_blackboard_records(record_entity_id) ON DELETE CASCADE,
  FOREIGN KEY(master_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(derivative_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(master_media_id IS NULL OR derivative_media_id IS NULL OR master_media_id<>derivative_media_id)
);

INSERT INTO archive_blackboard_fragments_next
  (id,record_entity_id,slug,title,caption,body,master_media_id,derivative_media_id,occurred_at,date_precision,date_label,state,
   public_visible,sort_order,created_by,updated_by,created_at,updated_at,published_at)
SELECT fragment.id,map.record_entity_id,fragment.slug,fragment.title,fragment.caption,fragment.body,fragment.master_media_id,
  fragment.derivative_media_id,fragment.occurred_at,fragment.date_precision,fragment.date_label,fragment.state,fragment.public_visible,
  fragment.sort_order,fragment.created_by,fragment.updated_by,fragment.created_at,fragment.updated_at,fragment.published_at
FROM archive_blackboard_fragments fragment
JOIN (SELECT surface_id,record_entity_id FROM blackboard_state_merge GROUP BY surface_id,record_entity_id) map ON map.surface_id=fragment.surface_id;

CREATE TABLE archive_blackboard_fragment_states (
  fragment_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  PRIMARY KEY(fragment_id,state_id),
  FOREIGN KEY(fragment_id) REFERENCES archive_blackboard_fragments_next(id) ON DELETE CASCADE,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO archive_blackboard_fragment_states(fragment_id,state_id,note,sort_order,created_by,created_at)
SELECT link.fragment_id,map.new_state_id,link.note,link.sort_order,link.created_by,link.created_at
FROM archive_blackboard_fragment_captures link
JOIN blackboard_state_merge map ON map.old_entity_id=link.capture_entity_id;

-- Make the earliest capture the public record and its latest state current.
UPDATE archive_records
SET title=(SELECT title FROM blackboard_state_merge map WHERE map.record_entity_id=archive_records.id LIMIT 1),
  slug=(SELECT slug FROM blackboard_state_merge map WHERE map.record_entity_id=archive_records.id LIMIT 1),
  summary='An evolving studio blackboard documented through dated states and an Open Notebook of context and fragments.',
  date_or_period=(SELECT date_label FROM blackboard_state_merge map WHERE map.record_entity_id=archive_records.id ORDER BY state_order DESC LIMIT 1),
  record_status='active evolving Blackboard',state='published',updated_at=datetime('now')
WHERE id IN (SELECT record_entity_id FROM blackboard_state_merge);

UPDATE archive_dossiers
SET archive_slug=(SELECT slug FROM blackboard_state_merge map WHERE map.record_entity_id=archive_dossiers.entity_id LIMIT 1),
  orientation='An evolving studio blackboard documented through dated states and an Open Notebook of context and fragments.',
  empty_materials_note='No Notebook materials are public yet.',state='published',public_visible=1,
  updated_by='migration-0176',updated_at=datetime('now')
WHERE entity_id IN (SELECT record_entity_id FROM blackboard_state_merge);

UPDATE archive_object_versions
SET title='Version 1',description='The first documented physical incarnation of this Blackboard.',
  occurred_at=(SELECT occurred_at FROM blackboard_state_merge map WHERE map.record_version_id=archive_object_versions.id ORDER BY state_order LIMIT 1),
  date_precision=(SELECT date_precision FROM blackboard_state_merge map WHERE map.record_version_id=archive_object_versions.id ORDER BY state_order LIMIT 1),
  date_label=(SELECT date_label FROM blackboard_state_merge map WHERE map.record_version_id=archive_object_versions.id ORDER BY state_order LIMIT 1),
  publication_state='published',public_visible=1,updated_by='migration-0176',updated_at=datetime('now')
WHERE id IN (SELECT record_version_id FROM blackboard_state_merge);

UPDATE archive_catalogue_entries
SET current_version=1,
  current_state=(SELECT new_state_roman FROM blackboard_state_merge map WHERE map.record_entity_id=archive_catalogue_entries.entity_id ORDER BY state_order DESC LIMIT 1),
  current_state_id=(SELECT new_state_id FROM blackboard_state_merge map WHERE map.record_entity_id=archive_catalogue_entries.entity_id ORDER BY state_order DESC LIMIT 1),
  updated_by='migration-0176',updated_at=datetime('now')
WHERE entity_id IN (SELECT record_entity_id FROM blackboard_state_merge);

UPDATE content_entities SET visibility='public',search_visibility=1,updated_by='migration-0176',updated_at=datetime('now')
WHERE id IN (SELECT record_entity_id FROM blackboard_state_merge);

UPDATE archive_records SET state='archived',record_status='merged into enduring Blackboard record',updated_at=datetime('now')
WHERE id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id);
UPDATE archive_dossiers SET state='archived',public_visible=0,updated_by='migration-0176',updated_at=datetime('now')
WHERE entity_id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id);
UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=COALESCE(archived_at,datetime('now')),updated_by='migration-0176',updated_at=datetime('now')
WHERE id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id);
UPDATE archive_object_versions SET publication_state='archived',public_visible=0,updated_by='migration-0176',updated_at=datetime('now')
WHERE entity_id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id);
UPDATE archive_object_states SET publication_state='archived',public_visible=0,updated_by='migration-0176',updated_at=datetime('now')
WHERE version_id IN (SELECT id FROM archive_object_versions WHERE entity_id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id));

DROP TABLE archive_blackboard_fragment_captures;
DROP TABLE archive_blackboard_fragments;
DROP TABLE archive_blackboard_surface_media;
DROP TABLE archive_blackboard_capture_surfaces;
DROP TABLE archive_blackboard_surfaces;
ALTER TABLE archive_blackboard_fragments_next RENAME TO archive_blackboard_fragments;

CREATE INDEX idx_archive_blackboard_records_order ON archive_blackboard_records(sort_order,record_entity_id);
CREATE INDEX idx_archive_blackboard_fragments_public ON archive_blackboard_fragments(record_entity_id,state,public_visible,occurred_at,sort_order);
CREATE INDEX idx_archive_blackboard_fragment_states_state ON archive_blackboard_fragment_states(state_id,sort_order,fragment_id);

DELETE FROM content_entities WHERE entity_type='archive_blackboard_surface';
DELETE FROM search_documents WHERE entity_id IN (SELECT old_entity_id FROM blackboard_state_merge WHERE old_entity_id<>record_entity_id);

UPDATE archive_cultural_object_types
SET description='One enduring physical Blackboard documented through dated states.',
  state_guidance='Use one catalogue record for the physical board. Add each complete dated scan as the next state within the applicable physical version.',
  updated_at=datetime('now')
WHERE id='other-blackboard';

DROP TABLE blackboard_state_merge;
DROP TABLE blackboard_capture_merge;

PRAGMA foreign_keys = ON;
