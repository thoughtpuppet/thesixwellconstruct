-- Optional profile answers collected on public forms and surfaced in Studio People.

ALTER TABLE crm_people
  ADD COLUMN referral_source TEXT NOT NULL DEFAULT '';

ALTER TABLE event_tickets
  ADD COLUMN preferred_name TEXT NOT NULL DEFAULT '';

ALTER TABLE event_tickets
  ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';

ALTER TABLE event_tickets
  ADD COLUMN instagram TEXT NOT NULL DEFAULT '';

ALTER TABLE event_tickets
  ADD COLUMN preferred_contact_method TEXT NOT NULL DEFAULT '';

ALTER TABLE event_tickets
  ADD COLUMN referral_source TEXT NOT NULL DEFAULT '';
