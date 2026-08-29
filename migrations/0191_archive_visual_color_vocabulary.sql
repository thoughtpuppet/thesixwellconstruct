PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS archive_visual_color_vocabulary (
  family_id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES archive_color_families(id) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO archive_visual_color_vocabulary(family_id, created_by, created_at)
SELECT id, 'migration', datetime('now')
FROM archive_color_families
WHERE slug IN (
  'black','gray','white','cream','beige','tan','brown','red','orange','yellow',
  'gold','ochre','green','teal','turquoise','cyan','blue','indigo','purple','pink','silver'
);

DROP TRIGGER IF EXISTS archive_color_references_atomic_family_insert_guard;
DROP TRIGGER IF EXISTS archive_color_references_atomic_family_update_guard;

CREATE TRIGGER archive_color_references_atomic_family_insert_guard
BEFORE INSERT ON archive_color_references
WHEN NOT EXISTS(
  SELECT 1 FROM archive_color_families family
  JOIN archive_visual_color_vocabulary vocabulary ON vocabulary.family_id = family.id
  WHERE family.id = NEW.family_id AND family.publication_state <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'reference colors require one active visual vocabulary family');
END;

CREATE TRIGGER archive_color_references_atomic_family_update_guard
BEFORE UPDATE OF family_id ON archive_color_references
WHEN NOT EXISTS(
  SELECT 1 FROM archive_color_families family
  JOIN archive_visual_color_vocabulary vocabulary ON vocabulary.family_id = family.id
  WHERE family.id = NEW.family_id AND family.publication_state <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'reference colors require one active visual vocabulary family');
END;
