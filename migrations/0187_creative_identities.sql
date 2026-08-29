PRAGMA foreign_keys = ON;

-- Creative identities are opt-in profiles on canonical organizations. Their
-- lifecycle describes the identity; publication and visibility independently
-- control whether an About profile can enter a public payload.
CREATE TABLE about_identity_profiles (
  organization_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind_label TEXT NOT NULL DEFAULT 'Creative identity',
  lifecycle_status TEXT NOT NULL DEFAULT 'forming'
    CHECK(lifecycle_status IN ('forming','active','dormant','retired','evolved')),
  origin_date_label TEXT NOT NULL DEFAULT '',
  hero_descriptor TEXT NOT NULL DEFAULT '',
  current_role TEXT NOT NULL DEFAULT '',
  origin_body TEXT NOT NULL DEFAULT '',
  return_body TEXT NOT NULL DEFAULT '',
  timeline_id TEXT,
  current_symbol_id TEXT,
  origin_thread_id TEXT,
  featured_origin_entity_id TEXT,
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK(visibility IN ('public','unlisted','internal','private')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(timeline_id) REFERENCES archive_timelines(id) ON DELETE SET NULL,
  FOREIGN KEY(current_symbol_id) REFERENCES visual_symbols(id) ON DELETE SET NULL,
  FOREIGN KEY(origin_thread_id) REFERENCES archive_origin_threads(id) ON DELETE SET NULL,
  FOREIGN KEY(featured_origin_entity_id) REFERENCES content_entities(id) ON DELETE SET NULL
);

CREATE INDEX idx_about_identity_profiles_public
  ON about_identity_profiles(publication_state,visibility,sort_order,organization_id);

-- Organizations with profiles can own identity dossiers, but they are not
-- cultural objects. Rebuild the shared structure trigger so every present and
-- future dossier-creation path preserves that distinction at the schema layer.
DROP TRIGGER IF EXISTS archive_dossier_structure_insert;
CREATE TRIGGER archive_dossier_structure_insert
AFTER INSERT ON archive_dossiers
BEGIN
  INSERT OR IGNORE INTO archive_catalogue_entries(
    entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,
    current_version,current_state,variant_label,current_state_id,
    created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.entity_id,type.medium_id,type.id,type.catalogue_prefix,
    COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=type.catalogue_prefix),0)+1,
    type.catalogue_prefix||'-'||printf('%03d',COALESCE((SELECT MAX(existing.catalogue_number) FROM archive_catalogue_entries existing WHERE existing.catalogue_prefix=type.catalogue_prefix),0)+1),
    1,'I','',NULL,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM content_entities ce
  JOIN archive_cultural_object_types type ON type.id=CASE ce.entity_type
    WHEN 'art_work' THEN 'art-other'
    WHEN 'merch_item' THEN 'merch-other'
    WHEN 'portfolio_item' THEN 'tattoo-execution'
    WHEN 'flash_item' THEN 'tattoo-flash-design'
    WHEN 'tattoo_design' THEN 'tattoo-design'
    WHEN 'visual_symbol' THEN 'legend-symbol'
    WHEN 'film_work' THEN 'film-work'
    WHEN 'music_work' THEN 'music-work'
    WHEN 'writing_work' THEN 'writing-work'
    WHEN 'archive_record' THEN CASE
      WHEN EXISTS(SELECT 1 FROM archive_records ar WHERE ar.id=ce.id AND ar.record_type='blackboard') THEN 'other-blackboard'
      ELSE 'other-cultural-object'
    END
    ELSE CASE
      WHEN ce.node_id IN ('film','node-film') THEN 'film-work'
      WHEN ce.node_id IN ('music','node-music') THEN 'music-work'
      WHEN ce.node_id IN ('writings','node-writings') THEN 'writing-work'
      ELSE 'other-cultural-object'
    END
  END
  WHERE ce.id=NEW.entity_id
    AND ce.entity_type NOT IN ('event','appearance','archive_record','organization');

  INSERT OR IGNORE INTO archive_object_versions(
    id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,
    sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at
  )
  SELECT 'archive-version-initial:'||NEW.entity_id,NEW.entity_id,1,'Version 1','',NULL,'undated','',
    1,'draft',0,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM archive_catalogue_entries catalogue
  WHERE catalogue.entity_id=NEW.entity_id
    AND NOT EXISTS(SELECT 1 FROM archive_object_versions existing WHERE existing.entity_id=NEW.entity_id);

  INSERT OR IGNORE INTO archive_object_states(
    id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,
    date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,
    created_by,updated_by,created_at,updated_at
  )
  SELECT 'archive-state-initial:'||version.id,version.id,'I',1,'First documented state','','',NULL,
    'undated','',1,'draft',0,NULL,'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM archive_object_versions version
  WHERE version.entity_id=NEW.entity_id
    AND NOT EXISTS(SELECT 1 FROM archive_object_states existing WHERE existing.version_id=version.id)
  ORDER BY version.sort_order,version.version_number,version.id
  LIMIT 1;

  INSERT OR IGNORE INTO archive_event_identifiers(
    entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at
  )
  SELECT NEW.entity_id,
    COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+1,
    'EVT-'||printf('%03d',COALESCE((SELECT MAX(existing.event_number) FROM archive_event_identifiers existing),0)+1),
    'archive-structure-trigger','archive-structure-trigger',datetime('now'),datetime('now')
  FROM content_entities ce
  WHERE ce.id=NEW.entity_id AND ce.entity_type IN ('event','appearance');
