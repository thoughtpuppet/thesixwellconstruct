-- Completion invariants for Archive colors, materials, recipes, and tattoo sessions.
-- Session references are Studio-only. Public payloads continue to identify only
-- the Archive creative state.

CREATE TABLE IF NOT EXISTS archive_tattoo_session_refs (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  session_order INTEGER NOT NULL DEFAULT 1 CHECK(session_order > 0),
  studio_label TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(state_id,appointment_id),
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE,
  FOREIGN KEY(appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_tattoo_session_refs_state
  ON archive_tattoo_session_refs(state_id,session_order,occurred_at);

ALTER TABLE archive_color_usages ADD COLUMN tattoo_session_ref_id TEXT
  REFERENCES archive_tattoo_session_refs(id) ON DELETE SET NULL;

ALTER TABLE archive_general_material_usages ADD COLUMN tattoo_session_ref_id TEXT
  REFERENCES archive_tattoo_session_refs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_archive_color_usages_session
  ON archive_color_usages(tattoo_session_ref_id,state_id);

CREATE INDEX IF NOT EXISTS idx_archive_general_material_usages_session
  ON archive_general_material_usages(tattoo_session_ref_id,state_id);

CREATE TRIGGER IF NOT EXISTS archive_color_usage_session_state_insert
BEFORE INSERT ON archive_color_usages
WHEN NEW.tattoo_session_ref_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_tattoo_session_refs session_ref
  WHERE session_ref.id=NEW.tattoo_session_ref_id
    AND session_ref.state_id=NEW.state_id
)
BEGIN
  SELECT RAISE(ABORT,'The tattoo session must belong to the same Archive creative state.');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_usage_session_state_update
BEFORE UPDATE OF state_id,tattoo_session_ref_id ON archive_color_usages
WHEN NEW.tattoo_session_ref_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_tattoo_session_refs session_ref
  WHERE session_ref.id=NEW.tattoo_session_ref_id
    AND session_ref.state_id=NEW.state_id
)
BEGIN
  SELECT RAISE(ABORT,'The tattoo session must belong to the same Archive creative state.');
END;

CREATE TRIGGER IF NOT EXISTS archive_general_usage_session_state_insert
BEFORE INSERT ON archive_general_material_usages
WHEN NEW.tattoo_session_ref_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_tattoo_session_refs session_ref
  WHERE session_ref.id=NEW.tattoo_session_ref_id
    AND session_ref.state_id=NEW.state_id
)
BEGIN
  SELECT RAISE(ABORT,'The tattoo session must belong to the same Archive creative state.');
END;

CREATE TRIGGER IF NOT EXISTS archive_general_usage_session_state_update
BEFORE UPDATE OF state_id,tattoo_session_ref_id ON archive_general_material_usages
WHEN NEW.tattoo_session_ref_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_tattoo_session_refs session_ref
  WHERE session_ref.id=NEW.tattoo_session_ref_id
    AND session_ref.state_id=NEW.state_id
)
BEGIN
  SELECT RAISE(ABORT,'The tattoo session must belong to the same Archive creative state.');
END;

-- Color-bearing commercial formulations require a sourced profile before
-- publication. Draft formulations remain intentionally incomplete.
CREATE TRIGGER IF NOT EXISTS archive_formulation_profile_publish_insert
BEFORE INSERT ON archive_material_formulations
WHEN NEW.publication_state='published'
  AND EXISTS(
    SELECT 1 FROM archive_material_definitions material
    WHERE material.id=NEW.material_id
      AND material.material_kind IN ('art-paint','tattoo-ink')
  )
  AND NOT EXISTS(
    SELECT 1 FROM archive_color_profiles profile
    WHERE profile.source_type='material-formulation'
      AND profile.source_id=NEW.id
  )
BEGIN
  SELECT RAISE(ABORT,'A color-bearing formulation needs a sourced color profile before publication.');
END;

