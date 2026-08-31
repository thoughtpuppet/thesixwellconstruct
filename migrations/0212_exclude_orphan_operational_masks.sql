-- Interaction and alpha masks are generated control surfaces, not creative
-- media. Exclude them by durable naming/evidence rules even when an orphaned
-- upload is no longer attached to a Blackboard row.

UPDATE media_assets
SET archive_catalogue_eligible=0,updated_at=datetime('now')
WHERE archive_catalogue_eligible=1 AND (
  lower(original_filename) GLOB 'fragment-hotspot-*'
  OR lower(original_filename) GLOB 'fragment-alpha-*'
  OR lower(trim(alt_text)) LIKE 'interaction mask for %'
  OR lower(trim(alt_text)) LIKE 'alpha mask for %'
  OR lower(trim(public_title)) LIKE 'interaction mask for %'
  OR lower(trim(public_title)) LIKE 'alpha mask for %'
);

DROP TRIGGER IF EXISTS media_catalogue_asset_insert;
CREATE TRIGGER media_catalogue_asset_insert
AFTER INSERT ON media_assets
WHEN NEW.archive_catalogue_eligible=1
  AND lower(NEW.original_filename) NOT GLOB 'fragment-hotspot-*'
  AND lower(NEW.original_filename) NOT GLOB 'fragment-alpha-*'
  AND lower(trim(NEW.alt_text)) NOT LIKE 'interaction mask for %'
  AND lower(trim(NEW.alt_text)) NOT LIKE 'alpha mask for %'
  AND lower(trim(NEW.public_title)) NOT LIKE 'interaction mask for %'
  AND lower(trim(NEW.public_title)) NOT LIKE 'alpha mask for %'
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

DROP TRIGGER IF EXISTS operational_mask_asset_insert_exclusion;
CREATE TRIGGER operational_mask_asset_insert_exclusion
AFTER INSERT ON media_assets
WHEN NEW.archive_catalogue_eligible=1 AND (
  lower(NEW.original_filename) GLOB 'fragment-hotspot-*'
  OR lower(NEW.original_filename) GLOB 'fragment-alpha-*'
  OR lower(trim(NEW.alt_text)) LIKE 'interaction mask for %'
  OR lower(trim(NEW.alt_text)) LIKE 'alpha mask for %'
  OR lower(trim(NEW.public_title)) LIKE 'interaction mask for %'
  OR lower(trim(NEW.public_title)) LIKE 'alpha mask for %'
)
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.id;
END;

DROP TRIGGER IF EXISTS operational_mask_asset_update_exclusion;
CREATE TRIGGER operational_mask_asset_update_exclusion
AFTER UPDATE OF original_filename,alt_text,public_title ON media_assets
WHEN NEW.archive_catalogue_eligible=1 AND (
  lower(NEW.original_filename) GLOB 'fragment-hotspot-*'
  OR lower(NEW.original_filename) GLOB 'fragment-alpha-*'
  OR lower(trim(NEW.alt_text)) LIKE 'interaction mask for %'
  OR lower(trim(NEW.alt_text)) LIKE 'alpha mask for %'
  OR lower(trim(NEW.public_title)) LIKE 'interaction mask for %'
  OR lower(trim(NEW.public_title)) LIKE 'alpha mask for %'
)
BEGIN
  UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=NEW.id;
END;
