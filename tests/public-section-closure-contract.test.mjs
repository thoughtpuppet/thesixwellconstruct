import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../_worker.js";

const env = {
  ASSETS: {
    async fetch(request) {
      return new Response(new URL(request.url).pathname, { status: 200, headers: { "content-type": "text/html" } });
    },
  },
};

test("seeded visibility preserves hidden Film, Music, and Build while opening tool-state pages", async () => {
  for (const path of ["/film/", "/music/", "/tattoos/build/", "/tattoos/build/in-person/"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://example.test/404.html", path);
  }
  for (const path of ["/about/", "/archive/", "/events/", "/writings/", "/tattoos/build/maze/"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 200, path);
  }
});

test("legacy hard-coded visibility lists no longer override the shared authority", () => {
  const workerSource = readFileSync(new URL("../_worker.js", import.meta.url), "utf8");
  const devServerSource = readFileSync(new URL("../tools/dev-server.mjs", import.meta.url), "utf8");
  for (const source of [workerSource, devServerSource]) {
    assert.doesNotMatch(source, /HIDDEN_PUBLIC_PATHS|hiddenPublicPaths/);
    assert.doesNotMatch(source, /CLOSED_PUBLIC_PAGE_PATHS|closedPublicPagePaths/);
    assert.doesNotMatch(source, /OPEN_PUBLIC_PAGE_PATHS|openPublicPagePaths/);
    assert.doesNotMatch(source, /HIDE_PUBLIC_PAGES_EXCEPT_HOME|hidePublicPagesExceptHome/);
  }
  assert.match(workerSource, /pageVisibilityResponse\(request, env\)/);
  assert.match(devServerSource, /\/api\/site\/visibility/);
});
