# the six.well construct — Claude reference

## Venture accent color rule

**Every venture page must use its venture node color as the accent.**
Never use the global amber (`#FCB867`) as the primary signal color on a venture page.
Set `--venture-color` in the page's `:root` using the matching token from `tokens.css`.

| Venture    | CSS token                  | Hex       |
|------------|----------------------------|-----------|
| tattooing  | `var(--color-tattooing)`   | `#8F231D` |
| art        | `var(--color-art)`         | `#0581C1` |
| merch      | `var(--color-merch)`       | `#F7A226` |
| about      | `var(--color-about)`       | `#FCB867` |
| events     | `var(--color-events)`      | `#55BA5A` |
| music      | `var(--color-music)`       | `#A856A1` |
| writings   | `var(--color-writings)`    | `#328C84` |
| archive    | `var(--color-archive)`     | `#EC5E26` |
| film       | `var(--color-film)`        | `#FFE7CA` |

The single source of truth for these values is `css/tokens.css` and `js/construct-nav.js`.

**How to apply:**
```css
:root {
  --venture-color: var(--color-tattooing); /* set to this venture's node color */
}
```

Then use `var(--venture-color)` anywhere the venture accent appears:
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
| `css/venture-pages.css` | Shared venture page shell styles |

## Media card system (`css/media.css`)

Use `.media-card` and `.media-grid` for all image/card grids across ventures.
The card style matches the art index: `4/5` aspect ratio, `5px` border, hover darkens + scales down, title overlay slides up.

**Required page setup:**
```css
:root {
  --venture-color: var(--color-tattooing); /* venture's node color */
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

- The `body[data-venture]` attribute must always be set to the correct venture key.
- Never push — user always pushes manually.
- Always work directly on the main repo (no worktrees).
- Read `README.md` for ecosystem-first site principle, hosting, and form setup.
