PRAGMA foreign_keys = ON;

-- Portfolio items are the canonical source records for completed tattoos.
-- Keep that internal entity type out of Archive-facing record labels while
-- preserving the canonical entity, dossier, catalogue identity, and routes.
UPDATE archive_dossiers
SET record_type='tattoo',
    updated_by='migration-0088',
    updated_at=datetime('now')
WHERE entity_id IN (
  SELECT id FROM content_entities WHERE entity_type='portfolio_item'
)
  AND record_type<>'tattoo';

-- The original automatic shell triggers used replace(NEW.entity_type,'_','-'),
-- which exposed portfolio_item as "Portfolio Item". Recreate both paths with
-- the same public record-type vocabulary used by the Worker.
DROP TRIGGER IF EXISTS archive_shell_content_entity_insert;
CREATE TRIGGER archive_shell_content_entity_insert
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
    CASE NEW.entity_type
      WHEN 'art_work' THEN 'artwork'
      WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo'
      WHEN 'flash_item' THEN 'flash'
      WHEN 'event' THEN 'event'
      WHEN 'visual_symbol' THEN 'symbol'
      ELSE replace(NEW.entity_type,'_','-')
    END,
    'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;

DROP TRIGGER IF EXISTS archive_shell_content_entity_publish;
CREATE TRIGGER archive_shell_content_entity_publish
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
    CASE NEW.entity_type
      WHEN 'art_work' THEN 'artwork'
      WHEN 'merch_item' THEN 'merchandise'
      WHEN 'portfolio_item' THEN 'tattoo'
      WHEN 'flash_item' THEN 'flash'
      WHEN 'event' THEN 'event'
      WHEN 'visual_symbol' THEN 'symbol'
      ELSE replace(NEW.entity_type,'_','-')
    END,
    'published',1,COALESCE(NEW.public_at,datetime('now')),'archive-shell-trigger','archive-shell-trigger',datetime('now'),datetime('now');
END;
