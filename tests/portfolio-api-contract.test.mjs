import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { handlePortfolioApi } from "../functions/api/portfolio/_lib.js";
import { handleConstructApi, reapStaleMediaUploads } from "../functions/api/construct/_lib.js";

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
  constructor() { this.objects = new Map(); this.uploads = new Map(); this.abortedUploads = new Set(); }
  async put(key, value, options = {}) {
    const body = value instanceof ReadableStream
      ? await new Response(value).arrayBuffer()
      : value instanceof ArrayBuffer
        ? value
        : await new Response(value).arrayBuffer();
    this.objects.set(key, { body, options });
  }
  async get(key, options = {}) {
    const object = this.objects.get(key);
    if (!object) return null;
    const source = new Uint8Array(object.body);
    const range = options.range;
    const body = range ? source.slice(range.offset, range.offset + range.length) : source;
    return {
      body,
      httpEtag: `"${key}"`,
      size: body.byteLength,
      httpMetadata: object.options.httpMetadata || {},
      customMetadata: object.options.customMetadata || {},
      writeHttpMetadata(headers) {
        if (object.options.httpMetadata?.contentType) headers.set("content-type", object.options.httpMetadata.contentType);
        if (object.options.httpMetadata?.cacheControl) headers.set("cache-control", object.options.httpMetadata.cacheControl);
      },
    };
  }
  async head(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      size: object.body.byteLength,
      httpEtag: `"${key}"`,
      httpMetadata: object.options.httpMetadata || {},
      customMetadata: object.options.customMetadata || {},
      writeHttpMetadata(headers) {
        if (object.options.httpMetadata?.contentType) headers.set("content-type", object.options.httpMetadata.contentType);
        if (object.options.httpMetadata?.cacheControl) headers.set("cache-control", object.options.httpMetadata.cacheControl);
      },
    };
  }
  createMultipartUpload(key, options = {}) {
    const uploadId = `upload-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, { key, options, parts: new Map() });
    return this.resumeMultipartUpload(key, uploadId);
  }
  resumeMultipartUpload(key, uploadId) {
    const bucket = this;
    return {
      uploadId,
      async uploadPart(partNumber, value) {
        const upload = bucket.uploads.get(uploadId);
        if (!upload || upload.key !== key) throw new Error("Unknown multipart upload");
        const body = await new Response(value).arrayBuffer();
        const part = { partNumber, etag: `"${uploadId}-${partNumber}"`, body };
        upload.parts.set(partNumber, part);
        return part;
      },
      async complete(parts) {
        const upload = bucket.uploads.get(uploadId);
        if (!upload || upload.key !== key) throw new Error("Unknown multipart upload");
        const chunks = parts.map((part) => new Uint8Array(upload.parts.get(part.partNumber).body));
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        bucket.objects.set(key, { body: body.buffer, options: upload.options });
        bucket.uploads.delete(uploadId);
        return bucket.head(key);
      },
      async abort() {
        bucket.uploads.delete(uploadId);
        bucket.abortedUploads.add(uploadId);
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
  primaryPublicVisible = false,
  coverImageRef = "primary",
} = {}) {
  const visibility = state === "published" ? "public" : "internal";
  database.prepare(`
    INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES (?,'portfolio_item','node-tattoos',?,?, 'test','test',datetime('now'),datetime('now'))
  `).run(id, visibility, state === "published" ? 1 : 0);
  const currentColumns = new Set(database.prepare("PRAGMA table_info(portfolio_items)").all().map((column) => column.name));
  if (currentColumns.has("primary_public_visible")) {
    database.prepare(`
      INSERT INTO portfolio_items
        (id,storage_key,original_filename,content_type,title,alt_text,state,sort_order,
         cover_image_ref,project_type,primary_public_visible,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?,?,datetime('now'),datetime('now'))
    `).run(id, `portfolio/${id}.jpg`, `${id}.jpg`, "image/jpeg", `Tattoo ${id}`, `Tattoo ${id}`, state, coverImageRef, projectType, primaryPublicVisible ? 1 : 0);
  } else {
    database.prepare(`
      INSERT INTO portfolio_items
        (id,storage_key,original_filename,content_type,title,alt_text,state,sort_order,
         cover_image_ref,project_type,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?,datetime('now'),datetime('now'))
    `).run(id, `portfolio/${id}.jpg`, `${id}.jpg`, "image/jpeg", `Tattoo ${id}`, `Tattoo ${id}`, state, coverImageRef, projectType);
  }
  database.prepare(`
    INSERT INTO portfolio_image_details
      (portfolio_item_id,image_ref,healing_state,image_role,timing_note,caption,created_at,updated_at)
    VALUES (?,'primary','fresh','result','day of','Primary result',datetime('now'),datetime('now'))
  `).run(id);
}

function attachImage(database, itemId, {
  id,
  role = "result",
  privacy = "internal",
  publicVisible = false,
  healingState = "unspecified",
  state = "active",
  presentation = "inline",
} = {}) {
  database.prepare(`
    INSERT INTO media_assets
      (id,storage_key,original_filename,mime_type,alt_text,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES (?,?,?,?,?,?,?,'test',datetime('now'),datetime('now'),?)
  `).run(id, `construct/${id}.jpg`, `${id}.jpg`, "image/jpeg", `${role} photograph`, privacy, state, presentation);
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

function assignTattooStyles(database, entityId, values) {
  database.prepare("DELETE FROM tattoo_item_styles WHERE entity_id=?").run(entityId);
  values.forEach((value, index) => {
    const option = database.prepare("SELECT id FROM portfolio_options WHERE kind='style' AND value=? COLLATE NOCASE").get(value);
    assert.ok(option, `Expected tattoo style option ${value}`);
    database.prepare(`
      INSERT INTO tattoo_item_styles(entity_id,style_option_id,is_primary,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,datetime('now'),datetime('now'))
    `).run(entityId, option.id, index === 0 ? 1 : 0, index + 1);
  });
}

test("media publication visibility migrations preserve eligible work and remove consent columns", () => {
  const visibilityMigration = "0185_media_publication_visibility.sql";
  const removalMigration = "0186_remove_media_publication_consent.sql";
  const database = migratedDatabase({ before: visibilityMigration });
  const baseInsert = (id, state) => database.prepare(`
    INSERT INTO portfolio_items
      (id,storage_key,original_filename,content_type,title,alt_text,state,sort_order,primary_consent_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,?,datetime('now'),datetime('now'))
  `).run(id, `portfolio/${id}.jpg`, `${id}.jpg`, "image/jpeg", id, id, state, state === "published" ? "granted" : "unknown");
  baseInsert("legacy-published", "published");
  baseInsert("legacy-draft", "draft");
  for (const id of ["legacy-published", "legacy-draft"]) {
    database.prepare(`
      INSERT INTO portfolio_image_details
        (portfolio_item_id,image_ref,healing_state,timing_note,caption,created_at,updated_at)
      VALUES (?,'primary','unspecified','','',datetime('now'),datetime('now'))
    `).run(id);
  }
  database.exec(readFileSync(join(ROOT, "migrations", visibilityMigration), "utf8"));
  database.exec(readFileSync(join(ROOT, "migrations", removalMigration), "utf8"));

  assert.deepEqual({ ...database.prepare(`
    SELECT project_type,primary_public_visible FROM portfolio_items WHERE id='legacy-published'
  `).get() }, { project_type: "standard", primary_public_visible: 1 });
  assert.equal(database.prepare("SELECT primary_public_visible FROM portfolio_items WHERE id='legacy-draft'").get().primary_public_visible, 0);
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='legacy-published'").get().image_role, "result");
  assert.equal(database.prepare("PRAGMA table_info(portfolio_items)").all().some((column) => column.name === "primary_consent_status"), false);
  assert.equal(database.prepare("PRAGMA table_info(media_assets)").all().some((column) => column.name === "consent_status"), false);
  assert.equal(database.prepare("PRAGMA table_info(media_upload_sessions)").all().some((column) => column.name === "consent_status"), false);
});

test("public portfolio exposes only explicitly visible eligible media while Studio retains internal documentation", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "cover-public", state: "published", projectType: "cover_up", primaryPublicVisible: true, coverImageRef: "result-public" });
  attachImage(database, "cover-public", { id: "result-public", role: "result", privacy: "public", publicVisible: true, healingState: "healed" });
  attachImage(database, "cover-public", { id: "process-public", role: "process", privacy: "public", publicVisible: true });
  attachImage(database, "cover-public", { id: "before-internal", role: "before", privacy: "internal", publicVisible: false });
  attachImage(database, "cover-public", { id: "before-relationship-hidden", role: "before", privacy: "public", publicVisible: false });
  attachImage(database, "cover-public", { id: "detail-hidden", role: "detail", privacy: "public", publicVisible: true, presentation: "hidden" });
  attachImage(database, "cover-public", { id: "process-archived", role: "process", privacy: "public", publicVisible: true, state: "archived" });

  const adminResponse = await handlePortfolioApi(request("/api/admin/portfolio", { admin: true }), env(database));
  assert.equal(adminResponse.status, 200);
  const adminItem = (await adminResponse.json()).items.find((item) => item.id === "cover-public");
  assert.equal(adminItem.projectType, "cover_up");
  assert.equal(adminItem.angles.find((image) => image.id === "before-internal").publicVisible, false);
  assert.equal(adminItem.angles.find((image) => image.id === "before-internal").privacy, "internal");
  assert.equal("consentStatus" in adminItem.angles.find((image) => image.id === "before-internal"), false);

  const publicResponse = await handlePortfolioApi(request("/api/portfolio/cover-public"), env(database));
  assert.equal(publicResponse.status, 200);
  const publicItem = (await publicResponse.json()).item;
  assert.equal(publicItem.projectType, "cover_up");
  assert.deepEqual(publicItem.angles.map((image) => image.id), ["result-public", "process-public"]);
  assert.equal(publicItem.angles[0].imageUrl, "/api/construct/entity-media/result-public");
  assert.equal("consentStatus" in publicItem.angles[0], false);

  const downgrade = await handlePortfolioApi(request("/api/admin/portfolio/cover-public/images/process-public", {
    method: "PATCH", admin: true, body: { imageRole: "process", healingState: "unspecified", publicVisible: false },
  }), env(database));
  assert.equal(downgrade.status, 200);
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id='process-public'").get().privacy, "internal");
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE media_id='process-public'").get().public_visible, 0);
  const filteredAgain = await handlePortfolioApi(request("/api/portfolio/cover-public"), env(database));
  assert.deepEqual((await filteredAgain.json()).item.angles.map((image) => image.id), ["result-public"]);

  const legacyKeyIgnored = await handlePortfolioApi(request("/api/admin/portfolio/cover-public/images/result-public", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", consentStatus: "denied" },
  }), env(database));
  assert.equal(legacyKeyIgnored.status, 200);
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id='result-public'").get().privacy, "public");
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE media_id='result-public' AND role='gallery'").get().public_visible, 1);

  const coverDowngrade = await handlePortfolioApi(request("/api/admin/portfolio/cover-public/images/result-public", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", publicVisible: false },
  }), env(database));
  assert.equal(coverDowngrade.status, 409);
});

test("portfolio project, image-role, and healing enums reject unknown values", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "enum-draft" });
  attachImage(database, "enum-draft", { id: "enum-image" });

  let response = await handlePortfolioApi(request("/api/admin/portfolio/enum-draft", {
    method: "PATCH", admin: true, body: { projectType: "restoration" },
  }), env(database));
  assert.equal(response.status, 422);

  for (const body of [
    { imageRole: "reference", healingState: "fresh" },
    { imageRole: "result", healingState: "old" },
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

test("a cover-up can publish with only its publicly included primary result", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "result-only", projectType: "cover_up", primaryPublicVisible: true });
  const response = await handlePortfolioApi(request("/api/admin/portfolio/result-only", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT state FROM portfolio_items WHERE id='result-only'").get().state, "published");
});

test("role-based additional uploads are atomic, described, and default visibility by role", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "angle-cover", projectType: "cover_up" });
  insertPortfolioItem(database, { id: "angle-standard", projectType: "standard" });

  const upload = (itemId, imageRole, { promoteToCoverUp = false } = {}) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" }));
    form.set("imageRole", imageRole);
    if (promoteToCoverUp) form.set("promoteToCoverUp", "true");
    return handlePortfolioApi(new Request(`https://example.test/api/admin/portfolio/${itemId}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    }), env(database, bucket));
  };

  let response = await upload("angle-standard", "before");
  assert.equal(response.status, 409);
  assert.equal(bucket.objects.size, 0);

  response = await upload("angle-standard", "before", { promoteToCoverUp: true });
  assert.equal(response.status, 201);
  assert.equal(database.prepare("SELECT project_type FROM portfolio_items WHERE id='angle-standard'").get().project_type, "cover_up");
  assert.equal((await response.json()).image.imageRole, "before");

  response = await upload("angle-cover", "before");
  assert.equal(response.status, 201);
  const image = (await response.json()).image;
  assert.equal(image.imageRole, "before");
  assert.equal(image.publicVisible, false);
  assert.equal("consentStatus" in image, false);
  assert.match(image.altText, /^Before \/ existing tattoo photograph/);
  assert.deepEqual({ ...database.prepare("SELECT privacy,state,public_presentation,alt_text FROM media_assets WHERE id=?").get(image.id) }, {
    privacy: "internal",
    state: "active",
    public_presentation: "inline",
    alt_text: image.altText,
  });
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE entity_id='angle-cover' AND media_id=? AND role='gallery'").get(image.id).public_visible, 0);
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='angle-cover' AND image_ref=?").get(image.id).image_role, "before");

  response = await upload("angle-cover", "detail");
  assert.equal(response.status, 201);
  const detail = (await response.json()).image;
  assert.equal(detail.publicVisible, true);
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id=?").get(detail.id).privacy, "public");
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE entity_id='angle-cover' AND media_id=? AND role='gallery'").get(detail.id).public_visible, 1);
  assert.equal(bucket.objects.size, 3);
});

