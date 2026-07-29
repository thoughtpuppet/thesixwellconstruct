PRAGMA foreign_keys = ON;

-- Controlled catalogue families and object types keep identifiers structured
-- while allowing every medium to describe its own kind of cultural object.
CREATE TABLE IF NOT EXISTS archive_catalogue_media (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_cultural_object_types (
  id TEXT PRIMARY KEY,
  medium_id TEXT NOT NULL,
  label TEXT NOT NULL,
  catalogue_prefix TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  state_guidance TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(medium_id,label),
  FOREIGN KEY(medium_id) REFERENCES archive_catalogue_media(id) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO archive_catalogue_media(id,label,description,sort_order,created_at,updated_at) VALUES
  ('art','Art','Paintings, drawings, woodworkings, prints, sculpture, installation, photography, and related authored objects.',10,datetime('now'),datetime('now')),
  ('merch','Merch','Garments, printed matter, accessories, samples, and product-design objects.',20,datetime('now'),datetime('now')),
  ('tattoos','Tattoos','Tattoo designs, flash designs, stencils, and individual tattoo executions.',30,datetime('now'),datetime('now')),
  ('film','Film','Films, process films, moving-image works, and animation.',40,datetime('now'),datetime('now')),
  ('music','Music','Recordings, compositions, performances, albums, and singles.',50,datetime('now'),datetime('now')),
  ('writings','Writings','Essays, poems, stories, manuscripts, books, and zines.',60,datetime('now'),datetime('now')),
  ('legend','Legend','Symbols and authored visual-language objects.',80,datetime('now'),datetime('now')),
  ('other','Other','Other independently identifiable cultural objects.',90,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_cultural_object_types(id,medium_id,label,catalogue_prefix,description,state_guidance,sort_order,created_at,updated_at) VALUES
  ('art-painting','art','Painting','ART','A painting catalogued as one cultural object.','Initial composition; developed composition; revision; resolved condition',10,datetime('now'),datetime('now')),
  ('art-woodworking','art','Woodworking','ART','An authored object made primarily through woodworking.','Design; fabrication; assembly; finishing; resolved condition',20,datetime('now'),datetime('now')),
  ('art-drawing','art','Drawing','ART','A drawing or drawing-led work.','Study; developed drawing; revision; resolved condition',30,datetime('now'),datetime('now')),
  ('art-print','art','Print','ART','A print or editioned printed work.','Proof; revised proof; production-approved state',40,datetime('now'),datetime('now')),
  ('art-sculpture','art','Sculpture','ART','A sculptural cultural object.','Maquette; fabrication; assembly; resolved condition',50,datetime('now'),datetime('now')),
  ('art-photograph','art','Photograph','ART','An independently authored photographic work.','Capture; selection; edit; final print or presentation',60,datetime('now'),datetime('now')),
  ('art-installation','art','Installation','ART','An installation or spatial artwork.','Plan; test installation; revision; installed condition',70,datetime('now'),datetime('now')),
  ('art-mixed-media','art','Mixed media','ART','A work combining multiple primary media.','Initial composition; assembly; revision; resolved condition',80,datetime('now'),datetime('now')),
  ('art-digital-work','art','Digital work','ART','A digital or computational artwork.','Prototype; build; revision; release state',90,datetime('now'),datetime('now')),
  ('art-other','art','Other artwork','ART','Another independently identifiable Art object.','Name each meaningful documented condition',100,datetime('now'),datetime('now')),
  ('merch-hoodie','merch','Hoodie','MER','A hoodie product or design family.','Concept; prototype; sample; revised sample; production-approved design',10,datetime('now'),datetime('now')),
  ('merch-shirt','merch','Shirt','MER','A shirt or T-shirt product or design family.','Concept; prototype; sample; revised sample; production-approved design',20,datetime('now'),datetime('now')),
  ('merch-sweatshirt','merch','Sweatshirt','MER','A sweatshirt product or design family.','Concept; prototype; sample; revised sample; production-approved design',30,datetime('now'),datetime('now')),
  ('merch-jacket','merch','Jacket','MER','A jacket product or design family.','Concept; prototype; sample; revised sample; production-approved design',40,datetime('now'),datetime('now')),
  ('merch-hat','merch','Hat','MER','A hat product or design family.','Concept; prototype; sample; revised sample; production-approved design',50,datetime('now'),datetime('now')),
  ('merch-bag','merch','Bag','MER','A bag product or design family.','Concept; prototype; sample; revised sample; production-approved design',60,datetime('now'),datetime('now')),
  ('merch-print','merch','Print','MER','A Merch print product family.','Layout; proof; revised proof; production-approved design',70,datetime('now'),datetime('now')),
  ('merch-book-zine','merch','Book or zine','MER','A book, zine, or editioned publication product.','Dummy; proof; revision; production-approved edition',80,datetime('now'),datetime('now')),
  ('merch-accessory','merch','Accessory','MER','An accessory product or design family.','Concept; prototype; sample; revised sample; production-approved design',90,datetime('now'),datetime('now')),
  ('merch-other','merch','Other Merch object','MER','Another independently identifiable Merch object.','Concept; prototype; sample; revision; production approval',100,datetime('now'),datetime('now')),
  ('tattoo-design','tattoos','Tattoo design','TAT-DES','A reusable or commissioned tattoo design.','Initial drawing; revised composition; final drawing; stencil-ready state',10,datetime('now'),datetime('now')),
  ('tattoo-flash-design','tattoos','Flash design','TAT-DES','A flash design that may be executed more than once.','Initial drawing; revised composition; final drawing; release state',20,datetime('now'),datetime('now')),
  ('tattoo-stencil','tattoos','Stencil','TAT-DES','An independently catalogued stencil or transfer design.','Preparation; revision; placement-ready state',30,datetime('now'),datetime('now')),
  ('tattoo-execution','tattoos','Tattoo execution','TAT-EXE','One tattoo executed on one person.','Session 1; later session; completed execution; touch-up',40,datetime('now'),datetime('now')),
  ('tattoo-other','tattoos','Other tattoo design','TAT-DES','Another independently identifiable tattoo design.','Initial drawing; revision; final drawing; placement-ready state',50,datetime('now'),datetime('now')),
  ('film-work','film','Film or video work','FLM','An independently authored moving-image work.','Assembly; rough cut; revised cut; release cut',10,datetime('now'),datetime('now')),
  ('music-work','music','Music work','MUS','A recording, composition, or independently catalogued music object.','Demo; arrangement; recording; mix; release state',10,datetime('now'),datetime('now')),
  ('writing-work','writings','Written work','WRI','An essay, poem, story, manuscript, book, or zine.','Draft; revision; edited manuscript; published text',10,datetime('now'),datetime('now')),
  ('legend-symbol','legend','Symbol','LEG','An authored symbol or visual-language object.','Initial form; revision; canonical form; later interpretation',10,datetime('now'),datetime('now')),
  ('other-event-derived-artifact','other','Event-derived artifact','OBJ','An independently catalogued artifact produced by or retained from an event.','Initial form; event condition; later documented condition',5,datetime('now'),datetime('now')),
  ('other-cultural-object','other','Other cultural object','OBJ','Another independently identifiable cultural object.','Name each meaningful documented condition',10,datetime('now'),datetime('now'));

CREATE TABLE IF NOT EXISTS archive_catalogue_entries (
  entity_id TEXT PRIMARY KEY,
  medium_id TEXT NOT NULL,
  object_type_id TEXT NOT NULL,
  catalogue_prefix TEXT NOT NULL,
  catalogue_number INTEGER NOT NULL CHECK(catalogue_number > 0),
  catalogue_id TEXT NOT NULL UNIQUE,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version > 0),
  current_state TEXT NOT NULL DEFAULT 'I',
  variant_label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'migration-0078',
  updated_by TEXT NOT NULL DEFAULT 'migration-0078',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(catalogue_prefix,catalogue_number),
  FOREIGN KEY(entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(medium_id) REFERENCES archive_catalogue_media(id) ON DELETE RESTRICT,
  FOREIGN KEY(object_type_id) REFERENCES archive_cultural_object_types(id) ON DELETE RESTRICT
);

-- Events remain full Archive records, but their EVT identifiers live outside
-- the cultural-object catalogue because events do not have object versions or
-- creative states.
CREATE TABLE IF NOT EXISTS archive_event_identifiers (
  entity_id TEXT PRIMARY KEY,
  event_number INTEGER NOT NULL CHECK(event_number > 0),
  event_id TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL DEFAULT 'migration-0078',
  updated_by TEXT NOT NULL DEFAULT 'migration-0078',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_number),
  FOREIGN KEY(entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_object_versions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated' CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_id,version_number),
  FOREIGN KEY(entity_id) REFERENCES archive_catalogue_entries(entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_object_states (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  state_roman TEXT NOT NULL,
  state_order INTEGER NOT NULL CHECK(state_order > 0),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  variant_label TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated' CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(version_id,state_order,variant_label),
  FOREIGN KEY(version_id) REFERENCES archive_object_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_catalogue_medium_type
  ON archive_catalogue_entries(medium_id,object_type_id,catalogue_prefix,catalogue_number);
CREATE INDEX IF NOT EXISTS idx_archive_object_versions_entity
  ON archive_object_versions(entity_id,sort_order,version_number);
CREATE INDEX IF NOT EXISTS idx_archive_object_states_version
  ON archive_object_states(version_id,sort_order,state_order,variant_label);

ALTER TABLE archive_materials ADD COLUMN state_id TEXT;
ALTER TABLE archive_materials ADD COLUMN material_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_materials ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1));

CREATE INDEX IF NOT EXISTS idx_archive_materials_state
  ON archive_materials(state_id,sort_order,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_materials_state_reference
  ON archive_materials(state_id,material_reference) WHERE state_id IS NOT NULL AND material_reference<>'';

-- Existing dossiers receive conservative classifications. Uncertain objects
-- remain editable "Other" records rather than being falsely specified.
WITH classified AS (
  SELECT ad.entity_id,ad.created_at,
    CASE ce.entity_type
      WHEN 'art_work' THEN 'art'
      WHEN 'merch_item' THEN 'merch'
      WHEN 'portfolio_item' THEN 'tattoos'
      WHEN 'flash_item' THEN 'tattoos'
      WHEN 'visual_symbol' THEN 'legend'
      ELSE CASE
        WHEN ce.node_id IN ('art','merch','tattoos','film','music','writings','legend') THEN ce.node_id
        ELSE 'other'
      END
    END medium_id,
    CASE ce.entity_type
      WHEN 'art_work' THEN CASE
        WHEN lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%paint%'
          OR lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%acrylic%'
          OR lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%oil%' THEN 'art-painting'
        WHEN lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%woodwork%' THEN 'art-woodworking'
        WHEN lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%draw%' THEN 'art-drawing'
        WHEN lower(COALESCE((SELECT aw.medium FROM art_works aw WHERE aw.id=ce.id),'')) LIKE '%print%' THEN 'art-print'
        ELSE 'art-other'
      END
      WHEN 'merch_item' THEN CASE
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%hood%' THEN 'merch-hoodie'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%shirt%'
          OR lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%tee%' THEN 'merch-shirt'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%sweat%' THEN 'merch-sweatshirt'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%jacket%' THEN 'merch-jacket'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%hat%' THEN 'merch-hat'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%bag%' THEN 'merch-bag'
        WHEN lower(COALESCE((SELECT mi.product_type||' '||mi.title||' '||mi.shopify_handle FROM merch_items mi WHERE mi.id=ce.id),'')) LIKE '%print%' THEN 'merch-print'
        ELSE 'merch-other'
      END
      WHEN 'portfolio_item' THEN 'tattoo-execution'
      WHEN 'flash_item' THEN 'tattoo-flash-design'
      WHEN 'visual_symbol' THEN 'legend-symbol'
      ELSE CASE
        WHEN ce.node_id='film' THEN 'film-work'
        WHEN ce.node_id='music' THEN 'music-work'
        WHEN ce.node_id='writings' THEN 'writing-work'
        ELSE 'other-cultural-object'
      END
    END object_type_id
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ce.entity_type<>'event'
), numbered AS (
  SELECT c.entity_id,c.medium_id,c.object_type_id,cot.catalogue_prefix,
    row_number() OVER(PARTITION BY cot.catalogue_prefix ORDER BY c.created_at,c.entity_id) catalogue_number
  FROM classified c
  JOIN archive_cultural_object_types cot ON cot.id=c.object_type_id
)
INSERT OR IGNORE INTO archive_catalogue_entries
  (entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at)
SELECT entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,
  catalogue_prefix||'-'||printf('%03d',catalogue_number),1,'I','',
  'migration-0078','migration-0078',datetime('now'),datetime('now')
FROM numbered;

WITH numbered_events AS (
  SELECT ad.entity_id,
    row_number() OVER(ORDER BY ad.created_at,ad.entity_id) event_number
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id AND ce.entity_type='event'
)
INSERT OR IGNORE INTO archive_event_identifiers
  (entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at)
SELECT entity_id,event_number,'EVT-'||printf('%03d',event_number),
  'migration-0078','migration-0078',datetime('now'),datetime('now')
FROM numbered_events;

INSERT OR IGNORE INTO archive_object_versions
  (id,entity_id,version_number,title,description,date_precision,sort_order,created_by,updated_by,created_at,updated_at)
SELECT 'archive-version-'||replace(entity_id,'/','-')||'-1',entity_id,1,'Version 1','Existing documentation begins with this version.','undated',1,
  'migration-0078','migration-0078',datetime('now'),datetime('now')
FROM archive_catalogue_entries;

INSERT OR IGNORE INTO archive_object_states
  (id,version_id,state_roman,state_order,title,description,variant_label,date_precision,sort_order,created_by,updated_by,created_at,updated_at)
SELECT 'archive-state-'||replace(ace.entity_id,'/','-')||'-1-I',aov.id,'I',1,'First documented state',
  'The earliest state currently represented by materials in this dossier.','','undated',1,
  'migration-0078','migration-0078',datetime('now'),datetime('now')
FROM archive_catalogue_entries ace
JOIN archive_object_versions aov ON aov.entity_id=ace.entity_id AND aov.version_number=1;

UPDATE archive_materials
SET state_id=(
  SELECT aos.id
  FROM archive_object_states aos
  JOIN archive_object_versions aov ON aov.id=aos.version_id
  WHERE aov.entity_id=archive_materials.dossier_entity_id
  ORDER BY aov.version_number,aos.state_order
  LIMIT 1
)
WHERE state_id IS NULL;

WITH referenced AS (
  SELECT am.id,
    CASE WHEN am.material_type='note' THEN 'N' WHEN am.material_type='document' THEN 'D' ELSE 'M' END prefix,
    row_number() OVER(
      PARTITION BY am.state_id,CASE WHEN am.material_type='note' THEN 'N' WHEN am.material_type='document' THEN 'D' ELSE 'M' END
      ORDER BY am.sort_order,am.created_at,am.id
    ) reference_number
  FROM archive_materials am
)
UPDATE archive_materials
SET material_reference=(
  SELECT prefix||printf('%02d',reference_number) FROM referenced WHERE referenced.id=archive_materials.id
)
WHERE material_reference='';

-- Precise cross-node edges remain separate from broader origin threads.
INSERT OR IGNORE INTO relationship_types
  (id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('rel-executed-as','executed-as','Executed as','Execution of','Connects a tattoo design to an individual tattoo execution.',1,20,datetime('now'),datetime('now')),
  ('rel-editioned-as','editioned-as','Editioned as','Edition of','Connects a cultural object or product design to an edition.',1,21,datetime('now'),datetime('now')),
  ('rel-manufactured-by','manufactured-by','Manufactured by','Manufactured','Connects a cultural object to its manufacturer.',1,22,datetime('now'),datetime('now')),
  ('rel-created-at','created-at','Created at','Site of creation','Connects a cultural object to a place of creation.',1,23,datetime('now'),datetime('now'));

-- Catalogue identifiers are searchable without being mixed into the object ID.
CREATE TRIGGER IF NOT EXISTS archive_catalogue_fragment_insert
AFTER INSERT ON archive_catalogue_entries BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-catalogue-'||NEW.entity_id,NEW.entity_id,'catalogue',NEW.entity_id,
    NEW.catalogue_id,trim(NEW.catalogue_id||'.'||NEW.current_version||'/'||NEW.current_state||' '||cot.label||' '||acm.label||' '||NEW.variant_label),
    'overview',1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN archive_cultural_object_types cot ON cot.id=NEW.object_type_id
  JOIN archive_catalogue_media acm ON acm.id=NEW.medium_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_catalogue_fragment_update
AFTER UPDATE ON archive_catalogue_entries BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.entity_id AND fragment_type='catalogue' AND source_id=OLD.entity_id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-catalogue-'||NEW.entity_id,NEW.entity_id,'catalogue',NEW.entity_id,
    NEW.catalogue_id,trim(NEW.catalogue_id||'.'||NEW.current_version||'/'||NEW.current_state||' '||cot.label||' '||acm.label||' '||NEW.variant_label),
    'overview',1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN archive_cultural_object_types cot ON cot.id=NEW.object_type_id
  JOIN archive_catalogue_media acm ON acm.id=NEW.medium_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_catalogue_fragment_delete
AFTER DELETE ON archive_catalogue_entries BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.entity_id AND fragment_type='catalogue' AND source_id=OLD.entity_id;
END;

CREATE TRIGGER IF NOT EXISTS archive_event_identifier_dossier_insert
AFTER INSERT ON archive_dossiers
WHEN EXISTS(SELECT 1 FROM content_entities ce WHERE ce.id=NEW.entity_id AND ce.entity_type='event')
BEGIN
  INSERT OR IGNORE INTO archive_event_identifiers
    (entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.entity_id,next_number,'EVT-'||printf('%03d',next_number),
    'archive-trigger','archive-trigger',datetime('now'),datetime('now')
  FROM (SELECT COALESCE(MAX(event_number),0)+1 next_number FROM archive_event_identifiers);
END;

CREATE TRIGGER IF NOT EXISTS archive_event_identifier_fragment_insert
AFTER INSERT ON archive_event_identifiers BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-event-identifier-'||NEW.entity_id,NEW.entity_id,'event-identifier',NEW.entity_id,
    NEW.event_id,NEW.event_id,'overview',1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_event_identifier_fragment_update
AFTER UPDATE ON archive_event_identifiers BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.entity_id AND fragment_type='event-identifier' AND source_id=OLD.entity_id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-event-identifier-'||NEW.entity_id,NEW.entity_id,'event-identifier',NEW.entity_id,
    NEW.event_id,NEW.event_id,'overview',1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_event_identifier_fragment_delete
AFTER DELETE ON archive_event_identifiers BEGIN
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=OLD.entity_id AND fragment_type='event-identifier' AND source_id=OLD.entity_id;
END;

-- Publishing, unpublishing, or republishing a dossier must rebuild the
-- identifier fragments even when the identity itself did not change.
CREATE TRIGGER IF NOT EXISTS archive_dossier_identity_fragment_update
AFTER UPDATE OF state,public_visible ON archive_dossiers BEGIN
  UPDATE archive_catalogue_entries SET updated_at=updated_at
    WHERE entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  UPDATE archive_event_identifiers SET updated_at=updated_at
    WHERE entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  DELETE FROM archive_search_fragments
    WHERE dossier_entity_id=NEW.entity_id
      AND fragment_type IN ('catalogue','event-identifier')
      AND (NEW.state<>'published' OR NEW.public_visible=0);
END;

-- Existing catalogue rows were inserted before the trigger existed.
UPDATE archive_catalogue_entries SET updated_at=updated_at;
-- Existing Event rows were inserted before their search trigger existed.
UPDATE archive_event_identifiers SET updated_at=updated_at;

-- Existing public themes become searchable context fragments. Later Studio
-- edits refresh these rows through the Archive dossier API.
INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-theme-'||et.entity_id||'-'||tt.id,et.entity_id,'theme',tt.id,
  tt.name,tt.description,'story',tt.public_visible,datetime('now')
FROM entity_terms et
JOIN taxonomy_terms tt ON tt.id=et.term_id AND tt.kind='theme'
JOIN archive_dossiers ad ON ad.entity_id=et.entity_id;
