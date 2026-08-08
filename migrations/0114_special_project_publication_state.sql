-- Give individual Special Projects an editorial lifecycle separate from whether
-- their applications are open or closed. Existing visibility is preserved.

ALTER TABLE special_project_calls
ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft'
CHECK (publication_state IN ('draft','published'));

UPDATE special_project_calls
SET publication_state = CASE
  WHEN EXISTS (
    SELECT 1
    FROM content_entities entity
    WHERE entity.id = special_project_calls.id
      AND entity.entity_type = 'special_project'
      AND entity.visibility = 'public'
  ) THEN 'published'
  ELSE 'draft'
END;
