-- Archive colors, materials, recipes, state usages, and reviewed placement maps.
-- This is a provenance library, not an inventory or purchasing system.

CREATE TABLE IF NOT EXISTS tattoo_designs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  design_type TEXT NOT NULL DEFAULT 'commissioned'
    CHECK(design_type IN ('commissioned','original','collaborative','stencil')),
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK(state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tattoo_designs_state_order
  ON tattoo_designs(state,sort_order,title);

INSERT OR IGNORE INTO relationship_types
  (id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('rel-realized-as','realized-as','Realized as','Realization of',
   'Connects a commissioned Tattoo Design or Flash design to an executed Portfolio tattoo.',
   1,24,datetime('now'),datetime('now'));

CREATE TRIGGER IF NOT EXISTS tattoo_realized_as_insert
BEFORE INSERT ON entity_relationships
WHEN NEW.relationship_type_id='rel-realized-as'
 AND (
   NOT EXISTS (
     SELECT 1 FROM content_entities
     WHERE id=NEW.source_entity_id AND entity_type IN ('tattoo_design','flash_item')
   )
   OR NOT EXISTS (
     SELECT 1 FROM content_entities
     WHERE id=NEW.target_entity_id AND entity_type='portfolio_item'
   )
 )
BEGIN
  SELECT RAISE(ABORT,'Realized as must connect a Tattoo Design or Flash design to a Portfolio execution.');
END;

CREATE TRIGGER IF NOT EXISTS tattoo_realized_as_update
BEFORE UPDATE OF source_entity_id,target_entity_id,relationship_type_id ON entity_relationships
WHEN NEW.relationship_type_id='rel-realized-as'
 AND (
   NOT EXISTS (
     SELECT 1 FROM content_entities
     WHERE id=NEW.source_entity_id AND entity_type IN ('tattoo_design','flash_item')
   )
   OR NOT EXISTS (
     SELECT 1 FROM content_entities
     WHERE id=NEW.target_entity_id AND entity_type='portfolio_item'
   )
 )
BEGIN
  SELECT RAISE(ABORT,'Realized as must connect a Tattoo Design or Flash design to a Portfolio execution.');
END;

CREATE TABLE IF NOT EXISTS archive_material_definitions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  material_kind TEXT NOT NULL CHECK(material_kind IN (
    'raw-pigment','art-paint','tattoo-ink','medium-diluent','additive',
    'finish-topcoat','support-substrate','tool','equipment',
    'needle-cartridge','disposable','aftercare'
  )),
  manufacturer TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  product_line TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  color_name TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  medium_scope TEXT NOT NULL DEFAULT 'shared'
    CHECK(medium_scope IN ('art','tattoo','shared')),
  pigment_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_material_duplicate_identity
  ON archive_material_definitions(
    lower(COALESCE(brand,'')),lower(COALESCE(product_line,'')),
    lower(COALESCE(product_name,'')),lower(COALESCE(color_name,'')),
    lower(COALESCE(product_code,'')),material_kind
  )
  WHERE publication_state<>'archived'
    AND material_kind IN ('art-paint','tattoo-ink')
    AND (brand<>'' OR product_line<>'' OR product_name<>'' OR color_name<>'' OR product_code<>'');
CREATE INDEX IF NOT EXISTS idx_archive_material_public
  ON archive_material_definitions(publication_state,public_visible,material_kind,name);
CREATE INDEX IF NOT EXISTS idx_archive_material_pigment_code
  ON archive_material_definitions(pigment_code,material_kind);

CREATE TABLE IF NOT EXISTS archive_material_formulations (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  version_label TEXT NOT NULL DEFAULT '',
  normalized_finish TEXT NOT NULL DEFAULT 'unspecified'
    CHECK(normalized_finish IN ('matte','satin','gloss','unspecified')),
  finish_label TEXT NOT NULL DEFAULT '',
  opacity TEXT NOT NULL DEFAULT 'unspecified'
    CHECK(opacity IN ('opaque','semi-opaque','transparent','unspecified')),
  optical_effects_json TEXT NOT NULL DEFAULT '[]',
  manufacturer_wording TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(material_id,version_number),
  FOREIGN KEY(material_id) REFERENCES archive_material_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_material_formulations_public
  ON archive_material_formulations(material_id,publication_state,public_visible,version_number);

CREATE TRIGGER IF NOT EXISTS archive_material_formulation_published_immutable_update
BEFORE UPDATE ON archive_material_formulations
WHEN OLD.publication_state='published'
BEGIN
  SELECT RAISE(ABORT,'Published material formulations are immutable; create a new version.');
END;

CREATE TRIGGER IF NOT EXISTS archive_material_formulation_published_immutable_delete
BEFORE DELETE ON archive_material_formulations
WHEN OLD.publication_state='published'
BEGIN
  SELECT RAISE(ABORT,'Published material formulations are immutable; archive the definition instead.');
END;

CREATE TABLE IF NOT EXISTS archive_material_declared_pigments (
  id TEXT PRIMARY KEY,
  formulation_id TEXT NOT NULL,
  pigment_material_id TEXT,
  normalized_pigment_code TEXT NOT NULL DEFAULT '',
  bottle_wording TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'bottle-label'
    CHECK(source_type IN ('bottle-label','manufacturer-site','safety-data-sheet','technical-sheet','other')),
  source_media_id TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  observed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(formulation_id) REFERENCES archive_material_formulations(id) ON DELETE CASCADE,
  FOREIGN KEY(pigment_material_id) REFERENCES archive_material_definitions(id) ON DELETE SET NULL,
  FOREIGN KEY(source_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_declared_pigments_code
  ON archive_material_declared_pigments(normalized_pigment_code,formulation_id);

CREATE TRIGGER IF NOT EXISTS archive_declared_pigment_frozen_insert
BEFORE INSERT ON archive_material_declared_pigments
WHEN EXISTS(SELECT 1 FROM archive_material_formulations WHERE id=NEW.formulation_id AND publication_state='published')
BEGIN
  SELECT RAISE(ABORT,'Published formulation pigment declarations are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS archive_declared_pigment_frozen_update
BEFORE UPDATE ON archive_material_declared_pigments
WHEN EXISTS(SELECT 1 FROM archive_material_formulations WHERE id=OLD.formulation_id AND publication_state='published')
BEGIN
  SELECT RAISE(ABORT,'Published formulation pigment declarations are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS archive_declared_pigment_frozen_delete
BEFORE DELETE ON archive_material_declared_pigments
WHEN EXISTS(SELECT 1 FROM archive_material_formulations WHERE id=OLD.formulation_id AND publication_state='published')
BEGIN
  SELECT RAISE(ABORT,'Published formulation pigment declarations are immutable.');
END;

CREATE TABLE IF NOT EXISTS archive_material_batches (
  id TEXT PRIMARY KEY,
  formulation_id TEXT NOT NULL,
  lot_number TEXT NOT NULL DEFAULT '',
  expiration_date TEXT,
  opened_date TEXT,
  private_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(formulation_id) REFERENCES archive_material_formulations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_equipment_assets (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  serial_number TEXT NOT NULL DEFAULT '',
  studio_nickname TEXT NOT NULL DEFAULT '',
  acquired_at TEXT,
  retired_at TEXT,
  private_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(material_id) REFERENCES archive_material_definitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_color_recipes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  medium_scope TEXT NOT NULL DEFAULT 'shared'
    CHECK(medium_scope IN ('art','tattoo','shared')),
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_color_recipes_public
  ON archive_color_recipes(publication_state,public_visible,name);

CREATE TABLE IF NOT EXISTS archive_color_recipe_versions (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  version_label TEXT NOT NULL DEFAULT '',
  resulting_finish TEXT NOT NULL DEFAULT 'unspecified'
    CHECK(resulting_finish IN ('matte','satin','gloss','unspecified')),
  finish_label TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(recipe_id,version_number),
  FOREIGN KEY(recipe_id) REFERENCES archive_color_recipes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_recipe_versions_public
  ON archive_color_recipe_versions(recipe_id,publication_state,public_visible,version_number);

CREATE TRIGGER IF NOT EXISTS archive_recipe_version_published_immutable_update
BEFORE UPDATE ON archive_color_recipe_versions
WHEN OLD.publication_state='published'
BEGIN
  SELECT RAISE(ABORT,'Published recipe versions are immutable; create the next version.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_version_published_immutable_delete
BEFORE DELETE ON archive_color_recipe_versions
WHEN OLD.publication_state='published'
BEGIN
  SELECT RAISE(ABORT,'Published recipe versions are immutable; archive the recipe instead.');
END;

CREATE TABLE IF NOT EXISTS archive_color_recipe_components (
  id TEXT PRIMARY KEY,
  recipe_version_id TEXT NOT NULL,
  formulation_id TEXT,
  raw_pigment_material_id TEXT,
  nested_recipe_version_id TEXT,
  quantity_value REAL,
  quantity_unit TEXT NOT NULL DEFAULT 'parts'
    CHECK(quantity_unit IN ('parts','drops','grams','milliliters','percent','freeform')),
  approximate INTEGER NOT NULL DEFAULT 0 CHECK(approximate IN (0,1)),
  quantity_note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (formulation_id IS NOT NULL) +
    (raw_pigment_material_id IS NOT NULL) +
    (nested_recipe_version_id IS NOT NULL) = 1
  ),
  CHECK(quantity_value IS NULL OR quantity_value >= 0),
  FOREIGN KEY(recipe_version_id) REFERENCES archive_color_recipe_versions(id) ON DELETE CASCADE,
  FOREIGN KEY(formulation_id) REFERENCES archive_material_formulations(id) ON DELETE RESTRICT,
  FOREIGN KEY(raw_pigment_material_id) REFERENCES archive_material_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY(nested_recipe_version_id) REFERENCES archive_color_recipe_versions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_recipe_components_version
  ON archive_color_recipe_components(recipe_version_id,sort_order);

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_frozen_insert
BEFORE INSERT ON archive_color_recipe_components
WHEN EXISTS(
  SELECT 1 FROM archive_color_recipe_versions
  WHERE id=NEW.recipe_version_id AND publication_state='published'
)
BEGIN
  SELECT RAISE(ABORT,'Published recipe components are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_frozen_update
BEFORE UPDATE ON archive_color_recipe_components
WHEN EXISTS(
  SELECT 1 FROM archive_color_recipe_versions
  WHERE id=OLD.recipe_version_id AND publication_state='published'
)
BEGIN
  SELECT RAISE(ABORT,'Published recipe components are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_frozen_delete
BEFORE DELETE ON archive_color_recipe_components
WHEN EXISTS(
  SELECT 1 FROM archive_color_recipe_versions
  WHERE id=OLD.recipe_version_id AND publication_state='published'
)
BEGIN
  SELECT RAISE(ABORT,'Published recipe components are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_direct_cycle
BEFORE INSERT ON archive_color_recipe_components
WHEN NEW.nested_recipe_version_id=NEW.recipe_version_id
BEGIN
  SELECT RAISE(ABORT,'A recipe version cannot contain itself.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_raw_pigment_only
BEFORE INSERT ON archive_color_recipe_components
WHEN NEW.raw_pigment_material_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_material_definitions
  WHERE id=NEW.raw_pigment_material_id AND material_kind='raw-pigment'
)
BEGIN
  SELECT RAISE(ABORT,'Only raw pigments may use the raw pigment component field.');
END;

CREATE TRIGGER IF NOT EXISTS archive_recipe_component_formulation_kind
BEFORE INSERT ON archive_color_recipe_components
WHEN NEW.formulation_id IS NOT NULL AND EXISTS(
  SELECT 1
  FROM archive_material_formulations f
  JOIN archive_material_definitions m ON m.id=f.material_id
  WHERE f.id=NEW.formulation_id
    AND m.material_kind NOT IN ('art-paint','tattoo-ink','medium-diluent','additive','finish-topcoat')
)
BEGIN
  SELECT RAISE(ABORT,'Tools, equipment, supports, needles, disposables, and aftercare cannot be recipe ingredients.');
END;

CREATE TABLE IF NOT EXISTS archive_color_profiles (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('material-formulation','recipe-version')),
  source_id TEXT NOT NULL,
  srgb_hex TEXT NOT NULL,
  lab_l REAL NOT NULL,
  lab_a REAL NOT NULL,
  lab_b REAL NOT NULL,
  oklch_l REAL NOT NULL,
  oklch_c REAL NOT NULL,
  oklch_h REAL,
  reference_method TEXT NOT NULL
    CHECK(reference_method IN ('manual-digital','measured-physical','reviewed-image')),
  source_media_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_type,source_id),
  FOREIGN KEY(source_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_color_profiles_lab
  ON archive_color_profiles(lab_l,lab_a,lab_b);

CREATE TABLE IF NOT EXISTS archive_color_families (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  swatch_hex TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_color_profile_families (
  profile_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'studio',
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,family_id),
  FOREIGN KEY(profile_id) REFERENCES archive_color_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(family_id) REFERENCES archive_color_families(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_color_neighbors (
  profile_id TEXT NOT NULL,
  neighbor_profile_id TEXT NOT NULL,
  delta_e REAL NOT NULL CHECK(delta_e >= 0),
  computed_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,neighbor_profile_id),
  CHECK(profile_id<>neighbor_profile_id),
  FOREIGN KEY(profile_id) REFERENCES archive_color_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(neighbor_profile_id) REFERENCES archive_color_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_color_neighbors_distance
  ON archive_color_neighbors(profile_id,delta_e);

CREATE TABLE IF NOT EXISTS archive_color_usages (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  formulation_id TEXT,
  recipe_version_id TEXT,
  usage_status TEXT NOT NULL DEFAULT 'applied'
    CHECK(usage_status IN ('intended','applied','observed','retouched')),
  technique TEXT NOT NULL DEFAULT '',
  layer_order INTEGER NOT NULL DEFAULT 0,
  quantity_note TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  public_label TEXT NOT NULL DEFAULT '',
  public_swatch_hex TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((formulation_id IS NOT NULL) + (recipe_version_id IS NOT NULL) = 1),
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE,
  FOREIGN KEY(formulation_id) REFERENCES archive_material_formulations(id) ON DELETE RESTRICT,
  FOREIGN KEY(recipe_version_id) REFERENCES archive_color_recipe_versions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_color_usages_state
  ON archive_color_usages(state_id,publication_state,public_visible,layer_order);
CREATE INDEX IF NOT EXISTS idx_archive_color_usages_recipe
  ON archive_color_usages(recipe_version_id,state_id);
CREATE INDEX IF NOT EXISTS idx_archive_color_usages_formulation
  ON archive_color_usages(formulation_id,state_id);

CREATE TABLE IF NOT EXISTS archive_general_material_usages (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  formulation_id TEXT,
  batch_id TEXT,
  equipment_asset_id TEXT,
  usage_role TEXT NOT NULL DEFAULT '',
  technique TEXT NOT NULL DEFAULT '',
  quantity_note TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE,
  FOREIGN KEY(material_id) REFERENCES archive_material_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY(formulation_id) REFERENCES archive_material_formulations(id) ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES archive_material_batches(id) ON DELETE SET NULL,
  FOREIGN KEY(equipment_asset_id) REFERENCES archive_equipment_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_general_material_usages_state
  ON archive_general_material_usages(state_id,publication_state,public_visible);

CREATE TRIGGER IF NOT EXISTS archive_color_usage_fragment_insert
AFTER INSERT ON archive_color_usages BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-palette-color-'||NEW.id,aov.entity_id,'palette-color',NEW.id,
    COALESCE(
      NULLIF(NEW.public_label,''),
      (
        SELECT r.name FROM archive_color_recipe_versions rv
        JOIN archive_color_recipes r ON r.id=rv.recipe_id
        WHERE rv.id=NEW.recipe_version_id
          AND rv.publication_state='published' AND rv.public_visible=1
          AND r.publication_state='published' AND r.public_visible=1
      ),
      (
        SELECT md.name FROM archive_material_formulations mf
        JOIN archive_material_definitions md ON md.id=mf.material_id
        WHERE mf.id=NEW.formulation_id
          AND mf.publication_state='published' AND mf.public_visible=1
          AND md.publication_state='published' AND md.public_visible=1
      ),
      'Documented color'
    ),
    trim(NEW.public_label||' '||NEW.technique||' '||NEW.quantity_note||' '||NEW.notes),
    'palette-materials',1,datetime('now')
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE aos.id=NEW.state_id
    AND NEW.publication_state='published' AND NEW.public_visible=1
    AND aos.publication_state='published' AND aos.public_visible=1
    AND aov.publication_state='published' AND aov.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_color_usage_fragment_update
AFTER UPDATE ON archive_color_usages BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='palette-color' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-palette-color-'||NEW.id,aov.entity_id,'palette-color',NEW.id,
    COALESCE(
      NULLIF(NEW.public_label,''),
      (
        SELECT r.name FROM archive_color_recipe_versions rv
        JOIN archive_color_recipes r ON r.id=rv.recipe_id
        WHERE rv.id=NEW.recipe_version_id
          AND rv.publication_state='published' AND rv.public_visible=1
          AND r.publication_state='published' AND r.public_visible=1
      ),
      (
        SELECT md.name FROM archive_material_formulations mf
        JOIN archive_material_definitions md ON md.id=mf.material_id
        WHERE mf.id=NEW.formulation_id
          AND mf.publication_state='published' AND mf.public_visible=1
          AND md.publication_state='published' AND md.public_visible=1
      ),
      'Documented color'
    ),
    trim(NEW.public_label||' '||NEW.technique||' '||NEW.quantity_note||' '||NEW.notes),
    'palette-materials',1,datetime('now')
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE aos.id=NEW.state_id
    AND NEW.publication_state='published' AND NEW.public_visible=1
    AND aos.publication_state='published' AND aos.public_visible=1
    AND aov.publication_state='published' AND aov.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_color_usage_fragment_delete
AFTER DELETE ON archive_color_usages BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='palette-color' AND source_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_general_material_usage_fragment_insert
AFTER INSERT ON archive_general_material_usages BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-palette-material-'||NEW.id,aov.entity_id,'palette-material',NEW.id,
    md.name,
    trim(md.name||' '||md.brand||' '||md.product_line||' '||md.product_name||' '||
      md.model_name||' '||md.product_code||' '||NEW.usage_role||' '||NEW.technique||' '||
      NEW.quantity_note||' '||NEW.notes),
    'palette-materials',1,datetime('now')
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN archive_material_definitions md ON md.id=NEW.material_id
  WHERE aos.id=NEW.state_id
    AND NEW.publication_state='published' AND NEW.public_visible=1
    AND md.publication_state='published' AND md.public_visible=1
    AND aos.publication_state='published' AND aos.public_visible=1
    AND aov.publication_state='published' AND aov.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_general_material_usage_fragment_update
AFTER UPDATE ON archive_general_material_usages BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='palette-material' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-palette-material-'||NEW.id,aov.entity_id,'palette-material',NEW.id,
    md.name,
    trim(md.name||' '||md.brand||' '||md.product_line||' '||md.product_name||' '||
      md.model_name||' '||md.product_code||' '||NEW.usage_role||' '||NEW.technique||' '||
      NEW.quantity_note||' '||NEW.notes),
    'palette-materials',1,datetime('now')
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN archive_material_definitions md ON md.id=NEW.material_id
  WHERE aos.id=NEW.state_id
    AND NEW.publication_state='published' AND NEW.public_visible=1
    AND md.publication_state='published' AND md.public_visible=1
    AND aos.publication_state='published' AND aos.public_visible=1
    AND aov.publication_state='published' AND aov.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_general_material_usage_fragment_delete
AFTER DELETE ON archive_general_material_usages BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='palette-material' AND source_id=OLD.id;
END;

CREATE TABLE IF NOT EXISTS archive_palette_maps (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  source_media_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  width REAL NOT NULL CHECK(width > 0),
  height REAL NOT NULL CHECK(height > 0),
  viewbox_x REAL NOT NULL DEFAULT 0,
  viewbox_y REAL NOT NULL DEFAULT 0,
  overlay_opacity REAL NOT NULL DEFAULT 0.55 CHECK(overlay_opacity BETWEEN 0 AND 1),
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE,
  FOREIGN KEY(source_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_palette_maps_state
  ON archive_palette_maps(state_id,publication_state,public_visible);

CREATE TABLE IF NOT EXISTS archive_palette_regions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  color_usage_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  geometry_type TEXT NOT NULL CHECK(geometry_type IN ('polygon','polyline','path','rect','circle','ellipse')),
  geometry_json TEXT NOT NULL,
  layer_order INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(map_id) REFERENCES archive_palette_maps(id) ON DELETE CASCADE,
  FOREIGN KEY(color_usage_id) REFERENCES archive_color_usages(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_palette_regions_map
  ON archive_palette_regions(map_id,layer_order,sort_order);

CREATE TRIGGER IF NOT EXISTS archive_palette_region_state_match_insert
BEFORE INSERT ON archive_palette_regions
WHEN NOT EXISTS(
  SELECT 1 FROM archive_palette_maps pm
  JOIN archive_color_usages cu ON cu.id=NEW.color_usage_id
  WHERE pm.id=NEW.map_id AND pm.state_id=cu.state_id
)
BEGIN
  SELECT RAISE(ABORT,'Palette regions must use a color usage from the same creative state.');
END;

-- New canonical Tattoo Designs use the same catalogue vocabulary as Flash and
-- executed Portfolio tattoos. "realized-as" is the controlled
-- design-to-execution relationship.
