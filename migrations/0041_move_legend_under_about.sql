PRAGMA foreign_keys = ON;

-- Legend now lives inside the About branch while retaining its managed symbol
-- records, API endpoints, and standalone Connections identity.
UPDATE construct_nodes
SET route = '/about/legend/', updated_at = datetime('now')
WHERE id = 'node-legend';

UPDATE construct_pathways
SET node_id = 'node-about',
    name = 'Legend',
    route = '/about/legend/',
    sort_order = 7,
    updated_at = datetime('now')
WHERE id = 'path-tattoos-07' OR route = '/legend/';

UPDATE search_documents
SET route = '/about/legend/?symbol=' || slug,
    updated_at = datetime('now')
WHERE entity_type = 'visual_symbol';
