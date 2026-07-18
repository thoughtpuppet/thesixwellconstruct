-- Keep exactly zero or one active primary identity for each person and kind.
-- Existing extra primary flags are demoted without deleting their source rows.
WITH ranked_primary_identities AS (
  SELECT
    id,
    person_id,
    kind,
    ROW_NUMBER() OVER (
      PARTITION BY person_id,kind
      ORDER BY
        is_verified DESC,
        CASE WHEN external_id IS NOT NULL AND external_id!='' THEN 1 ELSE 0 END DESC,
        created_at,
        id
    ) AS primary_rank,
    COUNT(*) OVER (PARTITION BY person_id,kind) AS primary_count
  FROM crm_identities
  WHERE active=1 AND is_primary=1
)
INSERT INTO crm_audit_events(
  id,person_id,action,resource_type,resource_id,before_json,after_json,
  actor,import_batch_id,created_at
)
SELECT
  'crm-audit-' || lower(hex(randomblob(16))),
  person_id,
  'multiple_primary_identities_repaired',
  'identity',
  MAX(CASE WHEN primary_rank=1 THEN id END),
  NULL,
  json_object(
    'kind',kind,
    'retainedIdentityId',MAX(CASE WHEN primary_rank=1 THEN id END),
    'demotedRows',MAX(primary_count)-1
  ),
  'migration:0054',
  NULL,
  datetime('now')
FROM ranked_primary_identities
WHERE primary_count>1
GROUP BY person_id,kind;

WITH ranked_primary_identities AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY person_id,kind
      ORDER BY
        is_verified DESC,
        CASE WHEN external_id IS NOT NULL AND external_id!='' THEN 1 ELSE 0 END DESC,
        created_at,
        id
    ) AS primary_rank
  FROM crm_identities
  WHERE active=1 AND is_primary=1
)
UPDATE crm_identities
SET is_primary=0,updated_at=datetime('now')
WHERE id IN (
  SELECT id FROM ranked_primary_identities WHERE primary_rank>1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_identities_one_active_primary
  ON crm_identities(person_id,kind)
  WHERE active=1 AND is_primary=1;
