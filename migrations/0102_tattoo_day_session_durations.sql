-- Align standard tattoo day sessions to an eight-hour day and reserve the
-- full advertised maximum for Extended Day. Existing appointments retain
-- their stored start_at and end_at timestamps.

UPDATE booking_types
SET duration_minutes = CASE id
      WHEN 'tattoo_quarter' THEN 120
      WHEN 'tattoo_half' THEN 240
      WHEN 'tattoo_full' THEN 480
      WHEN 'tattoo_extended' THEN 720
    END,
    description = CASE id
      WHEN 'tattoo_quarter' THEN '2 hours for small approved projects, flash, or focused work.'
      WHEN 'tattoo_half' THEN '4 hours for medium approved projects or developed symbolic work.'
      WHEN 'tattoo_full' THEN '8 hours for large approved work, special projects, or deeper sessions.'
      WHEN 'tattoo_extended' THEN 'Optional 8-12 hour session. Reserves a 12-hour appointment block with a $200 Extended Day fee.'
    END,
    updated_at = datetime('now')
WHERE id IN ('tattoo_quarter', 'tattoo_half', 'tattoo_full', 'tattoo_extended');
