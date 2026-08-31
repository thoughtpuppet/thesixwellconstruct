-- Public Gallery is an editorial surface for creative media, not a mirror of
-- the site's operational asset library. Site assets retain their Media Asset
-- and MED catalogue identities, but do not receive Gallery entries.

UPDATE gallery_sets
SET cover_media_id=NULL,updated_by='migration-0211',updated_at=datetime('now')
WHERE cover_media_id IN (
  SELECT media_id FROM media_catalogue_entries WHERE source_class='site_asset'
);

DELETE FROM gallery_entries
WHERE media_id IN (
  SELECT media_id FROM media_catalogue_entries WHERE source_class='site_asset'
);

-- Complete the user-requested one-time launch publication for every creative
-- catalogue item, including creative records added after migration 0208.
UPDATE media_assets
SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now')
WHERE id IN (
  SELECT gallery.display_media_id
  FROM gallery_entries gallery
  JOIN media_catalogue_entries catalogue ON catalogue.media_id=gallery.media_id
  WHERE catalogue.source_class='creative'
);

UPDATE gallery_entries
SET title=COALESCE(NULLIF(trim(title),''),(SELECT original_filename FROM media_assets WHERE id=gallery_entries.media_id)),
    date_precision=CASE WHEN date_precision='unreviewed' THEN 'undated' ELSE date_precision END,
    state='published',
    published_at=COALESCE(published_at,datetime('now')),
    updated_by='migration-0211',
    updated_at=datetime('now')
WHERE media_id IN (
  SELECT media_id FROM media_catalogue_entries WHERE source_class='creative'
);

DROP TRIGGER IF EXISTS gallery_entry_creative_insert_guard;
CREATE TRIGGER gallery_entry_creative_insert_guard
BEFORE INSERT ON gallery_entries
WHEN NOT EXISTS(
  SELECT 1
  FROM media_catalogue_entries catalogue
  JOIN media_assets media ON media.id=catalogue.media_id
  WHERE catalogue.media_id=NEW.media_id
    AND catalogue.source_class='creative'
    AND media.archive_catalogue_eligible=1
)
BEGIN
  SELECT RAISE(ABORT,'Gallery entries require creative Archive media');
END;

DROP TRIGGER IF EXISTS gallery_entry_creative_source_update;
CREATE TRIGGER gallery_entry_creative_source_update
AFTER UPDATE OF source_class ON media_catalogue_entries
WHEN NEW.source_class<>'creative'
BEGIN
  UPDATE gallery_sets SET cover_media_id=NULL,updated_at=datetime('now') WHERE cover_media_id=NEW.media_id;
  DELETE FROM gallery_entries WHERE media_id=NEW.media_id;
END;
