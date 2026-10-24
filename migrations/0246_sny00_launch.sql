-- Authorized SNY00 launch, 2026-10-24. Zero capacity means unlimited, as in
-- the shared Events system. Keep the occurrence identity and existing RSVPs.
UPDATE events SET
  description='An edition of Solehman’s New Year.',
  starts_at='2026-11-06T18:30:00-05:00',
  ends_at='2026-11-06T21:00:00-05:00',
  location='364 Nelson Street SW, Suite 12, Atlanta, GA 30313',
  capacity=0,max_seats_per_order=3,status='open',publication_state='published',
  included='You are welcome to bring your own drawing or art-making materials if you would like.',
  arrival_notes='Please arrive promptly at 6:30 PM so you can participate in all the events. If you need help getting into the building, call 770-820-5800. You may park on the street alongside the building. A free gravel parking lot is also available at the very end of Mangum Street, the street adjacent to the building. Continue to the end of Mangum Street; the lot will be on your left.',
  contact_note='For entry help, RSVP changes, or cancellations, call 770-820-5800.',
  cancellation_policy='For RSVP changes or cancellations, call 770-820-5800.',
  updated_at=datetime('now')
WHERE id='evt_sny_00' AND slug='sny-00' AND private_rsvp_enabled=1;

UPDATE event_occurrences SET
  starts_at='2026-11-06T18:30:00-05:00',ends_at='2026-11-06T21:00:00-05:00',
  location='364 Nelson Street SW, Suite 12, Atlanta, GA 30313',
  capacity=0,max_seats_per_order=3,status='open',updated_at=datetime('now')
WHERE event_id='evt_sny_00' AND id='occ_sny_00_2026_11_06';

UPDATE content_entities SET visibility='public',search_visibility=1,
  public_at=COALESCE(public_at,datetime('now')),updated_by='sny00-launch',updated_at=datetime('now')
WHERE id='evt_sny_00';

-- Keep technical provenance private; publish the intentionally supplied
-- documentarian relationship when revealing its parent event.
UPDATE entity_relationships SET public_visible=1,updated_at=datetime('now')
WHERE source_entity_id='evt_sny_00' AND target_entity_id='person-tyrone-hawk'
  AND relationship_type_id='rel-documented-by';

INSERT INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
SELECT 'revision-sny00-launch-tyrone-link','person-tyrone-hawk',COALESCE(MAX(revision_number),0)+1,
  'sny00-link-correction','{"url":"/sny-00"}','{"url":"/events/sny-00/"}','studio',datetime('now')
FROM entity_revisions
WHERE entity_id='person-tyrone-hawk'
HAVING EXISTS (SELECT 1 FROM collaborator_links WHERE entity_id='person-tyrone-hawk' AND url='/sny-00')
ON CONFLICT(id) DO NOTHING;

UPDATE collaborator_links SET url='/events/sny-00/'
WHERE entity_id='person-tyrone-hawk' AND url='/sny-00';

INSERT INTO site_visibility_rules(path,visibility,scope,updated_by,updated_at)
VALUES('/events/sny-00','public','descendants','sny00-launch',datetime('now'))
ON CONFLICT(path) DO UPDATE SET visibility=excluded.visibility,scope=excluded.scope,
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;
