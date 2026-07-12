# Submissions Backend

This site now has a first-pass studio submissions backend:

- Public create endpoint: `POST /api/submissions`
- Private admin list endpoint: `GET /api/admin/submissions`
- Private admin detail endpoint: `GET /api/admin/submissions/:id`
- Private admin update endpoint: `PATCH /api/admin/submissions/:id`
- Review console: `/studio/submissions/`

## Cloudflare bindings

Create the D1 database:

```sh
npx.cmd wrangler@latest d1 create swc-submissions
```

Add the returned binding to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "SUBMISSIONS_DB",
    "database_name": "swc-submissions",
    "database_id": "paste-the-cloudflare-database-id"
  }
]
```

Apply the schema:

```sh
npx.cmd wrangler@latest d1 migrations apply swc-submissions
```

Set the admin token:

```sh
npx.cmd wrangler@latest secret put SUBMISSIONS_ADMIN_TOKEN
```

Set Square secrets before enabling deposit checkout:

```sh
npx.cmd wrangler@latest secret put SQUARE_ACCESS_TOKEN
npx.cmd wrangler@latest secret put SQUARE_LOCATION_ID
npx.cmd wrangler@latest secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```

Use `SQUARE_ENVIRONMENT=sandbox` while testing and `SQUARE_ENVIRONMENT=production` for live deposits. Production is the deploy default in `wrangler.jsonc`; use `.dev.vars` for local sandbox testing.
Set the Square webhook notification URL to:

```text
https://thesixwellconstruct.com/api/square/webhook
```

Subscribe it to payment/order events that fire after checkout payment changes:
`payment.created`, `payment.updated`, `order.created`, and `order.updated` are
the useful production set.
The Worker validates Square's `x-square-hmacsha256-signature` header with
`SQUARE_WEBHOOK_SIGNATURE_KEY`, then marks the matching appointment `confirmed`
and the approved submission `booked` when the Square order or payment is paid. The return page at
`/booking/confirmed/` still performs the same confirmation check as a fallback.

### Switching Square from sandbox to production

1. In the Square Developer Dashboard, switch the app from Sandbox to Production.
2. Copy the production access token and location ID.
3. Set Worker secrets:

```sh
npx.cmd wrangler@latest secret put SQUARE_ACCESS_TOKEN
npx.cmd wrangler@latest secret put SQUARE_LOCATION_ID
npx.cmd wrangler@latest secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```

4. Confirm `wrangler.jsonc` has `"SQUARE_ENVIRONMENT": "production"`.
5. In the production Square app, create/update the webhook subscription:
   - Notification URL: `https://thesixwellconstruct.com/api/square/webhook`
   - Events: `payment.created`, `payment.updated`, `order.created`, `order.updated`.
6. Deploy the Worker.
7. Run one low-dollar live checkout, then confirm the appointment moves from `deposit_pending` to `confirmed` and the related submission moves from `approved` to `booked` in `/studio/submissions/`.

Set up transactional email before enabling client confirmations and reminders:

```sh
npx.cmd wrangler@latest email sending enable artpilltattoohouse.com
npx.cmd wrangler@latest d1 migrations apply swc-submissions
```

The Worker uses the `EMAIL` send binding in `wrangler.jsonc`. Confirmation and
reminder email defaults are:

- `NOTIFICATION_FROM_EMAIL=saisolehman@artpilltattoohouse.com`
- `NOTIFICATION_REPLY_TO=saisolehman@artpilltattoohouse.com`
- `NOTIFICATION_FROM_NAME=art.pill TATTOO HOUSE`

Cloudflare must be allowed to send mail for `artpilltattoohouse.com`; otherwise
the code records skipped or failed deliveries in `notification_deliveries`.
The cron trigger checks hourly for confirmed appointments about 24 hours away
and sends one reminder per appointment.

Optional file storage uses R2. If the `SUBMISSION_FILES` binding exists, uploaded reference files are stored under `submissions/{submissionId}/...`. If it does not exist, the backend still records file metadata, but it cannot preserve the file contents.

Create the bucket before deploying the `r2_buckets` binding:

```sh
npx.cmd wrangler@latest r2 bucket create swc-submission-files
```

```jsonc
"r2_buckets": [
  {
    "binding": "SUBMISSION_FILES",
    "bucket_name": "swc-submission-files"
  }
]
```

## Migrated forms

The website submission paths now submit to `/api/submissions` with a `type` field:

- `/tattoos/inquire/` uses `tattoo_inquiry`
- `/tattoos/flash/claim/` uses `flash_claim`
- `/tattoos/build/` uses `build_brief`
- `/tattoos/special-projects/apply/` uses `special_project`
- `/art/acquisitioninquiry.html` uses `art_acquisition`

`/tattoos/build/in-person/` and `/tattoos/inquire/consultation/` are different:
they use the public consultation booking routes, create a linked
`consultation` submission for review context, create a Zoom meeting for virtual
consultations, and then send the client to Square for the consultation/build
deposit.

The review console utility form at `/studio/submissions/` is not a submission path. It only collects the admin token in the browser so the console can read protected admin endpoints.

## Booking and deposits

The branded booking flow starts at `/booking/`. Tattoo clients need a private token link generated from an approved submission in `/studio/submissions/`.

