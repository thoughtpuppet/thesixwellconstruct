# UI source audit

Date: 2026-07-23  
Scope: every HTML page in the repository, plus Worker route remaps and runtime UI injectors  
Mode: read-only audit; no production UI was changed

## Outcome

The site does not currently have one executable UI source of truth.

`tools/ui-guide.html` is the intended specification and token editor, while the
actual rendered UI is assembled from several independent layers:

1. `_worker.js` chooses the physical page or reusable route template.
2. The page's HTML establishes its shell, classes, and `data-venture`.
3. Shared stylesheets provide tokens, typography, responsive guards, medium
   shells, and component systems.
4. Page-local `<style>` blocks provide a substantial amount of the final design.
5. Inline `style=""` attributes and editor-injected spans can outrank stylesheet
   rules.
6. Shared JavaScript injects navigation, wayfinding, footer markup, token links,
   and runtime CSS.
7. Page-specific JavaScript replaces placeholder markup with API-backed cards,
   records, products, events, symbols, and portfolio content.

The current authority chain is therefore:

`route resolution -> HTML shell -> linked CSS in document order -> page-local CSS -> inline attributes -> runtime-injected CSS/markup`

The UI Guide influences that chain through `css/tokens.css` and documented
conventions. It is not itself imported by public pages.

## Inventory

- 137 HTML files were inspected.
- 97 are public pages, public flow pages, hidden-medium placeholders, reusable
  public route templates, or legacy redirect shells.
- 40 are Studio pages, tools, managed previews, concept previews, prototypes, or
  app entry files.
- 97/97 public-scope files are accounted for in the public source matrix below.
- 40/40 non-public files are accounted for in the internal-source appendix.
- `node tools/dev-server.mjs --check` passed every configured route check.

### Shared-layer adoption across the 97 public-scope files

| Layer | Files loading it directly |
| --- | ---: |
| `css/tokens.css` | 34 |
| `css/transitions.css` | 85 |
| `css/site-typography.css` | 89 |
| `css/mobile.css` | 43 |
| `css/venture-pages.css` | 17 |
| `css/tattoos.css` | 23 |
| `js/transition.js` | 74 |
| `js/construct-corner.js` | 70 |
| `js/construct-nav.js` | 70 |
| Explicit `js/construct-wayfinding.js` | 0 |
| Correctly detectable `body[data-venture]` | 83 |

`construct-nav.js` lazily injects `/css/tokens.css` when tokens are absent and
also lazily injects `construct-wayfinding.js`. As a result, 49 public-scope
files receive their palette tokens indirectly through navigation JavaScript
rather than declaring the token sheet in the document.

## Route ownership

| Public request | Actual UI source |
| --- | --- |
| `/`, `/index`, `/entry-room`, and aliases | `_worker.js` serves root `index.html`, whose UI is local CSS plus `entry-room/3d/entry-room-3d.js` |
| `/home` and aliases | `_worker.js` serves `home/index.html` |
| `/legend...` | `_worker.js` redirects to `/about/legend/...`; `legend/index.html` is a second legacy redirect shell |
| `/about/tattoos/` | `about/tattoos/index.html` redirects to `/about/artpilltattoohouse/` |
| `/tattoos/booking/` | JavaScript redirect shell to `/booking/` |
| `/tattoos/booking/confirmed/` | JavaScript redirect shell to `/booking/confirmed/` |
| `/events/:slug/` | `_worker.js` serves `events/<slug>/index.html`; there is no generic event-detail HTML fallback |
| `/tattoos/flash/:slug/` | Production `_worker.js` always serves `tattoos/flash/detail/index.html` |
| `/archive/records/:slug/` | Production and localhost reuse `archive/records/index.html` |
| `/archive/timelines/:slug/` | Production and localhost reuse `archive/timelines/index.html` |
| `/art/<name>` | `_worker.js` resolves extensionless art routes to `<name>.html` |
| Other extensionless paths | `_worker.js` resolves to `<path>/index.html` |

Important mismatch: localhost does not currently apply the production
`/tattoos/flash/:slug/ -> tattoos/flash/detail/index.html` remap. Localhost can
therefore show the physical `ap-*` page while production shows the generic,
API-backed detail template for the same route.

