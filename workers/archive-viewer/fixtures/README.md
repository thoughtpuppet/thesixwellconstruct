# Browser isolation fixture

`browser-attack.html` is an intentionally hostile historical-page fixture. It
keeps a same-snapshot script and image working while attempting fetch, XHR,
WebSocket, beacon, form submission, popup, parent DOM access, local storage,
Worker, Service Worker, download, external-link navigation, and meta refresh.

Run the real-browser harness from the repository root:

```powershell
node workers/archive-viewer/scripts/run-browser-attack.mjs --out output/playwright/archive-viewer-attack
```

The harness serves only localhost, applies the production response CSP plus an
iframe `sandbox="allow-scripts"`, runs Chromium through `playwright-cli`, and
fails unless local assets execute while no probe request reaches its server.

This checks browser enforcement and the viewer transformations represented by
the fixture. It does not replace an integration pass against the deployed
Worker/D1/R2 chain. Computed JavaScript that assigns an external URL directly
to `location.href` cannot be comprehensively identified statically; such an
unverifiable reference must remain a publication blocker during snapshot scan.
