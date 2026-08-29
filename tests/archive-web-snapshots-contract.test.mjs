import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { archiveViewerOrigin } from "../functions/api/construct/_web-snapshots.js";
import { handleArchiveViewerRequest } from "../workers/archive-viewer/src/lib.js";
import { inspectCommit, readCommitFile, SEED_COMMIT } from "../tools/archive-web-history.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "archive-web-snapshots-test-token";

class D1Statement {
  constructor(database, sql, values = [], owner = null) { this.database = database; this.sql = sql; this.values = values; this.owner = owner; }
  bind(...values) { return new D1Statement(this.database, this.sql, values, this.owner); }
  async first() {
    if (this.owner?.beforeFirst) await this.owner.beforeFirst(this);
    return this.database.prepare(this.sql).get(...this.values) || null;
  }
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
  prepare(sql) { return new D1Statement(this.database, sql, [], this); }
  async batch(statements) {
    if (this.failBatchWhen?.(statements)) throw new Error("Injected D1 batch failure");
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

class MockR2Bucket {
  constructor() { this.objects = new Map(); }
  async put(key, body, options = {}) {
    if (this.beforePut) await this.beforePut(key);
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
    return { key, size: bytes.byteLength };
  }
  async get(key) {
    if (this.beforeGet) await this.beforeGet(key);
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      size: object.bytes.byteLength,
      body: new Blob([object.bytes]).stream(),
      text: async () => new TextDecoder().decode(object.bytes),
      httpEtag: '"mock-r2-etag"',
    };
  }
  async head(key) {
    const object = this.objects.get(key);
    return object ? { size: object.bytes.byteLength, httpEtag: '"mock-r2-etag"' } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

function database() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function runtime(database) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: TOKEN,
    SUBMISSION_FILES: new MockR2Bucket(),
    ARCHIVE_VIEWER_SIGNING_KEY: "test-only-viewer-signing-key",
  };
}

function request(path, { method = "GET", body, raw, contentType = "application/json", admin = false } = {}) {
  const payload = raw === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : raw;
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(payload === undefined ? {} : { "content-type": contentType }),
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
}

async function responseJson(response) { return { status: response.status, body: await response.json() }; }

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function rawUpload(env, snapshotId, path, source, contentType) {
  return responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/files/${encodeURIComponent(path)}`, {
    method: "PUT", admin: true, raw: source, contentType,
  }), env));
}

async function startWebsiteArchive(env) {
  return responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", {
    method: "POST", admin: true, body: {},
  }), env));
}

async function createWebsiteSnapshot(env, dossierId, stateId, title) {
  return responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: dossierId,
      state_id: stateId,
      title,
      source_kind: "git",
      lineage_role: "canonical-state",
      entry_path: "index.html",
    },
  }), env));
}

const PNG_FIXTURE = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);

async function uploadCapture(env, path, bytes = PNG_FIXTURE) {
  return responseJson(await handleConstructApi(request(path, {
    method: "PUT", admin: true, raw: bytes, contentType: "image/png",
  }), env));
}

async function uploadReplacement(env, snapshotId, dependencyId, path, file, type) {
  const form = new FormData();
  form.append("file", new Blob([file], { type }), path.split("/").pop());
  form.append("path", path);
  return responseJson(await handleConstructApi(new Request(`https://example.test/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/dependencies/${encodeURIComponent(dependencyId)}/replacement`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env));
}

async function createSouthWall(database, env) {
  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-blackboards/records", {
    method: "POST", admin: true, body: {
      title: "Studio Blackboard — South Wall",
      slug: "studio-blackboard-south-wall",
      studio_location: "Studio",
      wall_designation: "South Wall",
      summary: "The whole-board South Wall record.",
      date_precision: "undated",
    },
  }), env));
  assert.equal(created.status, 201, created.body.error);
  const primaryThread = "origin-thread-existing-south-wall";
  database.prepare(`INSERT INTO archive_origin_threads
    (id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,'Existing South Wall thread','','draft',0,0,'test','test',datetime('now'),datetime('now'))`).run(primaryThread, primaryThread);
  database.prepare(`INSERT INTO archive_origin_thread_entities(thread_id,entity_id,is_primary,sort_order,created_at)
    VALUES(?,?,1,1,datetime('now'))`).run(primaryThread, created.body.record.id);
  return created.body.record;
}

