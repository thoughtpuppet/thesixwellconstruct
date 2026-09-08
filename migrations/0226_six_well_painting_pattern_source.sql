PRAGMA foreign_keys = ON;

-- Gallery sets can present a close detail from canonical media without
-- creating a duplicate or altered image record. Standard sets are unchanged.
ALTER TABLE gallery_sets ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK(presentation_mode IN ('standard','detail-crop'));
ALTER TABLE gallery_sets ADD COLUMN presentation_focal_x REAL NOT NULL DEFAULT 0.5
  CHECK(presentation_focal_x>=0 AND presentation_focal_x<=1);
ALTER TABLE gallery_sets ADD COLUMN presentation_focal_y REAL NOT NULL DEFAULT 0.5
  CHECK(presentation_focal_y>=0 AND presentation_focal_y<=1);
ALTER TABLE gallery_sets ADD COLUMN presentation_aspect_ratio REAL NOT NULL DEFAULT 1
  CHECK(presentation_aspect_ratio>0);
ALTER TABLE gallery_sets ADD COLUMN presentation_zoom REAL NOT NULL DEFAULT 1
  CHECK(presentation_zoom>=1 AND presentation_zoom<=10);
ALTER TABLE gallery_sets ADD COLUMN presentation_alt_text TEXT NOT NULL DEFAULT '';

