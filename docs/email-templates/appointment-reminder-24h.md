# 24-Hour Appointment Reminder

## Template Key

`appointment_reminder_24h`

## Trigger Moment

Send once for confirmed appointments that are about 24 hours away.

## Subject

Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow

## Plain Text Body

Hi {{client_name}},

Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}

Please review before arriving:

- Day-of instructions: {{day_of_instructions_url}}
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
- `{{day_of_instructions_url}}`
- `{{location_parking_url}}`
- `{{appointment_id}}`

## Optional Notes For Codex

This should remain short and practical. Repeat the location/parking link here
because clients will likely check this email from their phone before arrival.
