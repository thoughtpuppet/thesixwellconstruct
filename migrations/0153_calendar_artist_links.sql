PRAGMA foreign_keys = OFF;

-- Artist identity links reuse the calendar's existing unlimited related-link
-- records. Rebuild the two constrained tables once so an approved exhibition
-- can publish an artist website, Instagram profile, or search fallback.

CREATE TABLE calendar_candidate_links_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  provenance_url TEXT NOT NULL DEFAULT '',
  include_public INTEGER NOT NULL DEFAULT 0 CHECK (include_public IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  link_role TEXT NOT NULL DEFAULT 'supporting'
    CHECK (link_role IN ('organizer','venue','ticket','artist','supporting','discovery')),
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,url)
);

INSERT INTO calendar_candidate_links_new
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role)
SELECT id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role
FROM calendar_candidate_links;

CREATE TABLE calendar_entry_links_new (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_link_id TEXT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  link_role TEXT NOT NULL DEFAULT 'supporting'
    CHECK (link_role IN ('organizer','venue','ticket','artist','supporting')),
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_link_id) REFERENCES calendar_candidate_links_new(id) ON DELETE SET NULL,
  UNIQUE (entry_id,url)
);

INSERT INTO calendar_entry_links_new
  (id,entry_id,candidate_link_id,label,url,sort_order,link_role)
SELECT id,entry_id,candidate_link_id,label,url,sort_order,link_role
FROM calendar_entry_links;

DROP TABLE calendar_entry_links;
DROP TABLE calendar_candidate_links;
ALTER TABLE calendar_candidate_links_new RENAME TO calendar_candidate_links;
ALTER TABLE calendar_entry_links_new RENAME TO calendar_entry_links;

CREATE INDEX idx_calendar_candidate_links_order
  ON calendar_candidate_links(candidate_id,sort_order,id);
CREATE INDEX idx_calendar_entry_links_order
  ON calendar_entry_links(entry_id,sort_order,id);

PRAGMA foreign_keys = ON;
