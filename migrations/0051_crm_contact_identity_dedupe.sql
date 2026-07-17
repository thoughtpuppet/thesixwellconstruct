-- A contact value is one fact on a person, even when several source records
-- supplied it. Keep the strongest active row and retain the rest, inactive,
-- so their source provenance is not destroyed.
WITH ranked_contact_identities AS (
  SELECT
    id,
    person_id,
    kind,
    normalized_value,
    ROW_NUMBER() OVER (
      PARTITION BY person_id, kind, normalized_value
      ORDER BY
        is_primary DESC,
        is_verified DESC,
        CASE
          WHEN external_id IS NOT NULL AND external_id != '' THEN 1
          ELSE 0
        END DESC,
        CASE provider
          WHEN 'manual' THEN 70
          WHEN 'square' THEN 60
          WHEN 'shopify' THEN 50
          WHEN 'beehiiv' THEN 40
          WHEN 'substack' THEN 35
          WHEN 'legacy_import' THEN 20
          WHEN 'local' THEN 10
          ELSE 30
        END DESC,
        created_at,
        id
    ) AS duplicate_rank
  FROM crm_identities
  WHERE active = 1
    AND kind IN ('email', 'phone', 'instagram')
    AND normalized_value != ''
),
duplicate_contact_groups AS (
  SELECT
    person_id,
    kind,
    normalized_value,
    MAX(CASE WHEN duplicate_rank = 1 THEN id END) AS retained_identity_id,
    COUNT(*) AS row_count
  FROM ranked_contact_identities
  GROUP BY person_id, kind, normalized_value
  HAVING COUNT(*) > 1
)
INSERT INTO crm_audit_events(
  id,person_id,action,resource_type,resource_id,before_json,after_json,
  actor,import_batch_id,created_at
)
SELECT
  'crm-audit-' || lower(hex(randomblob(16))),
  person_id,
  'duplicate_contact_identities_consolidated',
  'identity',
  retained_identity_id,
  NULL,
  json_object(
    'kind', kind,
    'retainedIdentityId', retained_identity_id,
    'deactivatedRows', row_count - 1
  ),
  'migration:0051',
  NULL,
  datetime('now')
FROM duplicate_contact_groups;

-- Do not lose trust or household-sharing context when the preferred display
-- row came from a different source than the verified/shared copy.
WITH ranked_contact_identities AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY person_id, kind, normalized_value
      ORDER BY
        is_primary DESC,
        is_verified DESC,
        CASE
          WHEN external_id IS NOT NULL AND external_id != '' THEN 1
          ELSE 0
        END DESC,
        CASE provider
          WHEN 'manual' THEN 70
          WHEN 'square' THEN 60
          WHEN 'shopify' THEN 50
          WHEN 'beehiiv' THEN 40
          WHEN 'substack' THEN 35
          WHEN 'legacy_import' THEN 20
          WHEN 'local' THEN 10
          ELSE 30
        END DESC,
        created_at,
        id
    ) AS duplicate_rank,
    MAX(is_verified) OVER (
      PARTITION BY person_id, kind, normalized_value
    ) AS group_is_verified,
    MAX(is_shared) OVER (
      PARTITION BY person_id, kind, normalized_value
    ) AS group_is_shared,
    COUNT(*) OVER (
      PARTITION BY person_id, kind, normalized_value
    ) AS group_row_count
  FROM crm_identities
  WHERE active = 1
    AND kind IN ('email', 'phone', 'instagram')
    AND normalized_value != ''
)
UPDATE crm_identities
SET
  is_verified = (
    SELECT group_is_verified
    FROM ranked_contact_identities
    WHERE ranked_contact_identities.id = crm_identities.id
  ),
  is_shared = (
    SELECT group_is_shared
    FROM ranked_contact_identities
    WHERE ranked_contact_identities.id = crm_identities.id
  ),
  updated_at = datetime('now')
WHERE id IN (
  SELECT id
  FROM ranked_contact_identities
  WHERE duplicate_rank = 1
    AND group_row_count > 1
);

WITH ranked_contact_identities AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY person_id, kind, normalized_value
      ORDER BY
        is_primary DESC,
        is_verified DESC,
        CASE
          WHEN external_id IS NOT NULL AND external_id != '' THEN 1
          ELSE 0
        END DESC,
        CASE provider
          WHEN 'manual' THEN 70
          WHEN 'square' THEN 60
          WHEN 'shopify' THEN 50
          WHEN 'beehiiv' THEN 40
          WHEN 'substack' THEN 35
          WHEN 'legacy_import' THEN 20
          WHEN 'local' THEN 10
          ELSE 30
        END DESC,
        created_at,
        id
    ) AS duplicate_rank
  FROM crm_identities
  WHERE active = 1
    AND kind IN ('email', 'phone', 'instagram')
    AND normalized_value != ''
)
UPDATE crm_identities
SET
  active = 0,
  is_primary = 0,
  updated_at = datetime('now')
WHERE id IN (
  SELECT id
  FROM ranked_contact_identities
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_identities_active_contact_value
  ON crm_identities(person_id, kind, normalized_value)
  WHERE active = 1
    AND kind IN ('email', 'phone', 'instagram');
