-- Session planning is separate from appointment length. It records the
-- artist's required structure and, only where permitted, the client's choice.

ALTER TABLE flash_items ADD COLUMN session_category TEXT NOT NULL DEFAULT 'artist_review'
  CHECK (session_category IN ('artist_review','one_session','multiple_sessions'));
ALTER TABLE flash_items ADD COLUMN split_policy TEXT NOT NULL DEFAULT 'artist_review'
  CHECK (split_policy IN ('artist_review','required','client_choice','not_available'));
ALTER TABLE flash_items ADD COLUMN estimated_sessions_min INTEGER;
ALTER TABLE flash_items ADD COLUMN estimated_sessions_max INTEGER;
ALTER TABLE flash_items ADD COLUMN estimated_total_minutes_min INTEGER;
ALTER TABLE flash_items ADD COLUMN estimated_total_minutes_max INTEGER;
ALTER TABLE flash_items ADD COLUMN session_plan_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS tattoo_session_plans (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  estimated_sessions_min INTEGER,
  estimated_sessions_max INTEGER,
  estimated_total_minutes_min INTEGER,
  estimated_total_minutes_max INTEGER,
  split_policy TEXT NOT NULL DEFAULT 'artist_review'
    CHECK (split_policy IN ('artist_review','required','client_choice','not_available')),
  artist_note TEXT NOT NULL DEFAULT '',
  client_preference TEXT
    CHECK (client_preference IS NULL OR client_preference IN ('studio_plan','one_longer_session','multiple_shorter_sessions','discuss_with_artist')),
  client_informed_at TEXT,
  client_selected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tattoo_session_plans_split_policy
  ON tattoo_session_plans(split_policy, updated_at);
