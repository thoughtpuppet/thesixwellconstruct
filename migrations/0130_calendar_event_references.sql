PRAGMA foreign_keys = ON;

-- Lightweight supporting references for Atlanta Calendar candidates. These
-- remain private until an explicit candidate approval copies them into the
-- public snapshot tables.

ALTER TABLE calendar_candidates
  ADD COLUMN flyer_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE calendar_candidates
  ADD COLUMN flyer_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates
  ADD COLUMN flyer_provenance_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates
  ADD COLUMN flyer_public_approved INTEGER NOT NULL DEFAULT 0 CHECK (flyer_public_approved IN (0,1));

ALTER TABLE calendar_entries
  ADD COLUMN flyer_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE calendar_entries
  ADD COLUMN flyer_alt_text TEXT NOT NULL DEFAULT '';

CREATE TABLE calendar_candidate_links (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  provenance_url TEXT NOT NULL DEFAULT '',
  include_public INTEGER NOT NULL DEFAULT 0 CHECK (include_public IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,url)
);

CREATE INDEX idx_calendar_candidate_links_order
  ON calendar_candidate_links(candidate_id,sort_order,id);

CREATE TABLE calendar_entry_links (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_link_id TEXT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_link_id) REFERENCES calendar_candidate_links(id) ON DELETE SET NULL,
  UNIQUE (entry_id,url)
);

CREATE INDEX idx_calendar_entry_links_order
  ON calendar_entry_links(entry_id,sort_order,id);
