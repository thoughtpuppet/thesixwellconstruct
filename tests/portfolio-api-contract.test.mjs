import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handlePortfolioApi } from "../functions/api/portfolio/_lib.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "portfolio-test-token";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
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

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const body = value instanceof ReadableStream
      ? await new Response(value).arrayBuffer()
      : value instanceof ArrayBuffer
        ? value
        : await new Response(value).arrayBuffer();
    this.objects.set(key, { body, options });
  }
  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Uint8Array(object.body),
      httpEtag: `"${key}"`,
      writeHttpMetadata(headers) {
        if (object.options.httpMetadata?.contentType) headers.set("content-type", object.options.httpMetadata.contentType);
        if (object.options.httpMetadata?.cacheControl) headers.set("cache-control", object.options.httpMetadata.cacheControl);
      },
    };
  }
  async delete(key) { this.objects.delete(key); }
}

function migratedDatabase({ before = "" } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const names = readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (before && name.localeCompare(before) >= 0) break;
    database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function env(database, bucket = null) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: TOKEN,
    ...(bucket ? { SUBMISSION_FILES: bucket } : {}),
  };
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

function insertPortfolioItem(database, {
  id,
  state = "draft",
  projectType = "standard",
  consent = "unknown",
  coverImageRef = "primary",
} = {}) {
  const visibility = state === "published" ? "public" : "internal";
  database.prepare(`
    INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES (?,'portfolio_item','node-tattoos',?,?, 'test','test',datetime('now'),datetime('now'))
  `).run(id, visibility, state === "published" ? 1 : 0);
  database.prepare(`
    INSERT INTO portfolio_items
      (id,storage_key,original_filename,content_type,title,alt_text,state,sort_order,
       cover_image_ref,project_type,primary_consent_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,?,?,?,datetime('now'),datetime('now'))
  `).run(id, `portfolio/${id}.jpg`, `${id}.jpg`, "image/jpeg", `Tattoo ${id}`, `Tattoo ${id}`, state, coverImageRef, projectType, consent);
  database.prepare(`
    INSERT INTO portfolio_image_details
      (portfolio_item_id,image_ref,healing_state,image_role,timing_note,caption,created_at,updated_at)
    VALUES (?,'primary','fresh','result','day of','Primary result',datetime('now'),datetime('now'))
  `).run(id);
}

