PRAGMA foreign_keys = ON;

-- Failed experiments are evidence records rather than cultural objects. They
-- participate in the shared entity, media, relationship, revision, and search
-- systems without receiving an Archive dossier or catalogue identity.
CREATE TABLE IF NOT EXISTS archive_failed_experiments (
  entity_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  public_note TEXT NOT NULL DEFAULT '',
  expanded_context TEXT NOT NULL DEFAULT '',
  learning TEXT NOT NULL DEFAULT '',
  experiment_kind TEXT NOT NULL DEFAULT 'other'
    CHECK(experiment_kind IN ('concept','material-test','process-test','prototype','other')),
  result TEXT NOT NULL
    CHECK(result IN ('failed','abandoned','inconclusive','superseded')),
  afterlife TEXT NOT NULL DEFAULT 'none'
    CHECK(afterlife IN ('none','recovered','reused')),
  process_phase TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK(state IN ('draft','published','archived')),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(trim(slug)<>''),
  CHECK(trim(title)<>''),
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_failed_experiments_public_date
  ON archive_failed_experiments(state,date_precision,occurred_at DESC,created_at DESC,entity_id);
CREATE INDEX IF NOT EXISTS idx_archive_failed_experiments_facets
  ON archive_failed_experiments(state,experiment_kind,result,afterlife);
CREATE INDEX IF NOT EXISTS idx_archive_failed_experiments_phase
  ON archive_failed_experiments(state,process_phase);

-- The companion row must belong to the Failed Experiments entity family and
-- use one of the existing Archive medium identifiers as its primary medium.
DROP TRIGGER IF EXISTS archive_failed_experiment_entity_insert;
CREATE TRIGGER archive_failed_experiment_entity_insert
BEFORE INSERT ON archive_failed_experiments
WHEN NOT EXISTS(
  SELECT 1 FROM content_entities ce
  WHERE ce.id=NEW.entity_id
    AND ce.entity_type='archive_failed_experiment'
    AND ce.node_id IN ('art','merch','tattoos','film','music','writings','legend','other')
)
BEGIN
  SELECT RAISE(ABORT,'Failed experiment requires a matching entity and Archive medium');
END;

DROP TRIGGER IF EXISTS archive_failed_experiment_entity_update;
CREATE TRIGGER archive_failed_experiment_entity_update
BEFORE UPDATE OF entity_id ON archive_failed_experiments
WHEN NOT EXISTS(
  SELECT 1 FROM content_entities ce
  WHERE ce.id=NEW.entity_id
    AND ce.entity_type='archive_failed_experiment'
    AND ce.node_id IN ('art','merch','tattoos','film','music','writings','legend','other')
)
BEGIN
  SELECT RAISE(ABORT,'Failed experiment requires a matching entity and Archive medium');
END;

DROP TRIGGER IF EXISTS archive_failed_experiment_content_entity_update;
CREATE TRIGGER archive_failed_experiment_content_entity_update
BEFORE UPDATE OF entity_type,node_id ON content_entities
WHEN EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=NEW.id)
  AND (
    NEW.entity_type<>'archive_failed_experiment'
    OR NEW.node_id NOT IN ('art','merch','tattoos','film','music','writings','legend','other')
    OR NEW.node_id IS NULL
  )
BEGIN
  SELECT RAISE(ABORT,'Failed experiment entity type and Archive medium are fixed');
END;

