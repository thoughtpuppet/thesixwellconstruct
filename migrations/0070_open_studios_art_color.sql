PRAGMA foreign_keys = ON;

-- Open Studios is presented inside the Events branch, but its subject is the
-- art practice and studio. Keep its homepage pathway in the Art node color.
UPDATE construct_pathways
SET color = '#0039BD',
    updated_at = datetime('now')
WHERE id = 'path-events-08';
