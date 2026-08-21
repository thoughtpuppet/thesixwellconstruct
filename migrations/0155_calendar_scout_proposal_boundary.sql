PRAGMA foreign_keys = ON;

-- Source monitoring used to write extracted facts into the private candidate
-- before opening a revision. Restore the last Studio-approved SCD record; its
-- public entry was never changed because publication remained approval-gated.
UPDATE calendar_candidate_revisions
SET revision_state='rejected', reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE candidate_id='cal_candidate_106e8b2c-f22c-41b0-8148-98a30eac2add'
  AND revision_state='pending'
  AND created_by='source_monitor';

UPDATE calendar_candidates
SET access_status='public',
    access_notes='',
    audiences_json='["Public"]',
    date_kind='date_range',
    starts_at='2026-09-21',
    ends_at='2026-09-23',
    timezone='America/New_York',
    subjects_json='["art","technology"]',
    formats_json='["conference"]',
    source_url='https://arctic.gsu.edu/training/scd/',
    discovery_url='https://calendar.gsu.edu/event/science-and-cyberinfrastructure-for-discovery-scd-conference',
    organizer_url='https://arctic.gsu.edu/',
    venue_url='https://calendar.gsu.edu/event/science-and-cyberinfrastructure-for-discovery-scd-conference',
    source_authority='organizer_event',
    source_resolution_notes='The ARCTIC conference page is the direct organizer source and confirms a September 21 preconference plus September 22–23 conference dates. The GSU calendar remains a venue/calendar reference.',
    pending_revision_id='',
    last_check_status='needs_verification',
    last_check_summary='Rejected an automated source regression and restored the last Studio-approved facts. Recheck after the proposal-only Scout update is deployed.',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='cal_candidate_106e8b2c-f22c-41b0-8148-98a30eac2add'
  AND EXISTS (
    SELECT 1 FROM calendar_entries e
    WHERE e.candidate_id=calendar_candidates.id
      AND e.date_kind='date_range'
      AND e.starts_at='2026-09-21'
      AND e.ends_at='2026-09-23'
      AND e.access_status='public'
  );
