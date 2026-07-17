PRAGMA foreign_keys = ON;

-- Curated provenance groups shared by Archive dossiers and their evidence.
-- Membership is authored in Studio; it is never inferred from loose graph edges.
CREATE TABLE IF NOT EXISTS archive_origin_threads (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_origin_threads_public
  ON archive_origin_threads(state, public_visible, sort_order, title);

CREATE TABLE IF NOT EXISTS archive_origin_thread_dossiers (
  thread_id TEXT NOT NULL,
  dossier_entity_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(thread_id, dossier_entity_id),
  FOREIGN KEY(thread_id) REFERENCES archive_origin_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(dossier_entity_id) REFERENCES archive_dossiers(entity_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_origin_thread_primary_dossier
  ON archive_origin_thread_dossiers(dossier_entity_id) WHERE is_primary=1;
CREATE INDEX IF NOT EXISTS idx_archive_origin_thread_dossiers_thread
  ON archive_origin_thread_dossiers(thread_id, sort_order, dossier_entity_id);

CREATE TABLE IF NOT EXISTS archive_origin_thread_materials (
  thread_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(thread_id, material_id),
  FOREIGN KEY(thread_id) REFERENCES archive_origin_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(material_id) REFERENCES archive_materials(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_origin_thread_materials_thread
  ON archive_origin_thread_materials(thread_id, sort_order, material_id);

-- First complete thread: the source painting, its apparel derivative, and any
-- already-approved public notebook evidence attached to either dossier.
INSERT OR IGNORE INTO archive_origin_threads
  (id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('origin-thread-lost-marbles','lost-marbles','Lost Marbles','The notes, source material, finished painting, and later records that grew from the Lost Marbles inception.','published',1,1,'migration-0046','migration-0046',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_origin_thread_dossiers
  (thread_id,dossier_entity_id,is_primary,sort_order,created_at)
SELECT 'origin-thread-lost-marbles',ad.entity_id,1,
  CASE ad.entity_id WHEN 'art-marbles' THEN 1 ELSE 2 END,datetime('now')
FROM archive_dossiers ad
WHERE ad.entity_id IN ('art-marbles','merch-lostmarbles-hoodie');

INSERT OR IGNORE INTO archive_origin_thread_materials
  (thread_id,material_id,sort_order,created_at)
SELECT 'origin-thread-lost-marbles',am.id,am.sort_order,datetime('now')
FROM archive_materials am
WHERE am.dossier_entity_id IN ('art-marbles','merch-lostmarbles-hoodie')
  AND am.state='published' AND am.visibility='public';
