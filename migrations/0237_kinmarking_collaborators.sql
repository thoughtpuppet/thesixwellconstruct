-- Public collaborators supplied by Dartricia Rollins, October 7, 2026.
-- People/organizations own biographies; these profiles give them public routes.
-- Apply before the Worker release. No event dates, status, or capacity change.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS collaborator_profiles (
  entity_id TEXT PRIMARY KEY REFERENCES content_entities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  kind_label TEXT NOT NULL DEFAULT '',
  description_label TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collaborator_links (
  entity_id TEXT NOT NULL REFERENCES collaborator_profiles(entity_id) ON DELETE CASCADE,
  label TEXT NOT NULL, url TEXT NOT NULL,
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(entity_id,url)
);
CREATE TABLE IF NOT EXISTS collaborator_credits (
  entity_id TEXT NOT NULL REFERENCES collaborator_profiles(entity_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  edition_number TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'Collaborator',
  route TEXT NOT NULL, public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  PRIMARY KEY(entity_id,event_id,edition_number)
);

INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,public_at,internal_notes,created_by,updated_by,created_at,updated_at)
SELECT 'person-dartricia-rollins','person','node-about','public',1,datetime('now'),'{"source": "Kinmarking follow-up; supplied by Dartricia Rollins on 2026-10-07 for website use", "headshot": {"original_filename": "SKING-DARTRICIAHEADSHOT2025-BW-4.jpg", "mime_type": "image/jpeg", "width": 683, "height": 1024, "original_byte_size": 96119, "original_sha256": "24c695fce0323a552e0ae39800c2b86ecc1ba3ab79c57b4eb7f3b97089c346e0", "public_path": "/assets/collaborators/dartricia-rollins.jpg", "public_width": 683, "public_height": 1024, "public_byte_size": 80708, "public_sha256": "3c0f3779bcb2c518555f3763d9e855d5f21cc12fa06099ee8efba855c0bb2075", "camera_make": "NIKON CORPORATION", "camera_model": "NIKON D800", "software": "Adobe Photoshop Lightroom Classic 10.3 (Macintosh) (Adobe Photoshop Lightroom Classic 10.3", "embedded_modified_at": "2024:12:18 14:51:39", "embedded_capture_at": "2024:12:08 12:34:54", "embedded_digitized_at": "2024:12:08 12:34:54", "derivative_note": "JPEG redrawn at original display dimensions, quality 92; embedded metadata withheld from public derivative. Original file and complete embedded properties retained in the task work directory."}}','migration-0237','migration-0237',datetime('now'),datetime('now')
WHERE NOT EXISTS(SELECT 1 FROM people WHERE slug='dartricia-rollins');
INSERT OR IGNORE INTO people(id,name,slug,bio,privacy,state,created_at,updated_at)
VALUES('person-dartricia-rollins','Dartricia Rollins','dartricia-rollins','Dartricia Rollins is the Visiting Librarian of Oral History in the Rose Library at Emory University Libraries; co-founder of Georgia Dusk: a southern liberation oral history, and the Southern Memory Workers’ Institute. She is also an organizer with the Black Alliance for Peace and the Jericho Movement and creator of the oral history project: notes from the black underground, documenting veterans of the Black Panther Party and Black Liberation Army.','public','published',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO collaborator_profiles(entity_id,slug,kind_label,pronouns,public_visible,sort_order,created_at,updated_at)
SELECT id,'dartricia-rollins','Individual','',1,1,datetime('now'),datetime('now') FROM people WHERE slug='dartricia-rollins';
INSERT OR IGNORE INTO media_assets(id,source_url,original_filename,mime_type,byte_size,width,height,alt_text,rights_notes,privacy,state,created_by,created_at,updated_at)
VALUES('media-collaborator-dartricia-rollins','/assets/collaborators/dartricia-rollins.jpg','SKING-DARTRICIAHEADSHOT2025-BW-4.jpg','image/jpeg',80708,683,1024,'Portrait of Dartricia Rollins','Supplied by Dartricia Rollins for website use, 2026-10-07. Photographer credit not specified.','public','active','migration-0237',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at)
SELECT id,'media-collaborator-dartricia-rollins','primary',1,1,datetime('now') FROM people WHERE slug='dartricia-rollins';

INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,public_at,internal_notes,created_by,updated_by,created_at,updated_at)
SELECT 'person-ashby-combahee','person','node-about','public',1,datetime('now'),'{"source": "Kinmarking follow-up; supplied by Dartricia Rollins on 2026-10-07 for website use", "headshot": {"original_filename": "Ashby Combahee.jpg", "mime_type": "image/jpeg", "width": 512, "height": 512, "original_byte_size": 104268, "original_sha256": "68dc0c3c4b1756986a1b17e52ffdacc9b877c7bd552833f22074f85d20296d7c", "public_path": "/assets/collaborators/ashby-combahee.jpg", "public_width": 512, "public_height": 512, "public_byte_size": 92626, "public_sha256": "2bd3482e8fe5e3e27e58c819240ca60d58a81caaebd6a4285f3412c2e0dd888a", "derivative_note": "JPEG redrawn at original display dimensions, quality 92; embedded metadata withheld from public derivative. Original file and complete embedded properties retained in the task work directory."}}','migration-0237','migration-0237',datetime('now'),datetime('now')
WHERE NOT EXISTS(SELECT 1 FROM people WHERE slug='ashby-combahee');
INSERT OR IGNORE INTO people(id,name,slug,bio,privacy,state,created_at,updated_at)
VALUES('person-ashby-combahee','Ashby Combahee','ashby-combahee','Ashby Combahee (s/he/they) is the Library and Archives Manager at the Highlander Research and Education Center. A flagship program of the Library & Archives is the Southern Memory Workers Institute, a popular education community archives training. Ashby is co-founder of Georgia Dusk: a southern liberation oral history, which is a community archive that documents and preserves grassroots organizing by Black feminist and queer community members.','public','published',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO collaborator_profiles(entity_id,slug,kind_label,pronouns,public_visible,sort_order,created_at,updated_at)
SELECT id,'ashby-combahee','Individual','s/he/they',1,2,datetime('now'),datetime('now') FROM people WHERE slug='ashby-combahee';
INSERT OR IGNORE INTO media_assets(id,source_url,original_filename,mime_type,byte_size,width,height,alt_text,rights_notes,privacy,state,created_by,created_at,updated_at)
VALUES('media-collaborator-ashby-combahee','/assets/collaborators/ashby-combahee.jpg','Ashby Combahee.jpg','image/jpeg',92626,512,512,'Portrait of Ashby Combahee','Supplied by Dartricia Rollins for website use, 2026-10-07. Photographer credit not specified.','public','active','migration-0237',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at)
SELECT id,'media-collaborator-ashby-combahee','primary',1,1,datetime('now') FROM people WHERE slug='ashby-combahee';

INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,public_at,internal_notes,created_by,updated_by,created_at,updated_at)
SELECT 'org-georgia-dusk','organization','node-about','public',1,datetime('now'),'Description supplied by Dartricia Rollins in Kinmarking follow-up, 2026-10-07. Community archive; no organization logo supplied.','migration-0237','migration-0237',datetime('now'),datetime('now')
WHERE NOT EXISTS(SELECT 1 FROM organizations WHERE slug='georgia-dusk');
INSERT OR IGNORE INTO organizations(id,name,slug,organization_type,description,state,website_url,created_at,updated_at)
VALUES('org-georgia-dusk','Georgia Dusk','georgia-dusk','collective','Georgia Dusk is an intergenerational counter-narrative to the mainstream depiction of Georgia politics and the southern liberation movement. As experts of our own stories, we document grassroots movements led by Black queer and feminist people and reclaim the historical representation of liberation movements throughout Georgia.','published','https://www.georgiadusk.com/',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO collaborator_profiles(entity_id,slug,kind_label,description_label,public_visible,sort_order,created_at,updated_at)
SELECT id,'georgia-dusk','Organization','Community archive',1,3,datetime('now'),datetime('now') FROM organizations WHERE slug='georgia-dusk';
INSERT OR IGNORE INTO relationship_types(id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at)
VALUES('rel-co-founded','co-founded','Co-founded','Co-founder','A person who co-founded an organization.',1,14,datetime('now'),datetime('now'));
INSERT OR IGNORE INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,sort_order,created_by,created_at,updated_at)
SELECT 'rel-georgia-dusk-cofounder-'||p.slug,p.id,o.id,'rel-co-founded',1,cp.sort_order,'migration-0237',datetime('now'),datetime('now')
FROM people p JOIN collaborator_profiles cp ON cp.entity_id=p.id JOIN organizations o ON o.slug='georgia-dusk'
WHERE p.slug IN ('dartricia-rollins','ashby-combahee');
-- Register the existing event if it predates the Connections registry.
INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
SELECT id,'event','node-events',CASE WHEN publication_state IN ('announced','published') THEN 'public' ELSE 'internal' END,
  CASE WHEN publication_state IN ('announced','published') THEN 1 ELSE 0 END,
  CASE WHEN publication_state IN ('announced','published') THEN updated_at ELSE NULL END,
  'migration-0237','migration-0237',created_at,updated_at FROM events WHERE slug='kinmarking';
INSERT OR IGNORE INTO collaborator_credits(entity_id,event_id,edition_number,role,route,public_visible)
SELECT cp.entity_id,e.id,'01','Collaborator','/events/kinmarking-01-oral-histories-and-tattooing/',1
FROM collaborator_profiles cp JOIN events e ON e.slug='kinmarking'
WHERE cp.slug IN ('dartricia-rollins','ashby-combahee','georgia-dusk');
INSERT OR IGNORE INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
SELECT 'rel-kinmarking-01-collaborator-'||cp.slug,cp.entity_id,e.id,'rel-collaborated-with',1,'Scope: first KINMARKING edition; development collaboration in oral history and tattooing.',cp.sort_order,'migration-0237',datetime('now'),datetime('now')
FROM collaborator_profiles cp JOIN events e ON e.slug='kinmarking'
WHERE cp.slug IN ('dartricia-rollins','ashby-combahee','georgia-dusk');
INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES('pathway-about-collaborators','construct_pathway','node-about','public',1,datetime('now'),'migration-0237','migration-0237',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO construct_pathways(id,node_id,name,route,color,state,homepage_enabled,sort_order,created_at,updated_at)
VALUES('pathway-about-collaborators','node-about','Collaborators','/about/collaborators/','#FCB867','published',0,25,datetime('now'),datetime('now'));

-- Official professional and project links approved for Explore their work.
INSERT OR IGNORE INTO collaborator_links(entity_id,label,url,public_visible,sort_order)
SELECT entity_id,'Emory staff profile','https://libraries.emory.edu/contact/staff-directory/dartricia-rollins',1,1
FROM collaborator_profiles WHERE slug='dartricia-rollins';
INSERT OR IGNORE INTO collaborator_links(entity_id,label,url,public_visible,sort_order)
SELECT entity_id,'Notes from the Black Underground','https://www.grassrootsthinking.com/tag/notes-from-the-undergound/',1,2
FROM collaborator_profiles WHERE slug='dartricia-rollins';
INSERT OR IGNORE INTO collaborator_links(entity_id,label,url,public_visible,sort_order)
SELECT entity_id,'Southern Memory Workers','https://www.southernmemoryworkers.org/about',1,1
FROM collaborator_profiles WHERE slug='ashby-combahee';
INSERT OR IGNORE INTO collaborator_links(entity_id,label,url,public_visible,sort_order)
SELECT entity_id,'Highlander Library & Archives','https://highlandercenterlibrary.soutronglobal.net/portal/Default/en-US/Custom/AboutUs',1,2
FROM collaborator_profiles WHERE slug='ashby-combahee';
