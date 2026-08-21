PRAGMA foreign_keys = OFF;

-- Public calendar suggestions are an intake envelope, not editorial calendar
-- candidates. Raw submitter contact and revision history remain private until
-- Studio deliberately converts a new listing or correction.

CREATE TABLE calendar_public_submissions (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL UNIQUE,
  submission_kind TEXT NOT NULL DEFAULT 'new'
    CHECK (submission_kind IN ('new','correction')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','needs_information','converted','duplicate','declined','withdrawn','added')),
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_phone TEXT NOT NULL DEFAULT '',
  submitter_relationship TEXT NOT NULL DEFAULT '',
  target_candidate_id TEXT,
  target_entry_id TEXT,
  converted_candidate_id TEXT,
  converted_revision_id TEXT NOT NULL DEFAULT '',
  latest_revision_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  duplicate_fingerprint TEXT NOT NULL DEFAULT '',
  studio_note TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  personal_data_purged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_candidate_id) REFERENCES calendar_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY (target_entry_id) REFERENCES calendar_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (converted_candidate_id) REFERENCES calendar_candidates(id) ON DELETE SET NULL
);

CREATE INDEX idx_calendar_public_submissions_queue
  ON calendar_public_submissions(status,created_at DESC,id);
CREATE INDEX idx_calendar_public_submissions_target
  ON calendar_public_submissions(target_candidate_id,target_entry_id,converted_candidate_id);
CREATE INDEX idx_calendar_public_submissions_fingerprint
  ON calendar_public_submissions(duplicate_fingerprint,status);

CREATE TABLE calendar_public_submission_revisions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'submitter'
    CHECK (created_by IN ('submitter','studio','system')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES calendar_public_submissions(id) ON DELETE CASCADE,
  UNIQUE (submission_id,revision_number)
);

CREATE INDEX idx_calendar_public_submission_revisions_parent
  ON calendar_public_submission_revisions(submission_id,revision_number DESC);

CREATE TABLE calendar_public_submission_media (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  media_role TEXT NOT NULL DEFAULT 'flyer'
    CHECK (media_role IN ('primary','flyer','gallery','supporting')),
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES calendar_public_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  UNIQUE (submission_id,media_id)
);

CREATE INDEX idx_calendar_public_submission_media_parent
  ON calendar_public_submission_media(submission_id,removed_at,sort_order,id);

CREATE TABLE calendar_public_submission_tokens (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES calendar_public_submissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_public_submission_tokens_active
  ON calendar_public_submission_tokens(submission_id,expires_at,revoked_at);

CREATE TABLE calendar_public_submission_rate_limits (
  identity_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (identity_hash,window_started_at)
);

CREATE INDEX idx_calendar_public_submission_rate_limits_window
  ON calendar_public_submission_rate_limits(window_started_at);

-- Participant credits add a human role label while preserving the existing
-- related-link publication gate and immutable public snapshot behavior.
CREATE TABLE calendar_candidate_links_0158 (
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
    CHECK (link_role IN ('organizer','venue','ticket','artist','participant','supporting','discovery')),
  credit_role TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,url)
);

INSERT INTO calendar_candidate_links_0158
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role,credit_role)
SELECT id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role,''
FROM calendar_candidate_links;

CREATE TABLE calendar_entry_links_0158 (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  candidate_link_id TEXT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  link_role TEXT NOT NULL DEFAULT 'supporting'
    CHECK (link_role IN ('organizer','venue','ticket','artist','participant','supporting')),
  credit_role TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (entry_id) REFERENCES calendar_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_link_id) REFERENCES calendar_candidate_links_0158(id) ON DELETE SET NULL,
  UNIQUE (entry_id,url)
);

INSERT INTO calendar_entry_links_0158
  (id,entry_id,candidate_link_id,label,url,sort_order,link_role,credit_role)
SELECT id,entry_id,candidate_link_id,label,url,sort_order,link_role,''
FROM calendar_entry_links;

DROP TABLE calendar_entry_links;
DROP TABLE calendar_candidate_links;
ALTER TABLE calendar_candidate_links_0158 RENAME TO calendar_candidate_links;
ALTER TABLE calendar_entry_links_0158 RENAME TO calendar_entry_links;

CREATE INDEX idx_calendar_candidate_links_order
  ON calendar_candidate_links(candidate_id,sort_order,id);
CREATE INDEX idx_calendar_entry_links_order
  ON calendar_entry_links(entry_id,sort_order,id);

PRAGMA foreign_keys = ON;