## Executable UI layers

### Global sources

| Source | Actual responsibility |
| --- | --- |
| `AGENTS.md`, `README.md`, `CLAUDE.md` | Human implementation rules; not browser-executable |
| `tools/ui-guide.html` | Canonical local specification/editor; contains copied component examples and writes token values |
| `css/tokens.css` | Palette, medium colors, type-role tokens, spacing, timing |
| `css/site-typography.css` | Broad global type cascade, descriptor aliases, breadcrumbs, protected brand exceptions |
| `css/mobile.css` | Cross-page responsive guards and many `!important` clamps |
| `css/transitions.css` | Fade overlay, shared header backdrop, entrance motion |
| `js/transition.js` | Injects and controls the fade overlay |
| `js/construct-corner.js` | Injects the corner lockup |
| `js/construct-nav.js` | Injects navigation, injects tokens when absent, and loads wayfinding |
| `js/construct-wayfinding.js` | Injects/normalizes breadcrumbs and footers and adds runtime CSS |

### Family sources

| Family | Main executable UI sources |
| --- | --- |
| Venture shell | `css/venture-pages.css` plus small page-local token/accent blocks |
| Tattoo flows/resources | `css/tattoos.css`, often `css/mobile.css`, then page-local CSS |
| About section pages | `about/section-page.css` plus `css/site-typography.css` |
| Archive explorer | `css/archive-public.css` plus `js/archive-public.js` |
| Archive room lists | `css/venture-pages.css` plus `js/archive-room-records.js` |
| Art | Large inline CSS blocks plus global typography/mobile and managed-data scripts |
| Merch | Large inline CSS blocks plus tokens/mobile/global typography and product scripts |
| Booking calendars | Shared presentation in `css/booking-calendar.css`; route-specific rendering and workflow behavior in `booking/index.html`, `js/booking-calendar.js`, and `booking/reschedule/index.html` |
| Portfolio | Large inline CSS plus `css/portfolio-detail.css` and portfolio/connection scripts |
| Legend | Local CSS plus tokens/global typography and `js/legend-catalog.js` |
| Entry room | Local CSS in `index.html` plus the `entry-room/3d` runtime |
| Homepage | `home/index.html` local CSS/canvas code plus tokens/global typography |
| Search/managed catalog | `css/managed-preview.css` plus `js/managed-preview.js` |

## Public source matrix

The order shown is document cascade order for linked local stylesheets.
Page-local `<style>` is reported separately because its position differs by
family.

### Shared venture shell: 17 files

Source chain:
`tokens -> transitions -> venture-pages -> site-typography -> local style`

- `archive/about/index.html`
- `archive/art/index.html`
- `archive/events/index.html`
- `archive/film/index.html`
- `archive/merch/index.html`
- `archive/music/index.html`
- `archive/sixwell-construct/index.html`
- `archive/tattoos/index.html`
- `archive/writings/index.html`
- `construct-map/index.html`
- `events/calendar/index.html`
- `events/cultandshift/index.html`
- `events/index.html`
- `events/open-studios/index.html`
- `events/signal-symbol/index.html`
- `events/solehmans-new-year/index.html`
- `events/ss-and-f-live-audience/index.html`

The archive room pages and four lightweight event pages do not load the shared
corner/nav scripts. Their body has `data-venture`, but their chrome is only what
the HTML and venture stylesheet provide.

### Art and standalone flash detail family: 15 files

Source chain:
`transitions -> mobile -> site-typography`, with large page-local CSS generally
placed before the two global sheets.

- `art/acquisitioninquiry.html`
- `art/homelandsecuritypainting.html`
- `art/index.html`
- `art/lostmarblespainting.html`
- `art/lustpainting.html`
- `art/paranoiafosteredtraumapainting.html`
- `art/slothpainting.html`
- `art/thefrustrationsofinnercharospainting.html`
- `events/confirmed/index.html`
- `tattoos/flash/ap-flash-001/index.html`
- `tattoos/flash/ap-maze-001/index.html`
- `tattoos/flash/ap-sairo-001/index.html`
- `tattoos/flash/ap-standalone-001/index.html`
- `tattoos/flash/ap-standalone-archive-001/index.html`
- `tattoos/flash/maze/index.html`

