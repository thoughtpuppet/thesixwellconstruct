PRAGMA foreign_keys = ON;

-- Guardian Studios is the canonical place. Echo Contemporary Art is the
-- gallery housed inside the studio building, not a duplicate place entity.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('place-guardian-studios','place','node-archive','public',1,0,datetime('now'),NULL,'Echo Contemporary Art is modeled as the gallery inside this place.','migration-0205','migration-0205',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  visibility=excluded.visibility,
  search_visibility=excluded.search_visibility,
  archived_at=NULL,
  internal_notes=excluded.internal_notes,
  updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO places
  (id,name,slug,public_location,private_location,privacy,state,created_at,updated_at)
VALUES
  ('place-guardian-studios','Guardian Studios at Echo Street West','guardian-studios','785 Echo Street NW, Atlanta, GA 30318','','public','published',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  slug=excluded.slug,
  public_location=excluded.public_location,
  private_location=excluded.private_location,
  privacy=excluded.privacy,
  state=excluded.state,
  updated_at=excluded.updated_at;

-- The public personal record is intentionally text-first. No lease, payment
-- record, financial document, or personal photograph is attached or required.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-record-saiel-guardian-studios-years','archive_record','node-archive','public',1,0,datetime('now'),NULL,'Firsthand text record; no documentary proof or private financial attachment requested.','migration-0205','migration-0205',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  visibility=excluded.visibility,
  search_visibility=excluded.search_visibility,
  archived_at=NULL,
  internal_notes=excluded.internal_notes,
  updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO archive_records
  (id,slug,title,node_label,record_type,room,date_or_period,timeline_period,
   summary,body,record_status,state,why_it_matters,source_note,related_routes_json,
   sort_order,medium_label,creator_entity_id,creator_label,date_precision,created_at,updated_at)
VALUES
  ('archive-record-saiel-guardian-studios-years','saiel-guardian-studios-years','Guardian Studios Studio Years, 2023–2025','Saiel Dauhn Solehman','process','People / Places','2023–2025','2023–2025',
   'A firsthand record of Saiel Dauhn Solehman''s move from Studio 30 into the larger Studio 20 at Guardian Studios at Echo Street West.',
   'Solehman entered Studio 30 at Guardian Studios around April 29, 2023. The 241-square-foot studio rented for $588.04 per month, and she used it through approximately May 31, 2023. She then moved directly into Studio 20, a 380-square-foot studio renting for $927.70 per month, around June 1, 2023. That second studio chapter continued until approximately January 7, 2025. These are firsthand occupancy facts and approximate phase dates. They do not establish a residential or live/work use, total rent paid, deposits, lease terms, or payment history.',
   'firsthand studio record','published',
   'The record preserves two successive working spaces as one continuous studio chapter while keeping the smaller-to-larger move, stated costs, and approximate dates visible.',
   'Firsthand account supplied by Saiel Dauhn Solehman. No lease, payment record, financial document, photograph, or inferred memory is used. Both phase boundaries remain approximate unless Solehman later corrects them.',
   '["/archive/places/guardian-studios/","/archive/timelines/saiel-dauhn-solehman/"]',
   31,'Studio history','person-saiel-dauhn-solehman','Saiel Dauhn Solehman','range',datetime('now'),datetime('now'))
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
  ('archive-record-saiel-guardian-studios-years','saiel-guardian-studios-years',
   'A firsthand studio history linking Saiel Dauhn Solehman to two successive workspaces at Guardian Studios at Echo Street West.',
   'The record follows Studio 30, a 241-square-foot workspace used for roughly one month in spring 2023, and Studio 20, a 380-square-foot workspace used from around June 2023 until early January 2025. The move is one continuous place-and-practice chapter, not evidence of residential use or another tenant''s experience.',
   '','No personal photographs have been added to this record.',
   'process','published',1,0,31,datetime('now'),'migration-0205','migration-0205',datetime('now'),datetime('now'))
ON CONFLICT(entity_id) DO UPDATE SET
  archive_slug=excluded.archive_slug,orientation=excluded.orientation,story=excluded.story,
  story_html=excluded.story_html,empty_materials_note=excluded.empty_materials_note,
  record_type=excluded.record_type,state=excluded.state,public_visible=excluded.public_visible,
  featured=excluded.featured,sort_order=excluded.sort_order,
  published_at=COALESCE(archive_dossiers.published_at,excluded.published_at),
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT OR IGNORE INTO archive_dossier_subjects
  (dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at)
VALUES
  ('archive-record-saiel-guardian-studios-years','person-saiel-dauhn-solehman','artist and studio tenant',1,1,datetime('now')),
  ('archive-record-saiel-guardian-studios-years','place-guardian-studios','primary place',1,2,datetime('now'));

INSERT OR IGNORE INTO archive_record_people
  (record_id,person_id,role,public_visible,sort_order)
VALUES
  ('archive-record-saiel-guardian-studios-years','person-saiel-dauhn-solehman','artist and studio tenant',1,1);

INSERT OR IGNORE INTO archive_record_places
  (record_id,place_id,role,public_visible,sort_order)
VALUES
  ('archive-record-saiel-guardian-studios-years','place-guardian-studios','primary place',1,1);

-- One ranged milestone keeps the public timeline concise. The record carries
-- the studio numbers, dimensions, prices, and phase distinction.
INSERT INTO entity_activity
  (id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,
   public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
VALUES
  ('activity-saiel-guardian-studios-years-2023-2025','archive-record-saiel-guardian-studios-years','studio-history','Guardian Studios studio years','Firsthand studio history','2023-04-29','2025-01-07','place-guardian-studios',1,31,'migration-0205',datetime('now'),datetime('now'),
   'A brief Studio 30 phase led directly into the larger Studio 20 at Guardian Studios at Echo Street West.',
   'Around April 29, 2023, Solehman entered Studio 30. Around June 1, 2023, she moved into the larger Studio 20 and remained there until approximately January 7, 2025. The linked Archive record preserves the stated square footage and monthly rent for both workspaces.',
   'range','Approximately April 29, 2023–January 7, 2025','Firsthand account by Saiel Dauhn Solehman. Both phase boundaries are approximate; no financial documents or inferred memories are used.')
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
  ('activity-saiel-guardian-studios-years-2023-2025','person-saiel-dauhn-solehman',1,31,datetime('now'))
ON CONFLICT(activity_id,subject_entity_id) DO UPDATE SET
  public_visible=excluded.public_visible,sort_order=excluded.sort_order;

-- The private Journal is a factual source shell only. It has no attached
-- documents or media, and it is never exposed through public Archive routes.
INSERT INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-note-saiel-guardian-studios-years','archive_note','node-archive','internal',0,0,NULL,NULL,'Private factual source shell based only on Saiel''s supplied account; no documents requested or attached.','migration-0205','migration-0205',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  entity_type=excluded.entity_type,node_id=excluded.node_id,visibility='internal',search_visibility=0,
  public_at=NULL,archived_at=NULL,internal_notes=excluded.internal_notes,
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT INTO archive_notes
  (entity_id,slug,title,note_type,source_app,body_markdown,excerpt,source_created_at,source_modified_at,
   date_label,provenance_note,state,public_visible,sort_order,published_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-note-saiel-guardian-studios-years','saiel-guardian-studios-years-source-journal','Guardian Studios studio years — source Journal','journal-entry','Studio',
   '## Studio 30

- Approximate start: April 29, 2023
- Approximate end: May 31, 2023
- Area: 241 square feet
- Monthly rent: $588.04

## Studio 20

- Approximate start: June 1, 2023
- Approximate end: January 7, 2025
- Area: 380 square feet
- Monthly rent: $927.70

## Evidence boundary

- These are firsthand facts supplied by Saiel Dauhn Solehman.
- No lease, payment record, financial document, photograph, or additional memory was requested or attached.
- The dates remain approximate unless Saiel later corrects them.
- The studios are documented as workspaces; no residential or live/work use is inferred.',
   'A private factual source shell for two successive Guardian Studios workspaces.',NULL,NULL,'2023–2025',
   'Firsthand account supplied by Saiel Dauhn Solehman. No documentary proof is required, and no private financial attachment is present.',
   'draft',0,31,NULL,'migration-0205','migration-0205',datetime('now'),datetime('now'))
ON CONFLICT(entity_id) DO UPDATE SET
  slug=excluded.slug,title=excluded.title,note_type=excluded.note_type,source_app=excluded.source_app,
  body_markdown=excluded.body_markdown,excerpt=excluded.excerpt,date_label=excluded.date_label,
  provenance_note=excluded.provenance_note,state='draft',public_visible=0,published_at=NULL,
  sort_order=excluded.sort_order,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

INSERT INTO archive_note_links
  (note_entity_id,target_entity_id,relationship_role,is_primary,sort_order,public_visible,created_at)
VALUES
  ('archive-note-saiel-guardian-studios-years','archive-record-saiel-guardian-studios-years','development',1,1,0,datetime('now')),
  ('archive-note-saiel-guardian-studios-years','place-guardian-studios','context',0,2,0,datetime('now'))
ON CONFLICT(note_entity_id,target_entity_id,relationship_role) DO UPDATE SET
  is_primary=excluded.is_primary,sort_order=excluded.sort_order,public_visible=0;
