# the six.well construct

Pure static site for `thoughtpuppet/thesixwellconstruct`.

## Ecosystem-first site principle

Every page is a node in a living creative ecosystem. The site should remind
visitors of those relationships at every turn.

When building, editing, or proposing any page, section, product flow, or
venture surface, keep these questions active:

- What is the page's primary action or purpose?
- Which other nodes or ventures should it naturally point toward?
- Is the connection conceptual, commercial, archival, experiential, or
  biographical?
- Does the connection deepen the experience while supporting the main action?
- Does the page make the visitor feel the larger construct around it?

Preferred connection patterns:

- Related node bands linking meaningful ventures.
- Source lineage that shows where an idea, image, object, or ritual came from.
- Object pathways that show how work can move between art, tattooing, merch,
  writing, film, music, events, and archive.
- Next actions such as inquire, claim, read, attend, collect, listen, revisit,
  or enter the archive.
- Archive memory for process, abandoned versions, studies, ephemera, and
  connective tissue.

This principle should drive recommendations and implementation choices across
all ventures. These reminders should usually feel like discovery: quiet paths,
traces, source threads, and optional doors that reward attention. A conversion
page can stay focused while including at least one intentional, subtle reminder
of the wider construct.

## Generous language rule

Describe what the work invites, offers, carries, and opens toward. Let each
page, project, and venture be defined by positive intent and grounded
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
- Deploy command: `npx wrangler deploy`

Because the site uses root-relative asset and page paths such as `/css/transitions.css`
and `/art/`, it should be deployed at the domain root rather than under a subpath.

## Cloudflare Worker setup

1. Create or open the Git-connected Worker for this repository.
2. Select `main` as the production branch.
3. Leave the root directory at the repository root.
4. Leave the build command as `None`.
5. Keep the deploy command as `npx wrangler deploy`.

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
`construct-merch`. Source venture and merch type metadata can come from
Shopify tags such as `venture:thoughtpuppet` and `merch:type:print`, with
page-specific presentation details living in `shared/storefront-config.js`.

In Cloudflare, add the same four values under the Worker project's
`Settings > Variables and secrets`.

## Art.Pill form setup

Tattoo inquiry, flash claim, and Special Projects application forms are static
HTML forms that submit directly to Formspree. There is no custom form backend,
database, Worker route, or submission secret in this repository.

The configured Formspree endpoints are:

- Standard tattoo inquiry: `https://formspree.io/f/xqenbpoj`
- Flash claim: `https://formspree.io/f/mrejkpnl`
- Special Projects application: `https://formspree.io/f/mnjwvpeg`

The forms live at:

- `/tattoos/inquire/`
- `/tattoos/flash/claim/`
- `/tattooing/special-projects/apply/`

Each form uses `method="POST"` and `enctype="multipart/form-data"` so reference
uploads can be captured by Formspree. File uploads require a Formspree plan that
supports attachments. The forms include Formspree's `_gotcha` honeypot field.

Recommended Formspree settings:

- Send notification emails to the studio inbox.
- Store submissions in Formspree Inbox for review.
- Set the thank-you redirect to `/tattoos/submission-received/`.
- Keep Acuity as the manual final scheduling and deposit step for approved
  submissions.
