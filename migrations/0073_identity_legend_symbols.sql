PRAGMA foreign_keys = ON;

-- Brand identity marks belong to the same managed Legend as the Construct's
-- other recurring visual symbols. Their canonical artwork uses currentColor so
-- the Legend owns presentation while the band assets can use the same symbol
-- color independently.
INSERT OR IGNORE INTO visual_symbol_categories
  (id,name,slug,description,state,sort_order,created_at,updated_at)
VALUES (
  'identity',
  'Identity',
  'identity',
  'Marks that name a room, practice, or manifestation inside the Construct and carry that identity between mediums.',
  'published',
  4,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('identity-thoughtpuppet','visual_symbol','node-legend','public',1,datetime('now'),'migration-0073','migration-0073',datetime('now'),datetime('now')),
  ('identity-six-well','visual_symbol','node-legend','public',1,datetime('now'),'migration-0073','migration-0073',datetime('now'),datetime('now')),
  ('identity-art-pill-tattoo-house','visual_symbol','node-legend','public',1,datetime('now'),'migration-0073','migration-0073',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO visual_symbols
  (id,category_id,slug,name,meaning,svg_markup,themes_json,context_json,applications_json,variants_json,examples_json,build_guidance_json,state,sort_order,created_at,updated_at)
VALUES
  (
    'identity-thoughtpuppet',
    'identity',
    'thoughtpuppet',
    'ThoughtPuppet',
    'A weighted question mark for the image room: inquiry made visible, holding certainty open long enough for another reading to appear.',
    '<svg viewBox="0 0 72 112"><path fill="currentColor" d="M36 0C14.8 0 0 12.9 0 32h20c0-8.8 6.4-14 16-14 9.4 0 16 5.1 16 12.4 0 6.4-3.2 9.4-11.7 14.2C29 51 24 58.4 24 70v8h20v-5.4c0-6.2 2.6-9.3 11.7-14.8C66.9 51 72 42.6 72 30.4 72 12.3 57.2 0 36 0Zm-12 88v24h22V88H24Z"/></svg>',
    '["inquiry","image","interpretation"]',
    '{}',
    '[]',
    '[]',
    '[{"title":"ThoughtPuppet identity band","medium":"Art","caption":"The question mark naming the Construct''s painting and visual-language manifestation.","src":"","href":"/art/"}]',
    '{}',
    'published',
    7,
    datetime('now'),
    datetime('now')
  ),
  (
    'identity-six-well',
    'identity',
    'six-well',
    'Six.Well',
    'The identity mark for clothing and objects within the Construct: six points holding separate positions while reading as one connected system.',
    '<svg viewBox="0 0 26.94 42.03"><g fill="currentColor"><path d="M5.23,0C2.35,0,0,2.35,0,5.23s2.35,5.23,5.23,5.23,5.23-2.35,5.23-5.23S8.12,0,5.23,0Z"/><path d="M5.23,15.78c-2.88,0-5.23,2.35-5.23,5.23s2.35,5.23,5.23,5.23,5.23-2.35,5.23-5.23-2.35-5.23-5.23-5.23Z"/><path d="M21.7,15.78c-2.88,0-5.23,2.35-5.23,5.23s2.35,5.23,5.23,5.23,5.23-2.35,5.23-5.23-2.35-5.23-5.23-5.23Z"/><path d="M21.7,31.57c-2.88,0-5.23,2.35-5.23,5.23s2.35,5.23,5.23,5.23,5.23-2.35,5.23-5.23-2.35-5.23-5.23-5.23Z"/><path d="M21.7,10.46c2.88,0,5.23-2.35,5.23-5.23S24.59,0,21.7,0s-5.23,2.35-5.23,5.23,2.35,5.23,5.23,5.23Z"/><path d="M5.23,31.57c-2.88,0-5.23,2.35-5.23,5.23s2.35,5.23,5.23,5.23,5.23-2.35,5.23-5.23-2.35-5.23-5.23-5.23Z"/></g></svg>',
    '["system","connection","making"]',
    '{}',
    '[]',
    '[]',
    '[{"title":"Six.Well identity band","medium":"Merch","caption":"The six-point mark naming the Construct''s clothing and objects manifestation.","src":"","href":"/merch/"}]',
    '{}',
    'published',
    8,
    datetime('now'),
    datetime('now')
  ),
  (
    'identity-art-pill-tattoo-house',
    'identity',
    'art-pill-tattoo-house',
    'Art.Pill Tattoo House',
    'A two-chamber house mark for a private tattoo practice: a place where image, ritual, transformation, and the body meet.',
    '<svg viewBox="0 0 88.39 160.04"><g fill="currentColor"><path d="M39.42,59.36c8.04-1.86,13.07-9.92,11.21-17.96s-9.92-13.07-17.96-11.21-13.07,9.92-11.21,17.96,9.92,13.07,17.96,11.21Z"/><path d="M47.81,3.34C41.37.03,33.88-.91,25.9.93c0,0,0,0,0,0s0,0,0,0h0c-.17.04-.33.09-.5.13-8.09,2-14.69,6.54-19.07,12.89C.89,21.5-1.39,31.26.87,41.03l21.55,93.08c2.61,11.28,10.65,19.89,20.72,23.71,5.59,2.27,11.88,2.86,18.57,1.47.27-.06.53-.1.8-.16h0s0,0,0,0c0,0,0,0,0,0,6.72-1.55,12.25-4.78,16.41-9.26,7.64-7.87,11.26-19.34,8.6-30.82l-1.2-5.17-19.15-82.74-1.2-5.17c-2.39-10.31-9.31-18.38-18.16-22.61ZM31.46,24.99c10.91-2.53,21.84,4.29,24.36,15.2,2.53,10.91-4.29,21.84-15.2,24.36s-21.84-4.29-24.36-15.2,4.29-21.84,15.2-24.36ZM81.19,115.05c4.06,17.52-4.94,34.62-20.05,38.11-15.11,3.5-30.7-7.91-34.76-25.43l-9.35-40.37,27.4-6.34,27.4-6.34,9.35,40.37Z"/><path d="M32.57,119.87c2.53,10.91,13.45,17.73,24.36,15.2s17.73-13.45,15.2-24.36-13.45-17.73-24.36-15.2-17.73,13.45-15.2,24.36ZM66.93,111.91c1.86,8.04-3.17,16.1-11.21,17.96s-16.1-3.17-17.96-11.21,3.17-16.1,11.21-17.96,16.1,3.17,17.96,11.21Z"/></g></svg>',
    '["body","ritual","transformation"]',
    '{}',
    '[]',
    '[]',
    '[{"title":"Art.Pill Tattoo House identity band","medium":"Tattooing","caption":"The house mark naming the Construct''s private tattoo practice.","src":"","href":"/tattoos/"}]',
    '{}',
    'published',
    9,
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
  'Identity',
  replace(replace(symbol.themes_json,'[',''),']',''),
  '/about/legend/?symbol=' || symbol.slug,
  symbol.updated_at
FROM visual_symbols symbol
WHERE symbol.id IN (
  'identity-thoughtpuppet',
  'identity-six-well',
  'identity-art-pill-tattoo-house'
);
