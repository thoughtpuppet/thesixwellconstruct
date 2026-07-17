PRAGMA foreign_keys = ON;

-- Style options continue to live beside the existing Portfolio collection
-- options, but style rows are shared by completed tattoos and Flash.
INSERT OR IGNORE INTO portfolio_options
  (id, kind, value, label, description, enabled, sort_order, created_at, updated_at)
VALUES
  ('portfolio-style-unclassified', 'style', 'unclassified', 'Unclassified', '', 1, 1, datetime('now'), datetime('now'));

-- Preserve any legacy scalar style that predates the managed option list.
INSERT OR IGNORE INTO portfolio_options
  (id, kind, value, label, description, enabled, sort_order, created_at, updated_at)
SELECT
  'portfolio-style-legacy-' || lower(hex(randomblob(12))),
  'style',
  legacy_value,
  legacy_value,
  '',
  1,
  (SELECT COALESCE(MAX(sort_order), 0) FROM portfolio_options WHERE kind = 'style')
    + ROW_NUMBER() OVER (ORDER BY lower(legacy_value)),
  datetime('now'),
  datetime('now')
FROM (
  SELECT MIN(trim(primary_style)) AS legacy_value
  FROM portfolio_items
  WHERE trim(primary_style) <> ''
  GROUP BY lower(trim(primary_style))
) legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM portfolio_options existing
  WHERE existing.kind = 'style'
    AND existing.value = legacy.legacy_value COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS tattoo_item_styles (
  entity_id TEXT NOT NULL,
  style_option_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, style_option_id),
  FOREIGN KEY (entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (style_option_id) REFERENCES portfolio_options(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tattoo_item_styles_one_primary
  ON tattoo_item_styles(entity_id)
  WHERE is_primary = 1;

CREATE INDEX IF NOT EXISTS idx_tattoo_item_styles_option_entity
  ON tattoo_item_styles(style_option_id, entity_id);

-- The foreign keys establish ownership, while these guards keep the
-- polymorphic assignment limited to the two tattoo record types and to style
-- options (never Portfolio collections).
CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_entity_insert_guard
BEFORE INSERT ON tattoo_item_styles
WHEN NOT EXISTS (SELECT 1 FROM portfolio_items WHERE id = NEW.entity_id)
 AND NOT EXISTS (SELECT 1 FROM flash_items WHERE id = NEW.entity_id)
BEGIN
  SELECT RAISE(ABORT, 'tattoo styles require a portfolio or flash item');
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_entity_update_guard
BEFORE UPDATE OF entity_id ON tattoo_item_styles
WHEN NOT EXISTS (SELECT 1 FROM portfolio_items WHERE id = NEW.entity_id)
 AND NOT EXISTS (SELECT 1 FROM flash_items WHERE id = NEW.entity_id)
BEGIN
  SELECT RAISE(ABORT, 'tattoo styles require a portfolio or flash item');
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_option_insert_guard
BEFORE INSERT ON tattoo_item_styles
WHEN NOT EXISTS (
  SELECT 1 FROM portfolio_options
  WHERE id = NEW.style_option_id AND kind = 'style'
)
BEGIN
  SELECT RAISE(ABORT, 'tattoo styles require a style option');
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_option_update_guard
BEFORE UPDATE OF style_option_id ON tattoo_item_styles
WHEN NOT EXISTS (
  SELECT 1 FROM portfolio_options
  WHERE id = NEW.style_option_id AND kind = 'style'
)
BEGIN
  SELECT RAISE(ABORT, 'tattoo styles require a style option');
END;

-- Keep the old Portfolio scalar as a compatibility mirror while consumers
-- move to the normalized list.
CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_primary_insert_sync
AFTER INSERT ON tattoo_item_styles
WHEN NEW.is_primary = 1
BEGIN
  UPDATE portfolio_items
  SET primary_style = (
    SELECT value FROM portfolio_options WHERE id = NEW.style_option_id
  )
  WHERE id = NEW.entity_id;
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_primary_update_sync
AFTER UPDATE OF style_option_id, is_primary ON tattoo_item_styles
WHEN NEW.is_primary = 1
BEGIN
  UPDATE portfolio_items
  SET primary_style = (
    SELECT value FROM portfolio_options WHERE id = NEW.style_option_id
  )
  WHERE id = NEW.entity_id;
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_primary_delete_sync
AFTER DELETE ON tattoo_item_styles
WHEN OLD.is_primary = 1
BEGIN
  UPDATE portfolio_items
  SET primary_style = COALESCE((
    SELECT option_row.value
    FROM tattoo_item_styles assignment
    JOIN portfolio_options option_row ON option_row.id = assignment.style_option_id
    WHERE assignment.entity_id = OLD.entity_id AND assignment.is_primary = 1
    LIMIT 1
  ), 'unclassified')
  WHERE id = OLD.entity_id;
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_portfolio_delete_cleanup
AFTER DELETE ON portfolio_items
BEGIN
  DELETE FROM tattoo_item_styles WHERE entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS tattoo_item_styles_flash_delete_cleanup
AFTER DELETE ON flash_items
BEGIN
  DELETE FROM tattoo_item_styles WHERE entity_id = OLD.id;
END;

UPDATE portfolio_items
SET primary_style = 'unclassified'
WHERE trim(primary_style) = '';

INSERT OR IGNORE INTO tattoo_item_styles
  (entity_id, style_option_id, is_primary, sort_order, created_at, updated_at)
SELECT
  item.id,
  option_row.id,
  1,
  1,
  datetime('now'),
  datetime('now')
FROM portfolio_items item
JOIN portfolio_options option_row
  ON option_row.kind = 'style'
 AND option_row.value = item.primary_style COLLATE NOCASE;

-- Flash had no legacy style field. Assigning the protected fallback makes the
-- shared API non-empty without inventing a stylistic classification.
INSERT OR IGNORE INTO tattoo_item_styles
  (entity_id, style_option_id, is_primary, sort_order, created_at, updated_at)
SELECT
  item.id,
  option_row.id,
  1,
  1,
  datetime('now'),
  datetime('now')
FROM flash_items item
JOIN portfolio_options option_row
  ON option_row.kind = 'style'
 AND option_row.value = 'unclassified' COLLATE NOCASE;

-- Existing Flash search documents gain the shared labels immediately; later
-- API writes keep this field current through the normal search sync.
UPDATE search_documents
SET theme_labels = COALESCE((
  SELECT group_concat(style_label, ', ')
  FROM (
    SELECT option_row.label AS style_label
    FROM tattoo_item_styles assignment
    JOIN portfolio_options option_row ON option_row.id = assignment.style_option_id
    WHERE assignment.entity_id = search_documents.entity_id
      AND lower(option_row.value) <> 'unclassified'
    ORDER BY assignment.is_primary DESC, assignment.sort_order
  ) public_styles
), ''),
updated_at = datetime('now')
WHERE entity_type = 'flash_item';
