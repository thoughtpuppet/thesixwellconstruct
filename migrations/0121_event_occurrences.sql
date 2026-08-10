-- One Event identity can own multiple independently bookable dates.

ALTER TABLE events
ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0
CHECK (is_recurring IN (0,1));

CREATE TABLE event_occurrences (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  max_seats_per_order INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'closed'
    CHECK (status IN ('open','closed','completed','cancelled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, starts_at)
);

CREATE INDEX idx_event_occurrences_event_start
  ON event_occurrences(event_id, starts_at, sort_order);

CREATE INDEX idx_event_occurrences_public_calendar
  ON event_occurrences(starts_at, status);

-- This named public surface previously existed without a Studio event record.
-- Keep it public but non-transactional until its first date is scheduled.
INSERT OR IGNORE INTO events (
  id,slug,title,description,status,publication_state,is_recurring,created_at,updated_at
) VALUES (
  'evt_ss_and_f_live_audience',
  'ss-and-f-live-audience',
  'SS&F Live Audience',
  'A live-audience container for SS&F sessions, recordings, readings, conversations, and filmed room experiments.',
  'closed',
  'announced',
  0,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO content_entities (
  id,entity_type,node_id,visibility,search_visibility,public_at,
  created_by,updated_by,created_at,updated_at
)
SELECT
  id,'event','node-events','public',1,datetime('now'),
  'migration-0121','migration-0121',datetime('now'),datetime('now')
FROM events
WHERE slug='ss-and-f-live-audience';

INSERT INTO event_occurrences (
  id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,
  sort_order,created_at,updated_at
)
SELECT
  'occ_'||id,id,starts_at,ends_at,location,capacity,max_seats_per_order,
  CASE WHEN status='draft' THEN 'closed' ELSE status END,
  0,created_at,updated_at
FROM events
WHERE starts_at IS NOT NULL;

ALTER TABLE event_tickets ADD COLUMN occurrence_id TEXT;
ALTER TABLE event_waitlist ADD COLUMN occurrence_id TEXT;
ALTER TABLE event_open_mic_signups ADD COLUMN occurrence_id TEXT;

UPDATE event_tickets
SET occurrence_id=(SELECT id FROM event_occurrences occurrence WHERE occurrence.event_id=event_tickets.event_id ORDER BY starts_at LIMIT 1)
WHERE occurrence_id IS NULL;

UPDATE event_waitlist
SET occurrence_id=(SELECT id FROM event_occurrences occurrence WHERE occurrence.event_id=event_waitlist.event_id ORDER BY starts_at LIMIT 1)
WHERE occurrence_id IS NULL;

UPDATE event_open_mic_signups
SET occurrence_id=(SELECT id FROM event_occurrences occurrence WHERE occurrence.event_id=event_open_mic_signups.event_id ORDER BY starts_at LIMIT 1)
WHERE occurrence_id IS NULL;

CREATE INDEX idx_event_tickets_occurrence_status
  ON event_tickets(occurrence_id,status);

CREATE INDEX idx_event_waitlist_occurrence_status
  ON event_waitlist(occurrence_id,status,created_at);

CREATE INDEX idx_event_open_mic_occurrence_status
  ON event_open_mic_signups(occurrence_id,status,created_at);
