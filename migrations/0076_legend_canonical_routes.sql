PRAGMA foreign_keys = ON;

-- Published Legend symbols resolve as canonical records rather than query
-- states inside the catalog. Updating search_documents also refreshes its FTS
-- external-content table through the existing update trigger.
UPDATE search_documents
SET route = '/about/legend/' || slug || '/',
    updated_at = datetime('now')
WHERE entity_type = 'visual_symbol';
