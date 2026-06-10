ALTER TABLE availability_rules ADD COLUMN category TEXT NOT NULL DEFAULT 'tattooing';

DROP INDEX IF EXISTS idx_availability_rules_venture_day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_rules_venture_day_category
  ON availability_rules(venture, day_of_week, category);

INSERT OR IGNORE INTO availability_rules (
  id, venture, day_of_week, category, start_time, end_time, active,
  capacity, buffer_before_minutes, buffer_after_minutes,
  note, created_at, updated_at
) VALUES
  ('consultation_sunday', 'tattooing', 0, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_monday', 'tattooing', 1, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_tuesday', 'tattooing', 2, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_wednesday', 'tattooing', 3, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_thursday', 'tattooing', 4, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_friday', 'tattooing', 5, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now')),
  ('consultation_saturday', 'tattooing', 6, 'consultation', '12:00', '18:00', 0, 1, 30, 30, '', datetime('now'), datetime('now'));
