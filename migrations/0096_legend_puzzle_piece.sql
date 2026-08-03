PRAGMA foreign_keys = ON;

-- The retry control in the shared navigation is also a canonical Legend mark.
-- It belongs to MAZE because it returns visitors to the entry-room puzzle and
-- treats repetition as another way through the Construct.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES (
  'maze-puzzle-piece',
  'visual_symbol',
  'node-legend',
  'public',
  1,
  datetime('now'),
  'migration-0096',
  'migration-0096',
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO visual_symbols
  (id,category_id,slug,name,meaning,svg_markup,image_url,themes_json,context_json,applications_json,variants_json,examples_json,build_guidance_json,state,sort_order,created_at,updated_at)
VALUES (
  'maze-puzzle-piece',
  'maze',
  'puzzle-piece',
  'The Puzzle Piece',
  'An invitation to begin again. Return to the threshold, try another sequence, and notice what changes on the next attempt.',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path fill="currentColor" d="M30 30H48C48 19 52 12 60 12S72 19 72 30H90V48C101 48 108 52 108 60S101 72 90 72V90H72C72 79 68 72 60 72S48 79 48 90H30V72C41 72 48 68 48 60S41 48 30 48V30Z"/></svg>',
  '',
  '["return","play","discovery"]',
  '{"modes":["system","personal"],"personal_relationship":"The mark keeps the entry puzzle available after someone has already crossed into the Construct.","viewer_opening":"A completed passage does not close the door. The beginning can be entered again with different attention."}',
  '[]',
  '[]',
  '[{"title":"Retry entry puzzle","medium":"The Construct","caption":"The shared navigation mark that returns visitors to the entry-room puzzle.","src":"","href":"/"}]',
  '{"essence":"Permission to begin again.","emotional_tones":["playful","curious","open"],"reflection_questions":["What changes when you try again?"]}',
  'published',
  5,
  datetime('now'),
  datetime('now')
);

INSERT OR REPLACE INTO search_documents
  (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,route,updated_at)
SELECT
  symbol.id,
  'visual_symbol',
  'node-legend',
  symbol.slug,
  symbol.name,
  symbol.meaning,
  symbol.context_json || ' ' || symbol.applications_json || ' ' || symbol.variants_json || ' ' || symbol.examples_json,
  symbol.state,
  category.name,
  replace(replace(symbol.themes_json,'[',''),']',''),
  '/about/legend/' || symbol.slug || '/',
  symbol.updated_at
FROM visual_symbols symbol
JOIN visual_symbol_categories category ON category.id = symbol.category_id
WHERE symbol.id = 'maze-puzzle-piece';
