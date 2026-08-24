PRAGMA foreign_keys = ON;

-- An exhibition can have an unknown closing date while still being verified
-- through a bounded date. Weekly visiting hours are separate availability
-- facts: they do not become fake calendar occurrences.
ALTER TABLE calendar_candidates ADD COLUMN confirmed_through TEXT;
ALTER TABLE calendar_candidates ADD COLUMN visiting_hours_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(visiting_hours_json));
ALTER TABLE calendar_candidates ADD COLUMN visiting_hours_note TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN visiting_hours_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN visiting_hours_verified_at TEXT;

ALTER TABLE calendar_entries ADD COLUMN confirmed_through TEXT;
ALTER TABLE calendar_entries ADD COLUMN visiting_hours_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(visiting_hours_json));
ALTER TABLE calendar_entries ADD COLUMN visiting_hours_note TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN visiting_hours_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN visiting_hours_verified_at TEXT;

-- Known venues provide reusable defaults. Approval copies the resolved hours
-- into the public entry so later venue edits cannot silently change a record.
ALTER TABLE calendar_known_organizations ADD COLUMN visiting_hours_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(visiting_hours_json));
ALTER TABLE calendar_known_organizations ADD COLUMN visiting_hours_note TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_known_organizations ADD COLUMN visiting_hours_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_known_organizations ADD COLUMN visiting_hours_verified_at TEXT;

INSERT OR IGNORE INTO calendar_known_organizations
  (id,name,organization_type,aliases_json,official_domains_json,event_paths_json,
   trusted_ticket_domains_json,discovery_only_domains_json,venue_address,notes,enabled,
   created_at,updated_at,visiting_hours_json,visiting_hours_note,
   visiting_hours_source_url,visiting_hours_verified_at)
VALUES
  ('cal_org_welch_school_galleries','The Welch School Galleries','venue',
   '["Welch School Galleries","Ernest G. Welch School of Art & Design Galleries"]',
   '["artdesign.gsu.edu","calendar.gsu.edu"]','["/event/","/galleries/"]','[]','[]',
   '10 Peachtree Center Ave SE. Atlanta, GA 30303',
   'Gallery hours and identity are reusable for exhibitions at The Welch School Galleries.',1,
   datetime('now'),datetime('now'),
   '[{"day":1,"opens":"10:00","closes":"18:00"},{"day":2,"opens":"10:00","closes":"18:00"},{"day":3,"opens":"10:00","closes":"18:00"},{"day":4,"opens":"10:00","closes":"18:00"},{"day":5,"opens":"10:00","closes":"18:00"}]',
   '','',datetime('now'));

UPDATE calendar_known_organizations
SET visiting_hours_json='[{"day":1,"opens":"10:00","closes":"18:00"},{"day":2,"opens":"10:00","closes":"18:00"},{"day":3,"opens":"10:00","closes":"18:00"},{"day":4,"opens":"10:00","closes":"18:00"},{"day":5,"opens":"10:00","closes":"18:00"}]',
    visiting_hours_verified_at=datetime('now'),
    updated_at=datetime('now')
WHERE id='cal_org_welch_school_galleries';

-- Production currently contains two published versions of Where Being Takes
-- Root. Keep the earliest established run and public UID, transfer unique
-- media/links, and retain the redundant candidate as duplicate history.
CREATE TABLE _migration_0169_where_being (
  candidate_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL
);

INSERT INTO _migration_0169_where_being(candidate_id,entry_id)
SELECT c.id,e.id
FROM calendar_candidates c
JOIN calendar_entries e ON e.candidate_id=c.id
WHERE lower(trim(c.title))='where being takes root'
ORDER BY CASE WHEN e.id='cal_entry_628e9243-0576-49b5-bf7d-96a95cfb7d3c' THEN 0 ELSE 1 END,
         c.starts_at,c.created_at,c.id
LIMIT 1;

INSERT OR IGNORE INTO calendar_candidate_media
  (id,candidate_id,media_id,source_url,provenance_url,media_role,alt_text,caption,
   include_public,sort_order,created_at,updated_at)
SELECT 'cal_where_being_media_'||m.id,s.candidate_id,m.media_id,m.source_url,m.provenance_url,
       m.media_role,m.alt_text,m.caption,m.include_public,m.sort_order,m.created_at,datetime('now')
FROM calendar_candidate_media m
JOIN calendar_candidates c ON c.id=m.candidate_id
CROSS JOIN _migration_0169_where_being s
WHERE lower(trim(c.title))='where being takes root' AND c.id<>s.candidate_id;

UPDATE calendar_candidate_media
SET include_public=1,updated_at=datetime('now')
WHERE candidate_id=(SELECT candidate_id FROM _migration_0169_where_being)
  AND media_id IN (
    SELECT m.media_id FROM calendar_candidate_media m
    JOIN calendar_candidates c ON c.id=m.candidate_id
    WHERE lower(trim(c.title))='where being takes root' AND m.include_public=1
  );

