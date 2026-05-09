# the six.well construct

Pure static site for `thoughtpuppet/thesixwellconstruct`.

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
updates `shared/page-visibility.js`.

Hidden pages still load on localhost for editing, but the deployed Worker
returns a 404 for those paths on the public site. Commit and push the updated
visibility file for the change to go live.

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
- `/tattoos/flash/`
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
