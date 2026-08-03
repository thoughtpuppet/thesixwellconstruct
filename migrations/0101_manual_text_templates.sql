CREATE TABLE IF NOT EXISTS manual_text_templates (
  template_key TEXT PRIMARY KEY,
  body_text TEXT NOT NULL CHECK (length(body_text) BETWEEN 1 AND 2000),
  updated_by TEXT NOT NULL DEFAULT 'studio',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO manual_text_templates (template_key, body_text, updated_by, updated_at) VALUES
  ('opening_tattoo', '{{greeting}} {{first_name}}, this is Sai Solehman of art.pill TATTOO HOUSE.', 'migration', datetime('now')),
  ('opening_sixwell', '{{greeting}} {{first_name}}, this is the six.well construct.', 'migration', datetime('now')),
  ('event_confirmed', 'Your spot for {{event_title}} is confirmed and paid. See you there — reply here if anything changes.', 'migration', datetime('now')),
  ('event_received', 'We saw your RSVP for {{event_title}}. Your seat is held once Square payment clears — reply here if you need a hand.', 'migration', datetime('now')),
  ('studio_confirmed', 'Your {{booking_label}} is confirmed. Keep an eye on your email for arrival details, and reply here if anything changes.', 'migration', datetime('now')),
  ('studio_received', 'We received your {{booking_label}} request and will follow up with next steps. Thank you.', 'migration', datetime('now')),
  ('tattoo_appointment_confirmed', 'Your appointment is confirmed. Keep an eye on your email for studio follow-up before the session.', 'migration', datetime('now')),
  ('tattoo_special_approved', 'Your Tattoo Special request has been approved. Review your approved request and pay the deposit to confirm your appointment here: {{booking_url}}', 'migration', datetime('now')),
  ('tattoo_consultation_required', 'Your project needs an in-person consultation before tattoo booking. You can choose a consultation time and place the deposit here: {{booking_url}}', 'migration', datetime('now')),
  ('tattoo_booking_approved', 'Your project has been approved for booking. {{approved_budget_sentence}} Review and agree to the session estimate and budget, choose your appointment, and place the deposit here: {{booking_url}}', 'migration', datetime('now')),
  ('tattoo_inquiry_received', 'We received your inquiry and will review the project details before sending booking access. Thank you.', 'migration', datetime('now'));
