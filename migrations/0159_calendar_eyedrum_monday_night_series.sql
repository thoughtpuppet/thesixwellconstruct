PRAGMA foreign_keys = ON;

-- Monday Night Creative Music is one Eyedrum series whose official listings
-- announce a different lineup for each performance. Keep the definition in
-- source configuration so future Eyedrum series can use the same adapter path.
UPDATE calendar_sources
SET adapter_config_json=json_set(
      COALESCE(NULLIF(adapter_config_json,''),'{}'),
      '$.recurringSeries',
      json('[{"id":"monday-night-creative-music","title":"Monday Night Creative Music","prefixes":["Monday Night Creative Music Series","Monday Night Creative Music"],"stableSourceIdentity":"eyedrum-series-monday-night-creative-music","defaultOccurrenceType":"performance","description":"Eyedrum''s recurring experimental and improvised creative-music performance series with a separately announced lineup for each date."}]')
    ),
    updated_at=datetime('now')
WHERE id='cal_source_eyedrum';

-- This temporary migration map lets a clean replay consolidate the two seeded
-- programs and lets production consolidate all five already-published records.
CREATE TABLE _migration_0159_mncm_programs (
  program_key TEXT PRIMARY KEY,
  candidate_occurrence_id TEXT NOT NULL,
  entry_occurrence_id TEXT NOT NULL,
  title_match TEXT NOT NULL,
  occurrence_label TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO _migration_0159_mncm_programs
  (program_key,candidate_occurrence_id,entry_occurrence_id,title_match,occurrence_label,starts_at,ends_at,sort_order)
VALUES
  ('danny-kamins-majid-araim-zandia-covington-saints','cal_occurrence_mncm_danny_20260907','cal_entry_occurrence_mncm_danny_20260907','%danny kamins%','Danny Kamins / Majid Araim / Zandia Covington and S’aints','2026-09-07T20:00:00-04:00','2026-09-07T22:30:00-04:00',0),
  ('one-year-anniversary-party','cal_occurrence_mncm_anniversary_20260914','cal_entry_occurrence_mncm_anniversary_20260914','%anniversary%','One Year Anniversary Party','2026-09-14T20:00:00-04:00','2026-09-14T22:30:00-04:00',1),
  ('angela-winter-dylan-mantione-aaron-kruziki','cal_occurrence_mncm_angela_20260921','cal_entry_occurrence_mncm_angela_20260921','%angela winter%','Angela Winter with Dylan Mantione and Aaron Kruziki','2026-09-21T20:00:00-04:00','2026-09-21T22:30:00-04:00',2),
  ('toby-summerfield-jeffrey-butzer-academy','cal_occurrence_mncm_toby_20260928','cal_entry_occurrence_mncm_toby_20260928','%toby summerfield%','Toby Summerfield with Jeffrey Bützer’s Academy of Staring Daggers','2026-09-28T20:00:00-04:00','2026-09-28T22:30:00-04:00',3);

CREATE TABLE _migration_0159_mncm_candidates (
  candidate_id TEXT PRIMARY KEY
);

INSERT INTO _migration_0159_mncm_candidates(candidate_id)
SELECT id FROM calendar_candidates
WHERE source_id='cal_source_eyedrum'
  AND (
    lower(trim(title)) IN ('monday night creative music','monday night creative music series')
    OR substr(ltrim(substr(title,length('Monday Night Creative Music')+1)),1,1) IN (':','-','–','—')
    OR substr(ltrim(substr(title,length('Monday Night Creative Music Series')+1)),1,1) IN (':','-','–','—')
  );

-- Supersede unresolved standalone proposals before changing the approved
-- parent. Historical candidates, notes, revisions, and provenance remain.
UPDATE calendar_candidate_revisions
SET revision_state='superseded',reviewed_at=datetime('now')
WHERE revision_state='pending'
  AND candidate_id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates);

