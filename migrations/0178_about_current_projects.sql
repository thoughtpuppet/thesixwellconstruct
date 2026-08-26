PRAGMA foreign_keys = ON;

CREATE TABLE about_current_projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  context_line TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status_label TEXT NOT NULL DEFAULT '',
  medium_key TEXT NOT NULL DEFAULT 'about'
    CHECK(medium_key IN ('about','art','merch','tattooing','events','writings','archive','film','music')),
  links_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(links_json)),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired','archived')),
  collage_slot INTEGER NOT NULL DEFAULT 0 CHECK(collage_slot BETWEEN 0 AND 5),
  focal_x INTEGER NOT NULL DEFAULT 50 CHECK(focal_x BETWEEN 0 AND 100),
  focal_y INTEGER NOT NULL DEFAULT 50 CHECK(focal_y BETWEEN 0 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_about_current_projects_public
  ON about_current_projects(state,sort_order,id);
CREATE UNIQUE INDEX idx_about_current_projects_collage_slot
  ON about_current_projects(collage_slot) WHERE collage_slot > 0 AND state <> 'archived';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('current-project-academic-study','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-construct-archive','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-thoughtpuppet','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-sixwell-clothing','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-artpill','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-cultural-research','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now')),
  ('current-project-events','current_project','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO about_current_projects
  (id,slug,category,title,context_line,summary,status_label,medium_key,links_json,state,collage_slot,focal_x,focal_y,sort_order,created_at,updated_at)
VALUES
  ('current-project-academic-study','academic-study','Academic Study','Philosophy, Politics & Economics','Georgia State University · Ongoing','A present course of study bringing additional language, historical context, and analytical frameworks into the questions and systems already moving through the practice.','Ongoing','about','[{"label":"Academic context","url":"/about/saieldauhnsolehman/"}]','published',0,50,50,1,datetime('now'),datetime('now')),
  ('current-project-construct-archive','construct-archive','Construct System','The Six.Well Construct + Archive','Active','Building the public creative ecosystem and the record system that preserves its works, relationships, states, and origins.','Active','archive','[{"label":"The Construct","url":"/about/"},{"label":"Archive","url":"/archive/"}]','published',0,50,50,2,datetime('now'),datetime('now')),
  ('current-project-thoughtpuppet','thoughtpuppet','Visual Art','ThoughtPuppet','In studio','Paintings, objects, studies, and visual-language research that feed the wider Construct.','In studio','art','[{"label":"View visual art","url":"/art/"}]','published',0,50,50,3,datetime('now'),datetime('now')),
  ('current-project-sixwell-clothing','sixwell-clothing','Clothing + Objects','Six.Well Clothing','In development','Garments, editions, and physical artifacts carrying Construct imagery and thought into the world.','In development','merch','[{"label":"View Six.Well Clothing","url":"/merch/?filter=six.well"}]','published',0,50,50,4,datetime('now'),datetime('now')),
  ('current-project-artpill','artpill-tattoo-house','Tattoo Practice','Art.Pill Tattoo House','Active','Tattooing, symbolic mark-making, flash, and special projects rooted in care, boundaries, and interpretation.','Active','tattooing','[{"label":"Tattoo practice","url":"/tattoos/"},{"label":"Special projects","url":"/tattoos/special-projects/"}]','published',0,50,50,5,datetime('now'),datetime('now')),
  ('current-project-cultural-research','cultural-research-discovery','Cultural Research + Discovery','Signal & Symbol + Atlanta Creative Calendar','Active','Signal & Symbol develops cultural research through guided creative gatherings. The Atlanta Creative Calendar supports discovery and connection through day/night itinerary planning. Mindful Darkness remains the potential platform for writing and discussion around what emerges.','Active','events','[{"label":"Signal & Symbol","url":"/events/signal-symbol/"},{"label":"Atlanta Creative Calendar","url":"/calendar/"},{"label":"Mindful Darkness","url":"/writings/#reading-paths"}]','published',0,50,50,6,datetime('now'),datetime('now')),
  ('current-project-events','solehmans-new-year-cult-shift','Events','Solehman’s New Year + CULT[&SHIFT]','Forthcoming','Solehman’s New Year is one four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing. CULT[&SHIFT] holds community shows, performances, and shared experiments.','Forthcoming','events','[{"label":"Solehman’s New Year","url":"/events/solehmans-new-year/"},{"label":"CULT[&SHIFT]","url":"/events/cultandshift/"}]','published',0,50,50,7,datetime('now'),datetime('now'));

-- Put the living Current Works layer first in the ABOUT constellation without
-- replacing any of its existing pathways.
UPDATE construct_pathways
SET sort_order = CASE route
  WHEN '/about/#construct' THEN 2
  WHEN '/about/#saiel' THEN 3
  WHEN '/about/#construct-architecture' THEN 4
  WHEN '/about/#access' THEN 5
  WHEN '/about/#library' THEN 6
  WHEN '/about/#faq' THEN 7
  WHEN '/about/legend/' THEN 8
  WHEN '/about/exhibitions-appearances/' THEN 9
  ELSE sort_order END,
  updated_at=datetime('now')
WHERE node_id='node-about';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('path-about-current-works','construct_pathway','node-about','public',0,datetime('now'),'migration-0178','migration-0178',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO construct_pathways
  (id,node_id,name,route,color,state,homepage_enabled,sort_order,created_at,updated_at)
VALUES
  ('path-about-current-works','node-about','Current Works','/about/current-state/','#FCB467','published',1,1,datetime('now'),datetime('now'));

PRAGMA foreign_keys = ON;
