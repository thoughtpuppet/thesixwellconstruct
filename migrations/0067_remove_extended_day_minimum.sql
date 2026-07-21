UPDATE booking_types
SET minimum_billable_minutes = 0,
    updated_at = datetime('now')
WHERE id = 'tattoo_extended';

UPDATE appointments
SET minimum_billable_minutes = 0,
    updated_at = datetime('now')
WHERE booking_type_id = 'tattoo_extended'
  AND minimum_billable_minutes <> 0;
