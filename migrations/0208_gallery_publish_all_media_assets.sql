-- Correct the launch scope: every active catalogued Media Asset receives a
-- Gallery entry and is published, including creative and site-asset classes.

INSERT OR IGNORE INTO gallery_entries(
  media_id,display_media_id,title,accessibility_text,accessibility_status,
  caption,credit,rights_status,date_precision,state,
  created_by,updated_by,created_at,updated_at
)
SELECT
  media.id,
  COALESCE(
    (SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=media.id AND purpose='public-display'),
    media.id
  ),
  COALESCE(NULLIF(trim(media.public_title),''),NULLIF(trim(media.alt_text),''),media.original_filename),
  media.alt_text,
  'unreviewed',
  media.caption,
  media.credit,
  'unreviewed',
  'undated',
  'draft',
  'migration-0208','migration-0208',datetime('now'),datetime('now')
FROM media_assets media
JOIN media_catalogue_entries catalogue ON catalogue.media_id=media.id
WHERE media.state='active';

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
    updated_by='migration-0208',
    updated_at=datetime('now')
WHERE state IN ('draft','hidden');
