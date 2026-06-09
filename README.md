# the six.well construct

Pure static site for `thoughtpuppet/thesixwellconstruct`.

## Ecosystem-first site principle

Every page is a medium in a living creative ecosystem. The site should remind
visitors of those relationships at every turn.

When building, editing, or proposing any page, section, product flow, or
medium surface, keep these questions active:

- What is the page's primary action or purpose?
- Which other mediums should it naturally point toward?
- Is the connection conceptual, commercial, archival, experiential, or
  biographical?
- Does the connection deepen the experience while supporting the main action?
- Does the page make the visitor feel the larger construct around it?

Preferred connection patterns:

- Related medium bands linking meaningful practices.
- Source lineage that shows where an idea, image, object, or ritual came from.
- Object pathways that show how work can move between art, tattooing, merch,
  writing, film, music, events, and archive.
- Next actions such as inquire, claim, read, attend, collect, listen, revisit,
  or enter the archive.
- Archive memory for process, abandoned versions, studies, ephemera, and
  connective tissue.

This principle should drive recommendations and implementation choices across
all mediums. These reminders should usually feel like discovery: quiet paths,
traces, source threads, and optional doors that reward attention. A conversion
page can stay focused while including at least one intentional, subtle reminder
of the wider construct.

## Construct language

Use **medium** for the top-level practice areas formerly called nodes or
ventures: tattooing, art making, merch, about, events, music, writings, archive,
and film.

Use **pathway** for the internal routes that used to be called subnodes. A
pathway is an entry route inside a medium, such as flash, portfolio, inquiry,
acquisition, field notes, rooms, or process.

Some implementation keys still use the older `venture` name for compatibility,
including `body[data-venture]`, Shopify `venture:` tags, and existing JS/CSS
selectors. Treat those as legacy technical identifiers unless a dedicated
migration is being performed.

## Generous language rule

Describe what the work invites, offers, carries, and opens toward. Let each
page, project, and medium be defined by positive intent and grounded
specificity.

Preferred phrasing:

- "Best for," "drawn toward," "built for," "good entry point," and "opens into."
- Warm boundaries that explain the path forward.
- Process language that helps visitors understand how to enter well.

Reserve boundary phrasing for operational clarity, such as booking status,
private routes, legal requirements, or form confirmation. Even then, keep it
plain and generous.

## Hosting

This site deploys on Cloudflare Workers using Wrangler's static asset support
plus a Worker entrypoint for runtime routes.

- Production branch: `main`
- Root directory: repository root
- Build command: `None`
- Deploy command: `npx.cmd wrangler@latest deploy`

Because the site uses root-relative asset and page paths such as `/css/transitions.css`
and `/art/`, it should be deployed at the domain root rather than under a subpath.

## Cloudflare Worker setup

1. Create or open the Git-connected Worker for this repository.
2. Select `main` as the production branch.
3. Leave the root directory at the repository root.
4. Leave the build command as `None`.
5. Keep the deploy command as `npx.cmd wrangler@latest deploy` for Windows/PowerShell.

No bundler, package install, or framework build step is required.

## Hiding public pages

Open the local preview, then visit `/tools/page-visibility.html`. Choose the
site folder when the browser asks, then use the Hide/Show buttons. The tool
updates `_worker.js` and swaps the selected page files with the local 404
fallback.

On Mac, run `node tools/dev-server.mjs` and open `/page-visibility`. The local
helper built into the dev server lets the tool save changes directly without
using the browser folder picker.

Hidden page source files are saved under `.hidden-pages/`, while the deployed
Worker returns a 404 for those paths on the public site. Commit and push the
updated visibility files for the change to go live.

## Obsidian archive import

The public `/archive/` page is generated from selected records in the Obsidian
vault. The importer only publishes notes with:

- `archive_publish: true`
- `visibility: public`

Run the importer from the repository root:

```powershell
node tools/build-archive.mjs
```

The generated public data lives at `assets/archive/records.json`. Private vault
notes, draft records, and local-only paths are rejected or ignored by default.

## Shopify setup

This repo now includes Shopify Storefront proxy routes under `/api/shop/*`.
The route logic lives in `functions/api/shop/*` and is wired into the
Worker entrypoint at `_worker.js`.

Create a local `.dev.vars` from `.dev.vars.example` and set:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_STOREFRONT_API_VERSION`
- `SHOPIFY_MERCH_QUERY`

The default catalog query expects Shopify products to be tagged with
`construct-merch`. Source medium and merch type metadata can come from
legacy Shopify tags such as `venture:thoughtpuppet` and `merch:type:print`, with
page-specific presentation details living in `shared/storefront-config.js`.

In Cloudflare, add the same four values under the Worker project's
`Settings > Variables and secrets`.

## Art.Pill submissions and booking setup

Tattoo inquiry, flash claim, Build Your Own, in-person consultation, and
Special Projects application forms submit to the live Worker backend at
`/api/submissions`. Submissions are stored in D1, reviewed privately at
`/studio/submissions/`, and approved tattoo clients receive a generated
token link into `/booking/?token=...`.

The forms live at:

- `/tattoos/inquire/`
- `/tattoos/flash/claim/`
- `/tattoos/build/`
- `/tattoos/build/in-person/`
- `/tattoos/special-projects/apply/`

Each form uses `method="POST"` and `enctype="multipart/form-data"` so reference
uploads can be captured by the submissions backend. If the optional
`SUBMISSION_FILES` R2 binding is configured, uploaded file contents are stored
under `submissions/{submissionId}/...`; otherwise the backend still records file
metadata. The forms include a `_gotcha` honeypot field.

Recommended review flow:

- Set `SUBMISSIONS_DB` and `SUBMISSIONS_ADMIN_TOKEN` for the Worker.
- Create/configure the `SUBMISSION_FILES` R2 bucket if reference upload contents
  should be preserved.
- Production deploys use `SQUARE_ENVIRONMENT=production`; keep local `.dev.vars`
  on `sandbox` for test payments.
- Configure the Square webhook notification URL at
  `/api/square/webhook` with `SQUARE_WEBHOOK_SIGNATURE_KEY`, subscribed to
  `payment.created`, `payment.updated`, `order.created`, and `order.updated`.
- Review captured submissions in `/studio/submissions/`.
- Mark the chosen submission `approved`.
- Generate the booking token from the submission detail panel.
- Send the generated private booking URL to the client for session selection,
  Square deposit checkout, and `/booking/confirmed/` confirmation.

See `docs/submissions-backend.md` for D1, R2, Square, and booking setup details.
