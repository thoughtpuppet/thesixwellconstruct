import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

const EXPECTED_IDENTITIES = [
  {
    id: "identity-thoughtpuppet",
    slug: "thoughtpuppet",
    name: "ThoughtPuppet",
    route: "/about/legend/?symbol=thoughtpuppet",
    sourceRoute: "/art/",
  },
  {
    id: "identity-six-well",
    slug: "six-well",
    name: "Six.Well",
    route: "/about/legend/?symbol=six-well",
    sourceRoute: "/merch/",
  },
  {
    id: "identity-art-pill-tattoo-house",
    slug: "art-pill-tattoo-house",
    name: "Art.Pill Tattoo House",
    route: "/about/legend/?symbol=art-pill-tattoo-house",
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

test("identity marks are published as managed Legend cards", () => {
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
    assert.deepEqual(JSON.parse(symbol.examples_json).map((example) => example.href), [expected.sourceRoute]);
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

  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("bundled Legend fallback mirrors the managed Identity records", () => {
  const fallback = JSON.parse(source("assets/build/symbols.json"));
  const legendCatalog = source("js/legend-catalog.js");

  for (const expected of EXPECTED_IDENTITIES) {
    const symbol = fallback.symbols.find((record) => record.id === expected.id);
    assert.ok(symbol, `${expected.name} must exist in the bundled Legend fallback`);
    assert.equal(symbol.slug, expected.slug);
    assert.equal(symbol.category, "Identity");
    assert.match(symbol.svg, /currentColor/);
    assert.deepEqual(symbol.examples.map((example) => example.href), [expected.sourceRoute]);
  }

  assert.match(legendCatalog, /searchParams\.get\("symbol"\)/);
  assert.match(legendCatalog, /record\.slug \|\| record\.id/);
  assert.match(legendCatalog, /openSymbol\(selectedRecord,\s*\{\s*push:\s*false/);
});