The five physical `ap-*` pages are shadowed by the production flash-detail
route rule and should not be treated as production visual sources without
changing that rule.

### Tattoo flow family with mobile: 10 files

Source chain:
`transitions -> mobile -> site-typography -> tattoos -> local flow CSS`

- `booking/confirmed/build/index.html`
- `booking/confirmed/consultation/index.html`
- `booking/confirmed/index.html`
- `booking/confirmed/studio/index.html`
- `booking/confirmed/virtual-consultation/index.html`
- `tattoos/flash/claim/index.html`
- `tattoos/inquire/custom/index.html`
- `tattoos/special-projects/apply/index.html`
- `tattoos/special-projects/index.html`
- `tattoos/submission-received/index.html`

### About section-page family: 9 files

Source chain:
`transitions -> about/section-page -> site-typography`

- `about/breakdown/index.html`
- `about/contact-press/index.html`
- `about/current-state/index.html`
- `about/founder/index.html`
- `about/mediums/index.html`
- `about/six-well/index.html`
- `about/visual-language/index.html`
- `about/ways-in/index.html`
- `preferences/index.html`

`preferences/index.html` adds a small final inline block; the other eight have
no local style block.

### Merch family: 5 files

Source chain:
`tokens -> transitions -> mobile -> site-typography -> large local CSS`

- `merch/am-i-losing-my-marbles.html`
- `merch/index.html`
- `merch/lostmarbles-hoodie.html`
- `merch/marbles-print.html`
- `merch/maze-puffer-jacket.html`

`merch/index.html` has two local style blocks, including one after global
typography, so it has a distinct final cascade from the four product pages.

### Tattoo resource family: 4 files

Source chain:
`tokens -> transitions -> tattoos -> mobile -> site-typography -> small local CSS`

- `tattoos/approved/index.html`
- `tattoos/day-of/index.html`
- `tattoos/location-parking/index.html`
- `tattoos/policies/index.html`

### Archive explorer and reusable dynamic templates: 4 files

Source chain:
`tokens -> transitions -> archive-public -> site-typography -> archive runtime`

- `archive/index.html`
- `archive/collections/index.html`
- `archive/records/index.html`
- `archive/timelines/index.html`

`archive/records/index.html` and `archive/timelines/index.html` each control
unbounded slug families through Worker remapping and `js/archive-public.js`.

### Hidden-medium/404 shells: 4 files

Source chain:
`mobile -> site-typography -> local 404 CSS`

- `404.html`
- `film/index.html`
- `music/index.html`
- `writings/index.html`

The Worker currently redirects the three medium routes to the 404 surface.

### Tattoo core with walk-in UI: 3 files

Source chain:
`transitions -> walk-in-windows -> mobile -> site-typography -> tattoos`

- `booking/index.html`
- `tattoos/index.html`
- `tattoos/inquire/index.html`

### Legacy About pages: 3 files

Source chain:
`transitions -> site-typography -> very large local CSS`

- `about/about-next.html`
- `about/artpilltattoohouse/index.html`
- `about/index.html`

### Tattoo flow without mobile: 3 files

Source chain:
`transitions -> site-typography -> tattoos`

- `booking/reschedule/index.html`
- `tattoos/build/index.html`
- `tattoos/flash/detail/index.html`

The flash detail file is the production source for every
`/tattoos/flash/:slug/` route not reserved for `claim`, `detail`, or `maze`.

### Redirect shells with no shared UI: 3 files

- `about/tattoos/index.html`
- `entry-room/index.html`
- `legend/index.html`

These only provide move/redirect fallback markup.

### Calendar-driven tattoo flows: 2 files

Source chain:
`transitions -> booking-calendar -> walk-in-windows -> site-typography -> tattoos`

- `tattoos/build/in-person/index.html`
- `tattoos/inquire/consultation/index.html`

### Construct bible: 2 files

Source chain:
`tokens -> transitions -> site-typography -> very large local CSS`

- `sixwellconstruct/bible/index.html`
- `sixwellconstruct/bible/v1-tabbed.html`

These are documented as non-public reference surfaces even though the Worker
can serve them.

### Tattoo redirect shells: 2 files

Source chain: `site-typography` only, followed by JavaScript navigation.

