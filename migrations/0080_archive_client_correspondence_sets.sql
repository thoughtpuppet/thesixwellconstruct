PRAGMA foreign_keys = ON;

-- Source materials preserve evidence supplied or exchanged while a cultural
-- object was being developed. Client correspondence is the first supported
-- source-material kind. Entries may be ordered independently and one set may
-- document more than one creative state without becoming a second object.
CREATE TABLE IF NOT EXISTS archive_source_material_sets (
  id TEXT PRIMARY KEY,
  dossier_entity_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'client-correspondence'
    CHECK(source_kind IN ('client-correspondence','blackboard')),
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK(visibility IN ('public','unlisted','internal','private')),
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  permission_status TEXT NOT NULL DEFAULT 'not-required'
    CHECK(permission_status IN ('not-required','required','granted','denied','unknown')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_source_material_sets_dossier
  ON archive_source_material_sets(dossier_entity_id,publication_state,visibility,sort_order,created_at);

CREATE TABLE IF NOT EXISTS archive_source_material_entries (
  id TEXT PRIMARY KEY,
  source_material_set_id TEXT NOT NULL,
  media_id TEXT,
  entry_type TEXT NOT NULL
    CHECK(entry_type IN (
      'correspondence-page',
      'correspondence-document',
      'correspondence-text',
      'client-reference-image',
      'blackboard-whole',
      'blackboard-detail'
    )),
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  public_included INTEGER NOT NULL DEFAULT 1 CHECK(public_included IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(media_id IS NOT NULL OR trim(body) <> ''),
  FOREIGN KEY(source_material_set_id) REFERENCES archive_source_material_sets(id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_archive_source_material_entries_set
  ON archive_source_material_entries(source_material_set_id,public_included,sort_order,created_at);
CREATE INDEX IF NOT EXISTS idx_archive_source_material_entries_media
  ON archive_source_material_entries(media_id,public_included);

CREATE TABLE IF NOT EXISTS archive_source_material_states (
  source_material_set_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  document_reference TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_material_set_id,state_id),
  UNIQUE(state_id,document_reference),
  FOREIGN KEY(source_material_set_id) REFERENCES archive_source_material_sets(id) ON DELETE CASCADE,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE CASCADE,
  CHECK(document_reference GLOB 'D[0-9][0-9]*')
);

CREATE INDEX IF NOT EXISTS idx_archive_source_material_states_state
  ON archive_source_material_states(state_id,sort_order,document_reference);

-- D references share one state-level namespace with existing document
-- materials. The API allocates references, while these triggers prevent a
-- direct write from creating a cross-table collision.
CREATE TRIGGER IF NOT EXISTS archive_source_material_reference_insert
BEFORE INSERT ON archive_source_material_states
WHEN EXISTS(
  SELECT 1 FROM archive_materials
  WHERE state_id=NEW.state_id AND material_reference=NEW.document_reference
)
BEGIN
  SELECT RAISE(ABORT,'Source material reference already belongs to a document material.');
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_reference_update
BEFORE UPDATE OF state_id,document_reference ON archive_source_material_states
WHEN EXISTS(
  SELECT 1 FROM archive_materials
  WHERE state_id=NEW.state_id AND material_reference=NEW.document_reference
)
BEGIN
  SELECT RAISE(ABORT,'Source material reference already belongs to a document material.');
END;

CREATE TRIGGER IF NOT EXISTS archive_document_material_reference_insert
BEFORE INSERT ON archive_materials
WHEN NEW.material_reference LIKE 'D%' AND EXISTS(
  SELECT 1 FROM archive_source_material_states
  WHERE state_id=NEW.state_id AND document_reference=NEW.material_reference
)
BEGIN
  SELECT RAISE(ABORT,'Document material reference already belongs to a source material set.');
END;

CREATE TRIGGER IF NOT EXISTS archive_document_material_reference_update
BEFORE UPDATE OF state_id,material_reference ON archive_materials
WHEN NEW.material_reference LIKE 'D%' AND EXISTS(
  SELECT 1 FROM archive_source_material_states
  WHERE state_id=NEW.state_id AND document_reference=NEW.material_reference
)
BEGIN
  SELECT RAISE(ABORT,'Document material reference already belongs to a source material set.');
END;

-- Source-material search fragments use only public-included entry copy. Public
-- queries still re-check the set, state, permission, and Digital-asset gates.
CREATE TRIGGER IF NOT EXISTS archive_source_material_fragment_insert
AFTER INSERT ON archive_source_material_sets
BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES(
    'archive-source-material-'||replace(NEW.id,'/','-'),
    NEW.dossier_entity_id,
    'source-material',
    NEW.id,
    COALESCE(NULLIF(NEW.title,''),CASE NEW.source_kind WHEN 'blackboard' THEN 'Blackboard source' ELSE 'Client correspondence' END),
    NEW.caption,
    'source-material-'||replace(NEW.id,'/','-'),
    CASE WHEN NEW.publication_state='published' AND NEW.visibility='public'
      AND NEW.permission_status IN ('not-required','granted') THEN 1 ELSE 0 END,
    NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_fragment_update
AFTER UPDATE ON archive_source_material_sets
BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.dossier_entity_id
    AND fragment_type='source-material' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES(
    'archive-source-material-'||replace(NEW.id,'/','-'),
    NEW.dossier_entity_id,
    'source-material',
    NEW.id,
    COALESCE(NULLIF(NEW.title,''),CASE NEW.source_kind WHEN 'blackboard' THEN 'Blackboard source' ELSE 'Client correspondence' END),
    trim(NEW.caption||' '||COALESCE((
      SELECT group_concat(trim(title||' '||caption||' '||body),' ')
      FROM archive_source_material_entries
      WHERE source_material_set_id=NEW.id AND public_included=1
    ),'')),
    'source-material-'||replace(NEW.id,'/','-'),
    CASE WHEN NEW.publication_state='published' AND NEW.visibility='public'
      AND NEW.permission_status IN ('not-required','granted') THEN 1 ELSE 0 END,
    NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_fragment_delete
AFTER DELETE ON archive_source_material_sets
BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.dossier_entity_id
    AND fragment_type='source-material' AND source_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_entry_fragment_insert
AFTER INSERT ON archive_source_material_entries
BEGIN
  UPDATE archive_source_material_sets SET updated_at=updated_at WHERE id=NEW.source_material_set_id;
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_entry_fragment_update
AFTER UPDATE ON archive_source_material_entries
BEGIN
  UPDATE archive_source_material_sets SET updated_at=updated_at WHERE id=NEW.source_material_set_id;
  UPDATE archive_source_material_sets SET updated_at=updated_at
    WHERE id=OLD.source_material_set_id AND OLD.source_material_set_id<>NEW.source_material_set_id;
END;

CREATE TRIGGER IF NOT EXISTS archive_source_material_entry_fragment_delete
AFTER DELETE ON archive_source_material_entries
BEGIN
  UPDATE archive_source_material_sets SET updated_at=updated_at WHERE id=OLD.source_material_set_id;
END;