-- Prefer the richer event-detail candidate for factual occurrence fields. The
-- fixed local timestamps reconcile equivalent UTC and Atlanta representations.
INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,source_url,ticket_url,
   status,verification_state,verification_notes,sort_order,created_at,updated_at,
   access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,
   attendance_mode,recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,
   late_arrival_allowed,planning_eligible,latitude,longitude,planning_notes)
SELECT
  p.candidate_occurrence_id,'cal_candidate_eyedrum_anniversary',
  COALESCE(NULLIF(c.source_event_id,''),p.program_key),'performance',p.occurrence_label,
  c.factual_description,'timed',p.starts_at,p.ends_at,'America/New_York',
  c.venue_name,c.venue_address,c.source_url,c.ticket_url,'scheduled','verified',
  'This performance was consolidated from its verified Eyedrum listing; its exact listing remains the occurrence source.',
  p.sort_order,datetime('now'),datetime('now'),c.access_status,c.access_notes,c.audiences_json,
  c.ticket_status,c.ticket_on_sale_at,c.ticket_notes,c.attendance_mode,c.recommended_arrival_minutes,
  c.minimum_visit_minutes,c.recommended_visit_minutes,c.late_arrival_allowed,c.planning_eligible,
  c.latitude,c.longitude,c.planning_notes
FROM _migration_0159_mncm_programs p
JOIN calendar_candidates c ON c.id=(
  SELECT c2.id FROM calendar_candidates c2
  WHERE c2.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
    AND lower(c2.title) LIKE p.title_match
  ORDER BY
    CASE WHEN c2.source_url<>(SELECT url FROM calendar_sources WHERE id='cal_source_eyedrum') THEN 1 ELSE 0 END DESC,
    length(c2.factual_description) DESC,c2.created_at,c2.id
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM calendar_candidates WHERE id='cal_candidate_eyedrum_anniversary');

-- Preserve candidate links and media from every redundant standalone record in
-- the surviving parent gallery. Shared assets are referenced, never deleted.
INSERT OR IGNORE INTO calendar_candidate_links
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role,credit_role)
SELECT 'cal_mncm_link_' || l.id,'cal_candidate_eyedrum_anniversary',l.label,l.url,l.provenance_url,
       l.include_public,l.sort_order,l.created_at,datetime('now'),l.link_role,l.credit_role
FROM calendar_candidate_links l
JOIN calendar_candidates c ON c.id=l.candidate_id
WHERE c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
  AND c.id<>'cal_candidate_eyedrum_anniversary';

UPDATE calendar_candidate_links
SET include_public=1,updated_at=datetime('now')
WHERE candidate_id='cal_candidate_eyedrum_anniversary'
  AND url IN (
    SELECT l.url FROM calendar_candidate_links l
    JOIN calendar_candidates c ON c.id=l.candidate_id
    WHERE c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
      AND c.id<>'cal_candidate_eyedrum_anniversary' AND l.include_public=1
  );

INSERT OR IGNORE INTO calendar_candidate_media
  (id,candidate_id,media_id,source_url,provenance_url,media_role,alt_text,caption,include_public,sort_order,created_at,updated_at)
SELECT 'cal_mncm_media_' || m.id,'cal_candidate_eyedrum_anniversary',m.media_id,m.source_url,m.provenance_url,
       m.media_role,m.alt_text,m.caption,m.include_public,m.sort_order,m.created_at,datetime('now')
FROM calendar_candidate_media m
JOIN calendar_candidates c ON c.id=m.candidate_id
WHERE c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
  AND c.id<>'cal_candidate_eyedrum_anniversary';

UPDATE calendar_candidate_media
SET include_public=1,updated_at=datetime('now')
WHERE candidate_id='cal_candidate_eyedrum_anniversary'
  AND media_id IN (
    SELECT m.media_id FROM calendar_candidate_media m
    JOIN calendar_candidates c ON c.id=m.candidate_id
    WHERE c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
      AND c.id<>'cal_candidate_eyedrum_anniversary' AND m.include_public=1
  );

