ALTER TABLE booking_types ADD COLUMN session_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_types ADD COLUMN minimum_billable_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE appointments ADD COLUMN session_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN minimum_billable_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN extended_day_acknowledged_at TEXT;

INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at,
  session_fee_cents, minimum_billable_minutes
) VALUES (
  'tattoo_extended', 'tattooing', 'Extended Day Session',
  'Optional 8-10 hour session. Reserves a 10-hour appointment block with an 8-hour billing minimum at the approved project rate, plus a $200 Extended Day fee.',
  600, 35000, 'USD', 1, 40, datetime('now'), datetime('now'), 20000, 480
);
