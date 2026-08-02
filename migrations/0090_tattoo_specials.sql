PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tattoo_special_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  sales_opens_at TEXT NOT NULL,
  sales_closes_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  default_deposit_cents INTEGER NOT NULL DEFAULT 5000 CHECK (default_deposit_cents >= 0),
  artwork_media_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artwork_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tattoo_special_offers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  archived_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tattoo_special_offer_versions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  public_description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes % 30 = 0),
  booking_mode TEXT NOT NULL CHECK (booking_mode IN ('direct', 'review')),
  reference_requirement TEXT NOT NULL DEFAULT 'optional' CHECK (reference_requirement IN ('optional', 'required')),
  participant_count INTEGER NOT NULL DEFAULT 1 CHECK (participant_count IN (1, 2)),
  deposit_cents INTEGER NOT NULL CHECK (deposit_cents >= 0),
  booking_type_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES tattoo_special_offers(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE RESTRICT,
  UNIQUE (offer_id, version_number)
);

CREATE TABLE IF NOT EXISTS tattoo_special_offer_variants (
  id TEXT PRIMARY KEY,
  offer_version_id TEXT NOT NULL,
  label TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_version_id) REFERENCES tattoo_special_offer_versions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tattoo_special_submission_terms (
  submission_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  offer_version_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  offer_title TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  advertised_price_cents INTEGER NOT NULL,
  approved_price_cents INTEGER,
  deposit_cents INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  booking_mode TEXT NOT NULL CHECK (booking_mode IN ('direct', 'review')),
  booking_type_id TEXT NOT NULL,
  sales_closes_at TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 1,
  review_outcome TEXT NOT NULL DEFAULT 'pending' CHECK (review_outcome IN ('pending','approved','simplification_requested','declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES tattoo_special_offers(id) ON DELETE RESTRICT,
  FOREIGN KEY (offer_version_id) REFERENCES tattoo_special_offer_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id) REFERENCES tattoo_special_offer_variants(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tattoo_special_offers_public
  ON tattoo_special_offers(active, archived_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_tattoo_special_versions_offer
  ON tattoo_special_offer_versions(offer_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_tattoo_special_terms_offer
  ON tattoo_special_submission_terms(offer_id, created_at DESC);

INSERT OR IGNORE INTO media_assets (
  id, source_url, original_filename, mime_type, alt_text, caption,
  privacy, consent_status, state, created_by, created_at, updated_at,
  public_title, public_description, public_presentation
) VALUES (
  'media-tattoo-specials-fka-2026', '/assets/images/tattoo-specials/fka-special-2026.png',
  'FKA SPECIAL.png', 'image/png', 'FKA tattoo specials poster',
  'FKA tattoo specials campaign artwork.', 'public', 'not-required', 'active',
  'migration', datetime('now'), datetime('now'), 'FKA Tattoo Specials',
  'Tattoo Specials campaign artwork.', 'inline'
);

INSERT OR IGNORE INTO tattoo_special_settings (
  id, sales_opens_at, sales_closes_at, timezone, default_deposit_cents,
  artwork_media_id, enabled, created_at, updated_at
) VALUES (
  'default', '2026-08-01T04:00:00.000Z', '2026-09-02T04:00:00.000Z',
  'America/New_York', 5000, 'media-tattoo-specials-fka-2026', 1,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO booking_types
  (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
VALUES
  ('tattoo_special_quarter_bg_v1', 'tattooing', '1/4 Sleeve Forearm — B&G', 'Tattoo Special · immutable version 1', 180, 5000, 'USD', 1, 901, datetime('now'), datetime('now')),
  ('tattoo_special_quarter_color_v1', 'tattooing', '1/4 Sleeve Forearm — Color', 'Tattoo Special · immutable version 1', 180, 5000, 'USD', 1, 902, datetime('now'), datetime('now')),
  ('tattoo_special_floral_color_v1', 'tattooing', 'Floral Tattoo — Color, 6×6', 'Tattoo Special · immutable version 1', 180, 5000, 'USD', 1, 903, datetime('now'), datetime('now')),
  ('tattoo_special_anime_v1', 'tattooing', 'Anime/Cartoon — 6×6', 'Tattoo Special · complexity review · immutable version 1', 120, 5000, 'USD', 1, 904, datetime('now'), datetime('now')),
  ('tattoo_special_palm_v1', 'tattooing', 'Palm Sized Tattoo', 'Tattoo Special · immutable version 1', 120, 5000, 'USD', 1, 905, datetime('now'), datetime('now')),
  ('tattoo_special_two_small_v1', 'tattooing', 'Two Small Tattoos — 2×2 each', 'Tattoo Special · two participants · immutable version 1', 90, 5000, 'USD', 1, 906, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offers
  (id, slug, title, active, sort_order, current_version_id, created_at, updated_at)
VALUES
  ('special-quarter-bg', 'quarter-sleeve-forearm-bg', '1/4 Sleeve Forearm — B&G', 1, 10, 'special-quarter-bg-v1', datetime('now'), datetime('now')),
  ('special-quarter-color', 'quarter-sleeve-forearm-color', '1/4 Sleeve Forearm — Color', 1, 20, 'special-quarter-color-v1', datetime('now'), datetime('now')),
  ('special-floral-color', 'floral-color-6x6', 'Floral Tattoo — Color, 6×6', 1, 30, 'special-floral-color-v1', datetime('now'), datetime('now')),
  ('special-anime', 'anime-cartoon-6x6', 'Anime/Cartoon — 6×6', 1, 40, 'special-anime-v1', datetime('now'), datetime('now')),
  ('special-palm', 'palm-sized-tattoo', 'Palm Sized Tattoo', 1, 50, 'special-palm-v1', datetime('now'), datetime('now')),
  ('special-two-small', 'two-small-tattoos', 'Two Small Tattoos — 2×2 each', 1, 60, 'special-two-small-v1', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_versions
  (id, offer_id, version_number, public_description, duration_minutes, booking_mode, reference_requirement, participant_count, deposit_cents, booking_type_id, created_at)
VALUES
  ('special-quarter-bg-v1', 'special-quarter-bg', 1, 'A black-and-grey forearm composition planned as one three-hour session.', 180, 'direct', 'optional', 1, 5000, 'tattoo_special_quarter_bg_v1', datetime('now')),
  ('special-quarter-color-v1', 'special-quarter-color', 1, 'A color forearm composition planned as one three-hour session.', 180, 'direct', 'optional', 1, 5000, 'tattoo_special_quarter_color_v1', datetime('now')),
  ('special-floral-color-v1', 'special-floral-color', 1, 'A color floral tattoo up to 6×6 inches, planned as one three-hour session.', 180, 'direct', 'optional', 1, 5000, 'tattoo_special_floral_color_v1', datetime('now')),
  ('special-anime-v1', 'special-anime', 1, 'A 6×6 anime or cartoon piece. Final complexity and exact price are reviewed before booking.', 120, 'review', 'required', 1, 5000, 'tattoo_special_anime_v1', datetime('now')),
  ('special-palm-v1', 'special-palm', 1, 'One palm-sized tattoo planned as a two-hour session.', 120, 'direct', 'optional', 1, 5000, 'tattoo_special_palm_v1', datetime('now')),
  ('special-two-small-v1', 'special-two-small', 1, 'Two 2×2 tattoos during one appointment. Each tattoo may be for a different adult.', 90, 'direct', 'optional', 2, 5000, 'tattoo_special_two_small_v1', datetime('now'));

INSERT OR IGNORE INTO tattoo_special_offer_variants
  (id, offer_version_id, label, price_cents, sort_order, created_at)
VALUES
  ('special-quarter-bg-v1-standard', 'special-quarter-bg-v1', 'B&G', 25000, 10, datetime('now')),
  ('special-quarter-color-v1-standard', 'special-quarter-color-v1', 'Color', 35000, 10, datetime('now')),
  ('special-floral-color-v1-standard', 'special-floral-color-v1', 'Color', 30000, 10, datetime('now')),
  ('special-anime-v1-bg', 'special-anime-v1', 'B&G', 15000, 10, datetime('now')),
  ('special-anime-v1-color', 'special-anime-v1', 'Color', 20000, 20, datetime('now')),
  ('special-palm-v1-standard', 'special-palm-v1', 'Standard', 20000, 10, datetime('now')),
  ('special-two-small-v1-standard', 'special-two-small-v1', 'Two tattoos', 10000, 10, datetime('now'));
