# WRKNG* authoring and local validation

Mindful Darkness lives at `/writings/mindful-darkness/`. Its WRKNG* section lives
at `/writings/mindful-darkness/wrkng/`. Studio → Writings → WRKNG* manages the
entries; `/studio/submissions/#writings` opens that section directly.

Save draft keeps the current public snapshot intact. Preview saves first, then
opens the authenticated reader. Publish updates replaces the public snapshot.
Unpublish withdraws the reader; Archive keeps the entry available for restoration.
The URL name becomes permanent after first publication. The seeded reading-layout
sample is preview-only and cannot be published.

The public date is always the first publication date. Its ⓘ control opens the
creation and publication-update dates, including time in Eastern time. Studio and
authenticated previews also include the last draft save there. New entries capture
creation on the first editor change and retain it when the first save succeeds;
later saves and publication never reset it. Older entries whose first edit was not
recorded show the known **First saved** timestamp instead of an invented start time.

## Editor build

Run from this directory:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

The lockfile pins Tiptap 3 and the metadata reader. Commit the generated files in
`studio/vendor/writing-editor/` with source changes. The existing static deployment
requires no npm build. This package and its dependencies are excluded from static
assets; only the generated browser bundle and licenses are served.

## Isolated preview

From the repository root, run these in separate terminals:

```sh
WRITING_API_PORT=4194 node tools/writing-preview-server.mjs
PORT=4193 SWC_API_ORIGIN=http://127.0.0.1:4194 node tools/dev-server.mjs
```

Open `http://127.0.0.1:4193/studio/submissions/#writings` and unlock with
`writing-local-preview`. The API uses an in-memory SQLite database with every
migration applied and an in-memory media bucket. **This is disposable test data:
restarting the API discards all entries and uploads.** It never reads production
credentials or proxies mutations to production. The ordinary development server
on port 4173 retains its existing API proxy; do not use it for writing mutations.

The sample reader is at
`http://127.0.0.1:4193/studio/writings-preview/?entry=writing-layout-sample`
after unlocking Studio on the same origin. Public routes and APIs never return it.

## Storage and publication

Migration `0227_mindful_darkness_writing_entries.sql` adds separate versioned working
and published JSON snapshots. A single D1 batch publishes the snapshot, entity,
search document, relationships, image eligibility, and revision history. Optimistic
version guards roll back a conflicting batch; published image references are
protected against silent withdrawal or deletion in the media library.

Migration `0228_writing_entry_dates.sql` adds the first-edit and last-draft-save
timestamps. It preserves existing first-save times and recovers draft-save dates
from revisions without changing public content or publication dates.

Images use managed media IDs. The editor retains the original file and parsed
metadata internally, with SHA-256 provenance supplied by the shared upload API.
It prepares a display derivative with embedded metadata removed (retaining GIF
animation); the private provenance records its source media ID and transformation.
Capture evidence and file modification times remain separate from the work's date.
Selecting an existing private image requires its public-use status to be resolved
in the media library before insertion. A writing draft never publishes an upload.

The backend accepts only the shared version-1 document schema. Public output is
escaped, supports only safe links, and resolves media through managed asset IDs.
The public reader is rendered in the Worker and local server. Authenticated preview
uses the same renderer and stylesheet, with protected images fetched as local blobs.

## Release order

This release is currently local, as requested. When production release is authorized:

1. Sign in to Wrangler and inspect remote migrations. Resolve any unrelated pending
   migrations separately; avoid applying an unknown batch.
2. Apply migrations 0227 and 0228 before deploying the writing code.
3. Deploy using the repository's existing Cloudflare Worker/static-assets workflow.
   Keep the sample private. Do not push; the repository owner handles Git pushes.
4. Verify public lists are empty until a real entry is published, sample and unknown
   entry routes return 404, and both new pages appear in Studio Public Visibility.

Focused regression suite:

```sh
node --test tests/writing-entries-contract.test.mjs tests/search-contract.test.mjs tests/current-works-contract.test.mjs tests/media-publication-contract-migrations.test.mjs tests/media-catalogue-gallery-contract.test.mjs tests/studio-batch-media-contract.test.mjs tests/legend-private-media-variant-contract.test.mjs tests/construct-wayfinding-contract.test.mjs tests/page-visibility-contract.test.mjs
```

No comments, subscriptions, scheduling, or public revision history are included.