test("image roles, cover selection, visibility changes, and project reclassification are guarded", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "cover-draft", projectType: "standard" });
  attachImage(database, "cover-draft", { id: "before-photo" });

  let response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /publicly visible/i);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", publicVisible: true },
  }), env(database));
  assert.equal(response.status, 409);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", publicVisible: true, promoteToCoverUp: true },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT project_type FROM portfolio_items WHERE id='cover-draft'").get().project_type, "cover_up");

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", publicVisible: true, isCover: true },
  }), env(database));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /result image/i);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/before-photo", {
    method: "PATCH", admin: true, body: { imageRole: "before", healingState: "unspecified", publicVisible: true },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id='before-photo'").get().privacy, "public");
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE media_id='before-photo'").get().public_visible, 1);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { projectType: "standard" },
  }), env(database));
  assert.equal(response.status, 409);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/primary", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "fresh", publicVisible: true },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT primary_public_visible FROM portfolio_items WHERE id='cover-draft'").get().primary_public_visible, 1);
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), env(database));
  assert.equal(response.status, 200);

  attachImage(database, "cover-draft", { id: "replacement-private", role: "result", privacy: "internal", publicVisible: false, healingState: "healed" });
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", isCover: true },
  }), env(database));
  assert.equal(response.status, 409);
  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", publicVisible: true, isCover: true },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT cover_image_ref FROM portfolio_items WHERE id='cover-draft'").get().cover_image_ref, "replacement-private");

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/primary", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "fresh", publicVisible: false },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT primary_public_visible FROM portfolio_items WHERE id='cover-draft'").get().primary_public_visible, 0);

  response = await handlePortfolioApi(request("/api/admin/portfolio/cover-draft/images/replacement-private", {
    method: "PATCH", admin: true, body: { imageRole: "result", healingState: "healed", publicVisible: false },
  }), env(database));
  assert.equal(response.status, 409);
});

