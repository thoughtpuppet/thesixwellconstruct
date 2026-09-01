-- Reconcile the Gallery with public, original process and studio media already
-- owned by Archive records. Portfolio finals, external references, operational
-- files, technical derivatives, and unpublished Blackboard source fragments
-- remain managed files but do not receive MED identities.

CREATE TABLE IF NOT EXISTS media_gallery_reconciliation_0216 (
  media_id TEXT PRIMARY KEY,
  display_media_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  accessibility_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated',
  date_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK(decision IN ('admitted','excluded','deferred')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(display_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

-- Public Archive process, studio, sketch, notebook, and primary cultural-object
-- materials qualify. If the public material is a derivative, its protected
-- master owns the MED identity while the derivative remains the display file.
INSERT OR IGNORE INTO media_gallery_reconciliation_0216
  (media_id,display_media_id,source_entity_id,source_kind,title,accessibility_text,caption,
   occurred_at,date_precision,date_label,sort_order,decision,reason,created_at)
SELECT COALESCE(variant.master_media_id,material.media_id),material.media_id,material.dossier_entity_id,
  'archive_material',COALESCE(NULLIF(trim(material.title),''),NULLIF(trim(media.public_title),''),media.original_filename),
  COALESCE(NULLIF(trim(media.alt_text),''),NULLIF(trim(material.title),'')),material.caption,
  material.occurred_at,material.date_precision,material.date_label,material.sort_order,'admitted',
  'Published original process, studio, sketch, notebook, or primary Archive material',datetime('now')
FROM archive_materials material
JOIN media_assets media ON media.id=material.media_id AND media.state='active'
JOIN content_entities material_owner ON material_owner.id=material.dossier_entity_id
LEFT JOIN media_asset_variants variant ON variant.derivative_media_id=material.media_id AND variant.purpose='public-display'
WHERE material.state='published' AND material.visibility='public'
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/flash/%'
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/paintings/%'
  AND lower(replace(media.storage_key,'\','/')) NOT LIKE 'portfolio/%'
  AND (
    material.material_type IN ('process-photo','note','voice-memo','video')
    OR material.role IN ('notebook','documentation','primary-documentation','process-photo','process-video','blackboard-whole')
    OR (material.role='primary' AND material_owner.entity_type IN ('archive_record','archive_blackboard'))
  )
  AND material.role NOT IN ('final-image','canonical','portfolio','gallery','cover','hero','thumbnail');

-- Public inline images in a published Journal or Note are authored Gallery
-- material. Source-provenance documents remain private evidence.
INSERT OR IGNORE INTO media_gallery_reconciliation_0216
  (media_id,display_media_id,source_entity_id,source_kind,title,accessibility_text,caption,
   occurred_at,date_precision,date_label,sort_order,decision,reason,created_at)
SELECT COALESCE(variant.master_media_id,asset.media_id),asset.media_id,note.entity_id,'archive_note',
  COALESCE(NULLIF(trim(asset.caption_override),''),NULLIF(trim(note.title),''),media.original_filename),
  asset.alt_text_override,asset.caption_override,note.source_created_at,
  CASE WHEN note.source_created_at IS NULL THEN 'undated' ELSE 'exact' END,note.date_label,
  asset.sort_order,'admitted','Public original image in a published Archive Note or Journal',datetime('now')
FROM archive_note_assets asset
JOIN archive_notes note ON note.entity_id=asset.note_entity_id AND note.state='published' AND note.public_visible=1
JOIN media_assets media ON media.id=asset.media_id AND media.state='active'
LEFT JOIN media_asset_variants variant ON variant.derivative_media_id=asset.media_id AND variant.purpose='public-display'
WHERE asset.public_visible=1 AND asset.role='inline-image'
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/flash/%'
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/paintings/%'
  AND lower(replace(media.storage_key,'\','/')) NOT LIKE 'portfolio/%';

-- Archive-native render/documentation attachments qualify when their owner and
-- attachment are public. Portfolio and final-render roles remain outside Gallery.
INSERT OR IGNORE INTO media_gallery_reconciliation_0216
  (media_id,display_media_id,source_entity_id,source_kind,title,accessibility_text,caption,
   occurred_at,date_precision,date_label,sort_order,decision,reason,created_at)
SELECT COALESCE(variant.master_media_id,attachment.media_id),attachment.media_id,owner.id,'entity_media',
  COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),
  COALESCE(NULLIF(trim(attachment.alt_text_override),''),NULLIF(trim(media.alt_text),'')),
  COALESCE(NULLIF(trim(attachment.caption_override),''),media.caption),NULL,'undated','',attachment.sort_order,
  'admitted','Public original documentation attached to an Archive-native record',datetime('now')
FROM entity_media attachment
JOIN content_entities owner ON owner.id=attachment.entity_id AND owner.visibility='public'
JOIN media_assets media ON media.id=attachment.media_id AND media.state='active'
LEFT JOIN media_asset_variants variant ON variant.derivative_media_id=attachment.media_id AND variant.purpose='public-display'
WHERE attachment.public_visible=1
  AND owner.entity_type IN ('archive_record','archive_blackboard','archive_failed_experiment','archive_origin_thread','archive_note')
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/flash/%'
  AND lower(replace(media.source_url,'\','/')) NOT LIKE '/assets/paintings/%'
  AND lower(replace(media.storage_key,'\','/')) NOT LIKE 'portfolio/%'
  AND lower(attachment.role) NOT IN ('final-image','canonical','portfolio','gallery','cover','hero','thumbnail');

-- Published Blackboard fragments are specialized Archive media and do not use
-- archive_materials. Their private source/master owns the MED; the current
-- public edit is the display file. Alpha/hotspot masks are never candidates.
INSERT OR IGNORE INTO media_gallery_reconciliation_0216
  (media_id,display_media_id,source_entity_id,source_kind,title,accessibility_text,caption,
   occurred_at,date_precision,date_label,sort_order,decision,reason,created_at)
SELECT COALESCE(fragment.master_media_id,fragment.edit_source_media_id,fragment.derivative_media_id),
  fragment.derivative_media_id,fragment.record_entity_id,'blackboard_fragment',fragment.title,
  fragment.title,fragment.caption,fragment.occurred_at,fragment.date_precision,fragment.date_label,
  fragment.sort_order,'admitted','Published original Blackboard fragment with a public display edit',datetime('now')
FROM archive_blackboard_fragments fragment
JOIN content_entities owner ON owner.id=fragment.record_entity_id AND owner.visibility='public'
JOIN media_assets display ON display.id=fragment.derivative_media_id AND display.state='active'
WHERE fragment.state='published' AND fragment.public_visible=1 AND fragment.derivative_media_id IS NOT NULL;

-- Do not admit a technical output even if a malformed legacy relation pointed
-- at it as the master identity.
DELETE FROM media_gallery_reconciliation_0216
WHERE media_id IN (
  SELECT derivative_media_id FROM media_asset_variants
  UNION SELECT alpha_mask_media_id FROM archive_blackboard_fragment_edits WHERE alpha_mask_media_id IS NOT NULL
  UNION SELECT hotspot_mask_media_id FROM archive_blackboard_fragment_placements WHERE hotspot_mask_media_id IS NOT NULL
);

-- Public parent records and their intentionally supplied public materials must
-- remain a coherent release. Reconcile the initial version/state shells that a
-- later catalogue migration left in draft beneath already-published dossiers.
UPDATE archive_object_versions
SET publication_state='published',public_visible=1,updated_by='migration-0216',updated_at=datetime('now')
WHERE entity_id IN (SELECT source_entity_id FROM media_gallery_reconciliation_0216 WHERE decision='admitted')
  AND EXISTS(SELECT 1 FROM archive_dossiers dossier WHERE dossier.entity_id=archive_object_versions.entity_id AND dossier.state='published' AND dossier.public_visible=1);

UPDATE archive_object_states
SET publication_state='published',public_visible=1,updated_by='migration-0216',updated_at=datetime('now')
WHERE version_id IN (
  SELECT version.id FROM archive_object_versions version
  JOIN archive_dossiers dossier ON dossier.entity_id=version.entity_id AND dossier.state='published' AND dossier.public_visible=1
  WHERE version.entity_id IN (SELECT source_entity_id FROM media_gallery_reconciliation_0216 WHERE decision='admitted')
);

-- The remaining legacy review queue is resolved, not silently left pending.
-- Private Blackboard fragments and otherwise ambiguous unlinked uploads are
-- deferred; known portfolio, site, derivative, reference, and operational files
-- are explicitly excluded.
INSERT OR REPLACE INTO media_archive_admission_reviews
  (media_id,prior_catalogue_id,prior_gallery_state,review_state,suggested_reason,reviewed_by,reviewed_at,created_at,updated_at)
SELECT review.media_id,review.prior_catalogue_id,review.prior_gallery_state,
  CASE
    WHEN admitted.media_id IS NOT NULL THEN 'admitted'
    WHEN lower(replace(media.storage_key,'\','/')) LIKE 'archive/blackboards/masters/%' THEN 'deferred'
    WHEN lower(replace(media.storage_key,'\','/')) LIKE 'construct/%'
      AND provenance.originality='unknown' AND provenance.asset_role='unclassified' THEN 'deferred'
    ELSE 'excluded'
  END,
  CASE
    WHEN admitted.media_id IS NOT NULL THEN admitted.reason
    WHEN lower(replace(media.storage_key,'\','/')) LIKE 'archive/blackboards/masters/%' THEN 'Private Blackboard source fragment; admit only when a public fragment or state uses it'
    WHEN lower(replace(media.storage_key,'\','/')) LIKE 'construct/%'
      AND provenance.originality='unknown' AND provenance.asset_role='unclassified' THEN 'Unlinked legacy upload; no reliable evidence for Gallery admission'
    ELSE 'Portfolio final, external reference, site asset, operational file, or technical derivative'
  END,
  'migration-0216',datetime('now'),review.created_at,datetime('now')
FROM media_archive_admission_reviews review
JOIN media_assets media ON media.id=review.media_id
LEFT JOIN media_asset_provenance provenance ON provenance.media_id=media.id
LEFT JOIN media_gallery_reconciliation_0216 admitted ON admitted.media_id=media.id
WHERE review.review_state='pending';

-- Candidates are original editorial fragments unless they are already more
-- specifically classified. Their raw technical evidence remains internal.
UPDATE media_asset_provenance
SET originality='sixwell_original',
    asset_role=CASE WHEN asset_role IN ('unclassified','site_asset','operational','reference') THEN 'editorial_fragment' ELSE asset_role END,
    creator_credit=COALESCE(NULLIF(creator_credit,''),'Six.Well'),updated_by='migration-0216',updated_at=datetime('now')
WHERE media_id IN (SELECT media_id FROM media_gallery_reconciliation_0216 WHERE decision='admitted');

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
SELECT 'media-catalogue-'||candidate.media_id,'media_asset',NULL,'internal',0,0,'',
  'migration-0216','migration-0216',datetime('now'),datetime('now')
FROM media_gallery_reconciliation_0216 candidate WHERE candidate.decision='admitted';

INSERT OR IGNORE INTO media_catalogue_entries
  (media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,
   created_by,updated_by,created_at,updated_at)
SELECT candidate.media_id,'media-catalogue-'||candidate.media_id,'creative',provenance.original_format,provenance.import_source,
  'active','record',candidate.source_entity_id,'migration-0216','migration-0216',datetime('now'),datetime('now')
FROM media_gallery_reconciliation_0216 candidate
JOIN media_asset_provenance provenance ON provenance.media_id=candidate.media_id
WHERE candidate.decision='admitted';

INSERT OR IGNORE INTO gallery_entries
  (media_id,display_media_id,title,accessibility_text,caption,credit,date_precision,date_label,occurred_at,
   state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
SELECT candidate.media_id,candidate.display_media_id,
  COALESCE(NULLIF(trim(candidate.title),''),NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),
  candidate.accessibility_text,candidate.caption,COALESCE(NULLIF(provenance.creator_credit,''),'Six.Well'),
  CASE candidate.date_precision WHEN 'exact' THEN 'exact' WHEN 'approximate' THEN 'approximate' WHEN 'year' THEN 'year' WHEN 'range' THEN 'range' ELSE 'undated' END,
  candidate.date_label,candidate.occurred_at,'published',datetime('now'),'record',candidate.source_entity_id,
  'migration-0216','migration-0216',datetime('now'),datetime('now')
FROM media_gallery_reconciliation_0216 candidate
JOIN media_assets media ON media.id=candidate.media_id
JOIN media_asset_provenance provenance ON provenance.media_id=candidate.media_id
WHERE candidate.decision='admitted';

UPDATE media_archive_admission_reviews
SET review_state='admitted',suggested_reason=(SELECT reason FROM media_gallery_reconciliation_0216 candidate WHERE candidate.media_id=media_archive_admission_reviews.media_id),
    reviewed_by='migration-0216',reviewed_at=datetime('now'),updated_at=datetime('now')
WHERE media_id IN (SELECT media_id FROM media_gallery_reconciliation_0216 WHERE decision='admitted');

INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
SELECT 'relationship-gallery-reconcile-'||candidate.media_id,'media-catalogue-'||candidate.media_id,candidate.source_entity_id,
  CASE WHEN candidate.source_kind IN ('archive_material','blackboard_fragment') THEN 'rel-process-of' ELSE 'rel-documents' END,
  1,'Reconciled from existing public Archive ownership.',candidate.sort_order,'migration-0216',datetime('now'),datetime('now')
FROM media_gallery_reconciliation_0216 candidate
WHERE candidate.decision='admitted'
  AND EXISTS(SELECT 1 FROM content_entities target WHERE target.id=candidate.source_entity_id AND target.visibility='public')
  AND NOT EXISTS(
    SELECT 1 FROM entity_relationships relation
    WHERE relation.source_entity_id='media-catalogue-'||candidate.media_id
      AND relation.target_entity_id=candidate.source_entity_id
  );

-- Rebuild only historically evidenced sets: existing multi-item records/notes
-- whose sequence is explicit in their material or attachment ordering.
INSERT OR IGNORE INTO gallery_sets
  (id,slug,title,summary,set_type,cover_media_id,date_precision,state,published_at,sort_order,created_by,updated_by,created_at,updated_at)
SELECT definition.id,definition.slug,definition.title,definition.summary,definition.set_type,
  (SELECT candidate.media_id FROM media_gallery_reconciliation_0216 candidate WHERE candidate.source_entity_id=definition.source_entity_id ORDER BY candidate.sort_order,candidate.media_id LIMIT 1),
  'undated','published',datetime('now'),definition.sort_order,'migration-0216','migration-0216',datetime('now'),datetime('now')
FROM (
  SELECT 'gallery-set-process-archive-frame' id,'process-archive-frame' slug,'Process Archive Frame' title,
    'Existing process images attached to the Process Archive Frame record.' summary,'series' set_type,'process-archive-frame' source_entity_id,20 sort_order
  UNION ALL SELECT 'gallery-set-making-the-canvas','making-the-canvas','Making the Canvas',
    'Shellacking and preparing the panels documented as one making sequence.','series','archive-practice-making-the-canvas',30
  UNION ALL SELECT 'gallery-set-goat-farm-studio-years','goat-farm-studio-years','Goat Farm Studio Years',
    'Ordered studio photographs preserved in the Goat Farm Archive record and source Journal.','session','archive-record-saiel-goat-farm-studio-years',40
  UNION ALL SELECT 'gallery-set-lost-marbles-process','lost-marbles-process-note','Lost Marbles — Process Note',
    'Original sketch and later process experiment from the Lost Marbles inception note.','series','archive-note-a9794a6b-2251-4756-8bf4-2705e04449ee',50
  UNION ALL SELECT 'gallery-set-inner-chaos-process','inner-chaos-process','The Frustrations of Inner Chaos — Process',
    'Notebook photograph and in-progress video attached to the work record.','series','art-inner-chaos',60
  UNION ALL SELECT 'gallery-set-blackboard-south-wall','blackboard-south-wall','Studio Blackboard — South Wall',
    'Published whole-board states, studio context, and fragments from the South Wall Blackboard.','session','archive-blackboard-cd3b218b-08df-4755-92cb-79fe615e360e',70
) definition
WHERE (SELECT COUNT(*) FROM media_gallery_reconciliation_0216 candidate WHERE candidate.source_entity_id=definition.source_entity_id)>=2;

INSERT OR IGNORE INTO gallery_set_items(set_id,media_id,sort_order,created_at)
SELECT set_record.id,candidate.media_id,
  ROW_NUMBER() OVER (PARTITION BY set_record.id ORDER BY candidate.sort_order,candidate.media_id),datetime('now')
FROM gallery_sets set_record
JOIN (
  SELECT 'gallery-set-process-archive-frame' set_id,'process-archive-frame' source_entity_id
  UNION ALL SELECT 'gallery-set-making-the-canvas','archive-practice-making-the-canvas'
  UNION ALL SELECT 'gallery-set-goat-farm-studio-years','archive-record-saiel-goat-farm-studio-years'
  UNION ALL SELECT 'gallery-set-lost-marbles-process','archive-note-a9794a6b-2251-4756-8bf4-2705e04449ee'
  UNION ALL SELECT 'gallery-set-inner-chaos-process','art-inner-chaos'
  UNION ALL SELECT 'gallery-set-blackboard-south-wall','archive-blackboard-cd3b218b-08df-4755-92cb-79fe615e360e'
) definition ON definition.set_id=set_record.id
JOIN media_gallery_reconciliation_0216 candidate ON candidate.source_entity_id=definition.source_entity_id
JOIN gallery_entries gallery ON gallery.media_id=candidate.media_id AND gallery.state='published';

-- Process and studio lenses are editorial aids, not admission requirements.
INSERT OR IGNORE INTO gallery_entry_lenses(media_id,lens_id,sort_order,created_at)
SELECT candidate.media_id,
  CASE WHEN candidate.source_entity_id='archive-record-saiel-goat-farm-studio-years' THEN 'gallery-lens-studio' ELSE 'gallery-lens-making' END,
  0,datetime('now')
FROM media_gallery_reconciliation_0216 candidate WHERE candidate.decision='admitted';

-- Excluded legacy rows must not be silently re-admitted merely because the
-- same file is later attached to a record. An explicit Studio admission changes
-- its review state first and remains available when the creator intends it.
DROP TRIGGER IF EXISTS archive_original_entity_media_admit;
DROP TRIGGER IF EXISTS archive_original_material_admit;
DROP TRIGGER IF EXISTS archive_original_note_asset_admit;

CREATE TRIGGER archive_original_entity_media_admit
AFTER INSERT ON entity_media
WHEN EXISTS(
  SELECT 1 FROM media_asset_provenance provenance
  WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original'
    AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified')
)
AND NOT EXISTS(SELECT 1 FROM media_archive_admission_reviews review WHERE review.media_id=NEW.media_id AND review.review_state='excluded')
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
AND EXISTS(SELECT 1 FROM content_entities owner WHERE owner.id=NEW.entity_id AND owner.visibility='public'
  AND owner.entity_type IN ('archive_record','archive_blackboard','archive_failed_experiment','archive_origin_thread','archive_note'))
AND NEW.public_visible=1 AND lower(NEW.role) NOT IN ('final-image','canonical','portfolio','gallery','cover','hero','thumbnail')
BEGIN
  INSERT OR IGNORE INTO content_entities(id,entity_type,visibility,search_visibility,featured,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset','internal',0,0,'studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries(media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',original_format,import_source,'active','record',NEW.entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_asset_provenance WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries(media_id,display_media_id,title,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT media.id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=media.id),media.id),COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),'undated','published',datetime('now'),'record',NEW.entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_assets media WHERE media.id=NEW.media_id;
END;

CREATE TRIGGER archive_original_material_admit
AFTER INSERT ON archive_materials
WHEN NEW.media_id IS NOT NULL AND NEW.state='published' AND NEW.visibility='public'
AND (NEW.material_type IN ('process-photo','note','voice-memo','video') OR NEW.role IN ('notebook','documentation','primary-documentation','process-photo','process-video','blackboard-whole')
  OR (NEW.role='primary' AND EXISTS(SELECT 1 FROM content_entities owner WHERE owner.id=NEW.dossier_entity_id AND owner.entity_type IN ('archive_record','archive_blackboard'))))
AND lower(NEW.role) NOT IN ('final-image','canonical','portfolio','gallery','cover','hero','thumbnail')
AND EXISTS(SELECT 1 FROM media_asset_provenance provenance WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original' AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified'))
AND NOT EXISTS(SELECT 1 FROM media_archive_admission_reviews review WHERE review.media_id=NEW.media_id AND review.review_state='excluded')
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
BEGIN
  INSERT OR IGNORE INTO content_entities(id,entity_type,visibility,search_visibility,featured,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset','internal',0,0,'studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries(media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',original_format,import_source,'active','record',NEW.dossier_entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_asset_provenance WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries(media_id,display_media_id,title,accessibility_text,caption,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT media.id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=media.id),media.id),COALESCE(NULLIF(trim(NEW.title),''),NULLIF(trim(media.public_title),''),media.original_filename),media.alt_text,NEW.caption,'undated','published',datetime('now'),'record',NEW.dossier_entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_assets media WHERE media.id=NEW.media_id;
END;

CREATE TRIGGER archive_original_note_asset_admit
AFTER INSERT ON archive_note_assets
WHEN NEW.role='inline-image' AND NEW.public_visible=1
AND EXISTS(SELECT 1 FROM archive_notes note WHERE note.entity_id=NEW.note_entity_id AND note.state='published' AND note.public_visible=1)
AND EXISTS(SELECT 1 FROM media_asset_provenance provenance WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original' AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified'))
AND NOT EXISTS(SELECT 1 FROM media_archive_admission_reviews review WHERE review.media_id=NEW.media_id AND review.review_state='excluded')
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
BEGIN
  INSERT OR IGNORE INTO content_entities(id,entity_type,visibility,search_visibility,featured,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset','internal',0,0,'studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries(media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',original_format,import_source,'active','record',NEW.note_entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_asset_provenance WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries(media_id,display_media_id,title,accessibility_text,caption,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT media.id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=media.id),media.id),COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),NEW.alt_text_override,NEW.caption_override,'undated','published',datetime('now'),'record',NEW.note_entity_id,'studio','studio',datetime('now'),datetime('now') FROM media_assets media WHERE media.id=NEW.media_id;
END;
