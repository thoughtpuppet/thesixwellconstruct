PRAGMA foreign_keys = ON;

-- One private intelligence record powers the dated Studio feed and links back
-- to the candidate that remains approval-gated for public publication.
CREATE TABLE calendar_scout_strong_picks (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  candidate_id TEXT NOT NULL,
  pick_kind TEXT NOT NULL DEFAULT 'new'
    CHECK (pick_kind IN ('new','material_update')),
  fingerprint TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  changes_json TEXT NOT NULL DEFAULT '[]',
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES calendar_scout_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_id) REFERENCES calendar_candidates(id) ON DELETE CASCADE,
  UNIQUE (candidate_id,fingerprint)
);

CREATE INDEX idx_calendar_scout_strong_picks_detected
  ON calendar_scout_strong_picks(detected_at DESC,id DESC);
CREATE INDEX idx_calendar_scout_strong_picks_candidate
  ON calendar_scout_strong_picks(candidate_id,detected_at DESC);

ALTER TABLE calendar_scout_runs
ADD COLUMN strong_pick_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE calendar_scout_runs
ADD COLUMN material_update_count INTEGER NOT NULL DEFAULT 0;

-- Upgrade only the original/default brief. Preserve any guidance Saiel has
-- already edited in Studio.
UPDATE calendar_scout_profiles
SET scout_brief='Search current public event listings, venue calendars, arts organizations, cinemas, galleries, festivals, and local announcements for newly announced Atlanta-area events that strongly match Saiel''s creative lanes: art shows, independent or experimental film screenings, and poetry or music showcases. Prioritize artist-led, conceptually distinctive, surreal, interdisciplinary, Black or queer, emerging, underground, community-centered, and format-experimental events. Exclude generic nightlife, major commercial concerts, routine museum programming, and weak matches. For each qualifying event, preserve the event name, date and time, venue, announcement or ticket link, a concise private explanation of why it fits, its best private use as Inspiration, Attend or Network, Future Cult.ATL Programming, Future Six.Well Programming, or a combination, plus unusually strong programming models and potential collaborators. Do not repeat a previously reported event unless its date, venue, lineup, ticket status, or strategic relevance materially changes. Produce no Strong Pick when no strong new match exists.',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='atlanta-default'
  AND (scout_brief='' OR scout_brief='Find factual Atlanta-metro creative events that fit the weighted subjects, formats, concepts, and geographic rules. Preserve distinct exhibitions, series, and related programs for private Studio review.');
