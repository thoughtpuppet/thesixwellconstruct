# SNY 00 — private implementation review

## Launch update — October 24, 2026

The site owner authorized revealing, publishing, and opening SNY00, an edition
of Solehman's New Year. Migration `0246_sny00_launch.sql` applies that launch
configuration after deploying the matching RSVP code: unlimited capacity
(`capacity=0`, matching shared Events), up to three people per RSVP,
November 6 at 6:30–9 PM Eastern, and 364 Nelson Street SW, Suite 12.

The page and confirmation emails include prompt arrival, optional personal
drawing/art-making materials, entry help at 770-820-5800, and the tattoo-client
parking instructions. The original invitation artwork is preserved; a visible
note identifies its 7 PM start as superseded. Tyrone's link is corrected to
`/events/sny-00/`, and his supplied documentarian relationship becomes public.

Food requirements are no longer collected or edited. The legacy database
column remains for schema compatibility and receives an empty value.

Each new RSVP gets a confirmation through the existing event email identity
and shared email renderer/delivery log. Repeated emails retain the original
RSVP and do not resend. Failed deliveries retry on the existing scheduled
Worker, with an atomic lease preventing concurrent retry sends. No marketing,
payment, ticket, or actual-attendance side effect is added. The local preview
captures test emails in memory and sends nothing externally.

The earlier sections below document the original hidden draft and its review
decisions; the launch configuration above supersedes those settings.

Status: HIDDEN RELEASE PREPARED. The user authorized deploying this draft on
October 22, 2026 while its public URL returns the existing 404 page. Its Event
remains a closed draft and registration remains unavailable. No invitation,
email, calendar event, registration, permission change, or new credential is
part of this release. See the external release receipt for actual execution.

## Existing state checked

- Repository: `thoughtpuppet/thesixwellconstruct`; existing visible branding is
  the six.well construct. No site rename is part of this draft.
- Remote main was verified at `80a84548900910fd27485e46e02fde684a90069f`.
  Work is isolated in `task-3/sny00-review`, branch `review/sny00`.
- Original checkout remains at `6b7468342a16eaea98b60c4714fc8742b0bb6839`.
  Its staged/unstaged edits were not copied, reset, or bundled.
- Read-only authenticated live Event inventory on October 21, 2026 found six
  events and no SNY 00 or November 6 occurrence. No attendee identities were read.
- Existing `solehmans-new-year` is the October 2027 annual showcase.
  Existing `signal-symbol` is a separate draft with a historical registration.
  Neither is renamed or repurposed.
- Existing architecture: D1 Events, dated occurrences, admission choices,
  ticket/free-signup lifecycle, shared Studio session, confirmations/reminders,
  CRM, optional marketing consent, publication visibility, and Archive identities.
- Existing free signups require name, email and phone, use ticket `paid` status,
  and trigger correspondence/CRM. No separate actual-attendance ledger or
  event recording/publication release was found. Existing marketing consent
  is not an event documentation release.

## Prepared

- `events/sny-00/index.html` extends the closest SNY page shell, shared header,
  navigation, breadcrumb, hero roles, form styling, footer and Events accent.
- SNY 00: November 6, 2026, 6:30–9:30 PM America/New_York (EST, UTC−05:00).
  That is November 6 at 23:30 UTC through November 7 at 02:30 UTC.
- Draft copy uses the established Signal & Symbol gathering, green[field]
  introduction, KINMARKING, Saiel presenting, optional site presentation if
  ready, and planned promo/archive footage. Purpose and flow remain in the
  separate planning work. “Focus group” is a review question, not a chosen label.
- Migration 0244 adds private RSVP and paper-attendance tables linked to the
  existing event/date identities. Existing ticket semantics are preserved.
- Migration 0245 adds one closed draft with a blank location and unset capacity.
  It stops if matching slug/name/start instant exists and can be rerun safely.
  An internal content identity is included. It does not publish an Archive dossier.
- Minimal RSVP fields: name, email, party size, optional food requirements.
  No phone requirement, health diagnosis request, public roster, recording
  consent checkbox, marketing subscription, or archive publication grant.
- Public confirmation appears on the page. There are no receipt tokens or
  email promises. Duplicate normalized emails keep the original details/status;
  changes and reactivation are handled by the organizer in Studio.
- One atomic SQL insert checks date, publication, operations, party allowance
  and capacity. A unique identity protects repeat/racing submissions. Unset
  capacity means closed for this lane. No waitlist or payment fallback.
- Studio Events links to `/studio/event-attendance/?event=sny-00`, using its
  existing admin session. Food notes remain organizer-only.
- Actual attendance is transcribed later from the paper door sheet. Sheet/row
  references prevent duplicate transcriptions; matching RSVPs and walk-ins are
  separate records. Nothing marks an RSVP attended automatically. A transcription
  timestamp is not presented as the guest's arrival time.
- This initial private RSVP lane deliberately supports a single event date.
  Adding multiple dates closes it pending a date-aware extension.

## Recording notice update — October 22, 2026

The pre-submission notice now uses the user's exact wording:

> Promo and archive footage capture is planned. If you do not wish to be recorded, do not attend. RSVPing is also an acknowledgement and consent to being recorded.

Contradictory recording opt-out and no-recording-permission wording was removed
from this draft. Marketing and unrelated permissions remain separate. This is
a local copy edit; RSVP storage and validation are unchanged. The existing RSVP
record has no dedicated recording acknowledgement or notice-version field.

