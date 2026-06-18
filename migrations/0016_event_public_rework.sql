-- Event public-page metadata, waitlist interest, and operator readiness helpers.
-- Existing ticket lifecycle tables remain the source of truth for paid/pending
-- seat math; these columns let Studio manage visitor-facing details without
-- hardcoding copy into the public HTML.

ALTER TABLE events ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN details TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN included TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN arrival_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN accessibility_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN cancellation_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN contact_note TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN waitlist_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS event_waitlist (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  seats_requested INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new', -- new | contacted | archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_event_status
  ON event_waitlist(event_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_email
  ON event_waitlist(contact_email);

UPDATE events
SET
  image_url = CASE WHEN image_url = '' AND slug = 'sip-and-paint' THEN '/assets/paintings/DECISION%204AM.jpg' ELSE image_url END,
  details = CASE WHEN details = '' AND slug = 'sip-and-paint' THEN 'A guided painting night with room for slow looking, conversation, and leaving with a finished canvas.' ELSE details END,
  included = CASE WHEN included = '' AND slug = 'sip-and-paint' THEN 'Canvas, paint, guided session, and one hosted drink are included.' ELSE included END,
  arrival_notes = CASE WHEN arrival_notes = '' AND slug = 'sip-and-paint' THEN 'Plan to arrive 10 minutes early so the room can begin together.' ELSE arrival_notes END,
  accessibility_notes = CASE WHEN accessibility_notes = '' AND slug = 'sip-and-paint' THEN 'Reply after booking if you need seating, sensory, or access accommodations.' ELSE accessibility_notes END,
  cancellation_policy = CASE WHEN cancellation_policy = '' AND slug = 'sip-and-paint' THEN 'Tickets are refundable only if the studio cancels the event. If you cannot attend, reply as early as possible and we will try to help.' ELSE cancellation_policy END,
  contact_note = CASE WHEN contact_note = '' THEN 'Reply to your confirmation email if anything changes before the event.' ELSE contact_note END;
