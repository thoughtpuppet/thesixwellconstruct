-- Spatial annotations connect independently documented Blackboard fragments to
-- a confirmed region in a specific dated state. Coordinates are percentages of
-- the full scan so they remain stable across responsive image sizes.

CREATE TABLE archive_blackboard_fragment_placements (
  fragment_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  x_percent REAL NOT NULL CHECK(x_percent >= 0 AND x_percent <= 100),
  y_percent REAL NOT NULL CHECK(y_percent >= 0 AND y_percent <= 100),
  width_percent REAL NOT NULL CHECK(width_percent > 0 AND width_percent <= 100),
  height_percent REAL NOT NULL CHECK(height_percent > 0 AND height_percent <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(fragment_id,state_id),
  FOREIGN KEY(fragment_id,state_id) REFERENCES archive_blackboard_fragment_states(fragment_id,state_id) ON DELETE CASCADE,
  CHECK(x_percent + width_percent <= 100),
  CHECK(y_percent + height_percent <= 100)
);

CREATE INDEX idx_archive_blackboard_fragment_placements_state
  ON archive_blackboard_fragment_placements(state_id,sort_order,fragment_id);
