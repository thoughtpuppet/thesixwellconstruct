-- Calendar event imagery, generated Blackboard masks, and private development
-- references are operational files. They remain available to the systems that
-- own them, but never receive an Archive Media Catalogue identity or Gallery
-- presentation.

ALTER TABLE media_assets ADD COLUMN archive_catalogue_eligible INTEGER NOT NULL DEFAULT 1
  CHECK(archive_catalogue_eligible IN (0,1));

CREATE INDEX IF NOT EXISTS idx_media_assets_archive_catalogue_eligible
  ON media_assets(archive_catalogue_eligible,state,created_at);

DROP TRIGGER IF EXISTS media_catalogue_asset_insert;
CREATE TRIGGER media_catalogue_asset_insert
AFTER INSERT ON media_assets
WHEN NEW.archive_catalogue_eligible=1
BEGIN
  INSERT OR IGNORE INTO content_entities
    (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
  VALUES
    ('media-catalogue-'||NEW.id,'media_asset',NULL,'internal',0,0,'',COALESCE(NEW.created_by,'system'),COALESCE(NEW.created_by,'system'),NEW.created_at,NEW.updated_at);
  INSERT OR IGNORE INTO media_catalogue_entries
    (media_id,entity_id,source_class,original_format,import_source,created_by,updated_by,created_at,updated_at)
  VALUES
    (NEW.id,'media-catalogue-'||NEW.id,'creative',
     CASE WHEN instr(NEW.original_filename,'.')>0 THEN lower(substr(NEW.original_filename,instr(NEW.original_filename,'.')+1)) ELSE '' END,
     CASE WHEN NEW.source_url<>'' THEN 'repository' ELSE 'studio-upload' END,
     COALESCE(NEW.created_by,'system'),COALESCE(NEW.created_by,'system'),NEW.created_at,NEW.updated_at);
END;

-- Opting a file out removes only Archive/Gallery structures. The media_assets
-- row and stored bytes remain intact for Calendar and Blackboard delivery.
CREATE TRIGGER media_catalogue_asset_opt_out
AFTER UPDATE OF archive_catalogue_eligible ON media_assets
WHEN OLD.archive_catalogue_eligible=1 AND NEW.archive_catalogue_eligible=0
BEGIN
  UPDATE gallery_sets SET cover_media_id=NULL,updated_at=datetime('now') WHERE cover_media_id=NEW.id;
  UPDATE gallery_entries SET poster_media_id=NULL,updated_at=datetime('now') WHERE poster_media_id=NEW.id;
  UPDATE gallery_entries SET display_media_id=media_id,updated_at=datetime('now')
    WHERE display_media_id=NEW.id AND media_id<>NEW.id;
  DELETE FROM gallery_entries WHERE media_id=NEW.id;
  DELETE FROM media_creator_handoffs WHERE media_id=NEW.id;
  DELETE FROM entity_media WHERE media_id=NEW.id;
  DELETE FROM content_entities
    WHERE id=(SELECT entity_id FROM media_catalogue_entries WHERE media_id=NEW.id)
      AND entity_type='media_asset';
END;

-- Association triggers make the ownership boundary durable even when an
-- existing managed file is later assigned to Calendar or used as a mask.
CREATE TRIGGER calendar_candidate_media_archive_exclusion
AFTER INSERT ON calendar_candidate_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_candidate_media_update_archive_exclusion
AFTER UPDATE OF media_id ON calendar_candidate_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_entry_media_archive_exclusion
AFTER INSERT ON calendar_entry_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_entry_media_update_archive_exclusion
AFTER UPDATE OF media_id ON calendar_entry_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_public_submission_media_archive_exclusion
AFTER INSERT ON calendar_public_submission_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_public_submission_media_update_archive_exclusion
AFTER UPDATE OF media_id ON calendar_public_submission_media
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.media_id;
END;

CREATE TRIGGER calendar_candidate_primary_media_insert_archive_exclusion
AFTER INSERT ON calendar_candidates
WHEN NEW.flyer_media_id IS NOT NULL AND NEW.flyer_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.flyer_media_id;
END;

CREATE TRIGGER calendar_candidate_primary_media_archive_exclusion
AFTER UPDATE OF flyer_media_id ON calendar_candidates
WHEN NEW.flyer_media_id IS NOT NULL AND NEW.flyer_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.flyer_media_id;
END;

CREATE TRIGGER calendar_entry_primary_media_archive_exclusion
AFTER UPDATE OF flyer_media_id ON calendar_entries
WHEN NEW.flyer_media_id IS NOT NULL AND NEW.flyer_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.flyer_media_id;
END;

CREATE TRIGGER calendar_entry_primary_media_insert_archive_exclusion
AFTER INSERT ON calendar_entries
WHEN NEW.flyer_media_id IS NOT NULL AND NEW.flyer_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.flyer_media_id;
END;

CREATE TRIGGER blackboard_alpha_mask_archive_exclusion
AFTER INSERT ON archive_blackboard_fragment_edits
WHEN NEW.alpha_mask_media_id IS NOT NULL AND NEW.alpha_mask_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.alpha_mask_media_id;
END;

CREATE TRIGGER blackboard_alpha_mask_update_archive_exclusion
AFTER UPDATE OF alpha_mask_media_id ON archive_blackboard_fragment_edits
WHEN NEW.alpha_mask_media_id IS NOT NULL AND NEW.alpha_mask_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.alpha_mask_media_id;
END;

CREATE TRIGGER blackboard_hotspot_mask_archive_exclusion
AFTER INSERT ON archive_blackboard_fragment_placements
WHEN NEW.hotspot_mask_media_id IS NOT NULL AND NEW.hotspot_mask_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.hotspot_mask_media_id;
END;

CREATE TRIGGER blackboard_hotspot_mask_update_archive_exclusion
AFTER UPDATE OF hotspot_mask_media_id ON archive_blackboard_fragment_placements
WHEN NEW.hotspot_mask_media_id IS NOT NULL AND NEW.hotspot_mask_media_id<>''
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.hotspot_mask_media_id;
END;

UPDATE media_assets
SET archive_catalogue_eligible=0
WHERE archive_catalogue_eligible=1 AND (
  created_by IN ('calendar-scout','calendar-public-submission')
  OR lower(replace(source_url,'\','/')) LIKE '/assets/events/%'
  OR lower(replace(source_url,'\','/')) IN (
    '/assets/entry-room/ring-ripple-reference.mov',
    '/assets/entry-room/ring-ripple-reference.mp4'
  )
  OR lower(original_filename) IN ('ring-ripple-reference.mov','ring-ripple-reference.mp4')
  OR EXISTS(SELECT 1 FROM calendar_candidates candidate WHERE candidate.flyer_media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM calendar_candidate_media candidate_media WHERE candidate_media.media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM calendar_entries entry WHERE entry.flyer_media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM calendar_entry_media entry_media WHERE entry_media.media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM calendar_public_submission_media submission_media WHERE submission_media.media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM archive_blackboard_fragment_edits edit WHERE edit.alpha_mask_media_id=media_assets.id)
  OR EXISTS(SELECT 1 FROM archive_blackboard_fragment_placements placement WHERE placement.hotspot_mask_media_id=media_assets.id)
);