- `tattoos/booking/index.html`
- `tattoos/booking/confirmed/index.html`

### Entry threshold: 2 files

Source chain: `transitions -> local entry-room UI`

- `index.html` (canonical public threshold)
- `entry-room/index-3d.html` (secondary physical 3D page)

### Studio booking surfaces: 2 files

Source chain:
`transitions -> booking-calendar -> site-typography -> local CSS`

- `booking/studio/index.html`
- `booking/studio-visit/index.html`

### One-off public sources

| File | Source chain |
| --- | --- |
| `home/index.html` | `tokens -> site-typography -> local canvas CSS/JS` |
| `about/legend/index.html` | `tokens -> transitions -> site-typography -> local CSS -> legend runtime` |
| `tattoos/flash/index.html` | `transitions -> media -> mobile -> site-typography -> tattoos -> local CSS` |
| `tattoos/portfolio/index.html` | `transitions -> mobile -> site-typography -> portfolio-detail -> large local CSS/runtime` |
| `tattoos/build/maze/index.html` | compiled Vite CSS/JS bundle only |
| `entry-room/index-2d.html` | `transitions -> entry-room/entry-room.css -> orb runtimes` |
| `search/index.html` | `managed-preview.css -> managed-preview.js` |

## Page-local styling burden

Across the 97 public-scope files:

| Local `<style>` size | File count |
| --- | ---: |
| None | 20 |
| 1-20 lines | 17 |
| 21-100 lines | 29 |
| More than 100 lines | 31 |

The largest local UI owners are:

| File | Approximate local CSS lines |
| --- | ---: |
| `about/index.html` | 998 |
| `merch/index.html` | 874 |
| `sixwellconstruct/bible/index.html` | 814 |
| `about/about-next.html` | 798 |
| `art/index.html` | 658 |
| `tattoos/index.html` | 645 |
| `merch/marbles-print.html` | 616 |
| `merch/lostmarbles-hoodie.html` | 597 |
| `merch/maze-puffer-jacket.html` | 588 |
| `index.html` | 543 |

The last author-style layer is `site-typography.css` on 49 files,
`tattoos.css` on 19, and a local `<style>` block on 22. This is only document
order; selector specificity and `!important` can still change the winner.

## Findings

### 1. The UI Guide is partly aspirational

- No public page explicitly loads `construct-wayfinding.js`; 70 pages obtain it
  indirectly from `construct-nav.js`.
- The canonical `.hero-descriptor` class is not present on any public page.
  `site-typography.css` compensates with a long list of legacy aliases such as
  `.hero-copy > p`, `.hero-lede`, `.hero-note`, and `.section-intro`.
- Only 21 of 83 pages with `data-venture` declare `--venture-color` in page
  source. Other pages use legacy variables such as `--signal`, use
  `--venture-accent`, or depend on hardcoded/local values.
- The UI Guide site map says Events is hidden, while the Worker hides only Film,
  Music, and Writings.
- The UI Guide describes the public Archive as generated from Obsidian JSON,
  while the current README and public archive runtime identify managed D1 APIs
  as the public source.

### 2. Token delivery is split between CSS and JavaScript

- 34 files explicitly link `tokens.css`.
- 49 additional files depend on `construct-nav.js` to inject it.
- 14 files have neither explicit tokens nor construct-nav. These are mainly
  redirects, hidden/404 shells, entry variants, the compiled maze app, and
  search.

This means removing or delaying construct-nav can change the palette
availability for otherwise unrelated page content.

### 3. Mobile cascade documentation conflicts with actual order

The header comment in `css/mobile.css` says to load it after every other
stylesheet so its guards win. The UI Guide skeleton places it before
`site-typography.css`, and all 43 public pages that load `mobile.css` also load
another local stylesheet after it:

- 28 load `site-typography.css` after mobile.
- 14 load `site-typography.css` and `tattoos.css` after mobile.
- 1 loads `site-typography.css` and `portfolio-detail.css` after mobile.

The intended cascade contract needs to be chosen and documented before
normalizing files.

### 4. New project rules are not yet encoded in the shared systems

- `css/tattoos.css` applies a radial gradient to the root `.tattoos-page` and a
  fixed viewport noise layer.
