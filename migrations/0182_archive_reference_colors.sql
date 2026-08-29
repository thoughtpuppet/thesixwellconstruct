PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS archive_color_references (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  srgb_hex TEXT NOT NULL
    CHECK(
      length(srgb_hex) = 7
      AND substr(srgb_hex, 1, 1) = '#'
      AND substr(srgb_hex, 2) NOT GLOB '*[^0-9A-F]*'
    ),
  lab_l REAL NOT NULL,
  lab_a REAL NOT NULL,
  lab_b REAL NOT NULL,
  oklch_l REAL NOT NULL,
  oklch_c REAL NOT NULL,
  oklch_h REAL,
  family_id TEXT NOT NULL,
  sample_method TEXT NOT NULL CHECK(sample_method IN ('palette','point')),
  sample_x REAL,
  sample_y REAL,
  source_media_id TEXT,
  source_filename TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (sample_method = 'palette' AND sample_x IS NULL AND sample_y IS NULL)
    OR
    (sample_method = 'point' AND sample_x BETWEEN 0 AND 1 AND sample_y BETWEEN 0 AND 1)
  ),
  FOREIGN KEY(family_id) REFERENCES archive_color_families(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_color_references_state
  ON archive_color_references(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_color_references_family
  ON archive_color_references(family_id, state, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS archive_color_references_atomic_family_insert_guard
BEFORE INSERT ON archive_color_references
WHEN NOT EXISTS(
  SELECT 1 FROM archive_color_families
  WHERE id = NEW.family_id
    AND slug IN (
      'black','gray','white','cream','beige','tan','brown','red','orange','yellow',
      'gold','ochre','green','teal','turquoise','cyan','blue','indigo','purple','pink','silver'
    )
    AND publication_state <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'reference colors require one active atomic visual family');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_references_atomic_family_update_guard
BEFORE UPDATE OF family_id ON archive_color_references
WHEN NOT EXISTS(
  SELECT 1 FROM archive_color_families
  WHERE id = NEW.family_id
    AND slug IN (
      'black','gray','white','cream','beige','tan','brown','red','orange','yellow',
      'gold','ochre','green','teal','turquoise','cyan','blue','indigo','purple','pink','silver'
    )
    AND publication_state <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'reference colors require one active atomic visual family');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_references_private_source_insert_guard
BEFORE INSERT ON archive_color_references
WHEN NEW.source_media_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM media_assets
  WHERE id = NEW.source_media_id
    AND state = 'active'
    AND privacy = 'private'
    AND public_presentation = 'hidden'
)
BEGIN
  SELECT RAISE(ABORT, 'reference color sources must be active private hidden media');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_references_sample_immutable
BEFORE UPDATE OF srgb_hex, lab_l, lab_a, lab_b, oklch_l, oklch_c, oklch_h,
  sample_method, sample_x, sample_y, source_media_id, source_filename
ON archive_color_references
BEGIN
  SELECT RAISE(ABORT, 'sampled color values and source provenance are immutable');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_reference_media_privacy_guard
BEFORE UPDATE OF state, privacy, public_presentation ON media_assets
WHEN EXISTS(
  SELECT 1 FROM archive_color_references reference
  WHERE reference.source_media_id = OLD.id
)
AND (
  NEW.state <> 'active'
  OR NEW.privacy <> 'private'
  OR NEW.public_presentation <> 'hidden'
)
BEGIN
  SELECT RAISE(ABORT, 'reference color sources must remain active private hidden media');
END;
