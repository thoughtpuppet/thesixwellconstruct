import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

const EXPECTED_IDENTITIES = [
  {
    id: "identity-thoughtpuppet",
    slug: "thoughtpuppet",
    name: "ThoughtPuppet",
    route: "/about/legend/thoughtpuppet/",
    sourceRoute: "/art/",
  },
  {
    id: "identity-six-well",
    slug: "six-well",
    name: "Six.Well",
    route: "/about/legend/six-well/",
    sourceRoute: "/merch/",
  },
  {
    id: "identity-art-pill-tattoo-house",
    slug: "art-pill-tattoo-house",
    name: "Art.Pill Tattoo House",
    route: "/about/legend/art-pill-tattoo-house/",
    sourceRoute: "/tattoos/",
  },
];

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = path.join(ROOT, "migrations");
  for (const migration of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(path.join(migrationDirectory, migration), "utf8"));
  }
  return database;
}

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { this.database.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; } catch (error) { this.database.exec("ROLLBACK"); throw error; } }
}

test("identity marks are published as managed Legend cards while staged history stays private", async () => {
  const database = migratedDatabase();
  const category = database.prepare(
    "SELECT id,name,slug,state,sort_order FROM visual_symbol_categories WHERE id='identity'",
  ).get();

  assert.deepEqual({ ...category }, {
    id: "identity",
    name: "Identity",
    slug: "identity",
    state: "published",
    sort_order: 4,
  });

  for (const expected of EXPECTED_IDENTITIES) {
    const symbol = database.prepare(
      `SELECT id,category_id,slug,name,meaning,svg_markup,themes_json,examples_json,state
       FROM visual_symbols WHERE id=?`,
    ).get(expected.id);
    const entity = database.prepare(
      "SELECT entity_type,node_id,visibility,search_visibility FROM content_entities WHERE id=?",
    ).get(expected.id);
    const search = database.prepare(
      "SELECT route,state,collection_labels FROM search_documents WHERE entity_id=?",
    ).get(expected.id);

    assert.equal(symbol.category_id, "identity");
    assert.equal(symbol.slug, expected.slug);
    assert.equal(symbol.name, expected.name);
    assert.equal(symbol.state, "published");
    assert.match(symbol.meaning, /\S/);
    assert.match(symbol.svg_markup, /currentColor/);
    const rawExamples = JSON.parse(symbol.examples_json);
    assert.deepEqual(rawExamples.map((example) => example.href), [expected.sourceRoute]);
    if (expected.id === "identity-thoughtpuppet") {
      assert.equal(JSON.parse(database.prepare("SELECT variants_json FROM visual_symbols WHERE id=?").get(expected.id).variants_json)
        .some((entry) => entry.record_entity_id === "archive-record-thought-puppet-puppet-thoughts"), false);
      const stagedVariant = database.prepare("SELECT * FROM visual_symbol_archive_appearances WHERE id=?").get("legend-appearance-thoughtpuppet-early-puppet");
      assert.equal(stagedVariant.title, "Early puppet character / class-project identity");
      assert.equal(stagedVariant.publication_state, "draft");
      assert.equal(stagedVariant.public_visible, 0);
    }
    if (expected.id === "identity-six-well") {
      assert.equal(rawExamples.some((entry) => entry.record_entity_id === "archive-record-thought-puppet-puppet-thoughts"), false);
      const stagedCover = database.prepare("SELECT * FROM visual_symbol_archive_appearances WHERE id=?").get("legend-appearance-six-well-cover-signature");
      assert.equal(stagedCover.publication_state, "draft");
      assert.equal(stagedCover.public_visible, 0);
    }
    assert.deepEqual({ ...entity }, {
      entity_type: "visual_symbol",
      node_id: "node-legend",
      visibility: "public",
      search_visibility: 1,
    });
    assert.deepEqual({ ...search }, {
      route: expected.route,
      state: "published",
      collection_labels: "Identity",
    });
  }

  for (const slug of ["thoughtpuppet", "six-well"]) {
    const response = await handleConstructApi(new Request(`https://example.test/api/legend/${slug}`), { SUBMISSIONS_DB: new LocalD1(database) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const publicRecord = payload.record || payload.records?.[0];
    assert.ok(publicRecord);
    assert.equal(publicRecord.examples.some((entry) => entry.record_entity_id === "archive-record-thought-puppet-puppet-thoughts"), false);
    assert.equal(publicRecord.examples.some((entry) => entry.href === "/about/identities/thoughtpuppet/" || entry.href === "/archive/timelines/thoughtpuppet/"), false);
    assert.equal(publicRecord.variants.some((entry) => entry.record_entity_id === "archive-record-thought-puppet-puppet-thoughts"), false);
    assert.deepEqual(publicRecord.archive_appearances, []);
  }

  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("bundled Legend fallback mirrors the managed Identity records", () => {
  const fallback = JSON.parse(source("assets/build/symbols.json"));
  const legendCatalog = source("js/legend-catalog.js");
  const legendView = source("js/legend-record-view.js");

  for (const expected of EXPECTED_IDENTITIES) {
    const symbol = fallback.symbols.find((record) => record.id === expected.id);
    assert.ok(symbol, `${expected.name} must exist in the bundled Legend fallback`);
    assert.equal(symbol.slug, expected.slug);
    assert.equal(symbol.category, "Identity");
    assert.match(symbol.svg, /currentColor/);
    assert.deepEqual(symbol.examples.map((example) => example.href), [expected.sourceRoute]);
  }

  assert.match(legendCatalog, /legend\.canonicalRoute\(record\)/);
  assert.match(legendView, /\/about\/legend\/\$\{encodeURIComponent\(record\?\.slug \|\| record\?\.id \|\| ""\)\}\//);
  assert.doesNotMatch(legendCatalog, /searchParams|pushState|popstate/);
});
