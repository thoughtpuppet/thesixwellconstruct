PRAGMA foreign_keys = ON;

-- Every cultural-object dossier needs a catalogue identity before versions,
-- states, palette usages, and placement maps can be recorded. Repair shells
-- created after the original catalogue backfill and make the invariant apply
-- to every future dossier insertion, regardless of which manager creates it.
WITH missing AS (
  SELECT ad.entity_id,ad.created_at,
    CASE ce.entity_type
      WHEN 'art_work' THEN 'art-other'
      WHEN 'merch_item' THEN 'merch-other'
      WHEN 'portfolio_item' THEN 'tattoo-execution'
      WHEN 'flash_item' THEN 'tattoo-flash-design'
      WHEN 'tattoo_design' THEN 'tattoo-design'
      WHEN 'visual_symbol' THEN 'legend-symbol'
      WHEN 'film_work' THEN 'film-work'
      WHEN 'music_work' THEN 'music-work'
      WHEN 'writing_work' THEN 'writing-work'
      WHEN 'archive_record' THEN CASE
        WHEN EXISTS(SELECT 1 FROM archive_records ar WHERE ar.id=ce.id AND ar.record_type='blackboard') THEN 'other-blackboard'
        ELSE 'other-cultural-object'
      END
      ELSE CASE
        WHEN ce.node_id IN ('film','node-film') THEN 'film-work'
        WHEN ce.node_id IN ('music','node-music') THEN 'music-work'
        WHEN ce.node_id IN ('writings','node-writings') THEN 'writing-work'
        ELSE 'other-cultural-object'
      END
    END object_type_id
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN archive_catalogue_entries ace ON ace.entity_id=ad.entity_id
  WHERE ace.entity_id IS NULL AND ce.entity_type<>'event'
), classified AS (
  SELECT missing.entity_id,missing.created_at,missing.object_type_id,
    type.medium_id,type.catalogue_prefix
  FROM missing
  JOIN archive_cultural_object_types type ON type.id=missing.object_type_id
), numbered AS (
  SELECT classified.*,
    row_number() OVER(PARTITION BY catalogue_prefix ORDER BY created_at,entity_id) catalogue_offset
  FROM classified
)
INSERT INTO archive_catalogue_entries(
  entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,
  current_version,current_state,variant_label,current_state_id,
  created_by,updated_by,created_at,updated_at
)
SELECT entity_id,medium_id,object_type_id,catalogue_prefix,
  COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=numbered.catalogue_prefix),0)+catalogue_offset,
  catalogue_prefix||'-'||printf('%03d',COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=numbered.catalogue_prefix),0)+catalogue_offset),
  1,'I','',NULL,'migration-0085','migration-0085',datetime('now'),datetime('now')
FROM numbered;

-- Repair any partial catalogue row that has no version, then guarantee that
-- every existing version has at least one internal state to receive evidence.
INSERT INTO archive_object_versions(
  id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,
  sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at
)
SELECT 'archive-version-initial:'||ace.entity_id,ace.entity_id,1,'Version 1','',NULL,'undated','',
  1,'draft',0,'migration-0085','migration-0085',datetime('now'),datetime('now')
FROM archive_catalogue_entries ace
WHERE NOT EXISTS(SELECT 1 FROM archive_object_versions existing WHERE existing.entity_id=ace.entity_id);

INSERT INTO archive_object_states(
  id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,
  date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,
  created_by,updated_by,created_at,updated_at
)
SELECT 'archive-state-initial:'||version.id,version.id,'I',1,'First documented state','','',NULL,
  'undated','',1,'draft',0,NULL,'migration-0085','migration-0085',datetime('now'),datetime('now')
FROM archive_object_versions version
WHERE NOT EXISTS(SELECT 1 FROM archive_object_states existing WHERE existing.version_id=version.id);

