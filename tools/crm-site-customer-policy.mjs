export const EXCLUDED_PEOPLE_SQL = `
  SELECT p.id
  FROM crm_people p
  WHERE p.eligibility_at IS NULL
    AND NOT EXISTS(
      SELECT 1
      FROM crm_people survivor
      WHERE survivor.id=p.merged_into_id
        AND survivor.eligibility_at IS NOT NULL
    )
`;

export function buildCrmSiteCustomerCleanupSql() {
  return `
PRAGMA foreign_keys=ON;
DELETE FROM crm_import_rows
WHERE matched_person_id IN (${EXCLUDED_PEOPLE_SQL})
   OR target_person_id IN (${EXCLUDED_PEOPLE_SQL})
   OR applied_person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_merges
WHERE survivor_person_id IN (${EXCLUDED_PEOPLE_SQL})
   OR duplicate_person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_audit_events
WHERE person_id IN (${EXCLUDED_PEOPLE_SQL})
   OR (
     resource_type='person'
     AND resource_id IN (${EXCLUDED_PEOPLE_SQL})
   );
DELETE FROM crm_tier_history WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_person_tags WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_suppressions WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_marketing_subscriptions WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_attendance WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_followups WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_notes WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_transactions WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_interactions WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_identities WHERE person_id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_people WHERE id IN (${EXCLUDED_PEOPLE_SQL});
DELETE FROM crm_tags
WHERE NOT EXISTS(SELECT 1 FROM crm_person_tags pt WHERE pt.tag_id=crm_tags.id);
`.trimStart();
}
