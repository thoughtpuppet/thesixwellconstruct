PRAGMA foreign_keys = ON;

-- 0173 is already occupied by calendar_public_access_default in this repository.
-- Keep the requested feature name while using the next available migration number.

CREATE TRIGGER IF NOT EXISTS archive_color_families_atomic_insert_guard
BEFORE INSERT ON archive_color_families
WHEN instr(NEW.name, '/') > 0
  OR instr(NEW.name, '&') > 0
  OR instr(NEW.name, '+') > 0
  OR instr(NEW.name, ',') > 0
  OR (' ' || lower(trim(NEW.name)) || ' ') LIKE '% and %'
BEGIN
  SELECT RAISE(ABORT, 'color family names must be singular and atomic');
END;

CREATE TRIGGER IF NOT EXISTS archive_color_families_atomic_update_guard
BEFORE UPDATE OF name ON archive_color_families
WHEN instr(NEW.name, '/') > 0
  OR instr(NEW.name, '&') > 0
  OR instr(NEW.name, '+') > 0
  OR instr(NEW.name, ',') > 0
  OR (' ' || lower(trim(NEW.name)) || ' ') LIKE '% and %'
BEGIN
  SELECT RAISE(ABORT, 'color family names must be singular and atomic');
END;

INSERT OR IGNORE INTO archive_color_families
  (id, slug, name, description, swatch_hex, publication_state, public_visible, sort_order, created_at, updated_at)
VALUES
  ('visual-color-family-black', 'black', 'Black', 'Broad visual color family.', '#000000', 'published', 1, 0, datetime('now'), datetime('now')),
  ('visual-color-family-gray', 'gray', 'Gray', 'Broad visual color family.', '#777777', 'published', 1, 10, datetime('now'), datetime('now')),
  ('visual-color-family-white', 'white', 'White', 'Broad visual color family.', '#F5F5F0', 'published', 1, 20, datetime('now'), datetime('now')),
  ('visual-color-family-cream', 'cream', 'Cream', 'Broad visual color family.', '#F2E4C4', 'published', 1, 30, datetime('now'), datetime('now')),
  ('visual-color-family-beige', 'beige', 'Beige', 'Broad visual color family.', '#D8C3A5', 'published', 1, 40, datetime('now'), datetime('now')),
  ('visual-color-family-tan', 'tan', 'Tan', 'Broad visual color family.', '#C69C6D', 'published', 1, 50, datetime('now'), datetime('now')),
  ('visual-color-family-brown', 'brown', 'Brown', 'Broad visual color family.', '#6B3F24', 'published', 1, 60, datetime('now'), datetime('now')),
  ('visual-color-family-red', 'red', 'Red', 'Broad visual color family.', '#C51F2A', 'published', 1, 70, datetime('now'), datetime('now')),
  ('visual-color-family-orange', 'orange', 'Orange', 'Broad visual color family.', '#E96B1B', 'published', 1, 80, datetime('now'), datetime('now')),
  ('visual-color-family-yellow', 'yellow', 'Yellow', 'Broad visual color family.', '#F2C94C', 'published', 1, 90, datetime('now'), datetime('now')),
  ('visual-color-family-gold', 'gold', 'Gold', 'Broad visual color family.', '#C89B2C', 'published', 1, 100, datetime('now'), datetime('now')),
  ('visual-color-family-ochre', 'ochre', 'Ochre', 'Broad visual color family.', '#B7791F', 'published', 1, 110, datetime('now'), datetime('now')),
  ('visual-color-family-green', 'green', 'Green', 'Broad visual color family.', '#2E7D32', 'published', 1, 120, datetime('now'), datetime('now')),
  ('visual-color-family-teal', 'teal', 'Teal', 'Broad visual color family.', '#147D78', 'published', 1, 130, datetime('now'), datetime('now')),
  ('visual-color-family-turquoise', 'turquoise', 'Turquoise', 'Broad visual color family.', '#20AFA8', 'published', 1, 140, datetime('now'), datetime('now')),
  ('visual-color-family-cyan', 'cyan', 'Cyan', 'Broad visual color family.', '#23B5E8', 'published', 1, 150, datetime('now'), datetime('now')),
  ('visual-color-family-blue', 'blue', 'Blue', 'Broad visual color family.', '#2463B5', 'published', 1, 160, datetime('now'), datetime('now')),
  ('visual-color-family-indigo', 'indigo', 'Indigo', 'Broad visual color family.', '#3F3C88', 'published', 1, 170, datetime('now'), datetime('now')),
  ('visual-color-family-purple', 'purple', 'Purple', 'Broad visual color family.', '#7846A8', 'published', 1, 180, datetime('now'), datetime('now')),
  ('visual-color-family-pink', 'pink', 'Pink', 'Broad visual color family.', '#D66A9A', 'published', 1, 190, datetime('now'), datetime('now')),
  ('visual-color-family-silver', 'silver', 'Silver', 'Broad visual color family.', '#B7BDC5', 'published', 1, 200, datetime('now'), datetime('now'));

