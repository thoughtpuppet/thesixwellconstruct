-- Special Projects can be either extended collaborative calls or free,
-- artist-led experimental work. Existing calls are deliberately preserved as
-- extended projects.

ALTER TABLE special_project_calls ADD COLUMN profile TEXT NOT NULL DEFAULT 'extended'
  CHECK (profile IN ('extended','experimental'));
ALTER TABLE special_project_calls ADD COLUMN allowed_modes_json TEXT NOT NULL DEFAULT '["fresh"]'
  CHECK (json_valid(allowed_modes_json));
ALTER TABLE special_project_calls ADD COLUMN refundable_deposit_cents INTEGER NOT NULL DEFAULT 0
  CHECK (refundable_deposit_cents >= 0);
ALTER TABLE special_project_calls ADD COLUMN healed_photo_due_weeks INTEGER NOT NULL DEFAULT 6
  CHECK (healed_photo_due_weeks BETWEEN 1 AND 52);
ALTER TABLE special_project_calls ADD COLUMN application_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE special_project_calls ADD COLUMN participation_terms TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS special_project_call_media (
  project_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'gallery' CHECK (role IN ('primary','gallery')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_text_override TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, media_id),
  FOREIGN KEY (project_id) REFERENCES special_project_calls(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_special_project_media_primary
  ON special_project_call_media(project_id)
  WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS idx_special_project_media_order
  ON special_project_call_media(project_id, sort_order, media_id);

CREATE TABLE IF NOT EXISTS special_project_submission_terms (
  submission_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_profile TEXT NOT NULL CHECK (project_profile IN ('extended','experimental')),
  project_title TEXT NOT NULL,
  selected_mode TEXT NOT NULL CHECK (selected_mode IN ('fresh','cover_up','blast_over')),
  refundable_deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK (refundable_deposit_cents >= 0),
  healed_photo_method TEXT CHECK (healed_photo_method IS NULL OR healed_photo_method IN ('return','self_upload')),
  healed_photo_due_weeks INTEGER NOT NULL DEFAULT 6 CHECK (healed_photo_due_weeks BETWEEN 1 AND 52),
  participation_terms TEXT NOT NULL DEFAULT '',
  agreement_version TEXT NOT NULL DEFAULT 'special-project-experimental-v1',
  agreement_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(agreement_snapshot_json)),
  agreed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES special_project_calls(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_special_project_terms_project
  ON special_project_submission_terms(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS experimental_deposit_refunds (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  deposit_payment_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'square',
  provider_refund_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL CHECK (reason IN ('attendance','manual_exception')),
  exception_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','rejected','failed','attention')),
  raw_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw_json)),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (deposit_payment_id) REFERENCES deposit_payments(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_experimental_refund_provider
  ON experimental_deposit_refunds(provider, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL AND trim(provider_refund_id) <> '';
CREATE INDEX IF NOT EXISTS idx_experimental_refund_status
  ON experimental_deposit_refunds(status, updated_at);

CREATE TABLE IF NOT EXISTS special_project_healed_followups (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  appointment_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('return','self_upload')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','received','return_completed','waived')),
  due_at TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  token_expires_at TEXT,
  instructions_sent_at TEXT,
  reminder_sent_at TEXT,
  media_asset_id TEXT,
  completed_at TEXT,
  completion_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_special_project_healed_due
  ON special_project_healed_followups(status, due_at, reminder_sent_at);

CREATE TABLE IF NOT EXISTS special_project_healed_photos (
  id TEXT PRIMARY KEY,
  followup_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (followup_id) REFERENCES special_project_healed_followups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_special_project_healed_photos_followup
  ON special_project_healed_photos(followup_id, created_at);
