PRAGMA foreign_keys = ON;

-- Websites and digital systems are catalogued as cultural objects while
-- retaining the shared OBJ sequence used by the Archive's Other medium.
INSERT OR IGNORE INTO archive_cultural_object_types
  (id,medium_id,label,catalogue_prefix,description,state_guidance,sort_order,created_at,updated_at)
VALUES
  ('other-website','other','Website / digital system','OBJ',
   'A website or digital system documented as one evolving cultural object.',
   'Inception; meaningful interface or structural direction; release state; restoration',
   15,datetime('now'),datetime('now'));

-- One immutable source tree and its isolated viewer derivative. Publication
-- remains independent from both scan readiness and curator viewer approval.
CREATE TABLE archive_web_snapshots (
  id TEXT PRIMARY KEY,
  dossier_entity_id TEXT NOT NULL,
  material_id TEXT,
  state_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK(source_kind IN ('git','upload')),
  lineage_role TEXT NOT NULL CHECK(lineage_role IN ('canonical-state','exploratory-branch','restoration')),
  entry_path TEXT NOT NULL DEFAULT 'index.html',
  git_commit_sha TEXT NOT NULL DEFAULT '',
  git_parent_sha TEXT NOT NULL DEFAULT '',
  git_commit_date TEXT,
  git_author TEXT NOT NULL DEFAULT '',
  git_message TEXT NOT NULL DEFAULT '',
  scan_status TEXT NOT NULL DEFAULT 'draft' CHECK(scan_status IN ('draft','needs-files','blocked','ready')),
  viewer_approved INTEGER NOT NULL DEFAULT 0 CHECK(viewer_approved IN (0,1)),
  viewer_approved_at TEXT,
  publication_state TEXT NOT NULL DEFAULT 'draft' CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  tree_sha256 TEXT NOT NULL DEFAULT '',
  file_count INTEGER NOT NULL DEFAULT 0 CHECK(file_count >= 0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK(total_bytes >= 0),
  dependency_summary_json TEXT NOT NULL DEFAULT '{}',
  credential_findings_json TEXT NOT NULL DEFAULT '[]',
  screenshot_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(material_id) REFERENCES archive_materials(id) ON DELETE SET NULL,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE SET NULL
);

CREATE INDEX idx_archive_web_snapshots_dossier
  ON archive_web_snapshots(dossier_entity_id,sort_order,created_at,id);
CREATE INDEX idx_archive_web_snapshots_public
  ON archive_web_snapshots(dossier_entity_id,publication_state,public_visible,viewer_approved,scan_status);
CREATE INDEX idx_archive_web_snapshots_commit
  ON archive_web_snapshots(git_commit_sha) WHERE git_commit_sha<>'';

CREATE TABLE archive_web_snapshot_files (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  path_folded TEXT NOT NULL,
  source_storage_key TEXT NOT NULL UNIQUE,
  viewer_storage_key TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  source_sha256 TEXT NOT NULL,
  derivative_sha256 TEXT NOT NULL DEFAULT '',
  file_role TEXT NOT NULL DEFAULT 'other' CHECK(file_role IN ('entry-html','html','stylesheet','script','data','image','font','audio','video','document','other')),
  viewer_eligible INTEGER NOT NULL DEFAULT 0 CHECK(viewer_eligible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,normalized_path),
  UNIQUE(snapshot_id,path_folded),
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_web_snapshot_files_snapshot
  ON archive_web_snapshot_files(snapshot_id,normalized_path);
CREATE UNIQUE INDEX idx_archive_web_snapshot_files_viewer_key
  ON archive_web_snapshot_files(viewer_storage_key) WHERE viewer_storage_key<>'';

CREATE TABLE archive_web_snapshot_dependencies (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  dependency_key TEXT NOT NULL,
  referring_path TEXT NOT NULL,
  original_reference TEXT NOT NULL,
  resolved_path TEXT NOT NULL DEFAULT '',
  dependency_kind TEXT NOT NULL DEFAULT 'asset',
  status TEXT NOT NULL CHECK(status IN ('resolved','missing','external-blocked','navigation','embedded','case-mismatch','unverifiable','accepted-missing')),
  critical INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,dependency_key),
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_web_snapshot_dependencies_status
  ON archive_web_snapshot_dependencies(snapshot_id,status,critical);

CREATE TABLE archive_web_history_candidates (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT,
  dossier_entity_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL DEFAULT '',
  parent_sha TEXT NOT NULL DEFAULT '',
  commit_group_json TEXT NOT NULL DEFAULT '[]',
  group_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  commit_date TEXT,
  author TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  changed_paths_json TEXT NOT NULL DEFAULT '[]',
  desktop_capture_url TEXT NOT NULL DEFAULT '',
  mobile_capture_url TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','approved-version','approved-state','preserved-branch','merged','skipped')),
  curator_note TEXT NOT NULL DEFAULT '',
  version_id TEXT,
  state_id TEXT,
  material_id TEXT,
  activity_id TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(version_id) REFERENCES archive_object_versions(id) ON DELETE SET NULL,
  FOREIGN KEY(state_id) REFERENCES archive_object_states(id) ON DELETE SET NULL,
  FOREIGN KEY(material_id) REFERENCES archive_materials(id) ON DELETE SET NULL,
  FOREIGN KEY(activity_id) REFERENCES entity_activity(id) ON DELETE SET NULL
);

CREATE INDEX idx_archive_web_history_candidates_review
  ON archive_web_history_candidates(dossier_entity_id,decision,commit_date,created_at);
CREATE INDEX idx_archive_web_history_candidates_commit
  ON archive_web_history_candidates(commit_sha) WHERE commit_sha<>'';
