CREATE TABLE IF NOT EXISTS walk_in_windows (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL DEFAULT 'tattooing',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Walk-in Window',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_walk_in_windows_venture_active_start
  ON walk_in_windows(venture, active, starts_at);
