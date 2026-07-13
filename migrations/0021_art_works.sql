PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS art_series (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS art_works (
  id TEXT PRIMARY KEY, series_id TEXT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, statement TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '', medium TEXT NOT NULL DEFAULT '', dimensions TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL CHECK (availability IN ('available','not-for-sale','sold','unavailable')),
  acquisition_eligible INTEGER NOT NULL DEFAULT 0 CHECK (acquisition_eligible IN (0,1)),
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired','archived')),
  legacy_path TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES content_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (series_id) REFERENCES art_series(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_art_works_public ON art_works(state, availability, sort_order);

INSERT OR IGNORE INTO content_entities (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at) VALUES
('art-marbles','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now')),
('art-lust','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now')),
('art-sloth','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now')),
('art-homeland-security','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now')),
('art-inner-chaos','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now')),
('art-paranoia-trauma','art_work','art','public',1,datetime('now'),'migration-0021','migration-0021',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO art_works (id,slug,title,year,medium,availability,acquisition_eligible,legacy_path,sort_order,created_at,updated_at) VALUES
('art-marbles','lostmarbles','AM I LOSING MY MARBLES OR HIDING THEM?','2023','Acrylic on wood panel','available',1,'/art/lostmarblespainting.html',1,datetime('now'),datetime('now')),
('art-lust','lust','LUST.','2023','Acrylic on wood panel','available',1,'/art/lustpainting.html',2,datetime('now'),datetime('now')),
('art-sloth','sloth','SLOTH.','','Painting','not-for-sale',0,'/art/slothpainting.html',3,datetime('now'),datetime('now')),
('art-homeland-security','homeland-security','HOMELAND SECURITY.','','Painting','available',1,'/art/homelandsecuritypainting.html',4,datetime('now'),datetime('now')),
('art-inner-chaos','the-frustrations-of-inner-chaos','THE FRUSTRATIONS OF INNER CHAOS.','','Painting','sold',0,'/art/thefrustrationsofinnercharospainting.html',5,datetime('now'),datetime('now')),
('art-paranoia-trauma','paranoia-and-fostered-trauma','PARANOIA & FOSTERED TRAUMA.','','Painting','available',1,'/art/paranoiafosteredtraumapainting.html',6,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_assets (id,source_url,original_filename,mime_type,alt_text,privacy,state,created_by,created_at,updated_at) VALUES
('media-art-marbles','/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg','am-i-losing-my-marbles-or-hiding-them.jpg','image/jpeg','AM I LOSING MY MARBLES OR HIDING THEM?, acrylic on wood panel, 2023','public','active','migration-0021',datetime('now'),datetime('now')),
('media-art-lust','/assets/paintings/LUST.JPG','LUST.JPG','image/jpeg','LUST., acrylic on wood panel, 2023','public','active','migration-0021',datetime('now'),datetime('now')),
('media-art-sloth','/assets/paintings/SLOTH.JPG','SLOTH.JPG','image/jpeg','SLOTH., painting','public','active','migration-0021',datetime('now'),datetime('now')),
('media-art-homeland-security','/assets/paintings/HOMELAND SECURITY.jpg','HOMELAND SECURITY.jpg','image/jpeg','HOMELAND SECURITY., painting','public','active','migration-0021',datetime('now'),datetime('now')),
('media-art-inner-chaos','/assets/paintings/THE FRUSTRATIONS OF INNER CHAOS.jpg','THE FRUSTRATIONS OF INNER CHAOS.jpg','image/jpeg','THE FRUSTRATIONS OF INNER CHAOS., painting','public','active','migration-0021',datetime('now'),datetime('now')),
('media-art-paranoia-trauma','/assets/paintings/PARANOIA & FOSTERED TRAUMA.jpg','PARANOIA & FOSTERED TRAUMA.jpg','image/jpeg','PARANOIA & FOSTERED TRAUMA., painting','public','active','migration-0021',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO entity_media (entity_id,media_id,role,sort_order,public_visible,created_at)
SELECT replace(id,'media-',''),id,'primary',1,1,datetime('now') FROM media_assets WHERE id LIKE 'media-art-%';
