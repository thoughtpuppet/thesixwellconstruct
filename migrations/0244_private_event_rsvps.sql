-- Private free-RSVP lane attached to the existing Event and date identities.
-- Tickets retain their payment lifecycle; RSVP is never evidence of attendance.
ALTER TABLE events ADD COLUMN private_rsvp_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (private_rsvp_enabled IN (0,1));

CREATE TABLE event_rsvps (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id) ON DELETE RESTRICT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 99),
  food_requirements TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id,occurrence_id,contact_email)
);
CREATE INDEX idx_event_rsvps_headcount ON event_rsvps(occurrence_id,status);

-- Transcription of the door's paper sheet, never guest-operated digital check-in.
CREATE TABLE event_attendance (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id) ON DELETE RESTRICT,
  rsvp_id TEXT UNIQUE REFERENCES event_rsvps(id) ON DELETE RESTRICT,
  paper_reference TEXT NOT NULL,
  attendee_name TEXT NOT NULL,
  attended_count INTEGER NOT NULL CHECK (attended_count BETWEEN 1 AND 99),
  source TEXT NOT NULL DEFAULT 'paper_sign_in' CHECK (source='paper_sign_in'),
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id,occurrence_id,paper_reference)
);
