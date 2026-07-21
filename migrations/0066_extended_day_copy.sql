UPDATE booking_types
SET description = 'Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee.',
    updated_at = datetime('now')
WHERE id = 'tattoo_extended';
