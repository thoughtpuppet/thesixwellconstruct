PRAGMA foreign_keys = ON;

-- LOOP's public Programming page is a Cargo shell around a BigTickets widget.
-- Keep one canonical direct source, teach it the widget/venue identity, and
-- retire the older homepage-only source that cannot enumerate events.
INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
SELECT
  'cal_source_loop_programming','LOOP ATL','https://loopatl.space/event-calendar',
  'official_html','official',1,24,'automatic','static',
  '{"platform":"bigtickets","widgetId":"A19618BA5655EF12DD160F42A1375CDE","maxChildren":20,"organizer":"LOOP","organizerUrl":"https://loopatl.space/","venueName":"LOOP","venueUrl":"https://loopatl.space/","venueAddress":"665 Marietta Street NW, Atlanta, GA 30313","city":"Atlanta","region":"GA"}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (
  SELECT 1 FROM calendar_sources
  WHERE lower(rtrim(url,'/'))='https://loopatl.space/event-calendar'
);

UPDATE calendar_sources
SET name='LOOP ATL',
    source_type='official_html',
    trust_level='official',
    enabled=1,
    adapter_key='automatic',
    render_mode='static',
    adapter_config_json='{"platform":"bigtickets","widgetId":"A19618BA5655EF12DD160F42A1375CDE","maxChildren":20,"organizer":"LOOP","organizerUrl":"https://loopatl.space/","venueName":"LOOP","venueUrl":"https://loopatl.space/","venueAddress":"665 Marietta Street NW, Atlanta, GA 30313","city":"Atlanta","region":"GA"}',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE lower(rtrim(url,'/'))='https://loopatl.space/event-calendar';

UPDATE calendar_sources
SET enabled=0,
    last_error='Replaced by the LOOP Programming calendar source.',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE lower(rtrim(url,'/'))='https://loopatl.space';

INSERT OR IGNORE INTO calendar_social_sources
  (id,platform,name,handle,profile_url,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_social_source_loop_atl','instagram','LOOP ATL','loop.atl','https://www.instagram.com/loop.atl/','official',1,24,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE calendar_social_sources
SET name='LOOP ATL',
    profile_url='https://www.instagram.com/loop.atl/',
    trust_level='official',
    enabled=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE platform='instagram' AND lower(handle)='loop.atl';

INSERT OR IGNORE INTO calendar_known_organizations
  (id,name,organization_type,aliases_json,official_domains_json,event_paths_json,trusted_ticket_domains_json,
   discovery_only_domains_json,venue_address,notes,enabled,created_at,updated_at)
VALUES
  ('cal_org_loop_atl','LOOP','venue','["LOOP ATL"]','["loopatl.space"]','["/event-calendar"]',
   '["bigtickets.com"]','[]','665 Marietta Street NW, Atlanta, GA 30313',
   'LOOP is a venue powered by Goat Farm. Its official Programming page embeds its authorized BigTickets listings.',1,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Repair run rows left open when an older Worker execution ended before its
-- final D1 update. Future executions are finalized by the Worker itself and
-- stale rows are still reaped defensively at the beginning of every run.
UPDATE calendar_scout_runs
SET status='failed',
    completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    failure_count=CASE WHEN failure_count<1 THEN 1 ELSE failure_count END,
    source_results_json=CASE
      WHEN COALESCE(source_results_json,'[]')='[]'
      THEN '[{"channel":"run_lifecycle","status":"failed","error":"The Worker ended before this Scout run recorded final diagnostics."}]'
      ELSE source_results_json
    END,
    error_message=CASE
      WHEN COALESCE(error_message,'')=''
      THEN 'The Worker ended before this Scout run recorded final diagnostics.'
      ELSE error_message
    END
WHERE status='running';
