-- Move every current Tattoo Special into the Studio-approval lifecycle.
-- Version 1 rows remain untouched so existing submissions and booking links
-- retain the exact workflow and commercial terms they captured.

ALTER TABLE appointments ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'not_required'
  CHECK (approval_state IN ('not_required','pending','approved','declined'));
ALTER TABLE appointments ADD COLUMN approval_decided_at TEXT;
ALTER TABLE appointments ADD COLUMN payment_due_at TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_special_approval
  ON appointments(approval_state, hold_state, hold_expires_at);

INSERT OR IGNORE INTO booking_types
  (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
VALUES
  ('tattoo_special_quarter_bg_v2', 'tattooing', '1/4 Sleeve Forearm — B&G', 'Tattoo Special · Studio approval · immutable version 2', 180, 5000, 'USD', 1, 901, datetime('now'), datetime('now')),
  ('tattoo_special_quarter_color_v2', 'tattooing', '1/4 Sleeve Forearm — Color', 'Tattoo Special · Studio approval · immutable version 2', 180, 5000, 'USD', 1, 902, datetime('now'), datetime('now')),
  ('tattoo_special_floral_color_v2', 'tattooing', 'Floral Tattoo — Color, 6×6', 'Tattoo Special · Studio approval · immutable version 2', 180, 5000, 'USD', 1, 903, datetime('now'), datetime('now')),
  ('tattoo_special_palm_v2', 'tattooing', 'Palm Sized Tattoo', 'Tattoo Special · Studio approval · immutable version 2', 120, 5000, 'USD', 1, 905, datetime('now'), datetime('now')),
  ('tattoo_special_two_small_v2', 'tattooing', 'Two Small Tattoos — 2×2 each', 'Tattoo Special · Studio approval · two participants · immutable version 2', 90, 5000, 'USD', 1, 906, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_versions
  (id, offer_id, version_number, public_description, duration_minutes, booking_mode,
   reference_requirement, participant_count, deposit_cents, booking_type_id, created_at)
VALUES
  ('special-quarter-bg-v2', 'special-quarter-bg', 2, 'A black-and-grey forearm composition planned as one three-hour session.', 180, 'review', 'optional', 1, 5000, 'tattoo_special_quarter_bg_v2', datetime('now')),
  ('special-quarter-color-v2', 'special-quarter-color', 2, 'A color forearm composition planned as one three-hour session.', 180, 'review', 'optional', 1, 5000, 'tattoo_special_quarter_color_v2', datetime('now')),
  ('special-floral-color-v2', 'special-floral-color', 2, 'A color floral tattoo up to 6×6 inches, planned as one three-hour session.', 180, 'review', 'optional', 1, 5000, 'tattoo_special_floral_color_v2', datetime('now')),
  ('special-palm-v2', 'special-palm', 2, 'One palm-sized tattoo planned as a two-hour session.', 120, 'review', 'optional', 1, 5000, 'tattoo_special_palm_v2', datetime('now')),
  ('special-two-small-v2', 'special-two-small', 2, 'Two 2×2 tattoos during one appointment. Each tattoo may be for a different adult.', 90, 'review', 'optional', 2, 5000, 'tattoo_special_two_small_v2', datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_variants
  (id, offer_version_id, label, price_cents, sort_order, created_at)
VALUES
  ('special-quarter-bg-v2-standard', 'special-quarter-bg-v2', 'B&G', 25000, 10, datetime('now')),
  ('special-quarter-color-v2-standard', 'special-quarter-color-v2', 'Color', 35000, 10, datetime('now')),
  ('special-floral-color-v2-standard', 'special-floral-color-v2', 'Color', 30000, 10, datetime('now')),
  ('special-palm-v2-standard', 'special-palm-v2', 'Standard', 20000, 10, datetime('now')),
  ('special-two-small-v2-standard', 'special-two-small-v2', 'Two tattoos', 10000, 10, datetime('now'));

UPDATE tattoo_special_offers SET current_version_id = 'special-quarter-bg-v2', updated_at = datetime('now') WHERE id = 'special-quarter-bg';
UPDATE tattoo_special_offers SET current_version_id = 'special-quarter-color-v2', updated_at = datetime('now') WHERE id = 'special-quarter-color';
UPDATE tattoo_special_offers SET current_version_id = 'special-floral-color-v2', updated_at = datetime('now') WHERE id = 'special-floral-color';
UPDATE tattoo_special_offers SET current_version_id = 'special-palm-v2', updated_at = datetime('now') WHERE id = 'special-palm';
UPDATE tattoo_special_offers SET current_version_id = 'special-two-small-v2', updated_at = datetime('now') WHERE id = 'special-two-small';