test("website starter, immutable R2 source trees, scans, preview tokens, and public gates work together", async () => {
  const sql = database(), env = runtime(sql), southWall = await createSouthWall(sql, env);

  const unauthenticated = await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST" }), env);
  assert.equal(unauthenticated.status, 401);

  const firstStart = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  assert.equal(firstStart.status, 201, firstStart.body.error);
  assert.equal(firstStart.body.record.cultural_object_type_id, "other-website");
  assert.match(firstStart.body.catalogue.catalogue_id, /^OBJ-\d{3}$/);
  assert.equal(firstStart.body.state.title, "First committed landing page");
  assert.equal(firstStart.body.state.publication_state, "draft");
  assert.equal(firstStart.body.blackboard_linked, true);

  const secondStart = await responseJson(await handleConstructApi(request("/api/admin/archive-web/start", { method: "POST", admin: true, body: {} }), env));
  assert.equal(secondStart.status, 200, secondStart.body.error);
  assert.equal(secondStart.body.record.id, firstStart.body.record.id);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_records WHERE slug='the-six-well-construct-website'").get().count, 1);
  assert.deepEqual(
    { ...sql.prepare("SELECT thread_id,is_primary FROM archive_origin_thread_entities WHERE entity_id=? AND is_primary=1").get(southWall.id) },
    { thread_id: "origin-thread-existing-south-wall", is_primary: 1 },
  );
  const contextualMembership = sql.prepare(`SELECT member.is_primary FROM archive_origin_thread_entities member
    JOIN archive_origin_threads thread ON thread.id=member.thread_id
    WHERE member.entity_id=? AND thread.slug='inception-of-the-six-well-construct-website'`).get(southWall.id);
  assert.equal(contextualMembership.is_primary, 0);
  const relation = sql.prepare("SELECT * FROM entity_relationships WHERE source_entity_id=? AND target_entity_id=? AND relationship_type_id='rel-informed'").get(southWall.id, firstStart.body.record.id);
  assert.equal(relation.public_visible, 0);
  assert.match(relation.internal_notes, /closer Blackboard fragment/);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragments WHERE record_entity_id=?").get(southWall.id).count, 0);

  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: firstStart.body.record.id,
      state_id: firstStart.body.state.id,
      title: "First committed landing page",
      source_kind: "git",
      lineage_role: "canonical-state",
      entry_path: "index.html",
      git_commit_sha: "11cf57741bc8c03bfca3412e56090591b9abdcdc",
      git_commit_at: "2026-04-15T20:30:19-04:00",
      git_author: "thoughtpuppet",
      git_message: "Add files via upload",
    },
  }), env));
  assert.equal(created.status, 201, created.body.error);
  const snapshotId = created.body.record.id;
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="styles/site.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk">
    </head><body><img src="assets/logo.png"><a href="/about/">About</a><script src="js/app.js"></script></body></html>`;
  assert.equal((await rawUpload(env, snapshotId, "index.html", html, "text/html")).status, 201);

  const incomplete = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(incomplete.status, 200, incomplete.body.error);
  assert.equal(incomplete.body.record.scan_status, "needs-files");
  assert.equal(incomplete.body.record.dependency_summary.missing, 3);
  assert.equal(incomplete.body.record.dependency_summary["external-blocked"], 1);
  assert.equal(incomplete.body.record.dependency_summary.navigation, 1);

  assert.equal((await rawUpload(env, snapshotId, "styles/site.css", "@font-face{font-family:Archive;src:url('../fonts/site.woff2')}body{font-family:Archive}", "text/css")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "assets/logo.png", "not-a-real-png-but-an-immutable-fixture", "image/png")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "js/app.js", "document.body.dataset.ready='yes';", "text/javascript")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "fonts/site.woff2", "font-fixture", "font/woff2")).status, 201);

  const identicalRetry = await rawUpload(env, snapshotId, "js/app.js", "document.body.dataset.ready='yes';", "text/javascript");
  assert.equal(identicalRetry.status, 200);
  assert.equal(identicalRetry.body.unchanged, true);
  const conflictingRetry = await rawUpload(env, snapshotId, "js/app.js", "document.body.dataset.ready='different';", "text/javascript");
  assert.equal(conflictingRetry.status, 409);

  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(finalized.status, 200, finalized.body.error);
  assert.equal(finalized.body.record.scan_status, "ready");
  assert.equal(finalized.body.record.file_count, 5);
  assert.match(finalized.body.record.tree_sha256, /^[a-f0-9]{64}$/);
  assert.ok(finalized.body.record.material_id);
  assert.equal(sql.prepare("SELECT visibility,state FROM archive_materials WHERE id=?").get(finalized.body.record.material_id).visibility, "internal");
  assert.equal(env.SUBMISSION_FILES.objects.size, 10, "each viewer-eligible source has separate source and viewer objects");

  const sourceTreeBeforeCapture = finalized.body.record.tree_sha256;
  const seedCapture = await uploadCapture(env, `/api/admin/archive-web-snapshots/${snapshotId}/captures/desktop`);
  assert.equal(seedCapture.status, 201, seedCapture.body.error);
  assert.equal(seedCapture.body.capture.candidate_id, null, "the inaugural fallback is attached directly to the snapshot, not a fabricated candidate");
  assert.equal(seedCapture.body.capture.derivative_role, "generated-viewer-capture");
  assert.match(seedCapture.body.capture.public_url, /__archive_capture__/);
  const capturePreview = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/captures/desktop/preview`, {
    method: "POST", admin: true, body: {},
  }), env));
  assert.equal(capturePreview.status, 200, capturePreview.body.error);
  assert.match(capturePreview.body.preview.preview_url, /\/p\/v1\./);
  assert.equal((await handleArchiveViewerRequest(new Request(capturePreview.body.preview.preview_url), env)).status, 200, "a signed Studio image preview does not need publication");
  assert.equal((await handleArchiveViewerRequest(new Request(seedCapture.body.capture.public_url), env)).status, 404, "the stored public URL stays gated while the record is a draft");
  assert.equal(sql.prepare("SELECT tree_sha256 FROM archive_web_snapshots WHERE id=?").get(snapshotId).tree_sha256, sourceTreeBeforeCapture);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_files WHERE snapshot_id=?").get(snapshotId).count, 5);

  const unauthenticatedBehaviors = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/behaviors`, {
    method: "PUT", body: { records: [] },
  }), env);
  assert.equal(unauthenticatedBehaviors.status, 401);
  const behaviorRecord = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/behaviors`, {
    method: "PUT", admin: true, body: { records: [
      {
        behavior_key: "six-living-cultures",
        title: "Six living cultures",
        evolution_role: "introduced",
        interaction_prompt: "Watch the six dots before opening the construct.",
        observed_behavior: "Six dots orbit and vibrate before becoming six medium nodes.",
        authored_meaning: "The six dots represent live cultures in a six-well petri dish.",
        meaning_status: "curator-authored",
        source_path: "index.html",
        source_symbol: "drawRing; deployNodes",
        public_visible: true,
        sort_order: 10,
      },
      {
        behavior_key: "breathing-eyes",
        title: "Breathing eyes",
        evolution_role: "introduced",
        observed_behavior: "Ten eye rings breathe on a shared sine cycle.",
        meaning_status: "pending-interpretation",
        source_path: "index.html",
        public_visible: false,
        sort_order: 20,
      },
    ] },
  }), env));
  assert.equal(behaviorRecord.status, 200, behaviorRecord.body.error);
  assert.equal(behaviorRecord.body.record.behaviors.length, 2);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_behaviors WHERE snapshot_id=?").get(snapshotId).count, 2);
  assert.equal(sql.prepare("SELECT tree_sha256 FROM archive_web_snapshots WHERE id=?").get(snapshotId).tree_sha256, sourceTreeBeforeCapture, "behavior notes do not mutate source evidence");

  const preview = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/preview`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(preview.status, 200, preview.body.error);
  assert.match(preview.body.preview.token, /^v1\.\d+\.[A-Za-z0-9_-]+$/);
  assert.match(preview.body.preview.viewer_url, /^https:\/\/archive-viewer\.thesixwellconstruct\.com\/p\/v1\./);
  assert.match(preview.body.preview.viewer_url, new RegExp(`/s/${snapshotId}/index\\.html$`));

  const approved = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { viewer_approved: true },
  }), env));
  assert.equal(approved.status, 200, approved.body.error);
  assert.equal(approved.body.record.viewer_approved, true);
  assert.equal(approved.body.record.publication_state, "draft");
  const blockedStateMove = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { state_id: "" },
  }), env);
  assert.equal(blockedStateMove.status, 409);
  assert.equal((await handleConstructApi(request("/api/archive/items/the-six-well-construct-website"), env)).status, 404);

  const versionId = firstStart.body.version.id, stateId = firstStart.body.state.id, materialId = approved.body.record.material_id;
  sql.prepare("UPDATE content_entities SET visibility='public' WHERE id IN (?,?)").run(firstStart.body.record.id, southWall.id);
  sql.prepare("UPDATE archive_records SET state='published' WHERE id IN (?,?)").run(firstStart.body.record.id, southWall.id);
  sql.prepare("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id IN (?,?)").run(firstStart.body.record.id, southWall.id);
  sql.prepare("UPDATE archive_object_versions SET publication_state='published',public_visible=1 WHERE id=?").run(versionId);
  sql.prepare("UPDATE archive_object_states SET publication_state='published',public_visible=1 WHERE id=?").run(stateId);
  sql.prepare("UPDATE archive_materials SET state='published',visibility='public' WHERE id=?").run(materialId);
  sql.prepare("UPDATE entity_relationships SET public_visible=1 WHERE id=?").run(relation.id);

  const published = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { publication_state: "published", public_visible: true },
  }), env));
  assert.equal(published.status, 200, published.body.error);
  const publicDetail = await responseJson(await handleConstructApi(request("/api/archive/items/the-six-well-construct-website"), env));
  assert.equal(publicDetail.status, 200, publicDetail.body.error);
  assert.equal(publicDetail.body.web_snapshots.length, 1);
  assert.equal(publicDetail.body.web_snapshots[0].tree_sha256, finalized.body.record.tree_sha256);
  assert.equal(publicDetail.body.web_snapshots[0].screenshot_url, seedCapture.body.capture.public_url);
  assert.equal(publicDetail.body.web_snapshots[0].behaviors.length, 1, "only explicitly public behavior notes enter the public projection");
  assert.equal(publicDetail.body.web_snapshots[0].behaviors[0].behavior_key, "six-living-cultures");
  assert.equal(publicDetail.body.web_snapshots[0].behaviors[0].meaning_status, "curator-authored");
  const publicCapture = await handleArchiveViewerRequest(new Request(seedCapture.body.capture.public_url), env);
  assert.equal(publicCapture.status, 200);
  assert.equal(publicCapture.headers.get("x-archive-derivative-role"), "generated-viewer-capture");
  assert.ok(!JSON.stringify(publicDetail.body.web_snapshots).includes("source_storage_key"));
  assert.ok(!JSON.stringify(publicDetail.body.web_snapshots).includes("original_reference"));
  const blackboardRelationship = publicDetail.body.relationships.find((entry) => entry.related.id === southWall.id);
  assert.equal(blackboardRelationship.label, "Informed by");
  assert.equal(blackboardRelationship.related.archiveRoute, "/archive/blackboards/studio-blackboard-south-wall/");

  const withdrawn = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { publication_state: "draft", viewer_approved: false },
  }), env);
  assert.equal(withdrawn.status, 200);
  const lockedMetadata = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { git_message: "A published Material must be returned to draft first." },
  }), env);
  assert.equal(lockedMetadata.status, 409);
});

test("viewer origins accept only the production custom domain or an explicit local test server", () => {
  assert.equal(archiveViewerOrigin("http://127.0.0.1:8788"), "http://127.0.0.1:8788");
  assert.equal(archiveViewerOrigin("http://localhost:8788/"), "http://localhost:8788");
  assert.equal(archiveViewerOrigin("https://malicious.example.test"), "https://archive-viewer.thesixwellconstruct.com");
});

test("the first meaningful committed index produces the approved dependency profile", async () => {
  const sql = database(), env = runtime(sql);
  const inspection = inspectCommit(SEED_COMMIT, "index.html");
  const started = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: started.body.record.id,
      state_id: started.body.state.id,
      title: "First committed landing page",
      source_kind: "git",
      lineage_role: "canonical-state",
      entry_path: "index.html",
      git_commit_sha: "11cf57741bc8c03bfca3412e56090591b9abdcdc",
      expected_tree_sha256: inspection.tree_sha256,
    },
  }), env));
  const source = execFileSync("git", ["show", "11cf57741bc8c03bfca3412e56090591b9abdcdc:index.html"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const upload = await rawUpload(env, created.body.record.id, "index.html", source, "text/html; charset=utf-8");
  assert.equal(upload.status, 201, upload.body.error);
  assert.equal(upload.body.file.source_sha256, "08c1ecfb9851ecaf6c54164285a94865c4d7c0ccc72faee0bf518cf8405ac78c");
  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${created.body.record.id}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(finalized.status, 200, finalized.body.error);
  assert.equal(finalized.body.record.scan_status, "ready");
  assert.equal(finalized.body.record.tree_sha256, inspection.tree_sha256, "the API and Git tool use the same versioned tree framing");
  assert.equal(finalized.body.record.expected_tree_sha256, inspection.tree_sha256);
  assert.equal(finalized.body.record.dependency_summary.missing || 0, 0);
  assert.equal(finalized.body.record.dependency_summary.embedded, 2);
  assert.equal(finalized.body.record.dependency_summary["external-blocked"], 1);
  assert.equal(finalized.body.record.dependency_summary.navigation, 45);

  const mismatched = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: started.body.record.id,
      state_id: started.body.state.id,
      title: "Mismatched Git manifest",
      source_kind: "git",
      lineage_role: "canonical-state",
      entry_path: "index.html",
      expected_tree_sha256: "f".repeat(64),
    },
  }), env));
  assert.equal((await rawUpload(env, mismatched.body.record.id, "index.html", source, "text/html; charset=utf-8")).status, 201);
  const rejectedMismatch = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${mismatched.body.record.id}/finalize`, {
    method: "POST", admin: true, body: {},
  }), env));
  assert.equal(rejectedMismatch.status, 409);
  const preservedMismatch = sql.prepare(`SELECT scan_status,scan_revision,tree_sha256,expected_tree_sha256,mutation_token
    FROM archive_web_snapshots WHERE id=?`).get(mismatched.body.record.id);
  assert.equal(preservedMismatch.scan_status, "blocked");
  assert.equal(preservedMismatch.scan_revision, -1);
  assert.equal(preservedMismatch.tree_sha256, inspection.tree_sha256, "the actual immutable tree remains recorded as mismatch evidence");
  assert.equal(preservedMismatch.expected_tree_sha256, "f".repeat(64));
  assert.equal(preservedMismatch.mutation_token, "");
});

