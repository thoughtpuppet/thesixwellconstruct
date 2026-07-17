-- Normalize every active phone identity to one E.164-like representation.
-- This closes the legacy gap where 404..., 1-404..., and +1 404... could be
-- stored as different values for the same person.
WITH ranked_phones AS (
  SELECT
    id,
    person_id,
    CASE
      WHEN length(ltrim(normalized_value, '+')) = 10
        THEN '+1' || ltrim(normalized_value, '+')
      ELSE '+' || ltrim(normalized_value, '+')
    END AS canonical_phone,
    ROW_NUMBER() OVER (
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
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
    AND kind = 'phone'
    AND normalized_value != ''
),
duplicate_phone_groups AS (
  SELECT
    person_id,
    canonical_phone,
    MAX(CASE WHEN duplicate_rank = 1 THEN id END) AS retained_identity_id,
    COUNT(*) AS row_count
  FROM ranked_phones
  GROUP BY person_id, canonical_phone
  HAVING COUNT(*) > 1
)
INSERT INTO crm_audit_events(
  id,person_id,action,resource_type,resource_id,before_json,after_json,
  actor,import_batch_id,created_at
)
SELECT
  'crm-audit-' || lower(hex(randomblob(16))),
  person_id,
  'duplicate_phone_formats_consolidated',
  'identity',
  retained_identity_id,
  NULL,
  json_object(
    'kind', 'phone',
    'retainedIdentityId', retained_identity_id,
    'deactivatedRows', row_count - 1
  ),
  'migration:0052',
  NULL,
  datetime('now')
FROM duplicate_phone_groups;

WITH ranked_phones AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
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
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
    ) AS group_is_verified,
    MAX(is_shared) OVER (
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
    ) AS group_is_shared,
    COUNT(*) OVER (
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
    ) AS group_row_count
  FROM crm_identities
  WHERE active = 1
    AND kind = 'phone'
    AND normalized_value != ''
)
UPDATE crm_identities
SET
  is_verified = (
    SELECT group_is_verified
    FROM ranked_phones
    WHERE ranked_phones.id = crm_identities.id
  ),
  is_shared = (
    SELECT group_is_shared
    FROM ranked_phones
    WHERE ranked_phones.id = crm_identities.id
  ),
  updated_at = datetime('now')
WHERE id IN (
  SELECT id
  FROM ranked_phones
  WHERE duplicate_rank = 1
    AND group_row_count > 1
);

WITH ranked_phones AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        person_id,
        CASE
          WHEN length(ltrim(normalized_value, '+')) = 10
            THEN '+1' || ltrim(normalized_value, '+')
          ELSE '+' || ltrim(normalized_value, '+')
        END
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
    AND kind = 'phone'
    AND normalized_value != ''
)
UPDATE crm_identities
SET
  active = 0,
  is_primary = 0,
  updated_at = datetime('now')
WHERE id IN (
  SELECT id
  FROM ranked_phones
  WHERE duplicate_rank > 1
);

UPDATE crm_identities
SET
  normalized_value = CASE
    WHEN length(ltrim(normalized_value, '+')) = 10
      THEN '+1' || ltrim(normalized_value, '+')
    ELSE '+' || ltrim(normalized_value, '+')
  END,
  updated_at = datetime('now')
WHERE active = 1
  AND kind = 'phone'
  AND normalized_value != ''
  AND normalized_value != CASE
    WHEN length(ltrim(normalized_value, '+')) = 10
      THEN '+1' || ltrim(normalized_value, '+')
    ELSE '+' || ltrim(normalized_value, '+')
  END;
