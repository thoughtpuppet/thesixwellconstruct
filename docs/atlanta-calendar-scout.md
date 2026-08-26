# Atlanta Calendar + Event Scout

The Atlanta Calendar is a curation layer, not a second event-production system.
Six.Well-produced events remain in `events` and `event_occurrences`. Approved
outside listings live in `calendar_entries`. `/api/calendar/events` normalizes
both sources at read time.

## How the scout knows what to do

The editable `atlanta-default` Scout Profile is the instruction set. It stores:

- weights for subjects and formats;
- positive concepts and negative terms;
- Atlanta-metro geography rules;
- date horizon, relevance threshold, duplicate sensitivity, and run limits;
- direct-source and broad-web cadences;
- the configured OpenAI model.

The profile can be edited in `/studio/calendar/`. Feedback never silently
rewrites it. Repeated rejection patterns create a proposed adjustment in the
Suggestions panel, and that adjustment changes the profile only after an
explicit acceptance.

## How it finds events

Each scheduled run has two independent lanes:

1. Enabled official sources are fetched directly. Bounded, public HTTP(S)
   responses are checked for structured Event data. Local/private network URLs,
   oversized responses, excess redirects, invalid dates, non-Atlanta locations,
   and out-of-horizon dates are rejected deterministically.
2. When the `OPENAI_API_KEY` Worker secret exists, the Responses API runs one
   broader web-search pass using the configured model and a strict JSON schema.
   Retrieved text is treated as untrusted data. The model can extract,
   classify, rank, and cite; it cannot publish.

If the OpenAI secret is absent, the direct-source lane continues and the Studio
reports broad discovery as disabled.

## Approval boundary

Every result becomes a private `calendar_candidate`. Private notes live in a
separate table and are never selected by public queries. Approve + Publish copies
the current factual revision into `calendar_entries`, assigns a stable UID, and
increments the iCalendar sequence when an approved snapshot changes.

Routine re-verification updates timestamps. A date, venue, description, link,
or cancellation change creates a pending revision while the last approved public
snapshot remains live. A confirmed date, organizer, factual description, venue,
Atlanta-metro location, official URL, subject, format, and valid time zone are
required before publication.

Attendance defaults to public when no source states a restriction. A named
limited audience is stored as restricted, and only genuinely conflicting access
evidence remains unknown for Studio verification. Source-style narration in a
public field is an editorial cleanup signal, not an approval blocker.
Performer, vendor, applicant, workshop, or competition eligibility does not
restrict audience attendance unless the source also limits attendees.

## Discovery and tuning audit

Run History records sources, web queries, citations, candidate and duplicate
counts, failures, and OpenAI usage. Source Registry cards expose retrieval errors
and acceptance rates. Sources can be lowered, paused, or removed without changing
already approved public snapshots.

The repository-backed Atlanta Creative Event Alerts scheduled task may submit
its qualified matches to `POST /api/admin/calendar/strong-picks`. The endpoint
accepts the dedicated `CALENDAR_SCOUT_INGEST_TOKEN`, creates or refreshes only
private candidates, records Strong Picks and run diagnostics, and cannot read
the rest of Studio with that credential. Duplicate, unchanged, suppressed, and
failed results remain explicit in the handoff response.

The scheduled task must run against this project and follow the durable prompt
in `docs/atlanta-creative-scout-scheduled-task.md`. It writes its temporary JSON
batch under the ignored `output/` directory and invokes:

```powershell
node tools/calendar-scout-handoff.mjs --file output/atlanta-creative-scout-handoff.json
```

The client refuses to forward the credential to another production host or API
route and prints only a sanitized result. `CALENDAR_SCOUT_INGEST_TOKEN` must be
available in the scheduled task's process environment or, on Windows, the
current user's persisted environment. The handoff tool reads the user-scoped
value directly when the scheduled-task sandbox filters inherited variables.
Never place it in the task prompt, repository, JSON payload, or command
arguments.

## Release gate

Migration `0129_atlanta_calendar.sql`, the `OPENAI_API_KEY` Worker secret, the
dedicated `CALENDAR_SCOUT_INGEST_TOKEN`, and the Worker/static deployment must be
released only after explicit production approval. Keys must be configured as
Worker secrets and must never be added to `wrangler.jsonc`, source code, logs,
Studio responses, or scheduled-task prompts.
