PRAGMA foreign_keys = ON;

-- A user-selected Instagram discovery source. Social posts remain private
-- provenance and must resolve to an original event or venue page before an
-- event can be approved for public publication.
INSERT INTO calendar_social_sources
  (id,platform,name,handle,profile_url,trust_level,enabled,cadence_hours,created_at,updated_at)
VALUES
  ('cal_social_instagram_culturexcanvasartshow','instagram','Culture x Canvas Art Show',
   'culturexcanvasartshow','https://www.instagram.com/culturexcanvasartshow/',
   'trusted',1,24,datetime('now'),datetime('now'))
ON CONFLICT(platform,handle) DO UPDATE SET
  name=excluded.name,
  profile_url=excluded.profile_url,
  trust_level=excluded.trust_level,
  enabled=1,
  updated_at=datetime('now');