test("external replacements are private derivatives and never change the immutable source tree", async () => {
  const sql = database(), env = runtime(sql);
  const started = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: started.body.record.id,
      state_id: started.body.state.id,
      title: "External provenance fixture",
      source_kind: "git",
      lineage_role: "canonical-state",
      entry_path: "index.html",
      git_commit_sha: "external-fixture",
    },
  }), env));
  const snapshotId = created.body.record.id;
  const html = `<!doctype html><link rel="stylesheet" href="https://legacy.example/site.css"><img src="https://legacy.example/eye.png">`;
  assert.equal((await rawUpload(env, snapshotId, "index.html", html, "text/html")).status, 201);
  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(finalized.status, 200, finalized.body.error);
  const sourceTree = finalized.body.record.tree_sha256;
  assert.equal(finalized.body.record.file_count, 1);

  const verified = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { expected_tree_sha256: sourceTree },
  }), env));
  assert.equal(verified.status, 200, verified.body.error);
  assert.equal(verified.body.record.expected_tree_sha256, sourceTree, "legacy Git rows can receive their first verified expected hash");
  const changedExpected = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { expected_tree_sha256: "f".repeat(64) },
  }), env);
  assert.equal(changedExpected.status, 409, "a non-empty expected hash cannot be changed");

  const imageDependency = finalized.body.dependencies.find((dependency) => dependency.original_reference.endsWith("eye.png"));
  const mapped = await uploadReplacement(env, snapshotId, imageDependency.id, "external-replacements/eye.png", PNG_FIXTURE, "image/png");
  assert.equal(mapped.status, 201, mapped.body.error);
  assert.equal(mapped.body.replacement.derivative_role, "external-resource-replacement");
  assert.equal(mapped.body.replacement.local_path, "external-replacements/eye.png");
  assert.ok(!JSON.stringify(mapped.body).includes("storage_key"), "private R2 keys never leave the admin projection");
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_files WHERE snapshot_id=?").get(snapshotId).count, 1);
  assert.equal(sql.prepare("SELECT tree_sha256,file_count,total_bytes FROM archive_web_snapshots WHERE id=?").get(snapshotId).tree_sha256, sourceTree);
  const preserved = sql.prepare("SELECT original_reference,resolved_path,status,notes FROM archive_web_snapshot_dependencies WHERE id=?").get(imageDependency.id);
  assert.equal(preserved.original_reference, "https://legacy.example/eye.png");
  assert.deepEqual({ resolved_path: preserved.resolved_path, status: preserved.status, notes: preserved.notes }, {
    resolved_path: "external-replacements/eye.png", status: "resolved", notes: "local-external-replacement",
  });

  const rescanned = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(rescanned.status, 200, rescanned.body.error);
  assert.equal(rescanned.body.record.tree_sha256, sourceTree);
  assert.equal(rescanned.body.record.file_count, 1);
  const preservedAfterRescan = rescanned.body.dependencies.find((dependency) => dependency.original_reference.endsWith("eye.png"));
  assert.equal(preservedAfterRescan.status, "resolved");
  assert.equal(preservedAfterRescan.notes, "local-external-replacement");

  const stylesheetDependency = rescanned.body.dependencies.find((dependency) => dependency.original_reference.endsWith("site.css"));
  const credentialReplacement = await uploadReplacement(env, snapshotId, stylesheetDependency.id, "external-replacements/site.css", "/* -----BEGIN PRIVATE KEY----- */", "text/css");
  assert.equal(credentialReplacement.status, 409);
  assert.match(credentialReplacement.body.error, /suspected credential/i);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_replacements WHERE snapshot_id=?").get(snapshotId).count, 1);
  assert.equal(sql.prepare("SELECT tree_sha256 FROM archive_web_snapshots WHERE id=?").get(snapshotId).tree_sha256, sourceTree);
});

