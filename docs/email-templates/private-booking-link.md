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

Choose how you want to pace your tattoo. Every newly approved tattoo link
includes Quarter Day, Half Day, Full Day, and optional Extended Day. You may
complete the work in one longer appointment or split it across shorter
sessions.

Extended Day reserves a 10-hour block, has an eight-hour billing minimum at
the approved project rate, and adds a $200 fee due with the final studio
balance. Its $350 booking deposit is credited toward the final total. The
shorter session options do not add this fee.

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
- `{{minimum_billable_minutes}}` (Extended Day only)
- `{{booking_terms_url}}`
- `{{day_of_instructions_url}}`
- `{{submission_id}}`

## Optional Notes For Codex

This is the first email that should clearly tell the client they are approved
to book. Include session/price basics and policy links, but keep the full terms
on the website or PDF rather than embedding the whole policy in the email.
