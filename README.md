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

## Tattoo inquiry setup

Tattoo inquiry, flash claim, and Special Projects application forms post to
Worker routes under `/api/tattoo/*`. Submissions are stored in Cloudflare D1,
review links are sent through Resend, and approved clients receive private
booking access that hands off to Acuity for final scheduling and deposits.

Before deploying the live form flow:

1. Create the D1 database:
   `npx wrangler d1 create thesixwellconstruct-submissions`
2. Replace the placeholder `database_id` in `wrangler.jsonc`.
3. Apply migrations:
   `npx wrangler d1 migrations apply thesixwellconstruct-submissions`
4. Add Worker secrets:
   - `RESEND_API_KEY`
   - `TATTOO_NOTIFY_EMAIL`
   - `ACUITY_USER_ID`
   - `ACUITY_API_KEY`
5. Fill the Acuity appointment type IDs in `wrangler.jsonc` or Cloudflare vars:
   - `ACUITY_STANDARD_APPOINTMENT_TYPE_ID`
   - `ACUITY_FLASH_APPOINTMENT_TYPE_ID`
   - `ACUITY_SPECIAL_PROJECT_APPOINTMENT_TYPE_ID`

The D1 binding must remain named `DB`, because `_worker.js` reads submissions
through `env.DB`.
