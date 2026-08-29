PRAGMA foreign_keys = ON;

-- Git imports declare the canonical tree hash they expect. Finalization
-- recomputes the same versioned framing from the stored immutable files.
ALTER TABLE archive_web_snapshots ADD COLUMN expected_tree_sha256 TEXT NOT NULL DEFAULT ''
  CHECK(expected_tree_sha256='' OR (length(expected_tree_sha256)=64 AND expected_tree_sha256 NOT GLOB '*[^0-9a-f]*'));

-- Generated browser captures are derivatives used for review and fallback,
-- never members of the immutable historical source tree.
CREATE TABLE archive_web_snapshot_captures (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  candidate_id TEXT,
  viewport TEXT NOT NULL CHECK(viewport IN ('desktop','mobile')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 15728640),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  derivative_role TEXT NOT NULL DEFAULT 'generated-viewer-capture'
    CHECK(derivative_role='generated-viewer-capture'),
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,viewport),
  FOREIGN KEY(candidate_id) REFERENCES archive_web_history_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_web_snapshot_captures_candidate
  ON archive_web_snapshot_captures(candidate_id,viewport) WHERE candidate_id IS NOT NULL;
CREATE INDEX idx_archive_web_snapshot_captures_snapshot
  ON archive_web_snapshot_captures(snapshot_id,viewport);

-- Curator-supplied stand-ins for blocked external resources are viewer
-- derivatives. They retain the dependency's original URL without changing
-- the immutable source tree or its checksum.
CREATE TABLE archive_web_snapshot_replacements (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  dependency_key TEXT NOT NULL,
  local_path TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 52428800),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  derivative_role TEXT NOT NULL DEFAULT 'external-resource-replacement'
    CHECK(derivative_role='external-resource-replacement'),
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,dependency_key),
  UNIQUE(snapshot_id,local_path),
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_web_snapshot_replacements_snapshot
  ON archive_web_snapshot_replacements(snapshot_id,dependency_key);