test("automatic cover-up promotion does not commit when the image change is invalid", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "atomic-promotion", projectType: "standard", coverImageRef: "atomic-cover" });
  attachImage(database, "atomic-promotion", { id: "atomic-cover", role: "result" });

  const response = await handlePortfolioApi(request("/api/admin/portfolio/atomic-promotion/images/atomic-cover", {
    method: "PATCH",
    admin: true,
    body: {
      imageRole: "before",
      healingState: "unspecified",
      promoteToCoverUp: true,
    },
  }), env(database));

  assert.equal(response.status, 409);
  assert.equal(database.prepare("SELECT project_type FROM portfolio_items WHERE id='atomic-promotion'").get().project_type, "standard");
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='atomic-promotion' AND image_ref='atomic-cover'").get().image_role, "result");
});

test("automatic cover-up upload survives a stale project snapshot", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "stale-promotion", projectType: "cover_up" });
  const originalPut = bucket.put.bind(bucket);
  bucket.put = async (...args) => {
    await originalPut(...args);
    database.prepare("UPDATE portfolio_items SET project_type='standard' WHERE id='stale-promotion'").run();
  };
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" }));
  form.set("imageRole", "before");
  form.set("promoteToCoverUp", "true");

  const response = await handlePortfolioApi(new Request("https://example.test/api/admin/portfolio/stale-promotion/images", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env(database, bucket));

  assert.equal(response.status, 201);
  assert.equal(database.prepare("SELECT project_type FROM portfolio_items WHERE id='stale-promotion'").get().project_type, "cover_up");
  const image = (await response.json()).image;
  assert.equal(database.prepare("SELECT image_role FROM portfolio_image_details WHERE portfolio_item_id='stale-promotion' AND image_ref=?").get(image.id).image_role, "before");
});

test("automatic cover-up upload rolls back its project and stored file when image insertion fails", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "failed-promotion", projectType: "standard" });
  database.exec(`
    CREATE TRIGGER fail_promoted_before_insert
    BEFORE INSERT ON portfolio_image_details
    WHEN NEW.portfolio_item_id = 'failed-promotion' AND NEW.image_role = 'before'
    BEGIN
      SELECT RAISE(ABORT, 'forced promoted upload failure');
    END;
  `);
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" }));
  form.set("imageRole", "before");
  form.set("promoteToCoverUp", "true");

  const response = await handlePortfolioApi(new Request("https://example.test/api/admin/portfolio/failed-promotion/images", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env(database, bucket));

  assert.equal(response.status, 500);
  assert.equal(database.prepare("SELECT project_type FROM portfolio_items WHERE id='failed-promotion'").get().project_type, "standard");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM entity_media WHERE entity_id='failed-promotion'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE storage_key LIKE 'portfolio/failed-promotion/%'").get().count, 0);
  assert.equal(bucket.objects.size, 0);
});

