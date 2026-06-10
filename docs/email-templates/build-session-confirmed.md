# Build Session Confirmed

## Template Key

`build_session_confirmed`

## Applies To

In-person build-session bookings (`build_in_person`).

## Trigger Moment

Send when the build session appointment moves to `confirmed` after Square
payment is verified.

## Subject

Your build session at art.pill TATTOO HOUSE has been confirmed

## Plain Text Body

Hi {{client_name}},

Your in-person build session at art.pill TATTOO HOUSE is confirmed.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Reservation fee: {{reservation_fee_amount}} received - this is the full price
for the build session, not a deposit toward a future tattoo.

Confirmation page: {{confirmation_url}}
Location & parking: {{location_parking_url}}

This session is dedicated to building out your design together - placement,
scale, and final artwork. Bring any reference images, sizing notes, or ideas
you'd like to work from.

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

Always say "reservation fee", never "deposit". Wording should read distinctly
from the in-person consultation template - this is a working session that
produces final artwork, not a discussion-only meeting. Do not include
day-of instructions or a Zoom link.