-- Copy the four established public identities onto child occurrences before
-- redundant standalone entries are removed. Angela keeps the original seeded
-- calendar identity while the richer detail listing supplies its facts.
INSERT OR IGNORE INTO calendar_entry_occurrences
  (id,entry_id,candidate_occurrence_id,uid,sequence,status,occurrence_type,title,
   factual_description,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,
   source_url,ticket_url,published_at,last_modified_at,last_verified_at,
   access_status,access_notes,audiences_json,ticket_status,ticket_on_sale_at,ticket_notes,
   attendance_mode,recommended_arrival_minutes,minimum_visit_minutes,recommended_visit_minutes,
   late_arrival_allowed,planning_eligible,latitude,longitude,planning_notes)
SELECT
  p.entry_occurrence_id,parent_entry.id,p.candidate_occurrence_id,old_entry.uid,old_entry.sequence+1,
  'published','performance','Monday Night Creative Music — ' || p.occurrence_label,
  occurrence.factual_description,'timed',p.starts_at,p.ends_at,'America/New_York',
  occurrence.venue_name,occurrence.venue_address,occurrence.source_url,occurrence.ticket_url,
  old_entry.published_at,datetime('now'),COALESCE(old_entry.last_verified_at,datetime('now')),
  occurrence.access_status,occurrence.access_notes,occurrence.audiences_json,
  occurrence.ticket_status,occurrence.ticket_on_sale_at,occurrence.ticket_notes,
  occurrence.attendance_mode,occurrence.recommended_arrival_minutes,occurrence.minimum_visit_minutes,
  occurrence.recommended_visit_minutes,occurrence.late_arrival_allowed,occurrence.planning_eligible,
  occurrence.latitude,occurrence.longitude,occurrence.planning_notes
FROM _migration_0159_mncm_programs p
JOIN calendar_candidate_occurrences occurrence ON occurrence.id=p.candidate_occurrence_id
JOIN calendar_entries parent_entry ON parent_entry.candidate_id='cal_candidate_eyedrum_anniversary'
JOIN calendar_entries old_entry ON old_entry.id=(
  SELECT e2.id FROM calendar_entries e2
  JOIN calendar_candidates c2 ON c2.id=e2.candidate_id
  WHERE c2.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
    AND lower(c2.title) LIKE p.title_match
  ORDER BY CASE WHEN c2.id='cal_candidate_eyedrum_winter' THEN 0 ELSE 1 END,
           e2.published_at,e2.id
  LIMIT 1
);

-- Copy public links and media to the parent entry before deleting old entries.
INSERT OR IGNORE INTO calendar_entry_links
  (id,entry_id,candidate_link_id,label,url,sort_order,link_role,credit_role)
SELECT 'cal_mncm_entry_link_' || l.id,parent.id,
       (SELECT cl.id FROM calendar_candidate_links cl
        WHERE cl.candidate_id='cal_candidate_eyedrum_anniversary' AND cl.url=l.url LIMIT 1),
       l.label,l.url,l.sort_order,l.link_role,l.credit_role
FROM calendar_entry_links l
JOIN calendar_entries retired ON retired.id=l.entry_id
JOIN calendar_candidates c ON c.id=retired.candidate_id
JOIN calendar_entries parent ON parent.candidate_id='cal_candidate_eyedrum_anniversary'
WHERE retired.id<>parent.id
  AND c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates);

INSERT OR IGNORE INTO calendar_entry_media
  (id,entry_id,candidate_media_id,media_id,media_role,alt_text,caption,sort_order)
SELECT 'cal_mncm_entry_media_' || m.id,parent.id,
       (SELECT cm.id FROM calendar_candidate_media cm
        WHERE cm.candidate_id='cal_candidate_eyedrum_anniversary' AND cm.media_id=m.media_id LIMIT 1),
       m.media_id,m.media_role,m.alt_text,m.caption,m.sort_order
