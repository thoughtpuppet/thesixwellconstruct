ALTER TABLE portfolio_items ADD COLUMN image_presentation TEXT NOT NULL DEFAULT 'standard'
  CHECK (image_presentation IN ('standard', 'compare', 'grouped'));

ALTER TABLE portfolio_items ADD COLUMN cover_image_ref TEXT NOT NULL DEFAULT 'primary';

CREATE TABLE IF NOT EXISTS portfolio_image_details (
  portfolio_item_id TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  healing_state TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (healing_state IN ('fresh', 'healed', 'in-progress', 'unspecified')),
  timing_note TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (portfolio_item_id, image_ref),
  FOREIGN KEY (portfolio_item_id) REFERENCES portfolio_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_image_details_state
  ON portfolio_image_details(portfolio_item_id, healing_state);

INSERT OR IGNORE INTO portfolio_image_details
  (portfolio_item_id, image_ref, healing_state, timing_note, caption, created_at, updated_at)
SELECT id, 'primary', 'unspecified', '', '', datetime('now'), datetime('now')
FROM portfolio_items;
