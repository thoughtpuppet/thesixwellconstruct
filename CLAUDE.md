# the six.well construct — Claude reference

## Public page shell rule

Every website page must begin from the established site shell. Before building
or redesigning a page, inspect the closest current sibling and align its shared
header/navigation, breadcrumb, hero anatomy, content shell and spacing, footer,
transitions, typography, and medium accent. Do not create isolated replacement
chrome when the shared systems already provide it.

The root page canvas is always an opaque solid `var(--color-bg)`. Do not use a
gradient, image, transparency, grain/noise, color wash, or full-viewport
pseudo-element as the `html`, `body`, or page-shell background unless the user
explicitly requests an exception. Decorative treatments belong inside
contained media or components.

Visible structural borders, dividers, frames, timeline rails, and graph strokes
are 5px. Use no line when separation is unnecessary; do not introduce 1px
hairlines. Record and card grids use a modest 12–16px gutter.

The canonical working UI Guide is
`http://localhost:4173/tools/ui-guide.html`; do not treat the direct `file://`
rendering as authoritative. Its source is `tools/ui-guide.html`, and its Page
Anatomy section is the canonical implementation reference.

## Medium accent color rule

**Every medium page must use its medium color as the accent.**
Never use the global amber (`#FCB867`) as the primary signal color on a medium page.
Set `--venture-color` in the page's `:root` using the matching token from `tokens.css`.

The CSS custom property is still named `--venture-color` for compatibility.

| Medium     | CSS token                  | Hex       |
|------------|----------------------------|-----------|
| tattooing  | `var(--color-tattooing)`   | `#6E0404` |
| art        | `var(--color-art)`         | `#0039BD` |
| merch      | `var(--color-merch)`       | `#F08F00` |
| about      | `var(--color-about)`       | `#FCB867` |
| events     | `var(--color-events)`      | `#005D25` |
| music      | `var(--color-music)`       | `#A22F8D` |
| writings   | `var(--color-writings)`    | `#FFE7CA` |
| archive    | `var(--color-archive)`     | `#6D3D15` |
| film       | `var(--color-film)`        | `#00857A` |

The single source of truth for these values is `css/tokens.css`. JavaScript consumers should read the CSS variables instead of keeping separate color mirrors.

**How to apply:**
```css
:root {
  --venture-color: var(--color-tattooing); /* set to this medium's color */
}
```

Then use `var(--venture-color)` anywhere the medium accent appears:
- Filter chip active state (dot + underline)
- Section labels, kicker text
- Status indicators, active UI states
- Hover border colors on media cards and interactive elements

## Shared CSS files

| File                    | Purpose |
|-------------------------|---------|
| `css/tokens.css`        | Single source of truth — colors, type, spacing, timing |
| `css/transitions.css`   | Page fade transition system |
| `css/media.css`         | Global media card and grid styles (`.media-card`, `.media-grid`) |
| `css/venture-pages.css` | Shared medium page shell styles |

## Media card system (`css/media.css`)

Use `.media-card` and `.media-grid` for all image/card grids across mediums.
The card style matches the art index: `4/5` aspect ratio, `5px` border, hover darkens + scales down, title overlay slides up.

**Required page setup:**
```css
:root {
  --venture-color: var(--color-tattooing); /* medium color */
}
```

**Card HTML structure:**
```html
<div class="media-card">
  <span class="card-image"><img src="..." alt="..."></span>
  <span class="card-badge">...</span>       <!-- optional, always visible -->
  <span class="card-overlay">
    <span class="card-title">Title</span>
    <span class="card-sub">Sub / metadata</span>
  </span>
</div>
```

Sheet variants (wider format): add `.card--wide` for `aspect-ratio: 3/2`.

## Key design reminders

- Start every public page from the shared page shell and a solid opaque canvas.
- Preserve the shared header, breadcrumb, hero, content rhythm, and footer.
- Use **medium** for the top-level practice areas formerly called nodes or ventures.
- Use **pathway** for the internal routes formerly called subnodes.
- The `body[data-venture]` attribute must always be set to the correct medium key. The attribute name is legacy and should remain unchanged unless the whole navigation system is migrated.
- Never push — user always pushes manually.
- Always work directly on the main repo (no worktrees).
- Read `README.md` for ecosystem-first site principle, hosting, and form setup.
