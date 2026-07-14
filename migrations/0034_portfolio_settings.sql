CREATE TABLE IF NOT EXISTS portfolio_options (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('style', 'collection')),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_options_kind_value
  ON portfolio_options(kind, value COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_portfolio_options_kind_order
  ON portfolio_options(kind, sort_order, label);

INSERT OR IGNORE INTO portfolio_options
  (id, kind, value, label, description, enabled, sort_order, created_at, updated_at)
VALUES
  ('portfolio-style-unclassified', 'style', 'unclassified', 'Unclassified', '', 1, 1, datetime('now'), datetime('now')),
  ('portfolio-style-symbolic', 'style', 'symbolic', 'Symbolic', '', 1, 2, datetime('now'), datetime('now')),
  ('portfolio-style-surreal', 'style', 'surreal', 'Surreal', '', 1, 3, datetime('now'), datetime('now')),
  ('portfolio-style-mythic', 'style', 'mythic', 'Mythic', '', 1, 4, datetime('now'), datetime('now')),
  ('portfolio-style-special-project', 'style', 'special-project', 'Special Project', '', 1, 5, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO portfolio_options
  (id, kind, value, label, description, enabled, sort_order, created_at, updated_at)
SELECT
  'portfolio-collection-' || lower(hex(randomblob(12))),
  'collection',
  trimmed_collection,
  trimmed_collection,
  '',
  1,
  100 + ROW_NUMBER() OVER (ORDER BY lower(trimmed_collection)),
  datetime('now'),
  datetime('now')
FROM (
  SELECT DISTINCT trim(collection) AS trimmed_collection
  FROM portfolio_items
  WHERE trim(collection) <> ''
);