-- Events use their separate EVT authority sequence and never receive object
-- versions or creative states.
WITH missing_events AS (
  SELECT ad.entity_id,ad.created_at,
    row_number() OVER(ORDER BY ad.created_at,ad.entity_id) event_offset
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id AND ce.entity_type='event'
  LEFT JOIN archive_event_identifiers identifier ON identifier.entity_id=ad.entity_id
  WHERE identifier.entity_id IS NULL
)
INSERT INTO archive_event_identifiers(
  entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at
)
SELECT entity_id,
  COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+event_offset,
  'EVT-'||printf('%03d',COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+event_offset),
  'migration-0085','migration-0085',datetime('now'),datetime('now')
FROM missing_events;

DROP TRIGGER IF EXISTS archive_dossier_structure_insert;
CREATE TRIGGER archive_dossier_structure_insert
AFTER INSERT ON archive_dossiers
BEGIN
  INSERT OR IGNORE INTO archive_catalogue_entries(
    entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,
    current_version,current_state,variant_label,current_state_id,
    created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.entity_id,type.medium_id,type.id,type.catalogue_prefix,
    COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=type.catalogue_prefix),0)+1,
    type.catalogue_prefix||'-'||printf('%03d',COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=type.catalogue_prefix),0)+1),
    1,'I','',NULL,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM content_entities ce
  JOIN archive_cultural_object_types type ON type.id=CASE ce.entity_type
    WHEN 'art_work' THEN 'art-other'
    WHEN 'merch_item' THEN 'merch-other'
    WHEN 'portfolio_item' THEN 'tattoo-execution'
    WHEN 'flash_item' THEN 'tattoo-flash-design'
    WHEN 'tattoo_design' THEN 'tattoo-design'
    WHEN 'visual_symbol' THEN 'legend-symbol'
    WHEN 'film_work' THEN 'film-work'
    WHEN 'music_work' THEN 'music-work'
    WHEN 'writing_work' THEN 'writing-work'
    WHEN 'archive_record' THEN CASE
      WHEN EXISTS(SELECT 1 FROM archive_records ar WHERE ar.id=ce.id AND ar.record_type='blackboard') THEN 'other-blackboard'
      ELSE 'other-cultural-object'
    END
    ELSE CASE
      WHEN ce.node_id IN ('film','node-film') THEN 'film-work'
      WHEN ce.node_id IN ('music','node-music') THEN 'music-work'
      WHEN ce.node_id IN ('writings','node-writings') THEN 'writing-work'
      ELSE 'other-cultural-object'
    END
  END
  -- Blackboard creation already writes its identity, dated Version 1, State I,
  -- and source-material set atomically in the same Worker batch.
  WHERE ce.id=NEW.entity_id AND ce.entity_type NOT IN ('event','archive_record');

  INSERT OR IGNORE INTO archive_object_versions(
    id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,
    sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at
  )
  SELECT 'archive-version-initial:'||NEW.entity_id,NEW.entity_id,1,'Version 1','',NULL,'undated','',
    1,'draft',0,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM archive_catalogue_entries catalogue
  WHERE catalogue.entity_id=NEW.entity_id
    AND NOT EXISTS(SELECT 1 FROM archive_object_versions existing WHERE existing.entity_id=NEW.entity_id);

  INSERT OR IGNORE INTO archive_object_states(
    id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,
    date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,
    created_by,updated_by,created_at,updated_at
  )
  SELECT 'archive-state-initial:'||version.id,version.id,'I',1,'First documented state','','',NULL,
    'undated','',1,'draft',0,NULL,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM archive_object_versions version
  WHERE version.entity_id=NEW.entity_id
    AND NOT EXISTS(SELECT 1 FROM archive_object_states existing WHERE existing.version_id=version.id)
  ORDER BY version.sort_order,version.version_number,version.id
  LIMIT 1;

  INSERT OR IGNORE INTO archive_event_identifiers(
    entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.entity_id,
    COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+1,
    'EVT-'||printf('%03d',COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+1),
    'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM content_entities ce
  WHERE ce.id=NEW.entity_id AND ce.entity_type='event';
END;
