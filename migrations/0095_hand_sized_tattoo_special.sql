-- Rename the active Palm Sized Tattoo selection to Hand Sized Tattoo for
-- future requests while preserving immutable Palm Sized versions and terms.

INSERT OR IGNORE INTO booking_types
  (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
VALUES
  ('tattoo_special_palm_v3', 'tattooing', 'Hand Sized Tattoo',
   'Tattoo Special - Studio approval - immutable version 3',
   120, 5000, 'USD', 1, 905, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_versions
  (id, offer_id, version_number, public_description, duration_minutes, booking_mode,
   reference_requirement, participant_count, deposit_cents, booking_type_id,
   created_at, max_word_count)
VALUES
  ('special-palm-v3', 'special-palm', 3,
   'One hand-sized tattoo planned as a two-hour session.',
   120, 'review', 'optional', 1, 5000, 'tattoo_special_palm_v3',
   datetime('now'), NULL);

INSERT OR IGNORE INTO tattoo_special_offer_variants
  (id, offer_version_id, label, price_cents, sort_order, created_at)
VALUES
  ('special-palm-v3-standard', 'special-palm-v3', 'Standard', 20000, 10, datetime('now'));

UPDATE tattoo_special_offers
SET title = 'Hand Sized Tattoo', slug = 'hand-sized-tattoo',
    current_version_id = 'special-palm-v3', active = 1, archived_at = NULL,
    updated_at = datetime('now')
WHERE id = 'special-palm' AND current_version_id = 'special-palm-v2';
