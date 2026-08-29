PRAGMA foreign_keys = ON;

-- Archive dossiers are editable Studio records from the first source save.
-- Source publication and Archive publication remain separate editorial gates.
DROP TRIGGER IF EXISTS archive_shell_content_entity_insert;
DROP TRIGGER IF EXISTS archive_shell_content_entity_publish;

-- Events and appearances share the EVT authority. They are not cultural
-- objects and therefore never receive object catalogue versions or states.
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
  -- Blackboard creation owns its dated identity and source-material setup.
  WHERE ce.id=NEW.entity_id
    AND ce.entity_type NOT IN ('event','appearance','archive_record');

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
  WHERE ce.id=NEW.entity_id AND ce.entity_type IN ('event','appearance');
END;

-- Backfill active canonical creative records only. Retired work remains part of
-- the creative record; archived source rows and archived canonical entities do
-- not receive a dossier until Studio explicitly opens them.
WITH RECURSIVE eligible AS (
  SELECT ce.id,ce.entity_type,ce.created_at,
    COALESCE(
      NULLIF(TRIM(CASE ce.entity_type
        WHEN 'art_work' THEN (SELECT slug FROM art_works WHERE id=ce.id)
        WHEN 'merch_item' THEN (SELECT COALESCE(NULLIF(slug,''),NULLIF(shopify_handle,'')) FROM merch_items WHERE id=ce.id)
        WHEN 'flash_item' THEN (SELECT slug FROM flash_items WHERE id=ce.id)
        WHEN 'tattoo_design' THEN (SELECT slug FROM tattoo_designs WHERE id=ce.id)
        WHEN 'event' THEN (SELECT slug FROM events WHERE id=ce.id)
        WHEN 'appearance' THEN (SELECT slug FROM artist_appearances WHERE id=ce.id)
        WHEN 'visual_symbol' THEN (SELECT slug FROM visual_symbols WHERE id=ce.id)
      END),''),
      NULLIF(TRIM(ce.id),''),
      'archive-entity-'||lower(hex(CAST(ce.id AS BLOB)))
    ) base_slug,
    replace(ce.entity_type,'_','-') type_prefix,
    CASE ce.entity_type
      WHEN 'art_work' THEN 'artwork'
      WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo'
      WHEN 'flash_item' THEN 'flash'
      WHEN 'tattoo_design' THEN 'tattoo-design'
      WHEN 'event' THEN 'event'
      WHEN 'appearance' THEN 'event'
      WHEN 'visual_symbol' THEN 'symbol'
      ELSE replace(ce.entity_type,'_','-')
    END record_type
  FROM content_entities ce
  WHERE ce.entity_type IN (
      'art_work','merch_item','portfolio_item','flash_item','tattoo_design',
      'event','appearance','visual_symbol','writing_work','film_work','music_work'
    )
    AND ce.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM archive_dossiers existing WHERE existing.entity_id=ce.id)
    AND CASE ce.entity_type
      WHEN 'art_work' THEN EXISTS(SELECT 1 FROM art_works source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'merch_item' THEN EXISTS(SELECT 1 FROM merch_items source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'portfolio_item' THEN EXISTS(SELECT 1 FROM portfolio_items source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'flash_item' THEN EXISTS(SELECT 1 FROM flash_items source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'tattoo_design' THEN EXISTS(SELECT 1 FROM tattoo_designs source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'event' THEN EXISTS(SELECT 1 FROM events source WHERE source.id=ce.id)
      WHEN 'appearance' THEN EXISTS(SELECT 1 FROM artist_appearances source WHERE source.id=ce.id AND source.state<>'archived')
      WHEN 'visual_symbol' THEN EXISTS(SELECT 1 FROM visual_symbols source WHERE source.id=ce.id AND source.state<>'archived')
      ELSE 1
    END
), ordered AS (
  SELECT eligible.*,
    row_number() OVER(ORDER BY created_at,id) sequence
  FROM eligible
), candidate_priorities(priority) AS (
  SELECT 0
  UNION ALL
  SELECT priority+1
  FROM candidate_priorities
  WHERE priority<(SELECT COUNT(*) FROM archive_dossiers)+(SELECT COUNT(*) FROM ordered)+2
), candidate_options AS (
  SELECT ordered.*,candidate_priorities.priority,
    CASE candidate_priorities.priority
      WHEN 0 THEN base_slug
      WHEN 1 THEN type_prefix||'-'||base_slug
      WHEN 2 THEN type_prefix||'-'||base_slug||'-entity-'||lower(hex(CAST(id AS BLOB)))
      ELSE type_prefix||'-'||base_slug||'-entity-'||lower(hex(CAST(id AS BLOB)))||'-'||CAST(candidate_priorities.priority-1 AS TEXT)
    END candidate_slug
  FROM ordered
  CROSS JOIN candidate_priorities
), slug_walk(sequence,priority,used_slug_hex,assigned_id,archive_slug,accepted) AS (
  SELECT 1,0,',',NULL,NULL,0
  UNION ALL
  SELECT
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN slug_walk.sequence+1 ELSE slug_walk.sequence END,
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN 0 ELSE slug_walk.priority+1 END,
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN slug_walk.used_slug_hex||lower(hex(CAST(option.candidate_slug AS BLOB)))||','
      ELSE slug_walk.used_slug_hex END,
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN option.id ELSE NULL END,
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN option.candidate_slug ELSE NULL END,
    CASE WHEN NOT EXISTS(
        SELECT 1 FROM archive_dossiers occupied
        WHERE occupied.archive_slug=option.candidate_slug
      ) AND instr(slug_walk.used_slug_hex,','||lower(hex(CAST(option.candidate_slug AS BLOB)))||',')=0
      THEN 1 ELSE 0 END
  FROM slug_walk
  JOIN candidate_options option
    ON option.sequence=slug_walk.sequence AND option.priority=slug_walk.priority
), resolved AS (
  SELECT ordered.*,slug_walk.archive_slug
  FROM slug_walk
  JOIN ordered ON ordered.id=slug_walk.assigned_id
  WHERE slug_walk.accepted=1
)
INSERT INTO archive_dossiers(
  entity_id,archive_slug,record_type,state,public_visible,published_at,
  created_by,updated_by,created_at,updated_at
)
SELECT id,archive_slug,record_type,'draft',0,NULL,
  'migration-0183','migration-0183',datetime('now'),datetime('now')
FROM resolved
ORDER BY created_at,id;

-- Repair missing EVT identities without deleting or renumbering any existing
-- dossier, catalogue identity, version, or state.
WITH missing_events AS (
  SELECT ad.entity_id,ad.created_at,
    row_number() OVER(ORDER BY ad.created_at,ad.entity_id) event_offset
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id AND ce.entity_type IN ('event','appearance')
  LEFT JOIN archive_event_identifiers identifier ON identifier.entity_id=ad.entity_id
  WHERE identifier.entity_id IS NULL
)
INSERT INTO archive_event_identifiers(
  entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at
)
SELECT entity_id,
  COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+event_offset,
  'EVT-'||printf('%03d',COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+event_offset),
  'migration-0183','migration-0183',datetime('now'),datetime('now')
FROM missing_events;

-- New canonical entities receive a private shell immediately. Source rows are
-- normally written in the same batch; the shared Worker helper refines an
-- ID-based provisional slug after that source row exists.
CREATE TRIGGER archive_shell_content_entity_insert
AFTER INSERT ON content_entities
WHEN NEW.archived_at IS NULL
  AND NEW.entity_type IN (
    'art_work','merch_item','portfolio_item','flash_item','tattoo_design',
    'event','appearance','visual_symbol','writing_work','film_work','music_work'
  )
BEGIN
  INSERT OR IGNORE INTO archive_dossiers(
    entity_id,archive_slug,record_type,state,public_visible,published_at,
    created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.id,
    CASE
      WHEN EXISTS(
        SELECT 1 FROM archive_dossiers other
        WHERE other.archive_slug=COALESCE(
          (SELECT slug FROM art_works WHERE id=NEW.id),
          (SELECT slug FROM merch_items WHERE id=NEW.id),
          (SELECT slug FROM flash_items WHERE id=NEW.id),
          (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
          (SELECT slug FROM events WHERE id=NEW.id),
          (SELECT slug FROM artist_appearances WHERE id=NEW.id),
          (SELECT slug FROM visual_symbols WHERE id=NEW.id),
          NEW.id
        ) AND other.entity_id<>NEW.id
      ) THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE(
        (SELECT slug FROM art_works WHERE id=NEW.id),
        (SELECT slug FROM merch_items WHERE id=NEW.id),
        (SELECT slug FROM flash_items WHERE id=NEW.id),
        (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
        (SELECT slug FROM events WHERE id=NEW.id),
        (SELECT slug FROM artist_appearances WHERE id=NEW.id),
        (SELECT slug FROM visual_symbols WHERE id=NEW.id),
        NEW.id
      )
      ELSE COALESCE(
        (SELECT slug FROM art_works WHERE id=NEW.id),
        (SELECT slug FROM merch_items WHERE id=NEW.id),
        (SELECT slug FROM flash_items WHERE id=NEW.id),
        (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
        (SELECT slug FROM events WHERE id=NEW.id),
        (SELECT slug FROM artist_appearances WHERE id=NEW.id),
        (SELECT slug FROM visual_symbols WHERE id=NEW.id),
        NEW.id
      )
    END,
    CASE NEW.entity_type
      WHEN 'art_work' THEN 'artwork'
      WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo'
      WHEN 'flash_item' THEN 'flash'
      WHEN 'tattoo_design' THEN 'tattoo-design'
      WHEN 'event' THEN 'event'
      WHEN 'appearance' THEN 'event'
      WHEN 'visual_symbol' THEN 'symbol'
      ELSE replace(NEW.entity_type,'_','-')
    END,
    'draft',0,NULL,'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

-- Keep a recovery trigger for canonical records created before this invariant
-- or restored without a dossier. Publication only ensures a private shell.
CREATE TRIGGER archive_shell_content_entity_publish
AFTER UPDATE OF visibility ON content_entities
WHEN NEW.visibility='public' AND NEW.archived_at IS NULL
  AND NEW.entity_type IN (
    'art_work','merch_item','portfolio_item','flash_item','tattoo_design',
    'event','appearance','visual_symbol','writing_work','film_work','music_work'
  )
BEGIN
  INSERT OR IGNORE INTO archive_dossiers(
    entity_id,archive_slug,record_type,state,public_visible,published_at,
    created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.id,
    CASE
      WHEN EXISTS(
        SELECT 1 FROM archive_dossiers other
        WHERE other.archive_slug=COALESCE(
          (SELECT slug FROM art_works WHERE id=NEW.id),
          (SELECT slug FROM merch_items WHERE id=NEW.id),
          (SELECT slug FROM flash_items WHERE id=NEW.id),
          (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
          (SELECT slug FROM events WHERE id=NEW.id),
          (SELECT slug FROM artist_appearances WHERE id=NEW.id),
          (SELECT slug FROM visual_symbols WHERE id=NEW.id),
          NEW.id
        ) AND other.entity_id<>NEW.id
      ) THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE(
        (SELECT slug FROM art_works WHERE id=NEW.id),
        (SELECT slug FROM merch_items WHERE id=NEW.id),
        (SELECT slug FROM flash_items WHERE id=NEW.id),
        (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
        (SELECT slug FROM events WHERE id=NEW.id),
        (SELECT slug FROM artist_appearances WHERE id=NEW.id),
        (SELECT slug FROM visual_symbols WHERE id=NEW.id),
        NEW.id
      )
      ELSE COALESCE(
        (SELECT slug FROM art_works WHERE id=NEW.id),
        (SELECT slug FROM merch_items WHERE id=NEW.id),
        (SELECT slug FROM flash_items WHERE id=NEW.id),
        (SELECT slug FROM tattoo_designs WHERE id=NEW.id),
        (SELECT slug FROM events WHERE id=NEW.id),
        (SELECT slug FROM artist_appearances WHERE id=NEW.id),
        (SELECT slug FROM visual_symbols WHERE id=NEW.id),
        NEW.id
      )
    END,
    CASE NEW.entity_type
      WHEN 'art_work' THEN 'artwork'
      WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo'
      WHEN 'flash_item' THEN 'flash'
      WHEN 'tattoo_design' THEN 'tattoo-design'
      WHEN 'event' THEN 'event'
      WHEN 'appearance' THEN 'event'
      WHEN 'visual_symbol' THEN 'symbol'
      ELSE replace(NEW.entity_type,'_','-')
    END,
    'draft',0,NULL,'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;
