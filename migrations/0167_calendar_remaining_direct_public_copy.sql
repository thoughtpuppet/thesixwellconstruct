-- Complete the production cleanup after the live public API audit found three
-- older source-narrating strings outside the initial 0166 inventory.
UPDATE calendar_candidates
SET factual_description='PHOSPHENES is a solo exhibition by painter Timothy Hunter at Old Rabbit Gallery. The exhibition program includes a Melee Tournament, Artist Talk, Music Mixer, The Science of Art, Dance + Draw, and Studio Visits. The exhibition comprises paintings informed by bullvalene research, contemporary dance, and phosphenes—the internally generated visual phenomena referenced by the title. The work explores transformation and continuity: forms rearrange while retaining identity, echoed through recurring contours, folded figures, layered custom-mixed paint, and deliberate treatment of light. Hunter is both a painter and a Georgia Tech doctoral candidate in organic chemistry whose bullvalene research informs the exhibition.',
    updated_at=datetime('now')
WHERE id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d';

UPDATE calendar_entries
SET factual_description='PHOSPHENES is a solo exhibition by painter Timothy Hunter at Old Rabbit Gallery. The exhibition program includes a Melee Tournament, Artist Talk, Music Mixer, The Science of Art, Dance + Draw, and Studio Visits. The exhibition comprises paintings informed by bullvalene research, contemporary dance, and phosphenes—the internally generated visual phenomena referenced by the title. The work explores transformation and continuity: forms rearrange while retaining identity, echoed through recurring contours, folded figures, layered custom-mixed paint, and deliberate treatment of light. Hunter is both a painter and a Georgia Tech doctoral candidate in organic chemistry whose bullvalene research informs the exhibition.',
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE candidate_id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d';

UPDATE calendar_candidate_occurrences
SET factual_description='A Thursday ATLWKNDR program. Individual advance tickets are scheduled to go on sale; the venue has not been announced.',
    access_notes='Ages 21 and older; no separate eligibility exception has been announced for LOVESEXY.',
    ticket_notes='Advance tickets are scheduled to go on sale.',
    updated_at=datetime('now')
WHERE id='cal_occurrence_3f807c90-65fb-40bf-86fa-33ad8c30237c';

UPDATE calendar_entry_occurrences
SET factual_description='A Thursday ATLWKNDR program. Individual advance tickets are scheduled to go on sale; the venue has not been announced.',
    access_notes='Ages 21 and older; no separate eligibility exception has been announced for LOVESEXY.',
    ticket_notes='Advance tickets are scheduled to go on sale.',
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE candidate_occurrence_id='cal_occurrence_3f807c90-65fb-40bf-86fa-33ad8c30237c';
