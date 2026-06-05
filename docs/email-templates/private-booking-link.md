# Private Booking Link

## Template Key

`booking_link_created`

## Trigger Moment

Send when the studio generates a private booking token for an approved
submission.

## Subject

Your private art.pill TATTOO HOUSE booking link

## Plain Text Body

Hi {{client_name}},

Your art.pill TATTOO HOUSE project has been approved for booking.

Use the private link below to choose an available session and complete the
deposit:

{{booking_url}}

This link is private to your project. If the available times do not work, reply
to this email and the studio can help.

Thank you,
art.pill TATTOO HOUSE

## Variables Needed

- `{{client_name}}`
- `{{booking_url}}`
- `{{booking_link_expires_at}}`
- `{{allowed_booking_types}}`
- `{{submission_id}}`

## Optional Notes For Codex

This is the first email that should clearly tell the client they are approved
to book. Keep the private-link boundary clear.
