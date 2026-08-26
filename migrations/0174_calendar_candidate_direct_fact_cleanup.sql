-- Rewrite source-referential candidate copy as direct event facts. These
-- changes stay on private candidate records and pending proposal snapshots;
-- approved public snapshots remain unchanged until Studio approval.

UPDATE calendar_candidates
SET ticket_notes = 'Admission and RSVP terms have not been announced.',
    updated_at = datetime('now')
WHERE id = 'cal_candidate_2f9ddeac-65f3-4de6-8e53-18db1bf216b4'
  AND ticket_notes = 'Admission price, RSVP requirement, and vendor application terms are not stated on the official event page.';

UPDATE calendar_candidates
SET access_notes = 'Open to the public; guest tickets are available.',
    ticket_notes = 'Guest tickets and current prices are available through Georgia Tech Arts.',
    updated_at = datetime('now')
WHERE id = 'cal_candidate_9674e640-6b54-4019-b9c0-1c9f109f7cbb'
  AND access_status = 'public'
  AND access_notes IN ('', 'The official sources provide guest ticket ordering but do not explicitly state general-public eligibility.')
  AND ticket_notes = 'The authorized Georgia Tech Arts ticket page lists ticket prices and guest ordering.';

UPDATE calendar_candidates
SET factual_description = 'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 tour properties have not been announced.',
    ticket_notes = '$60 tour admission.',
    updated_at = datetime('now')
WHERE id = 'cal_candidate_fall_2026_ma_architecture_tours'
  AND factual_description = 'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 property list and a stable dedicated detail page remain forthcoming.'
  AND ticket_notes = 'Official festival listing provides admission information.';

UPDATE calendar_candidates
SET access_notes = 'Advance registration is required.',
    updated_at = datetime('now')
WHERE id IN (
    'cal_candidate_2ab8908f-107f-46dd-97eb-b5b64f8524e4',
    'cal_candidate_7d33634d-6cff-4521-904a-7a21842f10da'
  )
  AND access_status = 'public'
  AND access_notes IN (
    '',
    'The listing requires registration but does not explicitly establish whether attendance is open to the general public.',
    'The listing requires registration but does not explicitly state whether attendance is open to all or subject to another eligibility condition.'
  );

UPDATE calendar_candidates
SET ticket_notes = 'Festival passes are available in limited quantities. Individual party tickets are not yet on sale.',
    updated_at = datetime('now')
WHERE id = 'cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2'
  AND ticket_notes = 'Official ATLWKNDR passes are promoted through the organizer site and the exact Eventbrite listing reports limited remaining tickets. Individual party tickets are listed as on sale soon on the organizer page.';

UPDATE calendar_candidate_occurrences
SET ticket_notes = 'Registration is available.',
    updated_at = datetime('now')
WHERE id = 'cal_occurrence_78e5846e-4210-4fe2-bd87-d7da109251eb'
  AND ticket_notes = 'Registration link is provided on the official event-lineup page.';

UPDATE calendar_candidate_occurrences
SET ticket_notes = '$60 tour admission.',
    updated_at = datetime('now')
WHERE id IN (
    'cal_occurrence_fall_2026_ma_tour_saturday',
    'cal_occurrence_fall_2026_ma_tour_sunday'
  )
  AND ticket_notes = 'Official listing provides admission information.';

UPDATE calendar_candidate_occurrences
SET ticket_notes = 'RSVP is available.',
    updated_at = datetime('now')
WHERE id = 'cal_occurrence_a22aa323-9a25-406d-82ce-93fabbba42fe'
  AND ticket_notes = 'An RSVP prompt appears on the official listing; requirement and capacity are not confirmed.';

UPDATE calendar_candidate_occurrences
SET access_notes = 'Ages 21 and older.',
    ticket_notes = 'Individual party tickets are not yet on sale.',
    updated_at = datetime('now')
WHERE id IN (
    'cal_occurrence_6951adde-8180-4d47-9310-b8f4ff71a79c',
    'cal_occurrence_3dab0aea-6895-423f-b6bc-155925d66c66'
  )
  AND access_notes = 'The festival FAQ states that ATLWKNDR is 21+.'
  AND ticket_notes = 'Organizer page lists individual party tickets as on sale soon.';

UPDATE calendar_candidate_occurrences
SET factual_description = 'The opening ATLWKNDR program features music navigation by Salah Ananse and DJ Kemit. The 2026 venue is TBA.',
    access_notes = 'Ages 21 and older.',
    ticket_notes = 'Individual party tickets are not yet on sale.',
    updated_at = datetime('now')
WHERE id = 'cal_occurrence_694b378d-be17-41d1-a1f9-b4dad31542a7'
  AND factual_description = 'The opening ATLWKNDR program, featuring music navigation by Salah Ananse and DJ Kemit; the 2026 venue is listed as TBA on the official organizer page.'
  AND access_notes = 'The festival FAQ states that ATLWKNDR is 21+.'
  AND ticket_notes = 'Organizer page lists individual party tickets as on sale soon.';

