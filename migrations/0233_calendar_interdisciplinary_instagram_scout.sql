PRAGMA foreign_keys = ON;

-- These are discovery inputs only. Posts remain private needs-verification
-- candidates until Studio review establishes their event facts and authority.
INSERT OR IGNORE INTO calendar_social_sources
  (id,platform,name,handle,profile_url,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_social_instagram_theprayerstudy','instagram','The Prayer Study','theprayerstudy','https://www.instagram.com/theprayerstudy/','discovery',1,24,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cal_social_instagram_arthooker','instagram','Art Hooker','arthooker','https://www.instagram.com/arthooker/','discovery',1,24,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE calendar_scout_profiles
SET social_settings_json=json_insert(social_settings_json,'$.instagram.keywords[#]','Atlanta interdisciplinary conversation'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(json_extract(calendar_scout_profiles.social_settings_json,'$.instagram.keywords'))
  WHERE lower(value)='atlanta interdisciplinary conversation'
);

UPDATE calendar_scout_profiles
SET social_settings_json=json_insert(social_settings_json,'$.instagram.keywords[#]','Atlanta cultural discussion'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(json_extract(calendar_scout_profiles.social_settings_json,'$.instagram.keywords'))
  WHERE lower(value)='atlanta cultural discussion'
);

UPDATE calendar_scout_profiles
SET social_settings_json=json_insert(social_settings_json,'$.instagram.keywords[#]','Atlanta filmmaker writer musician talk'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(json_extract(calendar_scout_profiles.social_settings_json,'$.instagram.keywords'))
  WHERE lower(value)='atlanta filmmaker writer musician talk'
);

UPDATE calendar_scout_profiles
SET social_settings_json=json_insert(social_settings_json,'$.instagram.keywords[#]','Atlanta spirituality social change'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(json_extract(calendar_scout_profiles.social_settings_json,'$.instagram.keywords'))
  WHERE lower(value)='atlanta spirituality social change'
);

UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','interdisciplinary conversation'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json)
  WHERE lower(value)='interdisciplinary conversation'
);

UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','cultural criticism'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json)
  WHERE lower(value)='cultural criticism'
);

UPDATE calendar_scout_profiles
SET positive_concepts_json=json_insert(positive_concepts_json,'$[#]','social change'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default' AND NOT EXISTS (
  SELECT 1 FROM json_each(calendar_scout_profiles.positive_concepts_json)
  WHERE lower(value)='social change'
);
