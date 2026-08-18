PRAGMA foreign_keys = ON;

ALTER TABLE calendar_candidates ADD COLUMN event_structure TEXT NOT NULL DEFAULT 'single'
  CHECK (event_structure IN ('single','series','exhibition'));
ALTER TABLE calendar_entries ADD COLUMN event_structure TEXT NOT NULL DEFAULT 'single'
  CHECK (event_structure IN ('single','series','exhibition'));

ALTER TABLE calendar_sources ADD COLUMN adapter_key TEXT NOT NULL DEFAULT 'automatic'
  CHECK (adapter_key IN ('automatic','wix','localist','out_of_hand','json','icalendar','rss'));
ALTER TABLE calendar_sources ADD COLUMN render_mode TEXT NOT NULL DEFAULT 'static'
  CHECK (render_mode IN ('static','dynamic-fallback'));
ALTER TABLE calendar_sources ADD COLUMN adapter_config_json TEXT NOT NULL DEFAULT '{}';

-- A series can hold separate programs that begin at the same time. Prefer the
-- organizer's source event identity, with title as the manual-entry fallback,
-- instead of treating every matching type/start pair as one occurrence.
DROP INDEX IF EXISTS idx_calendar_candidate_occurrences_identity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_candidate_occurrences_source_identity
  ON calendar_candidate_occurrences(candidate_id,source_event_id)
  WHERE source_event_id<>'';

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_candidate_occurrences_manual_identity
  ON calendar_candidate_occurrences(candidate_id,occurrence_type,starts_at,title,venue_name)
  WHERE source_event_id='' AND starts_at IS NOT NULL;

UPDATE calendar_candidates
SET event_structure=CASE
  WHEN date_kind='date_range' AND formats_json LIKE '%"exhibition"%' THEN 'exhibition'
  WHEN EXISTS (SELECT 1 FROM calendar_candidate_occurrences o WHERE o.candidate_id=calendar_candidates.id) THEN 'series'
  ELSE 'single'
END;

UPDATE calendar_entries
SET event_structure=CASE
  WHEN date_kind='date_range' AND formats_json LIKE '%"exhibition"%' THEN 'exhibition'
  WHEN EXISTS (SELECT 1 FROM calendar_entry_occurrences o WHERE o.entry_id=calendar_entries.id) THEN 'series'
  ELSE 'single'
END;

INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_out_of_hand_truths','Out of Hand Theater - We Hold These Truths',
   'https://app.outofhandtheater.com/WeHoldTheseTruths','official_html','official',1,24,
   'out_of_hand','dynamic-fallback','{"seriesSlug":"WeHoldTheseTruths","parentSourceId":"outofhand-we-hold-these-truths-2026","maxChildren":12}',datetime('now'),datetime('now'));

UPDATE calendar_sources
SET adapter_key='out_of_hand',render_mode='dynamic-fallback',
    adapter_config_json='{"seriesSlug":"WeHoldTheseTruths","parentSourceId":"outofhand-we-hold-these-truths-2026","maxChildren":12}',updated_at=datetime('now')
WHERE id='cal_source_out_of_hand_truths';

INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,duplicate_of,public_entry_id,pending_revision_id,rejection_reason,discovered_by,
   discovery_channel,access_status,access_notes,audiences_json,first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_gulch_we_hold_truths','cal_source_out_of_hand_truths','outofhand-we-hold-these-truths-2026',
   'https://app.outofhandtheater.com/WeHoldTheseTruths','','We Hold These Truths','Out of Hand Theater',
   'A Metro Atlanta conversation series using theater, shared meals, and guided dialogue to explore the American Dream, community stories, belonging, resilience, and collective possibility.',
   'series','date_range','2026-08-20','2026-09-29','America/New_York','Metro Atlanta','','Atlanta','GA',
   '["art","anthropology","philosophy"]','["performance","panel"]',0,'candidate','verified',
   'The series and eight currently announced conversations were verified on the official Out of Hand Theater series and conversation pages.',
   0.98,'','','','','manual','manual','public','Registration is available on each official conversation page.','["Public"]',
   datetime('now'),datetime('now'),datetime('now'),datetime('now'));

