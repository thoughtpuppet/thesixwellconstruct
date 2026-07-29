import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "archive-source-material-test-token";

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

function env(db) {
  return { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
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

test("client correspondence source sets stay private by default and publish as ordered multi-state evidence", async () => {
  const db = database();
  const runtime = env(db);
  const publicState = db.prepare(`SELECT aos.*,aov.version_number
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    WHERE aov.entity_id='art-marbles'
      AND aov.publication_state='published' AND aov.public_visible=1
      AND aos.publication_state='published' AND aos.public_visible=1
    ORDER BY aov.version_number,aos.state_order
    LIMIT 1`).get();
  assert.ok(publicState);

  const version = db.prepare("SELECT id FROM archive_object_versions WHERE entity_id='art-marbles' ORDER BY version_number LIMIT 1").get();
  const internalStateResponse = await handleConstructApi(request("/api/admin/archive-states", {
    method: "POST",
    admin: true,
    body: {
      version_id: version.id,
      state_roman: "II",
      state_order: 2,
      title: "Internal correspondence state",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(internalStateResponse.status, 201);
  const internalState = (await internalStateResponse.json()).record;

  const existingDocumentResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      state_id: publicState.id,
      material_type: "document",
      title: "Existing production note",
      inline_text: "Existing state document.",
      visibility: "internal",
      state: "draft",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(existingDocumentResponse.status, 201);
  const existingDocument = (await existingDocumentResponse.json()).record;
  assert.match(existingDocument.material_reference, /^D\d{2}$/);

  const createResponse = await handleConstructApi(request("/api/admin/archive-source-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      source_kind: "client-correspondence",
      title: "Client palette correspondence",
      caption: "A reviewed exchange and the supplied visual reference.",
      date_precision: "approximate",
      date_label: "Spring 2023",
      state_ids: [publicState.id, internalState.id],
      sort_order: 4,
    },
  }), runtime);
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).record;
  assert.equal(created.publication_state, "draft");
  assert.equal(created.visibility, "internal");
  assert.equal(created.permission_status, "not-required");
  assert.equal(created.participant_label, "Client");
  assert.equal(created.state_links.length, 2);
  assert.equal(new Set(created.state_links.map((link) => link.document_reference)).size >= 1, true);
  const publicReference = created.state_links.find((link) => link.state_id === publicState.id).document_reference;
  assert.notEqual(publicReference, existingDocument.material_reference);
  assert.equal(created.state_links.find((link) => link.state_id === internalState.id).document_reference, "D01");

  db.exec(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at)
    VALUES
      ('source-correspondence-image','https://cdn.example.test/redacted-correspondence.jpg','private-client-name-chat.jpg','image/jpeg',
       'Redacted client correspondence page','internal','unknown','active','hidden','test',datetime('now'),datetime('now')),
      ('source-reference-image','https://cdn.example.test/client-reference.jpg','private-reference-filename.jpg','image/jpeg',
       'Client-supplied visual reference','internal','unknown','active','hidden','test',datetime('now'),datetime('now'));`);

  const entryBodies = [
    {
      media_id: "source-correspondence-image",
      entry_type: "correspondence-page",
      title: "Correspondence page",
      caption: "A redacted discussion of the palette.",
      public_included: true,
      sort_order: 2,
    },
    {
      entry_type: "correspondence-text",
      title: "Selected correspondence",
      body: "The client asked for a darker field around the central form.",
      public_included: true,
      sort_order: 1,
    },
    {
      media_id: "source-reference-image",
      entry_type: "client-reference-image",
      title: "Excluded reference photograph",
      caption: "Held for internal review.",
      public_included: false,
      sort_order: 3,
    },
  ];
  const entries = [];
  for (const body of entryBodies) {
    const response = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}/entries`, {
      method: "POST",
      admin: true,
      body,
    }), runtime);
    assert.equal(response.status, 201);
    entries.push((await response.json()).record);
  }

  const reorderResponse = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}/entries/reorder`, {
    method: "POST",
    admin: true,
    body: { ids: [entries[1].id, entries[0].id, entries[2].id] },
  }), runtime);
  assert.equal(reorderResponse.status, 200);

  const adminListResponse = await handleConstructApi(request("/api/admin/archive-source-materials?entity_id=art-marbles", { admin: true }), runtime);
  assert.equal(adminListResponse.status, 200);
  const adminList = await adminListResponse.json();
  const draftSet = adminList.records.find((record) => record.id === created.id);
  assert.deepEqual(draftSet.entries.map((entry) => entry.id), [entries[1].id, entries[0].id, entries[2].id]);
  assert.equal(draftSet.entries[1].digital_asset.original_filename, "private-client-name-chat.jpg");

  const archiveSlug = db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='art-marbles'").get().archive_slug;
  const draftPublicResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(archiveSlug)}`), runtime);
  assert.equal(draftPublicResponse.status, 200);
  const draftPublic = await draftPublicResponse.json();
  assert.equal(draftPublic.source_materials.length, 0);
  const baselineMaterialCount = draftPublic.states.find((state) => state.id === publicState.id).material_count;

  const publishResponse = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}`, {
    method: "PATCH",
    admin: true,
    body: {
      visibility: "public",
      publication_state: "published",
      permission_status: "not-required",
    },
  }), runtime);
  assert.equal(publishResponse.status, 200);
  const published = (await publishResponse.json()).record;
  assert.equal(published.publication_state, "published");
  assert.equal(published.visibility, "public");

  const preparedMedia = db.prepare("SELECT privacy,consent_status,state,public_presentation FROM media_assets WHERE id='source-correspondence-image'").get();
  assert.deepEqual({ ...preparedMedia }, {
    privacy: "public",
    consent_status: "not-required",
    state: "active",
    public_presentation: "inline",
  });
  const excludedMedia = db.prepare("SELECT privacy,consent_status,public_presentation FROM media_assets WHERE id='source-reference-image'").get();
  assert.deepEqual({ ...excludedMedia }, {
    privacy: "internal",
    consent_status: "unknown",
    public_presentation: "hidden",
  });

  const publicResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(archiveSlug)}`), runtime);
  assert.equal(publicResponse.status, 200);
  const publicRecord = await publicResponse.json();
  assert.equal(publicRecord.source_materials.length, 1);
  assert.deepEqual(publicRecord.sourceMaterials, publicRecord.source_materials);
  assert.deepEqual(publicRecord.evidence_sets, publicRecord.source_materials);
  const publicSet = publicRecord.source_materials[0];
  assert.equal(publicSet.label, "Client correspondence");
  assert.equal(publicSet.participant_label, "Client");
  assert.equal(publicSet.state_links.length, 1);
  assert.equal(publicSet.state_links[0].state_id, publicState.id);
  assert.equal(publicSet.entries.length, 2);
  assert.deepEqual(publicSet.entries.map((entry) => entry.title), ["Selected correspondence", "Correspondence page"]);
  assert.ok(publicSet.entries.every((entry) => !("public_included" in entry) && !("publicIncluded" in entry)));
  assert.ok(!JSON.stringify(publicRecord).includes("Excluded reference photograph"));
  assert.ok(!JSON.stringify(publicRecord).includes("private-client-name-chat.jpg"));
  assert.ok(!JSON.stringify(publicRecord).includes("private-reference-filename.jpg"));
  assert.equal(publicRecord.states.find((state) => state.id === publicState.id).material_count, baselineMaterialCount + 1);

  const searchResponse = await handleConstructApi(request("/api/archive/items?q=palette%20correspondence"), runtime);
  assert.equal(searchResponse.status, 200);
  assert.ok((await searchResponse.json()).items.some((item) => item.entity_id === "art-marbles"));

  const blockedEntryUpdate = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}/entries/${encodeURIComponent(entries[0].id)}`, {
    method: "PATCH",
    admin: true,
    body: { caption: "Changed after publication." },
  }), runtime);
  assert.equal(blockedEntryUpdate.status, 409);

  const blockedMediaUpdate = await handleConstructApi(request("/api/admin/media/source-correspondence-image", {
    method: "PATCH",
    admin: true,
    body: { privacy: "internal" },
  }), runtime);
  assert.equal(blockedMediaUpdate.status, 409);

  const blockedStateDelete = await handleConstructApi(request(`/api/admin/archive-states/${encodeURIComponent(internalState.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(blockedStateDelete.status, 409);

  const returnToDraftResponse = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}`, {
    method: "PATCH",
    admin: true,
    body: { visibility: "internal", publication_state: "draft" },
  }), runtime);
  assert.equal(returnToDraftResponse.status, 200);

  const archiveResponse = await handleConstructApi(request(`/api/admin/archive-source-materials/${encodeURIComponent(created.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(archiveResponse.status, 200);
  const archived = db.prepare("SELECT publication_state,visibility FROM archive_source_material_sets WHERE id=?").get(created.id);
  assert.deepEqual({ ...archived }, { publication_state: "archived", visibility: "internal" });

  const archivedPublicResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(archiveSlug)}`), runtime);
  assert.equal(archivedPublicResponse.status, 200);
  assert.equal((await archivedPublicResponse.json()).source_materials.length, 0);
});

test("source-material migration and public UI keep the grouped evidence ontology explicit", () => {
  const migration = readFileSync(join(ROOT, "migrations", "0080_archive_client_correspondence_sets.sql"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "archive-public.js"), "utf8");
  const publicCards = readFileSync(join(ROOT, "css", "archive-cards.css"), "utf8");

  assert.match(migration, /archive_source_material_sets/);
  assert.match(migration, /archive_source_material_entries/);
  assert.match(migration, /archive_source_material_states/);
  assert.match(migration, /client-correspondence/);
  assert.match(studio, /Source materials/);
  assert.match(studio, /Add client correspondence/);
  assert.match(studio, /multiple accept="image\/\*,\.pdf,\.doc,\.docx"/);
  assert.match(studio, /original filenames never appear publicly/);
  assert.match(publicScript, /archive-source-material-dialog/);
  assert.match(publicScript, /Source material · Client correspondence/);
  assert.match(publicScript, /archive-source-entry-list/);
  assert.match(publicScript, /<em>Source<\/em>/);
  assert.match(publicCards, /\.archive-source-material-summary/);
  assert.match(publicCards, /border:\s*var\(--archive-rule,\s*5px\)/);
});
