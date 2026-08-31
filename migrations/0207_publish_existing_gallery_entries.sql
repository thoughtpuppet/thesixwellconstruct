-- One-time launch publication. Existing Gallery drafts are made public without
-- requiring per-item editorial review. Future publication is managed in Studio.

UPDATE gallery_entries
SET display_media_id=(
  SELECT derivative_media_id
  FROM media_asset_variants
  WHERE master_media_id=gallery_entries.display_media_id
    AND purpose='public-display'
)
WHERE state IN ('draft','hidden')
  AND EXISTS(
    SELECT 1 FROM media_asset_variants
    WHERE master_media_id=gallery_entries.display_media_id
      AND purpose='public-display'
  );

UPDATE media_assets
SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now')
WHERE id IN (
  SELECT display_media_id FROM gallery_entries WHERE state IN ('draft','hidden')
);

UPDATE gallery_entries
SET title=COALESCE(NULLIF(trim(title),''),(SELECT original_filename FROM media_assets WHERE id=gallery_entries.media_id)),
    date_precision=CASE WHEN date_precision='unreviewed' THEN 'undated' ELSE date_precision END,
    state='published',
    published_at=COALESCE(published_at,datetime('now')),
    updated_by='migration-0207',
    updated_at=datetime('now')
WHERE state IN ('draft','hidden');
