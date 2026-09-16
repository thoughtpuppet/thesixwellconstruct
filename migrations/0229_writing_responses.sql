PRAGMA foreign_keys = ON;

CREATE TABLE writing_responses (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES writing_entries(entity_id) ON DELETE CASCADE,
  parent_response_id TEXT REFERENCES writing_responses(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK(author_kind IN ('visitor','author')),
  author_name TEXT NOT NULL CHECK(length(author_name) BETWEEN 1 AND 160),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 12000),
  state TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('published','hidden')),
  idempotency_key TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hidden_at TEXT,
  CHECK(
    (author_kind='visitor' AND parent_response_id IS NULL) OR
    (author_kind='author' AND parent_response_id IS NOT NULL)
  )
);
CREATE INDEX idx_writing_responses_entry_public
  ON writing_responses(entry_id,state,created_at,id);
CREATE UNIQUE INDEX idx_writing_responses_author_reply
  ON writing_responses(parent_response_id) WHERE author_kind='author';

CREATE TRIGGER writing_response_parent_guard
BEFORE INSERT ON writing_responses
WHEN NEW.parent_response_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM writing_responses parent
  WHERE parent.id=NEW.parent_response_id
    AND parent.entry_id=NEW.entry_id
    AND parent.author_kind='visitor'
)
BEGIN SELECT RAISE(ABORT,'Author replies must belong to a visitor response on the same entry'); END;

CREATE TABLE writing_response_links (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES writing_responses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  link_kind TEXT NOT NULL DEFAULT 'external' CHECK(link_kind IN ('external','youtube')),
  youtube_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_writing_response_links_response
  ON writing_response_links(response_id,sort_order,id);

CREATE TABLE writing_response_attachments (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES writing_responses(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','file')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_writing_response_attachments_response
  ON writing_response_attachments(response_id,sort_order,id);

CREATE TABLE writing_response_connections (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES writing_responses(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES content_entities(id) ON DELETE RESTRICT,
  relationship_type_id TEXT NOT NULL REFERENCES relationship_types(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(response_id,target_entity_id,relationship_type_id)
);
CREATE INDEX idx_writing_response_connections_response
  ON writing_response_connections(response_id,sort_order,id);

CREATE TRIGGER writing_response_connection_author_guard
BEFORE INSERT ON writing_response_connections
WHEN NOT EXISTS(
  SELECT 1 FROM writing_responses response
  WHERE response.id=NEW.response_id AND response.author_kind='author'
)
BEGIN SELECT RAISE(ABORT,'Official response connections belong to author replies'); END;

CREATE TABLE writing_response_rate_limits (
  identity_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(identity_hash,window_started_at)
);
CREATE INDEX idx_writing_response_rate_limits_window
  ON writing_response_rate_limits(window_started_at);
