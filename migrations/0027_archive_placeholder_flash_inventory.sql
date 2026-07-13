-- Remove seeded placeholder studies from public flash inventory without
-- permanently deleting their legacy records or static media.
UPDATE flash_items
SET state = 'archived', claimable = 0, updated_at = datetime('now')
WHERE id IN ('ap-maze-001', 'ap-sairo-001', 'ap-standalone-archive-001');

UPDATE content_entities
SET visibility = 'internal',
    search_visibility = 0,
    archived_at = COALESCE(archived_at, datetime('now')),
    updated_by = 'migration-0027',
    updated_at = datetime('now')
WHERE id IN ('ap-maze-001', 'ap-sairo-001', 'ap-standalone-archive-001');

UPDATE entity_media
SET public_visible = 0
WHERE entity_id IN ('ap-maze-001', 'ap-sairo-001', 'ap-standalone-archive-001');
