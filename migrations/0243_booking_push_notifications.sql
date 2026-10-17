-- Owner devices only. Public forms cannot register a push destination.
CREATE TABLE IF NOT EXISTS booking_push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_push_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES booking_push_subscriptions(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_status INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (subscription_id, event_key)
);
CREATE INDEX IF NOT EXISTS booking_push_deliveries_due
  ON booking_push_deliveries(status, next_attempt_at);

-- Server-side VAPID credentials for owner-initiated setup from the installed app.
CREATE TABLE IF NOT EXISTS booking_push_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);
