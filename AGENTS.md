# Project page-building defaults

For every public website page, inspect the closest current sibling first and
start from the established Six.Well page shell. Preserve the shared
header/navigation, breadcrumb, hero anatomy, content width and spacing rhythm,
footer, transitions, typography, and the correct medium accent. Extend shared
systems instead of creating detached replacement chrome.

The root page canvas is always an opaque solid `var(--color-bg)`. Do not apply
gradients, images, transparency, grain/noise, color washes, or full-viewport
pseudo-elements to `html`, `body`, or the root page shell unless the user
explicitly requests an exception. Decorative treatments belong inside bounded
media or components.

Visible structural borders, dividers, frames, timeline rails, and graph strokes
are 5px. Use no line when separation is unnecessary; do not introduce 1px
hairlines. Record and card grids use a modest 12–16px gutter so each framed
item reads independently.

Hero descriptors are a shared typography role. Pair hero titles with a
`.hero-descriptor` paragraph using the Merch and Tattoo index treatment:
Georgia serif, 12px, uppercase, 0.22em letter spacing, and 1.6 line-height.
Descriptors stay left-aligned with a 380px maximum measure and 16px bottom
padding. Their shared color is `rgba(252, 184, 103, 0.55)`, including nested
editor spans. Do not override the shared descriptor color, typography,
alignment, measure, or spacing on individual pages.

Use `http://localhost:4173/tools/ui-guide.html` as the canonical working UI
Guide and its Page Anatomy section as the implementation reference. Do not use
the direct `file://` rendering as an authoritative preview. The source file is
`tools/ui-guide.html`, and `css/tokens.css` remains the palette source of truth.

## Image provenance and technical metadata

Whenever an image enters the site or Archive, extract and retain the available
technical evidence when practical. This includes original filename and format,
pixel dimensions, embedded capture date and time, camera maker and model,
editing or export software, orientation, color profile, and a cryptographic
file hash. Record the evidence in the owning Studio or Archive record when the
current data model supports it; otherwise preserve it in the record's internal
provenance notes rather than discarding it.

Keep each date claim in its correct layer. Filesystem creation and modification
times, embedded camera capture times, editing or export times, upload times, and
the creation date of the depicted work are separate facts. Never turn image or
filesystem metadata into an artwork date without corroborating evidence or the
creator's confirmation. Identify derivatives and alternates explicitly so their
metadata is not mistaken for the provenance of the canonical source.

Treat embedded metadata as reviewable evidence, not automatically public copy.
Strip or withhold precise GPS coordinates, device serial identifiers, private
locations, and other sensitive fields from public output unless they have been
explicitly approved. Preserve the unredacted facts internally when appropriate.
