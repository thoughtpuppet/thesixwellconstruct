PRAGMA foreign_keys = ON;

ALTER TABLE archive_notes ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE archive_notes ADD COLUMN source_ever_published INTEGER NOT NULL DEFAULT 0;
UPDATE archive_notes SET source_ever_published=1 WHERE state='published' OR published_at IS NOT NULL;
CREATE TRIGGER archive_note_source_publication_insert AFTER INSERT ON archive_notes
WHEN NEW.state='published' OR NEW.published_at IS NOT NULL
BEGIN UPDATE archive_notes SET source_ever_published=1 WHERE entity_id=NEW.entity_id; END;
CREATE TRIGGER archive_note_source_publication_update AFTER UPDATE ON archive_notes
WHEN NEW.source_ever_published=0 AND (OLD.source_ever_published=1 OR NEW.state='published' OR NEW.published_at IS NOT NULL)
BEGIN UPDATE archive_notes SET source_ever_published=1 WHERE entity_id=NEW.entity_id; END;

CREATE TABLE archive_retrospective_comments (
  id TEXT PRIMARY KEY,
  owner_entity_id TEXT NOT NULL REFERENCES content_entities(id) ON DELETE RESTRICT,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('note','dossier','documentation','material','media')),
  target_id TEXT NOT NULL,
  field_key TEXT NOT NULL DEFAULT '',
  anchor_json TEXT NOT NULL DEFAULT '{}',
  source_fingerprint TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),
  author_name TEXT NOT NULL CHECK(length(author_name) BETWEEN 1 AND 160),
  author_entity_id TEXT REFERENCES content_entities(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  edited_at TEXT,
  review_required_at TEXT,
  target_revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_retrospective_comments_owner ON archive_retrospective_comments(owner_entity_id,state,created_at,id);
CREATE INDEX idx_retrospective_comments_target ON archive_retrospective_comments(target_kind,target_id,state);
CREATE TRIGGER archive_comment_note_deleted AFTER DELETE ON archive_notes
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='note' AND target_id=OLD.entity_id; END;
CREATE TRIGGER archive_comment_dossier_deleted AFTER DELETE ON archive_dossiers
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='dossier' AND target_id=OLD.entity_id; END;
CREATE TRIGGER archive_comment_documentation_deleted AFTER DELETE ON archive_catalogue_documentation
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='documentation' AND target_id=OLD.id; END;
CREATE TRIGGER archive_comment_material_deleted AFTER DELETE ON archive_materials
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='material' AND target_id=OLD.id; END;
CREATE TRIGGER archive_comment_media_deleted AFTER DELETE ON media_assets
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='media' AND target_id=OLD.id; END;

CREATE TABLE archive_comment_revisions (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES archive_retrospective_comments(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(comment_id,revision)
);
CREATE TRIGGER archive_comment_revision_no_update BEFORE UPDATE ON archive_comment_revisions
BEGIN SELECT RAISE(ABORT,'Comment revisions are append-only'); END;
CREATE TRIGGER archive_comment_revision_no_delete BEFORE DELETE ON archive_comment_revisions
BEGIN SELECT RAISE(ABORT,'Comment revisions are append-only'); END;

CREATE TABLE archive_source_corrections (
  id TEXT PRIMARY KEY,
  note_entity_id TEXT NOT NULL REFERENCES archive_notes(entity_id) ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  date_evidence TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(note_entity_id,source_revision)
);
CREATE TRIGGER archive_source_correction_no_update BEFORE UPDATE ON archive_source_corrections
BEGIN SELECT RAISE(ABORT,'Source corrections are append-only'); END;
CREATE TRIGGER archive_source_correction_no_delete BEFORE DELETE ON archive_source_corrections
BEGIN SELECT RAISE(ABORT,'Source corrections are append-only'); END;

-- Enforce preservation even when a caller bypasses the Studio form.
CREATE TRIGGER archive_published_source_guard BEFORE UPDATE ON archive_notes
WHEN (OLD.source_ever_published=1 OR OLD.published_at IS NOT NULL OR OLD.state='published') AND (
  NEW.body_markdown IS NOT OLD.body_markdown OR NEW.source_created_at IS NOT OLD.source_created_at OR
  NEW.source_modified_at IS NOT OLD.source_modified_at OR NEW.date_label IS NOT OLD.date_label
) AND NOT EXISTS (
  SELECT 1 FROM archive_source_corrections c
  WHERE c.note_entity_id=OLD.entity_id AND c.source_revision=OLD.source_revision+1
    AND NEW.source_revision=c.source_revision
    AND json_extract(c.before_json,'$.body_markdown') IS OLD.body_markdown
    AND json_extract(c.before_json,'$.source_created_at') IS OLD.source_created_at
    AND json_extract(c.before_json,'$.source_modified_at') IS OLD.source_modified_at
    AND json_extract(c.before_json,'$.date_label') IS OLD.date_label
    AND json_extract(c.after_json,'$.body_markdown') IS NEW.body_markdown
    AND json_extract(c.after_json,'$.source_created_at') IS NEW.source_created_at
    AND json_extract(c.after_json,'$.source_modified_at') IS NEW.source_modified_at
    AND json_extract(c.after_json,'$.date_label') IS NEW.date_label
)
BEGIN SELECT RAISE(ABORT,'Use Correct source with a reason and current source revision'); END;

-- A later return to identical wording must not silently reactivate an attachment.
-- This is target health, not a rewrite of authored comment content/dates.
CREATE TRIGGER archive_comment_note_changed AFTER UPDATE OF body_markdown ON archive_notes
WHEN NEW.body_markdown IS NOT OLD.body_markdown
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='note' AND target_id=OLD.entity_id; END;
CREATE TRIGGER archive_comment_story_changed AFTER UPDATE OF story,orientation ON archive_dossiers
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='dossier' AND target_id=OLD.entity_id AND ((field_key='story' AND NEW.story IS NOT OLD.story) OR (field_key='orientation' AND NEW.orientation IS NOT OLD.orientation)); END;
CREATE TRIGGER archive_comment_documentation_changed AFTER UPDATE OF value ON archive_catalogue_documentation
WHEN NEW.value IS NOT OLD.value
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='documentation' AND target_id=OLD.id; END;
CREATE TRIGGER archive_comment_material_changed AFTER UPDATE OF body,media_id ON archive_materials
WHEN NEW.body IS NOT OLD.body OR NEW.media_id IS NOT OLD.media_id
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='material' AND target_id=OLD.id; END;
CREATE TRIGGER archive_comment_media_changed AFTER UPDATE OF storage_key,source_url,mime_type,byte_size,width,height,duration_seconds ON media_assets
WHEN NEW.storage_key IS NOT OLD.storage_key OR NEW.source_url IS NOT OLD.source_url OR NEW.mime_type IS NOT OLD.mime_type OR NEW.byte_size IS NOT OLD.byte_size OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height OR NEW.duration_seconds IS NOT OLD.duration_seconds
BEGIN UPDATE archive_retrospective_comments SET target_revision=target_revision+1,review_required_at=COALESCE(review_required_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE target_kind='media' AND target_id=OLD.id; END;
