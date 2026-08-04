-- Tattoo Special intake dates are requests only. They do not reserve capacity
-- until an approved client explicitly starts deposit checkout.

UPDATE deposit_payments
SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending'
  AND appointment_id IN (
    SELECT a.id
    FROM appointments a
    JOIN submissions s ON s.id = a.submission_id
    WHERE s.type = 'tattoo_special'
      AND a.status IN ('pending_deposit', 'deposit_pending')
      AND a.approval_state IN ('pending', 'approved')
      AND COALESCE(a.square_order_id, '') = ''
      AND COALESCE(a.square_payment_link_id, '') = ''
      AND COALESCE(a.square_checkout_url, '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM deposit_payments paid
        WHERE paid.appointment_id = a.id AND paid.status = 'paid'
      )
  );

UPDATE appointments
SET status = 'requested',
    hold_state = NULL,
    hold_expires_at = NULL,
    hold_reconciled_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  SELECT a.id
  FROM appointments a
  JOIN submissions s ON s.id = a.submission_id
  WHERE s.type = 'tattoo_special'
    AND a.status IN ('pending_deposit', 'deposit_pending')
    AND a.approval_state IN ('pending', 'approved')
    AND COALESCE(a.square_order_id, '') = ''
    AND COALESCE(a.square_payment_link_id, '') = ''
    AND COALESCE(a.square_checkout_url, '') = ''
    AND NOT EXISTS (
      SELECT 1 FROM deposit_payments paid
      WHERE paid.appointment_id = a.id AND paid.status = 'paid'
    )
);

UPDATE submissions
SET payload_json = json_set(
      json_remove(
        payload_json,
        '$.held_appointment_id',
        '$.held_start_at',
        '$.held_end_at',
        '$.approval_hold_expires_at'
      ),
      '$.requested_appointment_id', (
        SELECT a.id FROM appointments a
        WHERE a.submission_id = submissions.id AND a.status = 'requested'
        ORDER BY a.created_at DESC LIMIT 1
      ),
      '$.requested_start_at', (
        SELECT a.start_at FROM appointments a
        WHERE a.submission_id = submissions.id AND a.status = 'requested'
        ORDER BY a.created_at DESC LIMIT 1
      ),
      '$.requested_end_at', (
        SELECT a.end_at FROM appointments a
        WHERE a.submission_id = submissions.id AND a.status = 'requested'
        ORDER BY a.created_at DESC LIMIT 1
      )
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE type = 'tattoo_special'
  AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.submission_id = submissions.id AND a.status = 'requested'
  );