- Admin sets recurring weekly availability from the submissions console.
- Admin uses exceptions for closed dates, extra bookable blocks, or unusual days.
- Admin manages daily walk-in windows separately under the weekly schedule; these
  appear on `/tattoos/build/in-person/` but do not create deposit-bookable slots.
- Admin approves a submission, then generates a booking link.
- Client chooses a session and window.
- Client can choose no tip, `$10`, `$20`, `$50`, or a custom optional tip before Square.
- `POST /api/booking/checkout` creates a pending appointment and Square hosted checkout link with itemized deposit and optional tip rows.
- Only one pending appointment can exist per booking token. If the client needs a different time after starting checkout, revoke/regenerate the booking link or help them manually.
- `/api/square/webhook` confirms paid Square orders even if the client does not return from Square, and Square retry events are safe to process repeatedly.
- `/booking/confirmed/` also verifies the Square order when possible and shows confirmed or pending deposit state.

Public consultation/build sessions use:

- `GET /api/booking/public-consultation/context` for public session types,
  bookable windows, and walk-in windows.
- `POST /api/booking/public-consultation/checkout` to create a linked
  `consultation` submission, create the appointment, create a Zoom meeting when
  the selected type is `consult_virtual`, and start Square checkout.

Apply migrations through `0011_virtual_zoom_meetings.sql` before using this in
production so tips, public consultation booking types, walk-in windows, and
virtual meeting storage exist in D1.

The old tattoo booking paths redirect into the system booking flow:

- `/tattoos/booking/` -> `/booking/`
- `/tattoos/booking/confirmed/` -> `/booking/confirmed/`

## Ticketed events (Sip & Paint)

Public paid events run on their own isolated stack so the money stays separate
from tattoo deposits:

- Tables `events` and `event_tickets` (migration `0012_events.sql`).
- Module `functions/api/events/_lib.js`.
- The **same Square account/API token** as tattoo deposits, but a **dedicated
  Square location** (`SQUARE_EVENTS_LOCATION_ID`) so event money settles to that
  location's own bank account / EIN. Square allows a per-location EIN and bank
  account under one login (payroll is the only feature that still needs a wholly
  separate account). Isolation is reinforced with a dedicated webhook
  subscription + signing key feeding `/api/square-events/webhook`.

Public endpoints:

- `GET /api/events/:slug/context` — event info + seats remaining.
- `POST /api/events/:slug/checkout` — validates name/email/seats, capacity-checks
  against paid tickets, creates a pending `event_tickets` row, opens a Square
  hosted checkout on the events account, and mirrors an `event_rsvp` submission
  into `/studio` for visibility. Returns `{ checkoutUrl }`. The studio console has
  an **EVENT RSVP** type filter and an event detail card (event, seats, amount,
  paid status, ticket ID); paid tickets show as `booked`.
- `GET /api/events/tickets/:id` — ticket status for `/events/confirmed/` (also
  falls back to verifying the Square order if the webhook has not landed yet).
- `POST /api/square-events/webhook` — verifies the **events** signing key, marks
  the ticket `paid`, moves the mirrored submission to `booked`, and emails the
  buyer (`event_ticket_paid` template). Idempotent on Square retries.

The events checkout reuses `SQUARE_ACCESS_TOKEN` and `SQUARE_ENVIRONMENT` (same
account as tattoo deposits). You only need two new values before enabling ticket
checkout — the events location and its webhook signing key:

```sh
npx.cmd wrangler@latest secret put SQUARE_EVENTS_LOCATION_ID
npx.cmd wrangler@latest secret put SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY
```

`SQUARE_EVENTS_LOCATION_ID` is the location ID for the events location you create
in the Square Dashboard (Account & Settings → Business → Locations), where you
set that location's EIN/tax info and bank account.

`wrangler.jsonc` provides `SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL`. In the Square
Developer Dashboard (same application as the tattoo webhook), create a **second**
webhook subscription pointed at:

```text
https://thesixwellconstruct.com/api/square-events/webhook
```

subscribed to `payment.created`, `payment.updated`, `order.created`, and
`order.updated`, then copy its signing key into
`SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY`. (Both webhook subscriptions receive every
order in the account; each endpoint simply ignores orders it has no record for,
so tattoo and event payments never collide.)

The seeded Sip & Paint event uses **placeholder** price/capacity/date. Update
them (and add new events) with `wrangler d1 execute swc-submissions` against the
`events` table; set `status='open'` to make an event bookable.

## Availability model

Booking availability is now managed as a weekly schedule, not one block at a time.

- `booking_settings` controls timezone, booking horizon, minimum notice, slot interval, buffers, same-time capacity, and max sessions per day.
- `availability_rules` stores recurring weekly hours for each day.
- `availability_windows` is now for exceptions and generated/materialized booking slots.
- `walk_in_windows` stores daily public walk-in windows separately from bookable
  appointment/deposit windows.
- Blackout exceptions block generated weekly slots.
- Extra bookable exceptions can still be added for unusual days outside the weekly template.
- Capacity means simultaneous capacity for a single time slot. Multiple non-overlapping sessions can happen on the same day until the max sessions per day limit is reached.
