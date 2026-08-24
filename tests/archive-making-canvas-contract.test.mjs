import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "making-canvas-test-token";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first(column) { const row = this.database.prepare(this.sql).get(...this.values); return column && row ? row[column] : row || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql")).sort()) db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  return db;
}

function request(path, { method = "GET", body, admin = false } = {}) {
  return new Request(`https://example.test${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function response(path, options) {
  const db = database();
  const result = await handleConstructApi(request(path, options), { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN });
  return { db, result, payload: await result.json() };
}

function source(...parts) { return readFileSync(join(ROOT, ...parts), "utf8"); }
function sha256(...parts) { return crypto.createHash("sha256").update(readFileSync(join(ROOT, ...parts))).digest("hex"); }

test("migration creates one canonical origin painting, one practice record, and one public relationship", () => {
  const db = database();
  const art = db.prepare("SELECT * FROM art_works WHERE id='art-personification-of-truth'").get();
  assert.equal(art.title, "THE PERSONIFICATION OF TRUTH.");
  assert.equal(art.year, "2016");
  assert.equal(art.medium, "Acrylic on wood panel");
  assert.equal(art.dimensions, "37 × 47½ inches");
  assert.equal(art.availability, "unavailable");
  assert.equal(art.whereabouts_status, "unknown");
  assert.equal(art.acquisition_eligible, 0);
  assert.equal(art.print_intent, "unavailable");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM art_works WHERE slug='the-personification-of-truth'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM entity_media WHERE entity_id='art-personification-of-truth'").get().count, 1);

  const practice = db.prepare("SELECT * FROM archive_records WHERE id='archive-practice-making-the-canvas'").get();
  const sections = JSON.parse(practice.practice_sections_json);
  assert.equal(practice.record_type, "practice");
  assert.equal(practice.state, "published");
  assert.equal(sections.length, 8);
  assert.deepEqual(sections.map((section) => section.id), ["origin","why-wood","dimensions","construction","shellac","imperfections","impermanence","hidden-labor"]);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT media_id) count FROM entity_media WHERE entity_id='archive-practice-making-the-canvas'").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE source_entity_id='art-personification-of-truth' AND target_entity_id='archive-practice-making-the-canvas' AND relationship_type_id='rel-documented-by' AND public_visible=1").get().count, 1);
  assert.equal(db.prepare("SELECT route FROM search_documents WHERE entity_id='archive-practice-making-the-canvas'").get().route, "/archive/art/making-the-canvas/");
});

test("public APIs expose structured practice, unknown whereabouts, and the canonical origin relationship", async () => {
  const db = database();
  const env = { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
  const artResponse = await handleConstructApi(request("/api/art/the-personification-of-truth"), env);
  const artPayload = await artResponse.json();
  assert.equal(artResponse.status, 200);
  assert.equal(artPayload.record.whereabouts_status, "unknown");
  assert.equal(artPayload.record.canonicalRoute, "/art/the-personification-of-truth/");
  assert.equal(artPayload.record.media[0].id, "media-art-personification-of-truth");

  const archiveResponse = await handleConstructApi(request("/api/archive/making-the-canvas"), env);
  const archivePayload = await archiveResponse.json();
  assert.equal(archiveResponse.status, 200);
  assert.equal(archivePayload.record.canonicalRoute, "/archive/art/making-the-canvas/");
  assert.equal(archivePayload.record.practiceSections.length, 8);
  assert.equal(archivePayload.record.practice_sections_json, undefined);
  assert.deepEqual(archivePayload.record.media.map((media) => media.role), ["primary", "process-video"]);

  const connectionsResponse = await handleConstructApi(request("/api/connections/archive-practice-making-the-canvas"), env);
  const connections = await connectionsResponse.json();
  const origin = connections.records.find((item) => item.relationshipType.slug === "documented-by");
  assert.equal(origin.label, "Documents");
  assert.equal(origin.related.id, "art-personification-of-truth");
  assert.equal(origin.related.route, "/art/the-personification-of-truth/");

  const acquisitionResponse = await handleConstructApi(request("/api/art?acquisition=1"), env);
  const acquisition = await acquisitionResponse.json();
  assert.equal(acquisition.records.some((record) => record.id === "art-personification-of-truth"), false);
});

test("Studio derives practice search text and protects the published primary photograph", async () => {
  const db = database();
  const env = { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
  const sections = [{ id: "test-section", eyebrow: "01 · Test", title: "Derived body", body: "This text is authoritative.", mediaRole: "" }];
  const update = await handleConstructApi(request("/api/admin/archive/archive-practice-making-the-canvas", { method: "PATCH", admin: true, body: { practice_sections_json: sections, state: "published" } }), env);
  assert.equal(update.status, 200);
  assert.equal(db.prepare("SELECT body FROM archive_records WHERE id='archive-practice-making-the-canvas'").get().body, "This text is authoritative.");
  assert.equal(db.prepare("SELECT body FROM search_documents WHERE entity_id='archive-practice-making-the-canvas'").get().body, "This text is authoritative.");

  const remove = await handleConstructApi(request("/api/admin/entities/archive-practice-making-the-canvas/media/media-making-canvas-shellacked-panels", { method: "DELETE", admin: true }), env);
  assert.equal(remove.status, 409);
  assert.match((await remove.json()).error, /primary photograph/i);
});

test("page shells, discovery bands, Studio controls, and media files preserve the public contract", () => {
  const page = source("archive", "art", "making-the-canvas", "index.html");
  const pageCss = source("css", "archive-practice.css");
  const pageJs = source("js", "archive-practice.js");
  const room = source("archive", "art", "index.html");
  const artIndex = source("art", "index.html");
  const studio = source("studio", "construct-manager.js");

  assert.match(page, /data-practice-record="making-the-canvas"/);
  assert.match(page, /class="hero-descriptor"/);
  assert.match(page, /href="\/archive\/art\/"/);
  assert.doesNotMatch(page, /class="(?:venture-)?grain"/);
  assert.match(pageCss, /background:\s*var\(--color-bg\)/);
  assert.match(pageCss, /--practice-rule:\s*5px/);
  assert.match(pageJs, /video\.controls\s*=\s*true/);
  assert.match(pageJs, /video\.playsInline\s*=\s*true/);
  assert.match(pageJs, /video\.preload\s*=\s*"metadata"/);
  assert.doesNotMatch(pageJs, /autoplay/i);
  assert.ok(artIndex.indexOf("data-practice-feature") < artIndex.indexOf('id="filters"'));
  assert.match(room, /data-practice-feature/);
  assert.doesNotMatch(room, /archive-room-records\.js/);
  assert.match(studio, /data-practice-sections-panel/);
  assert.match(studio, /data-practice-media-panel/);
  assert.match(studio, /StudioResumableMedia/);

  assert.equal(sha256("assets", "paintings", "the-personification-of-truth.jpg"), "113647ea0b895903f1773bf96fe2abd6eb04f4fdb9f23bb7e37874d710492c6a");
  assert.equal(sha256("assets", "archive", "making-the-canvas", "shellacked-panels.png"), "8170aba302417deb5510371bd5974e7039f6b07ea8ab8d9e0c21aaacfc06b67d");
  const video = readFileSync(join(ROOT, "assets", "archive", "making-the-canvas", "shellacking-panels.mp4"));
  assert.ok(video.length < 25 * 1024 * 1024, "video must remain within the Workers Assets per-file limit");
  assert.equal(crypto.createHash("sha256").update(video).digest("hex"), "aa99cc166aaf528ccb96fbf5ffed677e45fd64bfebc1fc6a2532523fc451d2f4");
  assert.ok(video.indexOf(Buffer.from("moov")) < video.indexOf(Buffer.from("mdat")), "video metadata must precede media data for fast start");
});
