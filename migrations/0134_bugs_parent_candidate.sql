PRAGMA foreign_keys = ON;

-- An earlier GULCH import described only the opening reception in its parent
-- title and used the Instagram announcement as the canonical source. Preserve
-- that candidate identity, but make the parent describe the full exhibition
-- and return it to verification until an event-specific official page exists.
UPDATE calendar_candidates
SET title='You Are Not Alone: BUGS!',
    organizer='Georgia State University Perimeter College Art Galleries',
    factual_description='A group exhibition featuring 18 Georgia artists working across photography, painting, sculpture, ceramics, mixed media, and installation. The exhibition considers insects through pollination, labor, decomposition, interdependence, and their essential ecological roles, with related music, theater, and film programming.',
    source_url='https://www.gulchmagazine.com/',
    ticket_url='',
    date_kind='date_range',
    starts_at='2026-08-17',
    ends_at='2026-10-07',
    timezone='America/New_York',
    venue_name='Fine Arts Gallery (CF), Georgia State University Perimeter College, Clarkston',
    venue_address='3735 Memorial College Drive, Clarkston, GA 30021',
    city='Clarkston',
    region='GA',
    subjects_json='["art"]',
    formats_json='["exhibition"]',
    is_experimental=1,
    status=CASE WHEN public_entry_id='' THEN 'needs_verification' ELSE status END,
    verification_state='needs_verification',
    verification_notes='The schedule is documented, but the discovery announcement is on Instagram and no event-specific official organizer, venue, or ticket-host page has been confirmed. Keep private until a reliable canonical event link is verified.',
    last_verified_at=NULL,
    updated_at=datetime('now')
WHERE lower(title) LIKE 'you are not alone%bugs%';

UPDATE calendar_candidate_revisions
SET change_summary='Converted the imported opening listing into the parent exhibition with its related opening reception and artist talk; official event-specific link still requires verification.'
WHERE id='cal_revision_bugs_schedule_2026';