test("raw imports reject unsafe packages and report srcset, root paths, dynamic JavaScript, and unsupported WASM", async () => {
  const sql = database(), env = runtime(sql);
  const started = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: started.body.record.id, title: "Scanner rejection fixture", source_kind: "upload",
      lineage_role: "exploratory-branch", entry_path: "index.html",
    },
  }), env));
  const snapshotId = created.body.record.id;
  const forgedReadiness = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { accepted_missing_dependency_ids: ["not-a-real-dependency"] },
  }), env));
  assert.equal(forgedReadiness.status, 409);
  assert.match(forgedReadiness.body.error, /finalized scan|current missing/i);
  assert.equal(sql.prepare("SELECT scan_status FROM archive_web_snapshots WHERE id=?").get(snapshotId).scan_status, "draft");
  const forgedScanFields = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { scan_status: "ready", tree_sha256: "f".repeat(64), viewer_approved: true },
  }), env);
  assert.equal(forgedScanFields.status, 409, "client-supplied scan fields cannot manufacture viewer readiness");
  const html = `<!doctype html><img srcset="images/one.png?v=1 1x, /images/two.png#crop 2x">
  <button onclick="if (1 > 0) location.assign.call(location, '/call')">Call</button>
  <button onmouseover='const replace=location.replace.bind(location);replace("/bound")'>Bound</button>
  <button onfocus=loc\\u0061tion.reload()>Escaped</button>
  <button onkeydown="document.createElement(tagName)">Dynamic script construction</button>
  <button onkeyup="document.body.setAttribute('onmouseover', code)">Handler construction</button><script>
    new URL('./engine.wasm', import.meta.url); import('./views/' + page); const navigationAlias = location;
  </script>`;
  assert.equal((await rawUpload(env, snapshotId, "index.html", html, "text/html")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "Assets/Eye.PNG", PNG_FIXTURE, "image/png")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "assets/eye.png", PNG_FIXTURE, "image/png")).status, 409, "case-colliding paths are rejected even with identical bytes");
  assert.equal((await rawUpload(env, snapshotId, "Assets/Eye.PNG", PNG_FIXTURE, "image/png")).body.unchanged, true, "the exact same path remains idempotent");
  for (const unsafePath of ["../escape.txt", "nested/archive.zip", "tools/run.exe", "server/index.php", "engine.wasm"]) {
    const rejected = await rawUpload(env, snapshotId, unsafePath, "unsafe", "application/octet-stream");
    assert.ok([409, 415].includes(rejected.status), `${unsafePath} should be rejected, received ${rejected.status}`);
  }
  const oversized = await rawUpload(env, snapshotId, "oversized.css", "x".repeat((2 * 1024 * 1024) + 1), "text/css");
  assert.equal(oversized.status, 413);

  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(finalized.status, 200, finalized.body.error);
  assert.equal(finalized.body.record.scan_status, "needs-files");
  const wasm = finalized.body.dependencies.find((dependency) => dependency.resolved_path === "engine.wasm");
  assert.equal(wasm.status, "missing");
  assert.equal(wasm.critical, true);
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.original_reference === "dynamic-import(...)" && dependency.status === "unverifiable"));
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.original_reference === "unrewritable-script-navigation:location-alias"
    && dependency.status === "unverifiable" && dependency.critical), "ambiguous Location aliases block public readiness");
  for (const finding of ["location-method-indirection", "escaped-navigation-identifier", "dynamic-script-construction", "dynamic-event-handler-construction"]) {
    assert.ok(finalized.body.dependencies.some((dependency) => dependency.original_reference === `unrewritable-script-navigation:${finding}`
      && dependency.status === "unverifiable" && dependency.critical), `static inline handlers must report ${finding}`);
  }
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.resolved_path === "images/one.png"));
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.resolved_path === "images/two.png"));
});

