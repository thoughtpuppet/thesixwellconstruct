PRAGMA foreign_keys = ON;

-- Georgia State uses Localist for its university calendar. Keep each academic
-- unit as its own source so Studio can measure acceptance and failures by
-- department while the parser retains Localist's parent-event identity.
INSERT OR IGNORE INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_source_gsu_anthropology','GSU Anthropology','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8664','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_arctic','GSU Advanced Research Computing Technology and Innovation Core','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=36298743501220','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_college_arts','GSU College of the Arts','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=49950248654830','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_computer_science','GSU Computer Science','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8669','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_cmii','GSU Creative Media Industries Institute','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=9310','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_welch_art','GSU Ernest G. Welch School of Art and Design','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=52826512416956','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_fine_arts_perimeter','GSU Perimeter College Fine Arts','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=12106','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_geosciences','GSU Geosciences','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8671','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_neuroscience','GSU Neuroscience','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8676','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_philosophy','GSU Philosophy','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8677','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_physics','GSU Physics and Astronomy','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=8679','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_technology','GSU Technology','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=10943','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_exlab','GSU EXLAB Makerspace','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=13511','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_iit','GSU Instructional Innovation and Technology','https://calendar.gsu.edu/api/2/events?days=365&pp=50&group_id=53107647756805','json','official',1,24,datetime('now'),datetime('now')),
  ('cal_source_gsu_engineering_search','GSU Engineering Event Search','https://calendar.gsu.edu/api/2/events/search?days=365&pp=50&search=engineering','json','official',1,24,datetime('now'),datetime('now'));

UPDATE calendar_scout_profiles
SET weighted_subjects_json=json_set(weighted_subjects_json,
      '$.anthropology',0.85,'$.engineering',0.9,'$.philosophy',0.85),
    updated_at=datetime('now')
WHERE id='atlanta-default';

UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','engineering')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='engineering');
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','makerspace')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='makerspace');
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','robotics')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='robotics');
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','visual anthropology')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='visual anthropology');
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','technology ethics')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='technology ethics');
UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','aesthetics')
WHERE id='atlanta-default'
  AND NOT EXISTS (SELECT 1 FROM json_each(positive_concepts_json) WHERE lower(value)='aesthetics');

-- Initial private review records. Approval remains an explicit Studio action.
INSERT OR IGNORE INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,first_seen_at,last_verified_at,created_at,updated_at)
VALUES
  ('cal_candidate_gsu_mlsp_2026','cal_source_gsu_computer_science','gsu-mlsp-2026',
   'https://calendar.gsu.edu/event/36th-annual-ieee-workshop-on-machine-learning-for-signal-processing-ieee-mlsp-2026',
   'https://mlsp26.ieeesps.org/','36th Annual IEEE Workshop on Machine Learning for Signal Processing (MLSP 2026)',
   'Georgia State University Computer Science; IEEE Signal Processing Society',
   'A four-day workshop on machine learning for signal processing, including generative and foundation models, multimodal systems, agentic methods, and responsible and federated intelligence.',
   'date_range','2026-09-28','2026-10-01','America/New_York','Centennial Hall',
   '100 Auburn Avenue NE, Atlanta, GA 30303','Atlanta','GA','["technology","ai","engineering"]','["conference","workshop"]',0,
   'candidate','verified','Dates, venue, program scope, and event links confirmed on the official Georgia State University calendar and IEEE workshop site.',
   0.98,'seed','source_monitor',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_gsu_neurogenomics_forum_2026','cal_source_gsu_neuroscience','gsu-2ci-neurogenomics-summer-forum-9516',
   'https://calendar.gsu.edu/event/2ci-neurogenomics-summer-forum-9516','','2CI Neurogenomics Summer Forum',
   'Georgia State University Neuroscience; Computer Science; Psychology; Biology',
   'A research forum integrating neurogenomic pathways, functional connectivity, and psychiatric disorders.',
   'timed','2026-08-18T10:00:00-04:00','2026-08-18T11:00:00-04:00','America/New_York','Parker H. Petit Science Center, Room 171',
   '100 Piedmont Avenue SE, Atlanta, GA 30303','Atlanta','GA','["technology","ai"]','["lecture-talk"]',0,
   'needs_verification','needs_verification','Facts are confirmed on the official GSU page, but its listed audience is faculty, staff, students, graduate students, and postdocs rather than Public. Confirm access before publication.',
   0.9,'seed','source_monitor',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now')),
  ('cal_candidate_gsu_nathanael_smith_trio_2026','cal_source_gsu_college_arts','gsu-sept-feed-your-senses-2026',
   'https://calendar.gsu.edu/event/sept-feed-your-senses','','Feed Your Senses: Lunchtime Concert with the Nathanael Smith Trio',
   'Georgia State University Rialto Center for the Arts',
   'A free public lunchtime concert featuring the Nathanael Smith Trio at the Rialto Center for the Arts.',
   'timed','2026-09-09T12:00:00-04:00','2026-09-09T13:00:00-04:00','America/New_York','Rialto Center for the Arts',
   '80 Forsyth Street NW, Atlanta, GA 30303','Atlanta','GA','["poetry-music"]','["performance"]',0,
   'candidate','verified','Date, time, venue, free admission, and public access confirmed on the official Georgia State University calendar.',
   0.96,'seed','source_monitor',datetime('now'),'2026-08-17T00:00:00-04:00',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO calendar_candidate_notes
  (candidate_id,private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes,updated_at)
VALUES
  ('cal_candidate_gsu_mlsp_2026','Strong technical depth in machine learning, signal processing, multimodal work, and responsible AI.','Attend selected sessions and review presenters.','Track methods and speakers that could inform creative-technology experiments, talks, or collaborations.','GSU Computer Science; IEEE Signal Processing Society; workshop presenters.','Private GSU scout record. Verify registration access and individual session schedule before approval.',datetime('now')),
  ('cal_candidate_gsu_neurogenomics_forum_2026','Connects computation, neuroscience, genomics, and interpretation across disciplines.','Research first; attendance eligibility is not confirmed.','Review how complex research is translated across departments.','GSU Neuroscience; Computer Science; Psychology; Biology.','Do not publish until public access is confirmed.',datetime('now')),
  ('cal_candidate_gsu_nathanael_smith_trio_2026','A public GSU music program that adds an accessible performance lane to the calendar.','Attend if the artist or format is of interest.','Observe the concise lunchtime format and public-university arts programming.','Rialto Center for the Arts; Nathanael Smith Trio.','Private GSU scout record.',datetime('now'));

INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at)
SELECT
  'cal_revision_seed_'||id,id,1,'pending',
  json_object('title',title,'organizer',organizer,'description',factual_description,'dateKind',date_kind,
    'startsAt',starts_at,'endsAt',ends_at,'timezone',timezone,'venueName',venue_name,
    'venueAddress',venue_address,'subjects',json(subjects_json),'formats',json(formats_json),
    'sourceUrl',source_url,'ticketUrl',ticket_url),
  json_array(json_object('url',source_url,'sourceId',source_id,'verifiedAt',last_verified_at)),
  'Initial GSU candidate import','migration-0133',datetime('now')
FROM calendar_candidates
WHERE id IN ('cal_candidate_gsu_mlsp_2026','cal_candidate_gsu_neurogenomics_forum_2026','cal_candidate_gsu_nathanael_smith_trio_2026');

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_seed_'||id
WHERE id IN ('cal_candidate_gsu_mlsp_2026','cal_candidate_gsu_neurogenomics_forum_2026','cal_candidate_gsu_nathanael_smith_trio_2026')
  AND pending_revision_id='';
