PRAGMA foreign_keys = ON;

CREATE TABLE writing_entries (
  entity_id TEXT PRIMARY KEY REFERENCES content_entities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  published_json TEXT CHECK(published_json IS NULL OR json_valid(published_json)),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  first_published_at TEXT,
  published_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state <> 'published' OR (published_json IS NOT NULL AND first_published_at IS NOT NULL AND is_sample=0))
);
CREATE INDEX idx_writing_entries_public ON writing_entries(state,first_published_at DESC,entity_id);

-- Every API write supplies the next version. A competing save rolls back the
-- entire publication batch, including media, search, relationships, and history.
CREATE TRIGGER writing_entries_version_guard BEFORE UPDATE ON writing_entries
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'WRKNG version conflict'); END;
CREATE TRIGGER writing_entries_slug_guard BEFORE UPDATE OF slug ON writing_entries
WHEN OLD.first_published_at IS NOT NULL AND NEW.slug <> OLD.slug
BEGIN SELECT RAISE(ABORT,'A published WRKNG URL cannot change'); END;

CREATE TRIGGER writing_entity_publication_guard BEFORE UPDATE OF visibility ON content_entities
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM writing_entries w WHERE w.entity_id=NEW.id AND w.state<>'published')
BEGIN SELECT RAISE(ABORT,'Publish this entry through WRKNG before exposing its entity'); END;

CREATE TRIGGER writing_publication_reference_guard BEFORE UPDATE OF published_json,state ON writing_entries
WHEN NEW.state='published'
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_tree(NEW.published_json,'$.body') j
    WHERE j.key='mediaId' AND NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=j.value
      AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
      AND m.mime_type IN ('image/jpeg','image/png','image/webp','image/gif')
      AND NOT EXISTS(SELECT 1 FROM media_asset_variants v WHERE v.master_media_id=m.id)))
    THEN RAISE(ABORT,'WRKNG publication conflict: an image is no longer available') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.published_json,'$.relatedIds') j
    WHERE NOT EXISTS(SELECT 1 FROM content_entities ce WHERE ce.id=j.value AND ce.visibility='public'))
    THEN RAISE(ABORT,'WRKNG publication conflict: a related record is no longer public') END;
END;

-- Published image references remain valid even when media is edited elsewhere.
CREATE TRIGGER writing_media_publication_guard BEFORE UPDATE ON media_assets
WHEN (NEW.state <> 'active' OR NEW.privacy <> 'public' OR NEW.public_presentation <> 'inline'
  OR NEW.storage_key IS NOT OLD.storage_key OR NEW.source_url IS NOT OLD.source_url OR NEW.mime_type <> OLD.mime_type)
  AND EXISTS(SELECT 1 FROM writing_entries w, json_tree(w.published_json,'$.body') j
    WHERE w.state='published' AND j.key='mediaId' AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Unpublish the WRKNG entry or publish its replacement image first'); END;
CREATE TRIGGER writing_media_delete_guard BEFORE DELETE ON media_assets
WHEN EXISTS(SELECT 1 FROM writing_entries w, json_tree(w.published_json,'$.body') j
  WHERE w.state='published' AND j.key='mediaId' AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Unpublish the WRKNG entry or publish its replacement image first'); END;
CREATE TRIGGER writing_entity_media_delete_guard BEFORE DELETE ON entity_media
WHEN OLD.role='writing-inline' AND EXISTS(SELECT 1 FROM writing_entries w, json_tree(w.published_json,'$.body') j
  WHERE w.entity_id=OLD.entity_id AND w.state='published' AND j.key='mediaId' AND j.value=OLD.media_id)
BEGIN SELECT RAISE(ABORT,'Publish the WRKNG entry without this image before detaching it'); END;
CREATE TRIGGER writing_entity_media_update_guard BEFORE UPDATE ON entity_media
WHEN OLD.role='writing-inline' AND (NEW.role<>OLD.role OR NEW.public_visible<>1 OR NEW.media_id<>OLD.media_id OR NEW.entity_id<>OLD.entity_id)
  AND EXISTS(SELECT 1 FROM writing_entries w, json_tree(w.published_json,'$.body') j
    WHERE w.entity_id=OLD.entity_id AND w.state='published' AND j.key='mediaId' AND j.value=OLD.media_id)
BEGIN SELECT RAISE(ABORT,'Publish the WRKNG entry without this image before detaching it'); END;

UPDATE construct_pathways SET name='Mindful Darkness',route='/writings/mindful-darkness/',sort_order=1,updated_at=datetime('now')
WHERE id='path-writings-01';
UPDATE construct_pathways SET name='WRKNG*',route='/writings/mindful-darkness/wrkng/',sort_order=2,state='published',homepage_enabled=1,updated_at=datetime('now')
WHERE id='path-writings-03';
UPDATE construct_pathways SET sort_order=3,updated_at=datetime('now') WHERE id='path-writings-02';
UPDATE about_current_projects SET links_json=replace(links_json,'/writings/#reading-paths','/writings/mindful-darkness/'),updated_at=datetime('now')
WHERE links_json LIKE '%/writings/#reading-paths%';

INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
VALUES('writing-layout-sample','writing_work','node-writings','internal',0,'migration-0227','migration-0227',datetime('now'),datetime('now'));
INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,width,height,alt_text,caption,privacy,state,public_presentation,archive_catalogue_eligible,created_by,created_at,updated_at)
VALUES('writing-layout-sample-image','/api/admin/writing-entries/sample-image','reading-layout-sample.svg','image/svg+xml',0,1000,600,'A simple frame marking the place for an entry image.','Sample image for the reading layout.','internal','active','hidden',0,'migration-0227',datetime('now'),datetime('now'));
INSERT INTO entity_media(entity_id,media_id,role,public_visible,created_at)
VALUES('writing-layout-sample','writing-layout-sample-image','writing-draft',0,datetime('now'));
INSERT INTO writing_entries(entity_id,slug,draft_json,is_sample,created_at,updated_at)
VALUES('writing-layout-sample','reading-layout-sample','{"schemaVersion":1,"title":"Reading layout sample","author":"Saiel Dauhn Solehman","excerpt":"Placeholder text for establishing the WRKNG* reading layout.","body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This is placeholder text. It exists to establish the rhythm of a paragraph, the space around an image, and the way a longer piece reads on the page."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"A question to begin with"}]},{"type":"paragraph","content":[{"type":"text","text":"A piece might begin with "},{"type":"text","text":"an observation","marks":[{"type":"bold"}]},{"type":"text","text":" and leave space for "},{"type":"text","text":"uncertainty","marks":[{"type":"italic"}]},{"type":"text","text":". These sentences are layout samples, ready to be replaced by an actual entry."}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"A quotation has room to pause inside the reading flow. This quotation is placeholder text."}]}]},{"type":"writingImage","attrs":{"mediaId":"writing-layout-sample-image","alt":"A simple frame marking the place for an entry image.","caption":"Sample image for the reading layout."}},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Following the thought"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"An observation to return to."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"A connection to investigate."}]}]}]},{"type":"orderedList","attrs":{"start":1},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Describe what you noticed."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Revisit what you think it means."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"An entry can also connect to "},{"type":"text","text":"the Archive","marks":[{"type":"link","attrs":{"href":"/archive/"}}]},{"type":"text","text":". This final paragraph tests the return from lists and images to the ordinary reading rhythm."}]}]},"sources":[{"label":"Sample reference — the Construct Archive","url":"/archive/"}],"relatedIds":[]}',1,datetime('now'),datetime('now'));