test("record state gates public portfolio records while primary visibility gates primary media", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "unsafe-primary", state: "published", primaryPublicVisible: false });
  let response = await handlePortfolioApi(request("/api/portfolio"), env(database));
  assert.deepEqual((await response.json()).items.map((item) => item.id), ["unsafe-primary"]);
  response = await handlePortfolioApi(request("/api/portfolio/unsafe-primary"), env(database));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.primaryImage, null);
  response = await handlePortfolioApi(request("/api/portfolio/media/unsafe-primary"), env(database));
  assert.equal(response.status, 404);

  insertPortfolioItem(database, { id: "draft-visible-primary", state: "draft", primaryPublicVisible: true });
  response = await handlePortfolioApi(request("/api/portfolio"), env(database));
  assert.equal((await response.json()).items.some((item) => item.id === "draft-visible-primary"), false);
  response = await handlePortfolioApi(request("/api/portfolio/draft-visible-primary"), env(database));
  assert.equal(response.status, 404);
  response = await handlePortfolioApi(request("/api/portfolio/media/draft-visible-primary"), env(database));
  assert.equal(response.status, 404);

  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "safe-primary", state: "published", primaryPublicVisible: true });
  await bucket.put("portfolio/safe-primary.jpg", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } });
  response = await handlePortfolioApi(request("/api/portfolio/media/safe-primary"), env(database, bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("public and Studio portfolio lists order entries newest to oldest", async () => {
  const database = migratedDatabase();
  for (const [id, createdAt, sortOrder] of [
    ["portfolio-order-oldest", "2024-01-01 12:00:00", 1],
    ["portfolio-order-middle", "2025-01-01 12:00:00", 2],
    ["portfolio-order-newest", "2026-01-01 12:00:00", 99],
  ]) {
    insertPortfolioItem(database, { id, state: "published", primaryPublicVisible: true });
    database.prepare("UPDATE portfolio_items SET created_at=?,sort_order=? WHERE id=?").run(createdAt, sortOrder, id);
  }

  const expected = ["portfolio-order-newest", "portfolio-order-middle", "portfolio-order-oldest"];
  const publicResponse = await handlePortfolioApi(request("/api/portfolio"), env(database));
  assert.equal(publicResponse.status, 200);
  assert.deepEqual((await publicResponse.json()).items.map((item) => item.id).filter((id) => expected.includes(id)), expected);

  const adminResponse = await handlePortfolioApi(request("/api/admin/portfolio", { admin: true }), env(database));
  assert.equal(adminResponse.status, 200);
  assert.deepEqual((await adminResponse.json()).items.map((item) => item.id).filter((id) => expected.includes(id)), expected);
});

test("generic media and attachment APIs cannot privatize a published portfolio cover", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "generic-cover", state: "published", projectType: "cover_up", primaryPublicVisible: false, coverImageRef: "generic-result" });
  attachImage(database, "generic-cover", { id: "generic-result", role: "result", privacy: "public", publicVisible: true });
  attachImage(database, "generic-cover", { id: "generic-process", role: "process", privacy: "public", publicVisible: true });
  insertPortfolioItem(database, { id: "generic-primary", state: "published", primaryPublicVisible: true });

  assert.throws(() => database.prepare("UPDATE media_assets SET privacy='internal' WHERE id='generic-result'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE media_assets SET public_presentation='hidden' WHERE id='generic-result'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE entity_media SET public_visible=0 WHERE entity_id='generic-cover' AND media_id='generic-result' AND role='gallery'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_image_details SET image_role='before' WHERE portfolio_item_id='generic-cover' AND image_ref='generic-result'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_items SET cover_image_ref='generic-process' WHERE id='generic-cover'").run(), /published portfolio cover must remain eligible/);
  assert.throws(() => database.prepare("UPDATE portfolio_items SET primary_public_visible=0 WHERE id='generic-primary'").run(), /published portfolio cover must remain eligible/);

  let response = await handleConstructApi(request("/api/admin/media/generic-result", {
    method: "PATCH", admin: true, body: { consent_status: "denied" },
  }), env(database));
  assert.equal(response.status, 200, "obsolete media consent keys are ignored");
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id='generic-result'").get().privacy, "public");
  response = await handleConstructApi(request("/api/admin/media/generic-result", {
    method: "PATCH", admin: true, body: { privacy: "internal" },
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
  assert.equal(database.prepare("SELECT privacy FROM media_assets WHERE id='generic-process'").get().privacy, "public");
});

test("multi-style migration backfills Portfolio and Flash without inventing classifications", () => {
  const migration = "0045_tattoo_item_styles.sql";
  const database = migratedDatabase({ before: migration });
  insertPortfolioItem(database, { id: "style-blank" });
  insertPortfolioItem(database, { id: "style-known" });
  insertPortfolioItem(database, { id: "style-legacy" });
  database.prepare("UPDATE portfolio_items SET primary_style='symbolic' WHERE id='style-known'").run();
  database.prepare("UPDATE portfolio_items SET primary_style='Fine Line' WHERE id='style-legacy'").run();

  database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));

  const assignment = (id) => database.prepare(`
    SELECT option_row.value, assignment.is_primary
    FROM tattoo_item_styles assignment
    JOIN portfolio_options option_row ON option_row.id=assignment.style_option_id
    WHERE assignment.entity_id=?
  `).get(id);
  assert.deepEqual({ ...assignment("style-blank") }, { value: "unclassified", is_primary: 1 });
  assert.deepEqual({ ...assignment("style-known") }, { value: "symbolic", is_primary: 1 });
  assert.deepEqual({ ...assignment("style-legacy") }, { value: "Fine Line", is_primary: 1 });
  assert.deepEqual({ ...assignment("ap-flash-001") }, { value: "unclassified", is_primary: 1 });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM portfolio_options WHERE kind='style' AND value='Fine Line' COLLATE NOCASE").get().count, 1);
  assert.equal(database.prepare("SELECT theme_labels FROM search_documents WHERE entity_id='ap-flash-001'").get().theme_labels, "");

  const surreal = database.prepare("SELECT id FROM portfolio_options WHERE kind='style' AND value='surreal'").get();
  assert.throws(() => database.prepare(`
    INSERT INTO tattoo_item_styles(entity_id,style_option_id,is_primary,sort_order,created_at,updated_at)
    VALUES('style-known',?,1,2,datetime('now'),datetime('now'))
  `).run(surreal.id), /UNIQUE constraint failed/);
  const collectionId = `test-collection-${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO portfolio_options(id,kind,value,label,enabled,sort_order,created_at,updated_at)
    VALUES(?,'collection','test-collection','Test collection',1,999,datetime('now'),datetime('now'))
  `).run(collectionId);
  assert.throws(() => database.prepare(`
    INSERT INTO tattoo_item_styles(entity_id,style_option_id,is_primary,sort_order,created_at,updated_at)
    VALUES('style-known',?,0,2,datetime('now'),datetime('now'))
  `).run(collectionId), /tattoo styles require a style option/);
});

test("Portfolio API stores ordered style sets and preserves secondary styles for legacy clients", async () => {
  const database = migratedDatabase();
  insertPortfolioItem(database, { id: "multi-style", state: "published", primaryPublicVisible: true });

  let response = await handlePortfolioApi(request("/api/admin/portfolio/multi-style", {
    method: "PATCH", admin: true, body: { styles: ["unclassified", "symbolic", "surreal"] },
  }), env(database));
  assert.equal(response.status, 200);
  let item = (await response.json()).item;
  assert.deepEqual(item.styles, ["symbolic", "surreal"]);
  assert.deepEqual(item.styleLabels, ["Symbolic", "Surreal"]);
  assert.equal(item.primaryStyle, "symbolic");
  assert.equal(database.prepare("SELECT primary_style FROM portfolio_items WHERE id='multi-style'").get().primary_style, "symbolic");

  response = await handlePortfolioApi(request("/api/portfolio/multi-style"), env(database));
  assert.equal(response.status, 200);
  item = (await response.json()).item;
  assert.deepEqual(item.styles, ["symbolic", "surreal"]);
  assert.equal(item.primaryStyleLabel, "Symbolic");

  response = await handlePortfolioApi(request("/api/admin/portfolio/multi-style", {
    method: "PATCH", admin: true, body: { primaryStyle: "mythic" },
  }), env(database));
  assert.equal(response.status, 200);
  item = (await response.json()).item;
  assert.deepEqual(item.styles, ["mythic", "symbolic", "surreal"]);
  assert.equal(item.primaryStyle, "mythic");

  database.prepare("UPDATE portfolio_options SET enabled=0 WHERE kind='style' AND value='surreal'").run();
  response = await handlePortfolioApi(request("/api/admin/portfolio/multi-style", {
    method: "PATCH", admin: true, body: { styles: ["mythic", "symbolic", "surreal"] },
  }), env(database));
  assert.equal(response.status, 200, "an already assigned disabled style remains editable");

  insertPortfolioItem(database, { id: "new-disabled-style" });
  response = await handlePortfolioApi(request("/api/admin/portfolio/new-disabled-style", {
    method: "PATCH", admin: true, body: { styles: ["surreal"] },
  }), env(database));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /disabled/i);

  response = await handlePortfolioApi(request("/api/admin/portfolio/settings", { admin: true }), env(database));
  const surrealOption = (await response.json()).options.styles.find((option) => option.value === "surreal");
  assert.equal(surrealOption.usageCount, 1);
  response = await handlePortfolioApi(request(`/api/admin/portfolio/settings/${encodeURIComponent(surrealOption.id)}`, {
    method: "DELETE", admin: true,
  }), env(database));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /tattoo work/i);

  const beforeTitle = database.prepare("SELECT title FROM portfolio_items WHERE id='multi-style'").get().title;
  database.exec(`
    CREATE TRIGGER fail_style_replacement
    BEFORE INSERT ON tattoo_item_styles
    WHEN NEW.entity_id='multi-style' AND NEW.sort_order=2
    BEGIN SELECT RAISE(ABORT, 'forced style failure'); END;
  `);
  response = await handlePortfolioApi(request("/api/admin/portfolio/multi-style", {
    method: "PATCH", admin: true, body: { title: "Should roll back", styles: ["symbolic", "mythic"] },
  }), env(database));
  assert.equal(response.status, 500);
  assert.equal(database.prepare("SELECT title FROM portfolio_items WHERE id='multi-style'").get().title, beforeTitle);
  assert.deepEqual(database.prepare(`
    SELECT option_row.value FROM tattoo_item_styles assignment
    JOIN portfolio_options option_row ON option_row.id=assignment.style_option_id
    WHERE assignment.entity_id='multi-style'
    ORDER BY assignment.is_primary DESC,assignment.sort_order
  `).all().map((row) => row.value), ["mythic", "symbolic", "surreal"]);
});

