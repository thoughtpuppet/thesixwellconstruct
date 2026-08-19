PRAGMA foreign_keys = ON;

-- Gallery FC publishes its dated events through a Squarespace event-list page.
-- Keep one canonical source and group its exhibition programs under the parent.
UPDATE calendar_sources
SET url='https://www.galleryfc.com/calendar?disabled-source=' || id,
    enabled=0,
    updated_at=datetime('now')
WHERE id<>'cal_source_gallery_fc'
  AND (
    lower(trim(name))='gallery fc'
    OR lower(rtrim(url,'/')) IN ('https://www.galleryfc.com','https://www.galleryfc.com/calendar')
  );

INSERT INTO calendar_sources
  (id,name,url,source_type,trust_level,enabled,cadence_hours,adapter_key,render_mode,adapter_config_json,created_at,updated_at)
VALUES
  ('cal_source_gallery_fc','Gallery FC','https://www.galleryfc.com/calendar',
   'official_html','official',1,24,'automatic','static','{"internalAdapter":"squarespace","groupOverlappingExhibitions":true}',datetime('now'),datetime('now'))
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

UPDATE calendar_candidates
SET source_id='cal_source_gallery_fc',updated_at=datetime('now')
WHERE source_id IN (
  SELECT id FROM calendar_sources
  WHERE id<>'cal_source_gallery_fc' AND lower(trim(name))='gallery fc'
);

DELETE FROM calendar_sources
WHERE id<>'cal_source_gallery_fc' AND lower(trim(name))='gallery fc';
