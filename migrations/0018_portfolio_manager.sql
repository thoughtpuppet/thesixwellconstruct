CREATE TABLE IF NOT EXISTS portfolio_items (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL DEFAULT '',
  primary_style TEXT NOT NULL DEFAULT '',
  collection TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_items_state_order
  ON portfolio_items(state, sort_order, created_at);
