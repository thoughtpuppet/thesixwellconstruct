import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi, selectExploreDestination } from "../functions/api/construct/_lib.js";

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
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    db.exec(read(join("migrations", name)));
  }
  return db;
}

function runtime(db) { return { SUBMISSIONS_DB: new LocalD1(db) }; }
function request(path, method = "GET") { return new Request(`https://example.test${path}`, { method }); }

function destination(scope, key, medium = "art", entityKey = key) {
  return { key, scope, kind: "test", medium: { id: medium, label: medium.toUpperCase() }, title: key, route: `/test/${key}/`, entityKey };
}

test("all-site selection uses 50/30/20 family bands and omits unavailable families", () => {
  const pools = {
    works: [destination("works", "work")],
    process: [destination("process", "process")],
    pages: [destination("pages", "page")],
  };
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.1).destination.scope, "works");
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.6).destination.scope, "process");
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.9).destination.scope, "pages");
  assert.equal(selectExploreDestination({ works: [], process: [], pages: pools.pages }, "all", [], () => 0).destination.scope, "pages");
});

test("selection balances medium, canonical entity, and surface instead of row volume", () => {
  const dense = Array.from({ length: 20 }, (_, index) => destination("works", `dense-${index}`, "art", "dense"));
  const sparseMedium = [destination("works", "tattoo-one", "tattoos", "tattoo-one")];
  assert.equal(selectExploreDestination({ works: [...dense, ...sparseMedium] }, "works", [], () => 0.75).destination.medium.id, "tattoos");

  const entityA = Array.from({ length: 12 }, (_, index) => destination("works", `a-${index}`, "art", "a"));
  const entityB = [destination("works", "b-one", "art", "b")];
  assert.equal(selectExploreDestination({ works: [...entityA, ...entityB] }, "works", [], () => 0.75).destination.key, "b-one");
});

test("exclusions prevent repeats and restart only after a scope is exhausted", () => {
  const pools = { works: [destination("works", "one"), destination("works", "two")] };
  const fresh = selectExploreDestination(pools, "works", ["one"], () => 0);
  assert.equal(fresh.destination.key, "two");
  assert.equal(fresh.restarted, false);
  const restarted = selectExploreDestination(pools, "works", ["one", "two"], () => 0);
  assert.equal(restarted.destination.key, "one");
  assert.equal(restarted.restarted, true);
});

test("Explore API validates scope, rejects methods, and always disables caching", async () => {
  const db = database();
  const invalid = await handleConstructApi(request("/api/site/explore?scope=unknown"), runtime(db));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const method = await handleConstructApi(request("/api/site/explore", "POST"), runtime(db));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("cache-control"), "no-store");
});

test("works and pages only return eligible public internal destinations", async () => {
  const db = database();
  db.exec(`
    UPDATE content_entities SET visibility='internal',search_visibility=0;
    UPDATE archive_dossiers SET state='draft',public_visible=0;
    UPDATE construct_nodes SET homepage_enabled=0;
    UPDATE construct_pathways SET homepage_enabled=0;

    UPDATE content_entities SET visibility='public',search_visibility=1 WHERE id='art-marbles';
    UPDATE search_documents SET state='published',route='/art/lostmarblespainting' WHERE entity_id='art-marbles';

    UPDATE content_entities SET visibility='private',search_visibility=1 WHERE id IN (SELECT entity_id FROM search_documents WHERE entity_id<>'art-marbles');

    UPDATE content_entities SET visibility='public' WHERE id='node-about';
    UPDATE construct_nodes SET state='published',homepage_enabled=1,route='/about/' WHERE id='node-about';
    UPDATE content_entities SET visibility='public' WHERE id='path-about-01';
    UPDATE construct_pathways SET state='published',homepage_enabled=1,route='https://outside.example/' WHERE id='path-about-01';
    UPDATE content_entities SET visibility='public' WHERE id='path-about-02';
    UPDATE construct_pathways SET state='published',homepage_enabled=1,route='/booking/studio/' WHERE id='path-about-02';
  `);
  const works = await handleConstructApi(request("/api/site/explore?scope=works"), runtime(db));
  assert.equal(works.status, 200);
  assert.equal(works.headers.get("cache-control"), "no-store");
  const workPayload = await works.json();
  assert.equal(workPayload.destination.route, "/art/lostmarblespainting");
  assert.equal(workPayload.destination.medium.id, "art");
  assert.deepEqual(Object.keys(workPayload.destination).sort(), ["key", "kind", "medium", "route", "scope", "title"]);

  const pages = await handleConstructApi(request("/api/site/explore?scope=pages"), runtime(db));
  assert.equal(pages.status, 200);
  assert.equal((await pages.json()).destination.route, "/about/");
});

