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
wrangler d1 create swc-submissions
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
wrangler d1 migrations apply swc-submissions
```

Set the admin token:

```sh
wrangler secret put SUBMISSIONS_ADMIN_TOKEN
```

Set Square secrets before enabling deposit checkout:

```sh
wrangler secret put SQUARE_ACCESS_TOKEN
wrangler secret put SQUARE_LOCATION_ID
wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```

Use `SQUARE_ENVIRONMENT=sandbox` while testing and `SQUARE_ENVIRONMENT=production` for live deposits.

Set up transactional email before enabling client confirmations and reminders:

```sh
wrangler email sending enable artpilltattoohouse.com
wrangler d1 migrations apply swc-submissions
```

The Worker uses the `EMAIL` send binding in `wrangler.jsonc`. Confirmation and
reminder email defaults are:

- `NOTIFICATION_FROM_EMAIL=saisolehamn@artpilltattoohouse.com`
- `NOTIFICATION_REPLY_TO=saisolehamn@artpilltattoohouse.com`
- `NOTIFICATION_FROM_NAME=art.pill TATTOO HOUSE`

Cloudflare must be allowed to send mail for `artpilltattoohouse.com`; otherwise
the code records skipped or failed deliveries in `notification_deliveries`.
The cron trigger checks hourly for confirmed appointments about 24 hours away
and sends one reminder per appointment.

Optional file storage uses R2. If the `SUBMISSION_FILES` binding exists, uploaded reference files are stored under `submissions/{submissionId}/...`. If it does not exist, the backend still records file metadata, but it cannot preserve the file contents.

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
- `/tattoos/build/in-person/` uses `consultation`
- `/art/acquisitioninquiry.html` uses `art_acquisition`

The review console utility form at `/studio/submissions/` is not a submission path. It only collects the admin token in the browser so the console can read protected admin endpoints.

## Booking and deposits

The branded booking flow starts at `/booking/`. Tattoo clients need a private token link generated from an approved submission in `/studio/submissions/`.

- Admin sets recurring weekly availability from the submissions console.
- Admin uses exceptions for closed dates, extra bookable blocks, or unusual days.
- Admin approves a submission, then generates a booking link.
- Client chooses a session and window.
- `POST /api/booking/checkout` creates a pending appointment and Square hosted checkout link.
- `/booking/confirmed/` verifies the Square order when possible and shows confirmed or pending deposit state.

The old tattoo booking paths redirect into the system booking flow:

- `/tattoos/booking/` -> `/booking/`
- `/tattoos/booking/confirmed/` -> `/booking/confirmed/`

## Availability model

Booking availability is now managed as a weekly schedule, not one block at a time.

- `booking_settings` controls timezone, booking horizon, minimum notice, slot interval, buffers, same-time capacity, and max sessions per day.
- `availability_rules` stores recurring weekly hours for each day.
- `availability_windows` is now for exceptions and generated/materialized booking slots.
- Blackout exceptions block generated weekly slots.
- Extra bookable exceptions can still be added for unusual days outside the weekly template.
- Capacity means simultaneous capacity for a single time slot. Multiple non-overlapping sessions can happen on the same day until the max sessions per day limit is reached.
