# Booking hub — local review, 2026-10-23

Status: implemented locally for review. No deployment, push, production submission, booking, payment, test email, calendar mutation, credential change, or access change was performed.

## Review the page

Run `node tools/booking-hub-preview.mjs` from the repository and open <http://localhost:4196/booking/>. The supplied preview server binds only to loopback, never proxies production APIs, and rejects every API request and every write. Other running development servers may proxy production; use this dedicated preview for booking review.

Use `/booking/?preview=1&hub=1` to exercise the inquiry form's browser validation and no-send receipt. Existing `/booking/?preview=1` continues to preview the original private client flow. Local screenshots and detailed test output are in the delegated task workspace, under `review-site/output/playwright/` and `review-site/booking-validation-results.txt`.

## Implemented behavior

- No-token visitors get a public Ways In hub with the shared header, breadcrumb, hero, typography, solid canvas, footer, medium accents, and mobile layout.
- Visits link to `/booking/studio-visit/`; room events link to `/booking/studio/`; tattoos and tattoo consultations link to their established inquiry routes.
- Appearance, speaking, general consultation, interview, collaboration, and other requests use one `engagement_request` submission type with six allowlisted categories. They are inquiries only. No rates, durations, appointment slots, or response deadline are introduced.
- The server validates contact information, category, bounded text, website protocol, and inquiry acknowledgement; ignores client lifecycle/booking fields; rejects uploads; and requires an idempotency key. Retries reuse the key, including concurrent duplicate requests. Client responses expose the receipt reference, not private request content.
- Inquiries appear in the protected booking inbox, its phone view, and Studio's separate Engagements view. The Studio view supports private notes, history, receipt delivery history, and archive. It does not show tattoo scheduling, tattoo lifecycle, or private booking controls.
- Existing authorized receipt/admin notification functions and owner push settings are reused with Construct branding. Local tests use mock delivery only.
- Presence of a token, including an empty or invalid token, retains the private page. Legacy token queries, `/b/{token}`, validation, expiry/invalid errors, existing private previews, special-request entry, payments, and redirects remain in the existing flow. The worker and booking-link router are unchanged.
- Room gatherings and rentals now require exclusive time even if a historical availability window has capacity above one. Checks apply in both directions: other appointment types cannot later overlap an existing room event. Server preflight, atomic inserts, and confirmed reschedules enforce the rule. Visit and other capacity rules remain otherwise intact.

## Conflict audit and deployment blockers

Do not deploy this as proof of conflict-free instant room booking yet. No review gate was added; the existing route still goes directly to deposit checkout for an available appointment window.

1. **The studio-scope iCloud gap is addressed in local code.** Room availability now queries every blocking calendar already selected in the existing integration and filters its busy periods, including appointment buffers. Checkout and room rescheduling recheck those calendars before claiming time. A recent tattoo cache does not substitute for a studio read. Missing credentials/settings/selection, permission errors, transport errors/timeouts, malformed or partial responses, unexpanded recurrence, and unresolved event timing return unknown availability; the public room API returns HTTP 503 and creates no hold. Studio manual scheduling retains its existing explicit admin override. No calendar selection, credentials or permissions were changed. An existing authenticated Studio task reported the live selection as Administration, Personal and SCHOOL on October 23, 2026 at 1:52:43 PM EDT, with both sync directions enabled, recent successful syncs, no error and stale=false. This is recorded sync status, not a fresh CalDAV probe. The confirmed work-time policy below intentionally leaves 99SLOTH outside the conflict selection.
2. **Separate Events records do not claim shared room time.** Ticketed events use `events` and `event_occurrences`, independently of `appointments`. Public calendar listings also do not by themselves reserve the room. There is no explicit shared resource mapping between those records and room availability. A local fixture demonstrates that a published event at the same time does not remove the room window.
3. **Minimum event decision:** identify the event IDs or individual occurrence IDs that occupy this studio room; confirm their occupied start/end and any setup/cleanup buffers. Parent event assignment can cover all its occurrences only if that is intended. Existing records expose a free-text location and do not reliably distinguish this studio from an off-site venue. No other event should block the room automatically. Once this assignment exists, connect that explicit resource to the atomic appointment/hold/reschedule checks and guard event edits against existing reservations. Until then, the separate Events gap remains a deployment blocker. Verify the already-authorized live blocking calendars as well. If more calendar permission is required, obtain it before integration; do not broaden access or infer a resource from a venue name.

