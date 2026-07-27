import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

const EYES = [
  {
    id: "fig-eye",
    slug: "open-eye",
    name: "OPEN EYE",
    asset: "assets/eyes/openeye.svg",
    viewBox: "0 0 701.8 517.37",
    signature: "M650.76,179.96",
    variant: "Open-eye Watchers SVG",
  },
  {
    id: "visual_symbol-833811ac-a67e-48af-8256-1b1a165ce909",
    slug: "closed-eye",
    name: "CLOSED EYE",
    asset: "assets/eyes/closedeye.svg",
    viewBox: "0 0 703.17 518.08",
    signature: "M698.82,366.1",
    variant: "Closed-eye Watchers SVG",
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

test("open and closed eyes use the supplied Illustrator SVGs as canonical Legend artwork", () => {
  const database = migratedDatabase();

  for (const expected of EYES) {
    const record = database.prepare(
      `SELECT id,slug,name,image_url,svg_markup,variants_json,examples_json,state
       FROM visual_symbols WHERE id=?`,
    ).get(expected.id);
    const variants = JSON.parse(record.variants_json);

    assert.equal(record.slug, expected.slug);
    assert.equal(record.name, expected.name);
    assert.equal(record.image_url, "");
    assert.match(record.svg_markup, new RegExp(`viewBox=["']${expected.viewBox.replaceAll(".", "\\.")}["']`));
    assert.match(record.svg_markup, /fill=["']currentColor["']/);
    assert.match(record.svg_markup, new RegExp(expected.signature.replaceAll(".", "\\.")));
    assert.equal(record.state, "published");
    assert.deepEqual(JSON.parse(record.examples_json), []);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].name, expected.variant);
    assert.equal(variants[0].style, "Animation source");
    assert.match(variants[0].note, /Watchers animation on the home page/);
    assert.match(variants[0].svg_markup, /<svg[\s\S]*currentColor/);
    assert.equal(variants[0].href, "/home/");
  }

  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("cleaned SVG assets preserve the Illustrator geometry and inherit their display color", () => {
  for (const expected of EYES) {
    const artwork = source(expected.asset);
    assert.match(artwork, new RegExp(`viewBox=["']${expected.viewBox.replaceAll(".", "\\.")}["']`));
    assert.match(artwork, /fill=["']currentColor["']/);
    assert.match(artwork, new RegExp(expected.signature.replaceAll(".", "\\.")));
    assert.doesNotMatch(artwork, /#[0-9a-f]{3,8}|<style\b|class=/i);
  }
});

test("bundled Build data mirrors the canonical SVGs and Watchers variants", () => {
  const fallback = JSON.parse(source("assets/build/symbols.json"));

  for (const expected of EYES) {
    const record = fallback.symbols.find((symbol) => symbol.id === expected.id);
    assert.ok(record, `${expected.name} must exist in the bundled Legend fallback`);
    assert.equal(record.slug, expected.slug);
    assert.match(record.svg, new RegExp(`viewBox=["']${expected.viewBox.replaceAll(".", "\\.")}["']`));
    assert.match(record.svg, /currentColor/);
    assert.match(record.svg, new RegExp(expected.signature.replaceAll(".", "\\.")));
    assert.equal(record.variants[0].name, expected.variant);
    assert.match(record.variants[0].svg_markup, /<svg[\s\S]*currentColor/);
    assert.equal(record.variants[0].href, "/home/");
  }
});

test("Legend surfaces render canonical inline SVGs and linked visual variants", () => {
  const legendCatalog = source("js/legend-catalog.js");
  const legendView = source("js/legend-record-view.js");
  const manager = source("studio/construct-manager.js");
  const home = source("home/index.html");

  assert.match(legendCatalog, /legend\.safeSvg\(record\.svg_markup\)/);
  assert.match(legendView, /variant\.href/);
  assert.match(manager, /Related page/);
  assert.match(home, /function drawEyes/);
  assert.match(home, /eyeImg1/);
  assert.match(home, /eyeImg2/);
});