test("Flash API hydrates and updates the shared tattoo style classifications", async () => {
  const database = migratedDatabase();
  let response = await handleConstructApi(request("/api/admin/flash/ap-flash-001", {
    method: "PATCH", admin: true, body: { styles: [] },
  }), env(database));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).record.styles, ["unclassified"]);
  assert.equal(database.prepare("SELECT theme_labels FROM search_documents WHERE entity_id='ap-flash-001'").get().theme_labels, "");

  response = await handleConstructApi(request("/api/admin/flash/ap-flash-001", {
    method: "PATCH", admin: true, body: { styles: ["symbolic", "mythic"] },
  }), env(database));
  assert.equal(response.status, 200);
  let record = (await response.json()).record;
  assert.deepEqual(record.styles, ["symbolic", "mythic"]);
  assert.deepEqual(record.styleLabels, ["Symbolic", "Mythic"]);
  assert.equal(record.primaryStyle, "symbolic");

  response = await handleConstructApi(request("/api/flash/ap-flash-001"), env(database));
  assert.equal(response.status, 200);
  record = (await response.json()).record;
  assert.deepEqual(record.styles, ["symbolic", "mythic"]);
  assert.equal(record.primaryStyleLabel, "Symbolic");
  assert.equal(database.prepare("SELECT theme_labels FROM search_documents WHERE entity_id='ap-flash-001'").get().theme_labels, "Symbolic, Mythic");

  response = await handlePortfolioApi(request("/api/admin/portfolio/settings/portfolio-style-symbolic", {
    method: "PATCH", admin: true, body: { label: "Symbolic Mark" },
  }), env(database));
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT theme_labels FROM search_documents WHERE entity_id='ap-flash-001'").get().theme_labels, "Symbolic Mark, Mythic");
  response = await handleConstructApi(request("/api/flash/ap-flash-001"), env(database));
  assert.deepEqual((await response.json()).record.styleLabels, ["Symbolic Mark", "Mythic"]);

  response = await handleConstructApi(request("/api/admin/flash/ap-flash-001", {
    method: "PATCH", admin: true, body: { styles: ["unclassified", "surreal"] },
  }), env(database));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).record.styles, ["surreal"]);

  response = await handleConstructApi(request("/api/admin/flash", {
    method: "POST",
    admin: true,
    body: {
      id: "flash-default-style",
      slug: "flash-default-style",
      title: "Default style flash",
      state: "draft",
      item_type: "individual",
      session_category: "artist_review",
      split_policy: "artist_review",
    },
  }), env(database));
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).record.styles, ["unclassified"]);
});

