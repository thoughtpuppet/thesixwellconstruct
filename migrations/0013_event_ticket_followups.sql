-- Follow-up columns for the event ticket lifecycle:
--   - cancelled_at / refund_id support the admin cancel + Square refund flow
--   - reminder_sent_at is informational; reminder idempotency is enforced by
--     notification_deliveries, but the column makes the state queryable.
-- The status column already allows 'cancelled' (see 0012 comment).

ALTER TABLE event_tickets ADD COLUMN cancelled_at TEXT;
ALTER TABLE event_tickets ADD COLUMN refund_id TEXT;
ALTER TABLE event_tickets ADD COLUMN reminder_sent_at TEXT;

-- The reaper sweeps stale 'pending' rows by age; this index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_event_tickets_status_created
  ON event_tickets(status, created_at);
