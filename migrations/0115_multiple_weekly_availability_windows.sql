DROP INDEX IF EXISTS idx_availability_rules_venture_day_category;

CREATE INDEX IF NOT EXISTS idx_availability_rules_venture_category_day
  ON availability_rules(venture, category, day_of_week);