- `css/venture-pages.css` supplies a fixed full-viewport `.venture-grain`.
- Public HTML contains 86 `1px`, 8 `2px`, and 5 `3px` border declarations across
  15, 6, and 5 files respectively.
- Shared/page CSS contains another 14 `1px`, 8 `2px`, and 4 `3px` declarations.

Not every thin border is necessarily structural, but the current system does
not enforce the new 5px structural-line rule.

### 5. Some page families omit shared chrome entirely

Thirteen token-backed pages have `data-venture` but do not load construct-nav:

- `archive/about`, `archive/art`, `archive/events`, `archive/film`,
  `archive/merch`, `archive/music`, `archive/sixwell-construct`,
  `archive/writings`
- `events/calendar`, `events/open-studios`, `events/solehmans-new-year`,
  `events/ss-and-f-live-audience`
- `home/index.html`

The homepage is a deliberate special surface. The archive/event omissions look
like lightweight page scaffolds rather than deliberate use of the current
shared page shell.

### 6. Localhost and production do not resolve all UI sources identically

The flash-detail mismatch is the most important example:

- Production: every arbitrary flash slug uses `tattoos/flash/detail/index.html`.
- Localhost: a physical slug directory can win because the dev server does not
  implement the production flash remap.

An audit or visual approval performed only on the physical localhost `ap-*`
pages can therefore approve a UI that production never renders.

## Recommended normalization sequence

1. Make route ownership explicit in one machine-readable route manifest used by
   `_worker.js`, `tools/dev-server.mjs`, the UI Guide site map, and route tests.
2. Define one required linked stylesheet order and update the contradictory
   mobile documentation.
3. Make `tokens.css` explicit in the canonical shell instead of depending on
   navigation JavaScript to inject it.
4. Make wayfinding loading explicit or officially document construct-nav as its
   loader; do not keep both contracts.
5. Promote the stable parts of high-volume inline CSS into family sheets,
   starting with Art, Merch, Tattoo index, and About.
6. Convert the UI Guide's Page Anatomy into a reusable canonical shell or
   structural contract test.
7. Reconcile `venture-pages.css` and `tattoos.css` with the current opaque-root,
   bounded-decoration, 5px-line, and hero-descriptor rules.
8. Add static tests for: stylesheet order, explicit tokens, valid
   `data-venture`, route/source parity, root canvas rules, and shared chrome.
9. Perform computed-style browser verification on one representative from each
   source family after normalization, then run route-wide overflow and chrome
   checks.

## Internal and noncanonical source appendix

All 40 non-public HTML files were also inspected.

### Managed preview system

Source: `css/managed-preview.css`, usually with `js/managed-preview.js`.

- `about/legend/categories-managed-preview/index.html`
- `about/legend/managed-preview/index.html`
- `archive/collections-managed-preview/index.html`
- `archive/managed-preview/index.html`
- `art/managed-preview.html`
- `home/managed-preview.html`
- `studio/managed-previews/index.html`
- `tattoos/build-managed-preview/index.html`
- `tattoos/flash-managed-preview/index.html`

Legacy redirect-only preview shells:

- `legend/categories-managed-preview/index.html`
- `legend/managed-preview/index.html`

### Studio

- `studio/submissions/index.html`: Studio-specific stylesheet stack
  (`construct-manager`, `connections-manager`, `admin-collapse`, `analytics`,
  `people-manager`, `select-menu`, `console-titles`) plus 422 local CSS lines.
- `studio/previews/index.html`: `studio/email-preview.css` and
  `studio/pdf-preview.css`.
- `studio/events-previews/index.html`: `studio/email-preview.css` plus local CSS.
- `studio/connections-preview/index.html`: `tokens.css` plus a minimal local
  block.
- `studio/submissions/_preview-demo.html`: standalone local CSS.

### Tools

Standalone local CSS:

- `tools/architecture_map.html`
- `tools/architecture_v2.html`
- `tools/build-language-editor.html`
- `tools/edit-links.html`
- `tools/edit-links-mac.html`
- `tools/page-visibility.html`
- `tools/red-comparison.html`
- `tools/ui-guide.html`

Shared organic-preview system:

- `tools/organic-page-previews/legend.html`
- `tools/organic-page-previews/merch.html`
- `tools/organic-page-previews/tattoo.html`

These use `tools/organic-page-previews/organic-preview.css` and its companion
script.

### Prototypes and loose previews

- `about/construct-connections-organic.html`: global typography plus 627 local
  CSS lines.
- `about/construct-connections-prototype.html`: global typography plus 454
  local CSS lines.
- `entry-room-3d.html`: transitions plus local CSS and CDN modules.
- `entry-room-landing.html`: global typography plus local CSS.
- `home-depth-particle-preview.html`: standalone local CSS.
- `home-entry-overlay-prototype.html`: global typography plus local CSS.
- `menu-preview.html`: standalone local CSS.
- `particle-preview.html`: global typography plus local CSS.
- `prototypes/entry-threshold-3d/homepage-copy/index.html`: global typography
  plus local CSS.
- `prototypes/entry-threshold-3d/index.html`: standalone local CSS and module.
- `prototypes/orb-socket-interactive.html`: standalone local CSS.
- `tattoo-index-margin-preview.html`: redirect shell with local CSS.

### Compiled app entry

- `apps/maze/index.html`: Vite entry; the UI is owned by
  `apps/maze/src/styles.css`, `apps/maze/src/maze-submit.css`, and React source.

## Dual-system contract acceptance

The Guide contract was acceptance-tested after implementation without migrating
page-local public compositions.

- All 49 Guide specimens passed at `1440px`, `768px`, `390px`, and `380px`
  (196 viewport checks) with no horizontal-overflow failures.
- The real Studio shell retained all 12 top-level management lanes at `390px`
  and `380px`; its tab row scrolls horizontally while the page itself remains
  contained.
- Representative public pages retained their existing page-owned compositions.
  In particular, construct dots remain `17px` circles, merch color swatches
  remain `20px` circles, tattoo portfolio filters retain their original compact
  geometry, and the custom-inquiry title retains its existing `54px` desktop
  treatment.
- Shared control typography now applies only through established opt-in control
  classes. Raw `button` elements remain page-owned because the site uses them
  for dots, swatches, cards, calendar days, image selectors, and other visual
  controls.
- The focused public/Studio contract suite passed 104 tests, the route checker
  passed every configured route, and `git diff --check` reported no whitespace
  errors.

Existing page-specific mobile target-size debt is recorded for later
page-family migration. It is not addressed with a blanket global selector,
because that would redesign existing visual controls and violate this phase's
preservation boundary.

## About information-family migration

The first public page family now adopts the shared token foundation while
retaining its established centered composition.

- Migrated routes: `/about/breakdown/`, `/about/contact-press/`,
  `/about/current-state/`, `/about/founder/`, `/about/mediums/`,
  `/about/six-well/`, `/about/visual-language/`, and `/about/ways-in/`.
- `about/section-page.css` remains the family composition owner.
- `css/tokens.css`, `css/mobile.css`, and `css/site-typography.css` now own the
  palette, responsive spacing, typography roles, control-height floor, and
  shared accessibility behavior consumed by the family stylesheet.
- The centered hero, About subsection navigation, content-module order,
  visible copy, links, routes, scripts, injected breadcrumbs, and normalized
  footer behavior remain unchanged.
- The Guide Source Map labels this family as
  `Foundation adopted · centered composition retained`; it is intentionally
  not represented as a literal adoption of the split editorial specimen.

## Landing-family and Tattoo title authority

The Guide now treats landing pages as one shared foundation with five
composition variants rather than a flat list of unrelated templates.

- Standard venture, Art catalog, Tattoo service, Merch commerce, and Events
  program landings share navigation, breadcrumb, hero roles, descriptor,
  spacing, structural rules, responsive behavior, and footer contracts.
- `/art/`, `/tattoos/`, `/merch/`, and `/events/` retain their current
  galleries, service modules, commerce behavior, event programming, content,
  scripts, and workflows.
- The standard venture landing is a canonical shared-shell specimen without a
  sole production route. `/events/` belongs only to the Events program variant
  in the Guide and Source Map.
- All 23 public Tattoo HTML title surfaces explicitly load `css/tokens.css`.
  The Maze application remains outside this contract because its compiled
  workspace owns its own composition and has no standard page hero.