test("large historical scripts use bounded dependency analysis while credentials still scan the complete source", async () => {
  const sql = database(), env = runtime(sql);
  const started = await startWebsiteArchive(env);
  const created = await createWebsiteSnapshot(env, started.body.record.id, started.body.state.id, "Large vendor script fixture");
  const snapshotId = created.body.record.id;
  const privateKeyMarker = "-----BEGIN PRIVATE KEY-----";
  const rapierSource = readCommitFile("0ec98018e144f0df89049129363cbbaf17548393", "entry-room/3d/vendor/rapier3d-compat.esm.js").toString("utf8");
  const midpoint = Math.floor(rapierSource.length / 2);
  const vendorSource = `${rapierSource.slice(0, midpoint)}\nconst archiveCredentialFixture='${privateKeyMarker}';\n${rapierSource.slice(midpoint)}`;
  assert.ok(vendorSource.length > 512 * 1024);

  assert.equal((await rawUpload(env, snapshotId, "index.html", '<script src="vendor.js"></script>', "text/html")).status, 201);
  assert.equal((await rawUpload(env, snapshotId, "vendor.js", vendorSource, "text/javascript")).status, 201);
  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, {
    method: "POST", admin: true, body: {},
  }), env));

  assert.equal(finalized.status, 200, finalized.body.error);
  assert.equal(finalized.body.record.scan_status, "blocked");
  assert.ok(finalized.body.record.credential_findings.some((finding) => finding.path === "vendor.js" && finding.rule === "private-key"));
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.original_reference === "large-script-static-analysis(...)"
    && dependency.status === "unverifiable" && dependency.critical), "bounded analysis must prevent large scripts from becoming viewer-ready");
  assert.ok(finalized.body.dependencies.some((dependency) => dependency.resolved_path.endsWith("rapier_wasm3d_bg.wasm") && dependency.status === "missing"));
});