function attachImage(database, itemId, {
  id,
  role = "result",
  consent = "unknown",
  privacy = "internal",
  publicVisible = false,
  healingState = "unspecified",
  state = "active",
  presentation = "inline",
} = {}) {
  database.prepare(`
    INSERT INTO media_assets
      (id,storage_key,original_filename,mime_type,alt_text,privacy,consent_status,state,created_by,created_at,updated_at,public_presentation)
    VALUES (?,?,?,?,?,?,?,?,'test',datetime('now'),datetime('now'),?)
  `).run(id, `construct/${id}.jpg`, `${id}.jpg`, "image/jpeg", `${role} photograph`, privacy, consent, state, presentation);
  database.prepare(`
    INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at)
    VALUES (?,?,'gallery',1,?,datetime('now'))
  `).run(itemId, id, publicVisible ? 1 : 0);
  database.prepare(`
    INSERT INTO portfolio_image_details
      (portfolio_item_id,image_ref,healing_state,image_role,timing_note,caption,created_at,updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(itemId, id, healingState, role, "", "");
}

test("cover-up migration preserves published work and keeps new drafts permission-gated", () => {
  const migration = "0044_portfolio_cover_up_documentation.sql";
  const database = migratedDatabase({ before: migration });
  const baseInsert = (id, state) => database.prepare(`
    INSERT INTO portfolio_items
      (id,storage_key,original_filename,content_type,title,alt_text,state,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))
  `).run(id, `portfolio/${id}.jpg`, `${id}.jpg`, "image/jpeg", id, id, state);
  baseInsert("legacy-published", "published");
  baseInsert("legacy-draft", "draft");
  for (const id of ["legacy-published", "legacy-draft"]) {
    database.prepare(`
      INSERT INTO portfolio_image_details
        (portfolio_item_id,image_ref,healing_state,timing_note,caption,created_at,updated_at)
      VALUES (?,'primary','unspecified','','',datetime('now'),datetime('now'))
    `).run(id);
  }
  database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));

  assert.deepEqual({ ...database.prepare(`
    SELECT project_type,primary_consent_status FROM portfolio_items WHERE id='legacy-published'
  `).get() }, { project_type: "standard", primary_consent_status: "granted" });
  assert.equal(database.prepare("SELECT primary_consent_status FROM portfolio_items WHERE id='legacy-draft'").get().primary_consent_status, "unknown");
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='legacy-published'").get().image_role, "result");
});

test("public portfolio exposes only permitted media while Studio retains private documentation", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "cover-public", state: "published", projectType: "cover_up", consent: "granted", coverImageRef: "result-public" });
  attachImage(database, "cover-public", { id: "result-public", role: "result", consent: "granted", privacy: "public", publicVisible: true, healingState: "healed" });
  attachImage(database, "cover-public", { id: "process-public", role: "process", consent: "not-required", privacy: "public", publicVisible: true });
  attachImage(database, "cover-public", { id: "before-private", role: "before", consent: "unknown", privacy: "internal", publicVisible: false });
  attachImage(database, "cover-public", { id: "before-denied", role: "before", consent: "denied", privacy: "public", publicVisible: true });
  attachImage(database, "cover-public", { id: "detail-hidden", role: "detail", consent: "granted", privacy: "public", publicVisible: true, presentation: "hidden" });
  attachImage(database, "cover-public", { id: "process-archived", role: "process", consent: "granted", privacy: "public", publicVisible: true, state: "archived" });

  const adminResponse = await handlePortfolioApi(request("/api/admin/portfolio", { admin: true }), env(database));
  assert.equal(adminResponse.status, 200);
  const adminItem = (await adminResponse.json()).items.find((item) => item.id === "cover-public");
  assert.equal(adminItem.projectType, "cover_up");
  assert.equal(adminItem.angles.find((image) => image.id === "before-private").consentStatus, "unknown");

  const publicResponse = await handlePortfolioApi(request("/api/portfolio/cover-public"), env(database));
  assert.equal(publicResponse.status, 200);
  const publicItem = (await publicResponse.json()).item;
  assert.equal(publicItem.projectType, "cover_up");
  assert.deepEqual(publicItem.angles.map((image) => image.id), ["result-public", "process-public"]);
  assert.equal(publicItem.angles[0].imageUrl, "/api/construct/entity-media/result-public");
  assert.equal("consentStatus" in publicItem.angles[0], false);

  const downgrade = await handlePortfolioApi(request("/api/admin/portfolio/cover-public/images/process-public", {
    method: "PATCH", admin: true, body: { imageRole: "process", healingState: "unspecified", consentStatus: "denied" },
  }), env(database));
  assert.equal(downgrade.status, 200);
  assert.deepEqual({ ...database.prepare("SELECT privacy,consent_status FROM media_assets WHERE id='process-public'").get() }, { privacy: "private", consent_status: "denied" });
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE media_id='process-public'").get().public_visible, 0);
  const filteredAgain = await handlePortfolioApi(request("/api/portfolio/cover-public"), env(database));
  assert.deepEqual((await filteredAgain.json()).item.angles.map((image) => image.id), ["result-public"]);

  const coverDowngrade = await handlePortfolioApi(request("/api/admin/portfolio/cover-public/images/result-public", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", consentStatus: "denied" },
  }), env(database));
  assert.equal(coverDowngrade.status, 409);
});

test("portfolio project, image-role, healing, and consent enums reject unknown values", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "enum-draft" });
  attachImage(database, "enum-draft", { id: "enum-image" });

  let response = await handlePortfolioApi(request("/api/admin/portfolio/enum-draft", {
    method: "PATCH", admin: true, body: { projectType: "restoration" },
  }), env(database));
  assert.equal(response.status, 422);

  for (const body of [
    { imageRole: "reference", healingState: "fresh", consentStatus: "unknown" },
    { imageRole: "result", healingState: "old", consentStatus: "unknown" },
    { imageRole: "result", healingState: "fresh", consentStatus: "approved" },
  ]) {
    response = await handlePortfolioApi(request("/api/admin/portfolio/enum-draft/images/enum-image", {
      method: "PATCH", admin: true, body,
    }), env(database));
    assert.equal(response.status, 422);
  }

  assert.throws(() => database.prepare("UPDATE portfolio_image_details SET image_role='before' WHERE portfolio_item_id='enum-draft' AND image_ref='enum-image'").run(), /before images require a cover-up portfolio project/);
  database.prepare("UPDATE portfolio_items SET project_type='cover_up' WHERE id='enum-draft'").run();
  database.prepare("UPDATE portfolio_image_details SET image_role='before' WHERE portfolio_item_id='enum-draft' AND image_ref='enum-image'").run();
  assert.throws(() => database.prepare("UPDATE portfolio_items SET project_type='standard' WHERE id='enum-draft'").run(), /before images require a cover-up portfolio project/);
});

test("a cover-up can publish with only its permitted primary result", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "result-only", projectType: "cover_up", consent: "granted" });
  const response = await handlePortfolioApi(request("/api/admin/portfolio/result-only", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT state FROM portfolio_items WHERE id='result-only'").get().state, "published");
});

test("role-based additional uploads are atomic, private, and described for their role", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "angle-cover", projectType: "cover_up" });
  insertPortfolioItem(database, { id: "angle-standard", projectType: "standard" });

  const upload = (itemId, imageRole) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" }));
    form.set("imageRole", imageRole);
    return handlePortfolioApi(new Request(`https://example.test/api/admin/portfolio/${itemId}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    }), env(database, bucket));
  };

  let response = await upload("angle-standard", "before");
  assert.equal(response.status, 409);
  assert.equal(bucket.objects.size, 0);

  response = await upload("angle-cover", "before");
  assert.equal(response.status, 201);
  const image = (await response.json()).image;
  assert.equal(image.imageRole, "before");
  assert.equal(image.consentStatus, "unknown");
  assert.match(image.altText, /^Before \/ existing tattoo photograph/);
  assert.deepEqual({ ...database.prepare("SELECT privacy,consent_status,state,public_presentation,alt_text FROM media_assets WHERE id=?").get(image.id) }, {
    privacy: "private",
    consent_status: "unknown",
    state: "active",
    public_presentation: "inline",
    alt_text: image.altText,
  });
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE entity_id='angle-cover' AND media_id=? AND role='gallery'").get(image.id).public_visible, 0);
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='angle-cover' AND image_ref=?").get(image.id).image_role, "before");
  assert.equal(bucket.objects.size, 1);
});

