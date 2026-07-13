-- Complete the per-submission plan added in 0025. Flash records already carry
-- their own category; reviewed custom and special-project submissions need it too.

ALTER TABLE tattoo_session_plans ADD COLUMN session_category TEXT NOT NULL DEFAULT 'artist_review'
  CHECK (session_category IN ('artist_review','one_session','multiple_sessions'));
ALTER TABLE tattoo_session_plans ADD COLUMN client_acknowledged INTEGER NOT NULL DEFAULT 0
  CHECK (client_acknowledged IN (0,1));