test("pending capture evidence remains previewable for an incomplete snapshot and becomes immutable after review", async () => {
  const sql = database(), env = runtime(sql);
  const started = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  const created = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: {
      dossier_entity_id: started.body.record.id, title: "Incomplete WebAssembly direction", source_kind: "git",
      lineage_role: "exploratory-branch", entry_path: "index.html", git_commit_sha: "0ec9801-fixture",
    },
  }), env));
  const snapshotId = created.body.record.id;
  await rawUpload(env, snapshotId, "index.html", "<script>new URL('./engine.wasm', import.meta.url)</script>", "text/html");
  const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(finalized.body.record.scan_status, "needs-files");

  const candidateEvidence = {
    id: "candidate-incomplete-wasm",
    dossier_entity_id: started.body.record.id,
    snapshot_id: snapshotId,
    commits: ["0ec9801-fixture"],
    group_key: "entry-threshold-eye-direction",
    title: "Entry threshold evidence",
    representative_commit: {
      sha: "0ec9801-fixture", parent_sha: "parent-fixture", date: "2026-05-01T12:00:00-04:00",
      author: "Archive Test", message: "Incomplete WebAssembly direction",
    },
    reasons: ["A visually meaningful direction whose unsupported WASM remains missing."],
    changed_paths: ["index.html", "entry-room/3d/vendor/rapier_wasm3d_bg.wasm"],
    score: 77,
    review_decision: "pending",
  };
  const synced = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [candidateEvidence] },
  }), env));
  assert.equal(synced.status, 200, synced.body.error);
  const capture = await uploadCapture(env, "/api/admin/archive-web-history-candidates/candidate-incomplete-wasm/captures/desktop");
  assert.equal(capture.status, 201, capture.body.error);
  assert.equal(capture.body.capture.candidate_id, candidateEvidence.id);
  const preview = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-incomplete-wasm/captures/desktop/preview", {
    method: "POST", admin: true, body: {},
  }), env));
  assert.equal(preview.status, 200, preview.body.error);
  const previewImage = await handleArchiveViewerRequest(new Request(preview.body.preview.preview_url), env);
  assert.equal(previewImage.status, 200, "review evidence can be inspected even though code preview remains needs-files");
  assert.equal(previewImage.headers.get("x-archive-derivative-role"), "generated-viewer-capture");
  assert.equal((await handleArchiveViewerRequest(new Request(capture.body.capture.public_url), env)).status, 404, "pending evidence is never public");
  const candidateList = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-history-candidates?entity_id=${encodeURIComponent(started.body.record.id)}`, { admin: true }), env));
  assert.equal(candidateList.body.records[0].captures.find((item) => item.viewport === "desktop").sha256, capture.body.capture.sha256);

  const skipped = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-incomplete-wasm/review", {
    method: "POST", admin: true, body: { decision: "skipped", curator_note: "Preserve the capture, but do not promote incomplete executable evidence." },
  }), env));
  assert.equal(skipped.status, 200, skipped.body.error);
  assert.equal(skipped.body.record.decision, "skipped");
  assert.equal((await uploadCapture(env, "/api/admin/archive-web-history-candidates/candidate-incomplete-wasm/captures/desktop")).status, 409);

  const idempotentSync = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [candidateEvidence] },
  }), env));
  assert.equal(idempotentSync.status, 200, idempotentSync.body.error);
  assert.equal(idempotentSync.body.records[0].decision, "skipped");
  const mutatedEvidence = await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [{ ...candidateEvidence, reasons: ["Changed after review"] }] },
  }), env);
  assert.equal(mutatedEvidence.status, 409);
});

test("credential findings block viewer approval and candidate reviews create draft states only", async () => {
  const sql = database(), env = runtime(sql);
  const started = await responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots/start", { method: "POST", admin: true, body: {} }), env));
  assert.equal(started.status, 201, started.body.error);
  const create = async (title, stateId = null) => responseJson(await handleConstructApi(request("/api/admin/archive-web-snapshots", {
    method: "POST", admin: true, body: { dossier_entity_id: started.body.record.id, state_id: stateId, title, source_kind: "git", lineage_role: "canonical-state", entry_path: "index.html" },
  }), env));

  const credential = await create("Credential fixture", started.body.state.id);
  await rawUpload(env, credential.body.record.id, "index.html", "<script>const key='-----BEGIN PRIVATE KEY-----';</script>", "text/html");
  const blocked = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${credential.body.record.id}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(blocked.body.record.scan_status, "blocked");
  assert.equal(blocked.body.record.credential_findings[0].rule, "private-key");
  const rejectedApproval = await handleConstructApi(request(`/api/admin/archive-web-snapshots/${credential.body.record.id}`, { method: "PATCH", admin: true, body: { viewer_approved: true } }), env);
  assert.equal(rejectedApproval.status, 409);

  const candidateSnapshot = await create("Second meaningful direction");
  await rawUpload(env, candidateSnapshot.body.record.id, "index.html", "<!doctype html><title>Second direction</title><img src='https://legacy.example/second.png'>", "text/html");
  const candidateFinal = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${candidateSnapshot.body.record.id}/finalize`, { method: "POST", admin: true, body: {} }), env));
  assert.equal(candidateFinal.body.record.scan_status, "ready");
  assert.equal(candidateFinal.body.record.material_id, null);

  const bypassedReview = await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [{
      id: "candidate-bypassed-review",
      dossier_entity_id: started.body.record.id,
      commit_sha: "bypassed",
      review_decision: "skipped",
      curator_note: "This must still pass through the review endpoint.",
    }] },
  }), env);
  assert.equal(bypassedReview.status, 409);

  const sync = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [{
      id: "candidate-second-direction",
      dossier_entity_id: started.body.record.id,
      snapshot_id: candidateSnapshot.body.record.id,
      commits: ["97aa62f"],
      representative_commit: { sha: "97aa62f", date: "2026-04-20T12:00:00-04:00", message: "Second direction" },
      reason: "Structural landing-page direction",
      review_decision: "pending",
    }] },
  }), env));
  assert.equal(sync.status, 200, sync.body.error);
  assert.equal(sync.body.records[0].decision, "pending");
  assert.deepEqual(sync.body.records[0].commit_group, ["97aa62f"]);

  const missingNote = await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-second-direction/review", {
    method: "POST", admin: true, body: { decision: "approved-state", version_id: started.body.version.id, state_title: "Second direction" },
  }), env);
  assert.equal(missingNote.status, 409);

  sql.prepare("UPDATE archive_web_history_candidates SET reviewed_by='archive-web-review-claim-concurrent-test' WHERE id='candidate-second-direction'").run();
  const statesBeforeClaimedReview = sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count;
  const concurrentlyClaimed = await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-second-direction/review", {
    method: "POST", admin: true, body: { decision: "approved-state", version_id: started.body.version.id, state_title: "Second direction", curator_note: "A competing review must not create history." },
  }), env);
  assert.equal(concurrentlyClaimed.status, 409);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count, statesBeforeClaimedReview);
  sql.prepare("UPDATE archive_web_history_candidates SET reviewed_by='' WHERE id='candidate-second-direction'").run();

  const review = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-second-direction/review", {
    method: "POST", admin: true, body: { decision: "approved-state", version_id: started.body.version.id, state_title: "Second direction", curator_note: "Approved as a meaningful canonical change." },
  }), env));
  assert.equal(review.status, 200, review.body.error);
  assert.equal(review.body.record.decision, "approved-state");
  assert.equal(review.body.snapshot.lineage_role, "canonical-state");
  assert.ok(review.body.snapshot.material_id);
  const newState = sql.prepare("SELECT * FROM archive_object_states WHERE id=?").get(review.body.record.state_id);
  assert.equal(newState.state_roman, "II");
  assert.equal(newState.publication_state, "draft");
  const material = sql.prepare("SELECT * FROM archive_materials WHERE id=?").get(review.body.record.material_id);
  assert.equal(material.state, "draft");
  assert.equal(material.visibility, "internal");
  assert.equal(sql.prepare("SELECT public_visible FROM entity_activity WHERE id=?").get(review.body.record.activity_id).public_visible, 0);
  assert.deepEqual({ ...sql.prepare(`SELECT public_visible,sort_order FROM entity_activity_subjects
    WHERE activity_id=? AND subject_entity_id=?`).get(review.body.record.activity_id, started.body.record.id) }, {
    public_visible: 0,
    sort_order: 1,
  });
  assert.equal((await rawUpload(env, candidateSnapshot.body.record.id, "after-review.js", "console.log('changed')", "text/javascript")).status, 409);
  assert.equal((await handleConstructApi(request(`/api/admin/archive-web-snapshots/${candidateSnapshot.body.record.id}/finalize`, { method: "POST", admin: true, body: {} }), env)).status, 409);
  assert.equal((await handleConstructApi(request(`/api/admin/archive-web-snapshots/${candidateSnapshot.body.record.id}`, {
    method: "PATCH", admin: true, body: { git_message: "Changed after review" },
  }), env)).status, 409);
  const commitDateBefore = sql.prepare("SELECT git_commit_date FROM archive_web_snapshots WHERE id=?").get(candidateSnapshot.body.record.id).git_commit_date;
  assert.equal((await handleConstructApi(request(`/api/admin/archive-web-snapshots/${candidateSnapshot.body.record.id}`, {
    method: "PATCH", admin: true, body: { git_commit_at: "2026-08-29T10:00:00-04:00" },
  }), env)).status, 409, "the git_commit_at alias is historical evidence and stays immutable after review");
  assert.equal(sql.prepare("SELECT git_commit_date FROM archive_web_snapshots WHERE id=?").get(candidateSnapshot.body.record.id).git_commit_date, commitDateBefore);
  assert.equal((await uploadCapture(env, `/api/admin/archive-web-snapshots/${candidateSnapshot.body.record.id}/captures/mobile`)).status, 409,
    "generated screenshots cannot be appended after a curator decision");
  const reviewedExternal = candidateFinal.body.dependencies.find((dependency) => dependency.original_reference.includes("legacy.example/second.png"));
  assert.equal((await uploadReplacement(env, candidateSnapshot.body.record.id, reviewedExternal.id, "external-replacements/second.png", PNG_FIXTURE, "image/png")).status, 409);
});

