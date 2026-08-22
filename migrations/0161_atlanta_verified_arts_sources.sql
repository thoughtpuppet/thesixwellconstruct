PRAGMA foreign_keys = ON;

-- Register the verified metro Atlanta arts-source batch. Twelve sources are
-- ready for routine monitoring. Four remain visible in Studio but disabled
-- until their calendars or geographic filtering are reliable enough to run.
-- The source registry is intentionally separate from publication: discoveries
-- still enter the private candidate queue and require Studio approval.

CREATE TABLE calendar_verified_arts_sources_stage (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  cadence_hours INTEGER NOT NULL,
  adapter_key TEXT NOT NULL,
  render_mode TEXT NOT NULL,
  adapter_config_json TEXT NOT NULL
);

INSERT INTO calendar_verified_arts_sources_stage
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json)
VALUES
  ('cal_source_carlos_calendar','Carlos Museum Programs','https://carlos.emory.edu/calendar','official_html','official',1,24,'automatic','static','{"organizer":"Michael C. Carlos Museum","organizerUrl":"https://carlos.emory.edu/","venueName":"Michael C. Carlos Museum","venueUrl":"https://carlos.emory.edu/","venueAddress":"571 South Kilgo Circle, Atlanta, GA 30322","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_roswell_arts_fund','Roswell Arts Fund','https://roswellartsfund.org/events/','official_html','official',1,24,'automatic','static','{"organizer":"Roswell Arts Fund","organizerUrl":"https://roswellartsfund.org/","city":"Roswell","region":"GA","perRunLimit":20}'),
  ('cal_source_roswell_fine_arts_alliance','Roswell Fine Arts Alliance','https://www.rfaa.org/','discovery','discovery',0,168,'automatic','static','{"organizer":"Roswell Fine Arts Alliance","organizerUrl":"https://www.rfaa.org/","city":"Roswell","region":"GA","perRunLimit":10}'),
  ('cal_source_arts_alpharetta','Arts Alpharetta Exhibitions','https://www.artsalpharetta.org/art-exhibitions.html','official_html','official',1,24,'automatic','static','{"organizer":"Arts Alpharetta","organizerUrl":"https://www.artsalpharetta.org/","city":"Alpharetta","region":"GA","perRunLimit":20}'),
  ('cal_source_the_art_center','The Art Center Exhibits','https://www.itstheartcenter.org/exhibits','official_html','official',1,24,'wix','static','{"organizer":"The Art Center","organizerUrl":"https://www.itstheartcenter.org/","venueName":"The Art Center","venueUrl":"https://www.itstheartcenter.org/","city":"Johns Creek","region":"GA","perRunLimit":20}'),
  ('cal_source_dalton_gallery','Dalton Gallery at Agnes Scott College','https://calendar.agnesscott.edu/dalton_gallery','official_html','official',0,168,'automatic','static','{"organizer":"Agnes Scott College","organizerUrl":"https://www.agnesscott.edu/","venueName":"Dalton Gallery","venueUrl":"https://calendar.agnesscott.edu/dalton_gallery","city":"Decatur","region":"GA","perRunLimit":20}'),
  ('cal_source_dashboard_upcoming','Dashboard Upcoming','https://www.dashboard.us/upcoming','official_html','official',1,24,'automatic','static','{"organizer":"Dashboard","organizerUrl":"https://www.dashboard.us/","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_marcia_wood','Marcia Wood Gallery','https://www.marciawoodgallery.com/exhibitions/current/','official_html','official',1,24,'automatic','static','{"organizer":"Marcia Wood Gallery","organizerUrl":"https://www.marciawoodgallery.com/","venueName":"Marcia Wood Gallery","venueUrl":"https://www.marciawoodgallery.com/","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_mason_fine_art','Mason Fine Art','https://masonfineartandevents.com/','official_html','official',1,24,'automatic','dynamic-fallback','{"organizer":"Mason Fine Art","organizerUrl":"https://masonfineartandevents.com/","venueName":"Mason Fine Art","venueUrl":"https://masonfineartandevents.com/","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_alan_avery','Alan Avery Art Company','https://www.alanaveryartcompany.com/upcoming-exhibitions','official_html','official',1,24,'wix','static','{"organizer":"Alan Avery Art Company","organizerUrl":"https://www.alanaveryartcompany.com/","venueName":"Alan Avery Art Company","venueUrl":"https://www.alanaveryartcompany.com/","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_vinson_art','The Sun ATL / VINSONart','https://vinsonart.com/exhibitions/','official_html','official',1,24,'automatic','static','{"organizer":"VINSONart","organizerUrl":"https://vinsonart.com/","venueName":"The Sun ATL","venueUrl":"https://vinsonart.com/the-sun-atl/","venueAddress":"399 Edgewood Avenue SE, Atlanta, GA 30312","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_south_arts_events','South Arts Events','https://www.southarts.org/events','discovery','discovery',0,168,'automatic','static','{"organizer":"South Arts","organizerUrl":"https://www.southarts.org/","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_atlanta_printmakers','Atlanta Printmakers Studio Events','https://www.atlantaprintmakersstudio.org/new-events-1','official_html','official',1,24,'automatic','static','{"internalAdapter":"squarespace","organizer":"Atlanta Printmakers Studio","organizerUrl":"https://www.atlantaprintmakersstudio.org/","venueName":"Atlanta Printmakers Studio","venueUrl":"https://www.atlantaprintmakersstudio.org/","city":"Hapeville","region":"GA","perRunLimit":20}'),
  ('cal_source_papermaking_museum','Robert C. Williams Museum of Papermaking','https://paper.gatech.edu/upcoming-exhibits','official_html','official',1,24,'automatic','static','{"organizer":"Robert C. Williams Museum of Papermaking","organizerUrl":"https://paper.gatech.edu/museum","venueName":"Robert C. Williams Museum of Papermaking","venueUrl":"https://paper.gatech.edu/museum","city":"Atlanta","region":"GA","perRunLimit":20}'),
  ('cal_source_september_gray','September Gray Fine Art Gallery','https://septembergrayart.com/exhibitions','discovery','discovery',0,168,'automatic','static','{"organizer":"September Gray Fine Art Gallery","organizerUrl":"https://septembergrayart.com/","venueName":"September Gray Fine Art Gallery","venueUrl":"https://septembergrayart.com/","city":"Atlanta","region":"GA","perRunLimit":10}'),
  ('cal_source_serenbe_events','Serenbe Arts and Culture Events','https://www.serenbe.com/events','official_html','official',1,24,'automatic','dynamic-fallback','{"organizer":"Serenbe Institute for Art, Culture and the Environment","organizerUrl":"https://www.serenbe.com/arts-culture","city":"Chattahoochee Hills","region":"GA","perRunLimit":20}');

