UPDATE booking_types
SET deposit_cents = 20000,
    updated_at = datetime('now')
WHERE id = 'tattoo_full';