test("Flash drafts upload ordered galleries and cannot publish or lose their primary artwork", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const environment = env(database, bucket);
  let response = await handleConstructApi(request("/api/admin/flash", {
    method: "POST",
    admin: true,
    body: {
      id: "flash-upload-contract",
      slug: "flash-upload-contract",
      title: "Flash Upload Contract",
      state: "available",
      item_type: "individual",
      process_category: "standard",
      session_category: "artist_review",
      split_policy: "artist_review",
    },
  }), environment);
  assert.equal(response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM flash_items WHERE id='flash-upload-contract'").get().count, 0);

  response = await handleConstructApi(request("/api/admin/flash", {
    method: "POST",
    admin: true,
    body: {
      id: "flash-upload-contract",
      slug: "flash-upload-contract",
      title: "Flash Upload Contract",
      state: "draft",
      item_type: "individual",
      process_category: "standard",
      claimable: 0,
      session_category: "artist_review",
      split_policy: "artist_review",
    },
  }), environment);
  assert.equal(response.status, 201);

  response = await handleConstructApi(request("/api/admin/flash/flash-upload-contract", {
    method: "PATCH", admin: true, body: { state: "available" },
  }), environment);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /primary/i);
  response = await handleConstructApi(request("/api/flash/flash-upload-contract"), environment);
  assert.equal(response.status, 404);

  async function upload(filename, bytes) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], filename, { type: "image/png" }));
    form.set("alt_text", filename.replace(".png", ""));
    form.set("privacy", "public");
    form.set("public_presentation", "inline");
    const uploaded = await handleConstructApi(new Request("https://example.test/api/admin/media", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    }), environment);
    assert.equal(uploaded.status, 201);
    return (await uploaded.json()).record.id;
  }

  const primaryId = await upload("primary.png", [1, 2, 3]);
  const galleryId = await upload("gallery.png", [4, 5, 6]);
  response = await handleConstructApi(request("/api/admin/entities/flash-upload-contract/media", {
    method: "POST", admin: true, body: {
      media_id: primaryId, role: "primary", sort_order: 1, public_visible: true, alt_text_override: "Primary design",
    },
  }), environment);
  assert.equal(response.status, 201);
  response = await handleConstructApi(request("/api/admin/entities/flash-upload-contract/media", {
    method: "POST", admin: true, body: {
      media_id: galleryId, role: "gallery", sort_order: 2, public_visible: true, alt_text_override: "Gallery detail",
    },
  }), environment);
  assert.equal(response.status, 201);

  response = await handleConstructApi(request("/api/admin/flash", { admin: true }), environment);
  assert.equal(response.status, 200);
  let record = (await response.json()).records.find((item) => item.id === "flash-upload-contract");
  assert.deepEqual(record.media.map((item) => [item.id, item.role]), [[primaryId, "primary"], [galleryId, "gallery"]]);
  assert.match(record.media[0].adminUrl, /\/api\/admin\/media\/.+\/file/);

  response = await handleConstructApi(request("/api/admin/flash/flash-upload-contract", {
    method: "PATCH", admin: true, body: { state: "available" },
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request("/api/flash/flash-upload-contract"), environment);
  assert.equal(response.status, 200);
  record = (await response.json()).record;
  assert.deepEqual(record.media.map((item) => [item.id, item.role]), [[primaryId, "primary"], [galleryId, "gallery"]]);

  response = await handleConstructApi(request(`/api/admin/entities/flash-upload-contract/media/${encodeURIComponent(galleryId)}`, {
    method: "PATCH", admin: true, body: {
      role: "primary", sort_order: 1, alt_text_override: "New primary", caption_override: "Second view",
    },
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request("/api/flash/flash-upload-contract"), environment);
  record = (await response.json()).record;
  assert.deepEqual(record.media.map((item) => [item.id, item.role]), [[galleryId, "primary"], [primaryId, "gallery"]]);
  assert.equal(record.media[0].alt, "New primary");
  assert.equal(record.media[0].caption, "Second view");

  response = await handleConstructApi(request(`/api/admin/entities/flash-upload-contract/media/${encodeURIComponent(galleryId)}`, {
    method: "DELETE", admin: true,
  }), environment);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).promoted_media_id, primaryId);
  assert.equal(database.prepare("SELECT role FROM entity_media WHERE entity_id='flash-upload-contract' AND media_id=?").get(primaryId).role, "primary");

  response = await handleConstructApi(request(`/api/admin/entities/flash-upload-contract/media/${encodeURIComponent(primaryId)}`, {
    method: "DELETE", admin: true,
  }), environment);
  assert.equal(response.status, 409);
  response = await handleConstructApi(request("/api/admin/flash/flash-upload-contract", {
    method: "PATCH", admin: true, body: { state: "draft" },
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request(`/api/admin/entities/flash-upload-contract/media/${encodeURIComponent(primaryId)}`, {
    method: "DELETE", admin: true,
  }), environment);
  assert.equal(response.status, 200);
});

test("managed Flash sheets generate stable A-Z children and derive public claimability", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const environment = env(database, bucket);
  let response = await handleConstructApi(request("/api/admin/flash", {
    method: "POST",
    admin: true,
    body: {
      id: "managed-sheet-contract",
      slug: "managed-sheet-contract",
      title: "Managed Sheet Contract",
      state: "draft",
      item_type: "sheet",
      process_category: "standard",
      session_category: "artist_review",
      split_policy: "artist_review",
    },
  }), environment);
  assert.equal(response.status, 201);

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 2, designs: [{ label: "Moth" }, { label: "Key" }] },
  }), environment);
  assert.equal(response.status, 200);
  const firstChildren = (await response.json()).sheetDesigns;
  assert.deepEqual(firstChildren.map((design) => [design.code, design.label, design.state]), [
    ["A", "Moth", "draft"],
    ["B", "Key", "draft"],
  ]);

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 3, designs: [{ label: "Moth" }, { label: "Key" }, { label: "Candle" }] },
  }), environment);
  assert.equal(response.status, 200);
  const expanded = (await response.json()).sheetDesigns;
  assert.deepEqual(expanded.slice(0, 2).map((design) => design.id), firstChildren.map((design) => design.id));
  assert.deepEqual(expanded.map((design) => design.code), ["A", "B", "C"]);

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: {
      count: 26,
      designs: Array.from({ length: 26 }, (_, index) => ({
        code: String.fromCharCode(65 + index),
        label: `Design ${String.fromCharCode(65 + index)}`,
      })),
    },
  }), environment);
  assert.equal(response.status, 200);
  const alphabet = (await response.json()).sheetDesigns;
  assert.equal(alphabet.at(-1).code, "Z");
  assert.deepEqual(alphabet.slice(0, 3).map((design) => design.id), expanded.map((design) => design.id));
  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 3, designs: [{ label: "Moth" }, { label: "Key" }, { label: "Candle" }] },
  }), environment);
  assert.equal(response.status, 200);

  database.prepare(
    "UPDATE flash_sheet_designs SET state='reserved' WHERE flash_item_id='managed-sheet-contract' AND code='C'",
  ).run();
  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 2, designs: [{ label: "Moth" }, { label: "Key" }] },
  }), environment);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /C/);
  database.prepare(
    "UPDATE flash_sheet_designs SET state='draft',reserved_submission_id=NULL WHERE flash_item_id='managed-sheet-contract' AND code='C'",
  ).run();

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 27, designs: [] },
  }), environment);
  assert.equal(response.status, 400);

  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "sheet.png", { type: "image/png" }));
  form.set("alt_text", "Managed sheet artwork");
  form.set("privacy", "public");
  form.set("public_presentation", "inline");
  response = await handleConstructApi(new Request("https://example.test/api/admin/media", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), environment);
  assert.equal(response.status, 201);
  const mediaId = (await response.json()).record.id;
  response = await handleConstructApi(request("/api/admin/entities/managed-sheet-contract/media", {
    method: "POST",
    admin: true,
    body: { media_id: mediaId, role: "primary", sort_order: 1, public_visible: true },
  }), environment);
  assert.equal(response.status, 201);

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 3, designs: [{ label: "Moth" }, { label: "" }, { label: "Candle" }] },
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract", {
    method: "PATCH",
    admin: true,
    body: { state: "available" },
  }), environment);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /label/i);
  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract/sheet-designs", {
    method: "PUT",
    admin: true,
    body: { count: 3, designs: [{ label: "Moth" }, { label: "Key" }, { label: "Candle" }] },
  }), environment);
  assert.equal(response.status, 200);

  response = await handleConstructApi(request("/api/admin/flash/managed-sheet-contract", {
    method: "PATCH",
    admin: true,
    body: { state: "available" },
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request("/api/flash/managed-sheet-contract"), environment);
  assert.equal(response.status, 200);
  let record = (await response.json()).record;
  assert.equal(record.claimableNow, true);
  assert.deepEqual(record.sheetDesigns.map((design) => [design.code, design.state, design.claimableNow]), [
    ["A", "available", true],
    ["B", "available", true],
    ["C", "available", true],
  ]);
  assert.equal("reservedSubmissionId" in record.sheetDesigns[0], false);

  database.prepare(
    "UPDATE flash_sheet_designs SET state='placed',reserved_submission_id=NULL WHERE flash_item_id='managed-sheet-contract'",
  ).run();
  response = await handleConstructApi(request("/api/flash/managed-sheet-contract"), environment);
  assert.equal(response.status, 200);
  record = (await response.json()).record;
  assert.equal(record.claimableNow, false);
  assert.equal(record.state, "available", "sold-out sheets remain visible in the public archive");
});

test("new Portfolio uploads begin with the shared Unclassified style assignment", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "new-work.jpg", { type: "image/jpeg" }));
  form.set("title", "New work");
  form.set("altText", "New tattoo work");
  const response = await handlePortfolioApi(new Request("https://example.test/api/admin/portfolio", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env(database, bucket));
  assert.equal(response.status, 201);
  const item = (await response.json()).item;
  assert.deepEqual(item.styles, ["unclassified"]);
  assert.deepEqual(item.styleLabels, ["Unclassified"]);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM tattoo_item_styles WHERE entity_id=?").get(item.id).count, 1);
  assert.deepEqual(
    { ...database.prepare("SELECT entity_id,state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(item.id) },
    { entity_id:item.id, state:"draft", public_visible:0, published_at:null },
  );
});

test("a new Studio upload can save multi-style metadata and primary visibility before publishing", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const form = new FormData();
  form.set("file", new File([new Uint8Array([4, 5, 6])], "publish-ready.jpg", { type: "image/jpeg" }));

  let response = await handlePortfolioApi(new Request("https://example.test/api/admin/portfolio", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env(database, bucket));
  assert.equal(response.status, 201);
  const createdItem = (await response.json()).item;
  const itemId = createdItem.id;
  assert.equal(createdItem.primaryPublicVisible, true);
  assert.equal(database.prepare("SELECT primary_public_visible FROM portfolio_items WHERE id=?").get(itemId).primary_public_visible, 1);

  response = await handlePortfolioApi(request(`/api/admin/portfolio/${itemId}`, {
    method: "PATCH",
    admin: true,
    body: {
      title: "Publish-ready tattoo",
      altText: "Finished black and grey tattoo",
      projectType: "standard",
      styles: ["symbolic", "surreal"],
    },
  }), env(database, bucket));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).item.styles, ["symbolic", "surreal"]);

  response = await handlePortfolioApi(request(`/api/admin/portfolio/${itemId}/images/primary`, {
    method: "PATCH",
    admin: true,
    body: {
      imageRole: "result",
      healingState: "healed",
      timingNote: "Eight weeks healed",
      caption: "Finished result",
      publicVisible: true,
    },
  }), env(database, bucket));
  assert.equal(response.status, 200);

  response = await handlePortfolioApi(request(`/api/admin/portfolio/${itemId}`, {
    method: "PATCH",
    admin: true,
    body: { state: "published" },
  }), env(database, bucket));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.state, "published");
  assert.deepEqual({ ...database.prepare(`
    SELECT visibility,search_visibility FROM content_entities WHERE id=?
  `).get(itemId) }, { visibility: "public", search_visibility: 1 });
  assert.deepEqual(
    { ...database.prepare("SELECT state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(itemId) },
    { state:"draft", public_visible:0, published_at:null },
  );

  response = await handlePortfolioApi(request(`/api/portfolio/${itemId}`), env(database, bucket));
  assert.equal(response.status, 200);
});

