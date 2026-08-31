-- Preserve HEIC/HEIF originals as archival masters while publishing their
-- browser-safe JPEG/WebP display layer under the master's single Gallery work.

INSERT OR IGNORE INTO media_asset_variants
  (master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
SELECT fragment.master_media_id,
  COALESCE(fragment.derivative_media_id,fragment.edit_source_media_id),
  'public-display','migration-0213',datetime('now'),datetime('now')
FROM archive_blackboard_fragments fragment
JOIN media_assets master ON master.id=fragment.master_media_id
WHERE lower(master.mime_type) IN ('image/heic','image/heif')
  AND COALESCE(fragment.derivative_media_id,fragment.edit_source_media_id) IS NOT NULL;

-- Display derivatives stay inspectable in Media Library, but as site assets
-- they cannot receive their own Public Gallery cards.
UPDATE media_catalogue_entries
SET source_class='site_asset',updated_by='migration-0213',updated_at=datetime('now')
WHERE media_id IN (
  SELECT derivative_media_id FROM media_asset_variants WHERE purpose='public-display'
  UNION
  SELECT fragment.edit_source_media_id
  FROM archive_blackboard_fragments fragment
  JOIN media_assets master ON master.id=fragment.master_media_id
  WHERE lower(master.mime_type) IN ('image/heic','image/heif')
    AND fragment.edit_source_media_id IS NOT NULL
);

UPDATE media_assets
SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now')
WHERE id IN (
  SELECT variant.derivative_media_id
  FROM media_asset_variants variant
  JOIN gallery_entries gallery ON gallery.media_id=variant.master_media_id
  WHERE variant.purpose='public-display' AND gallery.state='published'
);

UPDATE gallery_entries
SET display_media_id=(
  SELECT variant.derivative_media_id
  FROM media_asset_variants variant
  WHERE variant.master_media_id=gallery_entries.media_id
    AND variant.purpose='public-display'
),updated_by='migration-0213',updated_at=datetime('now')
WHERE EXISTS(
  SELECT 1 FROM media_asset_variants variant
  WHERE variant.master_media_id=gallery_entries.media_id
    AND variant.purpose='public-display'
);

UPDATE media_assets
SET privacy='internal',public_presentation='hidden',updated_at=datetime('now')
WHERE id IN (
  SELECT master_media_id FROM media_asset_variants WHERE purpose='public-display'
);

DROP TRIGGER IF EXISTS gallery_variant_derivative_insert_cleanup;
CREATE TRIGGER gallery_variant_derivative_insert_cleanup
AFTER INSERT ON media_asset_variants
WHEN NEW.purpose='public-display'
BEGIN
  UPDATE media_catalogue_entries
  SET source_class='site_asset',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
END;

DROP TRIGGER IF EXISTS gallery_variant_derivative_update_cleanup;
CREATE TRIGGER gallery_variant_derivative_update_cleanup
AFTER UPDATE OF derivative_media_id ON media_asset_variants
WHEN NEW.purpose='public-display'
BEGIN
  UPDATE media_catalogue_entries
  SET source_class='site_asset',updated_by='studio',updated_at=datetime('now')
  WHERE media_id=NEW.derivative_media_id;
END;