UPDATE calendar_candidates
SET source_id='cal_source_out_of_hand_truths',
    source_event_id='outofhand-we-hold-these-truths-2026',
    source_url='https://app.outofhandtheater.com/WeHoldTheseTruths',
    ticket_url='',
    title='We Hold These Truths',
    organizer='Out of Hand Theater',
    factual_description='A Metro Atlanta conversation series using theater, shared meals, and guided dialogue to explore the American Dream, community stories, belonging, resilience, and collective possibility.',
    event_structure='series',
    date_kind='date_range',starts_at='2026-08-20',ends_at='2026-09-29',timezone='America/New_York',
    venue_name='Metro Atlanta',venue_address='',city='Atlanta',region='GA',
    subjects_json='["art","anthropology","philosophy"]',formats_json='["performance","panel"]',
    status='candidate',verification_state='verified',
    verification_notes='The series and eight currently announced conversations were verified on the official Out of Hand Theater series and conversation pages.',
    confidence=0.98,discovered_by='manual',discovery_channel='manual',
    access_status='public',access_notes='Registration is available on each official conversation page.',audiences_json='["Public"]',
    last_verified_at=datetime('now'),updated_at=datetime('now')
WHERE id='cal_candidate_gulch_we_hold_truths';

INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_gulch_we_hold_truths',
   'Theater, shared meals, facilitated dialogue, civic memory, and community storytelling connect art, anthropology, and philosophy.',
   'Review individual conversations by partner, neighborhood, and venue.',
   'Study how the same theater-and-dialogue framework changes across civic, faith, arts, and community partners.',
   'Out of Hand Theater; Equitable Dinners; participating Metro Atlanta partners.',
   'Private review intelligence; never return from public APIs.',datetime('now'));

INSERT INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,access_status,access_notes,audiences_json,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,status,
   verification_state,verification_notes,sort_order,created_at,updated_at)