test("resumable video uploads reject invalid files, resume parts, complete idempotently, and cancel", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const environment = env(database, bucket);

  let response = await handleConstructApi(request("/api/admin/media/uploads", {
    method: "POST", admin: true, body: { filename: "bad.mov", mimeType: "video/quicktime", byteSize: 10 },
  }), environment);
  assert.equal(response.status, 415);
  response = await handleConstructApi(request("/api/admin/media/uploads", {
    method: "POST", admin: true, body: { filename: "huge.mp4", mimeType: "video/mp4", byteSize: 2 * 1024 * 1024 * 1024 + 1 },
  }), environment);
  assert.equal(response.status, 413);

  response = await handleConstructApi(request("/api/admin/media/uploads", {
    method: "POST",
    admin: true,
    body: { filename: "studio (test).mp4", mimeType: "video/mp4", byteSize: 7, caption: "Process clip" },
  }), environment);
  assert.equal(response.status, 201);
  const session = (await response.json()).upload;
  assert.equal(database.prepare("SELECT COUNT(*) count FROM media_assets WHERE id=?").get(session.mediaId).count, 0);

  response = await handleConstructApi(new Request(`https://example.test/api/admin/media/uploads/${session.id}/parts/1`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
  }), environment);
  assert.equal(response.status, 200);
  response = await handleConstructApi(request(`/api/admin/media/uploads/${session.id}`, { admin: true }), environment);
  assert.deepEqual((await response.json()).upload.parts.map((part) => part.partNumber), [1]);

  response = await handleConstructApi(request(`/api/admin/media/uploads/${session.id}/complete`, {
    method: "POST", admin: true,
  }), environment);
  assert.equal(response.status, 200);
  const completed = await response.json();
  assert.equal(completed.record.mime_type, "video/mp4");
  assert.equal(completed.record.byte_size, 7);
  assert.equal(completed.record.original_filename, "studio (test).mp4");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM media_assets WHERE id=?").get(session.mediaId).count, 1);
  response = await handleConstructApi(request(`/api/admin/media/uploads/${session.id}/complete`, {
    method: "POST", admin: true,
  }), environment);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.id, session.mediaId);

  response = await handleConstructApi(request("/api/admin/media/uploads", {
    method: "POST", admin: true, body: { filename: "cancel.webm", mimeType: "video/webm", byteSize: 4 },
  }), environment);
  const cancelled = (await response.json()).upload;
  response = await handleConstructApi(request(`/api/admin/media/uploads/${cancelled.id}`, {
    method: "DELETE", admin: true,
  }), environment);
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT state FROM media_upload_sessions WHERE id=?").get(cancelled.id).state, "aborted");
  assert.ok(bucket.abortedUploads.has(cancelled.uploadId));
});

test("scheduled cleanup aborts expired multipart sessions without creating media", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const environment = env(database, bucket);
  const response = await handleConstructApi(request("/api/admin/media/uploads", {
    method: "POST", admin: true, body: { filename: "expired.mp4", mimeType: "video/mp4", byteSize: 3 },
  }), environment);
  const upload = (await response.json()).upload;
  database.prepare("UPDATE media_upload_sessions SET expires_at=datetime('now','-1 minute') WHERE id=?").run(upload.id);
  assert.deepEqual(await reapStaleMediaUploads(environment), { aborted: 1 });
  assert.equal(database.prepare("SELECT state FROM media_upload_sessions WHERE id=?").get(upload.id).state, "aborted");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM media_assets WHERE id=?").get(upload.mediaId).count, 0);
});

test("stored media supports HEAD and valid full, partial, suffix, and invalid ranges", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "range-primary", state: "published", primaryPublicVisible: true });
  await bucket.put("portfolio/range-primary.jpg", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const environment = env(database, bucket);
  const mediaUrl = "https://example.test/api/portfolio/media/range-primary";

  let response = await handlePortfolioApi(new Request(mediaUrl, { method: "HEAD" }), environment);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "10");
  response = await handlePortfolioApi(new Request(mediaUrl, { headers: { range: "bytes=2-5" } }), environment);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5]);
  response = await handlePortfolioApi(new Request(mediaUrl, { headers: { range: "bytes=-3" } }), environment);
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7, 8, 9]);
  response = await handlePortfolioApi(new Request(mediaUrl, { headers: { range: "bytes=99-100" } }), environment);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */10");
});

test("portfolio accepts completed video as mixed media but rejects video Before and cover roles", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  insertPortfolioItem(database, { id: "mixed-media", state: "draft", primaryPublicVisible: true });
  database.prepare(`INSERT INTO media_assets(
    id,storage_key,original_filename,mime_type,byte_size,alt_text,privacy,state,
    created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_presentation
  ) VALUES('portfolio-video','construct/portfolio-video/clip.mp4','clip.mp4','video/mp4',7,'Tattoo process video',
    'public','active','test',datetime('now'),datetime('now'),'Spoken process notes','ready','en','inline')`).run();
  await bucket.put("construct/portfolio-video/clip.mp4", new Uint8Array([1, 2, 3, 4, 5, 6, 7]), {
    httpMetadata: { contentType: "video/mp4" },
  });
  const environment = env(database, bucket);

  let response = await handlePortfolioApi(request("/api/admin/portfolio/mixed-media/images", {
    method: "POST", admin: true, body: { mediaId: "portfolio-video", imageRole: "process", publicVisible: true },
  }), environment);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).media.kind, "video");
  response = await handlePortfolioApi(request("/api/admin/portfolio/mixed-media/images/portfolio-video", {
    method: "PATCH", admin: true, body: { imageRole: "before" },
  }), environment);
  assert.equal(response.status, 422);
  response = await handlePortfolioApi(request("/api/admin/portfolio/mixed-media/images/portfolio-video", {
    method: "PATCH", admin: true, body: { imageRole: "result", isCover: true },
  }), environment);
  assert.equal(response.status, 422);

  response = await handlePortfolioApi(request("/api/admin/portfolio/mixed-media", {
    method: "PATCH", admin: true, body: { state: "published" },
  }), environment);
  assert.equal(response.status, 200);
  response = await handlePortfolioApi(request("/api/portfolio/mixed-media"), environment);
  const item = (await response.json()).item;
  const video = item.media.find((entry) => entry.id === "portfolio-video");
  assert.equal(video.kind, "video");
  assert.equal(video.transcript, "Spoken process notes");
  assert.equal(item.coverImageRef, "primary");
});

