import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { handleMerchItem } from "../functions/api/merch/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "editorial-timeline-test";

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
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
  prepare(sql) { return new Statement(this.database, sql); }
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
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
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

async function json(response) { return { status: response.status, body: await response.json() }; }
function runtime(db) { return { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN }; }
function shopifyProduct(handle) { return { id: `gid://shopify/Product/${handle}`, handle, title: "Historical garment", tags: ["construct-merch"], productType: "apparel", availableForSale: true, featuredImage: { url: "https://cdn.example/garment.jpg", altText: "Garment" }, images: { nodes: [] }, options: [{ name: "Size", values: ["M"] }], priceRange: { minVariantPrice: { amount: "240.00", currencyCode: "USD" } }, variants: { nodes: [{ id: `gid://shopify/ProductVariant/${handle}`, title: "M", availableForSale: true, price: { amount: "240.00", currencyCode: "USD" }, image: null, selectedOptions: [{ name: "Size", value: "M" }] }] } }; }

test("editorial timelines are additive and the opening SIX.WELL edition stays flexibly ordered", async () => {
  const db = database();
  const standard = db.prepare("SELECT presentation_mode FROM archive_timelines WHERE id<>'archive-timeline-six-well-clothing' ORDER BY id LIMIT 1").get();
  assert.equal(standard.presentation_mode, "standard");

  const timeline = db.prepare("SELECT subject_entity_id,presentation_mode,state,public_visible FROM archive_timelines WHERE id='archive-timeline-six-well-clothing'").get();
  assert.deepEqual({ ...timeline }, { subject_entity_id: "org-six-well-clothing", presentation_mode: "editorial", state: "published", public_visible: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='org-six-well-clothing'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM about_identity_profiles WHERE organization_id='org-six-well-clothing'").get().count, 0, "the timeline must not invent a second brand identity");

  const acts = db.prepare("SELECT title,chapter_role,sort_order FROM archive_timeline_chapters WHERE timeline_id='archive-timeline-six-well-clothing' ORDER BY sort_order").all();
  assert.deepEqual(acts.map((act) => act.title), [
    "Before It Had a Name",
    "Clothing as Collective Installation",
    "Painting the Garment",
    "Learning to Repeat",
    "Moving the Image",
    "The Work in Circulation",
  ]);
  assert.ok(acts.every((act) => act.chapter_role === "act"));
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='archive_timeline_chapters'").get().sql, /six[- ]act|count\s*\([^)]*\)\s*=\s*6/i, "act count and order remain editable rather than structurally fixed");

  const response = await json(await handleConstructApi(request("/api/archive/timelines/six-well-clothing"), runtime(db)));
  assert.equal(response.status, 200);
  assert.equal(response.body.timeline.presentation_mode, "editorial");
  assert.equal(response.body.timeline.dossierRoute, "/archive/records/six-well-clothing-identity/");
  assert.equal(response.body.acts.length, 6);
  assert.equal(response.body.entries.length, 0, "editorial hydration does not alter the standard milestone response");
  assert.ok(response.body.acts.flatMap((act) => act.blocks).some((block) => block.blockType === "gallery-set"));
  assert.ok(response.body.acts.flatMap((act) => act.blocks).some((block) => block.evidenceStatus === "open-interval"));
  const transferAct = response.body.acts.find((act) => act.id === "six-well-act-transfer");
  const transferGalleryBlocks = transferAct.blocks.filter((block) => block.blockType === "gallery-set");
  assert.deepEqual(transferGalleryBlocks.map((block) => block.id), ["six-well-block-origin-diagram", "six-well-block-button-pattern-detail"]);
  assert.equal(transferGalleryBlocks[1].source_url, "/archive/records/the-personification-of-truth/");
  assert.equal(transferGalleryBlocks[1].citation_label, "Open THE PERSONIFICATION OF TRUTH. Archive record");
  assert.equal(transferGalleryBlocks[1].source.presentation_mode, "detail-crop");
  assert.equal(transferGalleryBlocks[1].source.presentation_zoom, 4);
  assert.equal(transferGalleryBlocks[1].source.presentation_focal_y, 0.88);
  assert.equal(transferGalleryBlocks[1].source.presentation_alt_text, "Close-up of the lower vest in THE PERSONIFICATION OF TRUTH., showing six painted buttons arranged in two columns and three rows.");
  assert.equal(transferGalleryBlocks[1].source.items[0].url, "/assets/paintings/the-personification-of-truth.jpg");
  assert.equal(JSON.stringify(response.body).includes("reflection_memory_note"), false);
  assert.equal(JSON.stringify(response.body).includes("archive-note-six-well-pattern-emergence"), false, "the draft Reflection is not hydrated publicly");
  const dossier = await json(await handleConstructApi(request("/api/archive/items/six-well-clothing-identity"), runtime(db)));
  assert.equal(dossier.status, 200, "the organization dossier is public through the editorial timeline without a duplicate identity profile");
  assert.ok(dossier.body.relationships.some((relationship) => relationship.label === "Derived from" && (relationship.related.entity_id || relationship.related.id) === "art-personification-of-truth" && relationship.related.archiveRoute === "/archive/records/the-personification-of-truth/"));

  const painting = await json(await handleConstructApi(request("/api/archive/items/the-personification-of-truth"), runtime(db)));
  assert.equal(painting.status, 200, "the canonical painting identity receives an Archive dossier rather than a duplicate entity");
  assert.match(painting.body.item.story, /extracted that arrangement from this painting and used it as the SIX\.WELL mark/);
  assert.ok(painting.body.relationships.some((relationship) => relationship.label === "Source for" && (relationship.related.entity_id || relationship.related.id) === "org-six-well-clothing" && relationship.related.archiveRoute === "/archive/records/six-well-clothing-identity/"), JSON.stringify(painting.body.relationships));
});

test("Reflection timing, public excerpts, and factual-history dates remain separate", async () => {
  const db = database();
  const note = db.prepare("SELECT source_created_at,is_reflection,reflected_on_start,reflected_on_precision,reflected_on_label,reflection_memory_note,state,public_visible FROM archive_notes WHERE entity_id='archive-note-six-well-pattern-emergence'").get();
  assert.equal(note.source_created_at, "2026-09-07");
  assert.equal(note.is_reflection, 1);
  assert.equal(note.reflected_on_start, null);
  assert.equal(note.reflected_on_precision, "undated");
  assert.match(note.reflected_on_label, /formation of SIX\.WELL CLOTHING/);
  assert.ok(note.reflection_memory_note.length > 0);
  assert.deepEqual([note.state, note.public_visible], ["draft", 0]);

  db.prepare("UPDATE archive_notes SET reflected_on_start='2018-01-01',reflected_on_precision='year',reflected_on_label='2018' WHERE entity_id='archive-note-six-well-pattern-emergence'").run();
  const suggested = await json(await handleConstructApi(request("/api/admin/archive-notes/archive-note-six-well-pattern-emergence/history-suggestions", {
    method: "POST",
    admin: true,
    body: { target_entity_id: "org-six-well-clothing" },
  }), runtime(db)));
  assert.equal(suggested.status, 201, suggested.body.error);
  assert.equal(suggested.body.record.occurred_at, "2018-01-01");
  assert.equal(suggested.body.record.date_precision, "year");
  assert.notEqual(suggested.body.record.occurred_at, note.source_created_at);
  assert.equal(suggested.body.record.status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM entity_activity WHERE entity_id='org-six-well-clothing'").get().count, 0);
});

test("historical sale objects and permanent garments preserve one identity across timelines", async () => {
  const db = database();
  const merchColumns = new Set(db.prepare("PRAGMA table_info(merch_items)").all().map((column) => column.name));
  for (const name of ["merch_context", "item_size", "colorway", "technique", "period_label", "condition_note", "provenance_summary", "internal_provenance", "historical_price_amount"]) assert.ok(merchColumns.has(name));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM merch_items WHERE merch_context='from_archive'").get().count, 0, "no historic garment or price is invented by the migration");

  const collection = db.prepare("SELECT state FROM archive_collections WHERE id='archive-collection-permanent-garments'").get();
  assert.equal(collection.state, "published");
  const itemColumns = new Set(db.prepare("PRAGMA table_info(archive_collection_items)").all().map((column) => column.name));
  for (const name of ["entity_id", "collection_id", "media_id", "internal_provenance", "public_visible"]) assert.ok(itemColumns.has(name));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive_timeline_blocks'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_archive_timeline_blocks_source'").get(), "one object can be placed in multiple timelines without cloning it");
});

test("a one-of-one can appear in multiple timelines and remains sold even when Shopify reports inventory", async () => {
  const db = database();
  db.prepare(`UPDATE merch_items SET merch_context='from_archive',availability_state='sold_out',shopify_handle='maze-puffer-jacket',item_size='M',colorway='Black',technique='Transfer',period_label='Earlier period',condition_note='Worn',provenance_summary='Creator-held until offered.',historical_price_amount=12000,historical_price_currency='USD',historical_price_note='Documented receipt' WHERE id='merch-maze-puffer-jacket'`).run();
  const secondSubject = db.prepare("SELECT owner.id FROM content_entities owner WHERE owner.visibility='public' AND NOT EXISTS(SELECT 1 FROM archive_timelines timeline WHERE timeline.subject_entity_id=owner.id) ORDER BY owner.id LIMIT 1").get().id;
  db.prepare(`INSERT INTO archive_timelines(id,subject_entity_id,slug,title,description,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,presentation_mode) VALUES('archive-timeline-painting-practice',?,'painting-practice-test','Painting practice','Test timeline','published',1,30,'test','test',datetime('now'),datetime('now'),'editorial')`).run(secondSubject);
  const appRuntime = runtime(db);
  for (const [timelineId, chapterId] of [["archive-timeline-six-well-clothing", "six-well-act-circulation"], ["archive-timeline-painting-practice", null]]) {
    const result = await json(await handleConstructApi(request(`/api/admin/archive-timelines/${timelineId}/blocks`, { method: "POST", admin: true, body: { block_type: "merch-item", source_id: "merch-maze-puffer-jacket", chapter_id: chapterId, evidence_status: "documented", state: "published" } }), appRuntime));
    assert.equal(result.status, 201, result.body.error);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_timeline_blocks WHERE block_type='merch-item' AND source_id='merch-maze-puffer-jacket'").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM merch_items WHERE id='merch-maze-puffer-jacket'").get().count, 1);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { product: shopifyProduct("maze-puffer-jacket") } }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await handleMerchItem(request("/api/shop/items/maze-puffer-jacket"), { ...appRuntime, SHOPIFY_STORE_DOMAIN: "store.example", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "token", SHOPIFY_STOREFRONT_API_VERSION: "2025-07" }, "maze-puffer-jacket");
    const product = (await response.json()).product;
    assert.equal(product.fromArchive, true);
    assert.equal(product.availabilityState, "sold_out");
    assert.equal(product.availableForSale, false);
    assert.ok(product.variants.every((variant) => variant.availableForSale === false));
    assert.deepEqual(product.historicalPrice, { amount: 120, currencyCode: "USD" });
    assert.equal(product.timelineAssociations.length, 2);
    assert.deepEqual(new Set(product.timelineAssociations.map((timeline) => timeline.slug)), new Set(["six-well-clothing", "painting-practice-test"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public presentation keeps cinematic media bounded, accessible, and checkout-free", () => {
  const archive = readFileSync(join(ROOT, "js", "archive-public.js"), "utf8");
  const archiveCss = readFileSync(join(ROOT, "css", "archive-public.css"), "utf8");
  const merch = readFileSync(join(ROOT, "merch", "index.html"), "utf8");
  const studioNotes = readFileSync(join(ROOT, "studio", "archive-notes-manager.js"), "utf8");
  const studioTimeline = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const diagram = readFileSync(join(ROOT, "assets", "archive", "six-well-culture-plate-diagram.svg"), "utf8");

  assert.match(archive, /prefers-reduced-motion/);
  assert.match(archive, /playsinline/);
  assert.match(archive, /muted/);
  assert.doesNotMatch(archive, /add-to-cart|data-add/);
  assert.match(archiveCss, /border:5px/);
  assert.match(archiveCss, /background:var\(--color-bg\)/);
  assert.match(merch, />From the Archive</);
  assert.match(merch, /Temporary editorial image · MED-000056\. This image is not evidence for any individual garment/);
  assert.match(studioNotes, /Written in reflection \/ after the fact/);
  assert.match(studioTimeline, /open-interval/);
  assert.match(diagram, /stroke-width="5"/);
  assert.match(diagram, /PATTERN EXTRACTED/);
  assert.match(diagram, /FROM PAINTING/);
  assert.match(diagram, /<tspan/);
  assert.doesNotMatch(diagram, /PATTERN RECOGNIZED/);
  assert.match(diagram, /canonical logo is unchanged/i);
  assert.match(archive, /presentation_mode/);
  assert.match(archive, /is-detail-crop/);
  assert.match(archiveCss, /archive-editorial-detail-frame/);
  assert.match(archiveCss, /transform: scale\(var\(--editorial-detail-zoom\)\)/);
  assert.match(archiveCss, /transform-origin: var\(--editorial-detail-x\) var\(--editorial-detail-y\)/);
});
