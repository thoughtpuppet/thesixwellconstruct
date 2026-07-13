PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS flash_series (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','retired','archived')),
  merch_status TEXT NOT NULL DEFAULT 'none', merch_url TEXT NOT NULL DEFAULT '', related_nodes_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flash_items (
  id TEXT PRIMARY KEY, series_id TEXT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','available','reserved','placed','retired','archived')),
  size_bucket TEXT NOT NULL DEFAULT '', price_label TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT 'individual',
  claimable INTEGER NOT NULL DEFAULT 0 CHECK (claimable IN (0,1)), sheet_code TEXT NOT NULL DEFAULT '', design_code TEXT NOT NULL DEFAULT '',
  legacy_path TEXT NOT NULL DEFAULT '', merch_status TEXT NOT NULL DEFAULT 'none', merch_url TEXT NOT NULL DEFAULT '',
  related_nodes_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (series_id) REFERENCES flash_series(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_flash_items_public ON flash_items(state, series_id, sort_order);

CREATE TABLE IF NOT EXISTS visual_symbol_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visual_symbols (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, meaning TEXT NOT NULL,
  svg_markup TEXT NOT NULL, themes_json TEXT NOT NULL DEFAULT '[]', examples_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES visual_symbol_categories(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_visual_symbols_public ON visual_symbols(state, category_id, sort_order);

INSERT OR IGNORE INTO content_entities (id,entity_type,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at) VALUES
('maze','flash_series','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('sairoglyphs','flash_series','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('standalones','flash_series','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO flash_series (id,name,slug,description,state,merch_status,sort_order,created_at,updated_at) VALUES
('maze','MAZE','maze','A symbolic series built from looping paths, blocked routes, memory, and movement through impossible rooms.','published','coming soon',1,datetime('now'),datetime('now')),
('sairoglyphs','Sairoglyphs','sairoglyphs','A private writing system of letters, marks, and symbolic language developed for tattoo-scale translation.','published','coming soon',2,datetime('now'),datetime('now')),
('standalones','Standalones','standalones','Single drawings and flash studies that live outside a larger series but still carry the Art.Pill visual language.','published','optional',3,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO content_entities (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at) VALUES
('ap-flash-001','flash_item','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('ap-maze-001','flash_item','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('ap-standalone-001','flash_item','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('ap-sairo-001','flash_item','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('ap-standalone-archive-001','flash_item','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO flash_items (id,series_id,slug,title,description,state,size_bucket,price_label,item_type,claimable,sheet_code,design_code,legacy_path,merch_status,merch_url,sort_order,created_at,updated_at) VALUES
('ap-flash-001','standalones','ap-flash-001','AP Flash Sheet 01','A sheet of claimable small and medium flash studies. Include the letter code from the sheet when claiming.','available','Small','Small / Medium pricing by selected design','sheet',1,'AP-01','','/tattoos/flash/ap-flash-001/','none','',1,datetime('now'),datetime('now')),
('ap-maze-001','maze','ap-maze-001','MAZE Series Study','A MAZE study used as a visual placeholder for the series language. Future MAZE flash and related merch will live here.','retired','Large','Archive / not currently claimable','individual',0,'','MAZE-ARCHIVE-01','/tattoos/flash/ap-maze-001/','coming soon','/merch/?filter=art.pill',2,datetime('now'),datetime('now')),
('ap-standalone-001','standalones','ap-standalone-001','Coparent','A larger standalone design with related merch planned. Best suited for a larger placement with room for the full narrative.','available','Large','Large pricing by placement','individual',1,'','STAND-CP-01','/tattoos/flash/ap-standalone-001/','coming soon','/merch/?filter=art.pill',3,datetime('now'),datetime('now')),
('ap-sairo-001','sairoglyphs','ap-sairo-001','Sairoglyph Placeholder Study','Placeholder card for Sairoglyph-based flash. Final title, symbol meaning, and claim status can be revised later.','available','Medium','Medium pricing by placement','individual',1,'','SAIRO-PLACEHOLDER-01','/tattoos/flash/ap-sairo-001/','coming soon','',4,datetime('now'),datetime('now')),
('ap-standalone-archive-001','standalones','ap-standalone-archive-001','Standalone Archive Study','Past standalone placeholder. Kept in the archive so clients can understand the range without assuming it is available.','retired','Medium','Archive / not currently claimable','individual',0,'','STAND-ARCHIVE-01','/tattoos/flash/ap-standalone-archive-001/','none','',5,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_assets (id,source_url,original_filename,mime_type,alt_text,privacy,state,created_by,created_at,updated_at) VALUES
('media-ap-flash-001','/assets/flash/IMG_1745.jpg','IMG_1745.jpg','image/jpeg','AP Flash Sheet 01','public','active','migration-0020',datetime('now'),datetime('now')),
('media-ap-maze-001','/assets/flash/IMG_8898.jpg','IMG_8898.jpg','image/jpeg','MAZE Series Study','public','active','migration-0020',datetime('now'),datetime('now')),
('media-ap-standalone-001','/assets/flash/COPARENT.png','COPARENT.png','image/png','Coparent flash design','public','active','migration-0020',datetime('now'),datetime('now')),
('media-ap-sairo-001','/assets/flash/IMG_0356.jpg','IMG_0356.jpg','image/jpeg','Sairoglyph placeholder study','public','active','migration-0020',datetime('now'),datetime('now')),
('media-ap-standalone-archive-001','/assets/flash/IMG_4583.JPG','IMG_4583.JPG','image/jpeg','Standalone archive study','public','active','migration-0020',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO entity_media (entity_id,media_id,role,sort_order,public_visible,created_at)
SELECT replace(id,'media-',''),id,'primary',1,1,datetime('now') FROM media_assets WHERE id IN ('media-ap-flash-001','media-ap-maze-001','media-ap-standalone-001','media-ap-sairo-001','media-ap-standalone-archive-001');

INSERT OR IGNORE INTO visual_symbol_categories (id,name,slug,sort_order,created_at,updated_at) VALUES
('maze','MAZE','maze',1,datetime('now'),datetime('now')),('sairoglyphs','Sairoglyphs','sairoglyphs',2,datetime('now'),datetime('now')),
('figural','Figural','figural',3,datetime('now'),datetime('now')),('ritual','Ritual','ritual',4,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO content_entities (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at) VALUES
('maze-path','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('maze-room','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('maze-exit','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('maze-threshold','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('sairo-origin','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('sairo-double','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('sairo-hold','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('sairo-carry','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('fig-eye','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('fig-hand','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('fig-figure','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('fig-dissolve','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),
('rit-dot','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('rit-thread','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('rit-vessel','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now')),('rit-signal','visual_symbol','tattooing','public',1,datetime('now'),'migration-0020','migration-0020',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO visual_symbols (id,category_id,slug,name,meaning,svg_markup,themes_json,examples_json,sort_order,created_at,updated_at) VALUES
('maze-path','maze','maze-path','The Path','A route that loops back. For those who return to the same place until the meaning shifts.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M22 24 H82 V52 H42 V80 H100"/></svg>','["return","movement","memory"]','[]',1,datetime('now'),datetime('now')),
('maze-room','maze','maze-room','The Room','An enclosed space. It holds something without releasing it.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M48 92 H28 V28 H92 V92 H72"/><circle cx="60" cy="60" r="8" fill="currentColor"/></svg>','["protection","containment","privacy"]','[]',2,datetime('now'),datetime('now')),
('maze-exit','maze','maze-exit','The Exit','The way out that may or may not open when you reach it.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M44 26 V94 M44 26 H72 M44 94 H72 M52 60 H96 M83 47 L96 60 L83 73"/></svg>','["threshold","release","choice"]','[]',3,datetime('now'),datetime('now')),
('maze-threshold','maze','maze-threshold','The Threshold','The boundary between two states, made permanent on the body.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M30 90 V34 H90 V90 M20 90 H100 M60 90 V58"/></svg>','["threshold","transition","protection"]','[]',4,datetime('now'),datetime('now')),
('sairo-origin','sairoglyphs','sairo-origin','Origin Mark','First glyph in the private alphabet. Beginning. The first line drawn.','<svg viewBox="0 0 120 120"><circle cx="60" cy="32" r="9" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="8" d="M60 46 V96"/></svg>','["beginning","identity","presence"]','[]',5,datetime('now'),datetime('now')),
('sairo-double','sairoglyphs','sairo-double','The Double','Reflection or echo. Two things that are the same, seen from different sides.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M44 28 V92 M76 28 V92 M44 60 Q60 76 76 60"/></svg>','["reflection","duality","memory"]','[]',6,datetime('now'),datetime('now')),
('sairo-hold','sairoglyphs','sairo-hold','The Hold','A binding mark. What keeps something close without crushing it.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M42 28 H28 V92 H42 M78 28 H92 V92 H78"/><circle cx="60" cy="60" r="10" fill="currentColor"/></svg>','["protection","binding","devotion"]','[]',7,datetime('now'),datetime('now')),
('sairo-carry','sairoglyphs','sairo-carry','The Carry','Movement across time. A thing brought from one place and held in another.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="8" d="M22 68 H94 M80 54 L94 68 L80 82"/><circle cx="42" cy="42" r="9" fill="currentColor"/></svg>','["movement","memory","inheritance"]','[]',8,datetime('now'),datetime('now')),
('fig-eye','figural','fig-eye','The Eye','Witness. Something that sees and keeps seeing long after the moment passes.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="7" d="M16 60 Q60 26 104 60 Q60 94 16 60 Z"/><circle cx="60" cy="60" r="15" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="60" cy="60" r="6" fill="currentColor"/></svg>','["witness","protection","truth"]','[{"src":"/assets/eyes/openeye.png","title":"Open Eye (study)"}]',9,datetime('now'),datetime('now')),
('fig-hand','figural','fig-hand','The Hand','What makes. What holds. What releases. The mark of the maker.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="7" d="M40 94 V62 H82 V94 M48 62 V44 M61 62 V40 M74 62 V48 M40 74 H28"/></svg>','["making","care","release"]','[]',10,datetime('now'),datetime('now')),
('fig-figure','figural','fig-figure','The Figure','A body moving through meaning. Not arrived - always in transit.','<svg viewBox="0 0 120 120"><circle cx="60" cy="28" r="10" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="8" d="M60 38 V70 M60 50 L44 62 M60 50 L78 56 M60 70 L46 96 M60 70 L76 94"/></svg>','["body","movement","becoming"]','[]',11,datetime('now'),datetime('now')),
('fig-dissolve','figural','fig-dissolve','Dissolution','The moment something stops being solid. Not loss - transformation.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="7" d="M26 42 H60 M26 62 H54"/><g fill="currentColor"><circle cx="74" cy="42" r="4.5"/><circle cx="90" cy="46" r="3"/><circle cx="70" cy="64" r="3.5"/><circle cx="86" cy="70" r="2.5"/></g></svg>','["transformation","release","grief"]','[]',12,datetime('now'),datetime('now')),
('rit-dot','ritual','rit-dot','The Dot','The smallest unit of presence. A mark that says: I was here.','<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="14" fill="currentColor"/></svg>','["presence","identity","witness"]','[]',13,datetime('now'),datetime('now')),
('rit-thread','ritual','rit-thread','The Thread','A line connecting two things across distance. Memory, or obligation.','<svg viewBox="0 0 120 120"><circle cx="30" cy="38" r="9" fill="currentColor"/><circle cx="90" cy="84" r="9" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="7" d="M34 45 Q72 50 86 77"/></svg>','["connection","memory","devotion"]','[]',14,datetime('now'),datetime('now')),
('rit-vessel','ritual','rit-vessel','The Vessel','What holds without spilling. Container of the unnamed thing.','<svg viewBox="0 0 120 120"><path fill="none" stroke="currentColor" stroke-width="7" d="M34 34 H86 L79 82 Q60 96 41 82 Z M34 34 Q60 50 86 34"/></svg>','["containment","protection","body"]','[{"src":"/assets/paintings/PAINTING CONTAINER.JPG","title":"Painting Container"}]',15,datetime('now'),datetime('now')),
('rit-signal','ritual','rit-signal','The Signal','What you send out, not knowing if it will return.','<svg viewBox="0 0 120 120"><circle cx="60" cy="80" r="7" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="7" d="M40 64 Q60 46 80 64 M30 52 Q60 22 90 52"/></svg>','["calling","hope","return"]','[]',16,datetime('now'),datetime('now'));
