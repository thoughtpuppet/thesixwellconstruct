PRAGMA foreign_keys = ON;

-- Identity authority is evidence-based, not website-based. Exact event and
-- ticket pages still require review, but organizers and venues may be
-- confirmed through platform profiles, official social profiles, partner
-- pages, flyers, or documented Studio verification.
UPDATE calendar_scout_profiles
SET source_resolution_rules = REPLACE(
      source_resolution_rules,
      'Keep an authorized ticket page as the ticket URL or use it as the public source only when no event-specific official page exists and an official organizer or venue website supports it.',
      'Keep an exact authorized ticket page as the ticket URL or public source when it identifies the event. Confirm organizer or venue identity through an official website, official social or platform profile, partner page, flyer, or documented Studio review; a standalone website is not required.'
    ),
    updated_at = datetime('now')
WHERE id='atlanta-default';

UPDATE calendar_candidate_links
SET label='ORCA organizer profile on Posh',link_role='organizer',updated_at=datetime('now')
WHERE id='cal_link_posh_orca_group';

UPDATE calendar_candidates
SET organizer_url=CASE WHEN organizer_url='' THEN 'https://posh.vip/g/orca' ELSE organizer_url END,
    source_resolution_notes=REPLACE(
      source_resolution_notes,
      'The exact Posh ticket page supplies event facts, but an official organizer or venue website is still required.',
      'The exact Posh ticket page supplies event facts and links to ORCA''s organizer profile on Posh; Studio review still controls verification and publication.'
    ),
    verification_notes=REPLACE(
      verification_notes,
      'Confirm ORCA or the venue on an official website before publication.',
      'Confirm ORCA or the venue from the Posh organizer profile, event flyer, partner evidence, or documented Studio review before publication.'
    ),
    updated_at=datetime('now')
WHERE id='cal_candidate_posh_orca_open_house_2026';

UPDATE calendar_candidates
SET verification_notes=REPLACE(
      REPLACE(
        verification_notes,
        'Confirm the organizer or venue on an official website before publication.',
        'Confirm the organizer or venue identity from the listing, an official profile, partner page, flyer, or documented Studio review before publication.'
      ),
      'An authorized ticket listing requires an official organizer or venue website.',
      'Confirm the organizer or venue identity from the listing, an official profile, partner page, flyer, or documented Studio review.'
    ),
    source_resolution_notes=REPLACE(
      source_resolution_notes,
      'official organizer or venue support is still required',
      'Studio identity confirmation is still required when the listing does not establish the organizer or venue'
    ),
    updated_at=datetime('now')
WHERE source_authority='authorized_ticket_host';
