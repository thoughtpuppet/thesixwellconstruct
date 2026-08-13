import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../_worker.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
const APPLE_ID = "visual_symbol-58d5bf98-9908-4191-9ee2-b82d67dba260";
const APPLE_MEDIA_ID = "media-35a3c693-2ca3-45b9-af94-6d92cb5ef046";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  batch(statements) {
    return statements.map((statement) => statement.run());
  }
}

function appleFallbackRecord() {
  const fallback = JSON.parse(source("assets/build/symbols.json"));
  return fallback.symbols.find((symbol) => symbol.id === APPLE_ID);
}

function databaseWithStudioApple() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(source(path.join("migrations", migration)));
  }

  const apple = appleFallbackRecord();
  database.prepare(
    `INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
     VALUES (?,'visual_symbol','node-legend','public',1,datetime('now'),'studio','studio',datetime('now'),datetime('now'))`,
  ).run(APPLE_ID);
  database.prepare(
    `INSERT INTO visual_symbols
      (id,category_id,slug,name,meaning,svg_markup,image_url,themes_json,context_json,applications_json,variants_json,examples_json,build_guidance_json,state,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'',?,?,?,?,?,?,'published',0,datetime('now'),datetime('now'))`,
  ).run(
    APPLE_ID,
    "ritual",
    apple.slug,
    apple.name,
    apple.meaning,
    apple.svg,
    JSON.stringify(apple.themes),
    JSON.stringify(apple.context),
    JSON.stringify(apple.applications),
    JSON.stringify([]),
    JSON.stringify(apple.examples),
    JSON.stringify({
      essence: apple.buildGuidance.essence,
      emotional_tones: apple.buildGuidance.emotionalTones,
      reflection_questions: apple.buildGuidance.reflectionQuestions,
    }),
  );
  database.prepare(
    `INSERT INTO media_assets
      (id,storage_key,original_filename,mime_type,alt_text,privacy,state,created_by,created_at,updated_at)
     VALUES (?,'legend/apple-colored.png','apple-colored.png','image/png','Colored Apple Vector variant','public','active','studio',datetime('now'),datetime('now'))`,
  ).run(APPLE_MEDIA_ID);
  database.prepare(
    `INSERT INTO entity_media
      (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
     VALUES (?,?,'legend-variant',0,1,'Apple — Colored Apple Vector variant','',datetime('now'))`,
  ).run(APPLE_ID, APPLE_MEDIA_ID);
  return database;
}

function apiEnv(database) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: "test-token",
  };
}

test("bundled Apple record mirrors the existing published Ritual identity", () => {
  const apple = appleFallbackRecord();
  const artwork = source("assets/legend/apple.svg");

  assert.ok(apple);
  assert.equal(apple.id, APPLE_ID);
  assert.equal(apple.slug, "apple");
  assert.equal(apple.category, "Ritual");
  assert.equal(apple.name, "Apple");
  assert.match(apple.meaning, /Fruitful knowledge at the edge of permission/);
  assert.match(apple.meaning, /curiosity/);
  assert.match(apple.meaning, /forbidden inquiry/);
  assert.deepEqual(apple.themes, ["knowledge", "curiosity", "inquiry", "temptation", "consequence"]);
  assert.match(apple.context.cultural_context, /nourishment/);
  assert.match(apple.context.overlap_or_tension, /Fruitfulness and prohibition/);
  assert.deepEqual(apple.applications.map((entry) => entry.title), ["Fruit and seed", "At the boundary"]);
  assert.equal(apple.buildGuidance.essence, "Fruitful knowledge at the edge of permission.");

  assert.match(artwork, /viewBox="0 0 120 120"/);
  assert.match(artwork, /stroke="currentColor"/);
  assert.match(artwork, /M62\.7,43c-11-9/);
  assert.doesNotMatch(artwork, /<\?xml|<!--|<defs\b|<style\b|class=|#[0-9a-f]{3,8}/i);
  assert.match(apple.svg, /stroke='currentColor'/);
  assert.match(apple.svg, /M62\.7,43c-11-9/);
});

test("Studio and public Legend APIs render the existing Apple record and preserve its variant", async () => {
  const database = databaseWithStudioApple();
  const env = apiEnv(database);

  const studioResponse = await handleConstructApi(
    new Request("https://example.test/api/admin/legend", {
      headers: { authorization: "Bearer test-token" },
    }),
    env,
  );
  const studioPayload = await studioResponse.json();
  const studioRecord = studioPayload.records.find((record) => record.id === APPLE_ID);
  assert.equal(studioResponse.status, 200);
  assert.ok(studioRecord);
  assert.equal(studioRecord.category_id, "ritual");
  assert.equal(studioRecord.state, "published");
  assert.deepEqual(JSON.parse(studioRecord.applications_json).map((entry) => entry.title), ["Fruit and seed", "At the boundary"]);

  const publicResponse = await handleConstructApi(
    new Request("https://example.test/api/legend/apple"),
    env,
  );
  const payload = await publicResponse.json();
  assert.equal(publicResponse.status, 200);
  assert.equal(payload.record.id, APPLE_ID);
  assert.equal(payload.record.canonicalRoute, "/about/legend/apple/");
  assert.equal(payload.category.name, "Ritual");
  assert.equal(payload.record.media.length, 1);
  assert.equal(payload.record.media[0].id, APPLE_MEDIA_ID);
  assert.equal(payload.record.media[0].role, "legend-variant");
  assert.equal(payload.record.media[0].alt, "Apple — Colored Apple Vector variant");
  assert.deepEqual(payload.record.applications.map((entry) => entry.title), ["Fruit and seed", "At the boundary"]);
  assert.equal(payload.record.buildGuidance.essence, "Fruitful knowledge at the edge of permission.");

  const manager = source("studio/construct-manager.js");
  const renderer = source("js/legend-record-view.js");
  assert.match(manager, /symbols:\{endpoint:"legend"[\s\S]*symbolEditor:true/);
  assert.match(manager, /safeSvgMarkup\(record\.svg_markup\)/);
  assert.match(renderer, /safeSvg\(record\.svg_markup\)/);
  assert.match(renderer, /renderInfluence\(layers\.context\)/);
  assert.match(renderer, /renderApplications\(layers\.applications\)/);
});

test("Apple canonical page follows the existing public About gate", async () => {
  const database = databaseWithStudioApple();
  const detail = source("about/legend/detail/index.html");
  const env = {
    ...apiEnv(database),
    PUBLIC_SITE_URL: "https://thesixwellconstruct.com",
    ASSETS: {
      async fetch() {
        return new Response(detail, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };

  const response = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/apple/"),
    env,
    { waitUntil() {} },
  );

  if (response.status === 302) {
    assert.equal(response.headers.get("location"), "https://thesixwellconstruct.com/404.html");
    return;
  }

  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title data-legend-record-title>Apple/);
  assert.match(html, /rel="canonical" href="https:\/\/thesixwellconstruct\.com\/about\/legend\/apple\/"/);
  assert.match(html, /"canonicalRoute":"\/about\/legend\/apple\/"/);
  assert.match(html, /Fruitful knowledge at the edge of permission/);
  assert.match(html, /\\u003csvg/);
});
