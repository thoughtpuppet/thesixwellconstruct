CREATE TABLE IF NOT EXISTS site_visibility_settings (
  id TEXT PRIMARY KEY,
  home_only INTEGER NOT NULL DEFAULT 0 CHECK (home_only IN (0, 1)),
  updated_by TEXT NOT NULL DEFAULT 'migration-0157',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_visibility_rules (
  path TEXT PRIMARY KEY,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'hidden')),
  scope TEXT NOT NULL CHECK (scope IN ('exact', 'descendants')),
  updated_by TEXT NOT NULL DEFAULT 'migration-0157',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site_visibility_settings (id, home_only, updated_by, updated_at)
VALUES ('public-pages', 0, 'migration-0157', datetime('now'));

INSERT OR IGNORE INTO site_visibility_rules (path, visibility, scope, updated_by, updated_at) VALUES
  ('/film', 'hidden', 'exact', 'migration-0157', datetime('now')),
  ('/music', 'hidden', 'exact', 'migration-0157', datetime('now')),
  ('/tattoos/build', 'hidden', 'descendants', 'migration-0157', datetime('now')),
  ('/tattoos/build/maze', 'public', 'exact', 'migration-0157', datetime('now'));
