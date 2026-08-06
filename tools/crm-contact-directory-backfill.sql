-- Backfill the People directory from every first-party interaction that stored
-- both a usable name and email. This file is intentionally idempotent so it can
-- be reviewed with a local D1 copy and safely rerun against the remote database.
--
-- `website_booking` remains the legacy constrained eligibility_reason key.
-- eligibility_source_* preserves the exact interaction that qualified a person.

DROP TABLE IF EXISTS crm_contact_backfill_sources;
DROP TABLE IF EXISTS crm_contact_backfill_people;

CREATE TABLE crm_contact_backfill_sources (
  source_provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  node_id TEXT,
  interaction_type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source_provider,source_type,source_id)
);

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local',
  'submission',
  s.id,
  trim(s.contact_name),
  trim(s.contact_email),
  lower(trim(s.contact_email)),
  trim(COALESCE(s.contact_phone,'')),
  CASE
    WHEN s.type IN ('tattoo_inquiry','flash_claim','special_project','tattoo_special','build_brief','build_your_own','byo','maze_design','consultation','build_session') THEN 'node-tattoos'
    WHEN s.type='art_acquisition' THEN 'node-art'
    WHEN s.type LIKE '%event%' OR s.type LIKE '%rsvp%' OR s.type LIKE '%waitlist%' OR s.type LIKE '%open_mic%' THEN 'node-events'
    WHEN s.type LIKE '%merch%' OR s.type LIKE '%shop%' OR s.type LIKE '%order%' THEN 'node-merch'
    ELSE NULL
  END,
  COALESCE(NULLIF(trim(s.type),''),'submission'),
  COALESCE(NULLIF(trim(s.subject),''),NULLIF(trim(s.type),''),'Website submission'),
  COALESCE(NULLIF(trim(s.status),''),'new'),
  1,
  s.created_at,
  json_object('submissionId',s.id,'sourcePath',COALESCE(s.source_path,''))
FROM submissions s
WHERE trim(s.contact_name)!=''
  AND trim(s.contact_email)!=''
  AND lower(trim(s.contact_name))!=lower(trim(s.contact_email))
  AND lower(trim(s.contact_email)) LIKE '%_@_%._%'
  AND instr(trim(s.contact_email),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local' AND d.source_type='submission' AND d.source_id=s.id
  );

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local',
  'submission_participant',
  s.id||':'||(CAST(part.key AS INTEGER)+1),
  trim(json_extract(part.value,'$.name')),
  trim(json_extract(part.value,'$.email')),
  lower(trim(json_extract(part.value,'$.email'))),
  trim(COALESCE(json_extract(part.value,'$.phone'),'')),
  'node-tattoos',
  'tattoo_special_participant',
  COALESCE(NULLIF(trim(s.subject),''),'Tattoo Special')||' participant',
  COALESCE(NULLIF(trim(s.status),''),'new'),
  1,
  s.created_at,
  json_object('submissionId',s.id,'participantIndex',CAST(part.key AS INTEGER))
FROM submissions s
JOIN json_each(
  CASE WHEN json_valid(s.contact_json) THEN s.contact_json ELSE '{}' END,
  '$.participants'
) part
WHERE CAST(part.key AS INTEGER)>0
  AND trim(COALESCE(json_extract(part.value,'$.name'),''))!=''
  AND trim(COALESCE(json_extract(part.value,'$.email'),''))!=''
  AND lower(trim(json_extract(part.value,'$.name')))!=lower(trim(json_extract(part.value,'$.email')))
  AND lower(trim(json_extract(part.value,'$.email'))) LIKE '%_@_%._%'
  AND instr(trim(json_extract(part.value,'$.email')),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local'
      AND d.source_type='submission_participant'
      AND d.source_id=s.id||':'||(CAST(part.key AS INTEGER)+1)
  );

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local','appointment',a.id,trim(a.client_name),trim(a.client_email),
  lower(trim(a.client_email)),trim(COALESCE(a.client_phone,'')),
  CASE
    WHEN a.booking_type_id='studio_visit' THEN 'node-art'
    WHEN a.purpose='studio' THEN 'node-events'
    ELSE 'node-tattoos'
  END,
  'appointment',COALESCE(NULLIF(trim(a.purpose),''),a.booking_type_id,'Appointment'),
  COALESCE(NULLIF(trim(a.status),''),'pending_deposit'),1,
  COALESCE(a.start_at,a.created_at),
  json_object('appointmentId',a.id,'submissionId',COALESCE(a.submission_id,''))
