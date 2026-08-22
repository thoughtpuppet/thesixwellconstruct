-- Bound the automated/manual Strong Picks intake to the verified sources that
-- belong to this editorial lane. Other enabled calendar sources remain
-- available for explicit per-source or full Sources-tab runs.
UPDATE calendar_sources
SET adapter_config_json = json_set(
      CASE WHEN json_valid(adapter_config_json) THEN adapter_config_json ELSE '{}' END,
      '$.strongPicksIntake',
      1
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  'cal_source_carlos_calendar',
  'cal_source_roswell_arts_fund',
  'cal_source_roswell_fine_arts_alliance',
  'cal_source_arts_alpharetta',
  'cal_source_the_art_center',
  'cal_source_dalton_gallery',
  'cal_source_dashboard_upcoming',
  'cal_source_dashboard',
  'cal_source_marcia_wood',
  'cal_source_mason_fine_art',
  'cal_source_alan_avery',
  'cal_source_vinson_art',
  'cal_source_south_arts_events',
  'cal_source_atlanta_printmakers',
  'cal_source_papermaking_museum',
  'cal_source_september_gray',
  'cal_source_serenbe_events',
  'cal_source_artsatl_art_design',
  'cal_source_artsatl_fall_preview',
  'cal_source_970ad4b0-4cff-4b4d-be8a-56f3b53818cb',
  'cal_source_eyedrum',
  'cal_source_plaza_theatre',
  'cal_source_spelman_museum',
  'cal_source_spelman_exhibitions',
  'cal_source_poetic_jazz',
  'cal_source_voices_in_power',
  'cal_source_words_on_wylie',
  'cal_source_goat_farm'
)
OR lower(rtrim(url,'/')) IN (
  'https://www.dashboard.us/upcoming',
  'https://www.artsatl.org/event',
  'https://www.eyedrum.org/calendar-events-performances-art-music',
  'https://www.plazaatlanta.com/special-events',
  'https://www.spelman.edu/museum-of-fine-art/art-and-events',
  'https://www.spelman.edu/museum-of-fine-art/art-and-events/exhibitions/index.html',
  'https://www.poeticjazz.org/events',
  'https://voicesinpower.com/events/atlanta',
  'https://cabbagetown.com/wow',
  'https://www.thegoatfarm.info'
);
