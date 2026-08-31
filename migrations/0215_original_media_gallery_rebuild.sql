-- Rebuild the Gallery as a catalogue of original Six.Well media rather than
-- an inventory of every managed website file. Managed assets and record
-- attachments remain intact when they are outside this catalogue.

CREATE TABLE IF NOT EXISTS media_asset_provenance (
  media_id TEXT PRIMARY KEY,
  sha256 TEXT,
  originality TEXT NOT NULL DEFAULT 'unknown'
    CHECK(originality IN ('sixwell_original','collaborative_original','external_source','unknown')),
  asset_role TEXT NOT NULL DEFAULT 'unclassified'
    CHECK(asset_role IN ('creative_master','editorial_fragment','technical_derivative','site_asset','operational','reference','unclassified')),
  creator_credit TEXT NOT NULL DEFAULT '',
  original_format TEXT NOT NULL DEFAULT '',
  import_source TEXT NOT NULL DEFAULT '',
  embedded_capture_at TEXT,
  embedded_capture_timezone TEXT NOT NULL DEFAULT '',
  camera_make TEXT NOT NULL DEFAULT '',
  camera_model TEXT NOT NULL DEFAULT '',
  editing_software TEXT NOT NULL DEFAULT '',
  orientation TEXT NOT NULL DEFAULT '',
  color_profile TEXT NOT NULL DEFAULT '',
  metadata_review_state TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(metadata_review_state IN ('unreviewed','reviewed','redacted')),
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'system',
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_asset_provenance_sha256
  ON media_asset_provenance(sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_asset_provenance_review
  ON media_asset_provenance(originality,asset_role,metadata_review_state,updated_at DESC);

INSERT OR IGNORE INTO media_asset_provenance
  (media_id,sha256,originality,asset_role,creator_credit,original_format,import_source,
   embedded_capture_at,embedded_capture_timezone,camera_make,camera_model,editing_software,
   orientation,color_profile,metadata_review_state,raw_metadata_json,
   created_by,updated_by,created_at,updated_at)
SELECT media.id,catalogue.sha256,'unknown',
  CASE
    WHEN media.archive_catalogue_eligible=0 THEN 'operational'
    WHEN catalogue.source_class='site_asset' THEN 'site_asset'
    WHEN EXISTS(SELECT 1 FROM media_asset_variants variant WHERE variant.derivative_media_id=media.id) THEN 'technical_derivative'
    ELSE 'unclassified'
  END,
  media.credit,catalogue.original_format,catalogue.import_source,catalogue.embedded_capture_at,
  catalogue.embedded_capture_timezone,catalogue.camera_make,catalogue.camera_model,
  catalogue.editing_software,catalogue.orientation,catalogue.color_profile,
  catalogue.metadata_review_state,catalogue.raw_metadata_json,
  catalogue.created_by,catalogue.updated_by,catalogue.created_at,catalogue.updated_at
FROM media_assets media
LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=media.id;

UPDATE media_asset_provenance
SET originality='sixwell_original',asset_role='creative_master',updated_by='migration-0215',updated_at=datetime('now')
WHERE media_id IN (
  SELECT id FROM media_assets WHERE lower(replace(storage_key,'\','/')) LIKE 'gallery/masters/peer-amid/%'
);

UPDATE media_asset_provenance
SET originality='sixwell_original',asset_role='editorial_fragment',creator_credit='Six.Well',
    updated_by='migration-0215',updated_at=datetime('now')
WHERE media_id='media-current-works-center-loop-7c051cf30035';

UPDATE media_asset_provenance
SET originality='sixwell_original',asset_role='technical_derivative',creator_credit='Six.Well',
    updated_by='migration-0215',updated_at=datetime('now')
WHERE media_id='media-current-works-center-poster-bf7b20b0d50e';

ALTER TABLE media_catalogue_entries ADD COLUMN catalogue_state TEXT NOT NULL DEFAULT 'active'
  CHECK(catalogue_state IN ('active','deaccessioned'));
ALTER TABLE media_catalogue_entries ADD COLUMN admission_basis TEXT NOT NULL DEFAULT 'legacy'
  CHECK(admission_basis IN ('legacy','direct','record','editorial','manual'));
ALTER TABLE media_catalogue_entries ADD COLUMN source_entity_id TEXT;
ALTER TABLE media_catalogue_entries ADD COLUMN manual_gallery_approved INTEGER NOT NULL DEFAULT 0
  CHECK(manual_gallery_approved IN (0,1));

ALTER TABLE gallery_entries ADD COLUMN publication_basis TEXT NOT NULL DEFAULT 'legacy'
  CHECK(publication_basis IN ('legacy','direct','record','editorial','manual'));
ALTER TABLE gallery_entries ADD COLUMN source_entity_id TEXT;

CREATE TABLE IF NOT EXISTS media_archive_admission_reviews (
  media_id TEXT PRIMARY KEY,
  prior_catalogue_id INTEGER,
  prior_gallery_state TEXT,
  review_state TEXT NOT NULL DEFAULT 'pending'
    CHECK(review_state IN ('pending','admitted','excluded','deferred')),
  suggested_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_archive_admission_reviews_state
  ON media_archive_admission_reviews(review_state,updated_at DESC,media_id);

CREATE TABLE IF NOT EXISTS media_catalogue_renumber_audit (
  run_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  old_catalogue_id INTEGER,
  new_catalogue_id INTEGER,
  disposition TEXT NOT NULL CHECK(disposition IN ('renumbered','review','excluded')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id,media_id)
);

WITH classified AS (
  SELECT catalogue.media_id,catalogue.catalogue_id,
    CASE
      WHEN provenance.originality='sixwell_original'
       AND provenance.asset_role IN ('creative_master','editorial_fragment') THEN 'renumbered'
      WHEN media.archive_catalogue_eligible=0
        OR provenance.asset_role IN ('technical_derivative','site_asset','operational','reference')
        OR catalogue.source_class='site_asset' THEN 'excluded'
      WHEN (lower(replace(media.storage_key,'\','/')) LIKE 'portfolio/%'
        OR EXISTS(
          SELECT 1 FROM entity_media attachment
          JOIN content_entities owner ON owner.id=attachment.entity_id
          WHERE attachment.media_id=media.id
            AND owner.entity_type IN ('portfolio_item','flash_item','flash_series','special_project','special_project_series','merch_item','tattoo_design')
        ))
        AND NOT EXISTS(SELECT 1 FROM archive_dossiers dossier JOIN entity_media attachment ON attachment.entity_id=dossier.entity_id WHERE attachment.media_id=media.id)
        AND NOT EXISTS(SELECT 1 FROM archive_materials material WHERE material.media_id=media.id)
        AND NOT EXISTS(SELECT 1 FROM archive_note_assets note_asset WHERE note_asset.media_id=media.id)
      THEN 'excluded'
      ELSE 'review'
    END disposition
  FROM media_catalogue_entries catalogue
  JOIN media_assets media ON media.id=catalogue.media_id
  JOIN media_asset_provenance provenance ON provenance.media_id=media.id
), numbered AS (
  SELECT media_id,catalogue_id,disposition,
    CASE WHEN disposition='renumbered' THEN
      SUM(CASE WHEN disposition='renumbered' THEN 1 ELSE 0 END)
        OVER (ORDER BY catalogue_id,media_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    END new_catalogue_id
  FROM classified
)
INSERT OR REPLACE INTO media_catalogue_renumber_audit
  (run_id,media_id,old_catalogue_id,new_catalogue_id,disposition,reason,created_at)
SELECT '0215-original-media-rebuild',media_id,catalogue_id,new_catalogue_id,disposition,
  CASE disposition
    WHEN 'renumbered' THEN 'Confirmed Six.Well original media'
    WHEN 'review' THEN 'Legacy creative media requires authorship review'
    ELSE 'Operational, derivative, site, reference, or portfolio-only media'
  END,datetime('now')
FROM numbered;

INSERT OR REPLACE INTO media_archive_admission_reviews
  (media_id,prior_catalogue_id,prior_gallery_state,review_state,suggested_reason,reviewed_by,reviewed_at,created_at,updated_at)
SELECT audit.media_id,audit.old_catalogue_id,gallery.state,
  CASE audit.disposition WHEN 'renumbered' THEN 'admitted' WHEN 'excluded' THEN 'excluded' ELSE 'pending' END,
  audit.reason,
  CASE WHEN audit.disposition='review' THEN '' ELSE 'migration-0215' END,
  CASE WHEN audit.disposition='review' THEN NULL ELSE datetime('now') END,
  datetime('now'),datetime('now')
FROM media_catalogue_renumber_audit audit
LEFT JOIN gallery_entries gallery ON gallery.media_id=audit.media_id
WHERE audit.run_id='0215-original-media-rebuild';

DELETE FROM gallery_entries
WHERE media_id IN (
  SELECT media_id FROM media_catalogue_renumber_audit
  WHERE run_id='0215-original-media-rebuild' AND disposition<>'renumbered'
);

-- Remove only the MED catalogue membership. Keep the companion content
-- identity because existing Archive semantic relationships may point to it.
-- Gallery exclusion must never delete record usage, context, or provenance.
DELETE FROM media_catalogue_entries
WHERE media_id IN (
  SELECT media_id FROM media_catalogue_renumber_audit
  WHERE run_id='0215-original-media-rebuild' AND disposition<>'renumbered'
);

UPDATE media_catalogue_entries SET catalogue_id=-catalogue_id;
UPDATE media_catalogue_entries
SET catalogue_id=(
      SELECT audit.new_catalogue_id FROM media_catalogue_renumber_audit audit
      WHERE audit.run_id='0215-original-media-rebuild' AND audit.media_id=media_catalogue_entries.media_id
    ),
    catalogue_state='active',
    admission_basis=CASE WHEN media_id='media-current-works-center-loop-7c051cf30035' THEN 'editorial' ELSE 'direct' END,
    source_entity_id=CASE WHEN media_id='media-current-works-center-loop-7c051cf30035' THEN 'current-project-artpill' ELSE NULL END,
    updated_by='migration-0215',updated_at=datetime('now');

DELETE FROM sqlite_sequence WHERE name='media_catalogue_entries';
INSERT INTO sqlite_sequence(name,seq)
SELECT 'media_catalogue_entries',COALESCE(MAX(catalogue_id),0) FROM media_catalogue_entries;

INSERT INTO gallery_entries
  (media_id,display_media_id,title,accessibility_text,accessibility_status,caption,credit,
   rights_status,date_precision,date_label,state,published_at,publication_basis,source_entity_id,
   created_by,updated_by,created_at,updated_at)
SELECT media.id,media.id,'Current Works Center Loop',media.alt_text,'unreviewed',media.caption,'Six.Well',
  'unreviewed','undated','Undated','published',datetime('now'),'editorial','current-project-artpill',
  'migration-0215','migration-0215',datetime('now'),datetime('now')
FROM media_assets media WHERE media.id='media-current-works-center-loop-7c051cf30035'
ON CONFLICT(media_id) DO UPDATE SET
  title=excluded.title,credit=excluded.credit,state='published',published_at=COALESCE(gallery_entries.published_at,excluded.published_at),
  publication_basis='editorial',source_entity_id='current-project-artpill',updated_by='migration-0215',updated_at=datetime('now');

UPDATE gallery_entries
SET publication_basis=CASE WHEN media_id='media-current-works-center-loop-7c051cf30035' THEN 'editorial' ELSE 'direct' END,
    source_entity_id=CASE WHEN media_id='media-current-works-center-loop-7c051cf30035' THEN 'current-project-artpill' ELSE source_entity_id END,
    date_precision=CASE WHEN date_precision='unreviewed' THEN 'undated' ELSE date_precision END,
    state='published',published_at=COALESCE(published_at,datetime('now')),
    updated_by='migration-0215',updated_at=datetime('now')
WHERE media_id IN (SELECT media_id FROM media_catalogue_entries WHERE catalogue_state='active');

UPDATE gallery_sets
SET state='published',published_at=COALESCE(published_at,datetime('now')),
    cover_media_id=COALESCE(cover_media_id,(
      SELECT item.media_id FROM gallery_set_items item
      WHERE item.set_id=gallery_sets.id ORDER BY item.sort_order,item.media_id LIMIT 1
    )),updated_by='migration-0215',updated_at=datetime('now')
WHERE id='gallery-set-peer-amid-versions';

INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
SELECT 'relationship-current-works-center-loop',catalogue.entity_id,'current-project-artpill','rel-documents',1,
  'Creator-supplied Current Works editorial fragment.',0,'migration-0215',datetime('now'),datetime('now')
FROM media_catalogue_entries catalogue
WHERE catalogue.media_id='media-current-works-center-loop-7c051cf30035';

DROP TRIGGER IF EXISTS media_catalogue_asset_insert;
DROP TRIGGER IF EXISTS media_catalogue_asset_opt_out;
DROP TRIGGER IF EXISTS gallery_entry_creative_insert_guard;
DROP TRIGGER IF EXISTS gallery_entry_creative_source_update;
DROP TRIGGER IF EXISTS gallery_variant_derivative_insert_cleanup;
DROP TRIGGER IF EXISTS gallery_variant_derivative_update_cleanup;
DROP TRIGGER IF EXISTS gallery_entry_publish_insert_guard;
DROP TRIGGER IF EXISTS gallery_entry_publish_update_guard;

CREATE TRIGGER media_asset_provenance_insert
AFTER INSERT ON media_assets
BEGIN
  INSERT OR IGNORE INTO media_asset_provenance
    (media_id,originality,asset_role,creator_credit,original_format,import_source,
     created_by,updated_by,created_at,updated_at)
  VALUES
    (NEW.id,'unknown',CASE WHEN NEW.archive_catalogue_eligible=0 THEN 'operational' ELSE 'unclassified' END,
     NEW.credit,
     CASE WHEN instr(NEW.original_filename,'.')>0 THEN lower(substr(NEW.original_filename,instr(NEW.original_filename,'.')+1)) ELSE '' END,
     CASE WHEN NEW.source_url<>'' THEN 'repository' ELSE 'studio-upload' END,
     COALESCE(NEW.created_by,'system'),COALESCE(NEW.created_by,'system'),NEW.created_at,NEW.updated_at);
END;

CREATE TRIGGER media_catalogue_asset_opt_out
AFTER UPDATE OF archive_catalogue_eligible ON media_assets
WHEN OLD.archive_catalogue_eligible=1 AND NEW.archive_catalogue_eligible=0
BEGIN
  UPDATE media_asset_provenance SET asset_role='operational',updated_by='system',updated_at=datetime('now') WHERE media_id=NEW.id;
  UPDATE media_catalogue_entries SET catalogue_state='deaccessioned',updated_by='system',updated_at=datetime('now') WHERE media_id=NEW.id;
  UPDATE gallery_entries SET state='hidden',updated_by='system',updated_at=datetime('now') WHERE media_id=NEW.id;
END;

CREATE TRIGGER media_variant_originality_boundary_insert
AFTER INSERT ON media_asset_variants
BEGIN
  UPDATE media_asset_provenance
  SET asset_role='technical_derivative',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
  UPDATE media_catalogue_entries
  SET catalogue_state='deaccessioned',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
  UPDATE gallery_entries SET state='hidden',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
END;

CREATE TRIGGER media_variant_originality_boundary_update
AFTER UPDATE OF derivative_media_id ON media_asset_variants
BEGIN
  UPDATE media_asset_provenance
  SET asset_role='technical_derivative',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
  UPDATE media_catalogue_entries
  SET catalogue_state='deaccessioned',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
  UPDATE gallery_entries SET state='hidden',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
END;

CREATE TRIGGER gallery_entry_original_media_insert_guard
BEFORE INSERT ON gallery_entries
WHEN NOT EXISTS(
  SELECT 1 FROM media_catalogue_entries catalogue
  JOIN media_asset_provenance provenance ON provenance.media_id=catalogue.media_id
  WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active'
    AND (provenance.originality='sixwell_original'
      OR (provenance.originality='collaborative_original' AND catalogue.manual_gallery_approved=1))
    AND provenance.asset_role IN ('creative_master','editorial_fragment')
)
BEGIN
  SELECT RAISE(ABORT,'Gallery entries require admitted original Construct media');
END;

CREATE TRIGGER gallery_entry_publish_insert_guard
BEFORE INSERT ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)='' OR NOT EXISTS(SELECT 1 FROM media_assets display WHERE display.id=NEW.display_media_id AND display.state='active')
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires a title and active display asset');
END;

CREATE TRIGGER gallery_entry_publish_update_guard
BEFORE UPDATE ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)='' OR NOT EXISTS(SELECT 1 FROM media_assets display WHERE display.id=NEW.display_media_id AND display.state='active')
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires a title and active display asset');
END;

-- New original media attached to an Archive-native record is admitted once.
CREATE TRIGGER archive_original_entity_media_admit
AFTER INSERT ON entity_media
WHEN EXISTS(
  SELECT 1 FROM media_asset_provenance provenance
  WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original'
    AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified')
)
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
AND (
  EXISTS(SELECT 1 FROM archive_dossiers dossier WHERE dossier.entity_id=NEW.entity_id)
  OR EXISTS(
    SELECT 1 FROM content_entities owner WHERE owner.id=NEW.entity_id
      AND owner.entity_type IN ('archive_record','archive_blackboard','archive_failed_experiment','archive_collection','archive_timeline','archive_origin_thread','archive_note','visual_symbol','person','place','organization')
  )
)
BEGIN
  UPDATE media_asset_provenance
  SET asset_role=CASE WHEN asset_role='unclassified' THEN 'creative_master' ELSE asset_role END,
      updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset',NULL,'internal',0,0,'','studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries
    (media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',provenance.original_format,provenance.import_source,
    'active','record',NEW.entity_id,'studio','studio',datetime('now'),datetime('now')
  FROM media_asset_provenance provenance WHERE provenance.media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries
    (media_id,display_media_id,title,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=NEW.media_id AND purpose='public-display'),NEW.media_id),
    COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),'undated','published',datetime('now'),'record',NEW.entity_id,
    'studio','studio',datetime('now'),datetime('now')
  FROM media_assets media WHERE media.id=NEW.media_id;
  INSERT OR IGNORE INTO entity_relationships
    (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
  VALUES('relationship-gallery-record-'||NEW.media_id||'-'||NEW.entity_id,'media-catalogue-'||NEW.media_id,NEW.entity_id,
    'rel-documents',NEW.public_visible,'Original media admitted through its owning Archive record.',0,'studio',datetime('now'),datetime('now'));
END;

-- Archive material and Journal attachment tables do not use entity_media, so
-- they receive equivalent admission behavior when explicitly classified as
-- original before attachment.
CREATE TRIGGER archive_original_material_admit
AFTER INSERT ON archive_materials
WHEN NEW.media_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM media_asset_provenance provenance
  WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original'
    AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified')
)
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
BEGIN
  UPDATE media_asset_provenance SET asset_role=CASE WHEN asset_role='unclassified' THEN 'creative_master' ELSE asset_role END,
    updated_by='studio',updated_at=datetime('now') WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset',NULL,'internal',0,0,'','studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries
    (media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',provenance.original_format,provenance.import_source,
    'active','record',NEW.dossier_entity_id,'studio','studio',datetime('now'),datetime('now')
  FROM media_asset_provenance provenance WHERE provenance.media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries
    (media_id,display_media_id,title,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=NEW.media_id AND purpose='public-display'),NEW.media_id),
    COALESCE(NULLIF(trim(NEW.title),''),NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),
    'undated','published',datetime('now'),'record',NEW.dossier_entity_id,'studio','studio',datetime('now'),datetime('now')
  FROM media_assets media WHERE media.id=NEW.media_id;
  INSERT OR IGNORE INTO entity_relationships
    (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
  VALUES('relationship-gallery-material-'||NEW.media_id||'-'||NEW.dossier_entity_id,'media-catalogue-'||NEW.media_id,NEW.dossier_entity_id,
    'rel-documents',CASE WHEN NEW.state='published' AND NEW.visibility='public' THEN 1 ELSE 0 END,
    'Original media admitted through Archive material ownership.',0,'studio',datetime('now'),datetime('now'));
END;

CREATE TRIGGER archive_original_note_asset_admit
AFTER INSERT ON archive_note_assets
WHEN EXISTS(
  SELECT 1 FROM media_asset_provenance provenance
  WHERE provenance.media_id=NEW.media_id AND provenance.originality='sixwell_original'
    AND provenance.asset_role IN ('creative_master','editorial_fragment','unclassified')
)
AND NOT EXISTS(SELECT 1 FROM media_catalogue_entries catalogue WHERE catalogue.media_id=NEW.media_id AND catalogue.catalogue_state='active')
BEGIN
  UPDATE media_asset_provenance SET asset_role=CASE WHEN asset_role='unclassified' THEN 'creative_master' ELSE asset_role END,
    updated_by='studio',updated_at=datetime('now') WHERE media_id=NEW.media_id;
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
  VALUES('media-catalogue-'||NEW.media_id,'media_asset',NULL,'internal',0,0,'','studio','studio',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO media_catalogue_entries
    (media_id,entity_id,source_class,original_format,import_source,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,'media-catalogue-'||NEW.media_id,'creative',provenance.original_format,provenance.import_source,
    'active','record',NEW.note_entity_id,'studio','studio',datetime('now'),datetime('now')
  FROM media_asset_provenance provenance WHERE provenance.media_id=NEW.media_id;
  INSERT OR IGNORE INTO gallery_entries
    (media_id,display_media_id,title,accessibility_text,caption,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
  SELECT NEW.media_id,COALESCE((SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=NEW.media_id AND purpose='public-display'),NEW.media_id),
    COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.original_filename),''),'Untitled media'),
    NEW.alt_text_override,NEW.caption_override,'undated','published',datetime('now'),'record',NEW.note_entity_id,
    'studio','studio',datetime('now'),datetime('now')
  FROM media_assets media WHERE media.id=NEW.media_id;
  INSERT OR IGNORE INTO entity_relationships
    (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
  VALUES('relationship-gallery-note-'||NEW.media_id||'-'||NEW.note_entity_id,'media-catalogue-'||NEW.media_id,NEW.note_entity_id,
    'rel-documents',NEW.public_visible,'Original media admitted through Journal attachment ownership.',0,'studio',datetime('now'),datetime('now'));
END;

-- Generic Archive records created after the original structure backfill still
-- need their cultural-object identity, version, and initial state.
WITH pending AS (
  SELECT dossier.entity_id,ROW_NUMBER() OVER (ORDER BY dossier.created_at,dossier.entity_id) sequence
  FROM archive_dossiers dossier
  JOIN content_entities entity ON entity.id=dossier.entity_id AND entity.entity_type='archive_record'
  WHERE NOT EXISTS(SELECT 1 FROM archive_catalogue_entries existing WHERE existing.entity_id=dossier.entity_id)
), base AS (
  SELECT COALESCE(MAX(catalogue_number),0) maximum FROM archive_catalogue_entries
  WHERE catalogue_prefix=(SELECT catalogue_prefix FROM archive_cultural_object_types WHERE id='other-cultural-object')
)
INSERT OR IGNORE INTO archive_catalogue_entries
  (entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,
   variant_label,current_state_id,created_by,updated_by,created_at,updated_at)
SELECT pending.entity_id,type.medium_id,type.id,type.catalogue_prefix,base.maximum+pending.sequence,
  type.catalogue_prefix||'-'||printf('%03d',base.maximum+pending.sequence),1,'I','',NULL,
  'migration-0215','migration-0215',datetime('now'),datetime('now')
FROM pending CROSS JOIN base JOIN archive_cultural_object_types type ON type.id='other-cultural-object';

INSERT OR IGNORE INTO archive_object_versions
  (id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,
   publication_state,public_visible,created_by,updated_by,created_at,updated_at)
SELECT 'archive-version-initial:'||catalogue.entity_id,catalogue.entity_id,1,'Version 1','',NULL,'undated','',1,
  'draft',0,'migration-0215','migration-0215',datetime('now'),datetime('now')
FROM archive_catalogue_entries catalogue
WHERE NOT EXISTS(SELECT 1 FROM archive_object_versions existing WHERE existing.entity_id=catalogue.entity_id);

INSERT OR IGNORE INTO archive_object_states
  (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,
   sort_order,publication_state,public_visible,lead_material_id,created_by,updated_by,created_at,updated_at)
SELECT 'archive-state-initial:'||version.id,version.id,'I',1,'First documented state','','',NULL,'undated','',1,
  'draft',0,NULL,'migration-0215','migration-0215',datetime('now'),datetime('now')
FROM archive_object_versions version
WHERE NOT EXISTS(SELECT 1 FROM archive_object_states existing WHERE existing.version_id=version.id);

UPDATE archive_materials
SET state_id=(
  SELECT state.id FROM archive_object_states state
  JOIN archive_object_versions version ON version.id=state.version_id
  WHERE version.entity_id=archive_materials.dossier_entity_id
  ORDER BY version.version_number,state.state_order LIMIT 1
)
WHERE state_id IS NULL AND EXISTS(
  SELECT 1 FROM archive_object_versions version WHERE version.entity_id=archive_materials.dossier_entity_id
);

WITH referenced AS (
  SELECT material.id,
    CASE WHEN material.material_type='note' THEN 'N' WHEN material.material_type='document' THEN 'D' ELSE 'M' END prefix,
    ROW_NUMBER() OVER(
      PARTITION BY material.state_id,CASE WHEN material.material_type='note' THEN 'N' WHEN material.material_type='document' THEN 'D' ELSE 'M' END
      ORDER BY material.sort_order,material.created_at,material.id
    ) reference_number
  FROM archive_materials material
)
UPDATE archive_materials
SET material_reference=(SELECT prefix||printf('%02d',reference_number) FROM referenced WHERE referenced.id=archive_materials.id)
WHERE material_reference='';

-- The Made in Public flyer is shared public appearance media and a Calendar
-- flyer. Calendar ownership excludes it from MED/Gallery, but must not remove
-- its existing public presentation on the appearance record.
INSERT OR IGNORE INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
SELECT 'appearance-made-in-public',media.id,'primary',1,1,'Made in Public event flyer.',
  'Purple Fish Studios × Fourth House present Made in Public, August 14, 2026.',datetime('now')
FROM media_assets media WHERE media.id='media-made-in-public-flyer';
