import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
const PUZZLE_PATH = "M30 30H48C48 19 52 12 60 12S72 19 72 30H90V48C101 48 108 52 108 60S101 72 90 72V90H72C72 79 68 72 60 72S48 79 48 90H30V72C41 72 48 68 48 60S41 48 30 48V30Z";

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(source(path.join("migrations", migration)));
  }
  return database;
}

test("shared desktop and mobile navigation expose the canonical retry-puzzle mark", () => {
  const nav = source("js/construct-nav.js");
  const guide = source("tools/ui-guide.html");

  assert.match(nav, /className = 'cnav-item cnav-retry-item'/);
  assert.match(nav, /className = 'cnav-retry'/);
  assert.match(nav, /mRetry\.id = 'cnav-mobile-retry'/);
  assert.equal((nav.match(/setAttribute\('aria-label', 'Puzzle'\)/g) || []).length, 2);
  assert.ok((nav.match(/window\._constructFade\('\/'\)/g) || []).length >= 2);
  assert.ok((nav.match(/window\.location\.href = '\/'/g) || []).length >= 2);
  assert.match(nav, /nav\.appendChild\(retryItem\);\s*VENTURES\.forEach\(function\(v\)/);
  assert.ok(nav.indexOf("mScrim.appendChild(mRetry)") < nav.indexOf("mScrim.appendChild(mExplore)"));
  assert.match(nav, new RegExp(PUZZLE_PATH));
  assert.match(guide, /aria-label="Puzzle"/);
  assert.match(guide, new RegExp(PUZZLE_PATH));
});

test("the puzzle piece is a published managed MAZE Legend symbol and bundled fallback", () => {
  const database = migratedDatabase();
  const symbol = database.prepare(
    `SELECT id,category_id,slug,name,meaning,svg_markup,themes_json,examples_json,state,sort_order
     FROM visual_symbols WHERE id='maze-puzzle-piece'`,
  ).get();
  const entity = database.prepare(
    "SELECT entity_type,node_id,visibility,search_visibility FROM content_entities WHERE id='maze-puzzle-piece'",
  ).get();
  const search = database.prepare(
    "SELECT route,state,collection_labels FROM search_documents WHERE entity_id='maze-puzzle-piece'",
  ).get();
  const fallback = JSON.parse(source("assets/build/symbols.json"));
  const bundled = fallback.symbols.find((record) => record.id === "maze-puzzle-piece");

  assert.deepEqual({ ...entity }, {
    entity_type: "visual_symbol",
    node_id: "node-legend",
    visibility: "public",
    search_visibility: 1,
  });
  assert.equal(symbol.category_id, "maze");
  assert.equal(symbol.slug, "puzzle-piece");
  assert.equal(symbol.name, "The Puzzle Piece");
  assert.equal(symbol.state, "published");
  assert.equal(symbol.sort_order, 5);
  assert.deepEqual(JSON.parse(symbol.themes_json), ["return", "play", "discovery"]);
  assert.deepEqual(JSON.parse(symbol.examples_json).map((example) => example.href), ["/"]);
  assert.match(symbol.svg_markup, new RegExp(PUZZLE_PATH));
  assert.deepEqual({ ...search }, {
    route: "/about/legend/puzzle-piece/",
    state: "published",
    collection_labels: "MAZE",
  });
  assert.ok(bundled);
  assert.equal(bundled.slug, "puzzle-piece");
  assert.equal(bundled.category, "MAZE");
  assert.deepEqual(bundled.themes, ["return", "play", "discovery"]);
  assert.deepEqual(bundled.examples.map((example) => example.href), ["/"]);
  assert.match(bundled.svg, new RegExp(PUZZLE_PATH));
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});
