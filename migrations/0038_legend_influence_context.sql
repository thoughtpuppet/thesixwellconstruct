PRAGMA foreign_keys = ON;

-- Cultural lineage, lived experience, and deliberate reorientation are
-- interpretive layers. They can overlap without changing a symbol's category.
ALTER TABLE visual_symbols ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';

-- The Cross is intentionally a Studio draft until the artist supplies the
-- final Illustrator SVG. No generic stand-in should enter the public Legend.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
VALUES
  ('rit-cross','visual_symbol','node-legend','internal',0,'migration-0038','migration-0038',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO visual_symbols
  (id,category_id,slug,name,meaning,svg_markup,themes_json,context_json,examples_json,state,sort_order,created_at,updated_at)
VALUES (
  'rit-cross',
  'ritual',
  'cross',
  'The Cross',
  'Faith as an active commitment: faith in myself, my mission, my relationships, or in something beyond me.',
  '',
  '["faith","devotion","purpose"]',
  '{"modes":["cultural","personal","reoriented"],"cultural_context":"Within many Christian traditions, the cross is associated with the Crucifixion, devotion, and Christian faith. Cross forms and meanings also vary across histories and communities.","personal_relationship":"My relationship to this form is not limited to religious affiliation. I use it to hold faith in myself, my mission, my relationships, and the commitments that keep me moving.","reorientation":{"mode":"expanded","statement":"I retain the inherited charge of belief and devotion while opening what that faith may be placed in."},"overlap_or_tension":"The association with devotion remains; the object of devotion is deliberately left open.","viewer_opening":"It may be encountered as religious faith, secular faith, self-trust, or shared purpose.","sources":[{"title":"The Art of Africa: A Resource for Educators","creator":"The Metropolitan Museum of Art","url":"https://www.metmuseum.org/zh/-/media/files/learn/for-educators/publications-for-educators/the-art-of-africa.pdf","note":"Context for the adaptation and transformation of cross imagery in Kongo visual and spiritual traditions."},{"title":"Metropolitan Museum Journal, Volume 56","creator":"The Metropolitan Museum of Art","url":"https://resources.metmuseum.org/resources/metpublications/pdf/Metropolitan_Museum_Journal_v_56_2021.pdf","note":"Context for devotional, protective, and talismanic readings of the cross in Ethiopian Christian material culture."}]}',
  '[]',
  'draft',
  6,
  datetime('now'),
  datetime('now')
);

-- Rebuild the extra full-text layer so existing published records keep their
-- application/variant/appearance text after the schema change.
UPDATE search_documents
SET body = COALESCE((
  SELECT visual_symbols.applications_json || ' ' || visual_symbols.variants_json || ' ' || visual_symbols.examples_json || ' ' || visual_symbols.context_json
  FROM visual_symbols
  WHERE visual_symbols.id = search_documents.entity_id
), body),
updated_at = datetime('now')
WHERE entity_type = 'visual_symbol';
