-- Complete the tattoo lifecycle rollout after the original migration was
-- applied in production as 0036_tattoo_lifecycle_checkout_holds.sql.
-- Every statement is safe on both that production schema and a fresh database.

-- Upgrade only the untouched early production seed. Any Studio edit changes
-- at least one guarded value (including updated_at) and is preserved.
UPDATE tattoo_settings
SET review_time_message = 'Most project submissions are reviewed within 5-7 business days.',
    lead_time_days = 14,
    updated_at = datetime('now')
WHERE id = 'default'
  AND review_time_message = 'Most project submissions are reviewed within 5–7 business days.'
  AND lead_time_days = 2
  AND walk_in_guidance = 'Walk-in availability is announced through scheduled walk-in windows. Check the tattoo page before traveling to the studio.'
  AND support_email = 'saisolehman@artpilltattoohouse.com'
  AND updated_at = '2026-07-15 01:32:00';

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_token_hold
  ON appointments(booking_token_id)
  WHERE booking_token_id IS NOT NULL
    AND status IN ('pending_deposit','deposit_pending')
    AND hold_state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_replacement_hold
  ON appointments(replacement_for_appointment_id)
  WHERE replacement_for_appointment_id IS NOT NULL
    AND status IN ('pending_deposit','deposit_pending')
    AND hold_state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_submission_hold
  ON appointments(submission_id, purpose)
  WHERE submission_id IS NOT NULL
    AND replacement_for_appointment_id IS NULL
    AND status IN ('pending_deposit','deposit_pending')
    AND hold_state = 'active';

INSERT OR IGNORE INTO tattoo_rate_cards (
  service_key, label, rate_text, sort_order, active
) VALUES (
  'build', 'Build Your Own', 'Quoted after review', 40, 1
);

INSERT OR IGNORE INTO special_project_calls (
  id, slug, title, summary, status, rate_text, sort_order, opens_at, closes_at, updated_at
) VALUES
  (
    'mythic-body-studies', 'mythic-body-studies', 'Mythic Body Studies',
    'An open call for tattoos built around figures, archetypes, ritual objects, and personal mythologies that need to live on the body with gravity.',
    'open', '$100+/hr', 10, NULL, NULL, datetime('now')
  ),
  (
    'memory-transfer', 'memory-transfer', 'Memory Transfer Studies',
    'An open project for translating remembered places, inherited objects, and private emotional records into symbolic tattoo compositions.',
    'open', '$100+/hr', 20, NULL, NULL, datetime('now')
  ),
  (
    'large-scale', 'large-scale', 'Large Scale Symbolic Work',
    'An open call for larger symbolic compositions that need meaningful placement, stronger visual architecture, and more than one sitting to resolve.',
    'open', '$100+/hr', 30, NULL, NULL, datetime('now')
  );