INSERT OR IGNORE INTO calendar_candidate_links
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,created_at,updated_at,link_role,credit_role)
SELECT 'cal_where_being_link_'||l.id,s.candidate_id,l.label,l.url,l.provenance_url,
       l.include_public,l.sort_order,l.created_at,datetime('now'),l.link_role,l.credit_role
FROM calendar_candidate_links l
JOIN calendar_candidates c ON c.id=l.candidate_id
CROSS JOIN _migration_0169_where_being s
WHERE lower(trim(c.title))='where being takes root' AND c.id<>s.candidate_id;

INSERT OR IGNORE INTO calendar_entry_media
  (id,entry_id,candidate_media_id,media_id,media_role,alt_text,caption,sort_order)
SELECT 'cal_where_being_entry_media_'||m.id,s.entry_id,
       (SELECT cm.id FROM calendar_candidate_media cm
        WHERE cm.candidate_id=s.candidate_id AND cm.media_id=m.media_id LIMIT 1),
       m.media_id,m.media_role,m.alt_text,m.caption,m.sort_order
FROM calendar_entry_media m
JOIN calendar_entries e ON e.id=m.entry_id
JOIN calendar_candidates c ON c.id=e.candidate_id
CROSS JOIN _migration_0169_where_being s
WHERE lower(trim(c.title))='where being takes root' AND e.id<>s.entry_id;

INSERT OR IGNORE INTO calendar_entry_links
  (id,entry_id,candidate_link_id,label,url,sort_order,link_role,credit_role)
SELECT 'cal_where_being_entry_link_'||l.id,s.entry_id,
       (SELECT cl.id FROM calendar_candidate_links cl
        WHERE cl.candidate_id=s.candidate_id AND cl.url=l.url LIMIT 1),
       l.label,l.url,l.sort_order,l.link_role,l.credit_role
FROM calendar_entry_links l
JOIN calendar_entries e ON e.id=l.entry_id
JOIN calendar_candidates c ON c.id=e.candidate_id
CROSS JOIN _migration_0169_where_being s
WHERE lower(trim(c.title))='where being takes root' AND e.id<>s.entry_id;

UPDATE calendar_candidate_revisions
SET revision_state='superseded',reviewed_at=datetime('now')
WHERE revision_state='pending'
  AND candidate_id IN (
    SELECT id FROM calendar_candidates WHERE lower(trim(title))='where being takes root'
  );

UPDATE calendar_candidates
SET event_structure='exhibition',date_kind='date_range',starts_at='2026-08-14',ends_at=NULL,
    confirmed_through='2026-10-15',
    visiting_hours_json='[{"day":1,"opens":"10:00","closes":"18:00"},{"day":2,"opens":"10:00","closes":"18:00"},{"day":3,"opens":"10:00","closes":"18:00"},{"day":4,"opens":"10:00","closes":"18:00"},{"day":5,"opens":"10:00","closes":"18:00"}]',
    visiting_hours_note='',visiting_hours_source_url='',visiting_hours_verified_at=datetime('now'),
    attendance_mode='flexible_window',minimum_visit_minutes=30,recommended_visit_minutes=45,
    planning_eligible=1,verification_state='verified',last_verified_at=datetime('now'),
    pending_revision_id='',status='published',
    public_entry_id=(SELECT entry_id FROM _migration_0169_where_being),updated_at=datetime('now')
WHERE id=(SELECT candidate_id FROM _migration_0169_where_being);

UPDATE calendar_entries
SET sequence=sequence+1,event_structure='exhibition',date_kind='date_range',
    starts_at='2026-08-14',ends_at=NULL,confirmed_through='2026-10-15',
    visiting_hours_json='[{"day":1,"opens":"10:00","closes":"18:00"},{"day":2,"opens":"10:00","closes":"18:00"},{"day":3,"opens":"10:00","closes":"18:00"},{"day":4,"opens":"10:00","closes":"18:00"},{"day":5,"opens":"10:00","closes":"18:00"}]',
    visiting_hours_note='',visiting_hours_source_url='',visiting_hours_verified_at=datetime('now'),
    attendance_mode='flexible_window',minimum_visit_minutes=30,recommended_visit_minutes=45,
    planning_eligible=1,last_modified_at=datetime('now'),last_verified_at=datetime('now')
WHERE id=(SELECT entry_id FROM _migration_0169_where_being);

UPDATE calendar_candidates
SET status='duplicate',duplicate_of=(SELECT candidate_id FROM _migration_0169_where_being),
    public_entry_id='',pending_revision_id='',monitoring_enabled=0,next_check_at=NULL,updated_at=datetime('now')
WHERE lower(trim(title))='where being takes root'
  AND id<>(SELECT candidate_id FROM _migration_0169_where_being);

DELETE FROM calendar_entries
WHERE candidate_id IN (
  SELECT id FROM calendar_candidates
  WHERE lower(trim(title))='where being takes root'
    AND id<>(SELECT candidate_id FROM _migration_0169_where_being)
);

DROP TABLE _migration_0169_where_being;

PRAGMA foreign_keys = ON;
