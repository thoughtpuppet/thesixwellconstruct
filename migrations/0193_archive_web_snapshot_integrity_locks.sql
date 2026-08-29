PRAGMA foreign_keys = ON;

-- Source bundles are append-only, but upload, scan, and review requests may
-- overlap. These revisions and the short-lived mutation claim make every
-- readiness decision refer to one exact immutable file generation.
ALTER TABLE archive_web_snapshots ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0
  CHECK(source_revision >= 0);
ALTER TABLE archive_web_snapshots ADD COLUMN scan_revision INTEGER NOT NULL DEFAULT -1
  CHECK(scan_revision >= -1);
ALTER TABLE archive_web_snapshots ADD COLUMN mutation_token TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_web_snapshots ADD COLUMN mutation_kind TEXT NOT NULL DEFAULT ''
  CHECK(mutation_kind IN ('','upload','finalize','review','dependency','capture'));
ALTER TABLE archive_web_snapshots ADD COLUMN mutation_started_at TEXT;

CREATE INDEX idx_archive_web_snapshots_mutation
  ON archive_web_snapshots(mutation_token,mutation_started_at) WHERE mutation_token<>'';

-- Preserve valid local scans when this migration is applied over development
-- data. Any row whose recorded count no longer matches its source rows is
-- deliberately returned to draft instead of inheriting a false scan revision.
UPDATE archive_web_snapshots
SET source_revision=(
  SELECT COUNT(*) FROM archive_web_snapshot_files file
  WHERE file.snapshot_id=archive_web_snapshots.id
);

UPDATE archive_web_snapshots
SET scan_revision=CASE
      WHEN length(tree_sha256)=64 AND file_count=source_revision AND source_revision>0
        AND (expected_tree_sha256='' OR expected_tree_sha256=tree_sha256) THEN source_revision
      ELSE -1
    END,
    scan_status=CASE
      WHEN length(tree_sha256)=64 AND file_count=source_revision AND source_revision>0
        AND (expected_tree_sha256='' OR expected_tree_sha256=tree_sha256) THEN scan_status
      ELSE 'draft'
    END,
    viewer_approved=CASE
      WHEN length(tree_sha256)=64 AND file_count=source_revision AND source_revision>0
        AND (expected_tree_sha256='' OR expected_tree_sha256=tree_sha256) THEN viewer_approved
      ELSE 0
    END,
    viewer_approved_at=CASE
      WHEN length(tree_sha256)=64 AND file_count=source_revision AND source_revision>0
        AND (expected_tree_sha256='' OR expected_tree_sha256=tree_sha256) THEN viewer_approved_at
      ELSE NULL
    END;

-- Readiness is a claim about one exact, non-empty source generation. Keep the
-- invariant in D1 as well as in the API so a future write path cannot approve
-- an unscanned or mismatched generation.
CREATE TRIGGER archive_web_snapshots_validate_ready_insert
BEFORE INSERT ON archive_web_snapshots
WHEN (NEW.scan_status='ready' OR NEW.viewer_approved=1) AND (
  NEW.scan_status<>'ready' OR NEW.scan_revision<>NEW.source_revision OR NEW.source_revision<1
  OR length(NEW.tree_sha256)<>64 OR NEW.file_count<>NEW.source_revision
  OR (NEW.expected_tree_sha256<>'' AND NEW.expected_tree_sha256<>NEW.tree_sha256)
  OR (NEW.viewer_approved=1 AND NEW.mutation_token<>'')
)
BEGIN
  SELECT RAISE(ABORT,'archive web snapshot readiness requires a stable scanned source generation');
END;

CREATE TRIGGER archive_web_snapshots_validate_ready_update
BEFORE UPDATE OF scan_status,scan_revision,source_revision,viewer_approved,tree_sha256,file_count,expected_tree_sha256,mutation_token
ON archive_web_snapshots
WHEN (NEW.scan_status='ready' OR NEW.viewer_approved=1) AND (
  NEW.scan_status<>'ready' OR NEW.scan_revision<>NEW.source_revision OR NEW.source_revision<1
  OR length(NEW.tree_sha256)<>64 OR NEW.file_count<>NEW.source_revision
  OR (NEW.expected_tree_sha256<>'' AND NEW.expected_tree_sha256<>NEW.tree_sha256)
  OR (NEW.viewer_approved=1 AND NEW.mutation_token<>'')
)
BEGIN
  SELECT RAISE(ABORT,'archive web snapshot readiness requires a stable scanned source generation');
END;