FROM calendar_entry_media m
JOIN calendar_entries retired ON retired.id=m.entry_id
JOIN calendar_candidates c ON c.id=retired.candidate_id
JOIN calendar_entries parent ON parent.candidate_id='cal_candidate_eyedrum_anniversary'
WHERE retired.id<>parent.id
  AND c.id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates);

-- Convert the survivor to organizational series metadata. Only its dated child
-- occurrences are emitted as public event cards or feed components.
UPDATE calendar_candidates
SET source_event_id='eyedrum-series-monday-night-creative-music',
    source_url=(SELECT url FROM calendar_sources WHERE id='cal_source_eyedrum'),
    ticket_url='',title='Monday Night Creative Music',organizer='Eyedrum',
    factual_description='Eyedrum''s recurring experimental and improvised creative-music performance series with a separately announced lineup for each date.',
    event_structure='series',date_kind='date_range',
    starts_at=(SELECT substr(MIN(starts_at),1,10) FROM calendar_candidate_occurrences WHERE candidate_id='cal_candidate_eyedrum_anniversary'),
    ends_at=(SELECT substr(MAX(starts_at),1,10) FROM calendar_candidate_occurrences WHERE candidate_id='cal_candidate_eyedrum_anniversary'),
    timezone='America/New_York',subjects_json='["art","poetry-music","creative-technology"]',
    formats_json='["performance","experimental-event"]',is_experimental=1,
    status=CASE WHEN public_entry_id<>'' THEN 'published' ELSE status END,
    verification_state='verified',
    verification_notes='The series parent and its separately dated performances were verified from Eyedrum''s official calendar listings.',
    organizer_url='https://www.eyedrum.org/',venue_url='https://www.eyedrum.org/',
    source_authority='official_calendar',source_resolution_notes='Each performance retains its exact official Eyedrum detail listing.',
    pending_revision_id='',updated_at=datetime('now')
WHERE id='cal_candidate_eyedrum_anniversary';

UPDATE calendar_entries
SET sequence=sequence+1,source_url=(SELECT url FROM calendar_sources WHERE id='cal_source_eyedrum'),
    ticket_url='',title='Monday Night Creative Music',organizer='Eyedrum',
    factual_description='Eyedrum''s recurring experimental and improvised creative-music performance series with a separately announced lineup for each date.',
    event_structure='series',date_kind='date_range',
    starts_at=(SELECT substr(MIN(starts_at),1,10) FROM calendar_entry_occurrences WHERE entry_id=calendar_entries.id),
    ends_at=(SELECT substr(MAX(starts_at),1,10) FROM calendar_entry_occurrences WHERE entry_id=calendar_entries.id),
    timezone='America/New_York',subjects_json='["art","poetry-music","creative-technology"]',
    formats_json='["performance","experimental-event"]',is_experimental=1,
    organizer_url='https://www.eyedrum.org/',venue_url='https://www.eyedrum.org/',
    source_authority='official_calendar',last_modified_at=datetime('now'),last_verified_at=datetime('now')
WHERE candidate_id='cal_candidate_eyedrum_anniversary'
  AND EXISTS (SELECT 1 FROM calendar_entry_occurrences WHERE entry_id=calendar_entries.id);

-- Preserve redundant candidates and their research history as duplicate records,
-- while removing only their duplicate public snapshots.
UPDATE calendar_candidates
SET status='duplicate',duplicate_of='cal_candidate_eyedrum_anniversary',public_entry_id='',
    pending_revision_id='',monitoring_enabled=0,next_check_at=NULL,updated_at=datetime('now')
WHERE id IN (SELECT candidate_id FROM _migration_0159_mncm_candidates)
  AND id<>'cal_candidate_eyedrum_anniversary';

DELETE FROM calendar_entries
WHERE candidate_id IN (
  SELECT id FROM calendar_candidates
  WHERE duplicate_of='cal_candidate_eyedrum_anniversary'
);

DROP TABLE _migration_0159_mncm_programs;
DROP TABLE _migration_0159_mncm_candidates;

PRAGMA foreign_keys = ON;
