import assert from "node:assert/strict";
import test from "node:test";

import worker from "../_worker.js";
import { readFileSync } from "node:fs";

const env = {
  ASSETS: {
    async fetch(request) {
      return new Response(new URL(request.url).pathname, { status: 200 });
    },
  },
};

test("closed public page families temporarily redirect to the 404 page", async () => {
  for (const path of [
    "/about",
    "/about/",
    "/about/index.html",
    "/about/founder/",
    "/about/legend/open-eye/",
    "/archive",
    "/archive/",
    "/archive/index.html",
    "/archive/guide/",
    "/archive/records/lostmarbles/",
    "/archive/timelines/art/",
    "/tattoos/build",
    "/tattoos/build/",
    "/tattoos/build/index.html",
    "/tattoos/build/in-person/",
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}?source=test`), env, {});
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://example.test/404.html", path);
  }
});

test("the Events landing page is hidden without closing event detail routes", async () => {
  for (const path of ["/events", "/events/", "/events/index.html"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}?source=test`), env, {});
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://example.test/404.html", path);
  }

  for (const path of ["/events/signal-symbol/", "/events/ss-and-f-live-audience/", "/api/events"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.notEqual(response.status, 302, path);
  }

  const devServer = readFileSync(new URL("../tools/dev-server.mjs", import.meta.url), "utf8");
  assert.match(devServer, /const hiddenPublicExactPaths = new Set\(\["\/events"\]\)/);
  assert.match(devServer, /hiddenPublicExactPaths\.has\(normalizedLower\)/);
});

test("the Maze Studio remains public while the rest of the Build family is closed", async () => {
  for (const path of [
    "/tattoos/build/maze",
    "/tattoos/build/maze/",
    "/tattoos/build/maze/index.html",
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 200, path);
  }

  const devServer = readFileSync(new URL("../tools/dev-server.mjs", import.meta.url), "utf8");
  assert.match(devServer, /const openPublicPagePaths = new Set\(\["\/tattoos\/build\/maze"\]\)/);
  assert.match(devServer, /openPublicPagePaths\.has\(normalizedLower\)/);
});

test("closing the page families does not redirect their static assets or similarly named routes", async () => {
  for (const path of [
    "/about/section-page.css",
    "/archive-notes/",
    "/aboutness/",
    "/tattoos/building/",
    "/tattoos/build/maze/assets/index.js",
    "/api/build-drafts/current",
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.notEqual(response.status, 302, path);
  }
});
