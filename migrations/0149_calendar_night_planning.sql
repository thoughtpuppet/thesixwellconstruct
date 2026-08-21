PRAGMA foreign_keys = ON;

-- Phase-one metadata for time-aware night planning. Coordinates are reviewed
-- editorial data; visitor origins and destinations are never stored here.
ALTER TABLE calendar_candidates ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'inferred'
  CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in'));
ALTER TABLE calendar_candidates ADD COLUMN recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180);
ALTER TABLE calendar_candidates ADD COLUMN minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_candidates ADD COLUMN recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_candidates ADD COLUMN late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1));
ALTER TABLE calendar_candidates ADD COLUMN planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1));
ALTER TABLE calendar_candidates ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE calendar_candidates ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE calendar_candidates ADD COLUMN planning_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_entries ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'inferred'
  CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in'));
ALTER TABLE calendar_entries ADD COLUMN recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180);
ALTER TABLE calendar_entries ADD COLUMN minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_entries ADD COLUMN recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_entries ADD COLUMN late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1));
ALTER TABLE calendar_entries ADD COLUMN planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1));
ALTER TABLE calendar_entries ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE calendar_entries ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE calendar_entries ADD COLUMN planning_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_candidate_occurrences ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'inferred'
  CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in'));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1));
ALTER TABLE calendar_candidate_occurrences ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE calendar_candidate_occurrences ADD COLUMN planning_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE calendar_entry_occurrences ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'inferred'
  CHECK (attendance_mode IN ('inferred','fixed_start','flexible_window','drop_in'));
ALTER TABLE calendar_entry_occurrences ADD COLUMN recommended_arrival_minutes INTEGER NOT NULL DEFAULT 10 CHECK (recommended_arrival_minutes BETWEEN 0 AND 180);
ALTER TABLE calendar_entry_occurrences ADD COLUMN minimum_visit_minutes INTEGER CHECK (minimum_visit_minutes IS NULL OR minimum_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_entry_occurrences ADD COLUMN recommended_visit_minutes INTEGER CHECK (recommended_visit_minutes IS NULL OR recommended_visit_minutes BETWEEN 5 AND 720);
ALTER TABLE calendar_entry_occurrences ADD COLUMN late_arrival_allowed INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival_allowed IN (0,1));
ALTER TABLE calendar_entry_occurrences ADD COLUMN planning_eligible INTEGER NOT NULL DEFAULT 0 CHECK (planning_eligible IN (0,1));
ALTER TABLE calendar_entry_occurrences ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE calendar_entry_occurrences ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE calendar_entry_occurrences ADD COLUMN planning_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE calendar_planner_rate_limits (
  identity_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (identity_hash,window_started_at)
);
CREATE INDEX idx_calendar_planner_rate_limit_window ON calendar_planner_rate_limits(window_started_at);