- Tattoo page titles, the homepage Tattoo node, and Construct navigation dots
  now resolve their top-level identity from `--color-tattooing`. Managed
  navigation still owns labels, routes, order, and explicit cross-medium
  pathway colors, but stored top-level node colors no longer override the UI
  Guide palette token.
- Existing managed color fields remain compatibility data. No API, database,
  route, payload, form, or workflow change was introduced.

## Art catalog landing adoption

`/art/` is the first production Landing Family variant to adopt the shared
foundation while retaining its catalog-specific composition.

- `css/landing-family.css` now owns the shared landing spacing activation,
  semantic medium aliases, hero and descriptor roles, responsive grid gaps,
  focus treatment, reduced-motion behavior, and the mobile control-height
  floor.
- `art/index.html` explicitly loads `css/tokens.css` and identifies itself as
  the `art-catalog` variant. Its existing hero, ThoughtPuppet band, filters,
  Studio Visit band, artwork catalog, detail navigation, cart, footer, and
  runtime scripts remain in their original order.
- The current working hero copy (`ART.`) and the previously added Studio Visit
  pathway were captured as the preservation baseline and retained.
- The hero and Art-owned active states now resolve from `--color-art` instead
  of the legacy private `#0071EB` declaration. Bounded surfaces retain their
  current composition, while the root canvas remains solid `--color-bg`.
- Artwork cards retain 5px frames and now use the shared responsive 16px,
  14px, and 12px grid-gap tokens. Art filter and action targets use the shared
  44px mobile minimum without changing labels or filtering behavior.
- The Guide Source Map status is
  `Shared foundation adopted · catalog composition retained`.

## Landing Family production adoption

The four production landing variants now consume the same Landing Family
foundation while retaining their existing variant-owned composition.

- `/art/` identifies as `art-catalog`; its catalog, filters, acquisition path,
  cart, and runtime scripts remain page-owned.
- `/tattoos/` identifies as `tattoo-service`; its live walk-in windows,
  collaboration paths, booking process, rates, policies, and runtime scripts
  remain page-owned.
- `/merch/` identifies as `merch-commerce`; its source dropdown, product
  filters, inventory, variants, cart, checkout, and storefront scripts remain
  page-owned.
- `/events/` identifies as `events-program`; its managed event feed, capacity
  states, registration paths, archive bridge, and API rendering remain
  page-owned. Its established `venture-pages.css` shell is retained beneath
  the Landing Family contract.
- `css/landing-family.css` owns semantic medium aliases, responsive spacing,
  hero and descriptor roles, responsive grid gaps, visible focus, reduced
  motion, and the mobile target floor for all four variants.
- The preservation contracts compare titles, visible text, headings, links,
  accessibility labels, controls, and complete body scripts against the
  pre-migration baselines. No content, route, API, payload, or workflow change
  was introduced.
- The Guide Source Map statuses are:
  `Shared foundation adopted · catalog composition retained`,
  `Shared foundation adopted · service composition retained`,
  `Shared foundation adopted · commerce composition retained`, and
  `Shared foundation adopted · event composition retained`.

## Source-linking status

The UI Guide foundations remain established. Templates and components now use a
manual source-linking workflow rather than verification or approval statuses.

- The Source Map records reference routes, candidate routes, owning files,
  family/variant relationships, and adoption notes.
- Guide records link the production specimen and owning files. Visual review
  happens on the production route itself; the embedded preview pane has been
  removed.
- Specialized surfaces remain explicitly separate so they are not mistaken for
  ordinary shared templates.
- The approved-client booking calendar at `/booking/?preview=1` is the
  canonical public calendar reference. Its route-specific workflow is owned by
  `booking/index.html`; its shared public presentation is owned by
  `css/booking-calendar.css`.
- Public calendar instances may change their semantic site/node color, but
  retain the canonical calendar anatomy.
- `/booking/reschedule/` now presents its existing same-type availability
  through the approved month grid and time-window controls without changing
  its API or completion behavior.
- Rescheduling and Events remain public functional variants rather than
  competing calendar sources.
- Studio calendars are excluded from this contract and remain unchanged.

The current source-linking record is documented in
`docs/ui-canon-review-2026-07-23.md`.