## Local review

From this isolated clone, run `node tools/sny00-preview.mjs`, then open
`http://127.0.0.1:4185/review/`.

The loopback-only preview has no production API proxy or external messaging.
All test writes stay in memory and disappear on restart. Its simulated open
state uses sample capacity 20 and party allowance 4; those are not event decisions.
The review hub opens a clearly named fixture Studio session. This test constant
is not a production credential. `/review/draft` verifies the real draft is 404.
Use the hub's UI Guide link to inspect existing page anatomy in the same review.

The preview runner, tests, migrations, documentation and output are excluded
from published static assets. A `?preview=1` query does not unlock the draft.

## Decisions before launch

These decisions apply to a future reveal and registration opening. The current
release is intentionally hidden at `https://thesixwellconstruct.com/events/sny-00/`.

1. Approve purpose/flow copy from the parallel planning work, including whether
   “focus group” is useful. This implementation chooses no descriptor beyond
   the established small Signal & Symbol gathering.
2. Choose capacity, guest allowance, RSVP deadline, and change/cancellation
   contact. The draft has no deadline feature; add one if a cutoff is wanted.
3. Choose venue disclosure, arrival and accessibility details. No studio address
   was copied into this event. Other events' public addresses are not treated
   as approval for SNY 00.
4. Review whether the recording acknowledgement needs stored evidence or a notice
   version. Decide any separate likeness/quote use and archive-publication permissions.
5. Approve the purpose and retention/deletion periods for attendee/contact records,
   paper sheets, and practical food notes. Food notes should be cleared after
   food planning; Studio can clear the field, but automatic expiry is not built.
   No attendee/food export or publication is implemented.
6. Decide whether confirmation/reminder emails are wanted. Current behavior is
   on-page confirmation only. Review any correspondence before enabling it.
7. Approve a future reveal and registration opening. Keep the existing page
   visibility rule hidden and the Event in draft until that instruction arrives.

## Existing visibility system used for the hidden release

The user's `tools/page-visibility.html` was inspected read-only in the original
checkout. It is unchanged there. It imports `studio/page-visibility-manager.js`
and uses the same Studio token and authenticated `GET/PATCH
/api/admin/site-visibility` as Studio → Site → Public Visibility. It does not
move files or rewrite Worker source. The original uncommitted registry edit
only removes two About entries; it is unrelated and is not bundled here.

`shared/page-visibility.js` registers routes and fallback defaults. Migration
0157 stores live `site_visibility_rules` and `site_visibility_settings` in D1.
Paths normalize case, query/hash, trailing slashes and `/index.html`; registered
HTML aliases normalize too. Longest matching path wins. Descendant scope can
hide a family; a more specific public child overrides it. Home and the error
page stay public. Home-only hides other page routes. Show All deletes live rules.

The Worker's existing page gate runs before canonical redirects and static or
dynamic page handlers. It serves the existing `/404.html` body with HTTP 404,
`Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow, noarchive`.
Visitors and crawlers share this code path. Sitemap generation uses the same
visibility decisions. Normal local development consults the configured Worker
origin and falls back to seeded defaults; `--show-hidden` bypasses local hiding.

Limits: this is a registered page control, not universal record publication or
API authorization. Navigation, search, record publication, Studio, APIs, assets
and private booking links are separate. Missing D1/settings falls back to code
defaults for public decisions; authenticated controls require migration 0157.

SNY 00 is now a registered entry with a hidden descendant rule in the existing
system. The private RSVP list/context/submission lane reads that same decision,
so hiding the page also disables public RSVP access, even if Event operations
are later opened by mistake. The closed draft is an additional existing gate.
No separate hiding mechanism was introduced.

The existing Drive document is **Six.Well Website — Systems Roadmap**, ID
`1YwdYu6XXesIFl4aLJkn2p-lHqy2UKzJWyhhsssKudYc`. The parent task identified
that its sections 03, 15 and 25 mention visibility broadly without documenting
this mechanism. The parent coordinates that document update; this task does
not write to it. README's inaccurate redirect description is corrected here.

## Separate event-prep design deliverables

- Flyer, aligned with existing SNY/site visual language.
- Paper door sign-in sheet with sheet/row references for reconciliation. Keep
  contact details and food notes off a shared sign-in roster. Separate publication
  permissions remain a review item.
- Printed reflective takeaway, content developed with the purpose/flow work.
- Digital equivalent of that reflective takeaway.

These are preserved as separate work, not marked designed or replaced by the page.

## Verification

Run `node --test tests/sny00-rsvp.test.mjs tests/events-publication-calendar-contract.test.mjs tests/seo-system-contract.test.mjs tests/kinmarking-studio-editions.test.mjs`.

New integration coverage includes draft/announced/closed/ended states, unset
capacity, email normalization, repeated and concurrent submissions, server
validation, capacity changes/cancellation, private admin access, no public PII,
no email/ticket side effects, blocked alternative signup routes, paper matching,
walk-ins, duplicate paper/RSVP links, and public page/sitemap visibility.

Browser evidence and detailed check results are retained under `output/` for
this local handoff. The Worker packaging check uses Wrangler 4.129.0 with
`deploy --dry-run`; it uploads nothing and does not apply migrations.
