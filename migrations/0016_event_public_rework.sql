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
  image_url = CASE WHEN image_url = '' AND slug = 'signal-symbol' THEN '/assets/paintings/DECISION%204AM.jpg' ELSE image_url END,
  details = CASE WHEN details = '' AND slug = 'signal-symbol' THEN 'Signal & Symbol is a guided creative gathering where participants respond to sensory prompts through drawing, color, line, symbol, and mark-making. The horizon is what each person brings to that encounter: memory, mood, imagination, culture, attention, and atmosphere.' ELSE details END,
  included = CASE WHEN included = '' AND slug = 'signal-symbol' THEN 'Markers, colored pencils, graphite pencils, paper, erasers, sharpeners, and drawing boards or table surfaces are provided. No paint will be used.' ELSE included END,
  arrival_notes = CASE WHEN arrival_notes = '' AND slug = 'signal-symbol' THEN 'Plan to arrive a few minutes early, choose simple drawing materials, and settle in before the first prompt.' ELSE arrival_notes END,
  accessibility_notes = CASE WHEN accessibility_notes = '' AND slug = 'signal-symbol' THEN 'Reply after booking if you need seating, sensory, or access accommodations.' ELSE accessibility_notes END,
  cancellation_policy = CASE WHEN cancellation_policy = '' AND slug = 'signal-symbol' THEN 'If plans change, reply as early as possible so the studio can help. Tickets are refundable only if the studio cancels the session.' ELSE cancellation_policy END,
  contact_note = CASE WHEN contact_note = '' THEN 'Reply to your confirmation email if anything changes before the event.' ELSE contact_note END;