test("image roles, cover selection, consent changes, and project reclassification are guarded", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "cover-draft", projectType: "standard", consent: "unknown" });
  attachImage(database, "cover-draft", { id: "before-photo" });

  let response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /permission/i);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", consentStatus: "granted" },
  }), env(database));
  assert.equal(response.status, 409);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { projectType: "cover_up" },
  }), env(database));
  assert.equal(response.status, 200);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", consentStatus: "granted", isCover: true },
  }), env(database));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /result image/i);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", consentStatus: "granted" },
  }), env(database));
  assert.equal(response.status, 200);
  assert.deepEqual({ ...database.prepare("SELECT privacy,consent_status FROM media_assets WHERE id='before-photo'").get() }, { privacy: "public", consent_status: "granted" });
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE media_id='before-photo'").get().public_visible, 1);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { projectType: "standard" },
  }), env(database));
  assert.equal(response.status, 409);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/primary", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "fresh", consentStatus: "granted" },
  }), env(database));
  assert.equal(response.status, 200);
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 200);

  attachImage(database, "cover-draft", { id: "replacement-private", role: "result", consent: "granted", privacy: "private", publicVisible: false, healingState: "healed" });
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", isCover: true },
  }), env(database));
  assert.equal(response.status, 409);
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", consentStatus: "granted", isCover: true },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT cover_image_ref FROM portfolio_items WHERE id='cover-draft'").get().cover_image_ref, "replacement-private");

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/primary", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "fresh", consentStatus: "denied" },
  }), env(database));
  assert.equal(response.status, 409);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", consentStatus: "denied" },
  }), env(database));
  assert.equal(response.status, 409);
});

test("public portfolio and primary media refuse a published row without recorded permission", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "unsafe-primary", state: "published", consent: "unknown" });
  let response = await handlePortfolioApi(request("/api/portfolio"), env(database));
  assert.deepEqual((await response.json()).items, []);
  response = await handlePortfolioApi(request("/api/portfolio/unsafe-primary"), env(database));
  assert.equal(response.status, 404);
  response = await handlePortfolioApi(request("/api/portfolio/media/unsafe-primary"), env(database));
  assert.equal(response.status, 404);

  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "safe-primary", state: "published", consent: "granted" });
  await bucket.put("portfolio/safe-primary.jpg", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } });
  response = await handlePortfolioApi(request("/api/portfolio/media/safe-primary"), env(database, bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("generic media and attachment APIs cannot privatize a published portfolio cover", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "generic-cover", state: "published", projectType: "cover_up", consent: "granted", coverImageRef: "generic-result" });
  attachImage(database, "generic-cover", { id: "generic-result", role: "result", consent: "granted", privacy: "public", publicVisible: true });
  attachImage(database, "generic-cover", { id: "generic-process", role: "process", consent: "granted", privacy: "public", publicVisible: true });

  assert.throws(() => database.prepare("UPDATE media_assets SET consent_status='denied' WHERE id='generic-result'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE entity_media SET public_visible=0 WHERE entity_id='generic-cover' AND media_id='generic-result' AND role='gallery'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_image_details SET image_role='before' WHERE portfolio_item_id='generic-cover' AND image_ref='generic-result'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_items SET cover_image_ref='generic-process' WHERE id='generic-cover'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_items SET primary_consent_status='denied' WHERE id='generic-cover'").run(), /published portfolio cover must remain eligible/);

  let response = await handleConstructApi(request("/api/admin/media/generic-result", {
    method: "PATCH", admin: true, body: { consent_status: "denied" },
  }), env(database));
  assert.equal(response.status, 409);
  response = await handleConstructApi(request("/api/admin/entities/generic-cover/media", {
    method: "POST", admin: true, body: { media_id: "generic-result", role: "gallery", public_visible: false },
  }), env(database));
  assert.equal(response.status, 409);
  response = await handleConstructApi(request("/api/admin/entities/generic-cover/media", {
    method: "POST", admin: true, body: { media_id: "generic-result", role: "thumbnail", public_visible: false },
  }), env(database));
  assert.equal(response.status, 201);
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE entity_id='generic-cover' AND media_id='generic-result' AND role='gallery'").get().public_visible, 1);

  response = await handleConstructApi(request("/api/admin/media/generic-process", {
    method: "PATCH", admin: true, body: { consent_status: "denied" },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT consent_status FROM media_assets WHERE id='generic-process'").get().consent_status, "denied");
});
