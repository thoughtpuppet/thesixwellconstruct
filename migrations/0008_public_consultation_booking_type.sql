INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at
) VALUES (
  'consult_in_person', 'tattooing', 'In-Person Consultation',
  'A public in-studio consultation for placement, cover-up review, or project planning before a tattoo date is set.',
  45, 2000, 'USD', 1, 5, datetime('now'), datetime('now')
),
(
  'build_in_person', 'tattooing', 'In-Person Build Session',
  'A 90-minute public in-studio build session for developing an Art.Pill tattoo brief in person.',
  90, 5000, 'USD', 1, 6, datetime('now'), datetime('now')
);
