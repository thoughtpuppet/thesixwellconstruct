-- Default unstated attendance to public while preserving genuine access conflicts
-- and explicit restrictions for Studio review.

UPDATE calendar_candidates
SET access_status = 'public',
    access_notes = '',
    audiences_json = '["Public"]',
    updated_at = datetime('now')
WHERE status NOT IN ('rejected', 'cancelled', 'duplicate')
  AND access_status = 'unknown'
  AND id NOT IN (
    'cal_candidate_4bf7f1c5-4d21-46bd-9dfb-8a62d5593fad',
    'cal_candidate_0312e180-79f2-414e-8500-193e1b2efdd9'
  );

-- An explicit member-exclusive label is a restriction, not an access conflict.
-- Keep its separate source and end-time verification work intact.
UPDATE calendar_candidates
SET access_status = 'restricted',
    access_notes = 'Members only.',
    audiences_json = '["Members"]',
    updated_at = datetime('now')
WHERE id = 'cal_candidate_0312e180-79f2-414e-8500-193e1b2efdd9'
  AND access_status = 'unknown';

UPDATE calendar_candidate_occurrences
SET access_status = 'public',
    access_notes = '',
    audiences_json = '["Public"]',
    updated_at = datetime('now')
WHERE access_status = 'unknown'
  AND id <> 'cal_occurrence_2dabdfc1-726d-4b8e-b6fc-593c7c6ed75c'
  AND candidate_id IN (
    SELECT id
    FROM calendar_candidates
    WHERE status NOT IN ('rejected', 'cancelled', 'duplicate')
  );

-- Normalize pending proposal snapshots so applying an older Scout update cannot
-- restore the retired silence-means-unknown convention.
UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(
      snapshot_json,
      '$.accessStatus', 'public',
      '$.accessNotes', '',
      '$.audiences', json('["Public"]')
    )
WHERE revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.accessStatus') = 'unknown'
  AND candidate_id NOT IN (
    'cal_candidate_4bf7f1c5-4d21-46bd-9dfb-8a62d5593fad',
    'cal_candidate_0312e180-79f2-414e-8500-193e1b2efdd9'
  );

UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(
      snapshot_json,
      '$.accessStatus', 'restricted',
      '$.accessNotes', 'Members only.',
      '$.audiences', json('["Members"]')
    )
WHERE id = 'cal_revision_9e560af1-ee2d-42cd-bdd7-7eb4f44a8b68'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.accessStatus') = 'unknown';

UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(
      snapshot_json,
      '$.occurrences[0].accessStatus', 'public',
      '$.occurrences[0].accessNotes', '',
      '$.occurrences[0].audiences', json('["Public"]'),
      '$.occurrences[1].accessStatus', 'public',
      '$.occurrences[1].accessNotes', '',
      '$.occurrences[1].audiences', json('["Public"]')
    ),
    change_set_json = json_set(
      change_set_json,
      '$[6].before[0].accessStatus', 'public',
      '$[6].before[0].accessNotes', '',
      '$[6].before[0].audiences', json('["Public"]'),
      '$[6].before[1].accessStatus', 'public',
      '$[6].before[1].accessNotes', '',
      '$[6].before[1].audiences', json('["Public"]'),
      '$[6].after[0].accessStatus', 'public',
      '$[6].after[0].accessNotes', '',
      '$[6].after[0].audiences', json('["Public"]'),
      '$[6].after[1].accessStatus', 'public',
      '$[6].after[1].accessNotes', '',
      '$[6].after[1].audiences', json('["Public"]')
    )
WHERE id = 'cal_revision_2512d18d-8bf3-4e1f-a873-2932bf21b2b7'
  AND revision_state = 'pending'
  AND json_extract(change_set_json, '$[6].field') = 'occurrences';

UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(
      snapshot_json,
      '$.occurrences[0].accessStatus', 'public',
      '$.occurrences[0].accessNotes', '',
      '$.occurrences[0].audiences', json('["Public"]'),
      '$.occurrences[1].accessStatus', 'public',
      '$.occurrences[1].accessNotes', '',
      '$.occurrences[1].audiences', json('["Public"]'),
      '$.occurrences[2].accessStatus', 'public',
      '$.occurrences[2].accessNotes', '',
      '$.occurrences[2].audiences', json('["Public"]'),
      '$.occurrences[3].accessStatus', 'public',
      '$.occurrences[3].accessNotes', '',
      '$.occurrences[3].audiences', json('["Public"]')
    )
WHERE id = 'cal_revision_553efdfb-af8d-482b-a4e4-40f1ed7d75c1'
  AND revision_state = 'pending';