-- A relationship may be decorated with one documented state. Exactly one
-- endpoint must be a Failed Experiment, and the other endpoint must own the
-- selected state through its Archive catalogue version.
CREATE TABLE IF NOT EXISTS archive_failed_experiment_state_links (
  relationship_id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(relationship_id) REFERENCES entity_relationships(id) ON DELETE CASCADE,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_failed_experiment_state_links_state
  ON archive_failed_experiment_state_links(state_id,relationship_id);

DROP TRIGGER IF EXISTS archive_failed_experiment_state_link_insert;
CREATE TRIGGER archive_failed_experiment_state_link_insert
BEFORE INSERT ON archive_failed_experiment_state_links
WHEN NOT EXISTS(
  SELECT 1
  FROM entity_relationships relationship
  JOIN archive_object_states object_state ON object_state.id=NEW.state_id
  JOIN archive_object_versions version ON version.id=object_state.version_id
  WHERE relationship.id=NEW.relationship_id
    AND (
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND version.entity_id=relationship.target_entity_id
      )
      OR
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND version.entity_id=relationship.source_entity_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'Failed experiment state must belong to the relationship work endpoint');
END;

DROP TRIGGER IF EXISTS archive_failed_experiment_state_link_update;
CREATE TRIGGER archive_failed_experiment_state_link_update
BEFORE UPDATE OF relationship_id,state_id ON archive_failed_experiment_state_links
WHEN NOT EXISTS(
  SELECT 1
  FROM entity_relationships relationship
  JOIN archive_object_states object_state ON object_state.id=NEW.state_id
  JOIN archive_object_versions version ON version.id=object_state.version_id
  WHERE relationship.id=NEW.relationship_id
    AND (
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND version.entity_id=relationship.target_entity_id
      )
      OR
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND version.entity_id=relationship.source_entity_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'Failed experiment state must belong to the relationship work endpoint');
END;

-- Keep an existing state decoration valid if a relationship is edited.
DROP TRIGGER IF EXISTS archive_failed_experiment_relationship_update;
CREATE TRIGGER archive_failed_experiment_relationship_update
BEFORE UPDATE OF source_entity_id,target_entity_id ON entity_relationships
WHEN EXISTS(
  SELECT 1
  FROM archive_failed_experiment_state_links state_link
  JOIN archive_object_states object_state ON object_state.id=state_link.state_id
  JOIN archive_object_versions version ON version.id=object_state.version_id
  WHERE state_link.relationship_id=NEW.id
    AND NOT (
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=NEW.source_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=NEW.target_entity_id)
        AND version.entity_id=NEW.target_entity_id
      )
      OR
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=NEW.target_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=NEW.source_entity_id)
        AND version.entity_id=NEW.source_entity_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'Relationship edit would detach its failed experiment state');
END;

-- Object states and versions are normally stable, but these guards prevent a
-- later ownership edit from silently invalidating a decorated relationship.
DROP TRIGGER IF EXISTS archive_failed_experiment_state_owner_update;
CREATE TRIGGER archive_failed_experiment_state_owner_update
BEFORE UPDATE OF version_id ON archive_object_states
WHEN EXISTS(
  SELECT 1
  FROM archive_failed_experiment_state_links state_link
  JOIN entity_relationships relationship ON relationship.id=state_link.relationship_id
  JOIN archive_object_versions version ON version.id=NEW.version_id
  WHERE state_link.state_id=NEW.id
    AND NOT (
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND version.entity_id=relationship.target_entity_id
      )
      OR
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND version.entity_id=relationship.source_entity_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'State edit would detach its failed experiment relationship');
END;

DROP TRIGGER IF EXISTS archive_failed_experiment_version_owner_update;
CREATE TRIGGER archive_failed_experiment_version_owner_update
BEFORE UPDATE OF entity_id ON archive_object_versions
WHEN EXISTS(
  SELECT 1
  FROM archive_object_states object_state
  JOIN archive_failed_experiment_state_links state_link ON state_link.state_id=object_state.id
  JOIN entity_relationships relationship ON relationship.id=state_link.relationship_id
  WHERE object_state.version_id=NEW.id
    AND NOT (
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND NEW.entity_id=relationship.target_entity_id
      )
      OR
      (
        EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.target_entity_id)
        AND NOT EXISTS(SELECT 1 FROM archive_failed_experiments experiment WHERE experiment.entity_id=relationship.source_entity_id)
        AND NEW.entity_id=relationship.source_entity_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'Version edit would detach its failed experiment relationship');
END;
