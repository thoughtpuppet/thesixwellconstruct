INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at,
  session_fee_cents, minimum_billable_minutes
) VALUES (
  'tattoo_three_quarter', 'tattooing', '3/4 Day Session',
  '6 hours for larger approved work, detailed compositions, or longer sessions.',
  360, 15000, 'USD', 1, 25, datetime('now'), datetime('now'), 0, 0
);
