-- Rights and accessibility metadata remain available to Gallery editors, but
-- neither field nor transcript readiness may block publication.

DROP TRIGGER IF EXISTS gallery_entry_publish_insert_guard;
DROP TRIGGER IF EXISTS gallery_entry_publish_update_guard;

CREATE TRIGGER gallery_entry_publish_insert_guard
BEFORE INSERT ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)=''
  OR NEW.date_precision='unreviewed'
  OR NOT EXISTS(
    SELECT 1 FROM media_assets display
    WHERE display.id=NEW.display_media_id AND display.state='active'
      AND display.privacy='public' AND display.public_presentation='inline'
      AND NOT EXISTS(SELECT 1 FROM media_asset_variants pair WHERE pair.master_media_id=display.id)
  )
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires a title, reviewed date, and an eligible public display asset');
END;

CREATE TRIGGER gallery_entry_publish_update_guard
BEFORE UPDATE ON gallery_entries
WHEN NEW.state='published' AND (
  trim(NEW.title)=''
  OR NEW.date_precision='unreviewed'
  OR NOT EXISTS(
    SELECT 1 FROM media_assets display
    WHERE display.id=NEW.display_media_id AND display.state='active'
      AND display.privacy='public' AND display.public_presentation='inline'
      AND NOT EXISTS(SELECT 1 FROM media_asset_variants pair WHERE pair.master_media_id=display.id)
  )
)
BEGIN
  SELECT RAISE(ABORT,'published gallery entry requires a title, reviewed date, and an eligible public display asset');
END;
