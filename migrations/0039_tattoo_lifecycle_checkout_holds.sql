-- End-to-end tattoo lifecycle and checkout hold hardening.
-- This migration is intentionally additive: legacy statuses, routes, and
-- appointment history remain readable while new writes use explicit purpose
-- and lifecycle fields.

ALTER TABLE submissions ADD COLUMN tattoo_stage TEXT
  CHECK (
    tattoo_stage IS NULL OR tattoo_stage IN (
      'review',
      'consultation_required',
      'consultation_scheduled',
      'consultation_complete',
      'ready_to_book',
      'tattoo_scheduled',
      'closed'
    )
  );
ALTER TABLE submissions ADD COLUMN lifecycle_review_required INTEGER NOT NULL DEFAULT 0
  CHECK (lifecycle_review_required IN (0,1));
ALTER TABLE submissions ADD COLUMN lifecycle_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_idempotency_key
  ON submissions(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND trim(idempotency_key) <> '';
CREATE INDEX IF NOT EXISTS idx_submissions_tattoo_stage
  ON submissions(tattoo_stage, updated_at);

ALTER TABLE booking_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'tattoo'
  CHECK (purpose IN ('consultation','tattoo'));

-- Preserve the meaning of old private links from the booking types they
-- exposed. A mixed/ambiguous historic link stays tattoo-purpose and must be
-- reviewed before a prerequisite consultation is considered complete. A
-- legacy virtual prerequisite is classified correctly here, but the runtime
-- still requires Studio to replace it with the current in-person-only link.
UPDATE booking_tokens
SET purpose = 'consultation'
WHERE json_valid(allowed_booking_types_json)
  AND json_array_length(allowed_booking_types_json) = 1
  AND json_extract(allowed_booking_types_json, '$[0]') IN ('consult_in_person','consult_virtual');

CREATE INDEX IF NOT EXISTS idx_booking_tokens_submission_purpose
  ON booking_tokens(submission_id, purpose, created_at);

ALTER TABLE appointments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'tattoo'
  CHECK (purpose IN ('tattoo','prerequisite_consultation','standalone_consultation','build_session','studio'));
ALTER TABLE appointments ADD COLUMN hold_expires_at TEXT;
ALTER TABLE appointments ADD COLUMN hold_state TEXT
  CHECK (hold_state IS NULL OR hold_state IN ('active','converted','released','expired','expiry_attention'));
ALTER TABLE appointments ADD COLUMN hold_reconciled_at TEXT;
ALTER TABLE appointments ADD COLUMN completed_at TEXT;
ALTER TABLE appointments ADD COLUMN completion_note TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN replacement_for_appointment_id TEXT
  REFERENCES appointments(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN replaced_by_appointment_id TEXT
  REFERENCES appointments(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0
  CHECK (reschedule_count >= 0);
ALTER TABLE appointments ADD COLUMN rescheduled_at TEXT;
ALTER TABLE appointments ADD COLUMN original_start_at TEXT;
ALTER TABLE appointments ADD COLUMN original_end_at TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_at TEXT;
ALTER TABLE appointments ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT '';

UPDATE appointments
SET purpose = CASE
  WHEN booking_type_id IN ('studio_visit','studio_gathering','studio_rental') THEN 'studio'
  WHEN booking_type_id = 'build_in_person' THEN 'build_session'
  WHEN booking_type_id IN ('consult_in_person','consult_virtual')
    AND booking_token_id IS NOT NULL THEN 'prerequisite_consultation'
  WHEN booking_type_id IN ('consult_in_person','consult_virtual') THEN 'standalone_consultation'
  ELSE 'tattoo'
END;

-- Historic pending checkouts are not silently released. They remain capacity
-- blocking until Studio or the reaper can reconcile them with Square.
UPDATE appointments
SET hold_state = 'expiry_attention',
    hold_expires_at = COALESCE(updated_at, created_at)
WHERE status IN ('pending_deposit','deposit_pending');

UPDATE appointments
SET hold_state = CASE
  WHEN status = 'confirmed' THEN 'converted'
  WHEN status IN ('cancelled','archived') THEN 'released'
  ELSE hold_state
END
WHERE hold_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_hold_reaper
  ON appointments(hold_state, hold_expires_at, status);
CREATE INDEX IF NOT EXISTS idx_appointments_replacement
  ON appointments(replacement_for_appointment_id, replaced_by_appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointments_submission_purpose
  ON appointments(submission_id, purpose, created_at);
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

CREATE TABLE IF NOT EXISTS appointment_events (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment_created
  ON appointment_events(appointment_id, created_at);

ALTER TABLE flash_items ADD COLUMN reserved_submission_id TEXT
  REFERENCES submissions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flash_items_reserved_submission
  ON flash_items(reserved_submission_id)
  WHERE reserved_submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tattoo_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  review_time_message TEXT NOT NULL DEFAULT '',
  lead_time_days INTEGER NOT NULL DEFAULT 14 CHECK (lead_time_days >= 0),
  walk_in_guidance TEXT NOT NULL DEFAULT '',
  support_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO tattoo_settings (
  id, review_time_message, lead_time_days, walk_in_guidance, support_email, updated_at
) VALUES (
  'default',
  'Most project submissions are reviewed within 5-7 business days.',
  14,
  'Walk-in availability is announced through scheduled walk-in windows. Check the tattoo page before traveling to the studio.',
  'saisolehman@artpilltattoohouse.com',
  datetime('now')
);

CREATE TABLE IF NOT EXISTS tattoo_rate_cards (
  service_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  rate_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

INSERT OR IGNORE INTO tattoo_rate_cards (service_key, label, rate_text, sort_order, active) VALUES
  ('flash', 'Flash Sessions', '$150/hr', 10, 1),
  ('custom', 'Custom & Story-Driven Sessions', '$200/hr', 20, 1),
  ('special', 'Special Projects', '$100+/hr', 30, 1),
  ('build', 'Build Your Own', 'Quoted after review', 40, 1);

CREATE TABLE IF NOT EXISTS special_project_calls (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  rate_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  opens_at TEXT,
  closes_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_special_project_calls_public
  ON special_project_calls(status, sort_order, updated_at);

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

-- Conservative lifecycle backfill. No historic consultation is ever inferred
-- as complete; ambiguous large-cover-up records are explicitly flagged for
-- Studio review.
UPDATE submissions
SET tattoo_stage = 'review'
WHERE type IN ('tattoo_inquiry','flash_claim','special_project','build_brief','build_your_own','byo','maze_design');

UPDATE submissions
SET tattoo_stage = 'closed'
WHERE tattoo_stage IS NOT NULL
  AND status IN ('declined','archived','cancelled');

UPDATE submissions
SET tattoo_stage = 'consultation_required'
WHERE tattoo_stage = 'review'
  AND status IN ('approved','booked')
  AND (
    json_extract(
      CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
      '$.project_type'
    ) = 'large_cover_up'
    OR json_extract(
      CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
      '$.consult_required'
    ) = 'yes'
  );

UPDATE submissions
SET tattoo_stage = 'ready_to_book'
WHERE tattoo_stage = 'review'
  AND status = 'approved'
  AND EXISTS (
    SELECT 1 FROM tattoo_session_plans tsp
    WHERE tsp.submission_id = submissions.id
      AND tsp.session_category <> 'artist_review'
      AND tsp.split_policy <> 'artist_review'
  );

UPDATE submissions
SET tattoo_stage = 'tattoo_scheduled'
WHERE tattoo_stage IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.submission_id = submissions.id
      AND a.purpose = 'tattoo'
      AND a.status = 'confirmed'
  );

UPDATE submissions
SET lifecycle_review_required = 1,
    lifecycle_review_note = 'Historic lifecycle state requires Studio review; prerequisite completion was not inferred.'
WHERE tattoo_stage = 'review'
  AND status IN ('approved','booked');

UPDATE submissions
SET lifecycle_review_required = 1,
    lifecycle_review_note = 'Historic prerequisite consultation found; confirm completion manually before issuing tattoo booking access.'
WHERE tattoo_stage = 'consultation_required'
  AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.submission_id = submissions.id
      AND a.purpose = 'prerequisite_consultation'
      AND a.status IN ('confirmed','completed')
  );

INSERT INTO appointment_events (
  id, appointment_id, event_type, actor, note, metadata_json, created_at
)
SELECT
  lower(hex(randomblob(16))),
  a.id,
  'migration_review_required',
  'migration-0039',
  'Historic prerequisite consultation was not auto-completed; Studio review is required.',
  '{}',
  datetime('now')
FROM appointments a
JOIN submissions s ON s.id = a.submission_id
WHERE a.purpose = 'prerequisite_consultation'
  AND a.status IN ('confirmed','completed')
  AND s.lifecycle_review_required = 1;
