-- Every Atlanta Calendar event and related occurrence participates in Night
-- Planning by default. Timing, verification, address, and schedule state still
-- determine whether a record is ready to route on a particular day.
UPDATE calendar_candidates SET planning_eligible=1;
UPDATE calendar_entries SET planning_eligible=1;
UPDATE calendar_candidate_occurrences SET planning_eligible=1;
UPDATE calendar_entry_occurrences SET planning_eligible=1;

-- An occurrence with no explicit access decision inherits its reviewed parent
-- event access. Explicit occurrence restrictions remain untouched.
UPDATE calendar_candidate_occurrences
SET access_status=(
      SELECT c.access_status FROM calendar_candidates c
      WHERE c.id=calendar_candidate_occurrences.candidate_id
    ),
    access_notes=CASE
      WHEN access_notes='' OR access_notes='Attendance eligibility has not been confirmed.' THEN COALESCE((
        SELECT c.access_notes FROM calendar_candidates c
        WHERE c.id=calendar_candidate_occurrences.candidate_id
      ),'')
      ELSE access_notes
    END,
    audiences_json=CASE
      WHEN json_valid(audiences_json) AND json_array_length(audiences_json)>0 THEN audiences_json
      ELSE COALESCE((
        SELECT c.audiences_json FROM calendar_candidates c
        WHERE c.id=calendar_candidate_occurrences.candidate_id
      ),'[]')
    END
WHERE access_status='unknown'
  AND EXISTS (
    SELECT 1 FROM calendar_candidates c
    WHERE c.id=calendar_candidate_occurrences.candidate_id
      AND c.access_status IN ('public','restricted')
  );

UPDATE calendar_entry_occurrences
SET access_status=(
      SELECT e.access_status FROM calendar_entries e
      WHERE e.id=calendar_entry_occurrences.entry_id
    ),
    access_notes=CASE
      WHEN access_notes='' OR access_notes='Attendance eligibility has not been confirmed.' THEN COALESCE((
        SELECT e.access_notes FROM calendar_entries e
        WHERE e.id=calendar_entry_occurrences.entry_id
      ),'')
      ELSE access_notes
    END,
    audiences_json=CASE
      WHEN json_valid(audiences_json) AND json_array_length(audiences_json)>0 THEN audiences_json
      ELSE COALESCE((
        SELECT e.audiences_json FROM calendar_entries e
        WHERE e.id=calendar_entry_occurrences.entry_id
      ),'[]')
    END
WHERE access_status='unknown'
  AND EXISTS (
    SELECT 1 FROM calendar_entries e
    WHERE e.id=calendar_entry_occurrences.entry_id
      AND e.access_status IN ('public','restricted')
  );

UPDATE calendar_candidates
SET access_notes=''
WHERE access_status='public'
  AND access_notes='Attendance eligibility has not been confirmed.';

UPDATE calendar_entries
SET access_notes=''
WHERE access_status='public'
  AND access_notes='Attendance eligibility has not been confirmed.';

-- Correct the flyer-derived ZIP typo on the PHOSPHENES record and its schedule.
UPDATE calendar_candidates
SET venue_address=replace(venue_address,'303130','30313')
WHERE id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d';

UPDATE calendar_candidate_occurrences
SET venue_address=replace(venue_address,'303130','30313')
WHERE candidate_id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d';
