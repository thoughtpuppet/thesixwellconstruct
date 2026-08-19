PRAGMA foreign_keys = ON;

-- Rampant Gallery publishes its current exhibition, date range, opening
-- reception, flyer, and factual description on its official homepage.
INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_rampant_gallery','Rampant Gallery','https://rampantgallery.com/',
   'official_html','official',1,24,'automatic','static','{"perRunLimit":10}',datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  url=excluded.url,
  source_type=excluded.source_type,
  trust_level=excluded.trust_level,
  enabled=1,
  cadence_hours=excluded.cadence_hours,
  adapter_key=excluded.adapter_key,
  render_mode=excluded.render_mode,
  adapter_config_json=excluded.adapter_config_json,
  updated_at=datetime('now');
