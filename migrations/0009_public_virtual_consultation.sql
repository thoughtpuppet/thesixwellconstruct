INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at
) VALUES (
  'consult_virtual', 'tattooing', 'Virtual Consultation',
  'A public video-call consultation for placement, cover-up review, or project planning before a tattoo date is set.',
  45, 2000, 'USD', 1, 7, datetime('now'), datetime('now')
);
