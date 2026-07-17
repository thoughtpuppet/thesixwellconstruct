PRAGMA foreign_keys = ON;

-- Construct People is an internal relationship CRM. It is intentionally
-- separate from the editorial/public `people` resource introduced in 0022.

CREATE TABLE IF NOT EXISTS crm_import_batches (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  source_label TEXT NOT NULL DEFAULT '',
  source_period_start TEXT,
  source_period_end TEXT,
  default_interaction_type TEXT NOT NULL DEFAULT 'legacy_contact',
  default_node_id TEXT,
  date_format TEXT NOT NULL DEFAULT 'auto',
  currency TEXT NOT NULL DEFAULT 'USD',
  money_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (money_mode IN ('none','transaction','aggregate','estimate','unpaid')),
  newsletter_export INTEGER NOT NULL DEFAULT 0
    CHECK (newsletter_export IN (0,1)),
  newsletter_provider TEXT,
  delimiter TEXT NOT NULL DEFAULT ','
    CHECK (delimiter IN (',', char(9))),
  header_json TEXT NOT NULL DEFAULT '[]',
  mapping_json TEXT NOT NULL DEFAULT '{}',
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'analyzed'
    CHECK (status IN ('analyzed','configured','applying','applied','rolled_back','failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  column_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  staging_expires_at TEXT,
  applied_at TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_node_id) REFERENCES construct_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_import_batches_status_created
  ON crm_import_batches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  preferred_name TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  relationship_status TEXT NOT NULL DEFAULT 'active'
    CHECK (relationship_status IN ('active','inactive','archived','suppressed','merged')),
  tier INTEGER CHECK (tier IS NULL OR tier IN (1,2,3)),
  tier_rationale TEXT NOT NULL DEFAULT '',
  tier_reviewed_at TEXT,
  preferred_contact_method TEXT NOT NULL DEFAULT ''
    CHECK (preferred_contact_method IN ('','email','phone','instagram','none')),
  summary TEXT NOT NULL DEFAULT '',
  archive_person_id TEXT,
  merged_into_id TEXT,
  import_batch_id TEXT,
  archived_at TEXT,
  anonymized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (archive_person_id) REFERENCES people(id) ON DELETE SET NULL,
  FOREIGN KEY (merged_into_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL,
  CHECK (merged_into_id IS NULL OR merged_into_id != id)
);

CREATE INDEX IF NOT EXISTS idx_crm_people_name
  ON crm_people(display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_crm_people_tier_status
  ON crm_people(tier, relationship_status);
CREATE INDEX IF NOT EXISTS idx_crm_people_merged_into
  ON crm_people(merged_into_id);

CREATE TABLE IF NOT EXISTS crm_identities (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('email','phone','instagram','shopify_customer','square_customer','beehiiv_subscription','substack_subscriber','other')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  label TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  is_shared INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0,1)),
  source_provider TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT NOT NULL DEFAULT 'identity',
  source_id TEXT,
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_identities_lookup
  ON crm_identities(kind, normalized_value, active);
CREATE INDEX IF NOT EXISTS idx_crm_identities_person
  ON crm_identities(person_id, kind, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_identities_provider_external
  ON crm_identities(provider, external_id)
  WHERE external_id IS NOT NULL AND external_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_identities_source
  ON crm_identities(source_provider, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

CREATE TABLE IF NOT EXISTS crm_interactions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  node_id TEXT,
  channel TEXT NOT NULL DEFAULT '',
  interaction_type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,
  source_provider TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT NOT NULL DEFAULT 'interaction',
  source_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (node_id) REFERENCES construct_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_person_occurred
  ON crm_interactions(person_id, active, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_node_occurred
  ON crm_interactions(node_id, active, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_interactions_source
  ON crm_interactions(source_provider, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

CREATE TABLE IF NOT EXISTS crm_transactions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  node_id TEXT,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('charge','refund','adjustment')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','void','failed')),
  amount_cents INTEGER NOT NULL,
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_at TEXT NOT NULL,
  source_provider TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT NOT NULL DEFAULT 'transaction',
  source_id TEXT,
  external_customer_id TEXT,
  external_order_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (node_id) REFERENCES construct_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL,
  CHECK (
    (transaction_type IN ('charge','refund') AND amount_cents >= 0)
    OR transaction_type = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS idx_crm_transactions_person_occurred
  ON crm_transactions(person_id, active, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_transactions_status
  ON crm_transactions(status, active, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_transactions_source
  ON crm_transactions(source_provider, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

CREATE TABLE IF NOT EXISTS crm_notes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'relationship',
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  revision_of_id TEXT,
  source_label TEXT NOT NULL DEFAULT '',
  source_provider TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT NOT NULL DEFAULT 'note',
  source_id TEXT,
  import_batch_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    category != 'personal_context'
    OR (source_provider = 'manual' AND source_type = 'shared_by_client')
  ),
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_of_id) REFERENCES crm_notes(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_notes_person_created
  ON crm_notes(person_id, archived_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_notes_source
  ON crm_notes(source_provider, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

CREATE TABLE IF NOT EXISTS crm_followups (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','cancelled')),
  completed_at TEXT,
  import_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_followups_due
  ON crm_followups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_followups_person
  ON crm_followups(person_id, status, due_at);

CREATE TABLE IF NOT EXISTS crm_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_person_tags (
  person_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, tag_id),
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES crm_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_person_tags_tag
  ON crm_person_tags(tag_id, person_id);

CREATE TABLE IF NOT EXISTS crm_attendance (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  event_id TEXT,
  event_ticket_id TEXT,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('invited','registered','checked_in','no_show','cancelled')),
  checked_in_at TEXT,
  source_provider TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT NOT NULL DEFAULT 'attendance',
  source_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY (event_ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_person
  ON crm_attendance(person_id, active, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_attendance_source
  ON crm_attendance(source_provider, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

CREATE TABLE IF NOT EXISTS crm_marketing_subscriptions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  provider TEXT NOT NULL,
  publication_id TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('subscribed','unsubscribed','paused','unknown')),
  tier TEXT NOT NULL DEFAULT '',
  consent_source TEXT NOT NULL DEFAULT '',
  subscribed_at TEXT,
  unsubscribed_at TEXT,
  last_synced_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_subscriptions_person
  ON crm_marketing_subscriptions(person_id, active, provider);
CREATE INDEX IF NOT EXISTS idx_crm_subscriptions_email
  ON crm_marketing_subscriptions(email, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_subscriptions_provider_external
  ON crm_marketing_subscriptions(provider, external_id)
  WHERE external_id IS NOT NULL AND external_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_subscriptions_person_publication
  ON crm_marketing_subscriptions(person_id, provider, publication_id)
  WHERE person_id IS NOT NULL AND active = 1;

CREATE TABLE IF NOT EXISTS crm_suppressions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('email','phone')),
  normalized_value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  source_id TEXT,
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL,
  UNIQUE (identity_kind, normalized_value)
);

CREATE TABLE IF NOT EXISTS crm_tier_history (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  previous_tier INTEGER CHECK (previous_tier IS NULL OR previous_tier IN (1,2,3)),
  new_tier INTEGER CHECK (new_tier IS NULL OR new_tier IN (1,2,3)),
  rationale TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'studio',
  import_batch_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_tier_history_person
  ON crm_tier_history(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_merges (
  id TEXT PRIMARY KEY,
  survivor_person_id TEXT NOT NULL,
  duplicate_person_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'studio',
  merged_at TEXT NOT NULL,
  unmerged_at TEXT,
  FOREIGN KEY (survivor_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (duplicate_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  CHECK (survivor_person_id != duplicate_person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_merges_active_duplicate
  ON crm_merges(duplicate_person_id)
  WHERE unmerged_at IS NULL;

CREATE TABLE IF NOT EXISTS crm_sync_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending','running','complete','failed')),
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  stats_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_sync_jobs_provider_created
  ON crm_sync_jobs(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sync_jobs_status
  ON crm_sync_jobs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_import_rows (
  id TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  row_fingerprint TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  normalized_json TEXT NOT NULL DEFAULT '{}',
  classification TEXT NOT NULL
    CHECK (classification IN ('new_person','exact_match','possible_match','duplicate_in_file','already_imported','money_conflict','invalid')),
  matched_person_id TEXT,
  match_detail_json TEXT NOT NULL DEFAULT '{}',
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL DEFAULT 'review'
    CHECK (decision IN ('create','link','skip','review')),
  target_person_id TEXT,
  apply_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (apply_state IN ('pending','applied','skipped','error','rolled_back')),
  applied_person_id TEXT,
  error TEXT NOT NULL DEFAULT '',
  applied_at TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (target_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (applied_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  UNIQUE (import_batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_crm_import_rows_batch_classification
  ON crm_import_rows(import_batch_id, classification, row_number);
CREATE INDEX IF NOT EXISTS idx_crm_import_rows_fingerprint
  ON crm_import_rows(row_fingerprint, apply_state);
CREATE INDEX IF NOT EXISTS idx_crm_import_rows_apply
  ON crm_import_rows(import_batch_id, apply_state, decision, row_number);

CREATE TABLE IF NOT EXISTS crm_audit_events (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL DEFAULT 'studio',
  import_batch_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES crm_import_batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_audit_person_created
  ON crm_audit_events(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_audit_resource
  ON crm_audit_events(resource_type, resource_id, created_at DESC);
