-- Raise the public Script Tattoo limit to 21 words for future requests while
-- preserving the immutable 12-word version referenced by existing requests.

INSERT OR IGNORE INTO booking_types
  (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
VALUES
  ('tattoo_special_script_v2', 'tattooing', 'Script Tattoo',
   'Tattoo Special - Studio approval - 21-word maximum - immutable version 2',
   90, 5000, 'USD', 1, 904, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_versions
  (id, offer_id, version_number, public_description, duration_minutes, booking_mode,
   reference_requirement, participant_count, deposit_cents, booking_type_id,
   created_at, max_word_count)
VALUES
  ('special-script-v2', 'special-script', 2,
   'A script tattoo of up to 21 words, planned as one 90-minute session.',
   90, 'review', 'optional', 1, 5000, 'tattoo_special_script_v2',
   datetime('now'), 21);

INSERT OR IGNORE INTO tattoo_special_offer_variants
  (id, offer_version_id, label, price_cents, sort_order, created_at)
VALUES
  ('special-script-v2-bg', 'special-script-v2', 'B&G', 15000, 10, datetime('now')),
  ('special-script-v2-color', 'special-script-v2', 'Color (+$20)', 17000, 20, datetime('now'));

UPDATE tattoo_special_offers
SET current_version_id = 'special-script-v2', active = 1, archived_at = NULL,
    updated_at = datetime('now')
WHERE id = 'special-script' AND current_version_id = 'special-script-v1';
