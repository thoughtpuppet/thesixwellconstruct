PRAGMA foreign_keys = ON;

-- A Legend entry has one stable identity and several contextual layers:
-- applications explain meaning shifts, variants show formal translations,
-- examples document appearances, and entity_relationships connect live works.
ALTER TABLE visual_symbols ADD COLUMN applications_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE visual_symbols ADD COLUMN variants_json TEXT NOT NULL DEFAULT '[]';

-- Preserve existing search rows and make new layer language discoverable as
-- soon as it is added, without changing the symbol's stable route or ID.
UPDATE search_documents
SET body = COALESCE((
  SELECT visual_symbols.applications_json || ' ' || visual_symbols.variants_json || ' ' || visual_symbols.examples_json
  FROM visual_symbols
  WHERE visual_symbols.id = search_documents.entity_id
), '')
WHERE entity_type = 'visual_symbol';
