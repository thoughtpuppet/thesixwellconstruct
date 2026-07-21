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

Your tattoo project has been approved for booking.

Approved session options:

{{session_options}}

Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200
Extended Day fee.

Extended day sessions are always optional and are presented as an option for
clients who want longer sessions. Quarter, Half, and Full Day sessions do not
include the Extended Day fee, and your project may be split across shorter
appointments if desired. If additional appointments are needed, I will
coordinate the remaining dates with you.

Before booking, please review:

- Terms & Conditions: {{booking_terms_url}}
- Day-of / session prep: {{day_of_instructions_url}}

Use the private link below to choose an available session and pay the
deposit:

{{booking_url}}

This link is private to your project. Deposits are non-refundable and go toward
the final cost of your tattoo. If the available times do not work, reply to
this email and the studio can help.

Thank you,
art.pill TATTOO HOUSE

## Variables Needed

- `{{client_name}}`
- `{{booking_url}}`
- `{{booking_link_expires_at}}`
- `{{allowed_booking_types}}`
- `{{session_options}}`
- `{{deposit_amount}}`
- `{{session_fee_amount}}` (Extended Day only)
- `{{booking_terms_url}}`
- `{{day_of_instructions_url}}`
- `{{submission_id}}`

## Optional Notes For Codex

This is the first email that should clearly tell the client they are approved
to book. Include session/price basics and policy links, but keep the full terms
on the website or PDF rather than embedding the whole policy in the email.