## Confirmed work-time booking policy

The user explicitly chose to keep **99SLOTH excluded** from booking conflicts so paid bookings remain possible during planned SAR and website work. This is an intentional business rule, not an unresolved coverage defect. Work blocks recorded only on 99SLOTH do not reserve booking availability. Leave those events and the current calendar selection unchanged; no credential, permission or calendar-configuration change is authorized or needed for this decision.

Administration, Personal and SCHOOL remain the recorded inbound conflict selection; art.pill Tattoo House remains the recorded outbound destination. Missing, failed or incomplete reads of required selected calendars still produce unknown studio availability. The intentional 99SLOTH exclusion does not weaken those error safeguards.

The whole-room event occupancy decision remains unanswered. The read-only candidate investigation identified the exact same-studio event/occurrence list and existing 30-minute before/after room defaults. Confirm exclusive room occupancy or only its exceptions, and supply GREEN[FIELD]'s missing occupied end time. Implement and verify that mapping before deployment; do not infer that this work-time decision answers the separate room question. No deployment is authorized.

The task adds no appointments for the inquiry categories. If those engagements later need direct scheduling, their availability, duration, pricing/deposit, cancellation rules, and resource ownership remain business decisions. They can remain inquiries without those decisions. The existing noindex/referrer protections on the combined booking entry are retained; public search indexing can be considered separately from private token safety.

## Validation

The focused command below covers the new hub and inquiry behavior, private links, existing booking copy, CalDAV parser/sync behavior, date overrides, weekly schedules, and the protected phone inbox. It uses migrated local SQLite fixtures and mocks, with no production credentials.

```powershell
node --test tests/booking-hub.test.mjs tests/booking-link-contract.test.mjs tests/booking-client-copy-contract.test.mjs tests/booking-calendar-sync-contract.test.mjs tests/daily-availability-overrides-contract.test.mjs tests/future-weekly-availability-contract.test.mjs tests/weekly-availability-contract.test.mjs tests/booking-phone-app.test.mjs
```

New fixtures cover every standard tattoo session length, in-person and virtual consultations, build sessions, visits, room gatherings/rentals, buffers, adjacency, simultaneous claims, room-vs-consultation races, successful mocked checkout/resume, pending/expired/attention holds, released/cancelled states, and distinct UTC instants across the New York fall-back. Calendar fixtures additionally cover real busy-period filtering, complete reads despite a fresh tattoo cache, one inaccessible source among several selected calendars, and every unknown-availability failure listed above. The separate ticketed-event fixture records the remaining resource-mapping blocker.

Browser QA checked the canonical UI guide at `localhost:4173/tools/ui-guide.html`, desktop and 390px mobile layout, card-to-category selection, no-send form behavior, and invalid private links. At 390px, document scroll width is 390px; the root canvas is `rgb(14,14,14)` and only the correct view's primary heading is visible. Preview API errors are intentional write/production-access guards.

The older `Studio UI and public booking pages keep visits under Art and room booking separate` contract fails on the untouched repository because it expects `Your Open Studio Visit is confirmed.` in Studio source. This was reproduced against the original source before applying these changes. The separate policy-page copy assertion in `tattoo-flow-contract.test.mjs` also fails on untouched source because it expects markup without current managed-copy attributes; four neighboring selected copy checks pass both before and after. An early partial-snapshot run additionally lacked supporting docs/apps; final repository checks use the actual repository. These unrelated assertions were not rewritten to make this task appear green.

## Exact files in this change

1. `booking/index.html`
2. `css/booking-hub.css` (new)
3. `js/booking-hub.js` (new)
4. `shared/engagement-requests.js` (new)
5. `functions/api/submissions/_lib.js`
6. `functions/api/notifications/_lib.js`
7. `functions/api/booking-push/_lib.js`
8. `functions/api/booking/_lib.js`
9. `studio/submissions/index.html`
10. `studio/bookings/bookings.js`
11. `tests/booking-phone-app.test.mjs`
12. `tests/booking-hub.test.mjs` (new)
13. `tests/helpers/booking-hub-fixture.mjs` (new)
14. `tools/booking-hub-preview.mjs` (new)
15. `docs/booking-hub-review.md` (new)
16. `functions/api/booking/_calendar-sync.js`

No migrations are required: the existing submissions table already supports this private inquiry record type and unique idempotency keys. Existing uncommitted changes outside this list are preserved. No commit was made.
