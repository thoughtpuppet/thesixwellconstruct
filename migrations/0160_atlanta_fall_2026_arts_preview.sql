PRAGMA foreign_keys = ON;

-- Import the August 21 ARTS ATL Fall 2026 art-and-design crawl into the
-- private Atlanta Calendar review workflow. This migration never inserts or
-- updates calendar_entries. Existing public records receive a pending Studio
-- revision only where the brief supplies a materially better canonical source.
--
-- Forward Warrior is intentionally absent from every staging table and DML
-- statement at the user's request. Its existing candidate and source remain
-- exactly as they were before this migration.

CREATE TABLE calendar_fall_2026_sources_stage (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  cadence_hours INTEGER NOT NULL,
  render_mode TEXT NOT NULL,
  adapter_config_json TEXT NOT NULL
);

INSERT INTO calendar_fall_2026_sources_stage
  (id,name,url,source_type,trust_level,enabled,cadence_hours,render_mode,adapter_config_json)
VALUES
  ('cal_source_artsatl_art_design','ARTS ATL Art + Design','https://www.artsatl.org/category/art-design/','discovery','discovery',1,24,'static','{}'),
  ('cal_source_artsatl_fall_preview','ARTS ATL Fall Arts Previews','https://www.artsatl.org/tag/fall-arts-preview/','discovery','discovery',1,168,'static','{}'),
  ('cal_source_atlanta_art_fair_official','Atlanta Art Fair','https://theatlantaartfair.com/','official_html','official',1,24,'dynamic-fallback','{}'),
  ('cal_source_atlanta_art_fair_tickets','Atlanta Art Fair Tickets','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','official_html','official',1,12,'dynamic-fallback','{}'),
  ('cal_source_goat_farm','Goat Farm Arts Programming','https://www.thegoatfarm.info/','official_html','official',1,12,'static','{}'),
  ('cal_source_atlanta_design_festival','Atlanta Design Festival','https://atlantadesignfestival.net/visit/','official_html','official',1,24,'static','{}'),
  ('cal_source_beltline_art','Atlanta Beltline Art','https://beltline.org/art/','official_html','official',1,24,'dynamic-fallback','{}'),
  ('cal_source_beltline_events','Atlanta Beltline Events','https://beltline.org/events/','official_html','official',1,24,'dynamic-fallback','{}'),
  ('cal_source_glo_events','glo','https://www.gloplatform.org/events/','official_html','official',1,24,'static','{}'),
  ('cal_source_weird_gone_pro','Chantelle Rytter / Weird Gone Pro','https://www.weirdgonepro.com/whats-on','official_html','official',1,24,'dynamic-fallback','{}'),
  ('cal_source_high_exhibitions','High Museum Exhibitions','https://high.org/exhibitions/','official_html','official',1,24,'static','{}'),
  ('cal_source_vinson_art','The Sun ATL / VINSONart','https://vinsonart.com/exhibitions/','official_html','official',1,24,'static','{}'),
  ('cal_source_cat_eye','Cat Eye Creative','https://www.cateye-creative.com/upcoming-shows','official_html','official',1,24,'static','{}'),
  ('cal_source_spalding_nix','Spalding Nix Fine Art','https://spaldingnixfineart.com/exhibitions','official_html','official',1,24,'static','{}'),
  ('cal_source_spelman_exhibitions','Spelman Museum of Fine Art','https://www.spelman.edu/museum-of-fine-art/art-and-events/exhibitions/index.html','official_html','official',1,24,'static','{}'),
  ('cal_source_gallery_100','Gallery 100','https://gallery100atlanta.com/','official_html','official',1,24,'static','{}'),
  ('cal_source_moda_events','MODA Events','https://www.museumofdesign.org/moda-events','official_html','official',1,24,'static','{}'),
  ('cal_source_puppetry_programs','Center for Puppetry Arts Programs','https://puppet.org/all-programs/','official_html','official',1,24,'static','{}'),
  ('cal_source_carlos_exhibitions','Carlos Museum Exhibitions','https://carlos.emory.edu/exhibitions','official_html','official',1,24,'static','{}'),
  ('cal_source_sefaa','SEFAA Events and Exhibits','https://www.fiberartsalliance.org/events-exhibits','official_html','official',1,24,'static','{}'),
  ('cal_source_marcia_wood','Marcia Wood Gallery','https://www.marciawoodgallery.com/exhibitions/current/','official_html','official',1,24,'static','{}'),
  ('cal_source_decatur_arts_exhibitions','Decatur Arts Alliance Exhibitions','https://decaturartsalliance.org/events/category/exhibitions/','official_html','official',1,24,'static','{}'),
  ('cal_source_papermaking_museum','Robert C. Williams Museum of Papermaking','https://paper.gatech.edu/upcoming-exhibits','official_html','official',1,24,'static','{}'),
  ('cal_source_whitespace','Whitespace','https://whitespace814.com/','official_html','official',1,24,'static','{}'),
  ('cal_source_echo_contemporary','Echo Contemporary','https://www.echocontemporary.com/events','official_html','official',1,24,'static','{}'),
  ('cal_source_moca_ga','MOCA GA','https://mocaga.org/calendar/','official_html','official',1,24,'dynamic-fallback','{}');

-- Avoid duplicate source rows caused only by a trailing slash or casing. An
-- already-registered organization source keeps its current id and settings.
INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
SELECT s.id,s.name,s.url,s.source_type,s.trust_level,s.enabled,s.cadence_hours,
       'automatic',s.render_mode,s.adapter_config_json,datetime('now'),datetime('now')
FROM calendar_fall_2026_sources_stage s
WHERE NOT EXISTS (
  SELECT 1 FROM calendar_sources existing
  WHERE lower(rtrim(existing.url,'/'))=lower(rtrim(s.url,'/'))
)
AND NOT EXISTS (SELECT 1 FROM calendar_sources existing WHERE existing.id=s.id);

CREATE TABLE calendar_fall_2026_candidates_stage (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_registry_url TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  ticket_url TEXT NOT NULL,
  title TEXT NOT NULL,
  organizer TEXT NOT NULL,
  factual_description TEXT NOT NULL,
  event_structure TEXT NOT NULL,
  date_kind TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  venue_name TEXT NOT NULL,
  venue_address TEXT NOT NULL,
  subjects_json TEXT NOT NULL,
  formats_json TEXT NOT NULL,
  is_experimental INTEGER NOT NULL,
  status TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  verification_notes TEXT NOT NULL,
  access_status TEXT NOT NULL,
  access_notes TEXT NOT NULL,
  ticket_status TEXT NOT NULL,
  ticket_notes TEXT NOT NULL,
  organizer_url TEXT NOT NULL,
  venue_url TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  review_existing INTEGER NOT NULL DEFAULT 0
);

INSERT INTO calendar_fall_2026_candidates_stage
  (id,source_id,source_registry_url,source_event_id,source_url,ticket_url,title,organizer,
   factual_description,event_structure,date_kind,starts_at,ends_at,venue_name,venue_address,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   access_status,access_notes,ticket_status,ticket_notes,organizer_url,venue_url,source_authority,review_existing)
