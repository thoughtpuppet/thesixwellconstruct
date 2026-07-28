PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_upload_sessions (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('video/mp4','video/webm')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 2147483648),
  part_size INTEGER NOT NULL DEFAULT 33554432,
  media_id TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'internal' CHECK(privacy IN ('public','unlisted','internal','private')),
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK(consent_status IN ('not-required','required','granted','denied','unknown')),
  transcript TEXT NOT NULL DEFAULT '',
  transcript_status TEXT NOT NULL DEFAULT 'not-requested' CHECK(transcript_status IN ('not-requested','pending','ready','failed')),
  transcript_language TEXT NOT NULL DEFAULT 'en',
  public_title TEXT NOT NULL DEFAULT '',
  public_description TEXT NOT NULL DEFAULT '',
  public_presentation TEXT NOT NULL DEFAULT 'inline' CHECK(public_presentation IN ('inline','hidden')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','aborted','failed')),
  error_message TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_state_expiry
  ON media_upload_sessions(state, expires_at, created_at);

CREATE TABLE IF NOT EXISTS media_upload_parts (
  session_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK(part_number > 0),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, part_number),
  FOREIGN KEY(session_id) REFERENCES media_upload_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_upload_parts_session
  ON media_upload_parts(session_id, part_number);
