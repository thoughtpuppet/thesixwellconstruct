-- Special Project Series describe the artistic body of work independently
-- from an individual project's application and booking lifecycle.

CREATE TABLE IF NOT EXISTS special_project_series (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  statement TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_special_project_series_public
  ON special_project_series(state, sort_order, name);

ALTER TABLE special_project_calls ADD COLUMN series_id TEXT
  REFERENCES special_project_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_special_project_calls_series
  ON special_project_calls(series_id, sort_order, updated_at);

ALTER TABLE special_project_submission_terms ADD COLUMN series_id TEXT;
ALTER TABLE special_project_submission_terms ADD COLUMN series_name TEXT NOT NULL DEFAULT '';
ALTER TABLE special_project_submission_terms ADD COLUMN series_slug TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO content_entities (
  id,entity_type,node_id,visibility,search_visibility,public_at,
  created_by,updated_by,created_at,updated_at
) VALUES (
  'sp-series-classic-cliches','special_project_series','node-tattoos','public',0,datetime('now'),
  'migration-0107','migration-0107',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO special_project_series (
  id,slug,name,statement,state,sort_order,created_at,updated_at
) VALUES (
  'sp-series-classic-cliches',
  'classic-cliches',
  'Classic Clichés',
  'Reimagining familiar tattoo iconography through the Art.Pill visual language.',
  'published',
  1,
  datetime('now'),
  datetime('now')
);

-- The project the artist identified while defining this feature already uses
-- the self-faith slug in Studio. Keep this exact assignment narrow so the
-- migration is a no-op in environments where that project does not exist.
UPDATE special_project_calls
SET series_id = 'sp-series-classic-cliches'
WHERE id = 'self-faith' OR slug = 'self-faith';
