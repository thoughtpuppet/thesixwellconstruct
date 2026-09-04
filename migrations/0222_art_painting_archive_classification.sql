PRAGMA foreign_keys = ON;

-- content_entities creates the private Archive shell before the art_works row
-- exists, so its catalogue identity must begin conservatively as art-other.
-- Once the Art Work and its medium exist, refine only untouched automatic
-- classifications. Deliberate Studio catalogue choices remain authoritative.
DROP TRIGGER IF EXISTS archive_art_work_catalogue_insert;
CREATE TRIGGER archive_art_work_catalogue_insert
AFTER INSERT ON art_works
WHEN (
    lower(COALESCE(NEW.medium,'')) LIKE '%paint%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%acrylic%'
    OR (' '||lower(replace(replace(replace(replace(replace(COALESCE(NEW.medium,''),'/',' '),',',' '),';',' '),'+',' '),'&',' '))||' ') LIKE '% oil %'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%watercolor%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%watercolour%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%gouache%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%tempera%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%encaustic%'
  )
BEGIN
  UPDATE archive_catalogue_entries
  SET object_type_id='art-painting',
    updated_by='archive-art-classification',
    updated_at=datetime('now')
  WHERE entity_id=NEW.id
    AND object_type_id='art-other'
    AND updated_by='archive-structure-trigger';
END;

-- A draft may be created before its medium is known. Refinement remains safe
-- only while the catalogue entry still carries the untouched trigger marker.
DROP TRIGGER IF EXISTS archive_art_work_catalogue_medium_update;
CREATE TRIGGER archive_art_work_catalogue_medium_update
AFTER UPDATE OF medium ON art_works
WHEN (
    lower(COALESCE(NEW.medium,'')) LIKE '%paint%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%acrylic%'
    OR (' '||lower(replace(replace(replace(replace(replace(COALESCE(NEW.medium,''),'/',' '),',',' '),';',' '),'+',' '),'&',' '))||' ') LIKE '% oil %'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%watercolor%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%watercolour%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%gouache%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%tempera%'
    OR lower(COALESCE(NEW.medium,'')) LIKE '%encaustic%'
  )
BEGIN
  UPDATE archive_catalogue_entries
  SET object_type_id='art-painting',
    updated_by='archive-art-classification',
    updated_at=datetime('now')
  WHERE entity_id=NEW.id
    AND object_type_id='art-other'
    AND updated_by='archive-structure-trigger';
END;

-- Repair the same untouched automatic classifications already created in
-- production. ART catalogue prefixes, sequence numbers, IDs, versions, and
-- states are intentionally preserved.
UPDATE archive_catalogue_entries
SET object_type_id='art-painting',
  updated_by='migration-0222',
  updated_at=datetime('now')
WHERE object_type_id='art-other'
  AND updated_by='archive-structure-trigger'
  AND EXISTS(
    SELECT 1
    FROM content_entities entity
    JOIN art_works art ON art.id=entity.id
    WHERE entity.id=archive_catalogue_entries.entity_id
      AND entity.entity_type='art_work'
      AND (
        lower(COALESCE(art.medium,'')) LIKE '%paint%'
        OR lower(COALESCE(art.medium,'')) LIKE '%acrylic%'
        OR (' '||lower(replace(replace(replace(replace(replace(COALESCE(art.medium,''),'/',' '),',',' '),';',' '),'+',' '),'&',' '))||' ') LIKE '% oil %'
        OR lower(COALESCE(art.medium,'')) LIKE '%watercolor%'
        OR lower(COALESCE(art.medium,'')) LIKE '%watercolour%'
        OR lower(COALESCE(art.medium,'')) LIKE '%gouache%'
        OR lower(COALESCE(art.medium,'')) LIKE '%tempera%'
        OR lower(COALESCE(art.medium,'')) LIKE '%encaustic%'
      )
  );
