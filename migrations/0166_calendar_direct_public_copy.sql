-- Public calendar copy states event facts directly. Source and verification
-- narration remains private in resolution notes, verification notes, evidence,
-- citations, and Scout diagnostics.
CREATE TABLE calendar_direct_public_copy_0166 (
  candidate_id TEXT PRIMARY KEY,
  factual_description TEXT,
  access_notes TEXT,
  ticket_notes TEXT,
  planning_notes TEXT
);

INSERT INTO calendar_direct_public_copy_0166
  (candidate_id,factual_description,access_notes,ticket_notes,planning_notes)
VALUES
  ('cal_candidate_a73be8bf-c576-45b6-9e31-610609d510ed',NULL,'Free and open to all ages; VIP areas are limited to ages 21 and older.','Free admission; advance-registration requirements have not been confirmed.',NULL),
  ('cal_candidate_1aa65823-ccd3-4b7f-b7be-c93c13d8e611',NULL,'Free and open to the public.','No tickets are required.',NULL),
  ('cal_candidate_eyedrum_akchamel',NULL,NULL,'Tickets are available.',NULL),
  ('cal_candidate_16957f6b-3825-4f8e-a5c3-78477563e172',NULL,'Open to the public; admission or registration requirements may apply.',NULL,NULL),
  ('cal_candidate_fall_2026_amy_sherald',NULL,'Timed admission is $28.50 for the general public and free for members.','Timed exhibition admission is available.',NULL),
  ('cal_candidate_fall_2026_anamnesis',NULL,'Current museum admission applies.','Admission details have not been confirmed.',NULL),
  ('cal_candidate_1caa7c1b-8ec8-494f-a770-c90f19dda9d3',NULL,'Open to all regardless of sexual orientation, gender, or race.','Party passes cover selected events; all sales are final. Brunches, luncheons, and dinners are excluded.',NULL),
  ('cal_candidate_404bfa15-77b7-48eb-ac21-ec10a631bacd',NULL,'General-public eligibility has not been confirmed.','No ticket or registration requirement has been announced.',NULL),
  ('cal_candidate_fall_2026_bitchin_bajas',NULL,NULL,'Tickets are available through Big Tickets.',NULL),
  ('cal_candidate_eyedrum_bryan_day',NULL,'Open to the public; admission details have not been announced.','Admission details have not been announced.',NULL),
  ('cal_candidate_fall_2026_compassion',NULL,'Current museum admission applies.','Admission details have not been confirmed.',NULL),
  ('cal_candidate_fall_2026_cortex_adrian_younge_jrocc',NULL,NULL,'Tickets are available through Big Tickets.',NULL),
  ('cal_candidate_fall_2026_creative_futures',NULL,NULL,'Registration is available.',NULL),
  ('cal_candidate_plaza_faust_nebulous_2026',NULL,NULL,'$25 tickets are on sale.',NULL),
  ('cal_candidate_plaza_film_love_milestones_2026',NULL,NULL,'Tickets are available.',NULL),
  ('cal_candidate_be67426e-978d-454b-8b19-bfb89a40ad88',NULL,'Guest ticket ordering is available; general-public eligibility has not been explicitly confirmed.','Priced guest tickets are available.',NULL),
  ('cal_candidate_9a17b814-ed87-408d-894f-a6700bb49764',NULL,'Guest ticket ordering is available; general-public eligibility has not been explicitly confirmed.','Priced guest tickets are available.',NULL),
  ('cal_candidate_12be1cee-848f-4693-afa8-bdc363447a30',NULL,'Guest ticket ordering is available; general-public eligibility has not been explicitly confirmed.','A $35 VIP ticket and guest ordering are available.',NULL),
  ('cal_candidate_plaza_lockjaw_2026',NULL,NULL,'Tickets are available.',NULL),
  ('cal_candidate_fall_2026_los_porfiados',NULL,'Current museum admission conditions apply.','No separate ticket requirement has been announced for the Piazza installation.',NULL),
  ('cal_candidate_adama_mending_to_preserve_2026',NULL,NULL,'No ticket requirement has been announced.',NULL),
  ('cal_candidate_gulch_on_art_music',NULL,'Public, ticketed event. High Museum members: $20; general admission: $30.',NULL,NULL),
  ('cal_candidate_f0be46cb-c703-4b2d-8d70-3695b90d04ca',NULL,'Open to the public; admission or registration requirements may apply.',NULL,NULL),
  ('cal_candidate_42aa8c04-d2e2-44a4-b328-143356771ed2',NULL,NULL,'RSVP by September 9, 2026.',NULL),
  ('cal_candidate_fall_2026_square_foot_fiber',NULL,'Public exhibition; admission requirements have not been confirmed.',NULL,NULL),
  ('cal_candidate_8d4a89fa-f082-4eb8-9660-ec9ca2f0bbf2','A five-day Atlanta festival of soul, house, Afro, and related music programming. Guest artists include Joe Claussell, Ian Friday, Ash Lauryn, Kim Lightfoot, Beloved, and Ramon Rawsoul; individual events and venues are announced separately.','Ages 21 and older, except Sunday''s House in the Park program, which is open to all ages.','Festival passes are limited and available. Individual Thursday tickets are scheduled to go on sale separately.',NULL),
  ('cal_candidate_936267c5-6dfe-497b-a413-d10f3e89fd6f',NULL,NULL,'Registration is required; capacity and the registration deadline have not been announced.',NULL),
  ('cal_candidate_fall_2026_tending_the_wild','Gestural paintings consider care, control, growth, softness, structure, and the tension between tending and allowing forms to unfold. Opens September 12 at 5 PM and closes October 11.',NULL,NULL,NULL),
  ('cal_candidate_fall_2026_grace_for_ebb',NULL,NULL,'RSVP is available.',NULL),
  ('cal_candidate_gulch_we_hold_truths',NULL,'Advance registration is available for each conversation.',NULL,NULL);