END;

DROP TRIGGER IF EXISTS archive_catalogue_no_organization_insert;
CREATE TRIGGER archive_catalogue_no_organization_insert
BEFORE INSERT ON archive_catalogue_entries
WHEN EXISTS(
  SELECT 1 FROM content_entities owner
  WHERE owner.id=NEW.entity_id AND owner.entity_type='organization'
)
BEGIN
  SELECT RAISE(ABORT,'Organization dossiers do not receive cultural-object catalogue identities.');
END;

DROP TRIGGER IF EXISTS archive_catalogue_no_organization_reassignment;
CREATE TRIGGER archive_catalogue_no_organization_reassignment
BEFORE UPDATE OF entity_id ON archive_catalogue_entries
WHEN EXISTS(
  SELECT 1 FROM content_entities owner
  WHERE owner.id=NEW.entity_id AND owner.entity_type='organization'
)
BEGIN
  SELECT RAISE(ABORT,'Organization dossiers do not receive cultural-object catalogue identities.');
END;

-- Archive-native cultural objects retain object-specific descriptive fields;
-- the controlled catalogue type remains the canonical medium family.
ALTER TABLE archive_records ADD COLUMN cultural_object_type_id TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_records ADD COLUMN medium_label TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_records ADD COLUMN creator_entity_id TEXT;
ALTER TABLE archive_records ADD COLUMN creator_label TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_records ADD COLUMN date_precision TEXT NOT NULL DEFAULT 'undated'
  CHECK(date_precision IN ('exact','approximate','year','range','undated'));

-- Resumable uploads retain private provenance until the final media asset is
-- created. This field is authenticated Studio data and is never projected by
-- public media or identity endpoints.
ALTER TABLE media_upload_sessions ADD COLUMN rights_notes TEXT NOT NULL DEFAULT '';

