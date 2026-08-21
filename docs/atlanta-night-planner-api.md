# Atlanta night planner: phase-one contract

Phase one establishes reviewed planning metadata, reusable venue coordinates, and the private request
boundary. It does not call a routing provider or generate an itinerary.

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
is absent; there is no predictable fallback salt. A future routing-provider
key must also be stored as a Worker secret rather than shipped to browser
JavaScript.