UPDATE calendar_candidate_occurrences
SET access_notes = 'All ages.',
    ticket_notes = 'Tickets are not yet on sale.',
    updated_at = datetime('now')
WHERE id = 'cal_occurrence_d8985830-455d-4e3a-9dc9-e5639ac0f472'
  AND access_notes = 'The organizer FAQ states that House in the Park is all ages.'
  AND ticket_notes = 'The organizer page links House in the Park tickets through Big Tickets and lists them as on sale soon.';

-- Restore useful direct access context in pending proposal snapshots. The
-- current candidate rows above are the source of truth; these are deliberately
-- not reintroduced as selectable access-verification change-set items.
UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(snapshot_json, '$.accessNotes', 'Open to the public; guest tickets are available.')
WHERE id = 'cal_revision_96950966-1e87-425c-ae9a-1ef62de11d50'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.accessStatus') = 'public'
  AND json_extract(snapshot_json, '$.accessNotes') = '';

UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(snapshot_json, '$.accessNotes', 'Advance registration is required.')
WHERE id IN (
    'cal_revision_2a863ba4-0839-4e11-a09a-4f84f407e6f6',
    'cal_revision_3d00b63e-9764-4a34-99b0-7eef3591af1e'
  )
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.accessStatus') = 'public'
  AND json_extract(snapshot_json, '$.accessNotes') = '';

-- Exact guarded replacements keep snapshot and comparison copy synchronized.
UPDATE calendar_candidate_revisions
SET snapshot_json = replace(snapshot_json,
      'Free event; no tickets are needed. The authorized Eventbrite listing also provides free registration.',
      'Free event; no tickets are required. Free registration is available through Eventbrite.'),
    change_set_json = replace(change_set_json,
      'Free event; no tickets are needed. The authorized Eventbrite listing also provides free registration.',
      'Free event; no tickets are required. Free registration is available through Eventbrite.')
WHERE id = 'cal_revision_04cec86c-3433-4b7b-98fc-b605d82d97c6'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'Free event; no tickets are needed. The authorized Eventbrite listing also provides free registration.') > 0
    OR instr(change_set_json, 'Free event; no tickets are needed. The authorized Eventbrite listing also provides free registration.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(snapshot_json,
      'Admission price, RSVP requirement, and vendor application terms are not stated on the official event page.',
      'Admission and RSVP terms have not been announced.'),
    change_set_json = replace(change_set_json,
      'Admission price, RSVP requirement, and vendor application terms are not stated on the official event page.',
      'Admission and RSVP terms have not been announced.')
WHERE id = 'cal_revision_f4e8442e-8c5e-4fa2-b0f5-b5ba77930d3e'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'Admission price, RSVP requirement, and vendor application terms are not stated on the official event page.') > 0
    OR instr(change_set_json, 'Admission price, RSVP requirement, and vendor application terms are not stated on the official event page.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(
      replace(snapshot_json,
        'The authorized Georgia Tech Arts ticket page lists ticket prices and guest ordering.',
        'Guest tickets and current prices are available through Georgia Tech Arts.'),
      'The official sources provide guest ticket ordering but do not explicitly state general-public eligibility.',
      'Open to the public; guest tickets are available.'),
    change_set_json = replace(
      replace(change_set_json,
        'The authorized Georgia Tech Arts ticket page lists ticket prices and guest ordering.',
        'Guest tickets and current prices are available through Georgia Tech Arts.'),
      'The official sources provide guest ticket ordering but do not explicitly state general-public eligibility.',
      'Open to the public; guest tickets are available.')
WHERE id = 'cal_revision_96950966-1e87-425c-ae9a-1ef62de11d50'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'The authorized Georgia Tech Arts ticket page lists ticket prices and guest ordering.') > 0
    OR instr(change_set_json, 'The authorized Georgia Tech Arts ticket page lists ticket prices and guest ordering.') > 0
    OR instr(snapshot_json, 'The official sources provide guest ticket ordering but do not explicitly state general-public eligibility.') > 0
    OR instr(change_set_json, 'The official sources provide guest ticket ordering but do not explicitly state general-public eligibility.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(
      replace(snapshot_json,
        'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 property list and a stable dedicated detail page remain forthcoming.',
        'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 tour properties have not been announced.'),
      'Official festival listing provides admission information.',
      '$60 tour admission.'),
    change_set_json = replace(
      replace(change_set_json,
        'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 property list and a stable dedicated detail page remain forthcoming.',
        'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 tour properties have not been announced.'),
      'Official festival listing provides admission information.',
      '$60 tour admission.')
