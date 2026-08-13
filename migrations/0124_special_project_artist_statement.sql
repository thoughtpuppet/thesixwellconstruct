-- Keep the concise project summary separate from the artist's longer account
-- of the work, its symbols, and its development.
ALTER TABLE special_project_calls
ADD COLUMN artist_statement TEXT NOT NULL DEFAULT '';

-- SELF/FAITH's existing summary is the artist statement. Move that managed
-- content into the dedicated field without affecting other project summaries.
UPDATE special_project_calls
SET artist_statement = summary,
    summary = ''
WHERE (id = 'self-faith' OR slug = 'self-faith')
  AND artist_statement = ''
  AND summary LIKE 'This is part of the Classic Cliches series where I reimagine and reorient tattoo imagery%';
