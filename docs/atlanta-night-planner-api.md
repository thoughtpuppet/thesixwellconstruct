# Atlanta night planner: phase-one contract

Phase one establishes reviewed planning metadata and the fail-closed public request boundary. The
private Studio pilot now exercises routing and itinerary generation before any public rollout.

## Private Studio pilot

`GET /api/admin/calendar/planner?date=YYYY-MM-DD` loads events whose facts are verified in Studio.
The pilot accepts timed, scheduled, in-person records with a venue address; it can temporarily
geocode a verified venue address when reviewed coordinates have not yet been stored. Those temporary
provider results are not written back to the event record.

`POST /api/admin/calendar/planner` accepts the same location and selection shape documented below,
plus `startTime` as a 24-hour Atlanta time representing the earliest the visitor is available to
depart. The solver preserves that constraint while generating the latest safe `leaveByTime` from the
starting location. Its first stop uses that departure rather than showing avoidable waiting at the
venue, and each stop includes `departureTime` and `arrivalTime`. `mustAttendEventIds` is an array and
may contain more than one selected event. Every ID in the array is a hard constraint: a successful
itinerary contains all of them, while an impossible combination returns HTTP 409 with
`code: "must_attend_conflict"`.

The Studio route is admin-authenticated. Start and end locations are used only for the current
provider request and are not written to D1. Mapbox geocoding resolves temporary endpoints and missing
event coordinates, and the Matrix API supplies driving or walking travel durations for sequencing.

### Attendance inference and sequencing

- Exhibitions, openings, and closings are flexible attendance windows. When Studio has not supplied
  visit lengths, the pilot tries a 45-minute visit and may shorten it to 30 minutes to preserve a
  more constrained event.
- Talks, lectures, panels, artist talks, and conversations are timed anchors. The route aims for an
  on-time arrival and permits at most 15 minutes of lateness only when no otherwise-equivalent route
  can stay on time.
- Explicit occurrence types such as a screening, performance, or workshop remain fixed starts even
  when the parent event is an exhibition.
- The solver evaluates flexible stops inside the waiting time before a timed anchor. It ranks routes
  by events included, then total lateness, then timed anchors preserved, before visit length and travel.
  When route quality and travel are otherwise equal, it prefers the route with the later safe departure.

## Published event metadata

Curated events and occurrences expose a `planning` object:

- `eligible`: true only for an enabled, scheduled, timed, in-person listing
  with a confirmed address and reviewed coordinates.
- `ineligibleReasons`: stable machine-readable reasons for an unavailable item.
- `attendanceMode`: `fixed_start`, `flexible_window`, or `drop_in`; Studio's
  `inferred` value is resolved before publication.
- `recommendedArrivalMinutes`, `minimumVisitMinutes`, and
  `recommendedVisitMinutes`: reviewed scheduling constraints.
- `lateArrivalAllowed`: whether arrival after the published start is viable.
- `latitude` and `longitude`: reviewed venue coordinates, never visitor data.
- `notes`: a short public operational note.

Planning eligibility defaults off. Studio reviewers may enable it only after
the event has valid timing and a reviewed coordinate pair. A candidate without
event-specific coordinates can inherit them at publication from an enabled
known organization whose venue name or alias matches the event venue.

## `POST /api/calendar/plan`

The endpoint accepts JSON and is limited to 30 requests per hashed network
identity per hour. Raw IP addresses, origins, and destinations are not written
to the database or application logs by this implementation. Expired rate-limit
records are removed automatically.

```json
{
  "date": "2026-09-12",
  "eventIds": ["curated:event-a", "curated:event-b"],
  "start": { "kind": "place_id", "placeId": "provider-place-id" },
  "end": { "mode": "return_to_start" },
  "travelMode": "driving",
  "objective": "most_events",
  "mustAttendEventIds": ["curated:event-b"],
  "arrivalBufferMinutes": 10
}
```

Locations may use a provider `place_id`, latitude/longitude `coordinates`, or
an `address`. A custom end uses `{ "mode": "custom", "location": { ... } }`.
The other end modes are `last_event` and `return_to_start`.

The server reloads event facts by ID and rejects missing, wrong-date, or
planning-ineligible events. It never trusts client-supplied event times or
venues. Until phase two configures routing, a valid request returns HTTP 501
with `code: "routing_not_configured"`; location values are not echoed.

## Required deployment configuration

Set `CALENDAR_PLANNER_RATE_LIMIT_SALT` to a secret, environment-specific value
before enabling the public planner. Requests fail closed with HTTP 503 when it
is absent; there is no predictable fallback salt.

The private pilot additionally requires `MAPBOX_ACCESS_TOKEN`. Keep it in local `.dev.vars` during
local testing and use a Worker secret only when a deployment is separately approved; it must never
ship to browser JavaScript.
