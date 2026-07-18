-- Count only website customers plus explicit Studio-created/imported people.
-- Existing records are backfilled from authoritative CRM mirrors; cleanup of
-- rows that remain ineligible is intentionally performed only after export.

ALTER TABLE crm_people ADD COLUMN eligibility_at TEXT;
ALTER TABLE crm_people ADD COLUMN eligibility_reason TEXT NOT NULL DEFAULT ''
  CHECK (
    eligibility_reason IN (
      '',
      'website_booking',
      'settled_booking_payment',
      'paid_shopify_order',
      'paid_event_ticket',
      'studio_manual_entry',
      'studio_csv_import'
    )
  );
ALTER TABLE crm_people ADD COLUMN eligibility_source_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_people ADD COLUMN eligibility_source_type TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_people ADD COLUMN eligibility_source_id TEXT NOT NULL DEFAULT '';

UPDATE crm_people
SET
  eligibility_at = COALESCE(
    (
      SELECT MIN(COALESCE(x.occurred_at,x.created_at))
      FROM crm_interactions x
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='appointment'
    ),
    (
      SELECT MIN(COALESCE(t.occurred_at,t.created_at))
      FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='local'
        AND t.source_type='deposit_payment'
        AND t.status='settled'
    ),
    (
      SELECT MIN(COALESCE(t.occurred_at,t.created_at))
      FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='shopify'
        AND t.source_type='order_transaction'
        AND t.status='settled'
    ),
    (
      SELECT MIN(COALESCE(t.occurred_at,x.occurred_at))
      FROM crm_interactions x
      LEFT JOIN crm_transactions t
        ON t.person_id=x.person_id
       AND t.active=1
       AND t.source_provider='local'
       AND t.source_type='event_ticket_payment'
       AND t.source_id=x.source_id
       AND t.status='settled'
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='event_ticket'
        AND (x.status='paid' OR t.id IS NOT NULL)
    ),
    CASE WHEN crm_people.import_batch_id IS NOT NULL THEN crm_people.created_at END,
    CASE WHEN EXISTS(
      SELECT 1 FROM crm_audit_events a
      WHERE a.person_id=crm_people.id
        AND a.action='person_created'
    ) THEN crm_people.created_at END
  ),
  eligibility_reason = CASE
    WHEN EXISTS(
      SELECT 1 FROM crm_interactions x
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='appointment'
    ) THEN 'website_booking'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='local'
        AND t.source_type='deposit_payment'
        AND t.status='settled'
    ) THEN 'settled_booking_payment'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='shopify'
        AND t.source_type='order_transaction'
        AND t.status='settled'
    ) THEN 'paid_shopify_order'
    WHEN EXISTS(
      SELECT 1
      FROM crm_interactions x
      LEFT JOIN crm_transactions t
        ON t.person_id=x.person_id
       AND t.active=1
       AND t.source_provider='local'
       AND t.source_type='event_ticket_payment'
       AND t.source_id=x.source_id
       AND t.status='settled'
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='event_ticket'
        AND (x.status='paid' OR t.id IS NOT NULL)
    ) THEN 'paid_event_ticket'
    WHEN crm_people.import_batch_id IS NOT NULL THEN 'studio_csv_import'
    WHEN EXISTS(
      SELECT 1 FROM crm_audit_events a
      WHERE a.person_id=crm_people.id
        AND a.action='person_created'
    ) THEN 'studio_manual_entry'
    ELSE ''
  END,
  eligibility_source_provider = CASE
    WHEN EXISTS(
      SELECT 1 FROM crm_interactions x
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='appointment'
    ) THEN 'local'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='local'
        AND t.source_type='deposit_payment'
        AND t.status='settled'
    ) THEN 'local'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='shopify'
        AND t.source_type='order_transaction'
        AND t.status='settled'
    ) THEN 'shopify'
    WHEN EXISTS(
      SELECT 1
      FROM crm_interactions x
      LEFT JOIN crm_transactions t
        ON t.person_id=x.person_id
       AND t.active=1
       AND t.source_provider='local'
       AND t.source_type='event_ticket_payment'
       AND t.source_id=x.source_id
       AND t.status='settled'
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='event_ticket'
        AND (x.status='paid' OR t.id IS NOT NULL)
    ) THEN 'local'
    WHEN crm_people.import_batch_id IS NOT NULL THEN 'legacy_import'
    WHEN EXISTS(
      SELECT 1 FROM crm_audit_events a
      WHERE a.person_id=crm_people.id
        AND a.action='person_created'
    ) THEN 'manual'
    ELSE ''
  END,
  eligibility_source_type = CASE
    WHEN EXISTS(
      SELECT 1 FROM crm_interactions x
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='appointment'
    ) THEN 'appointment'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='local'
        AND t.source_type='deposit_payment'
        AND t.status='settled'
    ) THEN 'deposit_payment'
    WHEN EXISTS(
      SELECT 1 FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='shopify'
        AND t.source_type='order_transaction'
        AND t.status='settled'
    ) THEN 'order_transaction'
    WHEN EXISTS(
      SELECT 1
      FROM crm_interactions x
      LEFT JOIN crm_transactions t
        ON t.person_id=x.person_id
       AND t.active=1
       AND t.source_provider='local'
       AND t.source_type='event_ticket_payment'
       AND t.source_id=x.source_id
       AND t.status='settled'
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='event_ticket'
        AND (x.status='paid' OR t.id IS NOT NULL)
    ) THEN 'event_ticket'
    WHEN crm_people.import_batch_id IS NOT NULL THEN 'legacy_row'
    WHEN EXISTS(
      SELECT 1 FROM crm_audit_events a
      WHERE a.person_id=crm_people.id
        AND a.action='person_created'
    ) THEN 'person_create'
    ELSE ''
  END,
  eligibility_source_id = COALESCE(
    (
      SELECT x.source_id FROM crm_interactions x
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='appointment'
      ORDER BY x.occurred_at,x.created_at,x.id LIMIT 1
    ),
    (
      SELECT t.source_id FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='local'
        AND t.source_type='deposit_payment'
        AND t.status='settled'
      ORDER BY t.occurred_at,t.created_at,t.id LIMIT 1
    ),
    (
      SELECT t.source_id FROM crm_transactions t
      WHERE t.person_id=crm_people.id
        AND t.active=1
        AND t.source_provider='shopify'
        AND t.source_type='order_transaction'
        AND t.status='settled'
      ORDER BY t.occurred_at,t.created_at,t.id LIMIT 1
    ),
    (
      SELECT x.source_id FROM crm_interactions x
      LEFT JOIN crm_transactions t
        ON t.person_id=x.person_id
       AND t.active=1
       AND t.source_provider='local'
       AND t.source_type='event_ticket_payment'
       AND t.source_id=x.source_id
       AND t.status='settled'
      WHERE x.person_id=crm_people.id
        AND x.active=1
        AND x.source_provider='local'
        AND x.source_type='event_ticket'
        AND (x.status='paid' OR t.id IS NOT NULL)
      ORDER BY x.occurred_at,x.created_at,x.id LIMIT 1
    ),
    crm_people.import_batch_id,
    CASE WHEN EXISTS(
      SELECT 1 FROM crm_audit_events a
      WHERE a.person_id=crm_people.id
        AND a.action='person_created'
    ) THEN crm_people.id END,
    ''
  )
WHERE merged_into_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_people_directory_eligible
  ON crm_people(eligibility_at,relationship_status,updated_at DESC);
