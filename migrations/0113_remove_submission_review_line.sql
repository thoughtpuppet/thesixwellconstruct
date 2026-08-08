-- The review-timing paragraph duplicated the receipt's existing next-step copy.
-- Remove it from current editable revisions while preserving retired history.
UPDATE email_template_revisions AS revision
SET content_json = json_set(
      content_json,
      '$.notice',
      json((
        SELECT json_group_array(item.value)
        FROM json_each(revision.content_json, '$.notice') AS item
        WHERE item.value NOT LIKE '%{{review_line}}%'
      ))
    ),
    updated_at = datetime('now')
WHERE template_key = 'submission_received'
  AND status IN ('draft', 'published')
  AND json_valid(content_json)
  AND json_type(content_json, '$.notice') = 'array'
  AND EXISTS (
    SELECT 1
    FROM json_each(revision.content_json, '$.notice') AS item
    WHERE item.value LIKE '%{{review_line}}%'
  );
