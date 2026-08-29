PRAGMA foreign_keys = ON;

ALTER TABLE about_current_projects
  ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]';

UPDATE about_current_projects
SET items_json = '[{"title":"The Six.Well Construct","description":"The public-facing architecture connecting the practice’s mediums, projects, offerings, and pathways."},{"title":"Archive","description":"The record system preserving works, relationships, states, origins, and the context that moves between them."}]',
    updated_at = datetime('now')
WHERE id = 'current-project-construct-archive';

UPDATE about_current_projects
SET items_json = '[{"title":"Maze Builder","description":"An interactive drawing environment where participants create paths, symbols, and visual relationships that can become the foundation of a tattoo."},{"title":"Build Your Own","description":"A guided system for assembling references, meanings, placement, and visual ingredients into a collaborative tattoo brief."},{"title":"Special Projects","description":"Artist-led tattoo inquiries organized around specific images, techniques, questions, or relationships to the body."}]',
    updated_at = datetime('now')
WHERE id = 'current-project-artpill';

UPDATE about_current_projects
SET summary = 'Signal & Symbol develops cultural research through guided creative gatherings. The Atlanta Creative Calendar supports discovery and connection, while Night Planning shapes those discoveries into one chronological day/night itinerary.',
    items_json = '[{"title":"Signal & Symbol","description":"Develops cultural research through guided creative gatherings."},{"title":"Atlanta Creative Calendar","description":"Supports discovery and connection across Atlanta art, film, poetry, music, technology, and experimental events."},{"title":"Night Planning","description":"Builds one chronological day/night itinerary from standalone events and related programs, with Include and Must Attend choices."}]',
    links_json = '[{"label":"Signal & Symbol","url":"/events/signal-symbol/"},{"label":"Atlanta Creative Calendar","url":"/calendar/"}]',
    updated_at = datetime('now')
WHERE id = 'current-project-cultural-research';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('current-project-solehman-letters','current_project','node-writings','public',0,datetime('now'),'migration-0195','migration-0195',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO about_current_projects
  (id,slug,category,title,context_line,summary,items_json,status_label,medium_key,links_json,state,collage_slot,focal_x,focal_y,sort_order,created_at,updated_at)
VALUES
  ('current-project-solehman-letters','solehman-letters','Writing + Publishing','The Solehman Letters + Mindful Darkness','Ongoing · Newsletter + writing platform','Two connected publishing spaces for letters, essays, studio notes, reflections, and discussion moving through the Construct.','[{"title":"The Solehman Letters","description":"A direct publishing channel for letters, essays, studio notes, and reflections moving through the Construct."},{"title":"Mindful Darkness","description":"A developing space for essays, reflections, and discussion around what emerges through the practice."}]','Ongoing','writings','[{"label":"Read The Solehman Letters","url":"https://www.solehmanletters.com/"},{"label":"Mindful Darkness","url":"/writings/#reading-paths"}]','published',0,50,50,7,datetime('now'),datetime('now'));

UPDATE about_current_projects
SET sort_order = 8,
    updated_at = datetime('now')
WHERE id = 'current-project-events';

UPDATE construct_pathways
SET route = 'https://www.solehmanletters.com/',
    updated_at = datetime('now')
WHERE node_id = 'node-writings'
  AND name = 'THE SOLEHMAN LETTERS';

UPDATE about_current_projects
SET items_json = '[{"title":"Solehman’s New Year","description":"A four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing."},{"title":"CULT[&SHIFT]","description":"Holds community shows, performances, and shared experiments."}]',
    updated_at = datetime('now')
WHERE id = 'current-project-events';