WHERE id = 'cal_revision_fall_2026_cal_candidate_fall_2026_ma_architecture_tours'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'property list and a stable dedicated detail page') > 0
    OR instr(change_set_json, 'property list and a stable dedicated detail page') > 0
    OR instr(snapshot_json, 'Official festival listing provides admission information.') > 0
    OR instr(change_set_json, 'Official festival listing provides admission information.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(snapshot_json, 'Official listing provides admission information.', '$60 tour admission.'),
    change_set_json = replace(change_set_json, 'Official listing provides admission information.', '$60 tour admission.')
WHERE id = 'cal_revision_fall_2026_cal_candidate_fall_2026_ma_architecture_tours'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'Official listing provides admission information.') > 0
    OR instr(change_set_json, 'Official listing provides admission information.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(snapshot_json,
      'An RSVP prompt appears on the official listing; requirement and capacity are not confirmed.',
      'RSVP is available.'),
    change_set_json = replace(change_set_json,
      'An RSVP prompt appears on the official listing; requirement and capacity are not confirmed.',
      'RSVP is available.')
WHERE id = 'cal_revision_a91383c6-1d67-4609-8d57-6b99547842db'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'An RSVP prompt appears on the official listing; requirement and capacity are not confirmed.') > 0
    OR instr(change_set_json, 'An RSVP prompt appears on the official listing; requirement and capacity are not confirmed.') > 0);

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(
      replace(
        replace(
          replace(
            replace(snapshot_json,
              'Official ATLWKNDR passes are promoted through the organizer site and the exact Eventbrite listing reports limited remaining tickets. Individual party tickets are listed as on sale soon on the organizer page.',
              'Festival passes are available in limited quantities. Individual party tickets are not yet on sale.'),
            'The festival FAQ states that ATLWKNDR is 21+.',
            'Ages 21 and older.'),
          'The organizer FAQ states that House in the Park is all ages.',
          'All ages.'),
        'Organizer page lists individual party tickets as on sale soon.',
        'Individual party tickets are not yet on sale.'),
      'The organizer page links House in the Park tickets through Big Tickets and lists them as on sale soon.',
      'Tickets are not yet on sale.'),
    change_set_json = replace(
      replace(
        replace(
          replace(
            replace(change_set_json,
              'Official ATLWKNDR passes are promoted through the organizer site and the exact Eventbrite listing reports limited remaining tickets. Individual party tickets are listed as on sale soon on the organizer page.',
              'Festival passes are available in limited quantities. Individual party tickets are not yet on sale.'),
            'The festival FAQ states that ATLWKNDR is 21+.',
            'Ages 21 and older.'),
          'The organizer FAQ states that House in the Park is all ages.',
          'All ages.'),
        'Organizer page lists individual party tickets as on sale soon.',
        'Individual party tickets are not yet on sale.'),
      'The organizer page links House in the Park tickets through Big Tickets and lists them as on sale soon.',
      'Tickets are not yet on sale.')
WHERE id = 'cal_revision_14a8c3af-3831-409a-80dd-7df184464ea1'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (
    instr(snapshot_json, 'Official ATLWKNDR passes are promoted through the organizer site') > 0
    OR instr(change_set_json, 'Official ATLWKNDR passes are promoted through the organizer site') > 0
    OR instr(snapshot_json, 'The festival FAQ states that ATLWKNDR is 21+.') > 0
    OR instr(change_set_json, 'The festival FAQ states that ATLWKNDR is 21+.') > 0
    OR instr(snapshot_json, 'The organizer FAQ states that House in the Park is all ages.') > 0
    OR instr(change_set_json, 'The organizer FAQ states that House in the Park is all ages.') > 0
    OR instr(snapshot_json, 'Organizer page lists individual party tickets as on sale soon.') > 0
    OR instr(change_set_json, 'Organizer page lists individual party tickets as on sale soon.') > 0
    OR instr(snapshot_json, 'The organizer page links House in the Park tickets through Big Tickets and lists them as on sale soon.') > 0
    OR instr(change_set_json, 'The organizer page links House in the Park tickets through Big Tickets and lists them as on sale soon.') > 0
  );

UPDATE calendar_candidate_revisions
SET snapshot_json = replace(snapshot_json,
      'The opening ATLWKNDR program, featuring music navigation by Salah Ananse and DJ Kemit; the 2026 venue is listed as TBA on the official organizer page.',
      'The opening ATLWKNDR program features music navigation by Salah Ananse and DJ Kemit. The 2026 venue is TBA.'),
    change_set_json = replace(change_set_json,
      'The opening ATLWKNDR program, featuring music navigation by Salah Ananse and DJ Kemit; the 2026 venue is listed as TBA on the official organizer page.',
      'The opening ATLWKNDR program features music navigation by Salah Ananse and DJ Kemit. The 2026 venue is TBA.')
WHERE id = 'cal_revision_14a8c3af-3831-409a-80dd-7df184464ea1'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_valid(change_set_json)
  AND (instr(snapshot_json, 'the 2026 venue is listed as TBA on the official organizer page') > 0
    OR instr(change_set_json, 'the 2026 venue is listed as TBA on the official organizer page') > 0);