test("Studio resumable client retries parts three times and exposes resume and cancel controls", () => {
  const client = readFileSync(join(ROOT, "studio", "resumable-media-upload.js"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(client, /attempt<4/);
  assert.match(client, /matchingSession/);
  assert.match(client, /method:"DELETE"/);
  assert.match(studio, /data-portfolio-upload-cancel/);
  assert.match(studio, /H\.264\/AAC/);
});

test("Portfolio batch organizer combines, splits, constrains covers, and preserves stable order", () => {
  const source = readFileSync(join(ROOT, "studio", "portfolio-batch-organizer.js"), "utf8");
  const context = {};
  runInNewContext(source, context);
  const revoked = [];
  const organizer = new context.PortfolioBatchOrganizer({
    createPreview: (file) => `preview:${file.name}`,
    revokePreview: (url) => revoked.push(url),
  });
  organizer.addFiles([
    { name: "one.jpg" },
    { name: "two.jpg" },
    { name: "three.jpg" },
  ]);
  assert.deepEqual({ ...organizer.summary() }, {
    entries: 3,
    images: 3,
    selected: 0,
    completedEntries: 0,
    completedImages: 0,
  });
  assert.equal(organizer.groups.every((group) => group.media[0].publicVisible), true);

  const [first, second] = organizer.groups;
  organizer.setSelected(first.id, true);
  organizer.setSelected(second.id, true);
  const combined = organizer.combineSelected();
  assert.deepEqual(Array.from(combined.media, (media) => media.name), ["one.jpg", "two.jpg"]);
  assert.equal(combined.media.filter((media) => media.isCover).length, 1);
  assert.deepEqual(Array.from(organizer.groups, (group) => Array.from(group.media, (media) => media.name)).flat(), ["one.jpg", "two.jpg", "three.jpg"]);

  const secondary = combined.media[1];
  organizer.setRole(combined.id, secondary.id, "detail");
  assert.equal(secondary.publicVisible, true);
  organizer.setRole(combined.id, secondary.id, "process");
  assert.equal(secondary.publicVisible, false);
  organizer.setPublicVisible(combined.id, secondary.id, true);
  assert.equal(secondary.publicVisible, true);
  organizer.setRole(combined.id, secondary.id, "detail");
  organizer.setHealingState(combined.id, secondary.id, "healed");
  organizer.setCover(combined.id, secondary.id);
  assert.equal(secondary.role, "result");
  assert.equal(secondary.publicVisible, true);
  assert.equal(secondary.healingState, "healed");
  assert.throws(() => organizer.setRole(combined.id, secondary.id, "before"), /cover image must remain a Result/);

  const split = organizer.splitMedia(combined.id, secondary.id);
  assert.equal(split.media[0].isCover, true);
  assert.equal(split.media[0].role, "result");
  assert.equal(split.media[0].publicVisible, true);
  assert.deepEqual(Array.from(organizer.groups, (group) => Array.from(group.media, (media) => media.name)).flat(), ["one.jpg", "two.jpg", "three.jpg"]);
  assert.deepEqual({ ...organizer.summary() }, {
    entries: 3,
    images: 3,
    selected: 0,
    completedEntries: 0,
    completedImages: 0,
  });

  const retryGroup = organizer.groups[0];
  const retryCover = retryGroup.media[0];
  assert.equal(organizer.uploadStep(retryGroup, retryCover), "create-entry");
  retryGroup.itemId = "draft-id";
  retryCover.imageRef = "primary";
  retryCover.uploadStatus = "uploaded";
  assert.equal(organizer.uploadStep(retryGroup, retryCover), "document-media");
  retryCover.uploadStatus = "complete";
  assert.equal(organizer.uploadStep(retryGroup, retryCover), "complete");
  const retrySecondary = { isCover: false, imageRef: "", uploadStatus: "pending" };
  assert.equal(organizer.uploadStep(retryGroup, retrySecondary), "upload-media");
  retrySecondary.imageRef = "media-id";
  retrySecondary.uploadStatus = "uploaded";
  assert.equal(organizer.uploadStep(retryGroup, retrySecondary), "document-media");
  retrySecondary.uploadStatus = "complete";
  assert.equal(organizer.uploadStep(retryGroup, retrySecondary), "complete");

  organizer.reset();
  assert.deepEqual(revoked, ["preview:one.jpg", "preview:two.jpg", "preview:three.jpg"]);
});

test("Portfolio batch organizer is session-only, skips duplicates, and caps logical draft groups at 50", () => {
  const source = readFileSync(join(ROOT, "studio", "portfolio-batch-organizer.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  const context = {};
  runInNewContext(source, context);
  const organizer = new context.PortfolioBatchOrganizer({
    createPreview: (file) => `preview:${file.name}`,
    revokePreview: () => {},
  });
  const files = Array.from({ length: 50 }, (_, index) => ({
    name: `tattoo-${index}.jpg`,
    size: 1000 + index,
    lastModified: 100000 + index,
    type: "image/jpeg",
  }));
  const added = organizer.addFiles([...files, files[0]]);
  assert.equal(added.length, 50);
  assert.equal(organizer.lastAddDuplicates.length, 1);
  assert.equal(organizer.groups.length, 50);
  assert.equal(organizer.addFiles([files[0]]).length, 0);
  assert.equal(organizer.lastAddDuplicates.length, 1);
  const [first, second] = organizer.groups;
  organizer.setSelected(first.id, true);
  organizer.setSelected(second.id, true);
  organizer.combineSelected();
  assert.equal(organizer.groups.length, 49);
  assert.equal(organizer.addFiles([{
    name: "overflow.jpg",
    size: 9999,
    lastModified: 999999,
    type: "image/jpeg",
  }]).length, 1);
  assert.equal(organizer.groups.length, 50);
  assert.throws(() => organizer.addFiles([{
    name: "overflow-again.jpg",
    size: 10000,
    lastModified: 1000000,
    type: "image/jpeg",
  }]), /at most 50 draft entries/);
});

test("Studio Portfolio loads the pre-upload organizer and resumable retry controls", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /portfolio-batch-organizer\.js/);
  assert.match(studio, /id="portfolioBatch"/);
  assert.match(studio, /data-batch-combine/);
  assert.match(studio, /data-batch-split/);
  assert.match(studio, /Retry unfinished uploads/);
  assert.match(studio, /stagePortfolioFiles/);
  assert.match(studio, /uploadPortfolioBatch/);
  assert.match(studio, /const PORTFOLIO_BATCH_CONCURRENCY = 2/);
  assert.match(studio, /Math\.min\(PORTFOLIO_BATCH_CONCURRENCY, groups\.length\)/);
  assert.match(studio, /upload\.append\("state", "draft"\)/);
  assert.match(studio, /primaryPublicVisible/);
  assert.match(studio, /publicVisible/);
  assert.match(studio, /data-batch-public/);
  assert.doesNotMatch(studio, /PORTFOLIO_CONSENT_STATUSES|Publication permission|name="consentStatus"|consentStatus:\s*"unknown"/);
});
