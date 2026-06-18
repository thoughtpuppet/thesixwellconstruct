-- Open-mic performer signup lane for recurring showcase events such as
-- /events/cultandshift/. Tickets stay in event_tickets; performer scheduling
-- lives here so Studio can manage attendees and performers separately.

CREATE TABLE IF NOT EXISTS event_open_mic_signups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  performer_name TEXT NOT NULL,
  performer_email TEXT NOT NULL,
  performer_phone TEXT,
  act_type TEXT NOT NULL DEFAULT '',
  piece_title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  requested_slot TEXT,
  assigned_slot TEXT,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | scheduled | cancelled
  slot_email_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_open_mic_event_status
  ON event_open_mic_signups(event_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_event_open_mic_email
  ON event_open_mic_signups(performer_email);

-- Seed the recurring showcase shell. Keep date/price/capacity editable from
-- Studio; the custom page handles unavailable ticket state gracefully.
INSERT OR IGNORE INTO events (
  id, slug, title, description, starts_at, location,
  price_cents, currency, capacity, max_seats_per_order, status,
  created_at, updated_at
) VALUES (
  'evt_cultandshift',
  'cultandshift',
  'Cult & Shift',
  'A recurring showcase night: ticketed audience, open-mic signups, and an intermission by a prebooked artist or performer.',
  NULL,
  'the six.well construct',
  0,
  'USD',
  60,
  4,
  'closed',
  '2026-06-17T00:00:00Z',
  '2026-06-17T00:00:00Z'
);