FROM appointments a
WHERE trim(a.client_name)!=''
  AND trim(a.client_email)!=''
  AND lower(trim(a.client_name))!=lower(trim(a.client_email))
  AND lower(trim(a.client_email)) LIKE '%_@_%._%'
  AND instr(trim(a.client_email),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local' AND d.source_type='appointment' AND d.source_id=a.id
  );

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local','event_ticket',t.id,trim(t.contact_name),trim(t.contact_email),
  lower(trim(t.contact_email)),trim(COALESCE(t.contact_phone,'')),'node-events',
  'event_ticket_purchase',COALESCE(NULLIF(trim(e.title),''),'Event ticket'),
  COALESCE(NULLIF(trim(t.status),''),'pending'),MAX(1,t.seats),
  COALESCE(t.paid_at,t.created_at),
  json_object('eventId',t.event_id,'eventSlug',COALESCE(e.slug,''),'purchaserNotAttendee',json('true'))
FROM event_tickets t
LEFT JOIN events e ON e.id=t.event_id
WHERE trim(t.contact_name)!=''
  AND trim(t.contact_email)!=''
  AND lower(trim(t.contact_name))!=lower(trim(t.contact_email))
  AND lower(trim(t.contact_email)) LIKE '%_@_%._%'
  AND instr(trim(t.contact_email),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local' AND d.source_type='event_ticket' AND d.source_id=t.id
  );

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local','event_waitlist',w.id,trim(w.contact_name),trim(w.contact_email),
  lower(trim(w.contact_email)),trim(COALESCE(w.contact_phone,'')),'node-events',
  'event_waitlist',COALESCE(NULLIF(trim(e.title),''),'Event waitlist'),
  COALESCE(NULLIF(trim(w.status),''),'new'),MAX(1,w.seats_requested),w.created_at,
  json_object('eventId',w.event_id,'eventSlug',COALESCE(e.slug,''))
FROM event_waitlist w
LEFT JOIN events e ON e.id=w.event_id
WHERE trim(w.contact_name)!=''
  AND trim(w.contact_email)!=''
  AND lower(trim(w.contact_name))!=lower(trim(w.contact_email))
  AND lower(trim(w.contact_email)) LIKE '%_@_%._%'
  AND instr(trim(w.contact_email),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local' AND d.source_type='event_waitlist' AND d.source_id=w.id
  );

INSERT OR IGNORE INTO crm_contact_backfill_sources
SELECT
  'local','event_open_mic',o.id,trim(o.performer_name),trim(o.performer_email),
  lower(trim(o.performer_email)),trim(COALESCE(o.performer_phone,'')),'node-events',
  'performance',COALESCE(NULLIF(trim(o.piece_title),''),NULLIF(trim(o.act_type),''),NULLIF(trim(e.title),''),'Open mic signup'),
  COALESCE(NULLIF(trim(o.status),''),'requested'),1,o.created_at,
  json_object('eventId',o.event_id,'eventSlug',COALESCE(e.slug,''),'actType',COALESCE(o.act_type,''))
FROM event_open_mic_signups o
LEFT JOIN events e ON e.id=o.event_id
WHERE trim(o.performer_name)!=''
  AND trim(o.performer_email)!=''
  AND lower(trim(o.performer_name))!=lower(trim(o.performer_email))
  AND lower(trim(o.performer_email)) LIKE '%_@_%._%'
  AND instr(trim(o.performer_email),' ')=0
  AND NOT EXISTS (
    SELECT 1 FROM crm_deleted_person_sources d
    WHERE d.source_provider='local' AND d.source_type='event_open_mic' AND d.source_id=o.id
  );

CREATE TABLE crm_contact_backfill_people (
  normalized_email TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  is_new INTEGER NOT NULL DEFAULT 0
);

-- Reuse an email only when it has exactly one canonical active owner.
INSERT OR IGNORE INTO crm_contact_backfill_people
SELECT
  s.normalized_email,
  MIN(COALESCE(p.merged_into_id,p.id)),
  0
FROM crm_contact_backfill_sources s
JOIN crm_identities i
  ON i.kind='email' AND i.normalized_value=s.normalized_email AND i.active=1
