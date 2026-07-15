PRAGMA foreign_keys = ON;

-- Keep the first public Legend collection intentionally small. Records are
-- archived, rather than deleted, so revisions and existing relationships can
-- still be recovered in Studio.
UPDATE visual_symbols
SET state = 'archived', updated_at = datetime('now')
WHERE id NOT IN ('fig-eye', 'maze-path', 'rit-dot', 'maze-threshold', 'maze-room');

UPDATE content_entities
SET visibility = 'internal',
    search_visibility = 0,
    archived_at = COALESCE(archived_at, datetime('now')),
    updated_by = 'migration-0037',
    updated_at = datetime('now')
WHERE entity_type = 'visual_symbol'
  AND id NOT IN ('fig-eye', 'maze-path', 'rit-dot', 'maze-threshold', 'maze-room');

DELETE FROM search_documents
WHERE entity_type = 'visual_symbol'
  AND entity_id NOT IN ('fig-eye', 'maze-path', 'rit-dot', 'maze-threshold', 'maze-room');

-- The surviving set reads naturally as three spatial marks, one figural mark,
-- and one ritual mark.
UPDATE visual_symbols
SET sort_order = CASE id
  WHEN 'maze-path' THEN 1
  WHEN 'maze-room' THEN 2
  WHEN 'maze-threshold' THEN 3
  WHEN 'fig-eye' THEN 4
  WHEN 'rit-dot' THEN 5
  ELSE sort_order
END,
updated_at = datetime('now')
WHERE id IN ('fig-eye', 'maze-path', 'rit-dot', 'maze-threshold', 'maze-room');

UPDATE visual_symbol_categories
SET description = CASE id
  WHEN 'maze' THEN 'Spatial structures and navigational states: routes, enclosures, crossings, and the conditions of moving through them.'
  WHEN 'figural' THEN 'Recognizable bodies, features, and living forms whose meaning begins with what or who is represented.'
  WHEN 'ritual' THEN 'Elemental marks and gestures whose meaning comes from presence, repetition, placement, or intentional use.'
  WHEN 'sairoglyphs' THEN 'An authored glyph system: characters that behave like a private alphabet rather than pictures or spatial structures.'
  ELSE description
END,
state = CASE WHEN id = 'sairoglyphs' THEN 'archived' ELSE state END,
sort_order = CASE id WHEN 'maze' THEN 1 WHEN 'figural' THEN 2 WHEN 'ritual' THEN 3 ELSE sort_order END,
updated_at = datetime('now')
WHERE id IN ('maze', 'figural', 'ritual', 'sairoglyphs');