VALUES
  ('cal_occurrence_whtt_6988','cal_candidate_gulch_we_hold_truths','outofhand-conversation-6988','other','We Hold These Truths',
   'A theater, refreshments, and guided-dialogue gathering presented with Commissioner Ted Terry and DeKalb District 6.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-08-20T18:00:00-04:00','2026-08-20T20:00:00-04:00','America/New_York',
   'Metro City Church','999 Briarcliff Road NE, Atlanta, GA 30306','https://app.outofhandtheater.com/whtt-template/conversations/6988','https://app.outofhandtheater.com/whtt-template/conversations/6988','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',0,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7024','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7024','other','We Hold These Truths',
   'A shared meal, short play, and facilitated conversation hosted at the Latin American Association.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-09T18:00:00-04:00','2026-09-09T20:00:00-04:00','America/New_York',
   'Latin American Association','2750 Buford Highway NE, Atlanta, GA 30324','https://app.outofhandtheater.com/brookhavenevents/conversations/7024','https://app.outofhandtheater.com/brookhavenevents/conversations/7024','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',1,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7023','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7023','other','We Hold These Truths at The Beloved Community International Expo',
   'A lunch, short play, and guided conversation presented during The King Center Beloved Community International Expo.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-12T12:00:00-04:00','2026-09-12T14:00:00-04:00','America/New_York',
   'The King Center - The Beloved Community International Expo','449 Auburn Avenue NE, Atlanta, GA 30312','https://app.outofhandtheater.com/whtt-template/conversations/7023','https://app.outofhandtheater.com/whtt-template/conversations/7023','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',2,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7029','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7029','other','We Hold These Truths with Fayette County Remembrance Coalition and Christ Our Shepherd Lutheran Church',
   'A shared meal, short play, and facilitated conversation presented with Fayette County Remembrance Coalition and Christ Our Shepherd Lutheran Church.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-13T15:00:00-04:00','2026-09-13T17:00:00-04:00','America/New_York',
   'Christ Our Shepherd Lutheran Church','101 N Peachtree Parkway, Peachtree City, GA 30269','https://app.outofhandtheater.com/whtt-template/conversations/7029','https://app.outofhandtheater.com/whtt-template/conversations/7029','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',3,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7030','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7030','other','We Hold These Truths with Oglethorpe Presbyterian Church',
   'A catered dinner, short play, and guided conversation presented with Oglethorpe Presbyterian Church.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-17T18:00:00-04:00','2026-09-17T20:00:00-04:00','America/New_York',
   'Oglethorpe Presbyterian Church','3016 Lanier Drive NE, Brookhaven, GA 30319','https://app.outofhandtheater.com/whtt-template/conversations/7030','https://app.outofhandtheater.com/whtt-template/conversations/7030','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',4,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7022','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7022','other','We Hold These Truths in Partnership with Fulton County Arts and Culture',
   'A short play, light refreshments, and guided conversation presented with Fulton County Arts and Culture and Northwest Library at Scott Crossing.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-22T17:30:00-04:00','2026-09-22T19:30:00-04:00','America/New_York',
   'Northwest Library at Scott Crossing','2489 Perry Boulevard NW, Atlanta, GA 30318','https://app.outofhandtheater.com/whtt-template/conversations/7022','https://app.outofhandtheater.com/whtt-template/conversations/7022','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',5,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7031','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7031','other','We Hold These Truths Hosted by the City of Decatur',
   'A short play and guided conversation presented at Decatur Legacy Park during Truckin Tuesday; food is available for purchase.',
   'public','Registration is available on the official conversation page. Food is available for purchase from event vendors.','["Public"]','timed','2026-09-29T18:00:00-04:00','2026-09-29T20:30:00-04:00','America/New_York',
   'Decatur Legacy Park','500 S Columbia Drive, Decatur, GA 30030','https://app.outofhandtheater.com/whtt-template/conversations/7031','https://app.outofhandtheater.com/whtt-template/conversations/7031','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',6,datetime('now'),datetime('now')),
  ('cal_occurrence_whtt_7032','cal_candidate_gulch_we_hold_truths','outofhand-conversation-7032','other','We Hold These Truths Hosted by The Carter Center',
   'A catered meal, short play, and guided conversation presented at The Carter Center.',
   'public','Registration is available on the official conversation page.','["Public"]','timed','2026-09-29T18:00:00-04:00','2026-09-29T20:00:00-04:00','America/New_York',
   'The Carter Center','453 John Lewis Freedom Parkway NE, Atlanta, GA 30307','https://app.outofhandtheater.com/whtt-template/conversations/7032','https://app.outofhandtheater.com/whtt-template/conversations/7032','scheduled','verified','Date, time, venue, registration, and program details confirmed on the official conversation page.',7,datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  source_event_id=excluded.source_event_id,occurrence_type=excluded.occurrence_type,title=excluded.title,
  factual_description=excluded.factual_description,access_status=excluded.access_status,access_notes=excluded.access_notes,
  audiences_json=excluded.audiences_json,date_kind=excluded.date_kind,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
  timezone=excluded.timezone,venue_name=excluded.venue_name,venue_address=excluded.venue_address,
  source_url=excluded.source_url,ticket_url=excluded.ticket_url,status=excluded.status,
  verification_state=excluded.verification_state,verification_notes=excluded.verification_notes,
  sort_order=excluded.sort_order,updated_at=excluded.updated_at;

UPDATE calendar_candidate_revisions
SET revision_state='superseded',reviewed_at=datetime('now')
WHERE candidate_id='cal_candidate_gulch_we_hold_truths' AND revision_state='pending';

INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at)
SELECT
  'cal_revision_whtt_series_2026',c.id,
  (SELECT COALESCE(MAX(revision_number),0)+1 FROM calendar_candidate_revisions WHERE candidate_id=c.id),
  'pending',
  json_object(
    'title',c.title,'organizer',c.organizer,'factualDescription',c.factual_description,'eventStructure',c.event_structure,
    'accessStatus',c.access_status,'accessNotes',c.access_notes,'audiences',json(c.audiences_json),
    'dateKind',c.date_kind,'startsAt',c.starts_at,'endsAt',c.ends_at,'timezone',c.timezone,
    'venueName',c.venue_name,'venueAddress',c.venue_address,'city',c.city,'region',c.region,
    'subjects',json(c.subjects_json),'formats',json(c.formats_json),'experimental',json(iif(c.is_experimental=1,'true','false')),
    'sourceUrl',c.source_url,'ticketUrl',c.ticket_url,
    'occurrences',json((SELECT json_group_array(json_object(
      'id',o.id,'sourceEventId',o.source_event_id,'occurrenceType',o.occurrence_type,'title',o.title,
      'factualDescription',o.factual_description,'accessStatus',o.access_status,'accessNotes',o.access_notes,
      'audiences',json(o.audiences_json),'dateKind',o.date_kind,'startsAt',o.starts_at,'endsAt',o.ends_at,
      'timezone',o.timezone,'venueName',o.venue_name,'venueAddress',o.venue_address,'sourceUrl',o.source_url,
      'ticketUrl',o.ticket_url,'status',o.status,'verificationState',o.verification_state,
      'verificationNotes',o.verification_notes,'sortOrder',o.sort_order
    )) FROM calendar_candidate_occurrences o WHERE o.candidate_id=c.id ORDER BY o.sort_order))
  ),
  json_array(
    json_object('url','https://app.outofhandtheater.com/WeHoldTheseTruths','sourceId','cal_source_out_of_hand_truths','verifiedAt',datetime('now'))
  ),
  'Replaced the single Instagram-derived date with the eight currently announced official series conversations.',
  'migration-0137',datetime('now')
FROM calendar_candidates c
WHERE c.id='cal_candidate_gulch_we_hold_truths';

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_whtt_series_2026',updated_at=datetime('now')
WHERE id='cal_candidate_gulch_we_hold_truths';