test("process selection reuses publication, consent, presentation, and public-included gates", async () => {
  const db = database();
  db.exec(`
    UPDATE content_entities SET visibility='internal';
    UPDATE archive_dossiers SET state='draft',public_visible=0;
    UPDATE archive_materials SET state='draft',visibility='internal';
    UPDATE archive_source_material_sets SET publication_state='draft',visibility='internal';
    UPDATE content_entities SET visibility='public' WHERE id='art-marbles';
    UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id='art-marbles';

    INSERT INTO archive_materials(id,dossier_entity_id,material_type,title,body,visibility,state,created_at,updated_at)
      VALUES('explore-public-note','art-marbles','note','Public studio note','A public process note.','public','published',datetime('now'),datetime('now'));
    INSERT INTO archive_materials(id,dossier_entity_id,material_type,title,body,visibility,state,created_at,updated_at)
      VALUES('explore-private-note','art-marbles','note','Private studio note','Never public.','private','published',datetime('now'),datetime('now'));
    INSERT INTO media_assets(id,source_url,mime_type,privacy,consent_status,state,created_at,updated_at,public_presentation)
      VALUES('explore-denied-media','/private/denied.jpg','image/jpeg','public','denied','active',datetime('now'),datetime('now'),'inline');
    INSERT INTO archive_materials(id,dossier_entity_id,media_id,material_type,title,visibility,state,created_at,updated_at)
      VALUES('explore-denied-photo','art-marbles','explore-denied-media','process-photo','Denied process photo','public','published',datetime('now'),datetime('now'));
  `);
  const response = await handleConstructApi(request("/api/site/explore?scope=process"), runtime(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.destination.key, "process:material:explore-public-note");
  assert.match(payload.destination.route, /^\/archive\/records\/[^/]+\/#/);
  assert.doesNotMatch(payload.destination.route, /denied\.jpg|\/api\//);
  const excluded = await handleConstructApi(request(`/api/site/explore?scope=process&exclude=${payload.destination.key}`), runtime(db));
  assert.equal((await excluded.json()).restarted, true);
});

test("empty eligible pools return a retryable no-store response", async () => {
  const db = database();
  db.exec("UPDATE content_entities SET visibility='internal'; UPDATE archive_dossiers SET public_visible=0; UPDATE construct_nodes SET homepage_enabled=0; UPDATE construct_pathways SET homepage_enabled=0;");
  const response = await handleConstructApi(request("/api/site/explore?scope=all"), runtime(db));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Explore page, client states, navigation, and UI Guide use the public system contract", () => {
  const html = read("explore/index.html");
  const css = read("css/explore.css");
  const client = read("js/explore.js");
  const nav = read("js/construct-nav.js");
  const guide = read("tools/ui-guide-system.js");
  const worker = read("_worker.js");

  assert.match(html, /Construct<\/a><span aria-hidden="true"> \/ <\/span><span aria-current="page">Explore/);
  assert.match(html, /<h1 class="hero-title">Explore\.<\/h1>/);
  assert.match(html, /Move across works, records, process, voices, notes, and pathways without choosing a medium first\./);
  for (const label of ["Take me somewhere", "Works &amp; objects", "Process &amp; evidence", "Pages &amp; pathways"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /data-venture=/);
  assert.match(css, /background:\s*var\(--color-bg\)/);
  assert.match(css, /border(?:-top)?:\s*5px/);
  assert.match(css, /min-height:[^;]*44px/);
  assert.match(client, /Finding somewhere…/);
  assert.match(client, /interactive_start/);
  assert.match(client, /interactive_complete/);
  assert.match(client, /sessionStorage/);
  assert.match(client, /_constructFade/);
  assert.match(nav, /className = 'cnav-explore'/);
  assert.match(nav, /id = 'cnav-mobile-explore'/);
  assert.match(nav, /aria-current', 'page'/);
  assert.equal((nav.match(/\{ key: '[^']+',\s+label:/g) || []).length, 9, "Explore must not become a tenth medium node");
  assert.match(guide, /id: "construct-explore"/);
  assert.match(worker, /url\.pathname === "\/api\/site\/explore"/);
});
