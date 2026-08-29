PRAGMA foreign_keys = ON;

-- Theme fragments follow the same publication matrix as every other Archive
-- search fragment. Keeping the index trigger-driven makes a dossier's
-- unpublish/republish cycle complete and prevents Studio edits from indexing
-- themes for a draft or non-public owner.
DROP TRIGGER IF EXISTS archive_entity_term_theme_insert;
CREATE TRIGGER archive_entity_term_theme_insert
AFTER INSERT ON entity_terms
WHEN EXISTS(
  SELECT 1 FROM taxonomy_terms
  WHERE id=NEW.term_id AND kind='theme'
)
BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(
    id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
  )
  SELECT 'archive-fragment-theme-'||NEW.entity_id||'-'||tt.id,
    NEW.entity_id,'theme',tt.id,tt.name,tt.description,'story',1,datetime('now')
  FROM taxonomy_terms tt
  JOIN archive_dossiers ad ON ad.entity_id=NEW.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE tt.id=NEW.term_id
    AND tt.kind='theme'
    AND tt.public_visible=1
    AND ad.state='published'
    AND ad.public_visible=1
    AND ce.visibility='public';
END;

DROP TRIGGER IF EXISTS archive_entity_term_theme_update;
CREATE TRIGGER archive_entity_term_theme_update
AFTER UPDATE OF entity_id,term_id ON entity_terms
BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.entity_id
    AND fragment_type='theme'
    AND source_id=OLD.term_id;

  INSERT OR REPLACE INTO archive_search_fragments(
    id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
  )
  SELECT 'archive-fragment-theme-'||NEW.entity_id||'-'||tt.id,
    NEW.entity_id,'theme',tt.id,tt.name,tt.description,'story',1,datetime('now')
  FROM taxonomy_terms tt
  JOIN archive_dossiers ad ON ad.entity_id=NEW.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE tt.id=NEW.term_id
    AND tt.kind='theme'
    AND tt.public_visible=1
    AND ad.state='published'
    AND ad.public_visible=1
    AND ce.visibility='public';
END;

DROP TRIGGER IF EXISTS archive_entity_term_theme_delete;
CREATE TRIGGER archive_entity_term_theme_delete
AFTER DELETE ON entity_terms
BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=OLD.entity_id
    AND fragment_type='theme'
    AND source_id=OLD.term_id;
END;

DROP TRIGGER IF EXISTS archive_taxonomy_theme_update;
CREATE TRIGGER archive_taxonomy_theme_update
AFTER UPDATE OF id,kind,name,description,public_visible ON taxonomy_terms
BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='theme' AND source_id=OLD.id;

  INSERT OR REPLACE INTO archive_search_fragments(
    id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
  )
  SELECT 'archive-fragment-theme-'||et.entity_id||'-'||NEW.id,
    et.entity_id,'theme',NEW.id,NEW.name,NEW.description,'story',1,datetime('now')
  FROM entity_terms et
  JOIN archive_dossiers ad ON ad.entity_id=et.entity_id
  JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE et.term_id=NEW.id
    AND NEW.kind='theme'
    AND NEW.public_visible=1
    AND ad.state='published'
    AND ad.public_visible=1
    AND ce.visibility='public';
END;

DROP TRIGGER IF EXISTS archive_taxonomy_theme_delete;
CREATE TRIGGER archive_taxonomy_theme_delete
AFTER DELETE ON taxonomy_terms
BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type='theme' AND source_id=OLD.id;
END;

DROP TRIGGER IF EXISTS archive_dossier_theme_fragment_insert;
CREATE TRIGGER archive_dossier_theme_fragment_insert
AFTER INSERT ON archive_dossiers
BEGIN
  INSERT OR REPLACE INTO archive_search_fragments(
    id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
  )
  SELECT 'archive-fragment-theme-'||NEW.entity_id||'-'||tt.id,
    NEW.entity_id,'theme',tt.id,tt.name,tt.description,'story',1,datetime('now')
  FROM entity_terms et
  JOIN taxonomy_terms tt ON tt.id=et.term_id
  JOIN content_entities ce ON ce.id=NEW.entity_id
  WHERE et.entity_id=NEW.entity_id
    AND tt.kind='theme'
    AND tt.public_visible=1
    AND NEW.state='published'
    AND NEW.public_visible=1
    AND ce.visibility='public';
END;

DROP TRIGGER IF EXISTS archive_dossier_theme_fragment_update;
CREATE TRIGGER archive_dossier_theme_fragment_update
AFTER UPDATE OF state,public_visible ON archive_dossiers
BEGIN
  DELETE FROM archive_search_fragments
  WHERE dossier_entity_id=NEW.entity_id AND fragment_type='theme';

  INSERT OR REPLACE INTO archive_search_fragments(
    id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
  )
  SELECT 'archive-fragment-theme-'||NEW.entity_id||'-'||tt.id,
    NEW.entity_id,'theme',tt.id,tt.name,tt.description,'story',1,datetime('now')
  FROM entity_terms et
  JOIN taxonomy_terms tt ON tt.id=et.term_id
  JOIN content_entities ce ON ce.id=NEW.entity_id
  WHERE et.entity_id=NEW.entity_id
    AND tt.kind='theme'
    AND tt.public_visible=1
    AND NEW.state='published'
    AND NEW.public_visible=1
    AND ce.visibility='public';
END;

-- Reconcile legacy rows once under the hardened publication matrix.
DELETE FROM archive_search_fragments WHERE fragment_type='theme';

INSERT OR REPLACE INTO archive_search_fragments(
  id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at
)
SELECT 'archive-fragment-theme-'||et.entity_id||'-'||tt.id,
  et.entity_id,'theme',tt.id,tt.name,tt.description,'story',1,datetime('now')
FROM entity_terms et
JOIN taxonomy_terms tt ON tt.id=et.term_id
JOIN archive_dossiers ad ON ad.entity_id=et.entity_id
JOIN content_entities ce ON ce.id=ad.entity_id
WHERE tt.kind='theme'
  AND tt.public_visible=1
  AND ad.state='published'
  AND ad.public_visible=1
  AND ce.visibility='public';
