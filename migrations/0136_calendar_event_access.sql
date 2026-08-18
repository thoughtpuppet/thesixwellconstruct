PRAGMA foreign_keys = ON;

-- Attendance eligibility is a public event fact, separate from the private
-- verification and programming notes. Existing records retain their prior
-- public assumption; restricted GSU records are explicitly backfilled below.

ALTER TABLE calendar_candidates ADD COLUMN access_status TEXT NOT NULL DEFAULT 'public'
  CHECK (access_status IN ('public','restricted','unknown'));
ALTER TABLE calendar_candidates ADD COLUMN access_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidates ADD COLUMN audiences_json TEXT NOT NULL DEFAULT '["Public"]';

ALTER TABLE calendar_entries ADD COLUMN access_status TEXT NOT NULL DEFAULT 'public'
  CHECK (access_status IN ('public','restricted','unknown'));
ALTER TABLE calendar_entries ADD COLUMN access_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entries ADD COLUMN audiences_json TEXT NOT NULL DEFAULT '["Public"]';

ALTER TABLE calendar_candidate_occurrences ADD COLUMN access_status TEXT NOT NULL DEFAULT 'public'
  CHECK (access_status IN ('public','restricted','unknown'));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN access_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_candidate_occurrences ADD COLUMN audiences_json TEXT NOT NULL DEFAULT '["Public"]';

ALTER TABLE calendar_entry_occurrences ADD COLUMN access_status TEXT NOT NULL DEFAULT 'public'
  CHECK (access_status IN ('public','restricted','unknown'));
ALTER TABLE calendar_entry_occurrences ADD COLUMN access_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_entry_occurrences ADD COLUMN audiences_json TEXT NOT NULL DEFAULT '["Public"]';

-- This official GSU listing was previously held only because its audience did
-- not include Public. Model that confirmed restriction as a publishable fact.
UPDATE calendar_candidates
SET access_status='restricted',
    access_notes='GSU access only: Faculty, Staff, Students, Graduate Students, Postdocs. Not open to the general public.',
    audiences_json='["Faculty","Staff","Students","Graduate Students","Postdocs"]',
    status=CASE WHEN status='needs_verification' THEN 'candidate' ELSE status END,
    verification_state='verified',
    verification_notes='Event facts and restricted audience access were retrieved from the official Georgia State University calendar.',
    last_verified_at=datetime('now'),
    updated_at=datetime('now')
WHERE id='cal_candidate_gsu_neurogenomics_forum_2026';

UPDATE calendar_candidate_revisions
SET snapshot_json=json_set(
      snapshot_json,
      '$.accessStatus','restricted',
      '$.accessNotes','GSU access only: Faculty, Staff, Students, Graduate Students, Postdocs. Not open to the general public.',
      '$.audiences',json('["Faculty","Staff","Students","Graduate Students","Postdocs"]')
    )
WHERE candidate_id='cal_candidate_gsu_neurogenomics_forum_2026';
