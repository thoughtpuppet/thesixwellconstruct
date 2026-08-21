import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import worker from "../_worker.js";
import {
  handleAdminSiteVisibility,
  handlePublicSiteVisibility,
  publicPageVisibilityDecision,
} from "../functions/api/site-visibility/_lib.js";
import {
  PAGE_VISIBILITY_DEFAULT_RULES,
  PAGE_VISIBILITY_PAGES,
  normalizePageVisibilityPath,
  resolvePageVisibility,
} from "../shared/page-visibility.js";

const TOKEN = "page-visibility-contract-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function visibilityEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../migrations/0157_site_page_visibility.sql", import.meta.url), "utf8"));
  return {
    database,
    env: {
      SUBMISSIONS_DB: new LocalD1(database),
      SUBMISSIONS_ADMIN_TOKEN: TOKEN,
      ASSETS: { async fetch(request) { return new Response(new URL(request.url).pathname, { status: 200, headers: { "content-type": "text/html" } }); } },
    },
  };
}

async function admin(env, body) {
  return handleAdminSiteVisibility(new Request("https://example.test/api/admin/site-visibility", {
    method: body ? "PATCH" : "GET",
    headers: { ...AUTH, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
}

test("authoritative registry and fallback seed preserve the approved initial state", async () => {
  assert.ok(PAGE_VISIBILITY_PAGES.some((page) => page.path === "/tattoos/build/"));
  assert.ok(PAGE_VISIBILITY_PAGES.some((page) => page.path === "/tattoos/build/maze/"));
  for (const path of ["/film/", "/music/", "/tattoos/build/", "/tattoos/build/in-person/"]) {
    assert.equal(resolvePageVisibility(path, PAGE_VISIBILITY_DEFAULT_RULES, false).hidden, true, path);
  }
  assert.equal(resolvePageVisibility("/tattoos/build/maze/", PAGE_VISIBILITY_DEFAULT_RULES, false).hidden, false);
  assert.equal(normalizePageVisibilityPath("/art/lustpainting"), "/art/lustpainting.html");
  for (const path of ["/about/", "/archive/", "/events/", "/writings/"]) {
    assert.equal((await publicPageVisibilityDecision(path, {})).hidden, false, path);
  }
});

test("admin visibility API authenticates, validates, and returns seeded D1 state", async () => {
  const { env } = visibilityEnv();
  const unauthorized = await handleAdminSiteVisibility(new Request("https://example.test/api/admin/site-visibility"), env);
  assert.equal(unauthorized.status, 401);
  const response = await admin(env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.homeOnly, false);
  assert.equal(payload.pages.find((page) => page.path === "/film").hidden, true);
  assert.equal(payload.pages.find((page) => page.path === "/events").hidden, false);
  const home = await admin(env, { action: "set", path: "/", visibility: "hidden", scope: "exact" });
  assert.equal(home.status, 409);
  const unknown = await admin(env, { action: "set", path: "/not-registered/", visibility: "hidden", scope: "exact" });
  assert.equal(unknown.status, 400);
  const badScope = await admin(env, { action: "set", path: "/about/", visibility: "hidden", scope: "family" });
  assert.equal(badScope.status, 400);
});

test("longest path wins so a public child reopens inside a hidden descendant family", async () => {
  const { env } = visibilityEnv();
  assert.equal((await admin(env, { action: "set", path: "/art/", visibility: "hidden", scope: "descendants" })).status, 200);
  assert.equal((await publicPageVisibilityDecision("/art/lustpainting.html", env)).hidden, true);
  assert.equal((await admin(env, { action: "set", path: "/art/lustpainting.html", visibility: "public", scope: "exact" })).status, 200);
  const child = await publicPageVisibilityDecision("/art/lustpainting.html", env);
  assert.equal(child.hidden, false);
  assert.equal(child.sourcePath, "/art/lustpainting.html");
  assert.equal((await publicPageVisibilityDecision("/art/lustpainting", env)).hidden, false);
  assert.equal((await publicPageVisibilityDecision("/art/another-work/", env)).hidden, true);
});

test("home-only is absolute and Show All clears every rule", async () => {
  const { database, env } = visibilityEnv();
  assert.equal((await admin(env, { action: "home-only", enabled: true })).status, 200);
  assert.equal((await publicPageVisibilityDecision("/tattoos/build/maze/", env)).hidden, true);
  assert.equal((await publicPageVisibilityDecision("/home/", env)).hidden, false);
  assert.equal((await publicPageVisibilityDecision("/entry-room/", env)).hidden, false);
  assert.equal((await publicPageVisibilityDecision("/index.html", env)).hidden, false);
  assert.equal((await publicPageVisibilityDecision("/404.html", env)).hidden, false);
  assert.equal((await publicPageVisibilityDecision("/tools/ui-guide.html", env)).hidden, true);
  assert.equal((await admin(env, { action: "show-all" })).status, 200);
  assert.equal((await publicPageVisibilityDecision("/film/", env)).hidden, false);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM site_visibility_rules").get().count, 0);
});

test("public decision endpoint exposes effective state but keeps operational paths exempt", async () => {
  const { env } = visibilityEnv();
  await admin(env, { action: "home-only", enabled: true });
  const hidden = await handlePublicSiteVisibility(new Request("https://example.test/api/site/visibility?path=%2Farchive%2F"), env);
  assert.equal((await hidden.json()).hidden, true);
  for (const path of ["/api/events", "/studio/submissions/", "/b/private-token", "/o/private-offer"]) {
    const response = await handlePublicSiteVisibility(new Request(`https://example.test/api/site/visibility?path=${encodeURIComponent(path)}`), env);
    assert.equal((await response.json()).hidden, false, path);
  }
});

test("unified Worker gate runs before static and dynamic public page handlers", async () => {
  const { env } = visibilityEnv();
  for (const path of ["/about/", "/archive/", "/events/", "/art/", "/merch/", "/tattoos/special-projects/"]) {
    assert.equal((await admin(env, { action: "set", path, visibility: "hidden", scope: "descendants" })).status, 200, path);
  }
  for (const path of [
    "/about/legend/open-eye/",
    "/archive/records/example-record/",
    "/events/example-event/",
    "/art/example-managed-work/",
    "/merch/lostmarbles-hoodie/",
    "/tattoos/special-projects/example-project/",
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://example.test/404.html", path);
  }
  for (const path of ["/api/site/visibility?path=/about/", "/studio/submissions/", "/assets/example.css", "/b/private-token", "/o/private-offer"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.notEqual(response.status, 302, path);
  }
});

test("Studio and standalone controls no longer mutate Worker or page files", () => {
  const tool = readFileSync(new URL("../tools/page-visibility.html", import.meta.url), "utf8");
  const studio = readFileSync(new URL("../studio/page-visibility-manager.js", import.meta.url), "utf8");
  const film = readFileSync(new URL("../film/index.html", import.meta.url), "utf8");
  const music = readFileSync(new URL("../music/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(tool, /showDirectoryPicker|__tools\/write-file|HIDDEN_PUBLIC_PATHS|\.hidden-pages/);
  assert.match(tool, /mountPageVisibility/);
  assert.match(studio, /Include descendants/);
  assert.match(film, /class="venture-page"/);
  assert.match(music, /class="venture-page"/);
});
