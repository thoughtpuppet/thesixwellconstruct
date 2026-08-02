-- Replace the public Anime/Cartoon selection with a versioned Script Tattoo
-- selection while preserving every historical Anime term and booking type.

ALTER TABLE tattoo_special_offer_versions ADD COLUMN max_word_count INTEGER
  CHECK (max_word_count IS NULL OR max_word_count > 0);

ALTER TABLE tattoo_special_submission_terms ADD COLUMN max_word_count INTEGER
  CHECK (max_word_count IS NULL OR max_word_count > 0);

INSERT OR IGNORE INTO booking_types
  (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
VALUES
  ('tattoo_special_script_v1', 'tattooing', 'Script Tattoo',
   'Tattoo Special - Studio approval - 12-word maximum - immutable version 1',
   90, 5000, 'USD', 1, 904, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offers
  (id, slug, title, active, sort_order, current_version_id, created_at, updated_at)
VALUES
  ('special-script', 'script-tattoo', 'Script Tattoo', 1, 40,
   'special-script-v1', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_versions
  (id, offer_id, version_number, public_description, duration_minutes, booking_mode,
   reference_requirement, participant_count, deposit_cents, booking_type_id,
   created_at, max_word_count)
VALUES
  ('special-script-v1', 'special-script', 1,
   'A script tattoo of up to 12 words, planned as one 90-minute session.',
   90, 'review', 'optional', 1, 5000, 'tattoo_special_script_v1',
   datetime('now'), 12);

INSERT OR IGNORE INTO tattoo_special_offer_variants
  (id, offer_version_id, label, price_cents, sort_order, created_at)
VALUES
  ('special-script-v1-bg', 'special-script-v1', 'B&G', 15000, 10, datetime('now')),
  ('special-script-v1-color', 'special-script-v1', 'Color (+$20)', 17000, 20, datetime('now'));

UPDATE tattoo_special_offers
SET active = 0, archived_at = COALESCE(archived_at, datetime('now')), updated_at = datetime('now')
WHERE id = 'special-anime';
