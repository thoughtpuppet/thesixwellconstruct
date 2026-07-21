-- Privacy-safe long-term site analytics. Detailed visitor/session events remain
-- in Workers Analytics Engine and expire there; D1 stores only daily totals.
CREATE TABLE IF NOT EXISTS site_analytics_daily (
  day TEXT NOT NULL,
  view TEXT NOT NULL CHECK(view IN ('overview','journeys','acquisition','performance')),
  source TEXT NOT NULL CHECK(source IN ('rum','custom')),
  metric TEXT NOT NULL,
  dimension_a TEXT NOT NULL DEFAULT '',
  dimension_b TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL DEFAULT 0,
  sample_count REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(day,view,source,metric,dimension_a,dimension_b)
);

CREATE INDEX IF NOT EXISTS idx_site_analytics_daily_lookup
  ON site_analytics_daily(view,day,source,metric);

CREATE TABLE IF NOT EXISTS site_analytics_rollup_state (
  source TEXT PRIMARY KEY CHECK(source IN ('rum','custom')),
  last_complete_day TEXT,
  last_attempt_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);
