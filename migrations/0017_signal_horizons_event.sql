-- Replace the original ticketed event seed with Signal Horizons while keeping
-- the event id stable so existing tickets and waitlist rows remain attached.

UPDATE events
SET
  slug = 'signal-horizons',
  title = 'Signal Horizons',
  description = 'A guided sensory mark-making gathering where guests respond to readings, sounds, textures, tastes, objects, and other prompts using simple dry materials. No drawing experience needed.',
  location = CASE
    WHEN location = '' OR location LIKE '%location shared after booking%' THEN 'Atlanta, GA - exact address shared after booking'
    ELSE location
  END,
  image_url = CASE
    WHEN image_url = '' OR image_url = '/assets/paintings/DECISION%204AM.jpg' THEN '/assets/paintings/DECISION%204AM.jpg'
    ELSE image_url
  END,
  details = 'Signal Horizons is a guided creative gathering where participants respond to sensory prompts through drawing, color, line, symbol, and mark-making. The goal is not to draw well. The goal is to respond honestly.',
  included = 'Markers, colored pencils, graphite pencils, paper, erasers, sharpeners, and drawing boards or table surfaces are provided. No paint will be used.',
  arrival_notes = 'Plan to arrive a few minutes early, choose simple drawing materials, and settle in before the first prompt.',
  accessibility_notes = 'Reply after booking if you need seating, sensory, or access accommodations.',
  cancellation_policy = 'If plans change, reply as early as possible so the studio can help. Tickets are refundable only if the studio cancels the session.',
  contact_note = 'Some visual responses may be photographed or documented as part of the Six.Well Construct archive. Documentation is optional; guests may opt out, remain anonymous, or decide after the session.',
  updated_at = '2026-06-17T00:00:00Z'
WHERE slug = 'sip-and-paint';

INSERT OR IGNORE INTO events (
  id, slug, title, description, starts_at, ends_at, location,
  price_cents, currency, capacity, max_seats_per_order, status,
  image_url, details, included, arrival_notes, accessibility_notes,
  cancellation_policy, contact_note, waitlist_enabled,
  created_at, updated_at
) VALUES (
  'evt_signal_horizons',
  'signal-horizons',
  'Signal Horizons',
  'A guided sensory mark-making gathering where guests respond to readings, sounds, textures, tastes, objects, and other prompts using simple dry materials. No drawing experience needed.',
  NULL,
  NULL,
  'Atlanta, GA - exact address shared after booking',
  0,
  'USD',
  20,
  4,
  'draft',
  '/assets/paintings/DECISION%204AM.jpg',
  'Signal Horizons is a guided creative gathering where participants respond to sensory prompts through drawing, color, line, symbol, and mark-making. The goal is not to draw well. The goal is to respond honestly.',
  'Markers, colored pencils, graphite pencils, paper, erasers, sharpeners, and drawing boards or table surfaces are provided. No paint will be used.',
  'Plan to arrive a few minutes early, choose simple drawing materials, and settle in before the first prompt.',
  'Reply after booking if you need seating, sensory, or access accommodations.',
  'If plans change, reply as early as possible so the studio can help. Tickets are refundable only if the studio cancels the session.',
  'Some visual responses may be photographed or documented as part of the Six.Well Construct archive. Documentation is optional; guests may opt out, remain anonymous, or decide after the session.',
  1,
  '2026-06-17T00:00:00Z',
  '2026-06-17T00:00:00Z'
);
