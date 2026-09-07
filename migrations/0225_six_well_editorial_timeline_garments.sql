PRAGMA foreign_keys = ON;

-- Editorial timelines remain an additive presentation layer. Standard
-- timelines keep their existing generated chronology.
ALTER TABLE archive_timelines ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK(presentation_mode IN ('standard','editorial'));

ALTER TABLE archive_timeline_chapters ADD COLUMN chapter_role TEXT NOT NULL DEFAULT 'chapter'
  CHECK(chapter_role IN ('chapter','act','prologue','epilogue'));
ALTER TABLE archive_timeline_chapters ADD COLUMN eyebrow TEXT NOT NULL DEFAULT '';

CREATE TABLE archive_timeline_blocks (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  chapter_id TEXT,
  block_type TEXT NOT NULL
    CHECK(block_type IN ('activity','reflection','gallery-set','merch-item','collection-item','open-interval')),
  source_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  evidence_status TEXT NOT NULL DEFAULT 'documented'
    CHECK(evidence_status IN ('documented','remembered','approximate','open-interval')),
  date_label TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  citation_label TEXT NOT NULL DEFAULT '',
  media_behavior TEXT NOT NULL DEFAULT 'static'
    CHECK(media_behavior IN ('static','muted-loop')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(block_type='open-interval' OR source_id IS NOT NULL),
  FOREIGN KEY(timeline_id) REFERENCES archive_timelines(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES archive_timeline_chapters(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_timeline_blocks_public
  ON archive_timeline_blocks(timeline_id,chapter_id,state,public_visible,sort_order,created_at);
CREATE INDEX idx_archive_timeline_blocks_source
  ON archive_timeline_blocks(block_type,source_id,timeline_id);

-- A Journal entry's written date is always separate from the period it
-- reflects on. The memory note is private provenance and is never projected.
ALTER TABLE archive_notes ADD COLUMN is_reflection INTEGER NOT NULL DEFAULT 0
  CHECK(is_reflection IN (0,1));
ALTER TABLE archive_notes ADD COLUMN reflected_on_start TEXT;
ALTER TABLE archive_notes ADD COLUMN reflected_on_end TEXT;
ALTER TABLE archive_notes ADD COLUMN reflected_on_precision TEXT NOT NULL DEFAULT 'undated'
  CHECK(reflected_on_precision IN ('exact','approximate','year','range','undated'));
ALTER TABLE archive_notes ADD COLUMN reflected_on_label TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_notes ADD COLUMN reflection_memory_note TEXT NOT NULL DEFAULT '';

-- From the Archive is a selling context on the canonical Merch item, never an
-- Archive publication state. Historical price evidence remains independent
-- from the current Shopify-backed offer.
ALTER TABLE merch_items ADD COLUMN merch_context TEXT NOT NULL DEFAULT 'current'
  CHECK(merch_context IN ('current','from_archive'));
ALTER TABLE merch_items ADD COLUMN item_size TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN colorway TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN technique TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN period_label TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN condition_note TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN provenance_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN internal_provenance TEXT NOT NULL DEFAULT '';
ALTER TABLE merch_items ADD COLUMN historical_price_amount INTEGER;
ALTER TABLE merch_items ADD COLUMN historical_price_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE merch_items ADD COLUMN historical_price_note TEXT NOT NULL DEFAULT '';

-- Lightweight collection entries can later gain a dossier without receiving
-- a second identity. They intentionally have no public detail route.
CREATE TABLE archive_collection_items (
  entity_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL,
  period_label TEXT NOT NULL DEFAULT '',
  item_size TEXT NOT NULL DEFAULT '',
  colorway TEXT NOT NULL DEFAULT '',
  technique TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  provenance_summary TEXT NOT NULL DEFAULT '',
  internal_provenance TEXT NOT NULL DEFAULT '',
  media_id TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY(collection_id) REFERENCES archive_collections(id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_archive_collection_items_public
  ON archive_collection_items(collection_id,state,public_visible,sort_order,title);

-- Canonical public organization dossier and reusable permanent collection.
INSERT OR IGNORE INTO archive_dossiers
  (entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('org-six-well-clothing','six-well-clothing-identity','I use clothing as a distributed installation: the work changes as garments move through different people, places, and moments.','SIX.WELL CLOTHING began through making before I had a complete explanation for it. Hand-painted garments became repeated images, then screens and transfers, while the same six-part pattern kept resurfacing around the work. This dossier follows how I recognized that recurrence and chose to carry it forward.','Process evidence will be added as the original garments and recordings are recovered.','creative-identity','published',1,datetime('now'),'migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_timelines
  (id,subject_entity_id,slug,title,description,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,presentation_mode)
VALUES
  ('archive-timeline-six-well-clothing','org-six-well-clothing','six-well-clothing','SIX.WELL CLOTHING','I began by painting garments by hand. As methods changed, I kept noticing the same forms and ideas returning. This timeline follows how I recognized those patterns, learned to repeat them, and kept the work moving among people.','published',1,20,'migration-0225','migration-0225',datetime('now'),datetime('now'),'editorial');

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('archive-collection-permanent-garments','archive_collection','node-archive','public',1,datetime('now'),'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('archive-note-six-well-pattern-emergence','archive_note','node-archive','internal',0,NULL,'migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_collections
  (id,name,slug,description,state,sort_order,created_at,updated_at)
VALUES
  ('archive-collection-permanent-garments','SIX.WELL Permanent Garment Collection','six-well-permanent-garments','Garments retained as a permanent, non-saleable record of the clothing practice.','published',20,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_notes
  (entity_id,slug,title,note_type,source_app,body_markdown,excerpt,source_created_at,source_modified_at,date_label,provenance_note,state,public_visible,sort_order,published_at,created_by,updated_by,created_at,updated_at,is_reflection,reflected_on_start,reflected_on_end,reflected_on_precision,reflected_on_label,reflection_memory_note)
VALUES
  ('archive-note-six-well-pattern-emergence','six-well-pattern-emergence','When the pattern became a name','journal-entry','Studio','I did not begin with a brand system and work backward. I noticed a pattern in the buttons on the vest of the figure in *The Personification of Truth* and used that arrangement as a mark. Later, Kevin says “Well” six times and calls it “six wells” in *The Office* series finale. After that, I recognized the same arrangement in a six-well culture plate. Those moments did not prove anything on their own, but their recurrence felt true to how I work: a pattern emerges through practice, I recognize it, and then I decide to carry it forward. That is when the name and mark became fixed. The culture plate also gave me plain language for what the clothing had already been doing—cultivating culture as it moved between people.\n\nSource reference: [*The Office*, “Finale,” Season 9, Episode 23](https://www.peacocktv.com/watch-online/tv/the-office-superfan-episodes/8229469043710582112/seasons/9/episodes/finale-part-1-and-part-2-extended-cut-episode-23/f3a95467-6ef5-39c5-85a0-8e996b64fe22).','I noticed the same six-part pattern returning through a painting, a phrase, and a culture plate, and chose to carry it forward.','2026-09-07',NULL,'Written in reflection · September 2026','This first-person recollection distinguishes what I remember from what is separately documented.','draft',0,20,NULL,'migration-0225','migration-0225',datetime('now'),datetime('now'),1,NULL,NULL,'undated','Before and during the formation of SIX.WELL CLOTHING','The sequence and meaning are the creator’s present recollection. The painting and episode are independently identifiable; the precise dates of recognition remain undocumented.');

INSERT OR IGNORE INTO archive_note_links
  (note_entity_id,target_entity_id,relationship_role,is_primary,sort_order,public_visible,created_at)
VALUES
  ('archive-note-six-well-pattern-emergence','org-six-well-clothing','inception',1,1,0,datetime('now')),
  ('archive-note-six-well-pattern-emergence','art-personification-of-truth','reference',0,2,0,datetime('now'));

-- Original explanatory diagram. It compares the arrangements without
-- modifying or replacing the canonical SIX.WELL logo.
INSERT OR IGNORE INTO media_assets
  (id,source_url,original_filename,mime_type,byte_size,width,height,alt_text,caption,credit,rights_notes,privacy,state,created_by,created_at,updated_at,public_title,public_description,public_presentation)
VALUES
  ('media-six-well-culture-plate-diagram','/assets/archive/six-well-culture-plate-diagram.svg','six-well-culture-plate-diagram.svg','image/svg+xml',1740,1600,900,'Diagram comparing the six-circle arrangement recognized in the painting with a six-well culture plate.','An original comparison diagram; the canonical logo remains unchanged.','The Six.Well Construct','Original diagram created for the SIX.WELL CLOTHING timeline.','public','active','migration-0225',datetime('now'),datetime('now'),'Pattern / culture plate','The recurring six-part arrangement shown beside a standard six-well culture plate.','inline');

INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-catalogue-media-six-well-culture-plate-diagram','media_asset',NULL,'internal',0,'migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_catalogue_entries
  (media_id,entity_id,source_class,original_format,sha256,import_source,editing_software,orientation,raw_metadata_json,metadata_review_state,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-six-well-culture-plate-diagram','media-catalogue-media-six-well-culture-plate-diagram','creative','svg','6273ded34250bddb5c2de7fcd09c5fc3dc28fd7ed875e9d49e082796a44a81bc','repository','Code-native SVG','landscape','{"viewBox":"0 0 1600 900","embeddedCaptureDate":null,"gps":null,"device":null}','reviewed','active','editorial','org-six-well-clothing','migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_asset_provenance
  (media_id,originality,asset_role,creator_credit,original_format,import_source,metadata_review_state,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-six-well-culture-plate-diagram','sixwell_original','editorial_fragment','The Six.Well Construct','svg','repository','reviewed','migration-0225','migration-0225',datetime('now'),datetime('now'));

UPDATE media_asset_provenance
SET originality='sixwell_original',asset_role='editorial_fragment',creator_credit='The Six.Well Construct',
    original_format='svg',import_source='repository',metadata_review_state='reviewed',
    updated_by='migration-0225',updated_at=datetime('now')
WHERE media_id='media-six-well-culture-plate-diagram';

UPDATE media_catalogue_entries
SET sha256='6273ded34250bddb5c2de7fcd09c5fc3dc28fd7ed875e9d49e082796a44a81bc',catalogue_state='active',admission_basis='editorial',source_entity_id='org-six-well-clothing',updated_by='migration-0225',updated_at=datetime('now')
WHERE media_id='media-six-well-culture-plate-diagram';

INSERT OR IGNORE INTO gallery_entries
  (media_id,display_media_id,title,accessibility_text,accessibility_status,caption,credit,rights_status,date_precision,date_label,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-six-well-culture-plate-diagram','media-six-well-culture-plate-diagram','Pattern / culture plate','Two side-by-side groups of six circles in three rows of two. The left is labeled pattern recognized in the painting; the right is labeled six-well culture plate.','described','The same six-part arrangement, recognized in two different contexts.','The Six.Well Construct','owned','exact','2026','published',datetime('now'),'editorial','org-six-well-clothing','migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO gallery_entry_lenses(media_id,lens_id,sort_order,created_at)
VALUES ('media-six-well-culture-plate-diagram','gallery-lens-ephemera',1,datetime('now'));

INSERT OR IGNORE INTO gallery_sets
  (id,slug,title,summary,set_type,cover_media_id,date_precision,date_label,state,published_at,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('gallery-set-six-well-origin-diagram','six-well-origin-diagram','Pattern / culture plate','An original diagram showing the recurring arrangement without altering the canonical logo.','series','media-six-well-culture-plate-diagram','exact','2026','published',datetime('now'),1,'migration-0225','migration-0225',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO gallery_set_items(set_id,media_id,sort_order,created_at)
VALUES ('gallery-set-six-well-origin-diagram','media-six-well-culture-plate-diagram',1,datetime('now'));

INSERT OR IGNORE INTO archive_timeline_chapters
  (id,timeline_id,title,summary,body,date_precision,date_label,anchor_slug,dedupe_key,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,chapter_role,eyebrow)
VALUES
  ('six-well-act-before-name','archive-timeline-six-well-clothing','Before It Had a Name','The work began through the garment itself.','I was painting on clothing before I had a settled name for the practice. The six-part arrangement first became visible to me in the buttons on the vest of the figure in The Personification of Truth. I used that pattern as a mark before I knew everything it would come to mean.','undated','An opening period','before-it-had-a-name','six-well-before-name','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Origins'),
  ('six-well-act-collective-installation','archive-timeline-six-well-clothing','Clothing as Collective Installation','The work leaves the studio and is completed through circulation.','I understood the clothing as an installation distributed across the people who wore it. Later, a small joke in The Office finale gave me the phrase “six wells.” I recognized it because the pattern was already present in the work.','undated','An ongoing idea','clothing-as-collective-installation','six-well-collective-installation','published',1,20,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Intention'),
  ('six-well-act-painting','archive-timeline-six-well-clothing','Painting the Garment','Direct painting made every early piece singular.','I learned what the clothing could hold by painting directly on each garment.','undated','Early practice','painting-the-garment','six-well-painting','published',1,30,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Making'),
  ('six-well-act-repeat','archive-timeline-six-well-clothing','Learning to Repeat','Screen printing changed the rhythm from singular marks to repeatable images.','I moved into screen printing when I needed the image to repeat without losing the hand behind it.','undated','A later transition','learning-to-repeat','six-well-repeat','published',1,40,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Process'),
  ('six-well-act-transfer','archive-timeline-six-well-clothing','Moving the Image','Transfers made another kind of movement possible.','I began using transfers as the images, garments, and production needs changed. Around that later period, I recognized the same arrangement again in a six-well culture plate. The name, mark, and form had met from different directions.','undated','A later transition','moving-the-image','six-well-transfer','published',1,50,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Process'),
  ('six-well-act-circulation','archive-timeline-six-well-clothing','The Work in Circulation','The present practice carries all of those methods forward.','I now see each garment as both an object and a participant in a larger culture. “Cultivation of culture” names what the clothing had been doing all along: moving through people, gathering context, and helping a shared culture grow.','undated','Now and continuing','the-work-in-circulation','six-well-circulation','published',1,60,'migration-0225','migration-0225',datetime('now'),datetime('now'),'act','Present');

INSERT OR IGNORE INTO archive_timeline_blocks
  (id,timeline_id,chapter_id,block_type,source_id,title,body,excerpt,evidence_status,date_label,source_url,citation_label,media_behavior,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('six-well-block-origin-reflection','archive-timeline-six-well-clothing','six-well-act-before-name','reflection','archive-note-six-well-pattern-emergence','','','','remembered','Reflected on after the fact','','','static','draft',0,10,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-origin-diagram','archive-timeline-six-well-clothing','six-well-act-transfer','gallery-set','gallery-set-six-well-origin-diagram','','','','documented','Original diagram · 2026','','','static','published',1,20,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-installation-open','archive-timeline-six-well-clothing','six-well-act-collective-installation','open-interval',NULL,'Evidence still being gathered','I am gathering the early statements, installation photographs, and garments that show how this intention first took form.','','open-interval','Open interval','','','static','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-office-source','archive-timeline-six-well-clothing','six-well-act-collective-installation','open-interval',NULL,'The phrase I heard','In “Finale,” Season 9, Episode 23 of The Office, Kevin says “Well” six times and then calls it “six wells.” I am reserving this media position for a future eligible clip; no footage will appear here unless its source, rights, captions, and public eligibility are reviewed.','','documented','Broadcast May 16, 2013','https://www.peacocktv.com/watch-online/tv/the-office-superfan-episodes/8229469043710582112/seasons/9/episodes/finale-part-1-and-part-2-extended-cut-episode-23/f3a95467-6ef5-39c5-85a0-8e996b64fe22','The Office, Finale · Peacock','static','published',1,20,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-painting-open','archive-timeline-six-well-clothing','six-well-act-painting','open-interval',NULL,'Early painted garments','I am recovering the garments and process videos needed to date and describe this period without guessing.','','open-interval','Open interval','','','static','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-repeat-open','archive-timeline-six-well-clothing','six-well-act-repeat','open-interval',NULL,'Screen-printing record','I am organizing screens, tests, process video, and finished garments into a documented sequence.','','open-interval','Open interval','','','static','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-transfer-open','archive-timeline-six-well-clothing','six-well-act-transfer','open-interval',NULL,'Transfer process','I am identifying the first transfer pieces and the production decisions that connect them.','','open-interval','Open interval','','','static','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now')),
  ('six-well-block-circulation-open','archive-timeline-six-well-clothing','six-well-act-circulation','open-interval',NULL,'A living record','I will keep adding garments, sales objects, permanent collection pieces, and reflections as their evidence is reviewed.','','open-interval','Now and continuing','/archive/collections/six-well-permanent-garments/','Open the permanent garment collection','static','published',1,10,'migration-0225','migration-0225',datetime('now'),datetime('now'));
