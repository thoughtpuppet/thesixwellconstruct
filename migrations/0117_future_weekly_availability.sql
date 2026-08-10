CREATE TABLE IF NOT EXISTS availability_schedule_periods (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL DEFAULT 'tattooing',
  category TEXT NOT NULL CHECK (category IN ('tattooing', 'consultation', 'art_visit', 'studio_space')),
  label TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date),
  UNIQUE (venture, category, start_date)
);

CREATE INDEX IF NOT EXISTS idx_availability_schedule_period_lookup
  ON availability_schedule_periods (venture, category, start_date, end_date);

CREATE TABLE IF NOT EXISTS availability_schedule_period_windows (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (period_id) REFERENCES availability_schedule_periods(id) ON DELETE CASCADE,
  CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_schedule_period_windows
  ON availability_schedule_period_windows (period_id, day_of_week, sort_order, start_time);
