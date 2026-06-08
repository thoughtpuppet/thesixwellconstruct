# Appointment Confirmed

## Template Key

`appointment_confirmed`

## Trigger Moment

Send when the appointment moves to `confirmed` after Square deposit payment is
verified.

## Subject

Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed

## Plain Text Body

Hi {{client_name}},

Your art.pill TATTOO HOUSE appointment is confirmed.

When: {{appointment_start}} - {{appointment_end}}
Session: {{booking_type_label}}
Deposit: {{deposit_amount}} received

Confirmation page: {{confirmation_url}}
Day-of instructions: {{day_of_instructions_url}}
Location & parking: {{location_parking_url}}

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
- `{{confirmation_url}}`
- `{{day_of_instructions_url}}`
- `{{location_parking_url}}`
- `{{appointment_id}}`

## Optional Notes For Codex

This email should feel final and clear. It should not over-explain the Square
payment process once the deposit is confirmed. Include location and day-of
links here because this is the client's practical reference email.
