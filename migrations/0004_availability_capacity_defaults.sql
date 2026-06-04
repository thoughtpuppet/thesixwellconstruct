UPDATE booking_settings
SET max_bookings_per_day = 4,
    updated_at = datetime('now')
WHERE venture = 'tattooing'
  AND max_bookings_per_day = 1;