UPDATE calendar_candidate_revisions AS revision
SET change_set_json = (
  SELECT COALESCE(json_group_array(json(item.value)), '[]')
  FROM json_each(revision.change_set_json) AS item
  WHERE json_extract(item.value, '$.field') NOT IN ('accessStatus', 'accessNotes', 'audiences')
)
WHERE revision_state = 'pending'
  AND json_valid(change_set_json)
  AND EXISTS (
    SELECT 1
    FROM json_each(revision.change_set_json) AS access_item
    WHERE json_extract(access_item.value, '$.field') IN ('accessStatus', 'accessNotes', 'audiences')
  )
  AND candidate_id NOT IN (
    'cal_candidate_4bf7f1c5-4d21-46bd-9dfb-8a62d5593fad',
    'cal_candidate_0312e180-79f2-414e-8500-193e1b2efdd9'
  );

-- These records were held only by the retired access-silence policy.
UPDATE calendar_candidates
SET status = CASE WHEN status = 'needs_verification' THEN 'candidate' ELSE status END,
    verification_state = 'verified',
    verification_notes = CASE id
      WHEN 'cal_candidate_2f9ddeac-65f3-4de6-8e53-18db1bf216b4'
        THEN 'The official venue, schedule, and event identity are established. No attendance restriction is stated, so access defaults to public.'
      WHEN 'cal_candidate_3132956f-c743-423f-bef1-6b1a93e93f91'
        THEN 'The parent event facts are confirmed. An RSVP is available but is not treated as an attendance restriction.'
      WHEN 'cal_candidate_6b3563b9-f541-4531-90ec-e6cf298d64e8'
        THEN 'The official event page confirms the schedule and the workshop affinity restriction.'
      ELSE verification_notes
    END,
    last_verified_at = datetime('now'),
    updated_at = datetime('now')
WHERE id IN (
  'cal_candidate_2f9ddeac-65f3-4de6-8e53-18db1bf216b4',
  'cal_candidate_3132956f-c743-423f-bef1-6b1a93e93f91',
  'cal_candidate_6b3563b9-f541-4531-90ec-e6cf298d64e8'
)
  AND (verification_state <> 'verified' OR status = 'needs_verification');

UPDATE calendar_candidate_occurrences
SET verification_state = 'verified',
    verification_notes = 'The official event page confirms the workshop schedule and its trans and gender-nonconforming affinity restriction.',
    updated_at = datetime('now')
WHERE id = 'cal_occurrence_32ea63ae-35d4-46c0-bc91-0cd72b5641dc'
  AND verification_state <> 'verified';

-- Keep pending update previews aligned with the corrected current workflow
-- state so reviewing an older proposal cannot revive an access-only hold.
UPDATE calendar_candidate_revisions AS revision
SET snapshot_json = json_set(
      snapshot_json,
      '$.verificationState', (
        SELECT candidate.verification_state
        FROM calendar_candidates AS candidate
        WHERE candidate.id = revision.candidate_id
      ),
      '$.verificationNotes', (
        SELECT candidate.verification_notes
        FROM calendar_candidates AS candidate
        WHERE candidate.id = revision.candidate_id
      )
    )
WHERE id IN (
    'cal_revision_f4e8442e-8c5e-4fa2-b0f5-b5ba77930d3e',
    'cal_revision_a91383c6-1d67-4609-8d57-6b99547842db',
    'cal_revision_2aaaf886-41e7-43cb-a02d-f90cf98d7842'
  )
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.verificationState') = 'needs_verification'
  AND EXISTS (
    SELECT 1
    FROM calendar_candidates AS candidate
    WHERE candidate.id = revision.candidate_id
      AND candidate.verification_state = 'verified'
  );

UPDATE calendar_candidate_revisions
SET snapshot_json = json_set(
      snapshot_json,
      '$.occurrences[0].verificationState', 'verified',
      '$.occurrences[0].verificationNotes', (
        SELECT occurrence.verification_notes
        FROM calendar_candidate_occurrences AS occurrence
        WHERE occurrence.id = 'cal_occurrence_32ea63ae-35d4-46c0-bc91-0cd72b5641dc'
      )
    )
WHERE id = 'cal_revision_2aaaf886-41e7-43cb-a02d-f90cf98d7842'
  AND revision_state = 'pending'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.occurrences[0].id') = 'cal_occurrence_32ea63ae-35d4-46c0-bc91-0cd72b5641dc'
  AND json_extract(snapshot_json, '$.occurrences[0].verificationState') = 'needs_verification';
