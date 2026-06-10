# Appointment Cancelled

## Template Key

`appointment_cancelled`

## Trigger Moment

Send when a client or the studio cancels a booked appointment (any booking
type).

## Subject

Your appointment has been cancelled

## Plain Text Body (Tattoo Sessions)

Hi {{client_name}},

Your art.pill TATTOO HOUSE appointment has been cancelled.

Was scheduled: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}

Per studio policy, deposits and payments are non-refundable. One reschedule
is allowed with at least 48 hours notice; a new deposit is required for
reschedules made within 48 hours.

Pick a new time: {{rebook_url}}

Questions? Email {{support_email}}.

Thank you,
art.pill TATTOO HOUSE

## Plain Text Body (Consultations & Build Sessions)

Hi {{client_name}},

Your art.pill TATTOO HOUSE consultation has been cancelled.

Was scheduled: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}

Per studio policy, reservation fees are non-refundable. One reschedule is
allowed with at least 48 hours notice; a new reservation fee is required for
reschedules made within 48 hours.

Pick a new time: {{rebook_url}}

Questions? Email {{support_email}}.

Thank you,
art.pill TATTOO HOUSE

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{rebook_url}}`
- `{{support_email}}`
- `{{appointment_id}}`

## Optional Notes For Codex

Use the "deposits" wording for `tattoo_quarter`/`tattoo_half`/`tattoo_full`
and the "reservation fees" wording for `consult_in_person`,
`consult_virtual`, and `build_in_person`. The rebook link points to
`/tattoos/build/in-person/?rebook=1` for build sessions and
`/tattoos/inquire/consultation/?rebook=1` for everything else.
