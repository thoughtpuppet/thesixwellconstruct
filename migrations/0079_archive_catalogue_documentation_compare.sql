PRAGMA foreign_keys = ON;

-- Keep permanent catalogue identities stable while pointing the public label
-- at one real documented state. The legacy current_version/current_state
-- columns remain synchronized by the Worker for backwards compatibility.
ALTER TABLE archive_catalogue_entries ADD COLUMN current_state_id TEXT;

-- Creative evolution and website publication are separate systems. Existing
-- version/state rows were already public before this migration, so the
-- backfill preserves their current behavior. New rows default to private
-- drafts and require an explicit Studio publication decision.
ALTER TABLE archive_object_versions ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft'
  CHECK(publication_state IN ('draft','published','archived'));
ALTER TABLE archive_object_versions ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 0
  CHECK(public_visible IN (0,1));

ALTER TABLE archive_object_states ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft'
  CHECK(publication_state IN ('draft','published','archived'));
ALTER TABLE archive_object_states ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 0
  CHECK(public_visible IN (0,1));
ALTER TABLE archive_object_states ADD COLUMN lead_material_id TEXT;

UPDATE archive_object_versions
SET publication_state='published', public_visible=1;

UPDATE archive_object_states
SET publication_state='published', public_visible=1;

UPDATE archive_catalogue_entries
SET current_state_id=(
  SELECT aos.id
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  WHERE aov.entity_id=archive_catalogue_entries.entity_id
    AND aov.version_number=archive_catalogue_entries.current_version
    AND upper(aos.state_roman)=upper(archive_catalogue_entries.current_state)
    AND trim(COALESCE(aos.variant_label,''))=trim(COALESCE(archive_catalogue_entries.variant_label,''))
  ORDER BY aos.sort_order,aos.state_order,aos.id
  LIMIT 1
);

UPDATE archive_catalogue_entries
SET current_state_id=(
  SELECT aos.id
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  WHERE aov.entity_id=archive_catalogue_entries.entity_id
  ORDER BY aov.sort_order,aov.version_number,aos.sort_order,aos.state_order,aos.id
  LIMIT 1
)
WHERE current_state_id IS NULL;

UPDATE archive_object_states
SET lead_material_id=(
  SELECT am.id
  FROM archive_materials am
  JOIN media_assets m ON m.id=am.media_id
  WHERE am.state_id=archive_object_states.id
    AND am.state='published' AND am.visibility='public'
    AND m.state='active' AND m.privacy='public'
    AND m.consent_status IN ('not-required','granted')
    AND m.public_presentation='inline'
    AND (m.mime_type LIKE 'image/%' OR m.mime_type LIKE 'video/%')
  ORDER BY CASE am.material_type
    WHEN 'final-image' THEN 0
    WHEN 'process-photo' THEN 1
    WHEN 'sketch' THEN 2
    WHEN 'video' THEN 3
    ELSE 4 END,
    am.sort_order,am.created_at,am.id
  LIMIT 1
)
WHERE lead_material_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_archive_versions_public
  ON archive_object_versions(entity_id,publication_state,public_visible,sort_order,version_number);
CREATE INDEX IF NOT EXISTS idx_archive_states_public
  ON archive_object_states(version_id,publication_state,public_visible,sort_order,state_order);
CREATE INDEX IF NOT EXISTS idx_archive_states_lead
  ON archive_object_states(lead_material_id);
CREATE INDEX IF NOT EXISTS idx_archive_catalogue_current_state
  ON archive_catalogue_entries(current_state_id);

-- Adaptive documentation uses a controlled field vocabulary but keeps each
-- entry repeatable, orderable, and independently public or internal.
CREATE TABLE IF NOT EXISTS archive_catalogue_documentation (
  id TEXT PRIMARY KEY,
  dossier_entity_id TEXT NOT NULL,
  field_key TEXT NOT NULL CHECK(field_key IN (
    'alternate-title',
    'object-description',
    'technique',
    'support',
    'dimensions',
    'inscription',
    'edition',
    'edition-information',
    'background',
    'artist-remark',
    'installation-remark',
    'curatorial-remark',
    'other-remark',
    'bibliography',
    'former-catalogue-number',
    'institutional-identifier',
    'credit-line',
    'other-collection',
    'rights-permissions'
  )),
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  citation TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(trim(value) <> ''),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_catalogue_documentation_record
  ON archive_catalogue_documentation(dossier_entity_id,field_key,public_visible,sort_order,created_at);

-- Public documentation participates in the existing fragment search system.
CREATE TRIGGER IF NOT EXISTS archive_catalogue_documentation_fragment_insert
AFTER INSERT ON archive_catalogue_documentation BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES
    ('archive-fragment-documentation-'||NEW.id,NEW.dossier_entity_id,'catalogue-documentation',NEW.id,
      COALESCE(NULLIF(NEW.label,''),replace(NEW.field_key,'-',' ')),
      trim(NEW.value||' '||NEW.citation),
      'documentation-'||NEW.id,NEW.public_visible,datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS archive_catalogue_documentation_fragment_update
AFTER UPDATE ON archive_catalogue_documentation BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.dossier_entity_id
      AND fragment_type='catalogue-documentation' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES
    ('archive-fragment-documentation-'||NEW.id,NEW.dossier_entity_id,'catalogue-documentation',NEW.id,
      COALESCE(NULLIF(NEW.label,''),replace(NEW.field_key,'-',' ')),
      trim(NEW.value||' '||NEW.citation),
      'documentation-'||NEW.id,NEW.public_visible,datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS archive_catalogue_documentation_fragment_delete
AFTER DELETE ON archive_catalogue_documentation BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.dossier_entity_id
      AND fragment_type='catalogue-documentation' AND source_id=OLD.id;
END;
