UPDATE booking_types
SET label = CASE id
  WHEN 'tattoo_quarter' THEN 'Quarter Day Session'
  WHEN 'tattoo_half' THEN 'Half Day Session'
  WHEN 'tattoo_full' THEN 'Full Day Session'
END,
updated_at = datetime('now')
WHERE id IN ('tattoo_quarter', 'tattoo_half', 'tattoo_full');
