PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS crm_consent_events (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose TEXT NOT NULL CHECK (purpose IN ('newsletter','marketing')),
  status TEXT NOT NULL CHECK (status IN ('pending','granted','revoked')),
  normalized_value TEXT NOT NULL,
  source TEXT NOT NULL,
  source_detail TEXT NOT NULL DEFAULT '',
  disclosure_version TEXT NOT NULL DEFAULT '',
  disclosure_text TEXT NOT NULL DEFAULT '',
  form_path TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_reference TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_consent_contact
  ON crm_consent_events(channel, purpose, normalized_value, occurred_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_consent_person
  ON crm_consent_events(person_id, channel, purpose, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_consent_provider_reference
  ON crm_consent_events(provider, provider_reference)
  WHERE provider != '' AND provider_reference IS NOT NULL AND provider_reference != '';

CREATE TABLE IF NOT EXISTS crm_outreach_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose TEXT NOT NULL CHECK (purpose IN ('newsletter','marketing')),
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  segment_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','reviewed','prepared','scheduled','sending','sent','cancelled','failed')),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  audience_version TEXT NOT NULL DEFAULT '',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  prepared_at TEXT,
  completed_at TEXT,
  error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_outreach_campaign_status
  ON crm_outreach_campaigns(status, scheduled_at, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_outreach_campaign_provider
  ON crm_outreach_campaigns(provider, provider_reference)
  WHERE provider_reference IS NOT NULL AND provider_reference != '';

CREATE TABLE IF NOT EXISTS crm_outreach_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  person_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  normalized_value TEXT NOT NULL,
  consent_event_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('eligible','excluded','queued','sending','accepted','delivered','failed','suppressed','cancelled')),
  exclusion_reason TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT,
  error TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES crm_outreach_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (consent_event_id) REFERENCES crm_consent_events(id) ON DELETE SET NULL,
  UNIQUE (campaign_id, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_crm_outreach_recipient_queue
  ON crm_outreach_recipients(status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_recipient_person
  ON crm_outreach_recipients(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_recipient_provider
  ON crm_outreach_recipients(provider_message_id)
  WHERE provider_message_id IS NOT NULL AND provider_message_id != '';

CREATE TABLE IF NOT EXISTS crm_communications (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  followup_id TEXT,
  campaign_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose TEXT NOT NULL CHECK (purpose IN ('relationship','newsletter','marketing')),
  direction TEXT NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound','inbound')),
  provider TEXT NOT NULL,
  normalized_destination TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','queued','accepted','delivered','failed','suppressed','cancelled','received')),
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  error TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  accepted_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (followup_id) REFERENCES crm_followups(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES crm_outreach_campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_communications_person
  ON crm_communications(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_communications_schedule
  ON crm_communications(status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_crm_communications_provider
  ON crm_communications(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND provider_message_id != '';

CREATE TABLE IF NOT EXISTS crm_preference_tokens (
  id TEXT PRIMARY KEY,
  contact_kind TEXT NOT NULL CHECK (contact_kind IN ('email','phone')),
  normalized_value TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_preference_token_contact
  ON crm_preference_tokens(contact_kind, normalized_value, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_outreach_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS crm_outreach_leases (
  lease_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
