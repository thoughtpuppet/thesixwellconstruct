ALTER TABLE portfolio_items ADD COLUMN project_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (project_type IN ('standard', 'cover_up'));

ALTER TABLE portfolio_items ADD COLUMN primary_consent_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (primary_consent_status IN ('not-required', 'required', 'granted', 'denied', 'unknown'));

ALTER TABLE portfolio_image_details ADD COLUMN image_role TEXT NOT NULL DEFAULT 'result'
  CHECK (image_role IN ('result', 'before', 'process', 'detail'));

-- Existing published primary photographs were already intentionally public.
-- Preserve that behavior while requiring an explicit permission decision for
-- every draft and archived upload going forward.
UPDATE portfolio_items
SET primary_consent_status = 'granted'
WHERE state = 'published';

-- Keep publication eligibility true even when Studio media tools and portfolio
-- tools are used concurrently. API validation supplies the actionable errors;
-- these triggers are the final database-level privacy boundary.
CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_item_guard
BEFORE UPDATE OF state, cover_image_ref, primary_consent_status ON portfolio_items
WHEN NEW.state = 'published' AND (
  NEW.primary_consent_status NOT IN ('not-required', 'granted')
  OR (
    NEW.cover_image_ref = 'primary'
    AND COALESCE((
      SELECT image_role FROM portfolio_image_details
      WHERE portfolio_item_id = NEW.id AND image_ref = 'primary'
    ), 'result') <> 'result'
  )
  OR (
    NEW.cover_image_ref <> 'primary'
    AND NOT EXISTS (
      SELECT 1
      FROM entity_media em
      JOIN media_assets m ON m.id = em.media_id
      LEFT JOIN portfolio_image_details pid
        ON pid.portfolio_item_id = em.entity_id AND pid.image_ref = em.media_id
      WHERE em.entity_id = NEW.id
        AND em.media_id = NEW.cover_image_ref
        AND em.role = 'gallery'
        AND em.public_visible = 1
        AND m.state = 'active'
        AND m.privacy = 'public'
        AND m.consent_status IN ('not-required', 'granted')
        AND m.public_presentation = 'inline'
        AND COALESCE(pid.image_role, 'result') = 'result'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_media_guard
BEFORE UPDATE OF state, privacy, consent_status, public_presentation ON media_assets
WHEN (
  NEW.state <> 'active'
  OR NEW.privacy <> 'public'
  OR NEW.consent_status NOT IN ('not-required', 'granted')
  OR NEW.public_presentation <> 'inline'
) AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  JOIN entity_media em
    ON em.entity_id = pi.id AND em.media_id = NEW.id AND em.role = 'gallery'
  WHERE pi.state = 'published' AND pi.cover_image_ref = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_attachment_insert_guard
BEFORE INSERT ON entity_media
WHEN NEW.role = 'gallery' AND NEW.public_visible <> 1 AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  WHERE pi.id = NEW.entity_id AND pi.state = 'published' AND pi.cover_image_ref = NEW.media_id
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_attachment_update_guard
BEFORE UPDATE OF public_visible, role ON entity_media
WHEN OLD.role = 'gallery' AND (NEW.role <> 'gallery' OR NEW.public_visible <> 1) AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  WHERE pi.id = NEW.entity_id AND pi.state = 'published' AND pi.cover_image_ref = NEW.media_id
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_role_insert_guard
BEFORE INSERT ON portfolio_image_details
WHEN NEW.image_role <> 'result' AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  WHERE pi.id = NEW.portfolio_item_id AND pi.state = 'published' AND pi.cover_image_ref = NEW.image_ref
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_published_cover_role_update_guard
BEFORE UPDATE OF image_role ON portfolio_image_details
WHEN NEW.image_role <> 'result' AND EXISTS (
  SELECT 1 FROM portfolio_items pi
  WHERE pi.id = NEW.portfolio_item_id AND pi.state = 'published' AND pi.cover_image_ref = NEW.image_ref
)
BEGIN
  SELECT RAISE(ABORT, 'published portfolio cover must remain eligible');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_standard_project_before_guard
BEFORE UPDATE OF project_type ON portfolio_items
WHEN NEW.project_type = 'standard' AND EXISTS (
  SELECT 1 FROM portfolio_image_details pid
  WHERE pid.portfolio_item_id = NEW.id AND pid.image_role = 'before'
)
BEGIN
  SELECT RAISE(ABORT, 'before images require a cover-up portfolio project');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_before_role_insert_guard
BEFORE INSERT ON portfolio_image_details
WHEN NEW.image_role = 'before' AND COALESCE((
  SELECT project_type FROM portfolio_items WHERE id = NEW.portfolio_item_id
), 'standard') <> 'cover_up'
BEGIN
  SELECT RAISE(ABORT, 'before images require a cover-up portfolio project');
END;

CREATE TRIGGER IF NOT EXISTS portfolio_before_role_update_guard
BEFORE UPDATE OF image_role ON portfolio_image_details
WHEN NEW.image_role = 'before' AND COALESCE((
  SELECT project_type FROM portfolio_items WHERE id = NEW.portfolio_item_id
), 'standard') <> 'cover_up'
BEGIN
  SELECT RAISE(ABORT, 'before images require a cover-up portfolio project');
END;
