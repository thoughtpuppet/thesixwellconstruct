PRAGMA foreign_keys = ON;

-- Promote Current Works to a top-level public doorway while preserving its
-- ownership under the About node.
UPDATE construct_pathways
SET name = 'Current Works + Projects',
    route = '/currently',
    updated_at = datetime('now')
WHERE id = 'path-about-current-works';

UPDATE construct_pathways
SET name = 'Saiel Dauhn Solehman',
    route = '/about/saieldauhnsolehman/',
    updated_at = datetime('now')
WHERE id = 'path-about-02';
