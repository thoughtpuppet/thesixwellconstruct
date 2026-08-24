PRAGMA foreign_keys = ON;

ALTER TABLE art_works
ADD COLUMN whereabouts_status TEXT NOT NULL DEFAULT 'known'
CHECK (whereabouts_status IN ('known','unknown'));

ALTER TABLE archive_records
ADD COLUMN practice_sections_json TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('art-personification-of-truth','art_work','art','internal',0,0,NULL,'migration-0171','migration-0171',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO art_works
  (id,slug,title,statement,year,medium,dimensions,availability,whereabouts_status,acquisition_eligible,print_intent,state,legacy_path,sort_order,created_at,updated_at)
SELECT
  'art-personification-of-truth',
  'the-personification-of-truth',
  'THE PERSONIFICATION OF TRUTH.',
  'THE PERSONIFICATION OF TRUTH. is the first painting I made on wood. In 2016, I found an unused panel in my dad’s workshop and used it at the 37 × 47½-inch size in which I found it. Its current whereabouts are unknown. The work marks the beginning of wood panel as the primary support in my painting practice.',
  '2016',
  'Acrylic on wood panel',
  '37 × 47½ inches',
  'unavailable',
  'unknown',
  0,
  'unavailable',
  'published',
  '',
  COALESCE(MAX(sort_order),0)+1,
  datetime('now'),
  datetime('now')
FROM art_works;

INSERT OR IGNORE INTO media_assets
  (id,source_url,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,privacy,consent_status,state,created_by,created_at,updated_at,public_title,public_description,public_presentation)
VALUES
  ('media-art-personification-of-truth','/assets/paintings/the-personification-of-truth.jpg','the-personification-of-truth.jpg','image/jpeg',2791749,3900,5163,NULL,'THE PERSONIFICATION OF TRUTH., a 2016 acrylic painting on wood panel showing a suited figure with a red face punctuated by black circular forms against an angular interior.','Primary documentation of THE PERSONIFICATION OF TRUTH., 2016.','public','not-required','active','migration-0171',datetime('now'),datetime('now'),'THE PERSONIFICATION OF TRUTH.','Primary documentation of the 2016 painting.','inline');

INSERT OR IGNORE INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
VALUES
  ('art-personification-of-truth','media-art-personification-of-truth','primary',1,1,'THE PERSONIFICATION OF TRUTH., a 2016 acrylic painting on wood panel showing a suited figure with a red face punctuated by black circular forms against an angular interior.','Primary documentation of THE PERSONIFICATION OF TRUTH., 2016.',datetime('now'));

UPDATE content_entities
SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='migration-0171',updated_at=datetime('now')
WHERE id='art-personification-of-truth';

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-practice-making-the-canvas','archive_record','archive','public',1,1,datetime('now'),'migration-0171','migration-0171',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_records
  (id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,body_html,record_status,state,why_it_matters,source_note,practice_sections_json,related_notes_json,related_routes_json,sort_order,created_at,updated_at)
SELECT
  'archive-practice-making-the-canvas',
  'making-the-canvas',
  'Making the Canvas',
  'Art Making / Practice Record',
  'practice',
  'Art',
  'Begun 2016',
  'ongoing',
  'A painting begins before paint touches its surface. Choosing its dimensions and turning raw plywood into a cradled panel establishes the painting’s body before it receives an image.',
  'In 2016, I found a wood panel sitting unused in my dad’s workshop. I used it at the size I found it—37 × 47½ inches—and painted THE PERSONIFICATION OF TRUTH. It became the first painting I made on wood.\n\nI started using wood because large commercially prepared canvases were too expensive and plywood was cheaper. What began as necessity became intimacy. I was no longer accepting a prefabricated rectangle; I was deciding the dimensions and building the painting’s body before giving it an image.\n\nChoosing dimensions is already a compositional act. The proportions determine what kind of image the panel can hold before the first mark appears.\n\nMaking the panel is the most enjoyable part of my art-making process: measuring, cutting, building the cradle, assembling the support, and preparing it. The work is quieter, more definite, more bodily, and more solvable than painting.\n\nShellac is where the constructed object changes into a painting surface. The repeated brushing, smell, drying time, and amber shift make preparation feel like a ritual. It seals the plywood without erasing what the wood already carries.\n\nI sand the edges and anything dangerous, but I preserve the face of the plywood—the grain, scars, dents, and irregularities. Those imperfections interrupt the painted image.\n\nThe same material can warp, split, and age, so it also threatens the painted image’s permanence. The support makes impermanence part of the painting.\n\nMost viewers may never see the cradle, the cuts, the shellac, or the preparation beneath the paint. I know they are there. The image has a body I made.',
  '',
  'active practice',
  'published',
  'Most viewers may never see the cradle, the cuts, the shellac, or the preparation beneath the paint. I know they are there. The image has a body I made.',
  'Authored studio-practice record; begun with a found panel from the artist’s father’s workshop in 2016.',
  '[{"id":"origin","eyebrow":"01 · Origin","title":"The panel that was already there","body":"In 2016, I found a wood panel sitting unused in my dad’s workshop. I used it at the size I found it—37 × 47½ inches—and painted THE PERSONIFICATION OF TRUTH. It became the first painting I made on wood.","mediaRole":"origin-work"},{"id":"why-wood","eyebrow":"02 · Material","title":"Necessity became intimacy","body":"I started using wood because large commercially prepared canvases were too expensive and plywood was cheaper. What began as necessity became intimacy. I was no longer accepting a prefabricated rectangle; I was deciding the dimensions and building the painting’s body before giving it an image.","mediaRole":""},{"id":"dimensions","eyebrow":"03 · Composition","title":"Dimensions come first","body":"Choosing dimensions is already a compositional act. The proportions determine what kind of image the panel can hold before the first mark appears.","mediaRole":""},{"id":"construction","eyebrow":"04 · Construction","title":"The most enjoyable part","body":"Making the panel is the most enjoyable part of my art-making process: measuring, cutting, building the cradle, assembling the support, and preparing it. The work is quieter, more definite, more bodily, and more solvable than painting.","mediaRole":""},{"id":"shellac","eyebrow":"05 · Preparation","title":"The shellac ritual","body":"Shellac is where the constructed object changes into a painting surface. The repeated brushing, smell, drying time, and amber shift make preparation feel like a ritual. It seals the plywood without erasing what the wood already carries.","mediaRole":"process-video"},{"id":"imperfections","eyebrow":"06 · Surface","title":"What I leave in the wood","body":"I sand the edges and anything dangerous, but I preserve the face of the plywood—the grain, scars, dents, and irregularities. Those imperfections interrupt the painted image.","mediaRole":""},{"id":"impermanence","eyebrow":"07 · Time","title":"A vulnerable support","body":"The same material can warp, split, and age, so it also threatens the painted image’s permanence. The support makes impermanence part of the painting.","mediaRole":""},{"id":"hidden-labor","eyebrow":"08 · Body","title":"The labor that disappears","body":"Most viewers may never see the cradle, the cuts, the shellac, or the preparation beneath the paint. I know they are there. The image has a body I made.","mediaRole":""}]',
  '[]',
  '["/archive/art/making-the-canvas/","/art/"]',
  COALESCE(MAX(sort_order),0)+1,
  datetime('now'),
  datetime('now')
FROM archive_records;

INSERT OR IGNORE INTO media_assets
  (id,source_url,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,privacy,consent_status,state,created_by,created_at,updated_at,public_title,public_description,public_presentation)
VALUES
  ('media-making-canvas-shellacked-panels','/assets/archive/making-the-canvas/shellacked-panels.png','shellacked-panels.png','image/png',4029205,1179,2016,NULL,'Several plywood painting panels in different sizes laid on plastic outdoors while shellac dries; a brush and screwdriver remain beside them.','Plywood painting panels drying after shellac preparation.','public','not-required','active','migration-0171',datetime('now'),datetime('now'),'Shellacked plywood panels','Several prepared plywood panels drying outdoors.','inline'),
  ('media-making-canvas-shellacking-video','/assets/archive/making-the-canvas/shellacking-panels.mp4','shellacking-panels.mp4','video/mp4',19848737,720,1280,45.42,'A 45-second ambient video of shellac being brushed across plywood panels during surface preparation.','Shellac being brushed across plywood panels during surface preparation. Ambient studio sound.','public','not-required','active','migration-0171',datetime('now'),datetime('now'),'Shellacking the panels','A 45-second ambient process video.','inline');

INSERT OR IGNORE INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
VALUES
  ('archive-practice-making-the-canvas','media-making-canvas-shellacked-panels','primary',1,1,'Several plywood painting panels in different sizes laid on plastic outdoors while shellac dries; a brush and screwdriver remain beside them.','Plywood painting panels drying after shellac preparation.',datetime('now')),
  ('archive-practice-making-the-canvas','media-making-canvas-shellacking-video','process-video',2,1,'A 45-second ambient video of shellac being brushed across plywood panels during surface preparation.','Shellac being brushed across plywood panels during surface preparation. Ambient studio sound.',datetime('now'));

INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
VALUES
  ('connection-personification-making-canvas','art-personification-of-truth','archive-practice-making-the-canvas','rel-documented-by',1,'The practice record documents the found panel that began the artist’s ongoing wood-panel method.',1,'migration-0171',datetime('now'),datetime('now'));

INSERT INTO search_documents
  (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
SELECT id,'art_work','art',slug,title,statement,'',state,'','','','',year,'/art/'||slug||'/',datetime('now')
FROM art_works WHERE id='art-personification-of-truth'
ON CONFLICT(entity_id) DO UPDATE SET
  entity_type=excluded.entity_type,node_id=excluded.node_id,slug=excluded.slug,title=excluded.title,summary=excluded.summary,
  body=excluded.body,state=excluded.state,date_label=excluded.date_label,route=excluded.route,updated_at=excluded.updated_at;

INSERT INTO search_documents
  (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
SELECT id,'archive_record','archive',slug,title,summary,body,state,'','','','',date_or_period,'/archive/art/'||slug||'/',datetime('now')
FROM archive_records WHERE id='archive-practice-making-the-canvas'
ON CONFLICT(entity_id) DO UPDATE SET
  entity_type=excluded.entity_type,node_id=excluded.node_id,slug=excluded.slug,title=excluded.title,summary=excluded.summary,
  body=excluded.body,state=excluded.state,date_label=excluded.date_label,route=excluded.route,updated_at=excluded.updated_at;

INSERT OR IGNORE INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
VALUES
  ('revision-0171-personification','art-personification-of-truth',1,'canonical-artwork-created',NULL,'{"record":"art-personification-of-truth","state":"published","whereabouts_status":"unknown"}','migration-0171',datetime('now')),
  ('revision-0171-making-canvas','archive-practice-making-the-canvas',1,'practice-record-created',NULL,'{"record":"archive-practice-making-the-canvas","state":"published","section_count":8}','migration-0171',datetime('now'));
