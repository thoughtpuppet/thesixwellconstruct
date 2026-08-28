import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
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

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) db.exec(read(join("migrations", name)));
  return db;
}

function runtime(db) { return { SUBMISSIONS_DB: new LocalD1(db) }; }
function request(path) { return new Request(`https://example.test${path}`); }
async function payload(db, path) {
  const response = await handleConstructApi(request(path), runtime(db));
  assert.equal(response.status, 200);
  return response.json();
}

test("sitewide search adds safe managed pages while preserving the default Archive contract", async () => {
  const db = database();
  const baseline = await payload(db, "/api/search?q=art%20making");
  assert.equal(baseline.includes, undefined);
  assert.ok(baseline.records.every((record) => record.medium_key === undefined && record.primary_match === undefined));
  assert.ok(baseline.records.every((record) => !["construct_node", "construct_pathway"].includes(record.entity_type)));

  const sitewide = await payload(db, "/api/search?q=art%20making&include=pages");
  assert.deepEqual(sitewide.includes, ["pages"]);
  assert.equal(sitewide.records[0].entity_id, "node-art");
  assert.equal(sitewide.records[0].route, "/art/");
  assert.equal(sitewide.records[0].medium_key, "pages");
  assert.deepEqual(sitewide.records[0].primary_match, { kind: "Title", label: "Exact title", snippet: "ART MAKING" });

  const fixtures = [
    ["path-search-safe", "public", "published", 1, "/about/safety-lens/"],
    ["path-search-private", "private", "published", 1, "/about/private-safety/"],
    ["path-search-draft", "public", "draft", 1, "/about/draft-safety/"],
    ["path-search-hidden", "public", "published", 0, "/about/hidden-safety/"],
    ["path-search-studio", "public", "published", 1, "/studio/safety/"],
    ["path-search-admin", "public", "published", 1, "/admin/safety/"],
    ["path-search-private-link", "public", "published", 1, "/b/private-safety-token"],
    ["path-search-token", "public", "published", 1, "/about/safety/?token=private"],
    ["path-search-external", "public", "published", 1, "https://outside.example/safety/"],
  ];
  for (const [id, visibility, state, enabled, route] of fixtures) {
    db.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_at,updated_at) VALUES(?, 'construct_pathway', 'node-about', ?, 0, datetime('now'), datetime('now'))").run(id, visibility);
    db.prepare("INSERT INTO construct_pathways(id,node_id,name,route,state,homepage_enabled,sort_order,created_at,updated_at) VALUES(?, 'node-about', ?, ?, ?, ?, 99, datetime('now'), datetime('now'))").run(id, `Safety ${id}`, route, state, enabled);
  }
  const safe = await payload(db, "/api/search?q=safety&include=pages");
  const ids = safe.records.map((record) => record.entity_id);
  assert.ok(ids.includes("path-search-safe"));
  for (const blocked of fixtures.slice(1).map((fixture) => fixture[0])) assert.ok(!ids.includes(blocked), `${blocked} must remain private or unroutable`);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(safe.records.every((record) => record.route.startsWith("/") && !record.route.startsWith("//")));
  assert.ok(safe.records.every((record) => record.entity_id && record.medium_key && record.primary_match && Array.isArray(record.matches)));

  const marbles = await payload(db, "/api/search?q=marbles&include=pages");
  const art = marbles.records.find((record) => record.entity_id === "art-marbles");
  assert.equal(art?.medium_key, "art");
  assert.ok(marbles.records.length < baseline.count + 60, "a query must not fall back to the entire public Archive");

  const relationship = await payload(db, "/api/search?q=made%20in%20public&include=pages");
  assert.ok(relationship.records.some((record) => record.primary_match.kind === "Relationship"), "relationship fragments must explain how a record was found");
});

test("the Search page is a dedicated URL-driven public shell with direct results and complete states", () => {
  const html = read("search/index.html");
  const css = read("css/search.css");
  const client = read("js/search.js");
  const analytics = read("js/site-analytics.js");

  assert.match(html, /construct-breadcrumb/);
  assert.match(html, /site-hero--supporting/);
  assert.match(html, /class="hero-descriptor"/);
  assert.match(html, /data-search-scope="(?:all|art|archive|tattoo|merch|events|symbols|pages)"/);
  for (const scope of ["all", "art", "archive", "tattoo", "merch", "events", "symbols", "pages"]) assert.match(html, new RegExp(`data-search-scope="${scope}"`));
  assert.match(html, /\/css\/search\.css/);
  assert.match(html, /\/js\/search\.js/);
  assert.doesNotMatch(html, /managed-preview|<dialog\b/i);

  assert.match(css, /--search-bg:\s*var\(--color-bg/);
  assert.match(css, /background:\s*var\(--search-bg\)/);
  assert.match(css, /border(?:-\w+)?:\s*5px\s+solid/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(client, /include:\s*'pages'/);
  assert.match(client, /searchParams\.set\('q'/);
  assert.match(client, /searchParams\.set\('scope'/);
  assert.match(client, /history\[mode === 'replace' \? 'replaceState' : 'pushState'\]/);
  assert.match(client, /addEventListener\('popstate'/);
  assert.match(client, /<a class="search-result"/);
  assert.match(client, /Found through/);
  for (const state of ["prompt", "loading", "empty", "error"]) assert.match(client, new RegExp(`kind === '${state}'|showStatus\\('${state}'`));
  assert.match(client, /data-search-retry/);
  assert.doesNotMatch(client, /tattoo[-_ ]?inquir|dialog|managed-preview/i);
  assert.match(client, /analyticsResults = String\(rendered\)/);
  assert.match(analytics, /count <= 0 \? "0"/);
  assert.doesNotMatch(analytics, /resultBucket:.*(?:query|value)/);
});

test("homepage and shared navigation expose accessible Search actions with responsive fit accounting", () => {
  const home = read("home/index.html");
  const nav = read("js/construct-nav.js");
  assert.match(home, /<a href="\/search\/">Search<\/a>/);
  assert.equal((nav.match(/aria-label', 'Search the Construct'/g) || []).length, 2);
  assert.match(nav, /className = 'cnav-search'/);
  assert.match(nav, /id = 'cnav-mobile-search'/);
  assert.match(nav, /isSearchPage.*aria-current/);
  assert.match(nav, /searchWidth/);
  assert.match(nav, /dotCount \+ 2/);
  assert.match(nav, /_constructFade\('\/search\/'\)/);
  assert.match(nav, /#cnav-mobile-search:focus-visible/);
});
