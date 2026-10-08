-- Editions can exist before a date is confirmed. Keep all occurrence identities
-- and reservation relationships while allowing NULL starts_at values.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _event_admission_occurrences_0238 AS
SELECT id, occurrence_id FROM event_admission_options WHERE occurrence_id IS NOT NULL;

CREATE TABLE event_occurrences_0238 (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  max_seats_per_order INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed','completed','cancelled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  session_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, starts_at)
);
INSERT INTO event_occurrences_0238
  (id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,sort_order,created_at,updated_at,session_number,title)
SELECT id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,sort_order,created_at,updated_at,session_number,title
FROM event_occurrences;
DROP TABLE event_occurrences;
ALTER TABLE event_occurrences_0238 RENAME TO event_occurrences;
CREATE INDEX idx_event_occurrences_event_start ON event_occurrences(event_id,starts_at,sort_order);
CREATE INDEX idx_event_occurrences_public_calendar ON event_occurrences(starts_at,status);
-- ON DELETE SET NULL runs during the rebuild; restore the original associations.
UPDATE event_admission_options SET occurrence_id=(SELECT occurrence_id FROM _event_admission_occurrences_0238 WHERE id=event_admission_options.id)
WHERE id IN (SELECT id FROM _event_admission_occurrences_0238);
DROP TABLE _event_admission_occurrences_0238;

-- Insert at edition 03 without changing the existing dates or occurrence IDs.
UPDATE event_occurrences
SET session_number=printf('%02d',CAST(session_number AS INTEGER)+1),
    sort_order=sort_order+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE event_id IN (SELECT id FROM events WHERE slug='kinmarking')
  AND CAST(session_number AS INTEGER)>=3;

INSERT INTO event_occurrences
  (id,event_id,session_number,title,description,starts_at,ends_at,location,capacity,max_seats_per_order,status,sort_order,created_at,updated_at)
SELECT 'occ_kinmarking_grief',id,'03','Grief & Tattooing',
  'An inquiry into how clients use tattooing to face and process grief, alchemizing it into art that lives in the skin.',
  NULL,NULL,location,0,1,'closed',2,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM events WHERE slug='kinmarking';

-- Move the existing card descriptions into Studio's edition fields.
UPDATE event_occurrences SET description=CASE title
  WHEN 'Oral Histories & Tattooing' THEN 'Drawing on oral history, the first edition uses telling and listening to bring stories and associations into view, giving interpretation and visual development a place to begin.'
  WHEN 'Color & Tattooing' THEN 'Explore the meanings we inherit through color, from family and cultural traditions to personal associations. Through conversation and visual experimentation, develop palettes, shapes, and symbols into possibilities for tattooing.'
  WHEN 'Iconography & Tattooing' THEN 'Explore how symbols, badges, and visual signs communicate identity, belief, belonging, and personal history. Interpret inherited meanings and develop a visual language of your own through drawing and tattoo design.'
  ELSE description END
WHERE event_id IN (SELECT id FROM events WHERE slug='kinmarking');
PRAGMA defer_foreign_keys = OFF;
