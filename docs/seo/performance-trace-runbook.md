# Chrome performance trace runbook

The project config registers `chrome-devtools-mcp` in `.codex/config.toml`. Restart Codex after this change so the server and its performance tools become available.

## Trace set

Run one desktop and one 390 x 844 mobile trace for:

- `/about/saieldauhnsolehman/`
- `/tattoos/portfolio/`
- `/tattoos/inquire/`
- `/merch/` plus one public product
- `/events/`
- `/calendar/` plus one approved event

For each page:

1. Open a clean page load and begin a performance trace with reload.
2. Record LCP, CLS, blocking work, critical request chains, caching observations, and largest transferred media.
3. Identify the actual LCP node and any layout-shift sources.
4. Apply a change only when the trace ties it to a measured problem.
5. Repeat the same viewport and URL after the change and retain before/after evidence.

Do not substitute a Lighthouse score, source inspection, or Playwright screenshot for the Chrome performance trace. Those can supplement the evidence but do not prove the LCP/CLS cause.
