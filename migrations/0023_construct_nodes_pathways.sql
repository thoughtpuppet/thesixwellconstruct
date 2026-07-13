PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS construct_nodes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, route TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired','archived')), homepage_enabled INTEGER NOT NULL DEFAULT 0 CHECK(homepage_enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS construct_pathways (
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL, name TEXT NOT NULL, route TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('draft','published','retired','archived')), homepage_enabled INTEGER NOT NULL DEFAULT 1 CHECK(homepage_enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE, FOREIGN KEY(node_id) REFERENCES construct_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_construct_pathways_node ON construct_pathways(node_id,state,sort_order);
CREATE TABLE IF NOT EXISTS pathway_revisions (id TEXT PRIMARY KEY,revision_number INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),snapshot_json TEXT NOT NULL,validation_json TEXT NOT NULL DEFAULT '{}',created_by TEXT NOT NULL DEFAULT 'studio',created_at TEXT NOT NULL,activated_at TEXT,UNIQUE(revision_number));

INSERT OR IGNORE INTO content_entities (id,entity_type,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at) VALUES
('node-tattoos','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-art','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-merch','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-about','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-events','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-music','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-writings','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-archive','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now')),('node-film','construct_node','public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO construct_nodes (id,name,slug,route,state,homepage_enabled,sort_order,created_at,updated_at) VALUES
('node-tattoos','TATTOOS','tattoos','/tattoos/','published',1,1,datetime('now'),datetime('now')),('node-art','ART MAKING','art-making','/art/','published',1,2,datetime('now'),datetime('now')),('node-merch','MERCH','merch','/merch/','published',1,3,datetime('now'),datetime('now')),('node-about','ABOUT','about','/about/','published',1,4,datetime('now'),datetime('now')),('node-events','EVENTS','events','/events/','published',1,5,datetime('now'),datetime('now')),('node-music','MUSIC','music','/music/','published',1,6,datetime('now'),datetime('now')),('node-writings','WRITINGS','writings','/writings/','published',1,7,datetime('now'),datetime('now')),('node-archive','ARCHIVE','archive','/archive/','published',1,8,datetime('now'),datetime('now')),('node-film','FILM','film','/film/','published',1,9,datetime('now'),datetime('now'));

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<9),
node_counts(node_id,total) AS (VALUES ('node-tattoos',8),('node-art',5),('node-merch',5),('node-about',6),('node-events',8),('node-music',3),('node-writings',3),('node-archive',8),('node-film',4))
INSERT OR IGNORE INTO content_entities (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
SELECT 'path-'||substr(node_id,6)||'-'||printf('%02d',n),'construct_pathway',node_id,'public',0,datetime('now'),'migration-0023','migration-0023',datetime('now'),datetime('now') FROM node_counts JOIN seq ON seq.n<=node_counts.total;

WITH pathway_seed(node_id,name,route,sort_order) AS (VALUES
('node-tattoos','Art.Pill Tattoo House','/tattoos/',1),('node-tattoos','About','/about/artpilltattoohouse/',2),('node-tattoos','Flash','/tattoos/flash/',3),('node-tattoos','Portfolio','/tattoos/portfolio/',4),('node-tattoos','Booking','/tattoos/inquire/',5),('node-tattoos','Special Projects','/tattoos/special-projects/',6),('node-tattoos','Legend','/legend/',7),('node-tattoos','Build Your Own','/tattoos/build/',8),
('node-art','statements','/writings/#featured',1),('node-art','artist bio','/about/#saiel',2),('node-art','portfolio','/art/',3),('node-art','meridian in conflux','/art/#sectionPainting',4),('node-art','studio visit','/booking/studio-visit/',5),
('node-merch','six.well clothing','/merch/?filter=six.well',1),('node-merch','art.pill tattoo supply','/merch/?filter=art.pill',2),('node-merch','thoughtpuppet artifacts','/merch/?filter=thoughtpuppet',3),('node-merch','CULT[&SHIFT] merch','/merch/?filter=cultiv',4),('node-merch','all merch','/merch/',5),
('node-about','the construct','/about/#construct',1),('node-about','saiel / founder','/about/#saiel',2),('node-about','architecture','/about/#construct-architecture',3),('node-about','nodes','/about/#access',4),('node-about','method','/about/#library',5),('node-about','faq','/about/#faq',6),
('node-events','CULT[&SHIFT]','/events/cultandshift/',1),('node-events','Signal & Symbol','/events/signal-symbol/',2),('node-events','calendar','/events/calendar/',3),('node-events','rent the studio','/booking/studio/',4),('node-events','archive','/archive/events/',5),('node-events','solehman''s new years','/events/solehmans-new-year/',6),('node-events','SS&F live audience','/events/ss-and-f-live-audience/',7),('node-events','open studios','/events/open-studios/',8),
('node-music','ringtones','/music/#listening-surfaces',1),('node-music','MILOWALKSONWATER','/music/#listening-index',2),('node-music','scores','/music/#forms',3),
('node-writings','Mindful Darkness','/writings/#reading-paths',1),('node-writings','THE SOLEHMAN LETTERS','https://thesolehmanletters.com',2),('node-writings','essays & notes','/writings/#featured',3),
('node-archive','tattoos','/archive/tattoos/',1),('node-archive','art','/archive/art/',2),('node-archive','merch','/archive/merch/',3),('node-archive','events','/archive/events/',4),('node-archive','music','/archive/music/',5),('node-archive','writings','/archive/writings/',6),('node-archive','film','/archive/film/',7),('node-archive','The six.well Construct','/archive/sixwell-construct/',8),
('node-film','isolated.take','/film/#projects',1),('node-film','&friends','/film/#projects',2),('node-film','animations','/film/#forms',3),('node-film','sloth99','/film/#status',4))
INSERT OR IGNORE INTO construct_pathways (id,node_id,name,route,sort_order,created_at,updated_at) SELECT 'path-'||substr(node_id,6)||'-'||printf('%02d',sort_order),node_id,name,route,sort_order,datetime('now'),datetime('now') FROM pathway_seed;
INSERT OR IGNORE INTO pathway_revisions (id,revision_number,status,snapshot_json,validation_json,created_by,created_at,activated_at) VALUES ('pathway-revision-1',1,'active','{"source":"migration-0023","nodes":9,"pathways":50}','{"valid":true,"seeded":true}','migration-0023',datetime('now'),datetime('now'));
