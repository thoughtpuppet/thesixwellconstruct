# Consultation Confirmed (In-Person)

## Template Key

`consultation_confirmed_in_person`

## Applies To

In-person consultation bookings (`consult_in_person`).

## Trigger Moment

Send when the consultation appointment moves to `confirmed` after Square
payment is verified.

## Subject

Your consultation at art.pill TATTOO HOUSE has been confirmed

## Plain Text Body

Hi {{client_name}},

Your in-person consultation at art.pill TATTOO HOUSE is confirmed.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Reservation fee: {{reservation_fee_amount}} received - this is the full price
for your consultation, not a deposit toward future work.

Confirmation page: {{confirmation_url}}
Location & parking: {{location_parking_url}}

We'll talk through your project, placement, scale, and timeline in person. No
prep is required ahead of time - just bring any reference images or ideas
you'd like to share.

Thank you,
Saiel Solehman
[art.pill TATTOO HOUSE]

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{reservation_fee_amount}}`
- `{{confirmation_url}}`
- `{{location_parking_url}}`
- `{{appointment_id}}`

## Optional Notes For Codex

Always say "reservation fee", never "deposit" - the amount paid is the full
price of the consultation. Do not include day-of instructions (those are
written for tattoo sessions and don't apply here) and never include a Zoom
link on this template.
