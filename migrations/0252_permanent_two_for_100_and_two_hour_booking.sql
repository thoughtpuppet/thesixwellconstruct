-- An empty sales_closes_at means a permanent offer with no sales deadline.
-- Keep normal per-client approval/payment deadlines separate from that offer.
UPDATE booking_settings
SET minimum_notice_hours = 2, updated_at = datetime('now')
WHERE venture = 'tattooing';

UPDATE booking_tokens
SET expires_at = NULL, updated_at = datetime('now')
WHERE used_at IS NULL AND revoked_at IS NULL
  AND submission_id IN (
    SELECT t.submission_id FROM tattoo_special_submission_terms t
    JOIN submissions s ON s.id = t.submission_id
    WHERE t.campaign_id = (SELECT campaign_id FROM tattoo_special_offers WHERE id = 'special-two-small')
      AND s.status IN ('new','reviewing','approved')
      AND t.sales_closes_at <> '' AND booking_tokens.expires_at = t.sales_closes_at
  );

UPDATE submissions
SET payload_json = json_set(payload_json, '$.sales_closes_at', ''), updated_at = datetime('now')
WHERE type = 'tattoo_special' AND status IN ('new','reviewing','approved')
  AND id IN (
    SELECT submission_id FROM tattoo_special_submission_terms
    WHERE campaign_id = (SELECT campaign_id FROM tattoo_special_offers WHERE id = 'special-two-small')
  );

UPDATE tattoo_special_submission_terms
SET sales_closes_at = '', updated_at = datetime('now')
WHERE campaign_id = (SELECT campaign_id FROM tattoo_special_offers WHERE id = 'special-two-small')
  AND submission_id IN (SELECT id FROM submissions WHERE status IN ('new','reviewing','approved'));

UPDATE tattoo_special_campaigns
SET sales_closes_at = '', updated_at = datetime('now')
WHERE id = (SELECT campaign_id FROM tattoo_special_offers WHERE id = 'special-two-small')
  AND archived_at IS NULL;
