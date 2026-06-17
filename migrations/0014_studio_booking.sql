-- Studio Booking: open studio visits, private gatherings, and external event
-- rentals of the construct. Deposit-based, mirroring the tattoo session model,
-- but money routes to a dedicated Square location (SQUARE_STUDIO_LOCATION_ID)
-- with its own webhook signing key (SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY), the
-- same isolation pattern events use.
--
-- Booking types live under venture 'tattooing' so the existing availability
-- engine (which queries venture='tattooing') generates their slots; the new
-- 'studio' schedule category gates which weekly rules they draw from. Studio
-- hours can therefore differ from tattoo hours (e.g. open at 8am for visits
-- while tattoo availability starts at 11am).

INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at
) VALUES
  (
    'studio_visit', 'tattooing', 'Open Studio Visit',
    'A scheduled visit to the construct — see the space, the work, and the practice in person.',
    60, 1000, 'USD', 1, 40, datetime('now'), datetime('now')
  ),
  (
    'studio_gathering', 'tattooing', 'Private Gathering',
    'Reserve the studio for a small private gathering. Deposit holds the date; balance is settled with the studio.',
    120, 5000, 'USD', 1, 50, datetime('now'), datetime('now')
  ),
  (
    'studio_rental', 'tattooing', 'External Event Rental',
    'For people or organizations renting the construct for their own event. Deposit holds the date; balance is settled with the studio.',
    240, 10000, 'USD', 1, 60, datetime('now'), datetime('now')
  );

-- Weekly studio-visit hours, inactive by default. Reuses the
-- (venture, day_of_week, category) unique index from 0010. Default window opens
-- earlier (08:00) than tattoo hours; flip days active in the admin.
INSERT OR IGNORE INTO availability_rules (
  id, venture, day_of_week, category, start_time, end_time, active,
  capacity, buffer_before_minutes, buffer_after_minutes,
  note, created_at, updated_at
) VALUES
  ('studio_sunday', 'tattooing', 0, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_monday', 'tattooing', 1, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_tuesday', 'tattooing', 2, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_wednesday', 'tattooing', 3, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_thursday', 'tattooing', 4, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_friday', 'tattooing', 5, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_saturday', 'tattooing', 6, 'studio', '08:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now'));
