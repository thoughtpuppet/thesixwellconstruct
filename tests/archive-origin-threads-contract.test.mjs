import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "archive-origin-test-token";

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
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function env(db) { return { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN }; }
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

test("homepage Archive pathways use seven Archive lenses with real destinations", async () => {
  const expected = [
    ["Records", "/archive/"],
    ["Collections", "/archive/collections/"],
    ["Origin Threads", "/archive/origin-threads/"],
    ["Making Practices", "/archive/?record_type=practice"],
    ["Colors & Materials", "/archive/colors-materials/"],
    ["Blackboards", "/archive/blackboards/"],
    ["Timelines", "/archive/timelines/"],
  ];
  const db = database();
  const pathways = db.prepare("SELECT name,route,color FROM construct_pathways WHERE node_id='node-archive' AND state='published' AND homepage_enabled=1 ORDER BY sort_order").all();
  assert.deepEqual(pathways.map(({ name, route }) => [name, route]), expected);
  assert.ok(pathways.every(({ color }) => color === "#6D3D15"));

  const home = readFileSync(join(ROOT, "home", "index.html"), "utf8");
  const navigation = readFileSync(join(ROOT, "js", "construct-nav.js"), "utf8");
  for (const [label, route] of expected) {
    assert.ok(home.includes(`name:'${label}',url:'${route}'`));
    assert.ok(navigation.includes(`['${label}', '${route}']`));
  }
  assert.match(readFileSync(join(ROOT, "archive", "origin-threads", "index.html"), "utf8"), /data-archive-view="origin-threads"/);

  const originResponse = await handleConstructApi(request("/api/archive/origin-threads"), env(db));
  assert.equal(originResponse.status, 200);
  const origins = await originResponse.json();
  assert.ok(origins.records.some((record) => record.slug === "lost-marbles" && record.route === "/archive/?origin=lost-marbles"));

  const timelineResponse = await handleConstructApi(request("/api/archive/timelines"), env(db));
  assert.equal(timelineResponse.status, 200);
  const timelines = await timelineResponse.json();
  assert.ok(timelines.records.some((record) => record.slug === "art" && record.route === "/archive/timelines/art/"));
});

test("Studio saves attached media eligibility before publishing an Archive material", () => {
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  assert.match(studio, /const publishingAttachedMedia=Boolean\(payload\.media_id&&payload\.state==="published"&&payload\.visibility==="public"\)/);
  assert.match(studio, /updateMediaMetadata:formData\.has\("update_media_metadata"\)\|\|publishingAttachedMedia/);
  assert.match(studio, /else if\(payload\.media_id&&updateMediaMetadata\)await archiveJson\(archiveEndpoints\.mediaItem\(payload\.media_id\),"PATCH",mediaPayload\);[\s\S]*await archiveJson\(id\?archiveEndpoints\.material/);
  assert.match(studio, /Shared Digital asset privacy<select name="media_privacy"/);
  assert.match(studio, /name="update_media_metadata"/);
  assert.match(studio, /form\.dataset\.digitalAssetControlsBound="true"/);
});

test("Lost Marbles origin thread returns its curated records and only approved evidence", async () => {
  const db = database();
  db.exec(`INSERT INTO archive_materials(id,dossier_entity_id,role,material_type,title,body,visibility,state,created_at,updated_at)
    VALUES('private-origin-note','art-marbles','reference','note','Private note','Never public','internal','draft',datetime('now'),datetime('now'));
    INSERT INTO archive_origin_thread_materials(thread_id,material_id,sort_order,created_at)
    VALUES('origin-thread-lost-marbles','private-origin-note',99,datetime('now'));`);

  const response = await handleConstructApi(request("/api/archive/items?origin=lost-marbles&from=art-marbles"), env(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.origin_thread.slug, "lost-marbles");
  assert.deepEqual(payload.items.map((item) => item.entity_id), ["art-marbles", "merch-lostmarbles-hoodie"]);
  assert.equal(payload.items[0].is_current, true);
  assert.equal(payload.current_record_position, 1);
  assert.ok(payload.evidence.every((item) => item.state === "published" && item.visibility === "public"));
  assert.ok(!payload.evidence.some((item) => item.id === "private-origin-note"));
});

test("Studio manages reusable assignments, one primary thread, and archival without deleting provenance", async () => {
  const db = database();
  const runtime = env(db);
  const created = await handleConstructApi(request("/api/admin/archive-origin-threads", { method: "POST", admin: true, body: { title: "Second source", slug: "second-source", summary: "A shared reference family.", state: "published", public_visible: true } }), runtime);
  assert.equal(created.status, 201);
  const thread = (await created.json()).record;

  const assigned = await handleConstructApi(request("/api/admin/entities/art-marbles/origin-threads", { method: "PUT", admin: true, body: { origin_thread_ids: ["origin-thread-lost-marbles", thread.id], primary_origin_thread_id: thread.id } }), runtime);
  assert.equal(assigned.status, 200);
  const entity = await assigned.json();
  assert.equal(entity.origin_thread_ids.length, 2);
  assert.equal(entity.primary_origin_thread_id, thread.id);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_origin_thread_entities WHERE entity_id='art-marbles' AND is_primary=1").get().count, 1);

  db.exec(`INSERT INTO content_entities(id,entity_type,node_id,visibility,created_at,updated_at)
    VALUES('origin-test-standalone','special_project','node-tattoos','internal',datetime('now'),datetime('now'))`);
  const standalone = await handleConstructApi(request("/api/admin/entities/origin-test-standalone/origin-threads", { method: "PUT", admin: true, body: { origin_thread_ids: [thread.id], primary_origin_thread_id: thread.id } }), runtime);
  assert.equal(standalone.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_origin_thread_entities WHERE entity_id='origin-test-standalone'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='origin-test-standalone'").get().count, 0);

  const archived = await handleConstructApi(request(`/api/admin/archive-origin-threads/${thread.id}`, { method: "DELETE", admin: true }), runtime);
  assert.equal(archived.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_origin_thread_entities WHERE thread_id=?").get(thread.id).count, 2);
  const retained = await handleConstructApi(request("/api/admin/entities/origin-test-standalone/origin-threads", { method: "PUT", admin: true, body: { origin_thread_ids: [], primary_origin_thread_id: "" } }), runtime);
  assert.equal(retained.status, 200);
  assert.deepEqual((await retained.json()).origin_thread_ids, [thread.id]);
  const hidden = await handleConstructApi(request("/api/archive/items?origin=second-source"), runtime);
  assert.equal(hidden.status, 404);
});

test("public Connections exposes published origin threads without turning them into graph edges", async () => {
  const db = database();
  const response = await handleConstructApi(request("/api/connections/art-marbles"), env(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.originThreads[0].slug, "lost-marbles");
  assert.equal(payload.originThreads[0].is_primary, 1);
  assert.equal(payload.count, payload.records.length);
  assert.equal(payload.cardCount, payload.records.length + payload.originThreads.length + Number(Boolean(payload.archiveCard)));
});