VALUES
  ('cal_candidate_fall_2026_atlanta_art_fair','cal_source_atlanta_art_fair_official','https://theatlantaartfair.com/','atlanta-art-fair-2026',
   'https://theatlantaartfair.com/','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','Atlanta Art Fair 2026','Atlanta Art Fair',
   'The third annual Atlanta Art Fair brings more than 70 galleries to Pullman Yards with installations, performances, talks, and regional and international programming. October 1 is the preview day; public hours are October 2 and 3 from 11 AM to 7 PM and October 4 from 11 AM to 6 PM. The fair includes Low Grit Grins, a Sarah Higgins-curated project featuring Antonio Darden, Victoria Dugger, and Tori Tinsley.',
   'series','date_range','2026-10-01','2026-10-04','Pullman Yards','225 Rogers Street NE, Atlanta, GA 30317',
   '["art","design"]','["exhibition","performance"]',0,'candidate','verified','Dates, public hours, venue, admission, fair scope, and the Low Grit Grins project were checked against the official fair, ticket, and project pages. Preview-day hours remain intentionally unstated.',
   'public','$35–$65; on-site discounts are listed for students, seniors, and veterans; children under 12 are free.','on_sale','Official fair tickets are on sale.','https://theatlantaartfair.com/','https://www.pullmanyards.com/','organizer_event',1),

  ('cal_candidate_site_2026','cal_source_goat_farm','https://www.thegoatfarm.info/','site-2026',
   'https://www.thegoatfarm.info/events/site-2026','','SITE 2026','Goat Farm',
   'A one-night campus-wide exhibition of contemporary art, performance, music, film, installation, and experimentation featuring more than 50 artists across Goat Farm’s 12-acre campus. The detailed performance schedule remains TBA.',
   'single','timed','2026-10-03T17:00:00-04:00','2026-10-03T23:00:00-04:00','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318',
   '["art","film","poetry-music"]','["exhibition","performance","screening","experimental-event"]',1,'candidate','verified','Date, time, venue, current lineup, access notes, and ticket availability were rechecked on the official Goat Farm event page. The event is an existing record and is not rewritten by this migration.',
   'public','All ages; rain or shine. Children 12 and under are free.','on_sale','Official event page links to tickets; the detailed schedule remains TBA.','https://www.thegoatfarm.info/','https://www.thegoatfarm.info/','venue_event',0),

  ('cal_candidate_fall_2026_atlanta_design_festival','cal_source_atlanta_design_festival','https://atlantadesignfestival.net/visit/','atlanta-design-festival-2026',
   'https://atlantadesignfestival.net/','https://atlantadesignfestival.net/visit/','Atlanta Design Festival 2026','Atlanta Design Festival',
   'A citywide design platform presenting installations, exhibitions, architecture tours, film screenings, and conference programming across Atlanta.',
   'series','date_range','2026-09-26','2026-10-04','Multiple Atlanta venues','',
   '["art","design","film","technology"]','["exhibition","screening","conference"]',0,'candidate','verified','Festival dates and umbrella scope were checked against the official festival and visit pages. Individually visitable programs remain separate candidates.','public','Programs have their own access and admission terms.','unknown','See each program page for admission.','https://atlantadesignfestival.net/','https://atlantadesignfestival.net/visit/','organizer_event',0),

  ('cal_candidate_fall_2026_creative_futures','cal_source_atlanta_design_festival','https://atlantadesignfestival.net/visit/','creative-futures-conference-2026',
   'https://atlantadesignfestival.net/e/conference/','https://atlantadesignfestival.net/e/conference/','Creative Futures Conference 2026','Atlanta Design Festival',
   'A full-day conference connecting design, business, nonprofit, academic, and arts leaders around human-centered design, culture, environment, community, and emerging technologies.',
   'single','timed','2026-09-26T09:30:00-04:00','2026-09-26T18:30:00-04:00','Fourth Ward, Tower 2','505 North Angier Avenue NE, Atlanta, GA 30308',
   '["art","design","technology"]','["conference","lecture-talk","panel"]',0,'candidate','verified','Date, time, venue, conference scope, and price range were checked against the official conference page.','public','$50–$75.','on_sale','Registration is available from the official conference page.','https://atlantadesignfestival.net/','https://fourthwardatl.com/','organizer_event',0),

  ('cal_candidate_fall_2026_ma_architecture_tours','cal_source_atlanta_design_festival','https://atlantadesignfestival.net/visit/','ma-architecture-tours-atlanta-metro-2026',
   'https://atlantadesignfestival.net/visit/','https://atlantadesignfestival.net/visit/','MA! Architecture Tours: Atlanta Metro','Atlanta Design Festival',
   'Two days of self-guided architecture tours at multiple metro Atlanta sites. The 2026 property list and a stable dedicated detail page remain forthcoming.',
   'series','date_range','2026-10-03','2026-10-04','Multiple metro Atlanta sites','',
   '["art","design"]','["exhibition"]',0,'candidate','verified','Dates, daily hours, self-guided format, and price are listed by the official festival. Recheck when the property list and dedicated detail URL are published.','public','$60.','on_sale','Official festival listing provides admission information.','https://atlantadesignfestival.net/','https://atlantadesignfestival.net/visit/','official_calendar',0),

  ('cal_candidate_fall_2026_beltline_lantern_parade','cal_source_beltline_art','https://beltline.org/art/','atlanta-beltline-lantern-parade-2026',
   'https://beltline.org/art/lantern-parade/','','Atlanta Beltline Lantern Parade 2026','Atlanta Beltline Art',
   'A community lantern procession beginning at Beulah Colbert Park and following an expanded street and Southwest Trail route to Lee+White, with a final jam around 9 PM.',
   'single','timed','2026-09-19T19:15:00-04:00','2026-09-19T22:00:00-04:00','Beulah Colbert Park to Lee+White','Atlanta Beltline Southwest Trail, Atlanta, GA',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Line-up, step-off, route, end time, participants, and access requirements were checked against the official 2026 parade page.','public','Free. A lantern is required to walk in the parade.','not_required','No ticket is required.','https://beltline.org/art/','https://beltline.org/art/lantern-parade/','organizer_event',0),

  ('cal_candidate_fall_2026_stylewriters_jam','cal_source_beltline_art','https://beltline.org/art/','atl-stylewriters-jam-2026',
   'https://beltline.org/art/events/atl-stylewriters-jam/','','ATL StyleWriters Jam 2026','Atlanta Beltline Art',
   'A proposed free three-day live exhibition celebrating Atlanta’s style-writing history with artists painting walls in real time at multiple Beltline sites.',
   'series','date_range','2026-11-06','2026-11-08','Multiple Atlanta Beltline sites','',
   '["art"]','["exhibition","performance"]',1,'needs_verification','needs_verification','The proposed November 6–8 dates came from the ARTS ATL preview. The official Beltline page still displays only the 2025 schedule, sites, and artist list. Keep private until the organizer publishes 2026 details.','unknown','The prior edition was free and public, but 2026 access has not been confirmed.','unknown','No 2026 ticket or registration information is published.','https://beltline.org/art/','https://beltline.org/art/events/atl-stylewriters-jam/','official_calendar',0),

  ('cal_candidate_fall_2026_making_kin_october','cal_source_glo_events','https://www.gloplatform.org/events/','making-kin-2026-10-04',
   'https://www.gloplatform.org/event/making-kin-2/','','Making Kin — Fall Activation','glo',
   'A people-processional live artwork by Monique Osorio, lauri stallings, and Kebbi Williams activating Lonnie Holley’s Keeping a Record of It through movement, chant, sound, and public participation.',
   'single','timed','2026-10-04T20:00:00-04:00','2026-10-04T21:30:00-04:00','Atlanta Beltline — location TBA','',
   '["art","poetry-music"]','["performance","experimental-event"]',1,'needs_verification','needs_verification','The official event heading gives October 4 from 8–9:30 PM, but the body still describes the August 15 activation and its location. Keep private until glo corrects the October location and body copy.','unknown','The project is described as free and public, but the October location and final access details need confirmation.','unknown','No separate October ticket is published.','https://www.gloplatform.org/','https://beltline.org/art/','organizer_event',0),

  ('cal_candidate_fall_2026_bitchin_bajas','cal_source_goat_farm','https://www.thegoatfarm.info/','bitchin-bajas-2026',
   'https://www.thegoatfarm.info/events/bitchin-bajas','https://www.bigtickets.com/e/spnb/bitchinbajasGF/','Bitchin Bajas','Speakeasy and Commune',
   'An all-ages instrumental performance by Bitchin Bajas and Alembic 3 spanning ambient, minimalism, psychedelia, and electronic sound. Doors open at 7 PM and the show begins at 8 PM.',
   'single','timed','2026-09-13T19:00:00-04:00','2026-09-13T23:00:00-04:00','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318',
   '["poetry-music"]','["performance","experimental-event"]',1,'candidate','verified','Date, 7 PM doors, lineup, all-ages access, price, venue, and ticket link were rechecked on the official Goat Farm event page.','public','$18–$20; all ages.','on_sale','Official venue page links to Big Tickets.','https://www.thegoatfarm.info/','https://www.thegoatfarm.info/','venue_event',0),

  ('cal_candidate_fall_2026_cortex_adrian_younge_jrocc','cal_source_goat_farm','https://www.thegoatfarm.info/','cortex-adrian-younge-jrocc-2026',
   'https://www.thegoatfarm.info/events/cortex-adrian-younge-jrocc','https://www.bigtickets.com/e/spnb/cortexGF/','Cortex, Adrian Younge, J.Rocc','Speakeasy',
   'An all-ages performance connecting Cortex’s influential jazz-funk catalog with Adrian Younge and J.Rocc, tracing music sampled across generations of hip-hop production.',
   'single','timed','2026-10-08T19:00:00-04:00','2026-10-08T23:00:00-04:00','Goat Farm','1200 Foster Street NW, Atlanta, GA 30318',
   '["poetry-music"]','["performance"]',0,'candidate','verified','Date, time, lineup, all-ages access, $52+ price, venue, description, and ticket link were rechecked on the official Goat Farm event page.','public','$52+; all ages.','on_sale','Official venue page links to Big Tickets.','https://www.thegoatfarm.info/','https://www.thegoatfarm.info/','venue_event',0),

  ('cal_candidate_fall_2026_amy_sherald','cal_source_high_exhibitions','https://high.org/exhibitions/','amy-sherald-american-sublime-2026',
   'https://high.org/exhibition/amy-sherald-american-sublime/','https://high.org/exhibition/amy-sherald-american-sublime/','Amy Sherald: American Sublime','High Museum of Art',
   'Sherald’s largest exhibition to date spans paintings from 2007–2024 and centers Black subjects, agency, leisure, intimacy, and surreal visual cues. Visit during museum hours; this record does not create daily timed occurrences.',
   'exhibition','date_range','2026-05-15','2026-09-27','High Museum of Art','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art"]','["exhibition"]',0,'candidate','verified','Exhibition run, venue, scope, and timed-ticket admission were checked against the official exhibition page.','public','Timed exhibition ticket; the official page lists $28.50 general admission and free member admission.','on_sale','Timed exhibition admission is available from the official page.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_los_porfiados','cal_source_high_exhibitions','https://high.org/exhibitions/','los-porfiados-2026',
   'https://high.org/exhibition/los-porfiados-the-stubborns/','','Los Porfiados (The Stubborns)','High Museum of Art',
   'An interactive landscape of 14 monumental inflatable sculptures by Chilean studio gt2P exploring resilience, adaptability, collaboration, and public space through collective movement.',
   'exhibition','date_range','2026-06-05','2026-11-29','High Museum of Art — Carroll Slater Sifly Piazza','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art","design"]','["exhibition","experimental-event"]',1,'candidate','verified','Exhibition run, venue, artist, and interactive format were checked against the official exhibition page.','public','See the museum page for current admission conditions.','unknown','No separate ticket status is stated for the Piazza installation.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_paper_trees','cal_source_high_exhibitions','https://high.org/exhibitions/','paper-trees-2026',
   'https://high.org/exhibition/paper-trees/','https://high.org/exhibition/paper-trees/','Paper Trees','High Museum of Art',
   'Nearly 50 prints, drawings, and sculptures examine technique, perception, conservation, and the translation of trees and natural forms into art. Visit during museum hours; no daily occurrences are generated.',
   'exhibition','date_range','2026-07-31','2027-02-21','High Museum of Art','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art"]','["exhibition"]',0,'candidate','verified','Exhibition run, venue, scope, and admission were checked against the official exhibition page.','public','Members and Museum Pass holders free; general admission is listed at $23.50.','on_sale','Museum admission is available from the official page.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_walter_wick','cal_source_high_exhibitions','https://high.org/exhibitions/','walter-wick-hidden-wonders-2026',
   'https://high.org/exhibition/walter-wick/','','I SPY! Walter Wick’s Hidden Wonders','High Museum of Art',
   'The largest survey of Walter Wick’s photographic illustration presents miniature worlds, optical illusions, puzzles, models, art and craft processes, and visual storytelling.',
   'exhibition','date_range','2026-08-28','2027-01-03','High Museum of Art','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art","film"]','["exhibition"]',0,'candidate','verified','Exhibition run, venue, and scope were checked against the official exhibition page. The event already exists and is not rewritten by this migration.','public','Museum admission required.','not_yet_on_sale','The brief reports that tickets were not yet on sale when checked.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_martin_puryear','cal_source_high_exhibitions','https://high.org/exhibitions/','martin-puryear-nexus-2026',
   'https://high.org/exhibition/martin-puryear-nexus/','','Martin Puryear: Nexus','High Museum of Art',
   'More than 70 sculptures, drawings, and prints spanning 50 years connect enigmatic form and material craft with global culture, African American history, social history, and science.',
   'exhibition','date_range','2026-09-25','2027-01-17','High Museum of Art','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art"]','["exhibition"]',0,'candidate','verified','Exhibition run, venue, scope, and ticket status were checked against the official exhibition page.','public','Museum admission required.','not_yet_on_sale','Tickets were not yet on sale when checked.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_photography_way_of_life','cal_source_high_exhibitions','https://high.org/exhibitions/','photography-way-of-life-2026',
   'https://high.org/exhibition/photography-as-a-way-of-life/','','Photography as a Way of Life: Minor White, Aaron Siskind, and Harry Callahan','High Museum of Art',
   'A touring exhibition about three artists who redefined photography through abstraction, personal expression, teaching, and artistic networks, with work by students and contemporaries including Roy DeCarava and Ming Smith.',
   'exhibition','date_range','2026-10-09','2027-02-07','High Museum of Art','1280 Peachtree Street NE, Atlanta, GA 30309',
   '["art"]','["exhibition"]',0,'candidate','verified','Exhibition run, venue, scope, and ticket status were checked against the official exhibition page.','public','Museum admission required.','not_yet_on_sale','Tickets were not yet on sale when checked.','https://high.org/','https://high.org/','venue_event',0),

  ('cal_candidate_fall_2026_calida_rawles','cal_source_spelman_exhibitions','https://www.spelman.edu/museum-of-fine-art/art-and-events/exhibitions/index.html','calida-rawles-away-with-the-tides-2026',
   'https://www.spelman.edu/museum-of-fine-art/art-and-events/exhibitions/calida-rawles.html','','Calida Rawles: Away with the Tides','Spelman College Museum of Fine Art',
   'Hyperrealist paintings and a large-scale video installation use water to explore Black life, memory, healing, displacement, and Miami’s historically Black Overtown community. Gallery hours are Wednesday–Saturday, noon–5 PM.',
   'exhibition','date_range','2026-03-27','2026-09-05','Spelman College Museum of Fine Art — Cosby Gallery','350 Spelman Lane SW, Atlanta, GA 30314',
   '["art","film"]','["exhibition"]',1,'candidate','verified','Exhibition run, hours, venue, free admission, artist, and description were checked against the official Spelman exhibition page.','public','Free.','not_required','No ticket is required.','https://www.spelman.edu/museum-of-fine-art/','https://www.spelman.edu/museum-of-fine-art/','venue_event',1),

  ('cal_candidate_fall_2026_paper_quilts','cal_source_gallery_100','https://gallery100atlanta.com/','paper-quilts-and-stories-lisa-tuttle-2026',
   'https://gallery100atlanta.com/index.php/paper-quilts-and-stories','','Paper Quilts and Stories — Lisa Tuttle','Gallery 100',
   'Large mixed-media works combine collage, photography, printmaking, textiles, abstract quilting, women’s history, autobiography, and poetic content.',
   'exhibition','date_range','2026-06-11','2026-09-03','Gallery 100','',
   '["art"]','["exhibition"]',0,'needs_verification','needs_verification','The official exhibition page confirms the run and content, but the current public street address must be resolved from an official contact or visit page before publication.','unknown','Attendance and the current street address require confirmation.','unknown','No ticket information is confirmed.','https://gallery100atlanta.com/','https://gallery100atlanta.com/','venue_event',0),

  ('cal_candidate_fall_2026_salt_design_story','cal_source_moda_events','https://www.museumofdesign.org/moda-events','salt-design-story-2026',
   'https://www.museumofdesign.org/current-exhibition','','SALT: A Design Story','Museum of Design Atlanta',
   'A cross-disciplinary exhibition about salt as a natural designer and as a force shaping craft, packaging, trade, politics, industry, architecture, and cities. Gallery hours are Wednesday–Sunday, noon–7 PM.',
   'exhibition','date_range','2026-07-12','2026-10-31','Museum of Design Atlanta','1315 Peachtree Street NE, Atlanta, GA 30309',
   '["art","design"]','["exhibition"]',0,'candidate','verified','Exhibition run, hours, venue, and scope were checked against MODA’s official exhibition information. The existing official detail URL is retained when already present.','public','See MODA for current admission.','unknown','Admission status should be rechecked before publication.','https://www.museumofdesign.org/','https://www.museumofdesign.org/','venue_event',0),

  ('cal_candidate_fall_2026_frame_by_frame','cal_source_puppetry_programs','https://puppet.org/all-programs/','frame-by-frame-stop-motion-2026',
   'https://puppet.org/programs/frame-by-frame/','https://puppet.org/programs/frame-by-frame/','Frame by Frame: The Art of Stop-Motion Animation','Center for Puppetry Arts',
   'A behind-the-scenes exhibition about stop-motion filmmaking through puppets, scenery, human craft, and production process. The museum is open Tuesday–Sunday.',
   'exhibition','date_range','2026-06-12','2026-11-01','Center for Puppetry Arts','1404 Spring Street NW, Atlanta, GA 30309',
   '["art","film"]','["exhibition"]',0,'candidate','verified','Run, venue, admission inclusion, and exhibition scope were rechecked against the official Center for Puppetry Arts program listing.','public','Included with museum admission; current ticket range is $14–$18.','on_sale','Museum admission is available.','https://puppet.org/','https://puppet.org/','venue_event',0),

  ('cal_candidate_fall_2026_festive_features','cal_source_puppetry_programs','https://puppet.org/all-programs/','festive-features-2026',
   'https://puppet.org/programs/festive-features/','https://puppet.org/programs/festive-features/','Festive Features','Center for Puppetry Arts',
   'A holiday exhibition transforming the special-exhibitions gallery with puppets from seasonal productions including Emmet Otter’s Jug-Band Christmas, Rudolph the Red-Nosed Reindeer, Sabrina the Teenage Witch, and Lamb Chop’s Special Chanukah.',
   'exhibition','date_range','2026-11-11','2026-12-27','Center for Puppetry Arts','1404 Spring Street NW, Atlanta, GA 30309',
   '["art","film"]','["exhibition"]',0,'candidate','verified','The official dedicated exhibition page and ticket inventory now confirm the description, November 11–December 27 run, venue, and admission inclusion.','public','Included with museum admission; current ticket range is $14–$18.','on_sale','Museum admission is available.','https://puppet.org/','https://puppet.org/','venue_event',0),

  ('cal_candidate_fall_2026_compassion','cal_source_carlos_exhibitions','https://carlos.emory.edu/exhibitions','compassion-what-moves-you-2026',
   'https://carlos.emory.edu/exhibition/compassion','','Compassion: What Moves You?','Michael C. Carlos Museum',
   'An experiential exhibition examining empathy, shared humanity, motivation, failures of care, and concrete practices of compassion, including an interactive Compassion Lab.',
   'exhibition','date_range','2026-01-31','2026-11-01','Michael C. Carlos Museum','571 South Kilgo Circle, Atlanta, GA 30322',
   '["art"]','["exhibition","experimental-event"]',1,'candidate','verified','Exhibition run, venue, scope, and interactive component were checked against the official Carlos Museum exhibition page.','public','See the museum page for current admission.','unknown','Admission should be rechecked before publication.','https://carlos.emory.edu/','https://carlos.emory.edu/','venue_event',0),

  ('cal_candidate_fall_2026_anamnesis','cal_source_carlos_exhibitions','https://carlos.emory.edu/exhibitions','anamnesis-sergio-suarez-2026',
   'https://carlos.emory.edu/exhibitions','','Anamnesis — Works by Sergio Suárez','Michael C. Carlos Museum',
   'An exhibition by Mexican-born Atlanta printmaker Sergio Suárez whose carved wood and ink practice uses sacred symbolism, astrological forms, fragmented landscapes, syncretism, memory, and metaphysical inquiry.',
   'exhibition','date_range','2026-09-19','2027-01-24','Michael C. Carlos Museum','571 South Kilgo Circle, Atlanta, GA 30322',
   '["art"]','["exhibition"]',1,'candidate','verified','Run, venue, artist, and exhibition framing were checked against the official Carlos Museum exhibition listing; monitor for a stable dedicated detail URL.','public','See the museum page for current admission.','unknown','Admission should be rechecked before publication.','https://carlos.emory.edu/','https://carlos.emory.edu/','official_calendar',0),

  ('cal_candidate_fall_2026_craft_of_paper','cal_source_papermaking_museum','https://paper.gatech.edu/upcoming-exhibits','craft-of-paper-2026',
   'https://paper.gatech.edu/upcoming-exhibits','','The Craft of Paper: Contemporary Takes on Tradition','Robert C. Williams Museum of Papermaking',
   'A Michael Velliquette-curated exhibition on contemporary paper cutting, folding, rolling, weaving, layering, material innovation, and the relationship between craft and design.',
   'exhibition','date_range','2026-08-07','2027-01-15','Robert C. Williams Museum of Papermaking','',
   '["art","design"]','["exhibition"]',0,'needs_verification','needs_verification','The official exhibition listing confirms the run and scope, but the museum’s exact public visitor address must be resolved from its official visit page before publication.','unknown','Visitor address and admission require confirmation.','unknown','Admission should be rechecked before publication.','https://paper.gatech.edu/','https://paper.gatech.edu/','venue_event',0),

  ('cal_candidate_fall_2026_chuck_stewart','cal_source_vinson_art','https://vinsonart.com/exhibitions/','chuck-stewart-framing-the-sound-2026',
   'https://vinsonart.com/exhibitions/47-chuck-stewart-framing-the-sound-an-exhibition-of-iconic-photographs-at-the-sun/overview/','','Chuck Stewart: Framing the Sound','The Sun ATL / VINSONart',
   'Photographs and album covers from the Chuck Stewart Archive feature Miles Davis, John Coltrane, Nina Simone, Astrud Gilberto, and Tina Turner. Curated by Kim Stewart with Shawn Vinson. Regular gallery hours are Friday–Saturday, 11 AM–5 PM, otherwise by appointment.',
   'exhibition','date_range','2026-08-08','2026-09-26','The Sun ATL','399 Edgewood Avenue, Atlanta, GA 30312',
   '["art","poetry-music"]','["exhibition"]',0,'candidate','verified','Run, venue, hours, artists, and curatorial credit were checked against the official VINSONart exhibition page. The existing pending revision is not overwritten.','public','Free gallery access unless the venue states otherwise.','unknown','No separate ticket requirement is stated.','https://vinsonart.com/','https://vinsonart.com/the-sun-atl/','organizer_event',1),

  ('cal_candidate_fall_2026_grace_for_ebb','cal_source_cat_eye','https://www.cateye-creative.com/upcoming-shows','grace-for-ebb-vanna-black-2026',
   'https://www.cateye-creative.com/upcoming-shows/vannablacksolo','https://www.cateye-creative.com/upcoming-shows/vannablacksolo','Grace for Ebb — Vanna Black','Cat Eye Creative',
   'Vanna Black’s debut solo exhibition combines African motifs, Japanese illustration aesthetics, symbolic composition, introspection, change, and self-worth. Gallery hours are Wednesday–Saturday 11 AM–6 PM and Sunday 11 AM–5 PM.',
   'exhibition','date_range','2026-08-08','2026-09-13','Cat Eye Creative','1173 Commerce Drive, Decatur, GA 30030',
   '["art"]','["exhibition"]',0,'candidate','verified','Run, venue, hours, free RSVP access, artist, and description were rechecked against the official exhibition page.','public','Free with RSVP.','registration_open','The official page links to RSVP.','https://www.cateye-creative.com/','https://www.cateye-creative.com/','venue_event',0),

  ('cal_candidate_fall_2026_tending_the_wild','cal_source_cat_eye','https://www.cateye-creative.com/upcoming-shows','tending-the-wild-janice-rago-2026',
   'https://www.cateye-creative.com/upcoming-shows/janice-rago-solo-exhibition','','Tending the Wild — Janice Rago','Cat Eye Creative',
   'Gestural paintings consider care, control, growth, softness, structure, and the tension between tending and allowing forms to unfold. The official listing now gives a September 12 opening at 5 PM and an October 11 closing date.',
   'exhibition','date_range','2026-09-12','2026-10-11','Cat Eye Creative','1173 Commerce Drive, Decatur, GA 30030',
   '["art"]','["exhibition"]',0,'candidate','verified','Cat Eye’s official listing now resolves the earlier conflict by displaying a 5 PM September 12 opening and October 11 closing date.','public','Public gallery exhibition; confirm whether RSVP is requested.','unknown','No separate ticket requirement is stated.','https://www.cateye-creative.com/','https://www.cateye-creative.com/','venue_event',0),

  ('cal_candidate_fall_2026_mindful_seeing','cal_source_spalding_nix','https://spaldingnixfineart.com/exhibitions','mindful-seeing-2026',
   'https://spaldingnixfineart.com/show/spalding-nix-fine-art-mindful-seeing','','Mindful Seeing','Spalding Nix Fine Art',
   'Four linked exhibitions by Carlyle Wolfe Lee, Tim Hunter, Amanda Joy Brown, and Scotty Peek focus on attention, natural rhythms, environmental loss, light, landscape, and perception. Gallery hours are Monday–Friday, 10 AM–5 PM and by appointment.',
   'exhibition','date_range','2026-07-24','2026-09-11','Spalding Nix Fine Art','425 Peachtree Hills Avenue NE, Suite 30A, Atlanta, GA 30305',
   '["art"]','["exhibition"]',0,'candidate','verified','Run, venue, artists, hours, and exhibition framing were checked against the official gallery page. Any existing rejected candidate remains rejected and is not replaced.','public','Public gallery exhibition.','not_required','No ticket is required.','https://spaldingnixfineart.com/','https://spaldingnixfineart.com/','venue_event',0),

  ('cal_candidate_fall_2026_square_foot_fiber','cal_source_sefaa','https://www.fiberartsalliance.org/events-exhibits','square-foot-fiber-art-pin-up-2026',
   'https://www.fiberartsalliance.org/events-exhibits','','Square Foot Fiber Art Pin Up Show 2026','Southeast Fiber Arts Alliance',
   'The fourteenth small-format textile exhibition welcomes varied techniques and experience levels, with an optional 2026 Monochrome theme. Gallery hours are Tuesday–Friday 10 AM–2 PM and Saturday 10 AM–4 PM, or by appointment.',
   'exhibition','date_range','2026-07-11','2026-08-29','Southeast Fiber Arts Alliance','3420 West Hospital Avenue, Suite 103, Chamblee, GA 30341',
   '["art","design"]','["exhibition"]',0,'candidate','verified','Run, venue, hours, format, and 2026 theme were checked against the official SEFAA events and exhibits page.','public','Public exhibition; confirm any admission requirement on the source page.','unknown','No separate ticket status is stated.','https://www.fiberartsalliance.org/','https://www.fiberartsalliance.org/','venue_event',0),

  ('cal_candidate_fall_2026_beyond_the_map','cal_source_marcia_wood','https://www.marciawoodgallery.com/exhibitions/current/','beyond-the-map-2026',
   'https://www.marciawoodgallery.com/exhibitions/current/','','Beyond the Map: Where Imagination Becomes a Form of Navigation','Marcia Wood Gallery',
   'Five artists explore imagined and psychological terrain where observation gives way to invention.',
   'exhibition','date_range','2026-07-31','2026-08-29','Marcia Wood Gallery','',
   '["art"]','["exhibition"]',1,'needs_verification','needs_verification','The official current-exhibition page confirms the run and concept, but the gallery’s official venue address and public hours must be resolved before publication.','unknown','Venue address, public hours, and admission require confirmation.','unknown','No ticket information is confirmed.','https://www.marciawoodgallery.com/','https://www.marciawoodgallery.com/','venue_event',0),

  ('cal_candidate_fall_2026_book_as_art_ghosted','cal_source_decatur_arts_exhibitions','https://decaturartsalliance.org/events/category/exhibitions/','book-as-art-v14-ghosted-2026',
   'https://decaturartsalliance.org/event/the-book-as-art-v-14-ghosted/2026-09-12/','','The Book As Art v.14: Ghosted','Decatur Arts Alliance',
   'Nearly 60 sculptural, conceptual, mixed-media, and digital interpretations of the book explore ghosts, disappearance, folklore, communication, and the physical and digital divide. Gallery hours are Thursday–Saturday, 1–5 PM.',
   'exhibition','date_range','2026-09-11','2026-10-24','Fourth Floor Gallery, Decatur Library','215 Sycamore Street, Decatur, GA 30030',
   '["art","design","technology"]','["exhibition"]',1,'candidate','verified','Run, gallery hours, opening reception, venue, free admission, and scope were checked against the official exhibition page.','public','Free.','not_required','No ticket is required.','https://decaturartsalliance.org/','https://dekalblibrary.org/locations/decatur','organizer_event',0),

  ('cal_candidate_fall_2026_placita_latina','cal_source_decatur_arts_exhibitions','https://decaturartsalliance.org/events/category/exhibitions/','placita-latina-v6-puentes-2026',
   'https://decaturartsalliance.org/event/placita-latina-v-6-puentes/2026-09-18/','','Placita Latina v.6: Puentes','Decatur Arts Alliance',
   'A juried Latinx and Hispanic exhibition uses painting, photography, sculpture, and mixed media to explore bridges between heritage, innovation, belonging, resilience, and cultural exchange. Gallery hours are daily, 10 AM–4 PM.',
   'exhibition','date_range','2026-09-18','2026-10-16','Decatur Arts Alliance','113 Clairemont Avenue, Decatur, GA 30030',
   '["art"]','["exhibition"]',0,'candidate','verified','Run, daily hours, closing reception, venue, free admission, and scope were checked against the official exhibition page.','public','Free.','not_required','No ticket is required.','https://decaturartsalliance.org/','https://decaturartsalliance.org/','organizer_event',0),

  ('cal_candidate_fall_2026_whitespace_four','cal_source_whitespace','https://whitespace814.com/','whitespace-four-exhibitions-2026',
   'https://whitespace814.com/','','Whitespace: Four Concurrent Exhibitions','Whitespace',
   'Four concurrent exhibitions present Heart of a Bird by Constance Thalken, UNCERTAINTY by Lauren Lesley, Glimmers by Seana Reilly and Ann Stewart, and Psychic Waters by Chris Musina. Gallery hours are Thursday–Saturday, 11 AM–5 PM.',
   'exhibition','date_range','2026-08-01','2026-09-12','Whitespace','814 Edgewood Avenue NE, Atlanta, GA',
   '["art"]','["exhibition"]',1,'candidate','verified','Run, venue, hours, exhibition titles, and artists were checked against Whitespace’s official current listing. A grouped record is used because stable detail URLs were not exposed for all four exhibitions.','public','Public gallery exhibitions.','not_required','No ticket is required.','https://whitespace814.com/','https://whitespace814.com/','venue_event',0),

  ('cal_candidate_fall_2026_guardian_studios','cal_source_echo_contemporary','https://www.echocontemporary.com/events','guardian-studios-artists-exhibition-2026',
   'https://www.echocontemporary.com/events','','5th Annual Guardian Studios Artists Exhibition','Echo Contemporary Art / Guardian Studios',
   'The fifth annual exhibition of artists working from Guardian Studios at Echo Contemporary Art.',
   'exhibition','date_range','2026-07-25','2026-08-30','Echo Contemporary Art / Guardian Studios','785 Echo Street NW, Atlanta, GA 30318',
   '["art"]','["exhibition"]',0,'candidate','verified','Run and venue were checked against Echo Contemporary’s official 2026 exhibition schedule. Monitor for a stable detail page and fuller public description.','public','Public exhibition; confirm any admission requirement.','unknown','No separate ticket status is stated.','https://www.echocontemporary.com/','https://www.echocontemporary.com/','official_calendar',0),

  ('cal_candidate_fall_2026_artist_forum_atlanta','cal_source_echo_contemporary','https://www.echocontemporary.com/events','artist-forum-atlanta-exhibition-2026',
   'https://www.echocontemporary.com/events','','Artist Forum Atlanta Exhibition','Echo Contemporary Art',
   'A one-night Artist Forum Atlanta exhibition at Echo Contemporary Art.',
   'single','timed','2026-09-05T19:00:00-04:00','2026-09-05T22:00:00-04:00','Echo Contemporary Art','785 Echo Street NW, Atlanta, GA 30318',
   '["art"]','["exhibition"]',0,'candidate','verified','Date, time, and venue were checked against Echo Contemporary’s official 2026 exhibition schedule. Monitor for a stable detail page and fuller public description.','public','Public exhibition; confirm any admission requirement.','unknown','No separate ticket status is stated.','https://www.echocontemporary.com/','https://www.echocontemporary.com/','official_calendar',0),

  ('cal_candidate_fall_2026_nuestra_creacion','cal_source_echo_contemporary','https://www.echocontemporary.com/events','nuestra-creacion-2026',
   'https://www.echocontemporary.com/events','','Nuestra Creación','Echo Contemporary Art',
   'A September exhibition at Echo Contemporary Art. The schedule card lists 7–10 PM, but it is not yet clear whether those hours apply only to the opening reception.',
   'exhibition','date_range','2026-09-11','2026-09-26','Echo Contemporary Art','785 Echo Street NW, Atlanta, GA 30318',
   '["art"]','["exhibition"]',0,'needs_verification','needs_verification','The official schedule confirms the run and venue, but regular gallery hours and whether 7–10 PM applies only to opening night must be confirmed before publication.','unknown','Public access and regular hours require confirmation.','unknown','No separate ticket status is stated.','https://www.echocontemporary.com/','https://www.echocontemporary.com/','official_calendar',0),

  ('cal_candidate_fall_2026_moca_grand_opening_watch','cal_source_moca_ga','https://mocaga.org/calendar/','moca-ga-foster-street-opening-watch-2026',
   'https://mocaga.org/calendar/','','MOCA GA Grand Opening at Foster Street — Watch','MOCA GA',
   'Private watch record for the opening of MOCA GA’s new Foster Street building. No public opening date has been announced.',
   'single','all_day',NULL,NULL,'MOCA GA future Foster Street building','',
   '["art"]','["exhibition"]',0,'needs_verification','needs_verification','The new building is expected in the final quarter of 2026, but the official MOCA GA calendar does not publish a grand-opening date. Keep private and do not infer one from construction reporting.','unknown','Date, access, and opening program are not announced.','unknown','No opening registration or ticket information is published.','https://mocaga.org/','https://mocaga.org/','official_calendar',0),

  ('cal_candidate_fall_2026_weird_things_watch','cal_source_weird_gone_pro','https://www.weirdgonepro.com/whats-on','where-the-weird-things-are-2026-watch',
   'https://www.weirdgonepro.com/weird-things','','Where the Weird Things Are 2026 — Watch','Chantelle Rytter / Weird Gone Pro',
   'Private watch record for a possible return of the participatory public-art project Where the Weird Things Are to Historic Fourth Ward Park.',
   'single','all_day','2026-10-24',NULL,'Historic Fourth Ward Park','Atlanta, GA',
   '["art"]','["exhibition","experimental-event"]',1,'needs_verification','needs_verification','The organizer says the project is in grant review and is only hoping to return on October 24, 2026. Keep private until the organizer confirms that it will occur.','unknown','The event is tentative and public access is not confirmed.','unknown','No 2026 ticket or registration information is published.','https://www.weirdgonepro.com/','https://www.weirdgonepro.com/weird-things','organizer_event',0);

CREATE TABLE calendar_fall_2026_matches (
  stage_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  existed_before INTEGER NOT NULL
);

-- Match canonical URLs first, then normalized title plus start date and venue.
-- A prior rejection/duplicate with the same normalized title also blocks a new
-- candidate, preserving Studio decisions such as Mindful Seeing.
INSERT INTO calendar_fall_2026_matches(stage_id,candidate_id,existed_before)
SELECT b.id,
       COALESCE((
         SELECT c.id FROM calendar_candidates c
         WHERE c.id=b.id
         LIMIT 1
       ),(
         SELECT c.id FROM calendar_candidates c
         WHERE lower(rtrim(c.source_url,'/'))=lower(rtrim(b.source_url,'/'))
         ORDER BY CASE c.status WHEN 'published' THEN 0 WHEN 'candidate' THEN 1 WHEN 'needs_verification' THEN 2 ELSE 3 END,
                  c.created_at
         LIMIT 1
       ),(
         SELECT c.id FROM calendar_candidates c
         WHERE lower(trim(replace(replace(replace(c.title,'—','-'),'–','-'),'’','''')))
                 =lower(trim(replace(replace(replace(b.title,'—','-'),'–','-'),'’','''')))
           AND (
             c.status IN ('rejected','duplicate')
             OR (
               COALESCE(substr(c.starts_at,1,10),'')=COALESCE(substr(b.starts_at,1,10),'')
               AND (
                 lower(trim(c.venue_name))=lower(trim(b.venue_name))
                 OR lower(trim(c.title))=lower(trim(b.title))
               )
             )
           )
         ORDER BY CASE c.status WHEN 'published' THEN 0 WHEN 'candidate' THEN 1 WHEN 'needs_verification' THEN 2 ELSE 3 END,
                  c.created_at
         LIMIT 1
       ),b.id),
       EXISTS(
         SELECT 1 FROM calendar_candidates c
         WHERE c.id=b.id
            OR lower(rtrim(c.source_url,'/'))=lower(rtrim(b.source_url,'/'))
            OR (
              lower(trim(replace(replace(replace(c.title,'—','-'),'–','-'),'’','''')))
                =lower(trim(replace(replace(replace(b.title,'—','-'),'–','-'),'’','''')))
              AND (
                c.status IN ('rejected','duplicate')
                OR (
                  COALESCE(substr(c.starts_at,1,10),'')=COALESCE(substr(b.starts_at,1,10),'')
                  AND (
                    lower(trim(c.venue_name))=lower(trim(b.venue_name))
                    OR lower(trim(c.title))=lower(trim(b.title))
                  )
                )
              )
            )
       )
FROM calendar_fall_2026_candidates_stage b;

INSERT INTO calendar_candidates
  (id,source_id,source_event_id,source_url,ticket_url,title,organizer,factual_description,
   event_structure,date_kind,starts_at,ends_at,timezone,venue_name,venue_address,city,region,
   subjects_json,formats_json,is_experimental,status,verification_state,verification_notes,
   confidence,discovered_by,discovery_channel,access_status,access_notes,audiences_json,
   discovery_url,organizer_url,venue_url,source_authority,source_resolution_notes,
   schedule_status,ticket_status,ticket_notes,monitoring_enabled,monitoring_cadence_hours,next_check_at,
   first_seen_at,last_verified_at,created_at,updated_at)
SELECT
  b.id,
  COALESCE(
    (SELECT id FROM calendar_sources WHERE id=b.source_id),
    (SELECT id FROM calendar_sources WHERE lower(rtrim(url,'/'))=lower(rtrim(b.source_registry_url,'/')) LIMIT 1)
  ),
  b.source_event_id,b.source_url,b.ticket_url,b.title,b.organizer,b.factual_description,
  b.event_structure,b.date_kind,b.starts_at,b.ends_at,'America/New_York',b.venue_name,b.venue_address,'Atlanta','GA',
  b.subjects_json,b.formats_json,b.is_experimental,b.status,b.verification_state,b.verification_notes,
  CASE WHEN b.verification_state='verified' THEN 0.96 ELSE 0.58 END,
  'seed','arts_atl_fall_2026',b.access_status,b.access_notes,
  CASE WHEN b.access_status='public' THEN '["Public"]' ELSE '[]' END,
  'https://www.artsatl.org/the-2026-fall-arts-preview-our-picks-in-art-design/',
  b.organizer_url,b.venue_url,b.source_authority,
  'Official organizer, venue, museum, or authorized ticket information is canonical; ARTS ATL is retained only as private discovery provenance.',
  'scheduled',b.ticket_status,b.ticket_notes,1,
  CASE WHEN b.verification_state='needs_verification' THEN 12 ELSE 24 END,
  strftime('%Y-%m-%dT%H:%M:%fZ','now',CASE WHEN b.verification_state='needs_verification' THEN '+12 hours' ELSE '+24 hours' END),
  '2026-08-21T00:00:00-04:00',
  CASE WHEN b.verification_state='verified' THEN '2026-08-21T00:00:00-04:00' ELSE NULL END,
  datetime('now'),datetime('now')
FROM calendar_fall_2026_candidates_stage b
JOIN calendar_fall_2026_matches m ON m.stage_id=b.id
WHERE m.existed_before=0;

-- Related schedules stay under their parent records. Date-range parents remain
-- one calendar item and do not become hundreds of repeated daily occurrences.
INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_art_fair_friday',m.candidate_id,'atlanta-art-fair-public-hours-2026-10-02','other',
       'Atlanta Art Fair — Friday Public Hours','Public fair hours.','timed','2026-10-02T11:00:00-04:00','2026-10-02T19:00:00-04:00','America/New_York',
       'Pullman Yards','225 Rogers Street NE, Atlanta, GA 30317','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','scheduled','verified','Official ticket page confirms the public hours.',1,
       'public','Ticketed fair hours.','["Public"]','on_sale','Official tickets are on sale.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_atlanta_art_fair';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_art_fair_saturday',m.candidate_id,'atlanta-art-fair-public-hours-2026-10-03','other',
       'Atlanta Art Fair — Saturday Public Hours','Public fair hours.','timed','2026-10-03T11:00:00-04:00','2026-10-03T19:00:00-04:00','America/New_York',
       'Pullman Yards','225 Rogers Street NE, Atlanta, GA 30317','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','scheduled','verified','Official ticket page confirms the public hours.',2,
       'public','Ticketed fair hours.','["Public"]','on_sale','Official tickets are on sale.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_atlanta_art_fair';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_art_fair_sunday',m.candidate_id,'atlanta-art-fair-public-hours-2026-10-04','other',
       'Atlanta Art Fair — Sunday Public Hours','Public fair hours.','timed','2026-10-04T11:00:00-04:00','2026-10-04T18:00:00-04:00','America/New_York',
       'Pullman Yards','225 Rogers Street NE, Atlanta, GA 30317','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','https://tickets.theatlantaartfair.com/e/atlanta-art-fair-2026','scheduled','verified','Official ticket page confirms the public hours.',3,
       'public','Ticketed fair hours.','["Public"]','on_sale','Official tickets are on sale.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_atlanta_art_fair';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_ma_tour_saturday',m.candidate_id,'ma-architecture-tour-2026-10-03','other',
       'MA! Architecture Tours — Saturday','Self-guided tour day at multiple metro Atlanta properties.','timed','2026-10-03T10:00:00-04:00','2026-10-03T16:00:00-04:00','America/New_York',
       'Multiple metro Atlanta sites','','https://atlantadesignfestival.net/visit/','https://atlantadesignfestival.net/visit/','scheduled','verified','Official festival listing confirms the date and hours.',1,
       'public','$60 tour admission.','["Public"]','on_sale','Official listing provides admission information.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_ma_architecture_tours';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_ma_tour_sunday',m.candidate_id,'ma-architecture-tour-2026-10-04','other',
       'MA! Architecture Tours — Sunday','Self-guided tour day at multiple metro Atlanta properties.','timed','2026-10-04T10:00:00-04:00','2026-10-04T16:00:00-04:00','America/New_York',
       'Multiple metro Atlanta sites','','https://atlantadesignfestival.net/visit/','https://atlantadesignfestival.net/visit/','scheduled','verified','Official festival listing confirms the date and hours.',2,
       'public','$60 tour admission.','["Public"]','on_sale','Official listing provides admission information.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_ma_architecture_tours';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_tending_opening',m.candidate_id,'tending-wild-opening-2026-09-12','opening_reception',
       'Tending the Wild — Opening Reception','Opening reception for Janice Rago’s solo exhibition.','timed','2026-09-12T17:00:00-04:00',NULL,'America/New_York',
       'Cat Eye Creative','1173 Commerce Drive, Decatur, GA 30030','https://www.cateye-creative.com/upcoming-shows/janice-rago-solo-exhibition','','scheduled','verified','The current official Cat Eye listing gives a 5 PM opening.',1,
       'public','Public gallery opening; confirm whether RSVP is requested.','["Public"]','unknown','No separate ticket requirement is stated.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_tending_the_wild';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_book_as_art_opening',m.candidate_id,'book-as-art-opening-2026-09-11','opening_reception',
       'The Book As Art v.14: Ghosted — Opening Reception','Opening reception for the exhibition.','timed','2026-09-11T18:30:00-04:00','2026-09-11T21:00:00-04:00','America/New_York',
       'Fourth Floor Gallery, Decatur Library','215 Sycamore Street, Decatur, GA 30030','https://decaturartsalliance.org/event/the-book-as-art-v-14-ghosted/2026-09-12/','','scheduled','verified','Official exhibition page confirms the opening reception.',1,
       'public','Free.','["Public"]','not_required','No ticket is required.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_book_as_art_ghosted';

INSERT OR IGNORE INTO calendar_candidate_occurrences
  (id,candidate_id,source_event_id,occurrence_type,title,factual_description,date_kind,starts_at,ends_at,timezone,
   venue_name,venue_address,source_url,ticket_url,status,verification_state,verification_notes,sort_order,
   access_status,access_notes,audiences_json,ticket_status,ticket_notes,created_at,updated_at)
SELECT 'cal_occurrence_fall_2026_placita_closing',m.candidate_id,'placita-latina-closing-2026-10-23','opening_reception',
       'Placita Latina v.6: Puentes — Closing Reception','Closing reception for the exhibition.','timed','2026-10-23T18:00:00-04:00','2026-10-23T21:00:00-04:00','America/New_York',
       'Decatur Arts Alliance','113 Clairemont Avenue, Decatur, GA 30030','https://decaturartsalliance.org/event/placita-latina-v-6-puentes/2026-09-18/','','scheduled','verified','Official exhibition page confirms the closing reception.',1,
       'public','Free.','["Public"]','not_required','No ticket is required.',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_placita_latina';

-- Low Grit Grins is represented inside the fair record because related
-- occurrences cannot model a multi-day date range. Its official project page
-- remains a separately reviewable supporting link.
INSERT OR IGNORE INTO calendar_candidate_links
  (id,candidate_id,label,url,provenance_url,include_public,sort_order,link_role,credit_role,created_at,updated_at)
SELECT 'cal_link_fall_2026_low_grit_grins',m.candidate_id,'Low Grit Grins — Official Project Page',
       'https://theatlantaartfair.com/projects/low-grit-grins-antonio-darden-victoria-dugger-and-tori-tinsley/',
       'https://www.artsatl.org/the-2026-fall-arts-preview-our-picks-in-art-design/',1,10,'supporting','',datetime('now'),datetime('now')
FROM calendar_fall_2026_matches m WHERE m.stage_id='cal_candidate_fall_2026_atlanta_art_fair';

-- New candidates receive a normal pending Studio revision. Existing public
-- Atlanta Art Fair and Calida Rawles records receive a pending revision only
-- when no other Studio/source revision is already waiting. Chuck Stewart's
-- existing pending revision is deliberately preserved.
INSERT OR IGNORE INTO calendar_candidate_revisions
  (id,candidate_id,revision_number,revision_state,snapshot_json,provenance_json,change_summary,created_by,created_at,change_set_json)
SELECT
  'cal_revision_fall_2026_'||m.candidate_id,m.candidate_id,
  (SELECT COALESCE(MAX(revision_number),0)+1 FROM calendar_candidate_revisions WHERE candidate_id=m.candidate_id),
  'pending',
  json_object(
    'title',b.title,'organizer',b.organizer,'factualDescription',b.factual_description,'eventStructure',b.event_structure,
    'accessStatus',b.access_status,'accessNotes',b.access_notes,
    'audiences',json(CASE WHEN b.access_status='public' THEN '["Public"]' ELSE '[]' END),
    'dateKind',b.date_kind,'startsAt',b.starts_at,'endsAt',b.ends_at,'timezone','America/New_York',
    'venueName',b.venue_name,'venueAddress',b.venue_address,'city','Atlanta','region','GA',
    'subjects',json(b.subjects_json),'formats',json(b.formats_json),'experimental',json(iif(b.is_experimental=1,'true','false')),
    'sourceUrl',b.source_url,'ticketUrl',b.ticket_url,'scheduleStatus','scheduled','ticketStatus',b.ticket_status,
    'ticketOnSaleAt',NULL,'ticketNotes',b.ticket_notes,
    'discoveryUrl','https://www.artsatl.org/the-2026-fall-arts-preview-our-picks-in-art-design/',
    'organizerUrl',b.organizer_url,'venueUrl',b.venue_url,'sourceAuthority',b.source_authority,
    'sourceResolutionNotes','Official organizer, venue, museum, or authorized ticket information is canonical; ARTS ATL is private discovery provenance.',
    'relatedLinks',COALESCE((SELECT json_group_array(json_object(
      'id',l.id,'label',l.label,'url',l.url,'provenanceUrl',l.provenance_url,'role',l.link_role,'creditRole',l.credit_role,
      'includePublic',json(iif(l.include_public=1,'true','false'))
    )) FROM calendar_candidate_links l WHERE l.candidate_id=m.candidate_id),'[]'),
    'occurrences',COALESCE((SELECT json_group_array(json_object(
      'id',o.id,'sourceEventId',o.source_event_id,'occurrenceType',o.occurrence_type,'title',o.title,
      'factualDescription',o.factual_description,'dateKind',o.date_kind,'startsAt',o.starts_at,'endsAt',o.ends_at,
      'timezone',o.timezone,'venueName',o.venue_name,'venueAddress',o.venue_address,'sourceUrl',o.source_url,
      'ticketUrl',o.ticket_url,'status',o.status,'verificationState',o.verification_state,
      'verificationNotes',o.verification_notes,'accessStatus',o.access_status,'accessNotes',o.access_notes,
      'audiences',json(o.audiences_json),'ticketStatus',o.ticket_status,'ticketOnSaleAt',o.ticket_on_sale_at,
      'ticketNotes',o.ticket_notes,'sortOrder',o.sort_order
    )) FROM calendar_candidate_occurrences o WHERE o.candidate_id=m.candidate_id ORDER BY o.sort_order),'[]')
  ),
  json_array(
    json_object('url','https://www.artsatl.org/the-2026-fall-arts-preview-our-picks-in-art-design/','sourceId','cal_source_artsatl_fall_preview','verifiedAt','2026-08-21T00:00:00-04:00'),
    json_object('url',b.source_url,'sourceId',COALESCE((SELECT id FROM calendar_sources WHERE id=b.source_id),(SELECT id FROM calendar_sources WHERE lower(rtrim(url,'/'))=lower(rtrim(b.source_registry_url,'/')) LIMIT 1)),'verifiedAt',CASE WHEN b.verification_state='verified' THEN '2026-08-21T00:00:00-04:00' ELSE NULL END)
  ),
  CASE WHEN m.existed_before=1 THEN 'Official-source improvement from the Fall 2026 arts crawl; public facts remain unchanged until Approve + Update.'
       ELSE 'Imported from the Fall 2026 arts crawl into the private Studio approval queue.' END,
  'migration-0160',datetime('now'),'[]'
FROM calendar_fall_2026_candidates_stage b
JOIN calendar_fall_2026_matches m ON m.stage_id=b.id
JOIN calendar_candidates c ON c.id=m.candidate_id
WHERE c.pending_revision_id=''
  AND c.status NOT IN ('rejected','duplicate','cancelled')
  AND (m.existed_before=0 OR b.review_existing=1);

UPDATE calendar_candidates
SET pending_revision_id='cal_revision_fall_2026_'||id,updated_at=datetime('now')
WHERE pending_revision_id=''
  AND EXISTS (
    SELECT 1 FROM calendar_candidate_revisions r
    WHERE r.id='cal_revision_fall_2026_'||calendar_candidates.id
      AND r.revision_state='pending'
  );

DROP TABLE calendar_fall_2026_matches;
DROP TABLE calendar_fall_2026_candidates_stage;
DROP TABLE calendar_fall_2026_sources_stage;

PRAGMA foreign_keys = ON;
