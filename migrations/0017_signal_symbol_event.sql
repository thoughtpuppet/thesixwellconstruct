-- Normalize earlier event identifiers to Signal & Symbol while keeping event
-- ids stable so existing tickets and waitlist rows remain attached.

UPDATE events
SET
  slug = 'signal-symbol',
  title = 'Signal & Symbol',
  description = 'A guided sensory mark-making gathering where prompts become visual responses through each person''s horizon of memory, mood, and imagination. No drawing experience needed.',
  location = CASE
    WHEN location = '' OR location LIKE '%location shared after booking%' THEN 'Atlanta, GA - exact address shared after booking'
    ELSE location
  END,
  image_url = CASE
    WHEN image_url = '' OR image_url = '/assets/paintings/DECISION%204AM.jpg' THEN '/assets/paintings/DECISION%204AM.jpg'
    ELSE image_url
  END,
  details = 'Signal & Symbol is a guided creative gathering where participants respond to sensory prompts through drawing, color, line, symbol, and mark-making. A signal is the prompt placed in the room. A symbol is the visual response that rises from it. The horizon is what each person brings to that encounter: memory, mood, imagination, culture, attention, and atmosphere. The goal is not to draw well. The goal is to respond honestly.',
  included = 'Markers, colored pencils, graphite pencils, paper, erasers, sharpeners, and drawing boards or table surfaces are provided. No paint will be used.',
  arrival_notes = 'Plan to arrive a few minutes early, choose simple drawing materials, and settle in before the first prompt.',
  accessibility_notes = 'Reply after booking if you need seating, sensory, or access accommodations.',
  cancellation_policy = 'If plans change, reply as early as possible so the studio can help. Tickets are refundable only if the studio cancels the session.',
  contact_note = 'Some visual responses may be photographed or documented as part of the Six.Well Construct archive. Documentation is optional; guests may opt out, remain anonymous, or decide after the session.',
  updated_at = '2026-06-17T00:00:00Z'
WHERE slug IN ('sip-and-paint', 'signal-horizons');