UPDATE calendar_candidates
SET factual_description=COALESCE((SELECT factual_description FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_candidates.id),factual_description),
    access_notes=COALESCE((SELECT access_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_candidates.id),access_notes),
    ticket_notes=COALESCE((SELECT ticket_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_candidates.id),ticket_notes),
    planning_notes=COALESCE((SELECT planning_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_candidates.id),planning_notes),
    updated_at=datetime('now')
WHERE id IN (SELECT candidate_id FROM calendar_direct_public_copy_0166);

UPDATE calendar_entries
SET factual_description=COALESCE((SELECT factual_description FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_entries.candidate_id),factual_description),
    access_notes=COALESCE((SELECT access_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_entries.candidate_id),access_notes),
    ticket_notes=COALESCE((SELECT ticket_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_entries.candidate_id),ticket_notes),
    planning_notes=COALESCE((SELECT planning_notes FROM calendar_direct_public_copy_0166 m WHERE m.candidate_id=calendar_entries.candidate_id),planning_notes),
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE candidate_id IN (SELECT candidate_id FROM calendar_direct_public_copy_0166);

UPDATE calendar_candidate_occurrences
SET access_notes='Contact Timmy Hunter, Stretch, or @billystonecipher for off-hours inquiries.',
    updated_at=datetime('now')
WHERE candidate_id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d'
  AND lower(access_notes) LIKE '%caption says%';

UPDATE calendar_entry_occurrences
SET access_notes='Contact Timmy Hunter, Stretch, or @billystonecipher for off-hours inquiries.',
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE entry_id IN (
    SELECT id FROM calendar_entries
    WHERE candidate_id='cal_candidate_71f76353-0208-42b9-90db-3aa1203d737d'
  )
  AND lower(access_notes) LIKE '%caption says%';

UPDATE calendar_candidate_occurrences
SET access_notes=replace(
      access_notes,
      'Registration is available on the official conversation page.',
      'Advance registration is available.'
    ),
    updated_at=datetime('now')
WHERE candidate_id='cal_candidate_gulch_we_hold_truths'
  AND access_notes LIKE '%official conversation page%';

UPDATE calendar_entry_occurrences
SET access_notes=replace(
      access_notes,
      'Registration is available on the official conversation page.',
      'Advance registration is available.'
    ),
    sequence=sequence+1,
    last_modified_at=datetime('now')
WHERE entry_id IN (
    SELECT id FROM calendar_entries
    WHERE candidate_id='cal_candidate_gulch_we_hold_truths'
  )
  AND access_notes LIKE '%official conversation page%';

DROP TABLE calendar_direct_public_copy_0166;
