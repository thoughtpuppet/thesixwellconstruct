# Appointment Confirmed

## Template Key

`appointment_confirmed`

## Trigger Moment

Send when the appointment moves to `confirmed` after Square deposit payment is
verified.

## Subject

Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed

## Applies To

Paid regular tattoo sessions (`tattoo_quarter`, `tattoo_half`,
`tattoo_three_quarter`, `tattoo_full`, `tattoo_extended`) and the paid Tattoo
Special confirmation variants. Consultation
and build-session bookings use their own templates - see [consultation-confirmed-in-person.md](consultation-confirmed-in-person.md),
[consultation-confirmed-virtual.md](consultation-confirmed-virtual.md), and
[build-session-confirmed.md](build-session-confirmed.md).

## Plain Text Body

Hi {{client_name}},

Your art.pill TATTOO HOUSE appointment is confirmed.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Deposit: {{deposit_amount}} received
{{extended_day_fee_line}}
{{extended_day_billing_policy_line}}

Confirmation page: {{confirmation_url}}
Tattoo policies: {{booking_terms_url}}
Day-of instructions: {{day_of_instructions_url}}
Location & parking: {{location_parking_url}}

Your deposit goes toward the final tattoo cost. At the start of your
appointment, after the final design, placement, and session price are confirmed,
the remaining balance must be paid before tattooing begins.

Cash is preferred. Cash App, Apple Pay, and credit/debit cards are also
accepted. A 3% processing fee applies to all digital transactions.

There is a 15-minute grace period. Arrival later than 15 minutes may require
cancellation, rescheduling, and a new deposit.

I may follow up directly with prep notes or adjustments before your
appointment, if needed.

Thank you,
Saiel Solehman 
[art.pill TATTOO HOUSE]

## Variables Needed

- `{{client_name}}`
- `{{appointment_start}}`
- `{{appointment_end}}`
- `{{booking_type_label}}`
- `{{deposit_amount}}`
- `{{session_fee_amount}}` (Extended Day only; due with the remaining studio
  balance at the start of the appointment, before tattooing begins)
- `{{confirmation_url}}`
- `{{booking_terms_url}}`
- `{{day_of_instructions_url}}`
- `{{location_parking_url}}`
- `{{appointment_id}}`

For a multi-session checkout, use the editable `tattoo_multi` or
`tattoo_multi_tip` variant. The grouped email is sent once for the checkout and
uses `{{session_label}}` (for example, `3 tattoo sessions`). It lists every
appointment with its own date, session type, deposit, confirmation page,
calendar link, and reschedule link. The fixed 3% processing fee is not derived
from the number of sessions.

## Optional Notes For Codex

This email should feel final and clear. It should not over-explain the Square
payment process once the deposit is confirmed. Include location and day-of
links here because this is the client's practical reference email.
This template never includes a Zoom link - regular tattoo sessions are
in-person only.
For Extended Day, use: “Optional 8-12 hour session. Reserves a 12-hour
appointment block with a $200 Extended Day fee.” State that Extended Day is
always optional and that Quarter, Half, 3/4, and Full Day sessions do not include
the fee.
