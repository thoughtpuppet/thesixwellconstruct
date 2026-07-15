PRAGMA foreign_keys = ON;

-- Permanently remove the retired placeholder collection. These exact records
-- were archived in migration 0037 and have no live relationships or Build
-- submissions. Published symbols and the draft Cross are intentionally kept.
DELETE FROM search_documents
WHERE entity_type = 'visual_symbol'
  AND entity_id IN (
    'maze-exit',
    'sairo-origin',
    'sairo-double',
    'sairo-hold',
    'sairo-carry',
    'fig-hand',
    'fig-figure',
    'fig-dissolve',
    'rit-thread',
    'rit-vessel',
    'rit-signal'
  );

DELETE FROM content_entities
WHERE entity_type = 'visual_symbol'
  AND id IN (
    SELECT id
    FROM visual_symbols
    WHERE state = 'archived'
      AND id IN (
        'maze-exit',
        'sairo-origin',
        'sairo-double',
        'sairo-hold',
        'sairo-carry',
        'fig-hand',
        'fig-figure',
        'fig-dissolve',
        'rit-thread',
        'rit-vessel',
        'rit-signal'
      )
  );
