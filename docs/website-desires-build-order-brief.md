# Website Desires and Build-Order Brief

Share this with an AI chat when asking for page or project build-order advice.

## Project Identity

This website is **the six.well construct**, the creative ecosystem of **Saiel Dauhn Solehman**. It should not feel like a generic portfolio, shop, or landing page. It should feel like a living map of interconnected creative work: tattooing, art making, merch, writing, music, film, events, archive, and biographical context.

The site’s central idea is that every page is a medium in a larger construct. Each page can have a clear primary action, but it should also quietly reveal how that action connects to the rest of the ecosystem.

## Core Desire

The site should help visitors understand, enter, and move through the work without flattening it. It should support real actions such as tattoo inquiries, flash claims, product purchases, art acquisition inquiries, booking, reading, listening, attending, and archival discovery, while preserving the symbolic, mythic, strange, intimate voice of the practice.

The user wants the site to be operational and poetic at the same time:

- Operational enough for clients and collectors to know what to do next.
- Poetic enough that the work still feels authored, ritual, and alive.
- Connected enough that each medium strengthens the others.
- Selective enough that forms, booking, and commerce feel curated rather than wide-open.

## Ecosystem Principle

Every page should ask:

- What is the main action or purpose of this page?
- What other medium does this page naturally point toward?
- Is the connection conceptual, commercial, archival, experiential, or biographical?
- Does the connection deepen the page without distracting from its main purpose?
- Does the page make the visitor feel the larger construct around it?

Preferred connection patterns:

- Related medium bands.
- Source lineage from painting to tattoo to merch to archive.
- Object pathways showing how a work becomes a print, garment, tattoo, study, note, event, or archive entry.
- Next actions like inquire, claim, collect, read, attend, listen, revisit, or enter the archive.
- Archive memory for studies, abandoned versions, process, ephemera, and connective tissue.

## Voice and Language

The language should be generous, grounded, and invitational. Avoid harsh exclusionary phrasing unless operational clarity requires it.

Preferred phrasing includes:

- “Best for”
- “Drawn toward”
- “Built for”
- “Good entry point”
- “Opens into”
- “Begins review”
- “Private booking”
- “Source imagery”
- “Process archive”
- “Living artifact”

Boundary language is allowed for booking status, legal requirements, form expectations, rates, deposits, and approval gates, but it should stay plain and warm.

## Visual and Interaction Preferences

The existing direction is dark, tactile, symbolic, and editorial. The interface uses:

- Deep black background.
- Warm amber text and details.
- Medium-specific accent colors.
- Inter for heavy display and UI.
- Georgia-style serif for descriptors, ritual language, metadata, and softer text.
- Large compressed display titles.
- Thin, quiet supporting copy.
- Thick 5px borders and hard-edged frames.
- Visible dividers, timeline rails, and graph strokes also use the 5px rule; record and card grids keep 12–16px of breathing room between frames.
- A solid opaque page canvas; grain, noise, washes, or gradients stay inside contained media/components only when useful.
- Fade transitions between pages.
- A construct navigation system made of colored medium dots.

The site should avoid generic SaaS/portfolio polish. It should feel specific, authored, and slightly ceremonial, while still being easy to use.

## Medium Map

Current mediums:

- **Tattooing / art.pill TATTOO HOUSE**: permanent symbolic mark-making, client intake, flash, custom work, special projects, booking review.
- **Art Making**: paintings and objects, source image language, statements, acquisition pathway.
- **Merch**: commerce engine for objects from the whole construct, organized by source medium.
- **About**: biographical and construct context. Currently a placeholder/not found page.
- **Events**: studio/open encounter path. Currently a placeholder/not found page.
- **Music**: sonic medium. Currently a placeholder/not found page.
- **Writings**: statements, field notes, symbolic language, mythic context. Currently a placeholder/not found page.
- **Archive**: process, studies, ephemera, memory, past work. Currently a placeholder/not found page.
- **Film**: moving-image medium. Currently a placeholder/not found page.

## Currently Built or Partially Built

### Landing Construct

The homepage is an interactive construct map with the wordmark, medium labels, eyes, movement, and medium navigation. It establishes the whole system before sending users into individual mediums.

### Tattooing

Tattooing is the most developed operational medium. It includes:

- Main art.pill TATTOO HOUSE page.
- Portfolio grid.
- Flash wall.
- Individual flash pages.
- Standard inquiry form.
- Build Your Own symbolic brief path.
- In-person build path.
- Special Projects page and application form.
- Approved booking and confirmed booking pages.
- Submission received page.
- Rates and review-before-booking explanation.

Core desire for tattooing:

Tattooing should feel selective, symbolic, story-driven, and review-based. Visitors should understand that booking is not instant. They choose the right entry path, submit for review, and receive private booking access if approved.

Important tattooing paths:

- Flash should be the cleanest first path for available pre-drawn designs.
- Custom work should begin with an inquiry.
- Build Your Own should let clients select symbols from the practice’s visual language and generate a meaningful brief.
- Special Projects should be for long-form, collaborative, experimental, or multi-session work.
- All paths should preserve metadata and context so review is easier.

