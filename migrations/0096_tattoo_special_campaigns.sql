PRAGMA foreign_keys = ON;

-- First-class Tattoo Special campaigns. One campaign may be published to the
-- permanent public Specials route while any number remain drafted or archived.
CREATE TABLE IF NOT EXISTS tattoo_special_campaigns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  sales_opens_at TEXT NOT NULL,
  sales_closes_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  default_deposit_cents INTEGER NOT NULL DEFAULT 5000 CHECK (default_deposit_cents >= 0),
  artwork_media_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  archived_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artwork_media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tattoo_special_campaigns_public
  ON tattoo_special_campaigns(is_public) WHERE is_public = 1;
CREATE INDEX IF NOT EXISTS idx_tattoo_special_campaigns_status
  ON tattoo_special_campaigns(archived_at, enabled, sales_opens_at, sales_closes_at);

INSERT OR IGNORE INTO tattoo_special_campaigns (
  id, slug, title, sales_opens_at, sales_closes_at, timezone,
  default_deposit_cents, artwork_media_id, enabled, is_public,
  sort_order, created_at, updated_at
)
SELECT
  'campaign-fka-2026', 'fka-tattoo-specials-2026', 'FKA Tattoo Specials',
  sales_opens_at, sales_closes_at, timezone, default_deposit_cents,
  artwork_media_id, enabled, 1, 10, created_at, updated_at
FROM tattoo_special_settings
WHERE id = 'default';

ALTER TABLE tattoo_special_offers ADD COLUMN campaign_id TEXT
  REFERENCES tattoo_special_campaigns(id) ON DELETE RESTRICT;

UPDATE tattoo_special_offers
SET campaign_id = 'campaign-fka-2026'
WHERE campaign_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tattoo_special_offers_campaign
  ON tattoo_special_offers(campaign_id, active, archived_at, sort_order);

ALTER TABLE tattoo_special_submission_terms ADD COLUMN campaign_id TEXT;
ALTER TABLE tattoo_special_submission_terms ADD COLUMN campaign_title TEXT;

UPDATE tattoo_special_submission_terms
SET campaign_id = COALESCE(
      (SELECT o.campaign_id FROM tattoo_special_offers o
       WHERE o.id = tattoo_special_submission_terms.offer_id),
      'campaign-fka-2026'
    ),
    campaign_title = COALESCE(campaign_title, 'FKA Tattoo Specials')
WHERE campaign_id IS NULL OR campaign_title IS NULL;

CREATE INDEX IF NOT EXISTS idx_tattoo_special_terms_campaign
  ON tattoo_special_submission_terms(campaign_id, created_at DESC);
