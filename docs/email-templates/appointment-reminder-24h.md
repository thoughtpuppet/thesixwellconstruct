# 24-Hour Appointment Reminder

## Template Key

`appointment_reminder_24h`

## Trigger Moment

Send once for confirmed appointments that are about 24 hours away.

## Subject

Reminder: Your {{occasion}} with art.pill TATTOO HOUSE is tomorrow

`{{occasion}}` is `tattoo appointment` for tattoo sessions and build sessions,
or `consultation` for in-person/virtual consultations.

## Plain Text Body (Tattoo Sessions & Build Sessions)

Hi {{client_name}},

Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
{{extended_day_fee_line}}
{{extended_day_billing_policy_line}}

Please review before arriving:

- Day-of instructions: {{day_of_instructions_url}}
- Location & parking: {{location_parking_url}}

Your deposit goes toward the final tattoo cost. At the start of your
appointment, after the final design, placement, and session price are confirmed,
the remaining balance must be paid before tattooing begins.

Reply to this thread if you have any questions or concerns before your
session.

-Saiel Solehman
[art.pill TATTOO HOUSE]

## Plain Text Body (Virtual Consultations)

Hi {{client_name}},

Reminder: Your consultation with art.pill TATTOO HOUSE is tomorrow.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Zoom link: {{zoom_link}}

Reply to this thread if you have any questions or concerns before your
session.

-Saiel Solehman
[art.pill TATTOO HOUSE]

## Plain Text Body (In-Person Consultations)

Hi {{client_name}},

Reminder: Your consultation with art.pill TATTOO HOUSE is tomorrow.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}

Please review before arriving:

- Location & parking: {{location_parking_url}}

Reply to this thread if you have any questions or concerns before your
session.

-Saiel Solehman
[art.pill TATTOO HOUSE]

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{zoom_link}}` (virtual consultations only)
- `{{day_of_instructions_url}}` (tattoo and build sessions only)
- `{{location_parking_url}}` (in-person sessions only)
- `{{appointment_id}}`
- `{{session_fee_amount}}` (Extended Day only)

## Optional Notes For Codex

This should remain short and practical. Repeat the location/parking link here
because clients will likely check this email from their phone before arrival.
Day-of instructions only apply to tattoo and build sessions - omit them for
consultations. Virtual consultations skip location/parking entirely and
include the Zoom join link (link only, no password) directly under the
session line.
Extended Day reminders state: “Optional 8-10 hour session. Reserves a 10-hour
appointment block with a $200 Extended Day fee.” They also state that Extended
Day is always optional and that Quarter, Half, and Full Day sessions do not
include the fee.