JOIN crm_people p ON p.id=i.person_id AND p.anonymized_at IS NULL
GROUP BY s.normalized_email
HAVING COUNT(DISTINCT COALESCE(p.merged_into_id,p.id))=1;

-- Create a deterministic mapping for emails that have no prior active owner.
INSERT OR IGNORE INTO crm_contact_backfill_people
SELECT DISTINCT
  s.normalized_email,
  'crm-person-contact-'||lower(hex(randomblob(16))),
  1
FROM crm_contact_backfill_sources s
WHERE NOT EXISTS (
    SELECT 1 FROM crm_contact_backfill_people m
    WHERE m.normalized_email=s.normalized_email
  )
  AND NOT EXISTS (
    SELECT 1 FROM crm_identities i
    WHERE i.kind='email' AND i.normalized_value=s.normalized_email AND i.active=1
  );

INSERT OR IGNORE INTO crm_people (
  id,display_name,relationship_status,preferred_contact_method,
  eligibility_at,eligibility_reason,eligibility_source_provider,
  eligibility_source_type,eligibility_source_id,created_at,updated_at
)
SELECT
  m.person_id,s.display_name,'active','email',s.occurred_at,'website_booking',
  s.source_provider,s.source_type,s.source_id,s.occurred_at,datetime('now')
FROM crm_contact_backfill_people m
JOIN crm_contact_backfill_sources s ON s.rowid=(
  SELECT first_source.rowid
  FROM crm_contact_backfill_sources first_source
  WHERE first_source.normalized_email=m.normalized_email
  ORDER BY first_source.occurred_at,first_source.source_type,first_source.source_id
  LIMIT 1
)
WHERE m.is_new=1;

UPDATE crm_people
SET
  eligibility_at=COALESCE(eligibility_at,(
    SELECT s.occurred_at FROM crm_contact_backfill_people m
    JOIN crm_contact_backfill_sources s ON s.normalized_email=m.normalized_email
    WHERE m.person_id=crm_people.id
    ORDER BY s.occurred_at,s.source_type,s.source_id LIMIT 1
  )),
  eligibility_reason=CASE WHEN eligibility_at IS NULL THEN 'website_booking' ELSE eligibility_reason END,
  eligibility_source_provider=CASE WHEN eligibility_at IS NULL THEN 'local' ELSE eligibility_source_provider END,
  eligibility_source_type=CASE WHEN eligibility_at IS NULL THEN (
    SELECT s.source_type FROM crm_contact_backfill_people m
    JOIN crm_contact_backfill_sources s ON s.normalized_email=m.normalized_email
    WHERE m.person_id=crm_people.id
    ORDER BY s.occurred_at,s.source_type,s.source_id LIMIT 1
  ) ELSE eligibility_source_type END,
  eligibility_source_id=CASE WHEN eligibility_at IS NULL THEN (
    SELECT s.source_id FROM crm_contact_backfill_people m
    JOIN crm_contact_backfill_sources s ON s.normalized_email=m.normalized_email
    WHERE m.person_id=crm_people.id
    ORDER BY s.occurred_at,s.source_type,s.source_id LIMIT 1
  ) ELSE eligibility_source_id END,
  updated_at=datetime('now')
WHERE id IN (SELECT person_id FROM crm_contact_backfill_people);

INSERT OR IGNORE INTO crm_identities (
  id,person_id,kind,value,normalized_value,provider,external_id,label,
  is_primary,is_verified,is_shared,source_provider,source_type,source_id,
  active,created_at,updated_at
)
SELECT
  'crm-identity-contact-'||lower(hex(randomblob(16))),m.person_id,'email',
  s.email,s.normalized_email,s.source_provider,NULL,'',
  CASE WHEN EXISTS(
    SELECT 1 FROM crm_identities existing
    WHERE existing.person_id=m.person_id AND existing.kind='email' AND existing.active=1
  ) THEN 0 ELSE 1 END,
  0,0,s.source_provider,s.source_type,s.source_type||':'||s.source_id||':email',
  1,datetime('now'),datetime('now')
