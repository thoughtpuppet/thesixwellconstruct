PRAGMA foreign_keys = ON;

-- Art Making is a public calendar subject and a Scout concern. Event records
-- remain ordinary D1 data; adding future events does not require migrations.
UPDATE calendar_scout_profiles
SET weighted_subjects_json=json_set(weighted_subjects_json,'$."art-making"',1.0),
    updated_at=datetime('now')
WHERE id='atlanta-default';

UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','art making'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='art making'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','sip and paint'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='sip and paint'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','live drawing'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='live drawing'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','figure drawing'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='figure drawing'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','critique group'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='critique group'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','public art class'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='public art class'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','open studio'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='open studio'
);
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','studio workshop'),updated_at=datetime('now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json) WHERE lower(value)='studio workshop'
);

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_high_art_making','High Museum of Art - Art Making',
   'https://high.org/event-category/for-adults/art-making/','official_html','official',1,24,
   'automatic','static','{"maxPages":5,"perRunLimit":60}',datetime('now'),datetime('now'));

UPDATE calendar_sources
SET name='High Museum of Art - Art Making',source_type='official_html',trust_level='official',enabled=1,
    cadence_hours=24,adapter_key='automatic',render_mode='static',adapter_config_json='{"maxPages":5,"perRunLimit":60}',updated_at=datetime('now')
WHERE id='cal_source_high_art_making';

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,schedule_status,ticket_status,ticket_notes,
   discovery_url,organizer_url,venue_url,source_authority,source_resolution_notes,
   title,organizer,factual_description,event_structure,access_status,access_notes,audiences_json,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,duplicate_of,public_entry_id,pending_revision_id,rejection_reason,discovered_by,discovery_channel,
   first_seen_at,last_verified_at,last_checked_at,last_check_status,last_check_summary,
   monitoring_enabled,monitoring_cadence_hours,next_check_at,created_at,updated_at)
VALUES
  ('cal_candidate_high_study_hall_2026','cal_source_high_art_making',
   'high-art-making-series-study-hall-a-creative-connection-space-for-working-artists',
   'https://high.org/event-category/for-adults/art-making/','','scheduled','unknown',
   'Study Hall is free with museum admission; use each official occurrence page for current admission options.',
   '','https://high.org/','https://high.org/visit/','official_calendar',
   'The High Museum Art Making archive is the official series source; each dated session retains its own official event page.',
   'Study Hall: A Creative Connection Space for Working Artists','High Museum of Art',
   'A monthly work session inviting Atlanta artists to create, experiment, and connect through self-directed creative practice and peer exchange inside the museum.',
   'series','public','Free with museum admission. Artists bring their own materials; review the official session page for current visitor and material guidance.','["Public","Working artists"]',
   'date_range','2026-08-23','2026-09-27','America/New_York','High Museum of Art - Orkin Terrace',
   '1280 Peachtree Street NE, Atlanta, GA 30309','Atlanta','GA','["art","art-making"]','["workshop"]',0,
   'candidate','verified','The August 23 and September 27 sessions were confirmed on the High Museum of Art official Art Making archive and event pages.',
   0.98,'','','','','seed','direct',datetime('now'),datetime('now'),NULL,'never','',1,24,datetime('now','+24 hours'),datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_high_study_hall_2026',
   'A recurring, low-barrier working session for Atlanta artists directly matches participatory art making, peer exchange, and public creative practice.',
   'Attend to observe the working format, meet local artists, and assess the balance between self-direction and facilitated community.',
   'Study recurring open-work-session structure, material boundaries for public spaces, peer feedback norms, and the relationship between active making and museum visitors.',
   'High Museum of Art; Flex Aloysius; participating Atlanta artists.',
   'Private review intelligence. The parent date range is series metadata; only dated occurrences may become public calendar events.',datetime('now'));

INSERT INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,access_status,access_notes,audiences_json,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,ticket_status,ticket_notes,
   status,verification_state,verification_notes,sort_order,created_at,updated_at)
