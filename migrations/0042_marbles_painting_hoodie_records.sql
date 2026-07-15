PRAGMA foreign_keys = ON;

-- Turn the existing Lost Marbles seed identities into a publish-ready anchor
-- record and one approved derivative record. Shopify remains authoritative for
-- hoodie pricing, inventory, variants, checkout, and product photography.

UPDATE content_entities
SET
  node_id='node-art',
  visibility='public',
  search_visibility=1,
  public_at=COALESCE(public_at,datetime('now')),
  internal_notes=CASE
    WHEN instr(internal_notes,'Dimensions remain unconfirmed')>0 THEN internal_notes
    ELSE trim(internal_notes || char(10) || 'Canonical anchor record for the Lost Marbles work. Dimensions remain unconfirmed and should be added only after checking the physical painting or its source documentation.')
  END,
  updated_by='migration-0042',
  updated_at=datetime('now')
WHERE id='art-marbles';

UPDATE art_works
SET
  slug='lostmarbles',
  title='AM I LOSING MY MARBLES OR HIDING THEM?',
  statement=CASE
    WHEN trim(statement)='' THEN 'A figure dissolving into colour. Dot by dot, something that was solid becomes scattered.'
    ELSE statement
  END,
  year='2023',
  medium='Acrylic on wood panel',
  availability='available',
  acquisition_eligible=1,
  state='published',
  legacy_path='/art/lostmarblespainting.html',
  updated_at=datetime('now')
WHERE id='art-marbles';

UPDATE media_assets
SET
  source_url='/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg',
  original_filename='am-i-losing-my-marbles-or-hiding-them.jpg',
  mime_type='image/jpeg',
  alt_text='AM I LOSING MY MARBLES OR HIDING THEM?, acrylic on wood panel, 2023',
  caption='Primary documentation of AM I LOSING MY MARBLES OR HIDING THEM?, 2023.',
  privacy='public',
  consent_status='not-required',
  state='active',
  updated_at=datetime('now')
WHERE id='media-art-marbles';

INSERT OR IGNORE INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
VALUES
  ('art-marbles','media-art-marbles','primary',1,1,'AM I LOSING MY MARBLES OR HIDING THEM?, acrylic on wood panel, 2023','Primary documentation of the 2023 painting.',datetime('now'));

UPDATE content_entities
SET
  node_id='node-merch',
  visibility='public',
  search_visibility=1,
  public_at=COALESCE(public_at,datetime('now')),
  internal_notes=CASE
    WHEN instr(internal_notes,'Product photography is not present')>0 THEN internal_notes
    ELSE trim(internal_notes || char(10) || 'Derivative record of art-marbles. Published page identifies a beige, hand-numbered edition of 30. Shopify remains authoritative for variants, price, inventory, checkout, and product media. Product photography is not present in the repository and must not be substituted with the painting image.')
  END,
  updated_by='migration-0042',
  updated_at=datetime('now')
WHERE id='merch-lostmarbles-hoodie';

UPDATE merch_items
SET
  shopify_handle='lostmarbles-hoodie',
  title='LOST MARBLES. Hoodie',
  product_type='apparel',
  state='published',
  route='/merch/lostmarbles-hoodie.html',
  image_url='',
  alt_text='LOST MARBLES. Hoodie, a limited apparel edition derived from AM I LOSING MY MARBLES OR HIDING THEM?',
  updated_at=datetime('now')
WHERE id='merch-lostmarbles-hoodie';

-- Controlled terms are earned from the already-published painting metadata.
INSERT OR IGNORE INTO taxonomy_terms
  (id,kind,name,slug,description,public_visible,sort_order,created_at,updated_at)