CREATE TRIGGER IF NOT EXISTS archive_formulation_profile_publish_update
BEFORE UPDATE OF publication_state ON archive_material_formulations
WHEN NEW.publication_state='published'
  AND EXISTS(
    SELECT 1 FROM archive_material_definitions material
    WHERE material.id=NEW.material_id
      AND material.material_kind IN ('art-paint','tattoo-ink')
  )
  AND NOT EXISTS(
    SELECT 1 FROM archive_color_profiles profile
    WHERE profile.source_type='material-formulation'
      AND profile.source_id=NEW.id
  )
BEGIN
  SELECT RAISE(ABORT,'A color-bearing formulation needs a sourced color profile before publication.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_profile_publish_insert
BEFORE INSERT ON archive_color_recipe_versions
WHEN NEW.publication_state='published'
  AND NOT EXISTS(
    SELECT 1 FROM archive_color_profiles profile
    WHERE profile.source_type='recipe-version'
      AND profile.source_id=NEW.id
  )
BEGIN
  SELECT RAISE(ABORT,'A recipe version needs a sourced color profile before publication.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_profile_publish_update
BEFORE UPDATE OF publication_state ON archive_color_recipe_versions
WHEN NEW.publication_state='published'
  AND NOT EXISTS(
    SELECT 1 FROM archive_color_profiles profile
    WHERE profile.source_type='recipe-version'
      AND profile.source_id=NEW.id
  )
BEGIN
  SELECT RAISE(ABORT,'A recipe version needs a sourced color profile before publication.');
END;

CREATE TRIGGER IF NOT EXISTS archive_profile_source_insert
BEFORE INSERT ON archive_color_profiles
WHEN (
  NEW.source_type='material-formulation'
  AND NOT EXISTS(SELECT 1 FROM archive_material_formulations WHERE id=NEW.source_id)
) OR (
  NEW.source_type='recipe-version'
  AND NOT EXISTS(SELECT 1 FROM archive_color_recipe_versions WHERE id=NEW.source_id)
)
BEGIN
  SELECT RAISE(ABORT,'A color profile must reference an existing formulation or recipe version.');
END;

CREATE TRIGGER IF NOT EXISTS archive_profile_source_update
BEFORE UPDATE OF source_type,source_id ON archive_color_profiles
WHEN (
  NEW.source_type='material-formulation'
  AND NOT EXISTS(SELECT 1 FROM archive_material_formulations WHERE id=NEW.source_id)
) OR (
  NEW.source_type='recipe-version'
  AND NOT EXISTS(SELECT 1 FROM archive_color_recipe_versions WHERE id=NEW.source_id)
)
BEGIN
  SELECT RAISE(ABORT,'A color profile must reference an existing formulation or recipe version.');
END;

CREATE TRIGGER IF NOT EXISTS archive_published_profile_update
BEFORE UPDATE ON archive_color_profiles
WHEN (
  OLD.source_type='material-formulation'
  AND EXISTS(
    SELECT 1 FROM archive_material_formulations
    WHERE id=OLD.source_id AND publication_state='published'
  )
) OR (
  OLD.source_type='recipe-version'
  AND EXISTS(
    SELECT 1 FROM archive_color_recipe_versions
    WHERE id=OLD.source_id AND publication_state='published'
  )
)
BEGIN
  SELECT RAISE(ABORT,'Published color-bearing records have immutable sourced color profiles.');
END;

CREATE TRIGGER IF NOT EXISTS archive_published_profile_delete
BEFORE DELETE ON archive_color_profiles
WHEN (
  OLD.source_type='material-formulation'
  AND EXISTS(
    SELECT 1 FROM archive_material_formulations
    WHERE id=OLD.source_id AND publication_state='published'
  )
) OR (
  OLD.source_type='recipe-version'
  AND EXISTS(
    SELECT 1 FROM archive_color_recipe_versions
    WHERE id=OLD.source_id AND publication_state='published'
  )
)
BEGIN
  SELECT RAISE(ABORT,'Published color-bearing records must retain their sourced color profile.');
END;