-- Promote any pre-existing vocabulary row by slug, especially the existing
-- private Black record, without changing its identity or profile links.
UPDATE archive_color_families SET
  name = CASE slug
    WHEN 'black' THEN 'Black' WHEN 'gray' THEN 'Gray' WHEN 'white' THEN 'White'
    WHEN 'cream' THEN 'Cream' WHEN 'beige' THEN 'Beige' WHEN 'tan' THEN 'Tan'
    WHEN 'brown' THEN 'Brown' WHEN 'red' THEN 'Red' WHEN 'orange' THEN 'Orange'
    WHEN 'yellow' THEN 'Yellow' WHEN 'gold' THEN 'Gold' WHEN 'ochre' THEN 'Ochre'
    WHEN 'green' THEN 'Green' WHEN 'teal' THEN 'Teal' WHEN 'turquoise' THEN 'Turquoise'
    WHEN 'cyan' THEN 'Cyan' WHEN 'blue' THEN 'Blue' WHEN 'indigo' THEN 'Indigo'
    WHEN 'purple' THEN 'Purple' WHEN 'pink' THEN 'Pink' WHEN 'silver' THEN 'Silver'
  END,
  swatch_hex = CASE slug
    WHEN 'black' THEN '#000000' WHEN 'gray' THEN '#777777' WHEN 'white' THEN '#F5F5F0'
    WHEN 'cream' THEN '#F2E4C4' WHEN 'beige' THEN '#D8C3A5' WHEN 'tan' THEN '#C69C6D'
    WHEN 'brown' THEN '#6B3F24' WHEN 'red' THEN '#C51F2A' WHEN 'orange' THEN '#E96B1B'
    WHEN 'yellow' THEN '#F2C94C' WHEN 'gold' THEN '#C89B2C' WHEN 'ochre' THEN '#B7791F'
    WHEN 'green' THEN '#2E7D32' WHEN 'teal' THEN '#147D78' WHEN 'turquoise' THEN '#20AFA8'
    WHEN 'cyan' THEN '#23B5E8' WHEN 'blue' THEN '#2463B5' WHEN 'indigo' THEN '#3F3C88'
    WHEN 'purple' THEN '#7846A8' WHEN 'pink' THEN '#D66A9A' WHEN 'silver' THEN '#B7BDC5'
  END,
  publication_state = 'published',
  public_visible = 1,
  updated_at = datetime('now')
WHERE slug IN (
  'black','gray','white','cream','beige','tan','brown','red','orange','yellow','gold',
  'ochre','green','teal','turquoise','cyan','blue','indigo','purple','pink','silver'
);

CREATE TABLE IF NOT EXISTS archive_visual_color_runs (
  id TEXT PRIMARY KEY,
  work_type TEXT NOT NULL CHECK(work_type IN ('painting','tattoo')),
  work_id TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','ready','approved','rejected','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  raw_result_json TEXT NOT NULL DEFAULT '',
  normalized_suggestions_json TEXT NOT NULL DEFAULT '[]',
  descriptor_suggestions_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_type, work_id, source_fingerprint, model_name, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_archive_visual_color_runs_queue
  ON archive_visual_color_runs(status, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_archive_visual_color_runs_work
  ON archive_visual_color_runs(work_type, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS archive_visual_color_assignments (
  id TEXT PRIMARY KEY,
  work_type TEXT NOT NULL CHECK(work_type IN ('painting','tattoo')),
  work_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  strength TEXT NOT NULL CHECK(strength IN ('dominant','supporting','accent')),
  display_order INTEGER NOT NULL DEFAULT 0,
  source_run_id TEXT NOT NULL,
  reviewed_by TEXT NOT NULL DEFAULT 'studio',
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_type, work_id, family_id),
  FOREIGN KEY(family_id) REFERENCES archive_color_families(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_run_id) REFERENCES archive_visual_color_runs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_visual_color_assignments_family
  ON archive_visual_color_assignments(family_id, strength, display_order);

CREATE TABLE IF NOT EXISTS archive_work_descriptor_terms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  descriptor_kind TEXT NOT NULL CHECK(descriptor_kind IN ('medium','material','support')),
  description TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'published'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO archive_work_descriptor_terms
  (id, slug, name, descriptor_kind, description, publication_state, public_visible, sort_order, created_at, updated_at)
VALUES
  ('work-descriptor-medium-painting', 'painting', 'Painting', 'medium', 'General creative medium.', 'published', 1, 10, datetime('now'), datetime('now')),
  ('work-descriptor-medium-tattoo', 'tattoo', 'Tattoo', 'medium', 'General creative medium.', 'published', 1, 20, datetime('now'), datetime('now')),
  ('work-descriptor-material-acrylic-paint', 'acrylic-paint', 'Acrylic paint', 'material', 'Explicitly documented material.', 'published', 1, 30, datetime('now'), datetime('now')),
  ('work-descriptor-material-tattoo-ink', 'tattoo-ink', 'Tattoo ink', 'material', 'General tattoo material.', 'published', 1, 40, datetime('now'), datetime('now')),
  ('work-descriptor-support-wood-panel', 'wood-panel', 'Wood panel', 'support', 'Explicitly documented support.', 'published', 1, 50, datetime('now'), datetime('now')),
  ('work-descriptor-support-canvas', 'canvas', 'Canvas', 'support', 'Explicitly documented support.', 'published', 1, 60, datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS archive_work_descriptor_assignments (
  id TEXT PRIMARY KEY,
  work_type TEXT NOT NULL CHECK(work_type IN ('painting','tattoo')),
  work_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  reviewed_by TEXT NOT NULL DEFAULT 'studio',
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_type, work_id, term_id),
  FOREIGN KEY(term_id) REFERENCES archive_work_descriptor_terms(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_run_id) REFERENCES archive_visual_color_runs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_work_descriptor_assignments_term
  ON archive_work_descriptor_assignments(term_id, work_type);
