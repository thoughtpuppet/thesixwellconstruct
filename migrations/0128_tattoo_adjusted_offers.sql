-- Tattoo Special requests may be approved as projects at a different rate
-- without being represented as eligible Tattoo Specials.

CREATE TABLE IF NOT EXISTS tattoo_adjusted_offers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','withdrawn','expired')),
  reason_code TEXT NOT NULL
    CHECK (reason_code IN ('cover_up','rework','complexity','size','other')),
  reason_text TEXT NOT NULL DEFAULT '',
  pricing_type TEXT NOT NULL
    CHECK (pricing_type IN ('flat','hourly')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  client_note TEXT NOT NULL DEFAULT '',
  original_offer_snapshot_json TEXT NOT NULL DEFAULT '{}',
  allowed_booking_types_json TEXT NOT NULL DEFAULT '[]',
  allow_multiple_sessions INTEGER NOT NULL DEFAULT 0
    CHECK (allow_multiple_sessions IN (0,1)),
  max_sessions INTEGER NOT NULL DEFAULT 1
    CHECK (max_sessions BETWEEN 1 AND 24),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  booking_token_id TEXT,
  sent_at TEXT NOT NULL,
  responded_at TEXT,
  response_source TEXT
    CHECK (response_source IS NULL OR response_source IN ('client_web','studio_verbal','studio_message')),
  response_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_token_id) REFERENCES booking_tokens(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tattoo_adjusted_offers_one_pending
  ON tattoo_adjusted_offers(submission_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tattoo_adjusted_offers_submission_revision
  ON tattoo_adjusted_offers(submission_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_tattoo_adjusted_offers_status_expiry
  ON tattoo_adjusted_offers(status, expires_at);