test("candidate review reuses only a private staged dossier activity", async () => {
  const sql = database(), env = runtime(sql);
  const started = await startWebsiteArchive(env);
  assert.equal(started.status, 201, started.body.error);

  const readyCandidate = async (candidateId, title, commitSha, commitDate) => {
    const snapshot = await createWebsiteSnapshot(env, started.body.record.id, null, title);
    assert.equal(snapshot.status, 201, snapshot.body.error);
    assert.equal((await rawUpload(env, snapshot.body.record.id, "index.html", `<!doctype html><title>${title}</title>`, "text/html")).status, 201);
    const finalized = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshot.body.record.id}/finalize`, {
      method: "POST", admin: true, body: {},
    }), env));
    assert.equal(finalized.status, 200, finalized.body.error);
    assert.equal(finalized.body.record.scan_status, "ready");
    const synchronized = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
      method: "POST", admin: true, body: { records: [{
        id: candidateId,
        dossier_entity_id: started.body.record.id,
        snapshot_id: snapshot.body.record.id,
        representative_commit: { sha: commitSha, date: commitDate, message: title },
        review_decision: "pending",
      }] },
    }), env));
    assert.equal(synchronized.status, 200, synchronized.body.error);
    return snapshot.body.record;
  };

  await readyCandidate("candidate-staged-activity", "Entry Room becomes the root", "da31b71", "2026-07-07T13:15:04-04:00");
  const stagedActivityId = "activity-entry-room-root-staged";
  sql.prepare(`INSERT INTO entity_activity
    (id,entity_id,activity_type,title,notes,occurred_at,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
    VALUES(?,?,'milestone','Puzzle / Entry Room becomes the root','Curator-authored marker.','2026-07-07T13:15:04-04:00',0,3,'studio',datetime('now'),datetime('now'),
      'The Entry Room becomes the front door.','The former landing page moves to /home/.','exact','July 7, 2026','Git commit da31b71.')`).run(
    stagedActivityId, started.body.record.id,
  );
  sql.prepare("UPDATE archive_web_history_candidates SET activity_id=? WHERE id='candidate-staged-activity'").run(stagedActivityId);
  const activitiesBefore = sql.prepare("SELECT COUNT(*) count FROM entity_activity WHERE entity_id=?").get(started.body.record.id).count;

  const reviewed = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-staged-activity/review", {
    method: "POST", admin: true, body: {
      decision: "approved-state",
      version_id: started.body.version.id,
      state_title: "Entry Room becomes the root",
      curator_note: "Approve the source bundle while retaining the authored timeline marker.",
    },
  }), env));
  assert.equal(reviewed.status, 200, reviewed.body.error);
  assert.equal(reviewed.body.record.activity_id, stagedActivityId);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_activity WHERE entity_id=?").get(started.body.record.id).count, activitiesBefore,
    "review must not create a duplicate activity when a safe staged marker is explicitly linked");
  assert.deepEqual({ ...sql.prepare(`SELECT title,body,source_note,public_visible FROM entity_activity
    WHERE id=?`).get(stagedActivityId) }, {
    title: "Puzzle / Entry Room becomes the root",
    body: "The former landing page moves to /home/.",
    source_note: "Git commit da31b71.",
    public_visible: 0,
  }, "review preserves curator-authored activity evidence");
  assert.deepEqual({ ...sql.prepare(`SELECT public_visible,sort_order FROM entity_activity_subjects
    WHERE activity_id=? AND subject_entity_id=?`).get(stagedActivityId, started.body.record.id) }, {
    public_visible: 0,
    sort_order: 1,
  });

  await readyCandidate("candidate-duplicate-staged-activity", "Duplicate staged activity", "duplicate123", "2026-07-08T10:00:00-04:00");
  sql.prepare("UPDATE archive_web_history_candidates SET activity_id=? WHERE id='candidate-duplicate-staged-activity'").run(stagedActivityId);
  const statesBeforeDuplicateReview = sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count;
  const duplicate = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-duplicate-staged-activity/review", {
    method: "POST", admin: true, body: {
      decision: "approved-state",
      version_id: started.body.version.id,
      state_title: "Duplicate staged activity",
      curator_note: "One authored timeline activity cannot stand for two history candidates.",
    },
  }), env));
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /already assigned to another website-history candidate/);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count, statesBeforeDuplicateReview);

  await readyCandidate("candidate-public-staged-activity", "Unsafe staged activity", "unsafe123", "2026-07-08T12:00:00-04:00");
  const publicActivityId = "activity-public-staged";
  sql.prepare(`INSERT INTO entity_activity
    (id,entity_id,activity_type,title,notes,occurred_at,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
    VALUES(?,?,'milestone','Already public','','2026-07-08T12:00:00-04:00',1,0,'studio',datetime('now'),datetime('now'),'','','exact','July 8, 2026','')`).run(
    publicActivityId, started.body.record.id,
  );
  sql.prepare("UPDATE archive_web_history_candidates SET activity_id=? WHERE id='candidate-public-staged-activity'").run(publicActivityId);
  const statesBeforeRejectedReview = sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count;
  const activitiesBeforeRejectedReview = sql.prepare("SELECT COUNT(*) count FROM entity_activity").get().count;
  const rejected = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-public-staged-activity/review", {
    method: "POST", admin: true, body: {
      decision: "approved-state",
      version_id: started.body.version.id,
      state_title: "Unsafe staged activity",
      curator_note: "This must not silently replace a public activity with a duplicate.",
    },
  }), env));
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /private activity owned by this Archive dossier/);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count, statesBeforeRejectedReview);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_activity").get().count, activitiesBeforeRejectedReview);
  assert.deepEqual({ ...sql.prepare("SELECT decision,reviewed_by FROM archive_web_history_candidates WHERE id='candidate-public-staged-activity'").get() }, {
    decision: "pending",
    reviewed_by: "",
  });
});

test("snapshot generation claims serialize finalize, upload, and review while failed uploads remain atomic", async () => {
  const sql = database(), env = runtime(sql);
  const started = await startWebsiteArchive(env);
  const created = await createWebsiteSnapshot(env, started.body.record.id, started.body.state.id, "Generation-lock fixture");
  const snapshotId = created.body.record.id;
  assert.equal((await rawUpload(env, snapshotId, "index.html", "<!doctype html><title>Generation one</title>", "text/html")).status, 201);

  const finalizeEntered = deferred(), allowFinalize = deferred();
  env.SUBMISSION_FILES.beforeGet = async () => {
    env.SUBMISSION_FILES.beforeGet = null;
    finalizeEntered.resolve();
    await allowFinalize.promise;
  };
  const finalizing = handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, {
    method: "POST", admin: true, body: {},
  }), env).then(responseJson);
  await finalizeEntered.promise;
  const uploadDuringFinalize = await rawUpload(env, snapshotId, "during-finalize.js", "console.log('race')", "text/javascript");
  assert.equal(uploadDuringFinalize.status, 409, "a finalizer owns the exact source generation until its scan commits");
  allowFinalize.resolve();
  const finalized = await finalizing;
  assert.equal(finalized.status, 200, finalized.body.error);
  let generation = sql.prepare("SELECT source_revision,scan_revision,scan_status FROM archive_web_snapshots WHERE id=?").get(snapshotId);
  assert.deepEqual({ source_revision: generation.source_revision, scan_revision: generation.scan_revision, scan_status: generation.scan_status }, {
    source_revision: 1, scan_revision: 1, scan_status: "ready",
  });

  const evidence = {
    id: "candidate-generation-lock",
    dossier_entity_id: started.body.record.id,
    snapshot_id: snapshotId,
    commits: ["generation-lock"],
    representative_commit: { sha: "generation-lock", date: "2026-08-29T09:00:00-04:00", message: "Generation lock" },
    review_decision: "pending",
  };
  const synced = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [evidence] },
  }), env));
  assert.equal(synced.status, 200, synced.body.error);

  const uploadEntered = deferred(), allowUpload = deferred();
  env.SUBMISSION_FILES.beforePut = async () => {
    env.SUBMISSION_FILES.beforePut = null;
    uploadEntered.resolve();
    await allowUpload.promise;
  };
  const uploading = rawUpload(env, snapshotId, "second.js", "console.log('generation two')", "text/javascript");
  await uploadEntered.promise;
  const statesBefore = sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count;
  const reviewDuringUpload = await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-generation-lock/review", {
    method: "POST", admin: true, body: {
      decision: "approved-state", version_id: started.body.version.id, state_title: "Generation two",
      curator_note: "This review must wait for the upload generation.",
    },
  }), env);
  assert.equal(reviewDuringUpload.status, 409);
  const skipDuringUpload = await handleConstructApi(request("/api/admin/archive-web-history-candidates/candidate-generation-lock/review", {
    method: "POST", admin: true, body: {
      decision: "skipped", curator_note: "Even a skip must not freeze evidence halfway through an upload.",
    },
  }), env);
  assert.equal(skipDuringUpload.status, 409);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_object_states").get().count, statesBefore);
  assert.deepEqual({ ...sql.prepare("SELECT decision,reviewed_by FROM archive_web_history_candidates WHERE id=?").get(evidence.id) }, {
    decision: "pending", reviewed_by: "",
  });
  allowUpload.resolve();
  const uploaded = await uploading;
  assert.equal(uploaded.status, 201, uploaded.body.error);
  generation = sql.prepare("SELECT source_revision,scan_revision,scan_status FROM archive_web_snapshots WHERE id=?").get(snapshotId);
  assert.deepEqual({ source_revision: generation.source_revision, scan_revision: generation.scan_revision, scan_status: generation.scan_status }, {
    source_revision: 2, scan_revision: -1, scan_status: "draft",
  });

  const filesBeforeFailure = sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_files WHERE snapshot_id=?").get(snapshotId).count;
  const objectsBeforeFailure = env.SUBMISSION_FILES.objects.size;
  const revisionBeforeFailure = generation.source_revision;
  env.SUBMISSIONS_DB.failBatchWhen = (statements) => {
    if (!statements.some((statement) => /INSERT INTO archive_web_snapshot_files/.test(statement.sql))) return false;
    env.SUBMISSIONS_DB.failBatchWhen = null;
    return true;
  };
  const failedUpload = await rawUpload(env, snapshotId, "failed.js", "console.log('must roll back')", "text/javascript");
  assert.equal(failedUpload.status, 502);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_files WHERE snapshot_id=?").get(snapshotId).count, filesBeforeFailure);
  assert.equal(env.SUBMISSION_FILES.objects.size, objectsBeforeFailure, "R2 source and derivative writes are cleaned up after a D1 failure");
  const afterFailure = sql.prepare("SELECT source_revision,scan_revision,scan_status,mutation_token FROM archive_web_snapshots WHERE id=?").get(snapshotId);
  assert.equal(afterFailure.source_revision, revisionBeforeFailure);
  assert.equal(afterFailure.scan_revision, -1);
  assert.equal(afterFailure.scan_status, "draft");
  assert.equal(afterFailure.mutation_token, "");
});

test("dependency persistence failures leave the prior scan blocked before evidence rows are replaced", async () => {
  const sql = database(), env = runtime(sql);
  const started = await startWebsiteArchive(env);
  const created = await createWebsiteSnapshot(env, started.body.record.id, started.body.state.id, "Fail-closed dependency fixture");
  const snapshotId = created.body.record.id;
  assert.equal((await rawUpload(env, snapshotId, "index.html", "<!doctype html><img src='https://legacy.example/eye.png'>", "text/html")).status, 201);
  const firstScan = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, {
    method: "POST", admin: true, body: {},
  }), env));
  assert.equal(firstScan.status, 200, firstScan.body.error);
  assert.equal(firstScan.body.record.scan_status, "ready");
  assert.ok(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_dependencies WHERE snapshot_id=?").get(snapshotId).count > 0);

  env.SUBMISSIONS_DB.failBatchWhen = (statements) => {
    if (!statements.some((statement) => /INSERT INTO archive_web_snapshot_dependencies/.test(statement.sql))) return false;
    env.SUBMISSIONS_DB.failBatchWhen = null;
    return true;
  };
  const failedScan = await responseJson(await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}/finalize`, {
    method: "POST", admin: true, body: {},
  }), env));
  assert.equal(failedScan.status, 409);
  const blocked = sql.prepare(`SELECT scan_status,scan_revision,viewer_approved,mutation_token,dependency_summary_json
    FROM archive_web_snapshots WHERE id=?`).get(snapshotId);
  assert.equal(blocked.scan_status, "blocked");
  assert.equal(blocked.scan_revision, -1);
  assert.equal(blocked.viewer_approved, 0);
  assert.equal(blocked.mutation_token, "");
  assert.equal(JSON.parse(blocked.dependency_summary_json).finalization_failed, true);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_web_snapshot_dependencies WHERE snapshot_id=?").get(snapshotId).count, 0,
    "partial dependency evidence is never left behind as a trusted ready scan");
  assert.equal((await handleConstructApi(request(`/api/admin/archive-web-snapshots/${snapshotId}`, {
    method: "PATCH", admin: true, body: { viewer_approved: true },
  }), env)).status, 409);
});

