PRAGMA foreign_keys = ON;

-- The public Archive is a one-to-one publishing extension of canonical
-- Construct entities. It never creates a second identity for a work, product,
-- tattoo, symbol, or event.
CREATE TABLE IF NOT EXISTS archive_dossiers (
  entity_id TEXT PRIMARY KEY,
  archive_slug TEXT NOT NULL UNIQUE,
  orientation TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  story_html TEXT NOT NULL DEFAULT '',
  empty_materials_note TEXT NOT NULL DEFAULT 'No process materials are public yet.',
  record_type TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_dossiers_public
  ON archive_dossiers(state, public_visible, featured, sort_order, updated_at);

ALTER TABLE media_assets ADD COLUMN transcript TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN transcript_status TEXT NOT NULL DEFAULT 'not-requested'
  CHECK(transcript_status IN ('not-requested','pending','ready','failed'));
ALTER TABLE media_assets ADD COLUMN transcript_language TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN public_title TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN public_description TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN public_presentation TEXT NOT NULL DEFAULT 'inline'
  CHECK(public_presentation IN ('inline','hidden'));

CREATE TABLE IF NOT EXISTS archive_materials (
  id TEXT PRIMARY KEY,
  dossier_entity_id TEXT NOT NULL,
  media_id TEXT,
  role TEXT NOT NULL DEFAULT 'notebook',
  material_type TEXT NOT NULL CHECK(material_type IN ('final-image','sketch','process-photo','note','voice-memo','video','document','artifact')),
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  process_phase TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated' CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK(visibility IN ('public','unlisted','internal','private')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(media_id IS NOT NULL OR trim(body) <> ''),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_materials_dossier
  ON archive_materials(dossier_entity_id, state, visibility, sort_order, occurred_at);
CREATE INDEX IF NOT EXISTS idx_archive_materials_media
  ON archive_materials(media_id, state, visibility);
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_materials_entity_media_role
  ON archive_materials(dossier_entity_id, media_id, role) WHERE media_id IS NOT NULL;

-- Existing activity rows remain valid. New date fields let a visitor-facing
-- label be honest even when the underlying date is approximate or unknown.
ALTER TABLE entity_activity ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE entity_activity ADD COLUMN body TEXT NOT NULL DEFAULT '';
ALTER TABLE entity_activity ADD COLUMN date_precision TEXT NOT NULL DEFAULT 'undated'
  CHECK(date_precision IN ('exact','approximate','year','range','undated'));
ALTER TABLE entity_activity ADD COLUMN date_label TEXT NOT NULL DEFAULT '';
ALTER TABLE entity_activity ADD COLUMN source_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  organization_type TEXT NOT NULL DEFAULT 'brand' CHECK(organization_type IN ('brand','construct','collective','studio','other')),
  description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_dossier_subjects (
  dossier_entity_id TEXT NOT NULL,
  subject_entity_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'related',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(dossier_entity_id, subject_entity_id, role),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(subject_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_dossier_subjects_subject
  ON archive_dossier_subjects(subject_entity_id, public_visible, sort_order);

CREATE TABLE IF NOT EXISTS entity_activity_subjects (
  activity_id TEXT NOT NULL,
  subject_entity_id TEXT NOT NULL,
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(activity_id, subject_entity_id),
  FOREIGN KEY(activity_id) REFERENCES entity_activity(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_activity_subjects_subject
  ON entity_activity_subjects(subject_entity_id, public_visible, sort_order);

CREATE TABLE IF NOT EXISTS archive_timelines (
  id TEXT PRIMARY KEY,
  subject_entity_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(subject_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_timeline_chapters (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  ended_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated' CHECK(date_precision IN ('exact','approximate','year','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  anchor_slug TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(timeline_id) REFERENCES archive_timelines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_timeline_chapters_public
  ON archive_timeline_chapters(timeline_id, state, public_visible, occurred_at, sort_order);

CREATE TABLE IF NOT EXISTS archive_dossier_collections (
  dossier_entity_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(dossier_entity_id, collection_id),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(collection_id) REFERENCES archive_collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_facets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('medium','brand','person','era','collection','record_type')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, slug)
);

CREATE TABLE IF NOT EXISTS archive_dossier_facets (
  dossier_entity_id TEXT NOT NULL,
  facet_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(dossier_entity_id, facet_id),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(facet_id) REFERENCES archive_facets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_dossier_facets_facet
  ON archive_dossier_facets(facet_id, dossier_entity_id);

-- Search is fragment-based so many captions, transcripts, activities, people,
-- places, collections, and relationship labels can match one canonical dossier.
CREATE TABLE IF NOT EXISTS archive_search_fragments (
  id TEXT PRIMARY KEY,
  dossier_entity_id TEXT NOT NULL,
  fragment_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  anchor TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  updated_at TEXT NOT NULL,
  UNIQUE(dossier_entity_id, fragment_type, source_id),
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_search_fragments_owner
  ON archive_search_fragments(dossier_entity_id, public_visible, fragment_type);

CREATE VIRTUAL TABLE IF NOT EXISTS archive_search_fragments_fts USING fts5(
  dossier_entity_id UNINDEXED,
  label,
  body,
  content='archive_search_fragments',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS archive_search_fragments_ai
AFTER INSERT ON archive_search_fragments BEGIN
  INSERT INTO archive_search_fragments_fts(rowid,dossier_entity_id,label,body)
  VALUES(new.rowid,new.dossier_entity_id,new.label,new.body);
END;

CREATE TRIGGER IF NOT EXISTS archive_search_fragments_ad
AFTER DELETE ON archive_search_fragments BEGIN
  INSERT INTO archive_search_fragments_fts(archive_search_fragments_fts,rowid,dossier_entity_id,label,body)
  VALUES('delete',old.rowid,old.dossier_entity_id,old.label,old.body);
END;

CREATE TRIGGER IF NOT EXISTS archive_search_fragments_au
AFTER UPDATE ON archive_search_fragments BEGIN
  INSERT INTO archive_search_fragments_fts(archive_search_fragments_fts,rowid,dossier_entity_id,label,body)
  VALUES('delete',old.rowid,old.dossier_entity_id,old.label,old.body);
  INSERT INTO archive_search_fragments_fts(rowid,dossier_entity_id,label,body)
  VALUES(new.rowid,new.dossier_entity_id,new.label,new.body);
END;

-- First-class public subjects used by the initial brand, founder, medium, and
-- whole-Construct timelines.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('org-six-well-construct','organization','node-about','public',0,datetime('now'),'migration-0043','migration-0043',datetime('now'),datetime('now')),
  ('org-thoughtpuppet','organization','node-art','public',0,datetime('now'),'migration-0043','migration-0043',datetime('now'),datetime('now')),
  ('person-saiel-dauhn-solehman','person','node-about','public',0,datetime('now'),'migration-0043','migration-0043',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO organizations
  (id,name,slug,organization_type,description,state,created_at,updated_at)
VALUES
  ('org-six-well-construct','The Six.Well Construct','six-well-construct','construct','The connected structure that holds the work, its mediums, brands, and public record.','published',datetime('now'),datetime('now')),
  ('org-thoughtpuppet','Thoughtpuppet','thoughtpuppet','brand','A creative identity within the Six.Well Construct.','published',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO people
  (id,name,slug,bio,privacy,state,created_at,updated_at)
VALUES
  ('person-saiel-dauhn-solehman','Saiel Dauhn Solehman','saiel-dauhn-solehman','Founder and artist within the Six.Well Construct.','public','published',datetime('now'),datetime('now'));

-- Reconcile every currently eligible public canonical entity. Slugs stay plain
-- when unique and receive an entity-type prefix only when two item types collide.
WITH eligible(entity_id,entity_type,base_slug,record_type) AS (
  SELECT ce.id,ce.entity_type,
    COALESCE(NULLIF(aw.slug,''),NULLIF(mi.shopify_handle,''),NULLIF(pi.id,''),NULLIF(fi.slug,''),NULLIF(ev.slug,''),NULLIF(vs.slug,''),ce.id),
    CASE ce.entity_type
      WHEN 'art_work' THEN 'artwork' WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo' WHEN 'flash_item' THEN 'flash'
      WHEN 'event' THEN 'event' WHEN 'visual_symbol' THEN 'symbol' ELSE ce.entity_type END
  FROM content_entities ce
  LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id AND aw.state='published'
  LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id AND mi.state='published'
  LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id AND pi.state='published'
  LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id AND fi.state IN ('available','reserved','placed','retired')
  LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id AND ev.status<>'draft'
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id AND vs.state='published'
  WHERE ce.visibility='public'
    AND ce.entity_type IN ('art_work','merch_item','portfolio_item','flash_item','event','visual_symbol')
    AND (aw.id IS NOT NULL OR mi.id IS NOT NULL OR pi.id IS NOT NULL OR fi.id IS NOT NULL OR ev.id IS NOT NULL OR vs.id IS NOT NULL)
)
INSERT OR IGNORE INTO archive_dossiers
  (entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
SELECT entity_id,
  CASE WHEN (SELECT COUNT(*) FROM eligible other WHERE other.base_slug=eligible.base_slug)>1
    THEN replace(entity_type,'_','-')||'-'||base_slug ELSE base_slug END,
  record_type,'published',1,datetime('now'),'migration-0043','migration-0043',datetime('now'),datetime('now')
FROM eligible;

-- Approved canonical media becomes a final/documentation material. Assets with
-- unknown, required, or denied consent remain internal and are not backfilled.
INSERT OR IGNORE INTO archive_materials
  (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at)
SELECT
  'archive-material-'||replace(em.entity_id,'/','-')||'-'||replace(em.media_id,'/','-')||'-'||replace(em.role,'/','-'),
  em.entity_id,em.media_id,em.role,
  CASE
    WHEN m.mime_type LIKE 'audio/%' THEN 'voice-memo'
    WHEN m.mime_type LIKE 'video/%' THEN 'video'
    WHEN m.mime_type='application/pdf' OR m.mime_type LIKE '%document%' OR m.mime_type LIKE '%word%' THEN 'document'
    ELSE 'final-image' END,
  COALESCE(NULLIF(m.public_title,''),NULLIF(em.alt_text_override,''),NULLIF(m.alt_text,''),m.original_filename),
  COALESCE(NULLIF(em.caption_override,''),m.caption),
  '',
  CASE WHEN em.role='primary' THEN 'final' ELSE 'documentation' END,
  'undated','', 'public','published',em.sort_order,'migration-0043','migration-0043',datetime('now'),datetime('now')
FROM entity_media em
JOIN archive_dossiers ad ON ad.entity_id=em.entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
JOIN media_assets m ON m.id=em.media_id
WHERE em.public_visible=1 AND m.state='active' AND m.privacy='public'
  AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline';

-- Merge the useful legacy Marbles source narrative into the canonical painting
-- dossier and retire the competing standalone archive identity.
UPDATE archive_dossiers
SET
  archive_slug='lostmarbles',
  orientation=COALESCE((SELECT summary FROM archive_records WHERE id='marbles-source-thread'),orientation),
  story=trim(COALESCE((SELECT body FROM archive_records WHERE id='marbles-source-thread'),'')||char(10)||char(10)||COALESCE((SELECT why_it_matters FROM archive_records WHERE id='marbles-source-thread'),'')),
  empty_materials_note='No process materials are public yet. This record will deepen as reviewed source material is released.',
  record_type='artwork',state='published',public_visible=1,featured=1,
  published_at=COALESCE(published_at,datetime('now')),updated_by='migration-0043',updated_at=datetime('now')
WHERE entity_id='art-marbles';

UPDATE archive_records SET state='archived',record_status='merged into art-marbles',updated_at=datetime('now')
WHERE id='marbles-source-thread';
UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=COALESCE(archived_at,datetime('now')),updated_by='migration-0043',updated_at=datetime('now')
WHERE id='marbles-source-thread';
UPDATE entity_relationships SET public_visible=0,updated_at=datetime('now')
WHERE source_entity_id='marbles-source-thread' OR target_entity_id='marbles-source-thread';
DELETE FROM search_documents WHERE entity_id='marbles-source-thread';

INSERT OR IGNORE INTO archive_dossier_subjects
  (dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at)
VALUES
  ('art-marbles','node-art','medium',1,1,datetime('now')),
  ('art-marbles','org-thoughtpuppet','brand',1,2,datetime('now')),
  ('art-marbles','person-saiel-dauhn-solehman','founder and artist',1,3,datetime('now')),
  ('art-marbles','org-six-well-construct','construct',1,4,datetime('now')),
  ('merch-lostmarbles-hoodie','node-merch','medium',1,1,datetime('now')),
  ('merch-lostmarbles-hoodie','org-thoughtpuppet','brand',1,2,datetime('now')),
  ('merch-lostmarbles-hoodie','person-saiel-dauhn-solehman','founder and artist',1,3,datetime('now')),
  ('merch-lostmarbles-hoodie','org-six-well-construct','construct',1,4,datetime('now'));

INSERT OR IGNORE INTO archive_facets
  (id,kind,name,slug,sort_order,created_at,updated_at)
VALUES
  ('archive-facet-medium-art','medium','Art','art',1,datetime('now'),datetime('now')),
  ('archive-facet-medium-merch','medium','Merch','merch',2,datetime('now'),datetime('now')),
  ('archive-facet-medium-tattoo','medium','Tattoo','tattoo',3,datetime('now'),datetime('now')),
  ('archive-facet-medium-events','medium','Events','events',4,datetime('now'),datetime('now')),
  ('archive-facet-medium-symbols','medium','Symbols','symbols',5,datetime('now'),datetime('now')),
  ('archive-facet-brand-thoughtpuppet','brand','Thoughtpuppet','thoughtpuppet',1,datetime('now'),datetime('now')),
  ('archive-facet-person-saiel-dauhn-solehman','person','Saiel Dauhn Solehman','saiel-dauhn-solehman',1,datetime('now'),datetime('now')),
  ('archive-facet-era-2020s','era','2020s','2020s',1,datetime('now'),datetime('now')),
  ('archive-facet-record-artwork','record_type','Artwork','artwork',1,datetime('now'),datetime('now')),
  ('archive-facet-record-merchandise','record_type','Merchandise','merchandise',2,datetime('now'),datetime('now')),
  ('archive-facet-record-tattoo','record_type','Tattoo','tattoo',3,datetime('now'),datetime('now')),
  ('archive-facet-record-flash','record_type','Flash','flash',4,datetime('now'),datetime('now')),
  ('archive-facet-record-event','record_type','Event','event',5,datetime('now'),datetime('now')),
  ('archive-facet-record-symbol','record_type','Symbol','symbol',6,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_dossier_facets(dossier_entity_id,facet_id,created_at)
SELECT id,
  CASE entity_type
    WHEN 'art_work' THEN 'archive-facet-medium-art'
    WHEN 'merch_item' THEN 'archive-facet-medium-merch'
    WHEN 'portfolio_item' THEN 'archive-facet-medium-tattoo'
    WHEN 'flash_item' THEN 'archive-facet-medium-tattoo'
    WHEN 'event' THEN 'archive-facet-medium-events'
    WHEN 'visual_symbol' THEN 'archive-facet-medium-symbols' END,
  datetime('now')
FROM content_entities
WHERE id IN (SELECT entity_id FROM archive_dossiers);

INSERT OR IGNORE INTO archive_dossier_facets(dossier_entity_id,facet_id,created_at)
SELECT entity_id,
  CASE record_type
    WHEN 'artwork' THEN 'archive-facet-record-artwork'
    WHEN 'merchandise' THEN 'archive-facet-record-merchandise'
    WHEN 'tattoo' THEN 'archive-facet-record-tattoo'
    WHEN 'flash' THEN 'archive-facet-record-flash'
    WHEN 'event' THEN 'archive-facet-record-event'
    WHEN 'symbol' THEN 'archive-facet-record-symbol' END,
  datetime('now')
FROM archive_dossiers;

INSERT OR IGNORE INTO archive_dossier_facets(dossier_entity_id,facet_id,created_at) VALUES
  ('art-marbles','archive-facet-brand-thoughtpuppet',datetime('now')),
  ('art-marbles','archive-facet-person-saiel-dauhn-solehman',datetime('now')),
  ('art-marbles','archive-facet-era-2020s',datetime('now')),
  ('merch-lostmarbles-hoodie','archive-facet-brand-thoughtpuppet',datetime('now')),
  ('merch-lostmarbles-hoodie','archive-facet-person-saiel-dauhn-solehman',datetime('now'));

INSERT OR IGNORE INTO archive_timelines
  (id,subject_entity_id,slug,title,description,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-timeline-art','node-art','art','Art','Works, process, and connected events across the Art medium.','published',1,1,'migration-0043','migration-0043',datetime('now'),datetime('now')),
  ('archive-timeline-thoughtpuppet','org-thoughtpuppet','thoughtpuppet','Thoughtpuppet','Works and derivatives connected to Thoughtpuppet.','published',1,2,'migration-0043','migration-0043',datetime('now'),datetime('now')),
  ('archive-timeline-saiel-dauhn-solehman','person-saiel-dauhn-solehman','saiel-dauhn-solehman','Saiel Dauhn Solehman','A public timeline of the founder and artist through documented work.','published',1,3,'migration-0043','migration-0043',datetime('now'),datetime('now')),
  ('archive-timeline-six-well-construct','org-six-well-construct','six-well-construct','The Six.Well Construct','A public timeline of the entire connected Construct.','published',1,4,'migration-0043','migration-0043',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO entity_activity
  (id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
VALUES
  ('activity-art-marbles-2023','art-marbles','documented-work','AM I LOSING MY MARBLES OR HIDING THEM?','The canonical work is documented as a 2023 acrylic painting on wood panel.','2023-01-01',NULL,NULL,1,1,'migration-0043',datetime('now'),datetime('now'),'The Lost Marbles painting enters the public record.','', 'year','2023','Canonical artwork metadata.'),
  ('activity-merch-lostmarbles-hoodie-undated','merch-lostmarbles-hoodie','derivative','LOST MARBLES. Hoodie','The hoodie is publicly documented as a derivative of the Lost Marbles painting.',NULL,NULL,NULL,1,2,'migration-0043',datetime('now'),datetime('now'),'A cross-medium derivative extends the painting into apparel.','', 'undated','Date not yet verified','Canonical relationship and merchandise metadata.');

INSERT OR IGNORE INTO entity_activity_subjects
  (activity_id,subject_entity_id,public_visible,sort_order,created_at)
VALUES
  ('activity-art-marbles-2023','node-art',1,1,datetime('now')),
  ('activity-art-marbles-2023','org-thoughtpuppet',1,2,datetime('now')),
  ('activity-art-marbles-2023','person-saiel-dauhn-solehman',1,3,datetime('now')),
  ('activity-art-marbles-2023','org-six-well-construct',1,4,datetime('now')),
  ('activity-merch-lostmarbles-hoodie-undated','org-thoughtpuppet',1,1,datetime('now')),
  ('activity-merch-lostmarbles-hoodie-undated','person-saiel-dauhn-solehman',1,2,datetime('now')),
  ('activity-merch-lostmarbles-hoodie-undated','org-six-well-construct',1,3,datetime('now'));

INSERT OR IGNORE INTO archive_timeline_chapters
  (id,timeline_id,title,summary,body,occurred_at,ended_at,date_precision,date_label,anchor_slug,dedupe_key,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-chapter-construct-lost-marbles','archive-timeline-six-well-construct','Lost Marbles moves across mediums','The 2023 painting later becomes the source for a documented apparel derivative.','This chapter follows only the public canonical relationship; dates that have not been verified remain undated.','2023-01-01',NULL,'year','2023 onward','lost-marbles-across-mediums','lost-marbles-lineage','published',1,1,'migration-0043','migration-0043',datetime('now'),datetime('now'));

-- Initial fragment index. Every statement repeats the complete public matrix so
-- a stale row cannot make private, unlisted, denied-consent, or detached content searchable.
INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-dossier-'||ad.entity_id,ad.entity_id,'dossier',ad.entity_id,
  COALESCE(sd.title,ad.archive_slug),trim(ad.orientation||' '||ad.story),'overview',1,datetime('now')
FROM archive_dossiers ad
JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
LEFT JOIN search_documents sd ON sd.entity_id=ad.entity_id
WHERE ad.state='published' AND ad.public_visible=1;

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-material-'||am.id,am.dossier_entity_id,'material',am.id,am.title,
  trim(am.caption||' '||am.body||' '||CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END),
  'material-'||am.id,1,datetime('now')
FROM archive_materials am
JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
LEFT JOIN media_assets m ON m.id=am.media_id
WHERE am.state='published' AND am.visibility='public'
  AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'));

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-activity-'||ea.id,ea.entity_id,'activity',ea.id,ea.title,
  trim(ea.summary||' '||ea.body||' '||ea.notes||' '||ea.date_label),'history-'||ea.id,1,datetime('now')
FROM entity_activity ea
JOIN archive_dossiers ad ON ad.entity_id=ea.entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities ce ON ce.id=ea.entity_id AND ce.visibility='public'
WHERE ea.public_visible=1;

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-activity-subject-'||eas.activity_id||'-'||eas.subject_entity_id,
  ea.entity_id,'activity-subject',eas.activity_id||':'||eas.subject_entity_id,
  COALESCE(o.name,p.name,n.name,pl.name,eas.subject_entity_id),ea.title,'history-'||ea.id,1,datetime('now')
FROM entity_activity_subjects eas
JOIN entity_activity ea ON ea.id=eas.activity_id AND ea.public_visible=1
JOIN archive_dossiers ad ON ad.entity_id=ea.entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities owner ON owner.id=ad.entity_id AND owner.visibility='public'
JOIN content_entities subject ON subject.id=eas.subject_entity_id AND subject.visibility='public'
LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
WHERE eas.public_visible=1
  AND (subject.entity_type<>'organization' OR o.id IS NOT NULL)
  AND (subject.entity_type<>'person' OR p.id IS NOT NULL)
  AND (subject.entity_type<>'construct_node' OR n.id IS NOT NULL)
  AND (subject.entity_type<>'place' OR pl.id IS NOT NULL);

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-subject-'||ads.dossier_entity_id||'-'||ads.subject_entity_id||'-'||replace(ads.role,' ','-'),
  ads.dossier_entity_id,'subject',ads.subject_entity_id||':'||ads.role,
  COALESCE(o.name,p.name,n.name,ads.subject_entity_id),ads.role,'subjects',1,datetime('now')
FROM archive_dossier_subjects ads
JOIN archive_dossiers ad ON ad.entity_id=ads.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities owner ON owner.id=ad.entity_id AND owner.visibility='public'
JOIN content_entities subject ON subject.id=ads.subject_entity_id AND subject.visibility='public'
LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
WHERE ads.public_visible=1;

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-relationship-source-'||er.id,er.source_entity_id,'relationship',er.id,rt.forward_label,
  COALESCE(sd.title,er.target_entity_id),'relationships',1,datetime('now')
FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id AND rt.public_visible=1
JOIN archive_dossiers ad ON ad.entity_id=er.source_entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities source ON source.id=er.source_entity_id AND source.visibility='public'
JOIN content_entities target ON target.id=er.target_entity_id AND target.visibility='public'
LEFT JOIN search_documents sd ON sd.entity_id=er.target_entity_id
WHERE er.public_visible=1;

INSERT OR REPLACE INTO archive_search_fragments
  (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
SELECT 'archive-fragment-relationship-target-'||er.id,er.target_entity_id,'relationship',er.id,rt.reverse_label,
  COALESCE(sd.title,er.source_entity_id),'relationships',1,datetime('now')
FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id AND rt.public_visible=1
JOIN archive_dossiers ad ON ad.entity_id=er.target_entity_id AND ad.state='published' AND ad.public_visible=1
JOIN content_entities source ON source.id=er.source_entity_id AND source.visibility='public'
JOIN content_entities target ON target.id=er.target_entity_id AND target.visibility='public'
LEFT JOIN search_documents sd ON sd.entity_id=er.source_entity_id
WHERE er.public_visible=1;

-- Automatic shell reconciliation. When a subtype row already exists (the
-- normal event/portfolio flow), the trigger uses its canonical slug. Studio
-- create/update also refines fallback IDs in the same publication batch.
CREATE TRIGGER IF NOT EXISTS archive_shell_content_entity_insert
AFTER INSERT ON content_entities
WHEN NEW.visibility='public' AND NEW.entity_type IN ('art_work','merch_item','portfolio_item','flash_item','event','visual_symbol','writing_work','film_work','music_work')
BEGIN
  INSERT OR IGNORE INTO archive_dossiers
    (entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
  SELECT NEW.id,
    CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=COALESCE(
      (SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),
      (SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),
      (SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) AND other.entity_id<>NEW.id)
    THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id)
    ELSE COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) END,
    replace(NEW.entity_type,'_','-'),'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

CREATE TRIGGER IF NOT EXISTS archive_shell_content_entity_publish
AFTER UPDATE OF visibility ON content_entities
WHEN NEW.visibility='public' AND NEW.entity_type IN ('art_work','merch_item','portfolio_item','flash_item','event','visual_symbol','writing_work','film_work','music_work')
BEGIN
  INSERT OR IGNORE INTO archive_dossiers
    (entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
  SELECT NEW.id,
    CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=COALESCE(
      (SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),
      (SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),
      (SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) AND other.entity_id<>NEW.id)
    THEN replace(NEW.entity_type,'_','-')||'-'||COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id)
    ELSE COALESCE((SELECT slug FROM art_works WHERE id=NEW.id),(SELECT shopify_handle FROM merch_items WHERE id=NEW.id),(SELECT slug FROM flash_items WHERE id=NEW.id),(SELECT slug FROM events WHERE id=NEW.id),(SELECT slug FROM visual_symbols WHERE id=NEW.id),NEW.id) END,
    replace(NEW.entity_type,'_','-'),'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

-- Privacy revocation is immediate even before an application-level reindex.
CREATE TRIGGER IF NOT EXISTS archive_material_privacy_delete
AFTER DELETE ON archive_materials BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='material' AND source_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_material_privacy_update
AFTER UPDATE ON archive_materials BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='material' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||NEW.id,NEW.dossier_entity_id,'material',NEW.id,NEW.title,
    trim(NEW.caption||' '||NEW.body||' '||CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END),
    'material-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN media_assets m ON m.id=NEW.media_id
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND ce.visibility='public' AND NEW.state='published' AND NEW.visibility='public'
    AND (NEW.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'));
END;

CREATE TRIGGER IF NOT EXISTS archive_material_privacy_insert
AFTER INSERT ON archive_materials BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||NEW.id,NEW.dossier_entity_id,'material',NEW.id,NEW.title,
    trim(NEW.caption||' '||NEW.body||' '||CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END),
    'material-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN media_assets m ON m.id=NEW.media_id
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND ce.visibility='public' AND NEW.state='published' AND NEW.visibility='public'
    AND (NEW.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'));
END;

CREATE TRIGGER IF NOT EXISTS archive_media_privacy_update
AFTER UPDATE OF state,privacy,consent_status,transcript,transcript_status,public_presentation ON media_assets BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='material' AND source_id IN (SELECT id FROM archive_materials WHERE media_id=NEW.id);
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||am.id,am.dossier_entity_id,'material',am.id,am.title,
    trim(am.caption||' '||am.body||' '||CASE WHEN NEW.transcript_status='ready' THEN NEW.transcript ELSE '' END),
    'material-'||am.id,1,datetime('now')
  FROM archive_materials am
  JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE am.media_id=NEW.id AND am.state='published' AND am.visibility='public'
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND NEW.state='active' AND NEW.privacy='public' AND NEW.consent_status IN ('not-required','granted') AND NEW.public_presentation='inline';
END;

CREATE TRIGGER IF NOT EXISTS archive_dossier_fragment_insert
AFTER INSERT ON archive_dossiers BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-dossier-'||NEW.entity_id,NEW.entity_id,'dossier',NEW.entity_id,
    COALESCE(sd.title,NEW.archive_slug),trim(NEW.orientation||' '||NEW.story),'overview',1,datetime('now')
  FROM content_entities ce LEFT JOIN search_documents sd ON sd.entity_id=ce.id
  WHERE ce.id=NEW.entity_id AND ce.visibility='public' AND NEW.state='published' AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_dossier_fragment_update
AFTER UPDATE OF orientation,story,state,public_visible,archive_slug ON archive_dossiers BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=NEW.entity_id AND fragment_type='dossier';
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-dossier-'||NEW.entity_id,NEW.entity_id,'dossier',NEW.entity_id,
    COALESCE(sd.title,NEW.archive_slug),trim(NEW.orientation||' '||NEW.story),'overview',1,datetime('now')
  FROM content_entities ce LEFT JOIN search_documents sd ON sd.entity_id=ce.id
  WHERE ce.id=NEW.entity_id AND ce.visibility='public' AND NEW.state='published' AND NEW.public_visible=1;
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=NEW.entity_id AND (NEW.state<>'published' OR NEW.public_visible=0);
  -- Rebuild every eligible child fragment when a dossier returns to public.
  -- Same-value updates intentionally invoke the child tables' privacy-aware triggers.
  UPDATE archive_materials SET updated_at=updated_at
    WHERE dossier_entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  UPDATE entity_activity SET updated_at=updated_at
    WHERE entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  UPDATE archive_dossier_subjects SET public_visible=public_visible
    WHERE dossier_entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  UPDATE archive_dossier_collections SET sort_order=sort_order
    WHERE dossier_entity_id=NEW.entity_id AND NEW.state='published' AND NEW.public_visible=1;
  UPDATE entity_relationships SET updated_at=updated_at
    WHERE (source_entity_id=NEW.entity_id OR target_entity_id=NEW.entity_id)
      AND NEW.state='published' AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_entity_unpublish_fragments
AFTER UPDATE OF visibility ON content_entities
WHEN NEW.visibility<>'public' BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_entity_republish_fragments
AFTER UPDATE OF visibility ON content_entities
WHEN NEW.visibility='public' BEGIN
  -- The shell trigger creates a missing dossier; an existing dossier is touched
  -- so its dossier and child fragments are restored in the same transaction.
  UPDATE archive_dossiers SET public_visible=public_visible WHERE entity_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_fragment_insert
AFTER INSERT ON entity_activity BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-'||NEW.id,NEW.entity_id,'activity',NEW.id,NEW.title,
    trim(NEW.summary||' '||NEW.body||' '||NEW.notes||' '||NEW.date_label),'history-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_fragment_update
AFTER UPDATE ON entity_activity BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='activity' AND source_id=OLD.id;
  DELETE FROM archive_search_fragments WHERE fragment_type='activity-subject' AND source_id LIKE OLD.id||':%';
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-'||NEW.id,NEW.entity_id,'activity',NEW.id,NEW.title,
    trim(NEW.summary||' '||NEW.body||' '||NEW.notes||' '||NEW.date_label),'history-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND NEW.public_visible=1;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-subject-'||eas.activity_id||'-'||eas.subject_entity_id,NEW.entity_id,'activity-subject',eas.activity_id||':'||eas.subject_entity_id,
    COALESCE(o.name,p.name,n.name,pl.name,eas.subject_entity_id),NEW.title,'history-'||NEW.id,1,datetime('now')
  FROM entity_activity_subjects eas
  JOIN archive_dossiers ad ON ad.entity_id=NEW.entity_id
  JOIN content_entities owner ON owner.id=ad.entity_id
  JOIN content_entities subject ON subject.id=eas.subject_entity_id AND subject.visibility='public'
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE eas.activity_id=NEW.id AND eas.public_visible=1 AND NEW.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND owner.visibility='public'
    AND (subject.entity_type<>'organization' OR o.id IS NOT NULL)
    AND (subject.entity_type<>'person' OR p.id IS NOT NULL)
    AND (subject.entity_type<>'construct_node' OR n.id IS NOT NULL)
    AND (subject.entity_type<>'place' OR pl.id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_fragment_delete
AFTER DELETE ON entity_activity BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type IN ('activity','activity-subject') AND (source_id=OLD.id OR source_id LIKE OLD.id||':%');
END;

CREATE TRIGGER IF NOT EXISTS archive_subject_fragment_insert
AFTER INSERT ON archive_dossier_subjects BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-subject-'||NEW.dossier_entity_id||'-'||NEW.subject_entity_id||'-'||replace(NEW.role,' ','-'),NEW.dossier_entity_id,'subject',NEW.subject_entity_id||':'||NEW.role,
    COALESCE(o.name,p.name,n.name,pl.name,subject.id),NEW.role,'subjects',1,datetime('now')
  FROM archive_dossiers ad JOIN content_entities owner ON owner.id=ad.entity_id
  JOIN content_entities subject ON subject.id=NEW.subject_entity_id
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND owner.visibility='public' AND subject.visibility='public' AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_subject_fragment_update
AFTER UPDATE ON archive_dossier_subjects BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='subject' AND source_id=OLD.subject_entity_id||':'||OLD.role;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-subject-'||NEW.dossier_entity_id||'-'||NEW.subject_entity_id||'-'||replace(NEW.role,' ','-'),NEW.dossier_entity_id,'subject',NEW.subject_entity_id||':'||NEW.role,
    COALESCE(o.name,p.name,n.name,pl.name,subject.id),NEW.role,'subjects',1,datetime('now')
  FROM archive_dossiers ad JOIN content_entities owner ON owner.id=ad.entity_id
  JOIN content_entities subject ON subject.id=NEW.subject_entity_id
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND owner.visibility='public' AND subject.visibility='public' AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_subject_fragment_delete
AFTER DELETE ON archive_dossier_subjects BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='subject' AND source_id=OLD.subject_entity_id||':'||OLD.role;
END;

CREATE TRIGGER IF NOT EXISTS archive_collection_fragment_insert
AFTER INSERT ON archive_dossier_collections BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-collection-'||NEW.dossier_entity_id||'-'||NEW.collection_id,NEW.dossier_entity_id,'collection',NEW.collection_id,ac.name,ac.description,'collections',1,datetime('now')
  FROM archive_collections ac JOIN archive_dossiers ad ON ad.entity_id=NEW.dossier_entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ac.id=NEW.collection_id AND ac.state='published' AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_collection_fragment_update
AFTER UPDATE ON archive_dossier_collections BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='collection' AND source_id=OLD.collection_id;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-collection-'||NEW.dossier_entity_id||'-'||NEW.collection_id,NEW.dossier_entity_id,'collection',NEW.collection_id,ac.name,ac.description,'collections',1,datetime('now')
  FROM archive_collections ac JOIN archive_dossiers ad ON ad.entity_id=NEW.dossier_entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ac.id=NEW.collection_id AND ac.state='published' AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public';
END;

CREATE TRIGGER IF NOT EXISTS archive_collection_fragment_delete
AFTER DELETE ON archive_dossier_collections BEGIN
  DELETE FROM archive_search_fragments WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='collection' AND source_id=OLD.collection_id;
END;

CREATE TRIGGER IF NOT EXISTS archive_relationship_fragment_insert
AFTER INSERT ON entity_relationships
WHEN NEW.public_visible=1 BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-relationship-source-'||NEW.id,NEW.source_entity_id,'relationship',NEW.id,rt.forward_label,
    COALESCE(sd.title,NEW.target_entity_id),'relationships',1,datetime('now')
  FROM relationship_types rt JOIN archive_dossiers ad ON ad.entity_id=NEW.source_entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN search_documents sd ON sd.entity_id=NEW.target_entity_id
  WHERE rt.id=NEW.relationship_type_id AND rt.public_visible=1 AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND EXISTS(SELECT 1 FROM content_entities target WHERE target.id=NEW.target_entity_id AND target.visibility='public');
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-relationship-target-'||NEW.id,NEW.target_entity_id,'relationship',NEW.id,rt.reverse_label,
    COALESCE(sd.title,NEW.source_entity_id),'relationships',1,datetime('now')
  FROM relationship_types rt JOIN archive_dossiers ad ON ad.entity_id=NEW.target_entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN search_documents sd ON sd.entity_id=NEW.source_entity_id
  WHERE rt.id=NEW.relationship_type_id AND rt.public_visible=1 AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND EXISTS(SELECT 1 FROM content_entities source WHERE source.id=NEW.source_entity_id AND source.visibility='public');
END;

CREATE TRIGGER IF NOT EXISTS archive_relationship_fragment_update
AFTER UPDATE ON entity_relationships BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='relationship' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-relationship-source-'||NEW.id,NEW.source_entity_id,'relationship',NEW.id,rt.forward_label,COALESCE(sd.title,NEW.target_entity_id),'relationships',1,datetime('now')
  FROM relationship_types rt JOIN archive_dossiers ad ON ad.entity_id=NEW.source_entity_id JOIN content_entities ce ON ce.id=ad.entity_id LEFT JOIN search_documents sd ON sd.entity_id=NEW.target_entity_id
  WHERE NEW.public_visible=1 AND rt.id=NEW.relationship_type_id AND rt.public_visible=1 AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND EXISTS(SELECT 1 FROM content_entities target WHERE target.id=NEW.target_entity_id AND target.visibility='public');
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-relationship-target-'||NEW.id,NEW.target_entity_id,'relationship',NEW.id,rt.reverse_label,COALESCE(sd.title,NEW.source_entity_id),'relationships',1,datetime('now')
  FROM relationship_types rt JOIN archive_dossiers ad ON ad.entity_id=NEW.target_entity_id JOIN content_entities ce ON ce.id=ad.entity_id LEFT JOIN search_documents sd ON sd.entity_id=NEW.source_entity_id
  WHERE NEW.public_visible=1 AND rt.id=NEW.relationship_type_id AND rt.public_visible=1 AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND EXISTS(SELECT 1 FROM content_entities source WHERE source.id=NEW.source_entity_id AND source.visibility='public');
END;

CREATE TRIGGER IF NOT EXISTS archive_relationship_fragment_delete
AFTER DELETE ON entity_relationships BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='relationship' AND source_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS archive_relationship_type_fragment_update
AFTER UPDATE OF forward_label,reverse_label,public_visible ON relationship_types BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='relationship' AND source_id IN (SELECT id FROM entity_relationships WHERE relationship_type_id=NEW.id) AND NEW.public_visible=0;
  UPDATE archive_search_fragments SET label=CASE
    WHEN dossier_entity_id=(SELECT source_entity_id FROM entity_relationships WHERE id=archive_search_fragments.source_id) THEN NEW.forward_label
    ELSE NEW.reverse_label END,updated_at=datetime('now')
  WHERE fragment_type='relationship' AND source_id IN (SELECT id FROM entity_relationships WHERE relationship_type_id=NEW.id) AND NEW.public_visible=1;
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_subject_fragment_insert
AFTER INSERT ON entity_activity_subjects
WHEN NEW.public_visible=1 BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-subject-'||NEW.activity_id||'-'||NEW.subject_entity_id,ea.entity_id,'activity-subject',NEW.activity_id||':'||NEW.subject_entity_id,
    COALESCE(o.name,p.name,n.name,pl.name,NEW.subject_entity_id),ea.title,'history-'||ea.id,1,datetime('now')
  FROM entity_activity ea JOIN archive_dossiers ad ON ad.entity_id=ea.entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN content_entities subject ON subject.id=NEW.subject_entity_id AND subject.visibility='public'
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE ea.id=NEW.activity_id AND ea.public_visible=1 AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND (subject.entity_type<>'organization' OR o.id IS NOT NULL)
    AND (subject.entity_type<>'person' OR p.id IS NOT NULL)
    AND (subject.entity_type<>'construct_node' OR n.id IS NOT NULL)
    AND (subject.entity_type<>'place' OR pl.id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_subject_fragment_update
AFTER UPDATE ON entity_activity_subjects BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='activity-subject' AND source_id=OLD.activity_id||':'||OLD.subject_entity_id;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-subject-'||NEW.activity_id||'-'||NEW.subject_entity_id,ea.entity_id,'activity-subject',NEW.activity_id||':'||NEW.subject_entity_id,
    COALESCE(o.name,p.name,n.name,pl.name,NEW.subject_entity_id),ea.title,'history-'||ea.id,1,datetime('now')
  FROM entity_activity ea JOIN archive_dossiers ad ON ad.entity_id=ea.entity_id JOIN content_entities ce ON ce.id=ad.entity_id
  JOIN content_entities subject ON subject.id=NEW.subject_entity_id AND subject.visibility='public'
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE NEW.public_visible=1 AND ea.id=NEW.activity_id AND ea.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND (subject.entity_type<>'organization' OR o.id IS NOT NULL)
    AND (subject.entity_type<>'person' OR p.id IS NOT NULL)
    AND (subject.entity_type<>'construct_node' OR n.id IS NOT NULL)
    AND (subject.entity_type<>'place' OR pl.id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS archive_activity_subject_fragment_delete
AFTER DELETE ON entity_activity_subjects BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='activity-subject' AND source_id=OLD.activity_id||':'||OLD.subject_entity_id;
END;