VALUES
  ('theme-lost-marbles','theme','Lost Marbles','lost-marbles','Works and derivatives that originate in the Lost Marbles painting and its symbolic vocabulary.',1,10,datetime('now'),datetime('now')),
  ('tag-figure','tag','Figure','figure','Figural imagery.',1,20,datetime('now'),datetime('now')),
  ('tag-dots','tag','Dots','dots','Dot-based marks or fields.',1,21,datetime('now'),datetime('now')),
  ('tag-eyes','tag','Eyes','eyes','Eye imagery or the act of watching.',1,22,datetime('now'),datetime('now')),
  ('tag-dissolution','tag','Dissolution','dissolution','Forms becoming scattered, unstable, or less contained.',1,23,datetime('now'),datetime('now')),
  ('tag-memory','tag','Memory','memory','Memory as subject, structure, or residue.',1,24,datetime('now'),datetime('now')),
  ('tag-colour','tag','Colour','colour','Colour used as an active visual or conceptual element.',1,25,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO entity_terms (entity_id,term_id,created_at) VALUES
  ('art-marbles','theme-lost-marbles',datetime('now')),
  ('art-marbles','tag-figure',datetime('now')),
  ('art-marbles','tag-dots',datetime('now')),
  ('art-marbles','tag-eyes',datetime('now')),
  ('art-marbles','tag-dissolution',datetime('now')),
  ('art-marbles','tag-memory',datetime('now')),
  ('art-marbles','tag-colour',datetime('now')),
  ('merch-lostmarbles-hoodie','theme-lost-marbles',datetime('now'));

-- Direct migrations do not pass through the Studio save hook, so refresh the
-- public search document explicitly from the canonical row.
INSERT INTO search_documents
  (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
SELECT
  aw.id,
  'art_work',
  'art',
  aw.slug,
  aw.title,
  aw.statement,
  '',
  aw.state,
  '',
  COALESCE((
    SELECT group_concat(tt.name, ', ')
    FROM entity_terms et
    JOIN taxonomy_terms tt ON tt.id=et.term_id
    WHERE et.entity_id=aw.id AND tt.kind='theme' AND tt.public_visible=1
  ),''),
  '',
  '',
  aw.year,
  aw.legacy_path,
  datetime('now')
FROM art_works aw
WHERE aw.id='art-marbles'
ON CONFLICT(entity_id) DO UPDATE SET
  entity_type=excluded.entity_type,
  node_id=excluded.node_id,
  slug=excluded.slug,
  title=excluded.title,
  summary=excluded.summary,
  body=excluded.body,
  state=excluded.state,
  collection_labels=excluded.collection_labels,
  theme_labels=excluded.theme_labels,
  person_labels=excluded.person_labels,
  place_labels=excluded.place_labels,
  date_label=excluded.date_label,
  route=excluded.route,
  updated_at=excluded.updated_at;

-- This is the approved public association requested for the record pair.
UPDATE entity_relationships
SET
  public_visible=1,
  internal_notes='Approved canonical derivative relationship: the hoodie is derived from the Lost Marbles painting.',
  sort_order=1,
  updated_at=datetime('now')
WHERE id='connection-marbles-hoodie-art';

-- The existing archive source thread documents the anchor record; keep the
-- other Marbles seeds private until each one becomes the active publishing job.
UPDATE entity_relationships
SET
  public_visible=1,
  internal_notes='The Marbles Source Thread documents the painting and its cross-medium symbolic lineage.',
  sort_order=2,
  updated_at=datetime('now')
WHERE id='connection-marbles-art-archive';

INSERT OR IGNORE INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
SELECT
  'revision-0042-art-marbles',
  'art-marbles',
  COALESCE(MAX(revision_number),0)+1,
  'canonical-record-completed',
  NULL,
  '{"record":"art-marbles","role":"anchor","status":"published","known_gaps":["dimensions"]}',
  'migration-0042',
  datetime('now')
FROM entity_revisions
WHERE entity_id='art-marbles';

INSERT OR IGNORE INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
SELECT
  'revision-0042-merch-lostmarbles-hoodie',
  'merch-lostmarbles-hoodie',
  COALESCE(MAX(revision_number),0)+1,
  'associated-record-completed',
  NULL,
  '{"record":"merch-lostmarbles-hoodie","role":"derivative","source":"art-marbles","status":"published","known_gaps":["product photography"]}',
  'migration-0042',
  datetime('now')
FROM entity_revisions
WHERE entity_id='merch-lostmarbles-hoodie';
