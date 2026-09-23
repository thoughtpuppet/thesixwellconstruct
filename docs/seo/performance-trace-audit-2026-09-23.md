# SEO performance trace audit

Run: 2026-09-23
Tool: Chrome DevTools MCP performance trace
Viewports: desktop at 1440 px wide and mobile emulation at 390 x 844, 1x CPU, no network throttling

The public site was used for the baseline because the local preview injects its editing controls and cannot render the dynamic merch and calendar detail routes. The same local URL and viewport were used for each post-change trace because deployment was not authorized.

## Public baseline

| URL | Desktop LCP / CLS | Mobile LCP / CLS | LCP node or trace note | Blocking work and largest observed transfer |
| --- | --- | --- | --- | --- |
| `/about/saieldauhnsolehman/` | not emitted / 0 | not emitted / 0 | Chrome emitted no LCP candidate in repeated foreground traces; this is unmeasured, not zero. | No long tasks. Local clean-load diagnostic transferred the 163 KB profile JPG as the largest asset. |
| `/tattoos/portfolio/` | 1.839 s / 0.611 | 1.785 s / 0 | First portfolio image, `/api/portfolio/media/5408f443-245c-4c76-8e06-1d99ad84579a`. | No long tasks. The page requested portfolio media at about 3.89 MB, 2.40 MB, and 2.33 MB; the media endpoint is `private, no-store`. |
| `/tattoos/inquire/` | 0.325 s / 0.074 | 0.234 s / 0 | Desktop H1; mobile hero descriptor. | No long tasks. `/api/booking/public-consultation/context` was the largest transfer at about 31.6 KB encoded. |
| `/merch/` | 0.288 s / 0.029 | 0.283 s / 0 | Hero H1. | No long tasks. The catalog response was under 1 KB transferred in this run. |
| `/merch/lostmarbles-hoodie/` | 0.289 s / 0.0065 | 0.505 s / 0 | Product H1. | No long tasks. Chrome tied the small desktop shift to the unsized origin thumbnail; the score remained well inside the good range. |
| `/events/` | not emitted / 0 | 1.005 s / 0 | Mobile event-card metadata; desktop emitted no LCP candidate. | No long tasks. `/api/events` was about 4.3 KB encoded. |
| `/calendar/` | 5.087 s / 0 in the extended desktop trace | not emitted / 0 in the standard mobile trace | Desktop result count, after approved events render. | The API finished near 0.873 s, followed by one 3.995 s main-thread task. `/api/calendar/events` was about 157 KB transferred compressed. |
| Approved Miya Bailey event detail | not emitted / 0 | not emitted / 0 | Chrome emitted no LCP candidate in repeated foreground traces; this is unmeasured, not zero. | No long tasks or dominant media transfer appeared. |

The render-blocking insight named page CSS and Google Fonts on several routes. It reported no savings on some routes and estimates larger than the already-observed LCP on others, so no stylesheet or font change was made from that inconsistent signal. Cache insights estimated zero FCP/LCP savings in the sampled reloads. The clear critical chains were:

- Portfolio: document -> `portfolio-detail.js` -> `/api/portfolio` -> portfolio media. The public LCP image had a 428 ms discovery delay and 1.199 s load duration on desktop.
- Calendar: document -> calendar scripts -> `/api/calendar/events` -> synchronous filtering and month/list rendering.
- Inquiry, merch, product, and events: document -> page script -> one small public context/catalog endpoint.

## Evidence-supported changes

### Tattoo Portfolio layout reservation

Before the API response at desktop width, the filters were 48 px tall, the loading grid was 107 px tall, and the footer began at y=696 inside the 949 px viewport. After 35 cards mounted, the filters became 120 px tall and the footer moved to y=4451. Chrome attributed a 0.578 shift to that update.

The page now reserves 120 px for desktop filters and 55 vh for the loading grid. Same-origin local before/after traces:

| Trace | LCP | CLS | Result |
| --- | ---: | ---: | --- |
| Desktop before | 1.460 s | 0.5797 | Poor CLS; async catalog moved the footer through the viewport. |
| Desktop after | 1.203 s | 0.0367 | Good CLS; remaining 0.0362 shift is below the action threshold. |
| 390 x 844 after | 1.548 s | 0 | No regression and no layout shifts. |

### Atlanta Calendar date formatting

The public desktop trace showed the event response completing around 0.873 s, followed by a 3.995 s long task; “9 upcoming events” did not render until 4.896 s. `renderMonth()` evaluates 42 cells and repeatedly calls `dateKey()`, which created a new timezone-aware `Intl.DateTimeFormat` on every call in both calendar scripts.

Each script now reuses one formatter. Post-change local traces, using the same live event data through the preview proxy:

| Trace | API complete | Result count ready | Long task | LCP / CLS |
| --- | ---: | ---: | ---: | --- |
| Desktop after | 1.050 s | 1.258 s | 174 ms | Local editor controls became LCP; CLS remained effectively zero. |
| 390 x 844 after | 1.136 s | 1.357 s | 182 ms | 1.449 s / 0 |

The desktop post-response render interval fell from roughly 4.02 s to 0.21 s. No other trace produced evidence strong enough to justify a code change.

## Validation

- `node --check js/atlanta-calendar.js`
- `node --check js/atlanta-calendar-record.js`
- `node --test tests/atlanta-calendar-detail-contract.test.mjs tests/portfolio-card-contract.test.mjs tests/seo-system-contract.test.mjs` — 21 passed
- `git diff --check` — passed; only existing line-ending warnings were emitted

No commit, push, deployment, Search Console change, or production mutation was performed.
