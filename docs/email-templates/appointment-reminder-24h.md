# 24-Hour Appointment Reminder

## Template Key

`appointment_reminder_24h`

## Trigger Moment

Send once for confirmed appointments that are about 24 hours away.

## Subject

Reminder: your art.pill TATTOO HOUSE appointment is tomorrow

## Plain Text Body

Hi {{client_name}},

Reminder: your art.pill TATTOO HOUSE appointment is tomorrow.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}

Reply to the studio email thread if anything needs attention before your
session.

art.pill TATTOO HOUSE

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{appointment_id}}`

## Optional Notes For Codex

This should remain short. If prep instructions are added later, consider a
separate prep email or a linked prep page instead of making this reminder long.
