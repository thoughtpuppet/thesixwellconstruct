PRAGMA foreign_keys = ON;

-- Artist appearances belong to About. They describe participation in events
-- hosted by other people or organizations, rather than Six.Well-produced
-- ticketed events in the operational `events` table.
CREATE TABLE IF NOT EXISTS artist_appearances (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  lifecycle_status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(lifecycle_status IN ('scheduled','completed','postponed','cancelled')),
  formats_json TEXT NOT NULL DEFAULT '[]',
  participation_roles_json TEXT NOT NULL DEFAULT '[]',
  ticket_url TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK(state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artist_appearances_public_date
  ON artist_appearances(state,starts_at,sort_order);

ALTER TABLE organizations ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN social_url TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('appearance-made-in-public','appearance','node-about','public',1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now')),
  ('org-purple-fish-studios','organization','node-about','public',1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now')),
  ('org-fourth-house','organization','node-about','public',1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now')),
  ('org-six-well-clothing','organization','node-merch','public',1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now')),
  ('place-purple-fish-studios','place','node-about','public',1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO organizations
  (id,name,slug,organization_type,description,state,created_at,updated_at,website_url,social_url)
VALUES
  ('org-purple-fish-studios','Purple Fish Studios','purple-fish-studios','studio','Creative production studio and rental space in Atlanta.','published',datetime('now'),datetime('now'),'https://www.pfstudios.co/','https://www.instagram.com/purplefish.studios/'),
  ('org-fourth-house','Fourth House','fourth-house','other','Co-presenter of Made in Public.','published',datetime('now'),datetime('now'),'',''),
  ('org-six-well-clothing','SIX.WELL CLOTHING','six-well-clothing','brand','The clothing and merchandise identity within the Six.Well Construct.','published',datetime('now'),datetime('now'),'','');

INSERT OR IGNORE INTO places
  (id,name,slug,public_location,private_location,privacy,state,created_at,updated_at)
VALUES
  ('place-purple-fish-studios','Purple Fish Studios','purple-fish-studios','132 Mitchell St SW, Atlanta, GA 30303','','public','published',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO artist_appearances
  (id,slug,title,summary,description,starts_at,ends_at,timezone,lifecycle_status,formats_json,participation_roles_json,ticket_url,source_url,state,sort_order,created_at,updated_at)
VALUES
  ('appearance-made-in-public','made-in-public','Made in Public','Saiel + ThoughtPuppet participate as exhibiting artist, panelist, and merchandise vendor.','A gallery exhibition, panel discussion, and interactive installation presented by Purple Fish Studios and Fourth House. SIX.WELL CLOTHING participates through merchandise, including the LOST MARBLES. Hoodie.','2026-08-14T20:00:00Z','2026-08-15T02:00:00Z','America/New_York','scheduled','["Gallery exhibition","Panel discussion","Interactive installation"]','["Exhibiting artist","Panelist","Merchandise vendor"]','https://madeinpublic.xyz/','https://madeinpublic.xyz/','published',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_dossiers
  (entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('appearance-made-in-public','made-in-public','A living record of Saiel + ThoughtPuppet participating in Made in Public at Purple Fish Studios.','This dossier begins with the original event flyer and confirmed participation roles. It can grow after the event with installation views, the final list of exhibited paintings, panel documentation, merchandise records, and reflections.','','Post-event documentation has not been added yet.','event','published',1,0,1,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now'));

-- The dossier structure trigger predates artist appearances. Remove any
-- cultural-object shell it created and assign the event authority instead.
DELETE FROM archive_object_states
WHERE version_id IN (SELECT id FROM archive_object_versions WHERE entity_id='appearance-made-in-public');
DELETE FROM archive_object_versions WHERE entity_id='appearance-made-in-public';
DELETE FROM archive_catalogue_entries WHERE entity_id='appearance-made-in-public';
INSERT OR IGNORE INTO archive_event_identifiers
  (entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at)
SELECT 'appearance-made-in-public',
  COALESCE(MAX(event_number),0)+1,
  'EVT-'||printf('%03d',COALESCE(MAX(event_number),0)+1),
  'migration-0118','migration-0118',datetime('now'),datetime('now')
FROM archive_event_identifiers;

INSERT OR IGNORE INTO archive_dossier_subjects
  (dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at)
VALUES
  ('appearance-made-in-public','person-saiel-dauhn-solehman','exhibiting artist and panelist',1,1,datetime('now')),
  ('appearance-made-in-public','org-thoughtpuppet','participating art identity',1,2,datetime('now')),
  ('appearance-made-in-public','org-six-well-clothing','participating clothing and merchandise identity',1,3,datetime('now')),
  ('appearance-made-in-public','org-purple-fish-studios','co-presenter and host studio',1,4,datetime('now')),
  ('appearance-made-in-public','org-fourth-house','co-presenter',1,5,datetime('now')),
  ('appearance-made-in-public','place-purple-fish-studios','venue',1,6,datetime('now'));

INSERT OR IGNORE INTO media_assets
  (id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,credit,rights_notes,privacy,consent_status,state,created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation)
VALUES
  ('media-made-in-public-flyer','/assets/events/made-in-public-2026-flyer.jpg','','made-in-public-2026-flyer.jpg','image/jpeg',0,988,1280,NULL,'Made in Public event flyer showing a seated block-built figure and event details.','Original pre-event flyer for Made in Public, August 14, 2026.','Purple Fish Studios × Fourth House','','public','not-required','active','migration-0118',datetime('now'),datetime('now'),'','not-requested','','Made in Public flyer','Original event announcement and confirmed event details.','inline');

INSERT OR IGNORE INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
VALUES
  ('appearance-made-in-public','media-made-in-public-flyer','primary',1,1,'Made in Public event flyer.','Purple Fish Studios × Fourth House present Made in Public, August 14, 2026.',datetime('now'));

INSERT OR IGNORE INTO archive_materials
  (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-material-made-in-public-flyer','appearance-made-in-public','media-made-in-public-flyer','event-flyer','artifact','Original event flyer','The public announcement preserved before the event.','','announcement','2026-08-14T20:00:00Z',NULL,'exact','August 14, 2026','public','published',1,'migration-0118','migration-0118',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO relationship_types
  (id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('rel-featured-at','featured-at','Featured at','Featured merchandise','Connects merchandise presented or sold through an appearance without implying the source artwork was exhibited.',1,16,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
VALUES
  ('connection-lostmarbles-hoodie-made-in-public','merch-lostmarbles-hoodie','appearance-made-in-public','rel-featured-at',1,'The LOST MARBLES. Hoodie is confirmed merchandise for Made in Public. This does not mark the source painting as exhibited.',1,'migration-0118',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('path-about-07','construct_pathway','node-about','public',0,datetime('now'),'migration-0118','migration-0118',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO construct_pathways
  (id,node_id,name,route,color,state,homepage_enabled,sort_order,created_at,updated_at)
VALUES
  ('path-about-07','node-about','Exhibitions & Appearances','/about/exhibitions-appearances/','#FCB467','published',1,7,datetime('now'),datetime('now'));

PRAGMA foreign_keys = ON;
