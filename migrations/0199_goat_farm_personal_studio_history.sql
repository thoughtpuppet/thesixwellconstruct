PRAGMA foreign_keys = ON;

-- Register the Goat Farm as a canonical place so the firsthand record, its
-- private Journal source, and the existing Erikson place can share one graph.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('place-goat-farm-arts-center','place','node-archive','public',1,0,datetime('now'),NULL,'','migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  visibility=excluded.visibility,
  search_visibility=excluded.search_visibility,
  archived_at=NULL,
  updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO places
  (id,name,slug,public_location,private_location,privacy,state,created_at,updated_at)
VALUES
  ('place-goat-farm-arts-center','Goat Farm Arts Center','goat-farm-arts-center','1200 Foster Street NW, Atlanta, GA 30318','','public','published',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  slug=excluded.slug,
  public_location=excluded.public_location,
  private_location=excluded.private_location,
  privacy=excluded.privacy,
  state=excluded.state,
  updated_at=excluded.updated_at;

-- The public personal record owns the complete four-image sequence. The Goat
-- Farm place dossier uses only one representative image from each phase.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','archive_record','node-archive','public',1,0,datetime('now'),NULL,'','migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  visibility=excluded.visibility,
  search_visibility=excluded.search_visibility,
  archived_at=NULL,
  updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO archive_records
  (id,slug,title,node_label,record_type,room,date_or_period,timeline_period,
   summary,body,record_status,state,why_it_matters,source_note,related_routes_json,
   sort_order,medium_label,creator_entity_id,creator_label,date_precision,created_at,updated_at)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','saiel-goat-farm-studio-years','Goat Farm Studio Years, 2018–2021','Saiel Dauhn Solehman','process','People / Places','2018–2021','2018–2021',
   'A firsthand record of Saiel Dauhn Solehman''s work-only and live/work studios at the Goat Farm Arts Center, followed by the 2021 move to its Erikson satellite at 364 Nelson Street.',
   'Solehman established a work-only studio at the Goat Farm in 2018. The surviving photographs supplied from that phase were captured on September 24 and November 13, 2019. Later in 2019, she moved into a live/work studio and remained at the Goat Farm through 2021. Photographs captured on January 25, 2020, and May 11, 2021, document that second space. In 2021, as redevelopment reached her occupancy, she moved to the Goat Farm''s satellite studios in the J.R. Erikson Co. Building at 364 Nelson Street.',
   'firsthand studio record','published',
   'The record preserves one artist''s lived passage through work, residence, redevelopment, and relocation without treating her spaces as evidence of campus-wide conditions.',
   'Firsthand account and personal photographs supplied by Saiel Dauhn Solehman. Capture dates are preserved from the original image metadata; the exact 2019 studio-move date and exact 2021 Erikson-move date remain unverified.',
   '["/archive/places/goat-farm-arts-center/","/archive/places/jr-erikson-building/","/archive/timelines/saiel-dauhn-solehman/"]',
   30,'Studio history','person-saiel-dauhn-solehman','Saiel Dauhn Solehman','range',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  slug=excluded.slug,title=excluded.title,node_label=excluded.node_label,record_type=excluded.record_type,
  room=excluded.room,date_or_period=excluded.date_or_period,timeline_period=excluded.timeline_period,
  summary=excluded.summary,body=excluded.body,record_status=excluded.record_status,state=excluded.state,
  why_it_matters=excluded.why_it_matters,source_note=excluded.source_note,
  related_routes_json=excluded.related_routes_json,sort_order=excluded.sort_order,
  medium_label=excluded.medium_label,creator_entity_id=excluded.creator_entity_id,
  creator_label=excluded.creator_label,date_precision=excluded.date_precision,updated_at=excluded.updated_at;

INSERT INTO archive_dossiers
  (entity_id,archive_slug,orientation,story,story_html,empty_materials_note,
   record_type,state,public_visible,featured,sort_order,published_at,
   created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','saiel-goat-farm-studio-years',
   'A firsthand studio history linking Saiel Dauhn Solehman, the Goat Farm Arts Center, and the J.R. Erikson Co. Building.',
   'The record follows two distinct Goat Farm spaces: a work-only studio established in 2018 and photographed in 2019, then a live/work studio entered later in 2019 and photographed in 2020 and 2021. The sequence ends with Solehman''s 2021 move to the Goat Farm''s Erikson satellite at 364 Nelson Street.',
   '','Additional photographs and first-person memories remain in a private Journal source until separately reviewed.',
   'process','published',1,0,30,datetime('now'),'migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(entity_id) DO UPDATE SET
  archive_slug=excluded.archive_slug,orientation=excluded.orientation,story=excluded.story,
  story_html=excluded.story_html,empty_materials_note=excluded.empty_materials_note,
  record_type=excluded.record_type,state=excluded.state,public_visible=excluded.public_visible,
  featured=excluded.featured,sort_order=excluded.sort_order,
  published_at=COALESCE(archive_dossiers.published_at,excluded.published_at),
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT INTO media_assets
  (id,source_url,original_filename,mime_type,byte_size,width,height,alt_text,caption,credit,rights_notes,
   privacy,state,public_title,public_description,public_presentation,created_by,created_at,updated_at)
VALUES
  ('media-saiel-goat-farm-work-studio-2019-09-24','/assets/archive/goat-farm-arts-center/saiel-goat-farm-work-studio-2019-09-24.jpg','IMG_7607_Original.JPG','image/jpeg',592496,2400,1800,
   'Saiel Dauhn Solehman''s work-only Goat Farm studio filled with paintings and works in progress.','Work-only studio at the Goat Farm · September 24, 2019','Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license.','Photograph and visible artworks © Saiel Dauhn Solehman. Reproduced in the artist''s own Archive record; no third-party reuse license granted.','public','active','Work-only Goat Farm studio','The wide studio view documents one artist''s workspace, not campus-wide condition or occupancy.','inline','migration-0199',datetime('now'),datetime('now')),
  ('media-saiel-goat-farm-work-studio-2019-11-13','/assets/archive/goat-farm-arts-center/saiel-goat-farm-work-studio-2019-11-13.jpg','IMG_9038_Original.JPG','image/jpeg',501153,1800,2400,
   'Paintings and an Open Studio sign inside Saiel Dauhn Solehman''s work-only Goat Farm studio.','Work-only studio at the Goat Farm · November 13, 2019','Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license.','Photograph and visible artworks © Saiel Dauhn Solehman. Reproduced in the artist''s own Archive record; no third-party reuse license granted.','public','active','Work-only Goat Farm studio detail','The studio detail documents one artist''s workspace, not campus-wide condition or occupancy.','inline','migration-0199',datetime('now'),datetime('now')),
  ('media-saiel-goat-farm-live-work-studio-2020-01-25','/assets/archive/goat-farm-arts-center/saiel-goat-farm-live-work-studio-2020-01-25.jpg','IMG_1784.HEIC','image/jpeg',370154,2400,1800,
   'Saiel Dauhn Solehman''s Goat Farm live/work studio at night, with paintings arranged beneath exposed industrial structure.','Live/work studio at the Goat Farm · January 25, 2020','Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license.','Photograph and visible artworks © Saiel Dauhn Solehman. Reproduced in the artist''s own Archive record; no third-party reuse license granted.','public','active','Goat Farm live/work studio','The wide live/work view documents one artist''s space, not campus-wide condition or occupancy.','inline','migration-0199',datetime('now'),datetime('now')),
  ('media-saiel-goat-farm-live-work-studio-2021-05-11','/assets/archive/goat-farm-arts-center/saiel-goat-farm-live-work-studio-2021-05-11.jpg','IMG_9533_Original.JPG','image/jpeg',587173,2400,1800,
   'Paintings, camera, and lighting equipment inside Saiel Dauhn Solehman''s Goat Farm live/work studio.','Live/work studio at the Goat Farm · May 11, 2021','Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license.','Photograph and visible artworks © Saiel Dauhn Solehman. Reproduced in the artist''s own Archive record; no third-party reuse license granted.','public','active','Goat Farm live/work studio in use','The working studio view documents one artist''s space, not campus-wide condition or occupancy.','inline','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  source_url=excluded.source_url,original_filename=excluded.original_filename,mime_type=excluded.mime_type,
  byte_size=excluded.byte_size,width=excluded.width,height=excluded.height,alt_text=excluded.alt_text,
  caption=excluded.caption,credit=excluded.credit,rights_notes=excluded.rights_notes,
  privacy=excluded.privacy,state=excluded.state,public_title=excluded.public_title,
  public_description=excluded.public_description,public_presentation=excluded.public_presentation,
  updated_at=excluded.updated_at;

INSERT INTO archive_materials
  (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,
   occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('material-saiel-goat-farm-work-studio-2019-09-24','archive-record-saiel-goat-farm-studio-years','media-saiel-goat-farm-work-studio-2019-09-24','documentation','process-photo','Work-only studio — wide view','Work-only studio at the Goat Farm · September 24, 2019','The work-only studio was established in 2018; this photograph was captured in 2019.','Work-only studio · 2018–2019','2019-09-24',NULL,'exact','September 24, 2019','public','published',1,'migration-0199','migration-0199',datetime('now'),datetime('now')),
  ('material-saiel-goat-farm-work-studio-2019-11-13','archive-record-saiel-goat-farm-studio-years','media-saiel-goat-farm-work-studio-2019-11-13','documentation','process-photo','Work-only studio — Open Studio detail','Work-only studio at the Goat Farm · November 13, 2019','A second view from the work-only phase, including an Open Studio sign and paintings.','Work-only studio · 2018–2019','2019-11-13',NULL,'exact','November 13, 2019','public','published',2,'migration-0199','migration-0199',datetime('now'),datetime('now')),
  ('material-saiel-goat-farm-live-work-studio-2020-01-25','archive-record-saiel-goat-farm-studio-years','media-saiel-goat-farm-live-work-studio-2020-01-25','documentation','process-photo','Live/work studio — wide view','Live/work studio at the Goat Farm · January 25, 2020','A wide night view of the live/work studio entered later in 2019.','Live/work studio · 2019–2021','2020-01-25',NULL,'exact','January 25, 2020','public','published',3,'migration-0199','migration-0199',datetime('now'),datetime('now')),
  ('material-saiel-goat-farm-live-work-studio-2021-05-11','archive-record-saiel-goat-farm-studio-years','media-saiel-goat-farm-live-work-studio-2021-05-11','documentation','process-photo','Live/work studio — working view','Live/work studio at the Goat Farm · May 11, 2021','Paintings, a camera, and lighting equipment document the live/work studio in use in 2021.','Live/work studio · 2019–2021','2021-05-11',NULL,'exact','May 11, 2021','public','published',4,'migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  dossier_entity_id=excluded.dossier_entity_id,media_id=excluded.media_id,role=excluded.role,
  material_type=excluded.material_type,title=excluded.title,caption=excluded.caption,body=excluded.body,
  process_phase=excluded.process_phase,occurred_at=excluded.occurred_at,ended_at=excluded.ended_at,
  date_precision=excluded.date_precision,date_label=excluded.date_label,visibility=excluded.visibility,
  state=excluded.state,sort_order=excluded.sort_order,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT OR IGNORE INTO archive_dossier_subjects
  (dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','person-saiel-dauhn-solehman','artist and resident',1,1,datetime('now')),
  ('archive-record-saiel-goat-farm-studio-years','place-goat-farm-arts-center','primary place',1,2,datetime('now')),
  ('archive-record-saiel-goat-farm-studio-years','place-jr-erikson-building','relocation place',1,3,datetime('now'));

INSERT OR IGNORE INTO archive_record_people
  (record_id,person_id,role,public_visible,sort_order)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','person-saiel-dauhn-solehman','artist and resident',1,1);

INSERT OR IGNORE INTO archive_record_places
  (record_id,place_id,role,public_visible,sort_order)
VALUES
  ('archive-record-saiel-goat-farm-studio-years','place-goat-farm-arts-center','primary place',1,1),
  ('archive-record-saiel-goat-farm-studio-years','place-jr-erikson-building','relocation place',1,2);

-- One ranged public milestone keeps the personal timeline concise. The full
-- phase distinction and all four images remain on the owning Archive record.
INSERT INTO entity_activity
  (id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,
   public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
VALUES
  ('activity-saiel-goat-farm-studio-years-2018-2021','archive-record-saiel-goat-farm-studio-years','studio-history','Goat Farm studio years','Firsthand studio history','2018-01-01','2021-12-31','place-goat-farm-arts-center',1,30,'migration-0199',datetime('now'),datetime('now'),
   'A work-only studio established in 2018 became a live/work studio chapter in 2019, followed by a 2021 move to the Erikson satellite at 364 Nelson Street.',
   'The supplied personal archive documents two distinct spaces: a work-only studio used from 2018 into 2019, and a live/work studio used from later in 2019 through 2021. The exact move dates remain unverified. As redevelopment reached Solehman''s occupancy in 2021, she moved to the Goat Farm''s J.R. Erikson Co. Building satellite.',
   'range','2018–2021','Firsthand account and personal photographs by Saiel Dauhn Solehman; exact capture dates are recorded on the linked Archive record.')
ON CONFLICT(id) DO UPDATE SET
  entity_id=excluded.entity_id,activity_type=excluded.activity_type,title=excluded.title,
  notes=excluded.notes,occurred_at=excluded.occurred_at,ended_at=excluded.ended_at,
  place_entity_id=excluded.place_entity_id,public_visible=excluded.public_visible,
  sort_order=excluded.sort_order,summary=excluded.summary,body=excluded.body,
  date_precision=excluded.date_precision,date_label=excluded.date_label,
  source_note=excluded.source_note,updated_at=excluded.updated_at;

INSERT INTO entity_activity_subjects
  (activity_id,subject_entity_id,public_visible,sort_order,created_at)
VALUES
  ('activity-saiel-goat-farm-studio-years-2018-2021','person-saiel-dauhn-solehman',1,30,datetime('now'))
ON CONFLICT(activity_id,subject_entity_id) DO UPDATE SET
  public_visible=excluded.public_visible,sort_order=excluded.sort_order;

-- The Journal remains an internal source shell. It reuses the managed public
-- derivatives but its attachment links, record links, and body stay private.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-note-saiel-goat-farm-studio-years','archive_note','node-archive','internal',0,0,NULL,NULL,'Private factual source shell; expand only with Saiel''s reviewed memories.','migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,node_id=excluded.node_id,visibility='internal',search_visibility=0,
  public_at=NULL,archived_at=NULL,internal_notes=excluded.internal_notes,
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT INTO archive_notes
  (entity_id,slug,title,note_type,source_app,body_markdown,excerpt,source_created_at,source_modified_at,
   date_label,provenance_note,state,public_visible,sort_order,published_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-note-saiel-goat-farm-studio-years','saiel-goat-farm-studio-years-source-journal','Goat Farm studio years — source Journal','journal-entry','Studio',
   '## Work-only studio

- Established: 2018
- Current supplied photograph dates: September 24 and November 13, 2019
- Exact start and move dates: not yet verified

{{asset:work-studio-2019-09-24}}

{{asset:work-studio-2019-11-13}}

## Live/work studio

- Entered: later in 2019
- Current supplied photograph dates: January 25, 2020, and May 11, 2021
- Occupancy continued through 2021

{{asset:live-work-studio-2020-01-25}}

{{asset:live-work-studio-2021-05-11}}

## Transition to Erikson

- In 2021, redevelopment prompted the move from the Goat Farm to its J.R. Erikson Co. Building satellite at 364 Nelson Street.
- Exact move date and additional firsthand memories remain to be added by Saiel.','A private factual source shell for the Goat Farm studio years and the transition to Erikson.',NULL,NULL,'2018–2021','Firsthand account and personal photographs supplied by Saiel Dauhn Solehman. No first-person memory has been inferred or invented.','draft',0,30,NULL,'migration-0199','migration-0199',datetime('now'),datetime('now'))
ON CONFLICT(entity_id) DO UPDATE SET
  slug=excluded.slug,title=excluded.title,note_type=excluded.note_type,source_app=excluded.source_app,
  body_markdown=excluded.body_markdown,excerpt=excluded.excerpt,date_label=excluded.date_label,
  provenance_note=excluded.provenance_note,state='draft',public_visible=0,published_at=NULL,
  sort_order=excluded.sort_order,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT INTO archive_note_assets
  (id,note_entity_id,media_id,asset_token,role,sort_order,alt_text_override,caption_override,public_visible,created_at,updated_at)
VALUES
  ('archive-note-asset-saiel-goat-farm-work-2019-09-24','archive-note-saiel-goat-farm-studio-years','media-saiel-goat-farm-work-studio-2019-09-24','work-studio-2019-09-24','inline-image',1,'Saiel Dauhn Solehman''s work-only Goat Farm studio filled with paintings and works in progress.','Work-only studio · September 24, 2019',0,datetime('now'),datetime('now')),
  ('archive-note-asset-saiel-goat-farm-work-2019-11-13','archive-note-saiel-goat-farm-studio-years','media-saiel-goat-farm-work-studio-2019-11-13','work-studio-2019-11-13','inline-image',2,'Paintings and an Open Studio sign inside Saiel Dauhn Solehman''s work-only Goat Farm studio.','Work-only studio · November 13, 2019',0,datetime('now'),datetime('now')),
  ('archive-note-asset-saiel-goat-farm-live-work-2020-01-25','archive-note-saiel-goat-farm-studio-years','media-saiel-goat-farm-live-work-studio-2020-01-25','live-work-studio-2020-01-25','inline-image',3,'Saiel Dauhn Solehman''s Goat Farm live/work studio at night.','Live/work studio · January 25, 2020',0,datetime('now'),datetime('now')),
  ('archive-note-asset-saiel-goat-farm-live-work-2021-05-11','archive-note-saiel-goat-farm-studio-years','media-saiel-goat-farm-live-work-studio-2021-05-11','live-work-studio-2021-05-11','inline-image',4,'Paintings, camera, and lighting equipment inside Saiel Dauhn Solehman''s Goat Farm live/work studio.','Live/work studio · May 11, 2021',0,datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  note_entity_id=excluded.note_entity_id,media_id=excluded.media_id,asset_token=excluded.asset_token,
  role=excluded.role,sort_order=excluded.sort_order,alt_text_override=excluded.alt_text_override,
  caption_override=excluded.caption_override,public_visible=0,updated_at=excluded.updated_at;

INSERT INTO archive_note_links
  (note_entity_id,target_entity_id,relationship_role,is_primary,sort_order,public_visible,created_at)
VALUES
  ('archive-note-saiel-goat-farm-studio-years','archive-record-saiel-goat-farm-studio-years','development',1,1,0,datetime('now')),
  ('archive-note-saiel-goat-farm-studio-years','place-goat-farm-arts-center','context',0,2,0,datetime('now')),
  ('archive-note-saiel-goat-farm-studio-years','place-jr-erikson-building','context',0,3,0,datetime('now'))
ON CONFLICT(note_entity_id,target_entity_id,relationship_role) DO UPDATE SET
  is_primary=excluded.is_primary,sort_order=excluded.sort_order,public_visible=0;
