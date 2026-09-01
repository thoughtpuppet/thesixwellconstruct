PRAGMA foreign_keys = ON;

-- Artist Forum Atlanta is a user-confirmed discovery account. The Instagram
-- web connector opens enabled profiles directly; discovery trust keeps every
-- extracted event private until its facts and authority are reviewed.
INSERT OR IGNORE INTO calendar_social_sources
  (id,platform,name,handle,profile_url,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_social_instagram_artistforumatlanta','instagram','Artist Forum Atlanta',
   'artistforumatlanta','https://www.instagram.com/artistforumatlanta/',
   'discovery',1,24,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE calendar_social_sources
SET name='Artist Forum Atlanta',
    profile_url='https://www.instagram.com/artistforumatlanta/',
    enabled=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE platform='instagram' AND lower(handle)='artistforumatlanta';
