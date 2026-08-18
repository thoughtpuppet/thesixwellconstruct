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

## Discovery and tuning audit

Run History records sources, web queries, citations, candidate and duplicate
counts, failures, and OpenAI usage. Source Registry cards expose retrieval errors
and acceptance rates. Sources can be lowered, paused, or removed without changing
already approved public snapshots.

The prior ChatGPT alert should remain active during the planned two-week shadow
comparison. It is external to this Worker and was intentionally not altered by
this implementation.

## Release gate

Migration `0129_atlanta_calendar.sql`, the `OPENAI_API_KEY` Worker secret, and the
Worker/static deployment must be released only after explicit production
approval. The key must be configured as a Worker secret and must never be added
to `wrangler.jsonc`, source code, logs, or Studio responses.
