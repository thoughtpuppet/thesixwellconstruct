CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  template_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  related_type TEXT,
  related_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_related
  ON notification_deliveries(related_type, related_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_template_status
  ON notification_deliveries(template_key, status, created_at);
