CREATE TABLE IF NOT EXISTS booking_settings (
  venture TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  booking_horizon_days INTEGER NOT NULL DEFAULT 60,
  minimum_notice_hours INTEGER NOT NULL DEFAULT 48,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  max_bookings_per_day INTEGER NOT NULL DEFAULT 1,
  default_capacity INTEGER NOT NULL DEFAULT 1,
  default_buffer_before_minutes INTEGER NOT NULL DEFAULT 30,
  default_buffer_after_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL DEFAULT '12:00',
  end_time TEXT NOT NULL DEFAULT '18:00',
  active INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 1,
  buffer_before_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 30,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_rules_venture_day
  ON availability_rules(venture, day_of_week);

INSERT OR IGNORE INTO booking_settings (
  venture, timezone, booking_horizon_days, minimum_notice_hours,
  slot_interval_minutes, max_bookings_per_day, default_capacity,
  default_buffer_before_minutes, default_buffer_after_minutes,
  created_at, updated_at
) VALUES (
  'tattooing', 'America/New_York', 60, 48,
  30, 1, 1, 30, 30,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO availability_rules (
  id, venture, day_of_week, start_time, end_time, active,
  capacity, buffer_before_minutes, buffer_after_minutes,
  note, created_at, updated_at
) VALUES
  ('tattooing_sunday', 'tattooing', 0, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_monday', 'tattooing', 1, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_tuesday', 'tattooing', 2, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_wednesday', 'tattooing', 3, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_thursday', 'tattooing', 4, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_friday', 'tattooing', 5, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('tattooing_saturday', 'tattooing', 6, '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now'));
