-- Email claims are inactive system locks used to make concurrent person
-- creation atomic. Backfill only emails that belong to one canonical person
-- and are not marked as shared.
INSERT OR IGNORE INTO crm_identities(
  id,person_id,kind,value,normalized_value,provider,external_id,label,
  is_primary,is_verified,is_shared,source_provider,source_type,source_id,
  import_batch_id,active,created_at,updated_at
)
SELECT
  'crm-identity-' || lower(hex(randomblob(16))),
  unique_email.person_id,
  'other',
  unique_email.normalized_value,
  unique_email.normalized_value,
  'crm_email_claim',
  unique_email.normalized_value,
  '',
  0,
  0,
  0,
  'system',
  'email_claim',
  NULL,
  NULL,
  0,
  datetime('now'),
  datetime('now')
FROM (
  SELECT
    i.normalized_value,
    MIN(COALESCE(p.merged_into_id, p.id)) AS person_id
  FROM crm_identities i
  JOIN crm_people p ON p.id = i.person_id
  WHERE i.active = 1
    AND i.kind = 'email'
    AND i.normalized_value != ''
    AND p.anonymized_at IS NULL
  GROUP BY i.normalized_value
  HAVING COUNT(DISTINCT COALESCE(p.merged_into_id, p.id)) = 1
    AND MAX(i.is_shared) = 0
) AS unique_email;
