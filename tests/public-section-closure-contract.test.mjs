import assert from "node:assert/strict";
import test from "node:test";

import worker from "../_worker.js";

const env = {
  ASSETS: {
    async fetch(request) {
      return new Response(new URL(request.url).pathname, { status: 200 });
    },
  },
};

test("About and Archive public page families temporarily redirect to the 404 page", async () => {
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
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}?source=test`), env, {});
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://example.test/404.html", path);
  }
});

test("closing the page families does not redirect their static assets or similarly named routes", async () => {
  for (const path of [
    "/about/section-page.css",
    "/archive-notes/",
    "/aboutness/",
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.notEqual(response.status, 302, path);
  }
});
