-- Replace the legacy Tattoo primary-image consent gate with an explicit
-- presentation flag. Existing primary images that were already eligible for
-- publication remain eligible; every other primary stays hidden until Studio
-- deliberately includes it.
ALTER TABLE portfolio_items ADD COLUMN primary_public_visible INTEGER NOT NULL DEFAULT 0
  CHECK(primary_public_visible IN (0,1));

UPDATE portfolio_items
SET primary_public_visible = CASE
  -- Published primaries were already intentionally public records. This also
  -- carries forward the legacy public mirrors whose only blocker was the old
  -- unknown-consent default. Drafts retain an affirmative prior inclusion.
  WHEN state='published' OR primary_consent_status IN ('not-required','granted') THEN 1
  ELSE 0
END;
