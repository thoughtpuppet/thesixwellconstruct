-- Include relevant virtual programs while retaining the Atlanta-focused source and organizer boundary.
UPDATE calendar_scout_profiles
SET geographic_rules_json = json_set(
      CASE WHEN json_valid(geographic_rules_json) THEN geographic_rules_json ELSE '{}' END,
      '$.includeOnlineOnly',
      json('true')
    ),
    negative_terms_json = COALESCE((
      SELECT json_group_array(value)
      FROM json_each(calendar_scout_profiles.negative_terms_json)
      WHERE lower(trim(value)) <> 'online only'
    ), '[]'),
    updated_at = datetime('now')
WHERE id = 'atlanta-default';
