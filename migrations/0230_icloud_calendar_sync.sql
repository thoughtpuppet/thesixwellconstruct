-- Private Apple/iCloud CalDAV coordination for tattoo booking.
-- Credentials remain Worker secrets; D1 stores only selected calendar
-- resources, sync state, opaque hashes, and appointment resource mappings.

CREATE TABLE IF NOT EXISTS booking_calendar_sync_settings (
  id TEXT PRIMARY KEY CHECK (id = 'icloud'),
  provider TEXT NOT NULL DEFAULT 'icloud' CHECK (provider = 'icloud'),
  inbound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (inbound_enabled IN (0,1)),
  outbound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (outbound_enabled IN (0,1)),
  destination_calendar_href TEXT NOT NULL DEFAULT '',
  destination_calendar_name TEXT NOT NULL DEFAULT '',
  blocking_calendars_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocking_calendars_json)),
  last_discovered_at TEXT,
  last_inbound_started_at TEXT,
  last_inbound_succeeded_at TEXT,
  last_outbound_started_at TEXT,
  last_outbound_succeeded_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  lock_owner TEXT NOT NULL DEFAULT '',
  lock_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO booking_calendar_sync_settings (
  id, provider, created_at, updated_at
) VALUES ('icloud', 'icloud', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS booking_calendar_sync_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'icloud',
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','full')),
  trigger_kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_kind IN ('scheduled','manual','live_check')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped')),
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_calendar_sync_runs_started
  ON booking_calendar_sync_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS appointment_calendar_links (
  appointment_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'icloud',
  calendar_href TEXT NOT NULL,
  resource_href TEXT NOT NULL,
  event_uid TEXT NOT NULL UNIQUE,
  etag TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','synced','deleted','error')),
  last_attempt_at TEXT,
  last_synced_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointment_calendar_links_state
  ON appointment_calendar_links(state, updated_at);

CREATE TABLE IF NOT EXISTS external_calendar_busy_sources (
  availability_window_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'icloud',
  calendar_href_hash TEXT NOT NULL,
  calendar_name TEXT NOT NULL DEFAULT '',
  event_uid_hash TEXT NOT NULL,
  recurrence_key TEXT NOT NULL DEFAULT '',
  source_etag TEXT NOT NULL DEFAULT '',
  sync_run_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (availability_window_id) REFERENCES availability_windows(id) ON DELETE CASCADE,
  FOREIGN KEY (sync_run_id) REFERENCES booking_calendar_sync_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_calendar_busy_sources_run
  ON external_calendar_busy_sources(sync_run_id, observed_at);
