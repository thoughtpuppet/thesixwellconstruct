-- Register every Special Project call as a first-class Construct entity.
-- A plain INSERT is deliberate: an existing entity with the same id but a
-- different type is a collision that must stop the migration for review.

INSERT INTO content_entities (
  id,entity_type,node_id,visibility,search_visibility,public_at,
  created_by,updated_by,created_at,updated_at
)
SELECT
  project.id,
  'special_project',
  'node-tattoos',
  'public',
  0,
  COALESCE(project.updated_at, datetime('now')),
  'migration-0109',
  'migration-0109',
  COALESCE(project.updated_at, datetime('now')),
  COALESCE(project.updated_at, datetime('now'))
FROM special_project_calls project;
