PRAGMA foreign_keys = ON;

-- Seed broad Atlanta creative discovery so Instagram scouting is not limited
-- to manually registered accounts. Studio edits remain authoritative; only
-- fill the lists when they are still empty.
UPDATE calendar_scout_profiles
SET social_settings_json=json_set(
      social_settings_json,
      '$.instagram.keywords',
      json('["Atlanta art exhibition","Atlanta gallery opening","Atlanta artist talk","Atlanta experimental film","Atlanta poetry showcase","Atlanta creative technology","Atlanta design festival","Black Atlanta artists","queer Atlanta arts"]')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default'
  AND COALESCE(json_array_length(json_extract(social_settings_json,'$.instagram.keywords')),0)=0;

UPDATE calendar_scout_profiles
SET social_settings_json=json_set(
      social_settings_json,
      '$.instagram.tags',
      json('["atlantaart","atlart","atlantaartshow","atlantaevents","atlantagallery","atlantafilm","atlantapoetry","atldsgnfest"]')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default'
  AND COALESCE(json_array_length(json_extract(social_settings_json,'$.instagram.tags')),0)=0;

UPDATE calendar_scout_profiles
SET social_settings_json=json_set(social_settings_json,'$.instagram.perRunLimit',12),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default'
  AND COALESCE(CAST(json_extract(social_settings_json,'$.instagram.perRunLimit') AS INTEGER),0)<12;

UPDATE calendar_scout_connectors
SET per_run_limit=12,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='instagram_web' AND per_run_limit<12;
