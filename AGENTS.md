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
Keep medium-specific color and placement in the page shell, but do not invent a
different descriptor type treatment for new pages.

Use `http://localhost:4173/tools/ui-guide.html` as the canonical working UI
Guide and its Page Anatomy section as the implementation reference. Do not use
the direct `file://` rendering as an authoritative preview. The source file is
`tools/ui-guide.html`, and `css/tokens.css` remains the palette source of truth.
