PRAGMA foreign_keys = ON;

-- Known venue records are the reusable, reviewed source for route coordinates.
ALTER TABLE calendar_known_organizations ADD COLUMN venue_address TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_known_organizations ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE calendar_known_organizations ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE calendar_known_organizations ADD COLUMN coordinates_verified_at TEXT;

CREATE INDEX idx_calendar_known_organization_venue
  ON calendar_known_organizations(organization_type,enabled,name);

-- Harden databases that may already have applied the first planning migration
-- while its initial eligibility default was permissive.
UPDATE calendar_candidates SET planning_eligible=0 WHERE latitude IS NULL OR longitude IS NULL;
UPDATE calendar_entries SET planning_eligible=0 WHERE latitude IS NULL OR longitude IS NULL;
UPDATE calendar_candidate_occurrences SET planning_eligible=0 WHERE latitude IS NULL OR longitude IS NULL;
UPDATE calendar_entry_occurrences SET planning_eligible=0 WHERE latitude IS NULL OR longitude IS NULL;
