PRAGMA foreign_keys = OFF;

-- Enduring Blackboard surfaces and their fragments are Construct identities,
-- not catalogued cultural objects. Complete captures continue to be ordinary
-- Archive Blackboard records with OBJ catalogue numbers.
CREATE TABLE archive_blackboard_surfaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  studio_location TEXT NOT NULL DEFAULT '',
  wall_designation TEXT NOT NULL DEFAULT '',
  orientation_note TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_blackboard_surfaces_public
  ON archive_blackboard_surfaces(state,public_visible,sort_order,title);

CREATE TABLE archive_blackboard_capture_surfaces (
  capture_entity_id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(capture_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(surface_id) REFERENCES archive_blackboard_surfaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_blackboard_capture_surface
  ON archive_blackboard_capture_surfaces(surface_id,sort_order,capture_entity_id);

CREATE TABLE archive_blackboard_surface_media (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'context' CHECK(role IN ('context')),
  master_media_id TEXT NOT NULL,
  derivative_media_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','day','month','year','circa','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(surface_id) REFERENCES archive_blackboard_surfaces(id) ON DELETE CASCADE,
  FOREIGN KEY(master_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(derivative_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(derivative_media_id IS NULL OR derivative_media_id<>master_media_id)
);

CREATE INDEX idx_archive_blackboard_surface_media
  ON archive_blackboard_surface_media(surface_id,state,public_visible,sort_order,occurred_at);

CREATE TABLE archive_blackboard_fragments (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  master_media_id TEXT,
  derivative_media_id TEXT,
  occurred_at TEXT,
  date_precision TEXT NOT NULL DEFAULT 'undated'
    CHECK(date_precision IN ('exact','day','month','year','circa','range','undated')),
  date_label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(surface_id,slug),
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(surface_id) REFERENCES archive_blackboard_surfaces(id) ON DELETE CASCADE,
  FOREIGN KEY(master_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(derivative_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
  CHECK(master_media_id IS NULL OR derivative_media_id IS NULL OR master_media_id<>derivative_media_id)
);

CREATE INDEX idx_archive_blackboard_fragments_public
  ON archive_blackboard_fragments(surface_id,state,public_visible,occurred_at,sort_order);

CREATE TABLE archive_blackboard_fragment_captures (
  fragment_id TEXT NOT NULL,
  capture_entity_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  PRIMARY KEY(fragment_id,capture_entity_id),
  FOREIGN KEY(fragment_id) REFERENCES archive_blackboard_fragments(id) ON DELETE CASCADE,
  FOREIGN KEY(capture_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_blackboard_fragment_captures_capture
  ON archive_blackboard_fragment_captures(capture_entity_id,sort_order,fragment_id);

INSERT OR IGNORE INTO relationship_types
  (id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('rel-source-for','source-for','Source for','Developed from source','A Blackboard fragment is source material for a manifestation.',1,61,datetime('now'),datetime('now')),
  ('rel-study-for','study-for','Study for','Developed from study','A Blackboard fragment is a study for a manifestation.',1,62,datetime('now'),datetime('now')),
  ('rel-informed','informed','Informed','Informed by','A Blackboard fragment informed a manifestation without being its direct source.',1,63,datetime('now'),datetime('now')),
  ('rel-planning-for','planning-for','Planning for','Planned from','A Blackboard fragment records planning for a manifestation.',1,64,datetime('now'),datetime('now'));

-- HEIC/HEIF is accepted only for private archival-master upload sessions. It
-- never becomes a public presentation asset without a separately selected
-- JPEG/PNG/WebP derivative.
CREATE TABLE media_upload_sessions_next (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN (
    'video/mp4','video/webm','image/tiff','image/jpeg','image/png','image/webp',
    'image/heic','image/heif'
  )),
  upload_kind TEXT NOT NULL DEFAULT 'video' CHECK(upload_kind IN ('video','archive-master')),
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

INSERT INTO media_upload_sessions_next SELECT * FROM media_upload_sessions;

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

INSERT INTO media_upload_parts_next SELECT * FROM media_upload_parts;
DROP TABLE media_upload_parts;
DROP TABLE media_upload_sessions;
ALTER TABLE media_upload_sessions_next RENAME TO media_upload_sessions;
ALTER TABLE media_upload_parts_next RENAME TO media_upload_parts;

CREATE INDEX idx_media_upload_sessions_state_expiry
  ON media_upload_sessions(state,expires_at,created_at);
CREATE INDEX idx_media_upload_parts_session
  ON media_upload_parts(session_id,part_number);

PRAGMA foreign_keys = ON;