FROM crm_contact_backfill_people m
JOIN crm_contact_backfill_sources s ON s.rowid=(
  SELECT first_source.rowid FROM crm_contact_backfill_sources first_source
  WHERE first_source.normalized_email=m.normalized_email
  ORDER BY first_source.occurred_at,first_source.source_type,first_source.source_id LIMIT 1
)
WHERE NOT EXISTS (
  SELECT 1 FROM crm_identities existing
  WHERE existing.person_id=m.person_id AND existing.kind='email'
    AND existing.normalized_value=m.normalized_email AND existing.active=1
);

INSERT OR IGNORE INTO crm_identities (
  id,person_id,kind,value,normalized_value,provider,external_id,label,
  is_primary,is_verified,is_shared,source_provider,source_type,source_id,
  active,created_at,updated_at
)
SELECT
  'crm-identity-source-'||lower(hex(randomblob(16))),m.person_id,'other',
  s.source_type||':'||s.source_id,lower(s.source_type||':'||s.source_id),
  s.source_provider,s.source_type||':'||s.source_id,'',0,1,0,
  s.source_provider,s.source_type,s.source_type||':'||s.source_id||':external',
  1,datetime('now'),datetime('now')
FROM crm_contact_backfill_sources s
JOIN crm_contact_backfill_people m ON m.normalized_email=s.normalized_email;

INSERT OR IGNORE INTO crm_identities (
  id,person_id,kind,value,normalized_value,provider,external_id,label,
  is_primary,is_verified,is_shared,source_provider,source_type,source_id,
  active,created_at,updated_at
)
SELECT
  'crm-email-claim-'||lower(hex(randomblob(16))),m.person_id,'other',
  m.normalized_email,m.normalized_email,'crm_email_claim',m.normalized_email,'',
  0,0,0,'system','email_claim',NULL,0,datetime('now'),datetime('now')
FROM crm_contact_backfill_people m;

INSERT OR IGNORE INTO crm_interactions (
  id,person_id,node_id,channel,interaction_type,label,status,quantity,
  occurred_at,source_provider,source_type,source_id,metadata_json,
  active,created_at,updated_at
)
SELECT
  'crm-interaction-contact-'||lower(hex(randomblob(16))),m.person_id,s.node_id,
  'website',s.interaction_type,s.label,s.status,s.quantity,s.occurred_at,
  s.source_provider,s.source_type,s.source_id,s.metadata_json,
  1,datetime('now'),datetime('now')
FROM crm_contact_backfill_sources s
JOIN crm_contact_backfill_people m ON m.normalized_email=s.normalized_email;

UPDATE crm_interactions
SET
  person_id=(
    SELECT m.person_id FROM crm_contact_backfill_sources s
    JOIN crm_contact_backfill_people m ON m.normalized_email=s.normalized_email
    WHERE s.source_provider=crm_interactions.source_provider
      AND s.source_type=crm_interactions.source_type
      AND s.source_id=crm_interactions.source_id
    LIMIT 1
  ),
  active=1,
  updated_at=datetime('now')
WHERE (person_id IS NULL OR person_id=(
    SELECT m.person_id FROM crm_contact_backfill_sources s
    JOIN crm_contact_backfill_people m ON m.normalized_email=s.normalized_email
    WHERE s.source_provider=crm_interactions.source_provider
      AND s.source_type=crm_interactions.source_type
      AND s.source_id=crm_interactions.source_id
    LIMIT 1
  ))
  AND EXISTS (
    SELECT 1 FROM crm_contact_backfill_sources s
    WHERE s.source_provider=crm_interactions.source_provider
      AND s.source_type=crm_interactions.source_type
      AND s.source_id=crm_interactions.source_id
  );

SELECT
  (SELECT COUNT(*) FROM crm_contact_backfill_sources) AS qualifying_source_records,
  (SELECT COUNT(DISTINCT normalized_email) FROM crm_contact_backfill_sources) AS qualifying_emails,
  (SELECT COUNT(*) FROM crm_contact_backfill_people) AS mapped_people,
  (SELECT COUNT(*) FROM crm_contact_backfill_people WHERE is_new=1) AS people_created,
  (
    SELECT COUNT(DISTINCT s.normalized_email)
    FROM crm_contact_backfill_sources s
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_contact_backfill_people m
      WHERE m.normalized_email=s.normalized_email
    )
  ) AS ambiguous_emails_skipped;

DROP TABLE crm_contact_backfill_people;
DROP TABLE crm_contact_backfill_sources;
