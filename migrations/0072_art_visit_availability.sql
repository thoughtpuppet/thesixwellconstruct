-- Studio Visits belong to Art and keep the schedule that previously lived
-- under the shared studio category. Room bookings receive their own schedule
-- and remain closed until explicitly configured in Studio.

UPDATE availability_rules
SET id = 'art_visit_sunday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_sunday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_monday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_monday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_tuesday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_tuesday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_wednesday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_wednesday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_thursday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_thursday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_friday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_friday' AND venture = 'tattooing' AND category = 'studio';

UPDATE availability_rules
SET id = 'art_visit_saturday',
    category = 'art_visit',
    updated_at = datetime('now')
WHERE id = 'studio_saturday' AND venture = 'tattooing' AND category = 'studio';

INSERT OR IGNORE INTO availability_rules (
  id, venture, day_of_week, start_time, end_time, active, category,
  capacity, buffer_before_minutes, buffer_after_minutes, note,
  created_at, updated_at
) VALUES
  ('studio_space_sunday', 'tattooing', 0, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_monday', 'tattooing', 1, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_tuesday', 'tattooing', 2, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_wednesday', 'tattooing', 3, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_thursday', 'tattooing', 4, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_friday', 'tattooing', 5, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now')),
  ('studio_space_saturday', 'tattooing', 6, '08:00', '18:00', 0, 'studio_space', 1, 30, 30, '', datetime('now'), datetime('now'));
