-- Keep current Studio-authored submission receipt revisions aligned with the
-- required support contact sentence while preserving retired revision history.
UPDATE email_template_revisions AS revision
SET content_json = json_set(
      content_json,
      '$.notice',
      json((
        SELECT json_group_array(
          CASE
            WHEN item.value LIKE 'Questions or corrections?%'
              THEN 'Questions or corrections? Email {{support_email}}, call or text (770) 820-5800.'
            ELSE item.value
          END
        )
        FROM json_each(revision.content_json, '$.notice') AS item
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
    WHERE item.value LIKE 'Questions or corrections?%'
  );