-- Publish an Archive dossier for the existing canonical artwork. This extends
-- the art entity; it does not create a duplicate painting identity.
INSERT OR IGNORE INTO archive_dossiers
  (entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
VALUES
  ('art-personification-of-truth','the-personification-of-truth','This painting contains the six-button arrangement that I later extracted as the SIX.WELL mark.','The figure''s vest carries six buttons in two columns of three. I later extracted that arrangement from this painting and used it as the SIX.WELL mark. The painting came first; the meaning around the pattern accumulated later as the name, the phrase “six wells,” and the culture-plate form aligned.','No separate process materials are public yet; the button detail is presented in the linked SIX.WELL CLOTHING timeline.','artwork','published',1,datetime('now'),'migration-0226','migration-0226',datetime('now'),datetime('now'));

UPDATE archive_dossiers
SET orientation=CASE WHEN trim(orientation)='' THEN 'This painting contains the six-button arrangement that I later extracted as the SIX.WELL mark.' ELSE orientation END,
    story=CASE
      WHEN instr(story,'I later extracted that arrangement from this painting')>0 THEN story
      WHEN trim(story)='' THEN 'The figure''s vest carries six buttons in two columns of three. I later extracted that arrangement from this painting and used it as the SIX.WELL mark. The painting came first; the meaning around the pattern accumulated later as the name, the phrase “six wells,” and the culture-plate form aligned.'
      ELSE story||char(10)||char(10)||'The figure''s vest carries six buttons in two columns of three. I later extracted that arrangement from this painting and used it as the SIX.WELL mark. The painting came first; the meaning around the pattern accumulated later as the name, the phrase “six wells,” and the culture-plate form aligned.'
    END,
    empty_materials_note='No separate process materials are public yet; the button detail is presented in the linked SIX.WELL CLOTHING timeline.',
    record_type='artwork',state='published',public_visible=1,
    published_at=COALESCE(published_at,datetime('now')),updated_by='migration-0226',updated_at=datetime('now')
WHERE entity_id='art-personification-of-truth';

-- Admit the existing canonical painting media to the Gallery as its original
-- creative master before the detail set references it.
INSERT OR IGNORE INTO content_entities
  (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-catalogue-media-art-personification-of-truth','media_asset',NULL,'internal',0,'migration-0226','migration-0226',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_catalogue_entries
  (media_id,entity_id,source_class,original_format,sha256,import_source,orientation,metadata_review_state,catalogue_state,admission_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-art-personification-of-truth','media-catalogue-media-art-personification-of-truth','creative','jpg','113647ea0b895903f1773bf96fe2abd6eb04f4fdb9f23bb7e37874d710492c6a','repository','portrait','reviewed','active','record','art-personification-of-truth','migration-0226','migration-0226',datetime('now'),datetime('now'));

UPDATE media_catalogue_entries
SET source_class='creative',original_format='jpg',sha256='113647ea0b895903f1773bf96fe2abd6eb04f4fdb9f23bb7e37874d710492c6a',
    import_source='repository',orientation='portrait',metadata_review_state='reviewed',
    catalogue_state='active',admission_basis='record',source_entity_id='art-personification-of-truth',
    updated_by='migration-0226',updated_at=datetime('now')
WHERE media_id='media-art-personification-of-truth';

UPDATE media_asset_provenance
SET sha256='113647ea0b895903f1773bf96fe2abd6eb04f4fdb9f23bb7e37874d710492c6a',
    originality='sixwell_original',asset_role='creative_master',creator_credit='The Six.Well Construct',
    original_format='jpg',import_source='repository',orientation='portrait',metadata_review_state='reviewed',
    updated_by='migration-0226',updated_at=datetime('now')
WHERE media_id='media-art-personification-of-truth';

INSERT OR IGNORE INTO gallery_entries
  (media_id,display_media_id,title,accessibility_text,accessibility_status,caption,credit,rights_status,date_precision,date_label,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
VALUES
  ('media-art-personification-of-truth','media-art-personification-of-truth','THE PERSONIFICATION OF TRUTH.','THE PERSONIFICATION OF TRUTH., a 2016 acrylic painting on wood panel showing a suited figure with a red face punctuated by black circular forms and six buttons on the vest.','described','Primary documentation of THE PERSONIFICATION OF TRUTH., 2016.','The Six.Well Construct','owned','year','2016','published',datetime('now'),'record','art-personification-of-truth','migration-0226','migration-0226',datetime('now'),datetime('now'));

UPDATE gallery_entries
SET display_media_id='media-art-personification-of-truth',title='THE PERSONIFICATION OF TRUTH.',
    accessibility_text='THE PERSONIFICATION OF TRUTH., a 2016 acrylic painting on wood panel showing a suited figure with a red face punctuated by black circular forms and six buttons on the vest.',
    accessibility_status='described',caption='Primary documentation of THE PERSONIFICATION OF TRUTH., 2016.',
    credit='The Six.Well Construct',rights_status='owned',date_precision='year',date_label='2016',
    state='published',published_at=COALESCE(published_at,datetime('now')),publication_basis='record',
    source_entity_id='art-personification-of-truth',updated_by='migration-0226',updated_at=datetime('now')
WHERE media_id='media-art-personification-of-truth';

INSERT OR IGNORE INTO gallery_entry_lenses(media_id,lens_id,sort_order,created_at)
VALUES ('media-art-personification-of-truth','gallery-lens-works',1,datetime('now'));

INSERT OR IGNORE INTO gallery_sets
  (id,slug,title,summary,set_type,cover_media_id,date_precision,date_label,state,published_at,sort_order,created_by,updated_by,created_at,updated_at,presentation_mode,presentation_focal_x,presentation_focal_y,presentation_aspect_ratio,presentation_zoom,presentation_alt_text)
VALUES
  ('gallery-set-six-well-button-pattern-detail','six-well-button-pattern-detail','The button pattern','A close-up of the six-button arrangement in the source painting.','series','media-art-personification-of-truth','year','Source painting · 2016','published',datetime('now'),2,'migration-0226','migration-0226',datetime('now'),datetime('now'),'detail-crop',0.513,0.88,0.732,4,'Close-up of the lower vest in THE PERSONIFICATION OF TRUTH., showing six painted buttons arranged in two columns and three rows.');

INSERT OR IGNORE INTO gallery_set_items(set_id,media_id,sort_order,created_at)
VALUES ('gallery-set-six-well-button-pattern-detail','media-art-personification-of-truth',1,datetime('now'));

INSERT OR IGNORE INTO entity_relationships
  (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
VALUES
  ('connection-six-well-logo-personification','org-six-well-clothing','art-personification-of-truth','rel-derived-from',1,'The SIX.WELL mark derives from the six-button arrangement on the painted figure''s vest.',10,'migration-0226',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO archive_timeline_blocks
  (id,timeline_id,chapter_id,block_type,source_id,title,body,excerpt,evidence_status,date_label,source_url,citation_label,media_behavior,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
VALUES
  ('six-well-block-button-pattern-detail','archive-timeline-six-well-clothing','six-well-act-transfer','gallery-set','gallery-set-six-well-button-pattern-detail','','','','documented','Source painting · 2016','/archive/records/the-personification-of-truth/','Open THE PERSONIFICATION OF TRUTH. Archive record','static','published',1,30,'migration-0226','migration-0226',datetime('now'),datetime('now'));

-- Keep the revised explanatory diagram metadata aligned with the file while
-- preserving the six-dot illustration and canonical logo unchanged.
UPDATE media_assets
SET byte_size=1760,
    alt_text='Diagram comparing the six-circle pattern extracted from the painting with a six-well culture plate.',
    caption='An original comparison diagram; the canonical logo remains unchanged.',
    updated_at=datetime('now')
WHERE id='media-six-well-culture-plate-diagram';

UPDATE media_catalogue_entries
SET sha256='722f901850cd5c56c6bc59de6f724af2c00be1f8f4cebe6458f649bb20f7a1ce',updated_by='migration-0226',updated_at=datetime('now')
WHERE media_id='media-six-well-culture-plate-diagram';

UPDATE gallery_entries
SET accessibility_text='Two side-by-side groups of six circles in three rows of two. The left is labeled pattern extracted from painting; the right is labeled six-well culture plate.',
    updated_by='migration-0226',updated_at=datetime('now')
WHERE media_id='media-six-well-culture-plate-diagram';

INSERT OR IGNORE INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
SELECT
  'revision-0226-personification-six-well-source','art-personification-of-truth',COALESCE(MAX(revision_number),0)+1,
  'archive-logo-source-documented',NULL,
  '{"archive_slug":"the-personification-of-truth","source_pattern":"six vest buttons","related_entity_id":"org-six-well-clothing","public":true}',
  'migration-0226',datetime('now')
FROM entity_revisions WHERE entity_id='art-personification-of-truth';

INSERT OR IGNORE INTO entity_revisions
  (id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
SELECT
  'revision-0226-six-well-personification-source','org-six-well-clothing',COALESCE(MAX(revision_number),0)+1,
  'relationship-create',NULL,
  '{"relationship_id":"connection-six-well-logo-personification","relationship_type":"derived-from","target_entity_id":"art-personification-of-truth","public":true}',
  'migration-0226',datetime('now')
FROM entity_revisions WHERE entity_id='org-six-well-clothing';
