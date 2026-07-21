# art.pill TATTOO HOUSE Email Template Packet

These files are legacy implementation notes. They are no longer the editable
source of truth for live email copy.

Use the protected Studio Email Template Manager at `/studio/previews/` (or the
event-specific view at `/studio/events-previews/`) to edit, preview, version,
publish, test, or restore repository-authored email templates. Code defaults are
revision zero and remain the safe fallback until a Studio revision is published.

## Sender

- From name: `art.pill TATTOO HOUSE`
- From email: `saisolehman@artpilltattoohouse.com`
- Reply-to: `saisolehman@artpilltattoohouse.com`

## Live Templates

- [Submission received](submission-received.md)
- [Private booking link](private-booking-link.md)
- [Appointment confirmed (tattoo sessions)](appointment-confirmed.md)
- [Consultation confirmed (in-person)](consultation-confirmed-in-person.md)
- [Consultation confirmed (virtual)](consultation-confirmed-virtual.md)
- [Build session confirmed](build-session-confirmed.md)
- [Appointment cancelled](appointment-cancelled.md)
- [24-hour appointment reminder](appointment-reminder-24h.md)
- [Manual text assist](manual-text-assist.md)

## Live Confirmation Pages

These are the pages clients land on after Square checkout. Each booking type
redirects to its own page so the wording (deposit vs. reservation fee, day-of
instructions, Zoom link) matches that booking type:

- Tattoo sessions: `/booking/confirmed/`
- In-person consultation: `/booking/confirmed/consultation/`
- Virtual consultation: `/booking/confirmed/virtual-consultation/`
- Build session: `/booking/confirmed/build/`

Append `?preview=1` (optionally with `&state=paid|pending|cancelled`) to any
of these pages to view them with dummy data, without a real appointment. See
[Preview Hub](../../studio/previews/).

## Editing Rules

- Keep variables wrapped in double braces, like `{{client_name}}`.
- Edit subject lines and body copy freely.
- Keep each template transactional, not promotional.
- If a template needs a new variable, add it under **Variables Needed**.
- If you want a template to trigger at a different moment, update
  **Trigger Moment**.
- Keep full policies and detailed directions on hosted website pages or PDFs,
  then link to them from emails. This keeps one source of truth.

## Client Resource Links

These should be created as website pages first, with optional PDF downloads:

- Booking terms and conditions: `{{booking_terms_url}}`
- Day-of / session prep instructions: `{{day_of_instructions_url}}`
- Location and parking instructions: `{{location_parking_url}}`

Recommended public paths:

- `/tattoos/policies/`
- `/tattoos/day-of/`
- `/tattoos/location-parking/`

## Implementation Notes

Current code lives in `functions/api/notifications/_lib.js`.

When these docs are implemented, Codex should map:

- `submission-received.md` -> `submission_received`
- `private-booking-link.md` -> `booking_link_created`
- `appointment-confirmed.md` -> `appointment_confirmed`
- `consultation-confirmed-in-person.md` -> `consultation_confirmed_in_person`
- `consultation-confirmed-virtual.md` -> `consultation_confirmed_virtual`
- `build-session-confirmed.md` -> `build_session_confirmed`
- `appointment-cancelled.md` -> `appointment_cancelled`
- `appointment-reminder-24h.md` -> `appointment_reminder_24h`
- `manual-text-assist.md` -> studio admin copy helper

## Current Flow

1. Client submits an inquiry or claim.
2. Worker saves the submission to D1.
3. Client receives the submission received email.
4. Studio reviews the submission in `/studio/submissions/`.
5. Studio approves the submission and generates a private booking link.
6. Client receives the booking link email.
7. Client chooses a session and completes the Square deposit.
8. Client receives the appointment confirmed email.
9. Cron sends one 24-hour reminder for confirmed appointments.
