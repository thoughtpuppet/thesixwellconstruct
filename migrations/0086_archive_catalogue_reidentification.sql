PRAGMA foreign_keys = ON;

-- Catalogue identities can be deliberately re-identified without turning the
-- released number into a public alias. This private log is an operational
-- audit only: its old values carry no uniqueness constraint and reserve
-- nothing in archive_catalogue_entries.
CREATE TABLE IF NOT EXISTS archive_catalogue_identity_changes (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  previous_medium_id TEXT NOT NULL,
  previous_object_type_id TEXT NOT NULL,
  previous_catalogue_prefix TEXT NOT NULL,
  previous_catalogue_number INTEGER NOT NULL,
  previous_catalogue_id TEXT NOT NULL,
  next_medium_id TEXT NOT NULL,
  next_object_type_id TEXT NOT NULL,
  next_catalogue_prefix TEXT NOT NULL,
  next_catalogue_number INTEGER NOT NULL,
  next_catalogue_id TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'studio-reidentify',
  created_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_catalogue_identity_changes_entity
  ON archive_catalogue_identity_changes(entity_id,created_at,id);

DROP TRIGGER IF EXISTS archive_catalogue_identity_change_audit;
CREATE TRIGGER archive_catalogue_identity_change_audit
AFTER UPDATE OF medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id
ON archive_catalogue_entries
WHEN NEW.updated_by='studio-reidentify'
  AND (
    OLD.medium_id<>NEW.medium_id
    OR OLD.object_type_id<>NEW.object_type_id
    OR OLD.catalogue_prefix<>NEW.catalogue_prefix
    OR OLD.catalogue_number<>NEW.catalogue_number
    OR OLD.catalogue_id<>NEW.catalogue_id
  )
BEGIN
  INSERT INTO archive_catalogue_identity_changes(
    id,entity_id,
    previous_medium_id,previous_object_type_id,previous_catalogue_prefix,
    previous_catalogue_number,previous_catalogue_id,
    next_medium_id,next_object_type_id,next_catalogue_prefix,
    next_catalogue_number,next_catalogue_id,changed_by,created_at
  ) VALUES(
    'archive-catalogue-change-'||lower(hex(randomblob(16))),NEW.entity_id,
    OLD.medium_id,OLD.object_type_id,OLD.catalogue_prefix,
    OLD.catalogue_number,OLD.catalogue_id,
    NEW.medium_id,NEW.object_type_id,NEW.catalogue_prefix,
    NEW.catalogue_number,NEW.catalogue_id,NEW.updated_by,datetime('now')
  );
END;

-- Migrations already deployed with archive_dossier_structure_insert use
-- MAX + 1. Compact every newly inserted identity into the earliest available
-- positive gap so trigger-created dossiers follow the same allocation policy
-- as Worker-created records without rewriting an applied migration.
DROP TRIGGER IF EXISTS archive_catalogue_lowest_open_insert;
CREATE TRIGGER archive_catalogue_lowest_open_insert
AFTER INSERT ON archive_catalogue_entries
WHEN EXISTS(
  SELECT 1
  FROM (
    SELECT 1 candidate
    UNION
    SELECT catalogue_number+1
    FROM archive_catalogue_entries
    WHERE catalogue_prefix=NEW.catalogue_prefix AND entity_id<>NEW.entity_id
  ) candidates
  WHERE candidate<NEW.catalogue_number
    AND NOT EXISTS(
      SELECT 1 FROM archive_catalogue_entries occupied
      WHERE occupied.catalogue_prefix=NEW.catalogue_prefix
        AND occupied.catalogue_number=candidates.candidate
        AND occupied.entity_id<>NEW.entity_id
    )
)
BEGIN
  UPDATE archive_catalogue_entries
  SET catalogue_number=(
      SELECT MIN(candidate)
      FROM (
        SELECT 1 candidate
        UNION
        SELECT catalogue_number+1
        FROM archive_catalogue_entries
        WHERE catalogue_prefix=NEW.catalogue_prefix AND entity_id<>NEW.entity_id
      ) candidates
      WHERE NOT EXISTS(
        SELECT 1 FROM archive_catalogue_entries occupied
        WHERE occupied.catalogue_prefix=NEW.catalogue_prefix
          AND occupied.catalogue_number=candidates.candidate
          AND occupied.entity_id<>NEW.entity_id
      )
    ),
    catalogue_id=NEW.catalogue_prefix||'-'||printf('%03d',(
      SELECT MIN(candidate)
      FROM (
        SELECT 1 candidate
        UNION
        SELECT catalogue_number+1
        FROM archive_catalogue_entries
        WHERE catalogue_prefix=NEW.catalogue_prefix AND entity_id<>NEW.entity_id
      ) candidates
      WHERE NOT EXISTS(
        SELECT 1 FROM archive_catalogue_entries occupied
        WHERE occupied.catalogue_prefix=NEW.catalogue_prefix
          AND occupied.catalogue_number=candidates.candidate
          AND occupied.entity_id<>NEW.entity_id
      )
    )),
    updated_at=datetime('now')
  WHERE entity_id=NEW.entity_id;
END;