-- A Legend mark can cite a single canonical Archive record as a historical
-- variant or documented appearance without duplicating its media.
CREATE TABLE visual_symbol_archive_appearances (
  id TEXT PRIMARY KEY,
  symbol_entity_id TEXT NOT NULL,
  record_entity_id TEXT NOT NULL,
  appearance_role TEXT NOT NULL CHECK(appearance_role IN ('variant','appearance')),
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(publication_state IN ('draft','published','archived')),
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(symbol_entity_id,record_entity_id,appearance_role),
  FOREIGN KEY(symbol_entity_id) REFERENCES visual_symbols(id) ON DELETE CASCADE,
  FOREIGN KEY(record_entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_visual_symbol_archive_appearances_public
  ON visual_symbol_archive_appearances(symbol_entity_id,publication_state,public_visible,sort_order);

-- Canonical spelling correction. This does not alter lifecycle or publication.
UPDATE organizations
SET name='ThoughtPuppet',updated_at=datetime('now')
WHERE id='org-thoughtpuppet';

UPDATE archive_timelines
SET title='ThoughtPuppet',
    description='Works and derivatives connected to ThoughtPuppet.',
    updated_by='migration-0187',updated_at=datetime('now')
WHERE id='archive-timeline-thoughtpuppet';

UPDATE archive_facets
SET name='ThoughtPuppet',updated_at=datetime('now')
WHERE id='archive-facet-brand-thoughtpuppet';

-- The organization dossier is an identity record, not a cultural object, so it
-- intentionally receives no archive_catalogue_entries row.
INSERT OR IGNORE INTO archive_dossiers(
  entity_id,archive_slug,orientation,story,story_html,empty_materials_note,
  record_type,state,public_visible,featured,sort_order,published_at,
  created_by,updated_by,created_at,updated_at
)
SELECT
  'org-thoughtpuppet','thoughtpuppet',
  'The evidence-oriented record for the ThoughtPuppet creative identity.',
  'ThoughtPuppet began as a fictional artist for a class-project album cover and later returned as a working creative identity.',
  '',
  'Reviewed identity evidence will appear here as its history is documented.',
  'creative-identity','draft',0,0,20,NULL,
  'migration-0187','migration-0187',datetime('now'),datetime('now')
WHERE EXISTS(SELECT 1 FROM content_entities WHERE id='org-thoughtpuppet' AND entity_type='organization');

-- The 0183 generic dossier trigger predates creative identities and assumes
-- every non-event dossier is an object. Remove that automatically-created
-- shell identity here; runtime code also excludes organizations going forward.
DELETE FROM archive_catalogue_entries
WHERE entity_id='org-thoughtpuppet';

-- One canonical, private cultural-object record for the supplied original
-- class-project export. No media rows are created or uploaded by this migration.
INSERT OR IGNORE INTO content_entities(
  id,entity_type,node_id,visibility,search_visibility,featured,public_at,
  created_by,updated_by,created_at,updated_at
) VALUES(
  'archive-record-thought-puppet-puppet-thoughts','archive_record','node-archive','internal',0,0,NULL,
  'migration-0187','migration-0187',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO archive_records(
  id,slug,title,node_label,record_type,room,date_or_period,timeline_period,
  summary,body,record_status,state,sort_order,
  cultural_object_type_id,medium_label,creator_entity_id,creator_label,date_precision,
  created_at,updated_at
) VALUES(
  'archive-record-thought-puppet-puppet-thoughts',
  'thought-puppet-puppet-thoughts',
  'Thought Puppet / Puppet Thoughts',
  'The Six.Well Construct',
  'album-cover-design',
  'Ephemera',
  'c. 2018–2019',
  'c. 2018–2019',
  'The original class-project album cover that introduced the fictional artist Thought Puppet and the album Puppet Thoughts.',
  'Created while Saiel Dauhn Solehman was pursuing animation at The Art Institute of Atlanta.',
  'private archival record awaiting media and publication review',
  'draft',
  20,
  'art-digital-work',
  'Digital collage/design',
  'person-saiel-dauhn-solehman',
  'Saiel Dauhn Solehman',
  'approximate',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO archive_dossiers(
  entity_id,archive_slug,orientation,story,story_html,empty_materials_note,
  record_type,state,public_visible,featured,sort_order,published_at,
  created_by,updated_by,created_at,updated_at
) VALUES(
  'archive-record-thought-puppet-puppet-thoughts',
  'thought-puppet-puppet-thoughts',
  'An origin artifact for the ThoughtPuppet creative identity.',
  'The cover preserves the historical spelling Thought Puppet, the fictional album title Puppet Thoughts, an early puppet character, and the already-established Six.Well six-dot signature.',
  '',
  'The public display derivative has not been ingested or approved yet.',
  'album-cover-design','draft',0,0,20,NULL,
  'migration-0187','migration-0187',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO archive_catalogue_entries(
  entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,
  current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at
)
SELECT
  'archive-record-thought-puppet-puppet-thoughts',
  object_type.medium_id,
  object_type.id,
  object_type.catalogue_prefix,
  sequence.next_number,
  object_type.catalogue_prefix||'-'||printf('%03d',sequence.next_number),
  1,'I','',
  'migration-0187','migration-0187',datetime('now'),datetime('now')
FROM archive_cultural_object_types object_type
CROSS JOIN (
  SELECT COALESCE(MAX(catalogue_number),0)+1 next_number
  FROM archive_catalogue_entries
  WHERE catalogue_prefix='ART'
) sequence
WHERE object_type.id='art-digital-work';

INSERT OR IGNORE INTO archive_object_versions(
  id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,
  sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at
) VALUES(
  'archive-version-thought-puppet-puppet-thoughts-1',
  'archive-record-thought-puppet-puppet-thoughts',
  1,'Version 1','Original class-project export','2018-01-01','approximate','c. 2018–2019',
  1,'draft',0,'migration-0187','migration-0187',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO archive_object_states(
  id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,
  date_precision,date_label,sort_order,publication_state,public_visible,
  created_by,updated_by,created_at,updated_at
) VALUES(
  'archive-state-thought-puppet-puppet-thoughts-1-I',
  'archive-version-thought-puppet-puppet-thoughts-1',
  'I',1,'State I','Original class-project export','','2018-01-01',
  'approximate','c. 2018–2019',1,'draft',0,
  'migration-0187','migration-0187',datetime('now'),datetime('now')
);

UPDATE archive_catalogue_entries
SET current_state_id='archive-state-thought-puppet-puppet-thoughts-1-I',
    updated_by='migration-0187',updated_at=datetime('now')
WHERE entity_id='archive-record-thought-puppet-puppet-thoughts';

INSERT OR IGNORE INTO archive_dossier_subjects(
  dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at
)
SELECT 'archive-record-thought-puppet-puppet-thoughts',id,role,0,sort_order,datetime('now')
FROM (
  SELECT 'org-thoughtpuppet' id,'brand' role,1 sort_order
  UNION ALL SELECT 'person-saiel-dauhn-solehman','creator',2
  UNION ALL SELECT 'identity-six-well','signature',3
) subject
WHERE EXISTS(SELECT 1 FROM content_entities ce WHERE ce.id=subject.id);

INSERT OR IGNORE INTO archive_dossier_subjects(
  dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at
)
SELECT 'identity-thoughtpuppet','org-thoughtpuppet','brand',0,1,datetime('now')
WHERE EXISTS(SELECT 1 FROM archive_dossiers WHERE entity_id='identity-thoughtpuppet');

INSERT OR IGNORE INTO entity_relationships(
  id,source_entity_id,target_entity_id,relationship_type_id,public_visible,
  internal_notes,sort_order,created_by,created_at,updated_at
) VALUES
  (
    'relationship-thoughtpuppet-current-symbol','org-thoughtpuppet','identity-thoughtpuppet','rel-uses-symbol',0,
    'Current ThoughtPuppet mark; publication review pending.',1,'migration-0187',datetime('now'),datetime('now')
  ),
  (
    'relationship-thought-puppet-cover-six-well','archive-record-thought-puppet-puppet-thoughts','identity-six-well','rel-uses-symbol',0,
    'The lower-right six-dot signature was already the Six.Well mark when the cover was created.',2,'migration-0187',datetime('now'),datetime('now')
  );

INSERT OR IGNORE INTO archive_origin_threads(
  id,slug,title,summary,state,public_visible,sort_order,
  created_by,updated_by,created_at,updated_at
) VALUES(
  'origin-thread-thoughtpuppet-origins','thoughtpuppet-origins','ThoughtPuppet Origins',
  'The class-project identity, its origin artifact, the early puppet character, and the Six.Well signature documented together.',
  'draft',0,20,'migration-0187','migration-0187',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO archive_origin_thread_entities(
  thread_id,entity_id,is_primary,sort_order,created_at
)
SELECT 'origin-thread-thoughtpuppet-origins',id,is_primary,sort_order,datetime('now')
FROM (
  SELECT 'org-thoughtpuppet' id,1 is_primary,1 sort_order
  UNION ALL SELECT 'archive-record-thought-puppet-puppet-thoughts',0,2
  UNION ALL SELECT 'identity-thoughtpuppet',0,3
  UNION ALL SELECT 'identity-six-well',0,4
) member
WHERE EXISTS(SELECT 1 FROM content_entities ce WHERE ce.id=member.id);

INSERT OR IGNORE INTO archive_timeline_chapters(
  id,timeline_id,title,summary,body,occurred_at,ended_at,date_precision,date_label,
  anchor_slug,dedupe_key,state,public_visible,sort_order,
  created_by,updated_by,created_at,updated_at
) VALUES
  (
    'archive-chapter-thoughtpuppet-fictional-artist','archive-timeline-thoughtpuppet',
    'A fictional artist appears',
    'A class-project album cover introduces Thought Puppet and Puppet Thoughts.',
    'ThoughtPuppet began around 2018–2019 while I was pursuing animation at The Art Institute of Atlanta. For a class-project album cover, I invented a fictional artist—Thought Puppet—and an album, *Puppet Thoughts*. I flunked out of the program, and ThoughtPuppet went dormant until it returned years later.',
    '2018-01-01','2019-12-31','range','c. 2018–2019',
    'a-fictional-artist-appears','thoughtpuppet-fictional-artist','draft',0,1,
    'migration-0187','migration-0187',datetime('now'),datetime('now')
  ),
  (
    'archive-chapter-thoughtpuppet-lost-marbles','archive-timeline-thoughtpuppet',
    'Lost Marbles moves across mediums',
    'The 2023 painting and its undated hoodie derivative establish a documented cross-medium line.',
    'The canonical painting and hoodie activities remain the evidence for this chapter; no unverified hoodie release date is assigned.',
    '2023-01-01',NULL,'year','2023 onward',
    'lost-marbles-moves-across-mediums','thoughtpuppet-lost-marbles-across-mediums','draft',0,2,
    'migration-0187','migration-0187',datetime('now'),datetime('now')
  ),
  (
    'archive-chapter-thoughtpuppet-returns','archive-timeline-thoughtpuppet',
    'ThoughtPuppet returns',
    'By 2026, ThoughtPuppet had returned as a working creative identity.',
    'By 2026, ThoughtPuppet had returned as the creative identity for paintings, objects, studies, and visual-language research that feed the wider Construct.',
    '2026-01-01',NULL,'year','By 2026',
    'thoughtpuppet-returns','thoughtpuppet-return-2026','draft',0,3,
    'migration-0187','migration-0187',datetime('now'),datetime('now')
  );

INSERT OR IGNORE INTO entity_activity(
  id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,
  public_visible,sort_order,created_by,created_at,updated_at,
  summary,body,date_precision,date_label,source_note
) VALUES(
  'activity-thought-puppet-puppet-thoughts-origin',
  'archive-record-thought-puppet-puppet-thoughts',
  'origin-artifact',
  'Thought Puppet / Puppet Thoughts',
  'Original class-project export.',
  '2018-01-01','2019-12-31',NULL,
  0,0,'migration-0187',datetime('now'),datetime('now'),
  'The album-cover project introduces the fictional artist Thought Puppet.',
  'The artifact preserves an early ThoughtPuppet identity and the Six.Well six-dot signature.',
  'range','c. 2018–2019','Creator-confirmed date range and context.'
);

INSERT OR IGNORE INTO entity_activity_subjects(
  activity_id,subject_entity_id,public_visible,sort_order,created_at
) VALUES(
  'activity-thought-puppet-puppet-thoughts-origin','org-thoughtpuppet',0,1,datetime('now')
);

INSERT OR IGNORE INTO visual_symbol_archive_appearances(
  id,symbol_entity_id,record_entity_id,appearance_role,title,caption,
  publication_state,public_visible,sort_order,created_by,updated_by,created_at,updated_at
) VALUES
  (
    'legend-appearance-thoughtpuppet-early-puppet','identity-thoughtpuppet',
    'archive-record-thought-puppet-puppet-thoughts','variant',
    'Early puppet character / class-project identity',
    'The central puppet-like figure predates the current ThoughtPuppet question-mark mark.',
    'draft',0,1,'migration-0187','migration-0187',datetime('now'),datetime('now')
  ),
  (
    'legend-appearance-six-well-cover-signature','identity-six-well',
    'archive-record-thought-puppet-puppet-thoughts','appearance',
    'Thought Puppet / Puppet Thoughts',
    'An early documented appearance of the Six.Well six-dot signature at lower right.',
    'draft',0,1,'migration-0187','migration-0187',datetime('now'),datetime('now')
  );

-- Seeded as a private draft. Publication remains an explicit Studio review.
INSERT OR IGNORE INTO about_identity_profiles(
  organization_id,slug,kind_label,lifecycle_status,origin_date_label,
  hero_descriptor,current_role,origin_body,return_body,
  timeline_id,current_symbol_id,origin_thread_id,featured_origin_entity_id,
  publication_state,visibility,sort_order,published_at,
  created_by,updated_by,created_at,updated_at
) VALUES(
  'org-thoughtpuppet','thoughtpuppet','Creative identity','active','c. 2018–2019',
  'The acknowledgment of source and process: creative movement both through and from. A name born from a class project that may become a pseudonym.',
  'The creative identity for paintings, objects, studies, and visual-language research that feed the wider Construct.',
  'ThoughtPuppet began around 2018–2019 while I was pursuing animation at The Art Institute of Atlanta. For a class-project album cover, I invented a fictional artist—Thought Puppet—and an album, *Puppet Thoughts*. I flunked out of the program, and ThoughtPuppet went dormant until it returned years later.',
  'By 2026, ThoughtPuppet had returned as the creative identity for paintings, objects, studies, and visual-language research that feed the wider Construct.',
  'archive-timeline-thoughtpuppet','identity-thoughtpuppet',
  'origin-thread-thoughtpuppet-origins','archive-record-thought-puppet-puppet-thoughts',
  'draft','internal',1,NULL,
  'migration-0187','migration-0187',datetime('now'),datetime('now')
);
