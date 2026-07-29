PRAGMA foreign_keys = OFF;

-- Resumable uploads now preserve both video and private archival image
-- masters. Rebuild the two upload tables so existing pending/completed video
-- sessions retain their data while the MIME and upload-kind constraints grow.
CREATE TABLE media_upload_sessions_next (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN (
    'video/mp4','video/webm',
    'image/tiff','image/jpeg','image/png','image/webp'
  )),
  upload_kind TEXT NOT NULL DEFAULT 'video'
    CHECK(upload_kind IN ('video','archive-master')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 2147483648),
  part_size INTEGER NOT NULL DEFAULT 33554432,
  media_id TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'internal'
    CHECK(privacy IN ('public','unlisted','internal','private')),
  consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(consent_status IN ('not-required','required','granted','denied','unknown')),
  transcript TEXT NOT NULL DEFAULT '',
  transcript_status TEXT NOT NULL DEFAULT 'not-requested'
    CHECK(transcript_status IN ('not-requested','pending','ready','failed')),
  transcript_language TEXT NOT NULL DEFAULT 'en',
  public_title TEXT NOT NULL DEFAULT '',
  public_description TEXT NOT NULL DEFAULT '',
  public_presentation TEXT NOT NULL DEFAULT 'inline'
    CHECK(public_presentation IN ('inline','hidden')),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','completed','aborted','failed')),
  error_message TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO media_upload_sessions_next (
  id,upload_id,storage_key,original_filename,mime_type,upload_kind,byte_size,
  part_size,media_id,alt_text,caption,privacy,consent_status,transcript,
  transcript_status,transcript_language,public_title,public_description,
  public_presentation,state,error_message,expires_at,completed_at,created_by,
  created_at,updated_at
)
SELECT
  id,upload_id,storage_key,original_filename,mime_type,'video',byte_size,
  part_size,media_id,alt_text,caption,privacy,consent_status,transcript,
  transcript_status,transcript_language,public_title,public_description,
  public_presentation,state,error_message,expires_at,completed_at,created_by,
  created_at,updated_at
FROM media_upload_sessions;

CREATE TABLE media_upload_parts_next (
  session_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK(part_number > 0),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id,part_number),
  FOREIGN KEY(session_id) REFERENCES media_upload_sessions_next(id) ON DELETE CASCADE
);

INSERT INTO media_upload_parts_next
  (session_id,part_number,etag,byte_size,created_at,updated_at)
SELECT session_id,part_number,etag,byte_size,created_at,updated_at
FROM media_upload_parts;

DROP TABLE media_upload_parts;
DROP TABLE media_upload_sessions;
ALTER TABLE media_upload_sessions_next RENAME TO media_upload_sessions;
ALTER TABLE media_upload_parts_next RENAME TO media_upload_parts;

CREATE INDEX idx_media_upload_sessions_state_expiry
  ON media_upload_sessions(state,expires_at,created_at);
CREATE INDEX idx_media_upload_parts_session
  ON media_upload_parts(session_id,part_number);

-- One internal master may supply one public-display derivative. The public API
-- never returns the master side of this relationship.
CREATE TABLE IF NOT EXISTS media_asset_variants (
  master_media_id TEXT NOT NULL,
  derivative_media_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'public-display'
    CHECK(purpose IN ('public-display')),
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(master_media_id,purpose),
  UNIQUE(derivative_media_id,purpose),
  FOREIGN KEY(master_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(derivative_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(master_media_id<>derivative_media_id)
);

CREATE INDEX IF NOT EXISTS idx_media_asset_variants_derivative
  ON media_asset_variants(derivative_media_id,purpose);

-- Blackboard source sets may remain unmatched while they are interpreted in a
-- painting dossier, then point to the complete captured-board record later.
ALTER TABLE archive_source_material_sets ADD COLUMN board_entity_id TEXT;
CREATE INDEX IF NOT EXISTS idx_archive_source_material_sets_blackboard
  ON archive_source_material_sets(source_kind,board_entity_id,publication_state,visibility,occurred_at);

-- Existing ordinary Materials remain in their original dossier and gain only
-- explicit source metadata. Nothing is inferred from filenames or captions.
CREATE TABLE IF NOT EXISTS archive_material_source_contexts (
  material_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('blackboard')),
  capture_scope TEXT NOT NULL CHECK(capture_scope IN ('whole','detail')),
  board_entity_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(material_id) REFERENCES archive_materials(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_material_source_blackboard
  ON archive_material_source_contexts(source_kind,capture_scope,board_entity_id);

-- Blackboard records join the existing OBJ family rather than creating a new
-- permanent identifier sequence.
INSERT OR IGNORE INTO archive_cultural_object_types
  (id,medium_id,label,catalogue_prefix,description,state_guidance,sort_order,created_at,updated_at)
VALUES
  ('other-blackboard','other','Blackboard','OBJ',
   'One complete captured state of a working blackboard.',
   'Each complete capture is a separate cultural object; use Version 1 / State I for the captured condition.',
   6,datetime('now'),datetime('now'));

PRAGMA foreign_keys = ON;
