PRAGMA foreign_keys = ON;

UPDATE about_current_projects
SET title = 'Participatory Tattoo Systems',
    context_line = 'Active · Maze Builder, Build Your Own + Special Projects',
    summary = 'I’m developing three connected ways for tattoos to begin—through participant-led play, structured collaboration, and artist-led inquiry. Together, they explore how authorship, interpretation, trust, and personal meaning can move differently through the tattoo process. Maze Builder — An interactive drawing environment where participants create paths, symbols, and visual relationships that can become the foundation of a tattoo. I’m interested in what appears when play and intuition come before a fixed image. Build Your Own — A guided system for assembling references, meanings, placement, and visual ingredients into a collaborative tattoo brief. It gives people a clearer way into custom work while preserving interpretation as part of my practice. Special Projects — Artist-led tattoo inquiries organized around specific images, techniques, questions, or relationships to the body. These projects create space for experiments that cannot emerge through a conventional commission process.',
    links_json = '[{"label":"Maze Builder","url":"/tattoos/build/maze/"},{"label":"Build Your Own","url":"/tattoos/build/"},{"label":"Special Projects","url":"/tattoos/special-projects/"}]',
    updated_at = datetime('now')
WHERE id = 'current-project-artpill';
