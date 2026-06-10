# Consultation Confirmed (Virtual)

## Template Key

`consultation_confirmed_virtual`

## Applies To

Virtual consultation bookings (`consult_virtual`).

## Trigger Moment

Send when the consultation appointment moves to `confirmed` after Square
payment is verified. The Zoom meeting is created at the same time, so the
join link should be available.

## Subject

Your virtual consultation with art.pill TATTOO HOUSE has been confirmed

## Plain Text Body

Hi {{client_name}},

Your virtual consultation with art.pill TATTOO HOUSE is confirmed.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Reservation fee: {{reservation_fee_amount}} received - this is the full price
for your consultation, not a deposit toward future work.
Zoom link: {{zoom_link}}

Confirmation page: {{confirmation_url}}

We'll talk through your project, placement, scale, and timeline over video. No
prep is required ahead of time - just bring any reference images or ideas
you'd like to share, and a quiet spot with a stable connection.

Thank you,
Saiel Solehman
[art.pill TATTOO HOUSE]

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{reservation_fee_amount}}`
- `{{zoom_link}}` (link only, no password)
- `{{confirmation_url}}`
- `{{appointment_id}}`

## Optional Notes For Codex

Always say "reservation fee", never "deposit". This is the only confirmation
template that includes a Zoom link - regular tattoo sessions and in-person
consultations never get one. Do not include day-of instructions or
location/parking links - this consultation happens over video.
