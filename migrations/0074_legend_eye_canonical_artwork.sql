PRAGMA foreign_keys = ON;

-- Legend symbols may use authored raster artwork as their canonical mark.
-- Their SVG translations remain available as variants for systems that animate
-- or recolor the forms.
ALTER TABLE visual_symbols ADD COLUMN image_url TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES (
  'visual_symbol-833811ac-a67e-48af-8256-1b1a165ce909',
  'visual_symbol',
  'node-legend',
  'public',
  1,
  datetime('now'),
  'migration-0074',
  'migration-0074',
  datetime('now'),
  datetime('now')
);

-- Preserve the current Illustrator-derived Watchers forms before the canonical
-- Legend artwork changes to the supplied PNG pair.
UPDATE visual_symbols
SET slug = 'open-eye',
    name = 'OPEN EYE',
    meaning = 'perception, vantage point',
    svg_markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 554.61 427.22"><g fill="currentColor"><path d="M554.61,200.57c-2.65-2.52-65.95-62.08-166.04-92.33-59.16-17.88-118.88-21.75-177.52-11.51C138.18,109.45,67.17,144.06,0,199.61l11.58,14-11.58,14c67.17,55.55,138.18,90.16,211.05,102.88,21.3,3.72,42.74,5.58,64.25,5.58,37.7,0,75.6-5.71,113.27-17.09,100.08-30.25,163.39-89.81,166.04-92.33l-12.41-13.05,12.41-13.03ZM356.17,213.61c0,43.79-35.62,79.41-79.41,79.41s-79.41-35.62-79.41-79.41,35.62-79.41,79.41-79.41,79.41,35.62,79.41,79.41ZM178.46,280.68c-43.95-13.23-87.18-35.6-129.51-67.07,42.34-31.48,85.57-53.85,129.51-67.07-13.08,19.11-20.76,42.21-20.76,67.08s7.67,47.96,20.75,67.07ZM375.68,279.78c12.71-18.94,20.14-41.7,20.14-66.17s-7.43-47.24-20.14-66.17c59.36,17.77,105.16,47.53,129.93,66.17-24.78,18.65-70.58,48.4-129.93,66.17Z"/><path d="M375.92,53.8c91.54,22.86,151.02,69.56,151.61,70.03l25.73-32.22c-2.64-2.11-65.88-52.07-165.59-77.37C328.99-.65,269.75-3.88,211.61,4.64,139.13,15.26,68.4,44.24,1.38,90.77l23.52,33.87C136.31,47.3,254.41,23.46,375.92,53.8Z"/><path d="M375.92,373.41c-121.51,30.34-239.61,6.51-351.02-70.84L1.38,336.45c67.02,46.53,137.75,75.51,210.22,86.13,21.11,3.09,42.36,4.64,63.69,4.64,37.4,0,75.01-4.75,112.39-14.24,99.71-25.3,162.94-75.25,165.59-77.37l-25.73-32.22c-.59.47-60.07,47.17-151.61,70.03Z"/></g></svg>',
    themes_json = '["perception","introspection"]',
    state = 'published',
    sort_order = 4,
    updated_at = datetime('now')
WHERE id = 'fig-eye';

INSERT OR IGNORE INTO visual_symbols
  (id,category_id,slug,name,meaning,svg_markup,image_url,themes_json,context_json,applications_json,variants_json,examples_json,build_guidance_json,state,sort_order,created_at,updated_at)
VALUES (
  'visual_symbol-833811ac-a67e-48af-8256-1b1a165ce909',
  'figural',
  'closed-eye',
  'CLOSED EYE',
  'same as open eye but the closed version',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 554.61 427.22"><g fill="currentColor"><path d="M554.61,200.57c-2.65-2.52-65.95-62.08-166.04-92.33-59.16-17.88-118.88-21.75-177.52-11.51C138.18,109.45,67.17,144.07,0,199.61l11.58,14-11.58,14c67.17,55.54,138.18,90.16,211.05,102.88,21.3,3.72,42.74,5.58,64.25,5.58,37.7,0,75.6-5.71,113.27-17.09,100.08-30.25,163.39-89.81,166.04-92.33l-12.4-13.04,12.4-13.04ZM167.07,167.31c-6.03,14.24-9.37,29.89-9.37,46.3,0,24.86,7.67,47.96,20.75,67.07-43.95-13.23-87.18-35.6-129.51-67.07,42.34-31.48,85.57-53.85,129.52-67.08-4.45,6.5-8.28,13.45-11.39,20.78ZM375.68,279.78c12.71-18.94,20.14-41.7,20.14-66.17s-7.43-47.24-20.14-66.18c59.36,17.77,105.16,47.53,129.93,66.17-24.78,18.65-70.58,48.4-129.93,66.17Z"/><path d="M375.92,53.8c91.54,22.86,151.02,69.56,151.61,70.03l12.85-16.12,12.88-16.1c-2.64-2.11-65.88-52.07-165.59-77.37C328.98-.65,269.75-3.88,211.61,4.64,139.13,15.26,68.4,44.24,1.38,90.77l23.52,33.87C136.31,47.3,254.42,23.47,375.92,53.8Z"/><path d="M375.92,373.41c-121.5,30.34-239.61,6.51-351.02-70.84L1.38,336.45c67.02,46.53,137.75,75.51,210.22,86.13,21.11,3.09,42.36,4.64,63.69,4.64,37.4,0,75.01-4.75,112.39-14.24,99.71-25.3,162.94-75.25,165.59-77.37l-25.73-32.22c-.59.47-60.07,47.17-151.61,70.03Z"/></g></svg>',
  '',
  '[]',
  '{}',
  '[]',
  '[]',
  '[]',
  '{}',
  'published',
  5,
  datetime('now'),
  datetime('now')
);

UPDATE visual_symbols
SET image_url = CASE slug
      WHEN 'open-eye' THEN '/assets/eyes/openeye.png'
      WHEN 'closed-eye' THEN '/assets/eyes/closedeye.png'
    END,
    variants_json = json_array(json_object(
      'name', CASE slug
        WHEN 'open-eye' THEN 'Open-eye Watchers SVG'
        WHEN 'closed-eye' THEN 'Closed-eye Watchers SVG'
      END,
      'style', 'Animation source',
      'note', 'Source mark for the Watchers animation on the home page.',
      'svg_markup', svg_markup,
      'image_url', '',
      'href', '/home/'
    )),
    svg_markup = '',
    examples_json = '[]',
    updated_at = datetime('now')
WHERE slug IN ('open-eye','closed-eye');

UPDATE visual_symbols
SET sort_order = 6, updated_at = datetime('now')
WHERE id = 'rit-dot';

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
  '/about/legend/?symbol=' || symbol.slug,
  symbol.updated_at
FROM visual_symbols symbol
JOIN visual_symbol_categories category ON category.id = symbol.category_id
WHERE symbol.slug IN ('open-eye','closed-eye');
