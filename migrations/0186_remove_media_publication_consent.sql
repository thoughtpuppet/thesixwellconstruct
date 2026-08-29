PRAGMA defer_foreign_keys = ON;

-- Drop only schema objects that name the obsolete publication-consent fields.
DROP TRIGGER IF EXISTS archive_material_privacy_insert;
DROP TRIGGER IF EXISTS archive_material_privacy_update;
DROP TRIGGER IF EXISTS archive_media_privacy_update;
DROP TRIGGER IF EXISTS archive_source_material_fragment_insert;
DROP TRIGGER IF EXISTS archive_source_material_fragment_update;
DROP TRIGGER IF EXISTS portfolio_published_cover_item_guard;
DROP TRIGGER IF EXISTS portfolio_published_cover_media_guard;

ALTER TABLE media_assets DROP COLUMN consent_status;
ALTER TABLE media_upload_sessions DROP COLUMN consent_status;
ALTER TABLE portfolio_items DROP COLUMN primary_consent_status;
ALTER TABLE archive_source_material_sets DROP COLUMN permission_status;

-- Archive material search fragments follow the same explicit media contract as
-- public delivery: active + public + inline, with the owning dossier/material
-- independently published and visible.
CREATE TRIGGER archive_material_privacy_update
AFTER UPDATE ON archive_materials BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='material' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||NEW.id,NEW.dossier_entity_id,'material',NEW.id,NEW.title,
    trim(NEW.caption||' '||NEW.body||' '||CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END),
    'material-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN media_assets m ON m.id=NEW.media_id
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND ce.visibility='public' AND NEW.state='published' AND NEW.visibility='public'
    AND (NEW.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline'));
END;

CREATE TRIGGER archive_material_privacy_insert
AFTER INSERT ON archive_materials BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||NEW.id,NEW.dossier_entity_id,'material',NEW.id,NEW.title,
    trim(NEW.caption||' '||NEW.body||' '||CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END),
    'material-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN media_assets m ON m.id=NEW.media_id
  WHERE ad.entity_id=NEW.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
    AND ce.visibility='public' AND NEW.state='published' AND NEW.visibility='public'
    AND (NEW.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline'));
END;

CREATE TRIGGER archive_media_privacy_update
AFTER UPDATE OF state,privacy,transcript,transcript_status,public_presentation ON media_assets BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='material' AND source_id IN (SELECT id FROM archive_materials WHERE media_id=NEW.id);
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-material-'||am.id,am.dossier_entity_id,'material',am.id,am.title,
    trim(am.caption||' '||am.body||' '||CASE WHEN NEW.transcript_status='ready' THEN NEW.transcript ELSE '' END),
    'material-'||am.id,1,datetime('now')
  FROM archive_materials am
  JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE am.media_id=NEW.id AND am.state='published' AND am.visibility='public'
    AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    AND NEW.state='active' AND NEW.privacy='public' AND NEW.public_presentation='inline';
END;

CREATE TRIGGER archive_source_material_fragment_insert
AFTER INSERT ON archive_source_material_sets BEGIN
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES(
    'archive-source-material-'||replace(NEW.id,'/','-'),NEW.dossier_entity_id,'source-material',NEW.id,
    COALESCE(NULLIF(NEW.title,''),CASE NEW.source_kind WHEN 'blackboard' THEN 'Blackboard source' ELSE 'Client correspondence' END),
    NEW.caption,'source-material-'||replace(NEW.id,'/','-'),
    CASE WHEN NEW.publication_state='published' AND NEW.visibility='public' THEN 1 ELSE 0 END,
    NEW.updated_at
  );
END;

CREATE TRIGGER archive_source_material_fragment_update
AFTER UPDATE ON archive_source_material_sets BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.dossier_entity_id AND fragment_type='source-material' AND source_id=OLD.id;
  INSERT OR REPLACE INTO archive_search_fragments
    (id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  VALUES(
    'archive-source-material-'||replace(NEW.id,'/','-'),NEW.dossier_entity_id,'source-material',NEW.id,
    COALESCE(NULLIF(NEW.title,''),CASE NEW.source_kind WHEN 'blackboard' THEN 'Blackboard source' ELSE 'Client correspondence' END),
    trim(NEW.caption||' '||COALESCE((
      SELECT group_concat(trim(title||' '||caption||' '||body),' ')
      FROM archive_source_material_entries
      WHERE source_material_set_id=NEW.id AND public_included=1
    ),'')),
    'source-material-'||replace(NEW.id,'/','-'),
    CASE WHEN NEW.publication_state='published' AND NEW.visibility='public' THEN 1 ELSE 0 END,
    NEW.updated_at
  );
END;

-- A legacy primary is public only when Studio explicitly includes it. Gallery
-- covers continue to rely on their attachment-level public flag.
CREATE TRIGGER portfolio_published_cover_item_guard
BEFORE UPDATE OF state,cover_image_ref,primary_public_visible ON portfolio_items
WHEN NEW.state='published' AND (
  (
    NEW.cover_image_ref='primary'
    AND (
      NEW.primary_public_visible<>1
      OR COALESCE((
        SELECT image_role FROM portfolio_image_details
        WHERE portfolio_item_id=NEW.id AND image_ref='primary'
      ),'result')<>'result'
    )
  )
  OR (
    NEW.cover_image_ref<>'primary'
    AND NOT EXISTS (
      SELECT 1
      FROM entity_media em
      JOIN media_assets m ON m.id=em.media_id
      LEFT JOIN portfolio_image_details pid
        ON pid.portfolio_item_id=em.entity_id AND pid.image_ref=em.media_id
      WHERE em.entity_id=NEW.id AND em.media_id=NEW.cover_image_ref
        AND em.role='gallery' AND em.public_visible=1
        AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
        AND COALESCE(pid.image_role,'result')='result'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'published portfolio cover must remain eligible');
END;

CREATE TRIGGER portfolio_published_cover_media_guard
BEFORE UPDATE OF state,privacy,public_presentation ON media_assets
WHEN (
  NEW.state<>'active' OR NEW.privacy<>'public' OR NEW.public_presentation<>'inline'
) AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  JOIN entity_media em ON em.entity_id=pi.id AND em.media_id=NEW.id AND em.role='gallery'
  WHERE pi.state='published' AND pi.cover_image_ref=NEW.id
)
BEGIN
  SELECT RAISE(ABORT,'published portfolio cover must remain eligible');
END;

-- Rebuild derived fragments under the new visibility contract.
UPDATE archive_materials SET updated_at=updated_at;
UPDATE archive_source_material_sets SET updated_at=updated_at;
