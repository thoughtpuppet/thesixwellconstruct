-- Public ticketed events and guided gatherings. Isolated from the tattoo booking
-- tables and paid through a dedicated Square account (SQUARE_EVENTS_* secrets).

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  capacity INTEGER NOT NULL DEFAULT 0,
  max_seats_per_order INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | open | closed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  seats INTEGER NOT NULL DEFAULT 1,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
  square_order_id TEXT,
  square_payment_link_id TEXT,
  square_checkout_url TEXT,
  square_payment_id TEXT,
  raw_json TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_event_status
  ON event_tickets(event_id, status);

CREATE INDEX IF NOT EXISTS idx_event_tickets_square_order
  ON event_tickets(square_order_id);

CREATE INDEX IF NOT EXISTS idx_event_tickets_email
  ON event_tickets(contact_email);

-- Seed the Signal & Symbol event. Placeholder values can be edited in Studio.
INSERT OR IGNORE INTO events (
  id, slug, title, description, starts_at, location,
  price_cents, currency, capacity, max_seats_per_order, status,
  created_at, updated_at
) VALUES (
  'evt_signal_symbol',
  'signal-symbol',
  'Signal & Symbol',
  'A guided sensory mark-making gathering where prompts become visual responses through each person''s horizon of memory, mood, and imagination. No drawing experience needed.',
  '2026-07-25T19:00:00-04:00',
  'Atlanta, GA - exact address shared after booking',
  4500,
  'USD',
  20,
  4,
  'open',
  '2026-06-16T00:00:00Z',
  '2026-06-16T00:00:00Z'
);
