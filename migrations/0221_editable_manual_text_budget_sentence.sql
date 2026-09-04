-- Keep the approved amount dynamic while making the surrounding budget sentence
-- ordinary editable template copy. Replace the legacy sentence-level token in
-- every saved variation so custom surrounding wording is preserved.
UPDATE manual_text_templates
SET body_text = replace(
      body_text,
      '{{approved_budget_sentence}}',
      'Your approved project budget is {{approved_budget}}.'
    ),
    updated_by = 'migration',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE template_key = 'tattoo_booking_approved'
  AND instr(body_text, '{{approved_budget_sentence}}') > 0;

-- Direct tattoo invitations may intentionally omit a reviewed budget. Give that
-- path its own editable copy so an empty amount never produces a broken sentence.
INSERT OR IGNORE INTO manual_text_templates (template_key, body_text, updated_by, updated_at)
VALUES (
  'tattoo_booking_approved_no_budget',
  'Your project has been approved for booking. Review and agree to the session estimate, choose your appointment, and place the deposit here: {{booking_url}}',
  'migration',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