-- Reuse a source that already has the same id or normalized URL. This keeps
-- production history and candidate references intact while applying the newly
-- verified name, authority, schedule, and adapter configuration.
UPDATE calendar_sources
SET name=(SELECT s.name FROM calendar_verified_arts_sources_stage s
          WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    url=(SELECT s.url FROM calendar_verified_arts_sources_stage s
         WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    source_type=(SELECT s.source_type FROM calendar_verified_arts_sources_stage s
                 WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    trust_level=(SELECT s.trust_level FROM calendar_verified_arts_sources_stage s
                 WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    enabled=(SELECT s.enabled FROM calendar_verified_arts_sources_stage s
             WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    cadence_hours=(SELECT s.cadence_hours FROM calendar_verified_arts_sources_stage s
                   WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    adapter_key=(SELECT s.adapter_key FROM calendar_verified_arts_sources_stage s
                 WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    render_mode=(SELECT s.render_mode FROM calendar_verified_arts_sources_stage s
                 WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    adapter_config_json=(SELECT s.adapter_config_json FROM calendar_verified_arts_sources_stage s
                         WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/')) LIMIT 1),
    last_error='',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE EXISTS (
  SELECT 1 FROM calendar_verified_arts_sources_stage s
  WHERE s.id=calendar_sources.id OR lower(rtrim(s.url,'/'))=lower(rtrim(calendar_sources.url,'/'))
);

INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
SELECT s.id,s.name,s.url,s.source_type,s.trust_level,s.enabled,s.cadence_hours,
       s.adapter_key,s.render_mode,s.adapter_config_json,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM calendar_verified_arts_sources_stage s
WHERE NOT EXISTS (SELECT 1 FROM calendar_sources existing WHERE existing.id=s.id)
  AND NOT EXISTS (
    SELECT 1 FROM calendar_sources existing
    WHERE lower(rtrim(existing.url,'/'))=lower(rtrim(s.url,'/'))
  );

DROP TABLE calendar_verified_arts_sources_stage;

-- Known-organization records give source resolution an official-domain and
-- event-path map even when an organizer has no separate ticketing website.
INSERT INTO calendar_known_organizations
  (id,name,organization_type,aliases_json,official_domains_json,event_paths_json,trusted_ticket_domains_json,
   discovery_only_domains_json,venue_address,notes,enabled,created_at,updated_at)
VALUES
  ('cal_org_carlos_museum','Michael C. Carlos Museum','venue','["Carlos Museum"]','["carlos.emory.edu"]','["/calendar","/exhibitions"]','[]','[]','571 South Kilgo Circle, Atlanta, GA 30322','Official museum calendar and exhibition listings.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_roswell_arts_fund','Roswell Arts Fund','organizer','[]','["roswellartsfund.org"]','["/events/"]','[]','[]','','Official public-art nonprofit calendar.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_roswell_fine_arts_alliance','Roswell Fine Arts Alliance','both','["RFAA"]','["rfaa.org"]','["/"]','[]','[]','','Official gallery site; its registered source remains disabled until stable event-detail pages are available.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_arts_alpharetta','Arts Alpharetta','organizer','[]','["artsalpharetta.org"]','["/art-exhibitions.html"]','[]','[]','','Official community arts organization exhibition schedule.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_the_art_center','The Art Center','both','["Johns Creek Arts Center"]','["itstheartcenter.org"]','["/exhibits"]','[]','[]','','Formerly Johns Creek Arts Center; official exhibition and reception listings.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_dalton_gallery','Dalton Gallery at Agnes Scott College','venue','["Dalton Gallery"]','["agnesscott.edu","calendar.agnesscott.edu"]','["/dalton_gallery"]','[]','[]','','Official college gallery calendar; its source remains disabled while no upcoming events are listed.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_dashboard','Dashboard','organizer','["Dashboard US"]','["dashboard.us"]','["/upcoming"]','[]','[]','','Official artist-led public-art organization listings.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_marcia_wood','Marcia Wood Gallery','venue','[]','["marciawoodgallery.com"]','["/exhibitions/current/"]','[]','[]','','Official current-exhibitions listing.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_mason_fine_art','Mason Fine Art','venue','["Mason Fine Art and Events"]','["masonfineartandevents.com"]','["/"]','[]','[]','','Official gallery program; private venue-rental listings are not event candidates.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_alan_avery','Alan Avery Art Company','venue','["Alan Avery Art"]','["alanaveryartcompany.com"]','["/upcoming-exhibitions"]','[]','[]','','Official exhibition, reception, and artist-talk listing.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_vinson_art','VINSONart / The Sun ATL','both','["VINSONart","The Sun ATL","Different Trains"]','["vinsonart.com"]','["/exhibitions/","/the-sun-atl/"]','[]','[]','399 Edgewood Avenue SE, Atlanta, GA 30312','VINSONart is the canonical official program site for The Sun ATL.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_south_arts','South Arts','organizer','[]','["southarts.org"]','["/events"]','[]','[]','','Regional arts organization; its source remains disabled until Atlanta-only filtering is reliable.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_atlanta_printmakers','Atlanta Printmakers Studio','both','["APS"]','["atlantaprintmakersstudio.org"]','["/new-events-1"]','[]','[]','','Official printmaking exhibitions, receptions, workshops, and events calendar.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_papermaking_museum','Robert C. Williams Museum of Papermaking','venue','["Museum of Papermaking"]','["paper.gatech.edu"]','["/upcoming-exhibits","/museum"]','[]','[]','','Official museum exhibition pages.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_september_gray','September Gray Fine Art Gallery','venue','["September Gray Fine Art"]','["septembergrayart.com"]','["/exhibitions"]','[]','[]','','Official gallery identity; its source remains disabled while dated detail coverage is inconsistent.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_org_serenbe_institute','Serenbe Institute for Art, Culture and the Environment','organizer','["Serenbe Arts and Culture","Serenbe Institute"]','["serenbe.com"]','["/events","/arts-culture"]','[]','[]','','Official multidisciplinary event listing; Scout relevance filtering still applies.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  organization_type=excluded.organization_type,
  aliases_json=excluded.aliases_json,
  official_domains_json=excluded.official_domains_json,
  event_paths_json=excluded.event_paths_json,
  trusted_ticket_domains_json=excluded.trusted_ticket_domains_json,
  discovery_only_domains_json=excluded.discovery_only_domains_json,
  venue_address=excluded.venue_address,
  notes=excluded.notes,
  enabled=excluded.enabled,
  updated_at=excluded.updated_at;
