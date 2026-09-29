-- Lifetime, privacy-bounded Puzzle activity for the Studio Home dashboard.
-- A row represents one anonymous browser-tab session. The public session ID is
-- hashed before storage and is never returned by the Studio API.

CREATE TABLE IF NOT EXISTS site_puzzle_activity_meta (
  id TEXT PRIMARY KEY CHECK (id = 'entry-room'),
  tracking_started_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_puzzle_activity_meta (
  id, tracking_started_at, created_at, updated_at
) VALUES (
  'entry-room', datetime('now'), datetime('now'), datetime('now')
);

CREATE TABLE IF NOT EXISTS site_puzzle_sessions (
  session_hash TEXT PRIMARY KEY
    CHECK (length(session_hash) = 64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  attempted_at TEXT NOT NULL,
  solved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (solved_at IS NULL OR solved_at >= attempted_at)
);

CREATE INDEX IF NOT EXISTS idx_site_puzzle_sessions_attempted
  ON site_puzzle_sessions(attempted_at);

CREATE INDEX IF NOT EXISTS idx_site_puzzle_sessions_solved
  ON site_puzzle_sessions(solved_at)
  WHERE solved_at IS NOT NULL;
