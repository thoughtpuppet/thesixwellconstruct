import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "art-detail-test-token";
const PAINTING_PAGES = new Map([
  ["lostmarblespainting.html", "480px"],
  ["lustpainting.html", "560px"],
  ["slothpainting.html", "460px"],
  ["homelandsecuritypainting.html", "560px"],
  ["thefrustrationsofinnercharospainting.html", "460px"],
  ["paranoiafosteredtraumapainting.html", "560px"],
]);

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    if (row === undefined) return null;
    return column ? row[column] : row;
  }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
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

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const names = readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  return database;
}

function environment(database) {
  return { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
}

function request(path, { method = "GET", body, admin = false } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function jsonResponse(response) {
  return { response, payload: await response.json() };
}

test("all painting detail pages use the shared shell and managed hooks", () => {
  for (const [name, width] of PAINTING_PAGES) {
    const html = readFileSync(join(ROOT, "art", name), "utf8");
    const renderedHtml = html.replace(/<!--[\s\S]*?-->/g, "");
    const tokenIndex = html.indexOf('href="/css/tokens.css"');
    const transitionIndex = html.indexOf('href="/css/transitions.css"');
    const detailIndex = html.indexOf('href="/css/painting-detail.css"');
    const mobileIndex = html.indexOf('href="/css/mobile.css"');
    const typographyIndex = html.indexOf('href="/css/site-typography.css"');

    assert.ok(tokenIndex >= 0 && tokenIndex < transitionIndex, `${name}: tokens must precede transitions`);
    assert.ok(transitionIndex < detailIndex && detailIndex < mobileIndex, `${name}: painting CSS load order is wrong`);
    assert.ok(mobileIndex < typographyIndex, `${name}: typography must remain the final shared layer`);
    assert.match(html, new RegExp(`<body[^>]*class="painting-detail-page"[^>]*--painting-frame-max-width:${width.replace(".", "\\.")}`));
    assert.doesNotMatch(html, /<style>/i, `${name}: duplicated inline CSS remains`);
    assert.doesNotMatch(html, /class="grain"/i, `${name}: full-screen grain remains`);
    assert.match(html, /data-art-field="primary-image"/);
    assert.match(html, /data-art-field="availability-badge"/);
    assert.match(html, /data-art-field="title"/);
    assert.match(html, /data-art-meta/);
    assert.match(html, /data-art-field="statement"/);
    assert.match(html, /data-art-original-row[^>]*data-original-state=/);
    assert.match(html, /data-art-original-status/);
    assert.match(html, /data-art-original-action/);
    assert.match(html, /data-art-print-row/);
    assert.match(html, /data-art-print-status/);
    assert.match(html, /data-art-print-action/);
    assert.match(renderedHtml, /data-legacy-connections/, `${name}: Connections host is commented out`);
    assert.match(html, /src="\/js\/art-detail-managed\.js"/);
    assert.doesNotMatch(renderedHtml, />\s*inquire\s*</i, `${name}: painting action still says inquire`);
    if (/data-original-state="available"/.test(renderedHtml)) {
      assert.match(renderedHtml, /data-art-original-action[^>]*>\s*acquire\s*</i, `${name}: available original must say acquire`);
    }
  }
});

test("shared painting CSS preserves intrinsic media and every managed state", () => {
  const css = readFileSync(join(ROOT, "css", "painting-detail.css"), "utf8");
  assert.match(css, /--painting-frame-max-width:\s*560px/);
  assert.match(css, /\.painting-frame img\s*\{[\s\S]*max-height:/);
  assert.doesNotMatch(css, /aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(css, /\.avail-row\s*\{[\s\S]*border-bottom:\s*5px/);
  assert.match(css, /--painting-node-light:\s*var\(--color-art-bright/);
  for (const selector of ["painting-badge", "venture-label", "avail-status\\.available"]) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*color:\\s*var\\(--painting-node-light\\)`, "s"));
  }
  assert.match(css, /\.avail-action,[\s\S]*?color:\s*var\(--painting-node-light\)/);
  assert.match(css, /\.avail-action,[\s\S]*?border:\s*5px solid var\(--painting-node\)/);
  for (const state of ["available", "sold", "not-for-sale", "unavailable", "coming-soon", "sold-out", "check-availability"]) {
    assert.match(css, new RegExp(`\\.avail-status\\.${state.replace("-", "\\-")}`), `missing ${state} CSS state`);
  }
  const mobile = css.slice(css.indexOf("@media (max-width: 700px)"), css.indexOf("@media (max-width: 380px)"));
  assert.match(mobile, /\.painting-detail-page \.avail-row\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.doesNotMatch(mobile, /\.painting-detail-page \.avail-row\s*\{[^}]*flex-direction:\s*column/);
});

test("managed original acquisition uses the painting-specific acquire label", () => {
  const source = readFileSync(join(ROOT, "js", "art-detail-managed.js"), "utf8");
  assert.match(source, /action:\s*"acquire"/);
  assert.doesNotMatch(source, /action:\s*"inquire"/);
  assert.match(source, /\/art\/acquisitioninquiry\.html\?work=/);
});

test("Lost Marbles keeps its preview, final related archive fallback, and natural title wrapping", () => {
  const html = readFileSync(join(ROOT, "art", "lostmarblespainting.html"), "utf8");
  const relatedStart = html.indexOf('<section class="related-block" data-legacy-connections>');
  const hoodie = html.indexOf('href="/merch/lostmarbles-hoodie.html"', relatedStart);
  const archive = html.indexOf('href="/archive/records/lostmarbles/"', relatedStart);

  assert.match(html, /title-preview-fbd19d/);
  assert.match(html, /Explore the record of this work\./);
  assert.match(html, /apparel · merch/);
  assert.match(html, /archive record · archive/);
  assert.match(html, /href="\/archive\/records\/lostmarbles\/"[\s\S]*data-archive-card-fallback/);
  assert.match(html, /related-media related-media--archive" aria-hidden="true">A</);
  assert.equal((html.match(/<section class="related-block"/g) || []).length, 1);
  assert.ok(relatedStart >= 0 && hoodie > relatedStart && archive > hoodie, "Archive fallback must be the final card in Related");
  assert.doesNotMatch(html, /painting-title[^>]*>[\s\S]*?<br/i);
});

test("shared connections render a published archive dossier as the final Related group, not a graph relationship", () => {
  const source = readFileSync(join(ROOT, "js", "construct-connections.js"), "utf8");

  assert.match(source, /function legacyArchiveCard\(host\)/);
  assert.match(source, /archiveFallback=legacyArchiveCard\(host\)/);
  assert.match(source, /archiveCard=payload\.archiveCard\|\|archiveFallback/);
  assert.match(source, /if\(!records\.length&&!archiveCard\)return host/);
  assert.match(source, /archiveGroup=group\("Archive",\[archiveCard\],payload\.entity\.node\.color\)/);
  assert.match(source, /archiveGroup\.classList\.add\("cc-group--archive"\)/);
  assert.match(source, /content\.appendChild\(archiveGroup\)/);
  assert.match(source, /entity\.entityType==="archive_dossier"[\s\S]*cc-card-media--monogram","A"/);
  assert.match(source, /\/api\/shop\/product\?handle=/);
  assert.match(source, /\/api\/legend\//);
  assert.match(source, /function addSymbol\(a,markup\)/);
  assert.match(source, /meta\.append\(el\("span","cc-badge",entity\.kindLabel\|\|entity\.entityType\.replaceAll\("_"," "\)\),el\("span","cc-badge",entity\.node\.name\)\)/);
  assert.doesNotMatch(source, /meta\.append\([^;]*entity\.state/);
  assert.match(source, /const mapView=map\(records,payload\.entity\)/);
  assert.doesNotMatch(source, /map\(\[\.\.\.records,\s*archiveCard\]/);
});

test("print state resolver covers intent, Shopify state, and failure fallbacks", async () => {
  const source = readFileSync(join(ROOT, "js", "art-detail-managed.js"), "utf8");
  class Anchor {}
  const context = {
    window: {},
    document: {},
    location: { pathname: "/not-a-managed-art-route" },
    fetch: async () => ({ ok: false }),
    HTMLAnchorElement: Anchor,
    URL,
    encodeURIComponent,
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  const resolve = context.window.ArtDetailManaged.resolvePrintState;
  const connection = { route: "/merch/example-print.html", shopifyHandle: "example-print" };
  const plain = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(resolve()), { state: "unavailable", label: "unavailable", action: "unavailable", href: "", disabled: true });
  assert.deepEqual(plain(resolve({ intent: "planned" })), { state: "coming-soon", label: "coming soon", action: "coming soon", href: "", disabled: true });
  assert.deepEqual(plain(resolve({ connection, product: { availableForSale: true } })), { state: "available", label: "available", action: "get a print", href: "/merch/example-print.html", disabled: false });
  assert.deepEqual(plain(resolve({ connection, product: { availableForSale: false } })), { state: "sold-out", label: "sold out", action: "view print", href: "/merch/example-print.html", disabled: false });
  assert.deepEqual(plain(resolve({ connection, shopifyFailed: true })), { state: "check-availability", label: "check availability", action: "view print", href: "/merch/example-print.html", disabled: false });
  assert.deepEqual(plain(resolve({ connection: { route: "", shopifyHandle: "" } })), { state: "unavailable", label: "unavailable", action: "unavailable", href: "", disabled: true });
});

test("Art print intent is managed and public connections expose one Shopify print", async () => {
  const database = migratedDatabase();
  const env = environment(database);

  const initial = await jsonResponse(await handleConstructApi(request("/api/art/lostmarbles"), env));
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.record.print_intent, "unavailable");
  const listing = await jsonResponse(await handleConstructApi(request("/api/art"), env));
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.records.find((record) => record.id === "art-marbles").print_intent, "unavailable");

  const planned = await jsonResponse(await handleConstructApi(request("/api/admin/art/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { print_intent: "planned" },
  }), env));
  assert.equal(planned.response.status, 200);
  assert.equal(planned.payload.record.print_intent, "planned");

  const invalid = await jsonResponse(await handleConstructApi(request("/api/admin/art/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { print_intent: "sometimes" },
  }), env));
  assert.equal(invalid.response.status, 400);

  const published = await jsonResponse(await handleConstructApi(request("/api/admin/relationships/connection-marbles-print-art", {
    method: "PATCH",
    admin: true,
    body: { public_visible: true },
  }), env));
  assert.equal(published.response.status, 200);
  database.exec(`
    UPDATE entity_relationships SET public_visible=1 WHERE id='connection-marbles-hoodie-art';
    INSERT OR IGNORE INTO entity_relationships
      (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
    VALUES
      ('test-marbles-open-eye','art-marbles','fig-eye','rel-uses-symbol',1,'Test fixture.',3,'test',datetime('now'),datetime('now'));
  `);

  const connections = await jsonResponse(await handleConstructApi(request("/api/connections/art-marbles"), env));
  const print = connections.payload.records.find((record) => record.related.id === "merch-marbles-print");
  const hoodie = connections.payload.records.find((record) => record.related.id === "merch-lostmarbles-hoodie");
  const eye = connections.payload.records.find((record) => record.related.id === "fig-eye");
  assert.equal(print.related.shopifyHandle, "marbles-print");
  assert.equal(print.related.imageUrl, "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg");
  assert.equal(hoodie.related.imageUrl, "");
  assert.equal(hoodie.related.shopifyHandle, "lostmarbles-hoodie");
  assert.equal(eye.related.imageUrl, "");
  assert.match(eye.related.mediaMarkup, /^<svg/);
  assert.equal(connections.payload.archiveCard.label, "Archive record");
  assert.equal(connections.payload.archiveCard.related.title, "Explore the record of this work.");
  assert.equal(connections.payload.archiveCard.related.entityType, "archive_dossier");
  assert.equal(connections.payload.archiveCard.related.route, "/archive/records/lostmarbles/");
  assert.equal(connections.payload.archiveCard.related.node.id, "node-archive");
  assert.equal(connections.payload.cardCount, connections.payload.count + 1);
  assert.equal(connections.payload.records.some((record) => record.related.entityType === "archive_dossier"), false);

  const archiveOnly = await jsonResponse(await handleConstructApi(request("/api/connections/art-lust"), env));
  assert.equal(archiveOnly.response.status, 200);
  assert.equal(archiveOnly.payload.records.length, 0);
  assert.equal(archiveOnly.payload.archiveCard.related.route, "/archive/records/lust/");
  assert.equal(archiveOnly.payload.cardCount, 1);

  database.exec("UPDATE archive_dossiers SET public_visible=0 WHERE entity_id='art-lust'");
  const privateArchive = await jsonResponse(await handleConstructApi(request("/api/connections/art-lust"), env));
  assert.equal(privateArchive.response.status, 200);
  assert.equal(privateArchive.payload.archiveCard, null);
  assert.equal(privateArchive.payload.cardCount, 0);

  database.exec(`
    INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES('merch-second-print','merch_item','node-merch','public',1,'test','test',datetime('now'),datetime('now'));
    INSERT INTO merch_items(id,shopify_handle,title,product_type,state,route,image_url,alt_text,sort_order,created_at,updated_at)
    VALUES('merch-second-print','second-print','Second Print','print','published','/merch/second-print.html','','',99,datetime('now'),datetime('now'));
  `);
  const second = await jsonResponse(await handleConstructApi(request("/api/admin/relationships", {
    method: "POST",
    admin: true,
    body: {
      source_entity_id: "merch-second-print",
      target_entity_id: "art-marbles",
      relationship_type_id: "rel-derived-from",
      public_visible: true,
    },
  }), env));
  assert.equal(second.response.status, 409);
  assert.match(second.payload.error, /only one public print product/i);
});

test("Studio exposes the print plan selector without claiming inventory ownership", () => {
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  assert.match(studio, /"print_intent"/);
  assert.match(studio, /\["unavailable","Unavailable"\]/);
  assert.match(studio, /\["planned","Future print planned"\]/);
  assert.match(studio, /Shopify availability/);
});