VALUES
  ('cal_occurrence_high_study_hall_august_2026','cal_candidate_high_study_hall_2026','study-hall-august','workshop','August 23 Session',
   'A self-directed Study Hall work session for Atlanta artists, with space for experimentation, peer exchange, and optional museum-inspired resources.',
   'public','Free with museum admission. Artists bring their own materials.','["Public","Working artists"]','timed',
   '2026-08-23T13:00:00-04:00','2026-08-23T15:30:00-04:00','America/New_York','High Museum of Art - Orkin Terrace',
   '1280 Peachtree Street NE, Atlanta, GA 30309','https://high.org/event/study-hall-august/','','unknown','Free with museum admission.',
   'scheduled','verified','Date, time, location, access, and program details confirmed on the official High Museum event page.',0,datetime('now'),datetime('now')),
  ('cal_occurrence_high_study_hall_september_2026','cal_candidate_high_study_hall_2026','study-hall-september','workshop','September 27 Session',
   'A self-directed Study Hall work session for Atlanta artists, with space for experimentation, peer exchange, and optional museum-inspired resources.',
   'public','Free with museum admission. Artists bring their own materials.','["Public","Working artists"]','timed',
   '2026-09-27T13:00:00-04:00','2026-09-27T15:30:00-04:00','America/New_York','High Museum of Art - Orkin Terrace',
   '1280 Peachtree Street NE, Atlanta, GA 30309','https://high.org/event/study-hall-september/','','unknown','Free with museum admission.',
   'scheduled','verified','Date, time, location, access, and program details confirmed on the official High Museum event page.',1,datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  source_event_id=excluded.source_event_id,occurrence_type=excluded.occurrence_type,title=excluded.title,
  factual_description=excluded.factual_description,access_status=excluded.access_status,access_notes=excluded.access_notes,
  audiences_json=excluded.audiences_json,date_kind=excluded.date_kind,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
  timezone=excluded.timezone,venue_name=excluded.venue_name,venue_address=excluded.venue_address,
  source_url=excluded.source_url,ticket_url=excluded.ticket_url,ticket_status=excluded.ticket_status,ticket_notes=excluded.ticket_notes,
  status=excluded.status,verification_state=excluded.verification_state,verification_notes=excluded.verification_notes,
  sort_order=excluded.sort_order,updated_at=excluded.updated_at;

INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at,change_set_json)
SELECT
  'cal_revision_high_study_hall_2026',c.id,
  (SELECT COALESCE(MAX(revision_number),0)+1 FROM calendar_candidate_revisions WHERE candidate_id=c.id),
  'pending',
  json_object(
    'title',c.title,'organizer',c.organizer,'factualDescription',c.factual_description,'eventStructure',c.event_structure,
    'accessStatus',c.access_status,'accessNotes',c.access_notes,'audiences',json(c.audiences_json),
    'dateKind',c.date_kind,'startsAt',c.starts_at,'endsAt',c.ends_at,'timezone',c.timezone,
    'venueName',c.venue_name,'venueAddress',c.venue_address,'city',c.city,'region',c.region,
    'subjects',json(c.subjects_json),'formats',json(c.formats_json),'experimental',json(iif(c.is_experimental=1,'true','false')),
    'sourceUrl',c.source_url,'ticketUrl',c.ticket_url,'scheduleStatus',c.schedule_status,
    'ticketStatus',c.ticket_status,'ticketOnSaleAt',c.ticket_on_sale_at,'ticketNotes',c.ticket_notes,
    'organizerUrl',c.organizer_url,'venueUrl',c.venue_url,'sourceAuthority',c.source_authority,
    'sourceResolutionNotes',c.source_resolution_notes,
    'occurrences',json((SELECT json_group_array(json_object(
      'id',o.id,'sourceEventId',o.source_event_id,'occurrenceType',o.occurrence_type,'title',o.title,
      'factualDescription',o.factual_description,'accessStatus',o.access_status,'accessNotes',o.access_notes,
      'audiences',json(o.audiences_json),'dateKind',o.date_kind,'startsAt',o.starts_at,'endsAt',o.ends_at,
      'timezone',o.timezone,'venueName',o.venue_name,'venueAddress',o.venue_address,'sourceUrl',o.source_url,
      'ticketUrl',o.ticket_url,'ticketStatus',o.ticket_status,'ticketOnSaleAt',o.ticket_on_sale_at,
      'ticketNotes',o.ticket_notes,'status',o.status,'verificationState',o.verification_state,
      'verificationNotes',o.verification_notes,'sortOrder',o.sort_order
    )) FROM calendar_candidate_occurrences o WHERE o.candidate_id=c.id ORDER BY o.sort_order))
  ),
  json_array(
    json_object('url','https://high.org/event-category/for-adults/art-making/','role','official series calendar','verifiedAt',datetime('now')),
    json_object('url','https://high.org/event/study-hall-august/','role','official occurrence','verifiedAt',datetime('now')),
    json_object('url','https://high.org/event/study-hall-september/','role','official occurrence','verifiedAt',datetime('now'))
  ),
  'Added Study Hall as one private recurring series with two independently dated official occurrences.',
  'migration-0145',datetime('now'),'[]'
FROM calendar_candidates c
WHERE c.id='cal_candidate_high_study_hall_2026';

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_high_study_hall_2026',updated_at=datetime('now')
WHERE id='cal_candidate_high_study_hall_2026';