### Art Making

Art making is built as a medium index with filterable work cards and several individual painting pages. It includes an acquisition inquiry path.

Core desire for art:

Art should act as a source language for the whole construct. Paintings are not isolated images; they can become tattoo language, merch, writing, archive material, or collector objects.

Needed emphasis:

- Stronger artist statements.
- Clearer acquisition flow.
- Better source-lineage links from art pages to related merch, tattoos, archive notes, and writings.
- Completion of placeholder fragments and metadata.

### Merch

Merch is built as an aggregator and commerce engine. Products are organized by source medium rather than as one generic shop.

Current source mediums include:

- six.well clothing.
- thoughtpuppet.
- Art.Pill Tattoo Supply.

Current product logic includes:

- Shopify Storefront proxy routes.
- Product presentation config.
- Cart drawer.
- Product pages for hoodie, print, painting/product, and puffer jacket placeholder.
- Source medium filters and product-type filters.

Core desire for merch:

Merch should make objects feel like extensions of the larger construct. A hoodie, print, jacket, or supply item should carry its source lineage and point back to the work it came from.

### Placeholder Mediums

About, Events, Music, Writings, Archive, and Film currently appear to be placeholder/not found pages. However, they are already part of the construct navigation and conceptual system, so build order should consider them as missing ecosystem infrastructure, not random extra pages.

## Practical Infrastructure

The site is a static site deployed on Cloudflare Workers with static assets and Worker routes. It uses no framework build step.

Important existing systems:

- `README.md` contains the ecosystem-first principle, hosting notes, Shopify setup, and live submissions/booking setup.
- `CLAUDE.md` contains medium color rules and shared CSS reminders.
- `css/tokens.css`, `css/transitions.css`, `css/media.css`, and `css/venture-pages.css` are shared style foundations.
- `js/construct-nav.js` controls the medium-dot navigation.
- `js/transition.js` controls page fade transitions.
- Forms submit to the Worker submissions backend at `/api/submissions`.
- Shopify Storefront API is proxied through Cloudflare Worker routes under `/api/shop/*`.

## Build-Order Advice Needed

When advising build order, optimize for:

1. Visitor comprehension of the whole construct.
2. Revenue and operational readiness.
3. Reducing dead ends in the medium navigation.
4. Strengthening the source-lineage system between mediums.
5. Completing the clearest user paths before expanding atmospheric pages.
6. Making the site easier to maintain through shared components and data where possible.

## Likely Priority Tiers

### Tier 1: Operational Paths

Finish or verify the pages that directly affect real visitors taking action:

- Tattoo inquiry flow.
- Flash claim flow.
- Special Projects application flow.
- Private booking flow.
- Merch catalog, cart, and checkout integration.
- Art acquisition inquiry flow.

### Tier 2: Trust and Context

Build the pages that help visitors understand who made the work and why it matters:

- About.
- Writings.
- More complete art statements.
- Portfolio polish and metadata.
- FAQ-style operational clarity where useful, without making the site feel generic.

### Tier 3: Ecosystem Depth

Build the pages that make the construct feel alive and interconnected:

- Archive.
- Events.
- Film.
- Music.
- Related-medium bands across art, tattoos, merch, writings, and archive.
- Process rooms and source-lineage pages.

### Tier 4: Expansion and Refinement

After the core paths are stable:

- More product drops.
- More flash series.
- More object pathways.
- More individual work pages.
- Search/filter improvements.
- Better data-driven content management.
- Analytics-informed iteration.

## Guidance for Another AI

When recommending build order, do not treat this as a normal business website. Think in terms of “entry paths into a creative ecosystem.”

A strong recommendation should:

- Identify which paths are currently public, functional, incomplete, or dead ends.
- Prioritize work that makes real user actions trustworthy.
- Preserve the site’s symbolic and editorial tone.
- Avoid turning pages into generic marketing copy.
- Suggest the smallest next build steps that unlock the most clarity.
- Keep tattooing, art, and merch closely connected because they are the most developed and commercially actionable mediums.
- Treat About, Writings, and Archive as important comprehension infrastructure.
- Treat Events, Film, and Music as expansion mediums unless there is an immediate launch reason.

## Short Prompt Version

Use this if you need a compact prompt:

“I’m building the six.well construct, a dark editorial creative ecosystem for Saiel Dauhn Solehman. It connects tattooing, art making, merch, writings, archive, events, music, film, and about pages. The site should be operational and poetic: visitors need clear paths to inquire, claim flash, book after approval, buy merch, and inquire about art, but every page should also show source lineage and quiet links to the larger construct. Tattooing, art, and merch are the most built. About, Writings, Archive, Events, Music, and Film are mostly placeholders. Please advise page/project build order by prioritizing visitor comprehension, revenue readiness, fewer dead ends, source-lineage between mediums, and maintainability without making the site feel generic.”
