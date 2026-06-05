# Manual Text Assist

## Template Key

`manual_text_assist`

## Trigger Moment

This is not sent automatically. It appears in `/studio/submissions/` as copyable
text the studio can send manually by SMS.

## Approved With Booking Link

Hi {{client_name}}, this is art.pill TATTOO HOUSE. Your project has been
approved for booking. You can choose your session and place the deposit here:
{{booking_url}}

## Booked

Hi {{client_name}}, this is art.pill TATTOO HOUSE. Your appointment is
confirmed. Keep an eye on your email for studio follow-up before the session.

## Received / Default

Hi {{client_name}}, this is art.pill TATTOO HOUSE. We received your inquiry and
will review the project details before sending booking access. Thank you.

## Variables Needed

- `{{client_name}}`
- `{{booking_url}}`
- `{{submission_status}}`

## Optional Notes For Codex

Keep this short enough to send as a normal text message. This is intentionally
manual, so do not add opt-out language unless automated SMS is implemented.
