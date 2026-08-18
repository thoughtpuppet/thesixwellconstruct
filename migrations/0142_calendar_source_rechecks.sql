PRAGMA foreign_keys = ON;

-- Candidate source monitoring is separate from editorial publication. A Scout
-- recheck may update the private candidate and open a pending revision, but the
-- approved calendar entry changes only after an explicit Studio approval.

ALTER TABLE calendar_candidates ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (schedule_status IN ('scheduled','postponed','rescheduled','cancelled','moved_online'));
ALTER TABLE calendar_candidates ADD COLUMN ticket_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed'));
ALTER TABLE calendar_candidates ADD COLUMN ticket_on_sale_at TEXT;
ALTER TABLE calendar_candidates ADD COLUMN ticket_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN last_checked_at TEXT;
ALTER TABLE calendar_candidates ADD COLUMN last_check_status TEXT NOT NULL DEFAULT 'never'
  CHECK (last_check_status IN ('never','unchanged','changes_detected','source_unavailable','needs_verification'));
ALTER TABLE calendar_candidates ADD COLUMN last_check_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN monitoring_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (monitoring_enabled IN (0,1));
ALTER TABLE calendar_candidates ADD COLUMN monitoring_cadence_hours INTEGER NOT NULL DEFAULT 24
  CHECK (monitoring_cadence_hours BETWEEN 1 AND 720);
ALTER TABLE calendar_candidates ADD COLUMN next_check_at TEXT;

ALTER TABLE calendar_candidate_occurrences ADD COLUMN ticket_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed'));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN ticket_on_sale_at TEXT;
ALTER TABLE calendar_candidate_occurrences ADD COLUMN ticket_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_entries ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (schedule_status IN ('scheduled','postponed','rescheduled','cancelled','moved_online'));
ALTER TABLE calendar_entries ADD COLUMN ticket_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed'));
ALTER TABLE calendar_entries ADD COLUMN ticket_on_sale_at TEXT;
ALTER TABLE calendar_entries ADD COLUMN ticket_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_entry_occurrences ADD COLUMN ticket_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (ticket_status IN ('unknown','not_required','not_yet_on_sale','on_sale','sold_out','registration_open','registration_closed'));
ALTER TABLE calendar_entry_occurrences ADD COLUMN ticket_on_sale_at TEXT;
ALTER TABLE calendar_entry_occurrences ADD COLUMN ticket_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_candidate_revisions ADD COLUMN change_set_json TEXT NOT NULL DEFAULT '[]';

UPDATE calendar_candidates SET schedule_status='cancelled' WHERE status='cancelled';
UPDATE calendar_entries SET schedule_status='cancelled' WHERE status='cancelled';

CREATE INDEX IF NOT EXISTS idx_calendar_candidates_monitoring_due
  ON calendar_candidates(monitoring_enabled,next_check_at,status)
  WHERE monitoring_enabled=1;
