ALTER TABLE availability_windows
  ADD COLUMN availability_scope TEXT NOT NULL DEFAULT 'tattoo';

UPDATE availability_windows
SET availability_scope = CASE
  WHEN booking_type_id = 'studio_visit' THEN 'art'
  WHEN booking_type_id IN ('studio_gathering', 'studio_rental') THEN 'studio'
  ELSE 'tattoo'
END;

CREATE INDEX IF NOT EXISTS idx_availability_windows_scope_start
  ON availability_windows(venture, availability_scope, active, start_at);

CREATE TABLE IF NOT EXISTS availability_date_overrides (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('tattooing', 'consultation', 'art_visit', 'studio_space')
  ),
  local_date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('closed', 'custom')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (venture, category, local_date)
);

CREATE INDEX IF NOT EXISTS idx_availability_date_overrides_lookup
  ON availability_date_overrides(venture, category, local_date);

CREATE TABLE IF NOT EXISTS availability_date_override_windows (
  id TEXT PRIMARY KEY,
  override_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_time < end_time),
  FOREIGN KEY (override_id) REFERENCES availability_date_overrides(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_availability_date_override_windows_override
  ON availability_date_override_windows(override_id, sort_order, start_time);
