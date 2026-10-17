-- Update only the original first inquiry range; preserve custom ranges and other settings.
UPDATE tattoo_settings
SET inquiry_budget_ranges_json = json_set(inquiry_budget_ranges_json, '$[0].minimumDollars', 150),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'default'
  AND json_valid(inquiry_budget_ranges_json)
  AND json_type(inquiry_budget_ranges_json, '$[0].minimumDollars') = 'null'
  AND json_extract(inquiry_budget_ranges_json, '$[0].maximumDollars') = 300;
