PRAGMA foreign_keys = ON;

-- Origin Threads describe shared inception across canonical Construct entities,
-- whether or not an entity already has a public Archive dossier.
CREATE TABLE archive_origin_thread_entities (
  thread_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(thread_id, entity_id),
  FOREIGN KEY(thread_id) REFERENCES archive_origin_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

INSERT INTO archive_origin_thread_entities
  (thread_id,entity_id,is_primary,sort_order,created_at)
SELECT thread_id,dossier_entity_id,is_primary,sort_order,created_at
FROM archive_origin_thread_dossiers;

DROP TABLE archive_origin_thread_dossiers;

CREATE UNIQUE INDEX idx_archive_origin_thread_primary_entity
  ON archive_origin_thread_entities(entity_id) WHERE is_primary=1;
CREATE INDEX idx_archive_origin_thread_entities_thread
  ON archive_origin_thread_entities(thread_id, sort_order, entity_id);