test("history candidate synchronization rechecks pending claims inside the UPSERT", async () => {
  const sql = database(), env = runtime(sql);
  const started = await startWebsiteArchive(env);
  const evidence = {
    id: "candidate-upsert-claim-race",
    dossier_entity_id: started.body.record.id,
    commits: ["candidate-upsert-claim-race"],
    title: "Original synchronized evidence",
    representative_commit: { sha: "candidate-upsert-claim-race", message: "Original evidence" },
    review_decision: "pending",
  };
  const initial = await responseJson(await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [evidence] },
  }), env));
  assert.equal(initial.status, 200, initial.body.error);
  env.SUBMISSIONS_DB.beforeFirst = async (statement) => {
    if (!/INSERT INTO archive_web_history_candidates/.test(statement.sql)) return;
    env.SUBMISSIONS_DB.beforeFirst = null;
    sql.prepare("UPDATE archive_web_history_candidates SET reviewed_by='archive-web-review-claim-injected' WHERE id=?").run(evidence.id);
  };
  const raced = await handleConstructApi(request("/api/admin/archive-web-history-candidates/sync", {
    method: "POST", admin: true, body: { records: [{ ...evidence, title: "Mutated after the preflight read" }] },
  }), env);
  assert.equal(raced.status, 409);
  const preserved = sql.prepare("SELECT title,reviewed_by FROM archive_web_history_candidates WHERE id=?").get(evidence.id);
  assert.equal(preserved.title, evidence.title);
  assert.equal(preserved.reviewed_by, "archive-web-review-claim-injected");
});
