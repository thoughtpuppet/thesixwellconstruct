PRAGMA foreign_keys = ON;

-- Replace the former event identity everywhere it remains operational. The
-- canonical event row keeps its stable generated id so tickets, performer
-- requests, occurrences, CRM attendance, and Archive relationships stay
-- attached to the same event.
UPDATE events
SET slug = 'greenfield',
    title = 'GREEN[FIELD]',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug = 'cultandshift';

UPDATE archive_dossiers
SET archive_slug = 'greenfield',
    updated_by = 'migration-0204',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE archive_slug = 'cultandshift';

UPDATE construct_pathways
SET name = 'GREEN[FIELD]',
    route = '/events/greenfield/',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'path-events-01';

UPDATE construct_pathways
SET name = 'GREEN[FIELD] merch',
    route = '/merch/?filter=greenfield',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'path-merch-04';

UPDATE about_current_projects
SET slug = 'solehmans-new-year-greenfield',
    title = 'Solehman’s New Year + GREEN[FIELD]',
    summary = 'Solehman’s New Year is one four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing. GREEN[FIELD] holds community shows, performances, and shared experiments.',
    items_json = '[{"title":"Solehman’s New Year","description":"A four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing."},{"title":"GREEN[FIELD]","description":"Holds community shows, performances, and shared experiments."}]',
    links_json = '[{"label":"Solehman’s New Year","url":"/events/solehmans-new-year/"},{"label":"GREEN[FIELD]","url":"/events/greenfield/"}]',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'current-project-events';

UPDATE calendar_scout_profiles
SET scout_brief = replace(scout_brief, 'Cult.ATL', 'GREEN[FIELD]'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE instr(scout_brief, 'Cult.ATL') > 0;
