import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const NOW = "2026-07-31T12:00:00.000Z";
const TOKEN = "failed-experiments-test-token";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
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
    db.exec(read(join("migrations", name)));
  }
  return db;
}

function runtime(db) {
  return { SUBMISSIONS_DB: new LocalD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
}

function apiRequest(path, { method = "GET", body, admin = false } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function api(runtimeEnv, path, options = {}) {
  const response = await handleConstructApi(apiRequest(path, options), runtimeEnv);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function admin(runtimeEnv, path, body, method = "POST") {
  return api(runtimeEnv, path, { method, body, admin: true });
}

async function createDraft(runtimeEnv, body = {}) {
  const response = await admin(runtimeEnv, "/api/admin/archive-failed-experiments", {
    title: "Untitled failed experiment",
    result: "failed",
    ...body,
  });
  assert.equal(response.status, 201, response.body.error);
  return response.body.record;
}

function insertMedia(db, {
  id,
  mimeType = "image/jpeg",
  altText = "",
  caption = "",
  privacy = "public",
  consentStatus = "not-required",
  state = "active",
  presentation = "inline",
  publicTitle = "",
  publicDescription = "",
  transcript = "",
} = {}) {
  db.prepare(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,caption,privacy,consent_status,state,
       public_presentation,public_title,public_description,transcript,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'test',?,?)`)
    .run(id, `/test/${id}`, `${id}.bin`, mimeType, altText, caption, privacy, consentStatus, state,
      presentation, publicTitle, publicDescription, transcript, NOW, NOW);
}

async function attachMedia(runtimeEnv, entityId, mediaId, body = {}) {
  return admin(runtimeEnv, `/api/admin/entities/${encodeURIComponent(entityId)}/media`, {
    media_id: mediaId,
    role: "evidence",
    sort_order: 1,
    public_visible: true,
    ...body,
  });
}

function seedPublishedExperiment(db, {
  id,
  medium = "other",
  kind = "other",
  result = "failed",
  afterlife = "none",
  phase = "",
  note = "A public failed experiment fixture.",
  occurredAt = null,
  endedAt = null,
  datePrecision = occurredAt ? "exact" : "undated",
  dateLabel = "",
} = {}) {
  createExperiment(db, { id, title: id, medium, kind, result });
  db.prepare(`UPDATE archive_failed_experiments
    SET public_note=?,afterlife=?,process_phase=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,state='published'
    WHERE entity_id=?`).run(note, afterlife, phase, occurredAt, endedAt, datePrecision, dateLabel, id);
  db.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=? WHERE id=?").run(NOW, id);
}

function createExperiment(db, {
  id,
  slug = id,
  title = id,
  medium = "art",
  kind = "other",
  result = "failed",
} = {}) {
  db.prepare(`INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES(?,'archive_failed_experiment',?,'internal',0,'test','test',?,?)`)
    .run(id, medium, NOW, NOW);
  db.prepare(`INSERT INTO archive_failed_experiments
      (entity_id,slug,title,experiment_kind,result,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'test','test',?,?)`)
    .run(id, slug, title, kind, result, NOW, NOW);
}

function stateFor(db, entityId) {
  return db.prepare(`SELECT state.id
    FROM archive_object_states state
    JOIN archive_object_versions version ON version.id=state.version_id
    WHERE version.entity_id=?
    ORDER BY version.version_number,state.state_order,state.id
    LIMIT 1`).get(entityId);
}

function createRelationship(db, id, sourceId, targetId, relationshipType = "rel-predecessor-of") {
  db.prepare(`INSERT INTO entity_relationships
      (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,created_by,created_at,updated_at)
    VALUES(?,?,?,?,1,'test',?,?)`)
    .run(id, sourceId, targetId, relationshipType, NOW, NOW);
}

test("0087 creates standalone failed-experiment evidence with private draft defaults", () => {
  const db = database();
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_failed_experiments").get().count, 0, "migration must not seed fabricated experiments");

  createExperiment(db, { id: "failed-experiment-one", title: "First material test", kind: "material-test" });
  const record = db.prepare("SELECT * FROM archive_failed_experiments WHERE entity_id='failed-experiment-one'").get();
  assert.deepEqual({
    kind: record.experiment_kind,
    afterlife: record.afterlife,
    phase: record.process_phase,
    precision: record.date_precision,
    state: record.state,
  }, {
    kind: "material-test",
    afterlife: "none",
    phase: "",
    precision: "undated",
    state: "draft",
  });
  const entity = db.prepare("SELECT entity_type,node_id,visibility,search_visibility FROM content_entities WHERE id=?").get(record.entity_id);
  assert.deepEqual({ ...entity }, {
    entity_type: "archive_failed_experiment",
    node_id: "art",
    visibility: "internal",
    search_visibility: 0,
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id=?").get(record.entity_id).count, 0, "evidence records must not receive catalogue dossiers");

  db.prepare(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at)
    VALUES('failed-experiment-image','/test/failed-experiment.jpg','failed-experiment.jpg','image/jpeg','Failed material test','internal','not-required','active','hidden','test',?,?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO entity_media
      (entity_id,media_id,role,sort_order,public_visible,created_at)
    VALUES('failed-experiment-one','failed-experiment-image','evidence',2,0,?)`).run(NOW);
  assert.deepEqual({ ...db.prepare("SELECT role,sort_order,public_visible FROM entity_media WHERE entity_id='failed-experiment-one'").get() }, {
    role: "evidence",
    sort_order: 2,
    public_visible: 0,
  });
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("failed-experiment vocabulary, entity family, and primary medium stay controlled", () => {
  const db = database();
  createExperiment(db, { id: "failed-experiment-controls" });

  for (const [column, value] of [
    ["experiment_kind", "accident"],
    ["result", "successful"],
    ["afterlife", "unknown"],
    ["date_precision", "day"],
    ["state", "deleted"],
  ]) {
    assert.throws(
      () => db.prepare(`UPDATE archive_failed_experiments SET ${column}=? WHERE entity_id='failed-experiment-controls'`).run(value),
      /CHECK constraint failed/,
      `${column} must reject values outside its controlled vocabulary`,
    );
  }
  assert.throws(
    () => db.prepare("UPDATE archive_failed_experiments SET title=' ' WHERE entity_id='failed-experiment-controls'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("UPDATE content_entities SET node_id='archive' WHERE id='failed-experiment-controls'").run(),
    /Archive medium/,
  );
  assert.throws(
    () => db.prepare("UPDATE content_entities SET entity_type='archive_record' WHERE id='failed-experiment-controls'").run(),
    /entity type/,
  );

  db.prepare(`INSERT INTO content_entities
      (id,entity_type,node_id,created_by,updated_by,created_at,updated_at)
    VALUES('wrong-family','archive_record','art','test','test',?,?)`).run(NOW, NOW);
  assert.throws(
    () => db.prepare(`INSERT INTO archive_failed_experiments
      (entity_id,slug,title,result,created_at,updated_at)
      VALUES('wrong-family','wrong-family','Wrong family','failed',?,?)`).run(NOW, NOW),
    /matching entity/,
  );

  db.prepare(`INSERT INTO content_entities
      (id,entity_type,node_id,created_by,updated_by,created_at,updated_at)
    VALUES('wrong-medium','archive_failed_experiment','archive','test','test',?,?)`).run(NOW, NOW);
  assert.throws(
    () => db.prepare(`INSERT INTO archive_failed_experiments
      (entity_id,slug,title,result,created_at,updated_at)
      VALUES('wrong-medium','wrong-medium','Wrong medium','failed',?,?)`).run(NOW, NOW),
    /Archive medium/,
  );
});

test("state decorations only connect an experiment relationship to the state-owning work", () => {
  const db = database();
  const marblesState = stateFor(db, "art-marbles");
  const lustState = stateFor(db, "art-lust");
  assert.ok(marblesState?.id);
  assert.ok(lustState?.id);

  createExperiment(db, { id: "failed-experiment-source" });
  createExperiment(db, { id: "failed-experiment-target", medium: "tattoos" });

  createRelationship(db, "failed-valid-forward", "failed-experiment-source", "art-marbles");
  db.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,?)")
    .run("failed-valid-forward", marblesState.id, NOW);
  assert.equal(db.prepare("SELECT state_id FROM archive_failed_experiment_state_links WHERE relationship_id='failed-valid-forward'").get().state_id, marblesState.id);

  createRelationship(db, "failed-valid-reverse", "art-lust", "failed-experiment-target", "rel-related-to");
  db.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,?)")
    .run("failed-valid-reverse", lustState.id, NOW);

  createRelationship(db, "failed-wrong-owner", "failed-experiment-source", "art-lust", "rel-related-to");
  assert.throws(
    () => db.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,?)")
      .run("failed-wrong-owner", marblesState.id, NOW),
    /must belong to the relationship work endpoint/,
  );

  createRelationship(db, "failed-to-failed", "failed-experiment-source", "failed-experiment-target", "rel-related-to");
  assert.throws(
    () => db.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,?)")
      .run("failed-to-failed", marblesState.id, NOW),
    /must belong to the relationship work endpoint/,
  );

  db.prepare(`INSERT INTO content_entities
      (id,entity_type,node_id,created_by,updated_by,created_at,updated_at)
    VALUES('ordinary-evidence','archive_record','archive','test','test',?,?)`).run(NOW, NOW);
  createRelationship(db, "failed-no-experiment", "ordinary-evidence", "art-marbles", "rel-related-to");
  assert.throws(
    () => db.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,?)")
      .run("failed-no-experiment", marblesState.id, NOW),
    /must belong to the relationship work endpoint/,
  );

  assert.throws(
    () => db.prepare("UPDATE archive_failed_experiment_state_links SET state_id=? WHERE relationship_id='failed-valid-forward'").run(lustState.id),
    /must belong to the relationship work endpoint/,
  );
  assert.throws(
    () => db.prepare("UPDATE entity_relationships SET target_entity_id='art-lust' WHERE id='failed-valid-forward'").run(),
    /would detach its failed experiment state/,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("admin lifecycle defaults to a private draft, publishes from authored text, indexes, and soft-archives", async () => {
  const db = database();
  const runtimeEnv = runtime(db);
  const draft = await createDraft(runtimeEnv, {
    title: "Kiln note lifecycle fixture",
    result: "abandoned",
  });

  assert.deepEqual({
    state: draft.state,
    medium: draft.node_id,
    kind: draft.experiment_kind,
    afterlife: draft.afterlife,
    precision: draft.date_precision,
    visibility: draft.visibility,
    searchVisibility: Number(draft.search_visibility),
  }, {
    state: "draft",
    medium: "other",
    kind: "other",
    afterlife: "none",
    precision: "undated",
    visibility: "internal",
    searchVisibility: 0,
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id=?").get(draft.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM search_documents WHERE entity_id=?").get(draft.id).count, 0);

  const hiddenList = await api(runtimeEnv, "/api/archive/failed-experiments?q=kiln");
  assert.equal(hiddenList.status, 200);
  assert.equal(hiddenList.headers.get("cache-control"), "no-store");
  assert.equal(hiddenList.body.items.length, 0);

  const publish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(draft.id)}`, {
    state: "published",
    node_id: "art",
    public_note: "The kilnnotefixture binder blistered before the surface could settle.",
    expanded_context: "A note-only experiment can be public without invented visual evidence.",
  }, "PATCH");
  assert.equal(publish.status, 200, publish.body.error);
  assert.equal(publish.body.record.state, "published");
  assert.equal(publish.body.record.visibility, "public");
  assert.equal(Number(publish.body.record.search_visibility), 1);

  const searchDocument = db.prepare("SELECT * FROM search_documents WHERE entity_id=?").get(draft.id);
  assert.equal(searchDocument.summary, "The kilnnotefixture binder blistered before the surface could settle.");
  assert.equal(searchDocument.route, `/archive/failed-experiments/${draft.slug}/`);
  assert.doesNotMatch(searchDocument.body, /transcript/i);

  const publicDetail = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(draft.slug)}`);
  assert.equal(publicDetail.status, 200);
  assert.equal(publicDetail.headers.get("cache-control"), "no-store");
  assert.equal(publicDetail.body.experiment.id, draft.id);
  assert.deepEqual(publicDetail.body.media, []);

  const search = await api(runtimeEnv, "/api/search?q=kilnnotefixture");
  assert.equal(search.status, 200);
  assert.ok(search.body.records.some((record) => record.entity_id === draft.id));

  const archived = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(draft.id)}`, undefined, "DELETE");
  assert.equal(archived.status, 200, archived.body.error);
  assert.equal(archived.body.archived, true);
  const retained = db.prepare("SELECT state FROM archive_failed_experiments WHERE entity_id=?").get(draft.id);
  const hiddenEntity = db.prepare("SELECT visibility,search_visibility,archived_at FROM content_entities WHERE id=?").get(draft.id);
  assert.equal(retained.state, "archived");
  assert.equal(hiddenEntity.visibility, "internal");
  assert.equal(Number(hiddenEntity.search_visibility), 0);
  assert.ok(hiddenEntity.archived_at);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM search_documents WHERE entity_id=?").get(draft.id).count, 0);
  assert.ok(db.prepare("SELECT COUNT(*) count FROM entity_revisions WHERE entity_id=?").get(draft.id).count >= 3);
  assert.equal((await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(draft.slug)}`)).status, 404);
});

test("media-only publication preserves ordered evidence and pairs an internal original with its public derivative", async () => {
  const db = database();
  const runtimeEnv = runtime(db);
  const draft = await createDraft(runtimeEnv, {
    title: "Layer separation evidence fixture",
    result: "failed",
    experiment_kind: "material-test",
    node_id: "art",
  });

  insertMedia(db, {
    id: "failed-original-master",
    mimeType: "image/png",
    altText: "Internal high-resolution view",
    privacy: "internal",
    presentation: "hidden",
  });
  insertMedia(db, {
    id: "failed-public-derivative",
    mimeType: "image/webp",
    altText: "Cracked blue paint layer on a square test panel",
    caption: "Searchable fracture caption token.",
    publicTitle: "Searchable separation title token",
    publicDescription: "Searchable blue-coat description token.",
    transcript: "private transcript token must never enter search",
  });
  insertMedia(db, {
    id: "failed-sequence-first",
    mimeType: "image/jpeg",
    altText: "Test panel before the blue paint layer separated",
  });

  const pair = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(draft.id)}/media-pair`, {
    master_media_id: "failed-original-master",
    derivative_media_id: "failed-public-derivative",
    role: "evidence",
    sort_order: 2,
    public_visible: true,
    alt_text_override: "Cracked blue paint layer on a square test panel",
  });
  assert.equal(pair.status, 201, pair.body.error);
  const first = await attachMedia(runtimeEnv, draft.id, "failed-sequence-first", {
    role: "primary",
    sort_order: 1,
    alt_text_override: "Test panel before the blue paint layer separated",
  });
  assert.equal(first.status, 201, first.body.error);

  const variant = db.prepare("SELECT * FROM media_asset_variants WHERE master_media_id=? AND purpose='public-display'").get("failed-original-master");
  assert.equal(variant.derivative_media_id, "failed-public-derivative");
  assert.deepEqual({ ...db.prepare("SELECT privacy,public_presentation,state FROM media_assets WHERE id='failed-original-master'").get() }, {
    privacy: "internal",
    public_presentation: "hidden",
    state: "active",
  });

  const publish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(draft.id)}`, { state: "published" }, "PATCH");
  assert.equal(publish.status, 200, publish.body.error);
  assert.equal(publish.body.record.public_note, "");

  const detail = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(draft.slug)}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.media.map((item) => item.id), ["failed-sequence-first", "failed-public-derivative"]);
  assert.ok(detail.body.media.every((item) => item.id !== "failed-original-master"));
  assert.equal(detail.body.experiment.cover_media.id, "failed-sequence-first");
  const searchDocument = db.prepare("SELECT summary,body FROM search_documents WHERE entity_id=?").get(draft.id);
  const indexedText = `${searchDocument.summary} ${searchDocument.body}`;
  assert.match(indexedText, /Searchable fracture caption token/);
  assert.match(indexedText, /Searchable separation title token/);
  assert.match(indexedText, /Searchable blue-coat description token/);
  assert.doesNotMatch(indexedText, /private transcript token must never enter search/);

  for (const query of [
    "Searchable fracture caption token",
    "Searchable separation title token",
    "Searchable blue-coat description token",
  ]) {
    const response = await api(runtimeEnv, `/api/archive/failed-experiments?q=${encodeURIComponent(query)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.body.items.some((item) => item.id === draft.id), `q finds eligible media text: ${query}`);
  }
  const transcriptQuery = await api(runtimeEnv, `/api/archive/failed-experiments?q=${encodeURIComponent("private transcript token must never enter search")}`);
  assert.equal(transcriptQuery.status, 200);
  assert.ok(!transcriptQuery.body.items.some((item) => item.id === draft.id), "q never searches media transcripts");
});

test("publication rejects ineligible or inaccessible evidence and media revocation removes a media-only record", async () => {
  const db = database();
  const runtimeEnv = runtime(db);

  async function preparedDraft(label, media) {
    const record = await createDraft(runtimeEnv, { title: label, result: "failed" });
    insertMedia(db, media);
    const attached = await attachMedia(runtimeEnv, record.id, media.id);
    assert.equal(attached.status, 201, attached.body.error);
    return record;
  }

  const privateRecord = await preparedDraft("Private failed evidence", {
    id: "failed-private-media",
    altText: "Private material test",
    privacy: "internal",
  });
  const privatePublish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(privateRecord.id)}`, { state: "published" }, "PATCH");
  assert.equal(privatePublish.status, 409);
  assert.match(privatePublish.body.error, /active, public, inline, and consent-cleared/i);

  const deniedRecord = await preparedDraft("Denied failed evidence", {
    id: "failed-denied-media",
    altText: "Consent-denied material test",
    consentStatus: "denied",
  });
  const deniedPublish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(deniedRecord.id)}`, { state: "published" }, "PATCH");
  assert.equal(deniedPublish.status, 409);
  assert.match(deniedPublish.body.error, /consent-cleared/i);

  const inaccessibleRecord = await preparedDraft("Inaccessible failed evidence", {
    id: "failed-inaccessible-media",
    altText: "",
  });
  const inaccessiblePublish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(inaccessibleRecord.id)}`, { state: "published" }, "PATCH");
  assert.equal(inaccessiblePublish.status, 409);
  assert.match(inaccessiblePublish.body.error, /accessible alt text|visitor-facing context/i);

  const revocableRecord = await preparedDraft("Revocable media-only fixture", {
    id: "failed-revocable-media",
    altText: "A material sample with a lifted top coat",
  });
  const validPublish = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(revocableRecord.id)}`, { state: "published" }, "PATCH");
  assert.equal(validPublish.status, 200, validPublish.body.error);
  assert.ok(db.prepare("SELECT entity_id FROM search_documents WHERE entity_id=?").get(revocableRecord.id));
  assert.equal((await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(revocableRecord.slug)}`)).status, 200);

  const revoke = await admin(runtimeEnv, "/api/admin/media/failed-revocable-media", { consent_status: "denied" }, "PATCH");
  assert.equal(revoke.status, 200, revoke.body.error);
  assert.equal((await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(revocableRecord.slug)}`)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM search_documents WHERE entity_id=?").get(revocableRecord.id).count, 0);
  assert.equal(db.prepare("SELECT visibility FROM content_entities WHERE id=?").get(revocableRecord.id).visibility, "internal");
  assert.equal(db.prepare("SELECT state FROM archive_failed_experiments WHERE entity_id=?").get(revocableRecord.id).state, "published");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM entity_media WHERE entity_id=?").get(revocableRecord.id).count, 1, "revocation retains internal evidence provenance");
  const search = await api(runtimeEnv, "/api/search?q=Revocable%20media-only%20fixture");
  assert.ok(!search.body.records.some((record) => record.entity_id === revocableRecord.id));
});

test("public list filters exact dates and paginates in chronological order with undated records last", async () => {
  const db = database();
  const runtimeEnv = runtime(db);

  for (let day = 1; day <= 25; day += 1) {
    const date = `2025-02-${String(day).padStart(2, "0")}`;
    const special = day === 3;
    seedPublishedExperiment(db, {
      id: `paged-experiment-${String(day).padStart(2, "0")}`,
      medium: special ? "art" : day % 2 ? "merch" : "tattoos",
      kind: special ? "material-test" : "concept",
      result: special ? "inconclusive" : "failed",
      afterlife: special ? "reused" : "none",
      phase: special ? "Pigment testing" : "Concept pass",
      note: special ? "Needle alpha pigment test fixture." : `Published pagination fixture ${day}.`,
      occurredAt: `${date}T12:00:00.000Z`,
      datePrecision: "exact",
      dateLabel: date,
    });
  }
  seedPublishedExperiment(db, {
    id: "paged-experiment-range",
    medium: "film",
    kind: "process-test",
    result: "superseded",
    phase: "Edit test",
    occurredAt: "2025-02-01T00:00:00.000Z",
    endedAt: "2025-02-05T23:59:59.000Z",
    datePrecision: "range",
    dateLabel: "February 1–5, 2025",
  });
  seedPublishedExperiment(db, { id: "paged-experiment-undated" });

  const firstPage = await api(runtimeEnv, "/api/archive/failed-experiments?page=1");
  const secondPage = await api(runtimeEnv, "/api/archive/failed-experiments?page=2");
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.items.length, 24);
  assert.deepEqual(firstPage.body.pagination, { page: 1, limit: 24, total: 27, pages: 2 });
  assert.equal(firstPage.body.items[0].id, "paged-experiment-25");
  assert.equal(secondPage.body.items.length, 3);
  assert.equal(secondPage.body.items.at(-1).id, "paged-experiment-undated");

  const exactDate = await api(runtimeEnv, "/api/archive/failed-experiments?date=2025-02-03");
  assert.equal(exactDate.status, 200);
  assert.deepEqual(new Set(exactDate.body.items.map((item) => item.id)), new Set(["paged-experiment-03", "paged-experiment-range"]));
  assert.equal((await api(runtimeEnv, "/api/archive/failed-experiments?date=02-03-2025")).status, 400);

  const filtered = await api(runtimeEnv, "/api/archive/failed-experiments?q=needle&medium=art&phase=Pigment%20testing&kind=material-test&result=inconclusive&afterlife=reused");
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.items.map((item) => item.id), ["paged-experiment-03"]);
  assert.ok(filtered.body.facets.medium.some((facet) => facet.value === "art"));
});

test("standalone experiments can gain one or many shared relationships while unpublished state links stay private", async () => {
  const db = database();
  const runtimeEnv = runtime(db);
  const experiment = await createDraft(runtimeEnv, {
    title: "Relationship evolution fixture",
    result: "superseded",
    public_note: "This attempt informed more than one finished work.",
  });
  const published = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(experiment.id)}`, { state: "published" }, "PATCH");
  assert.equal(published.status, 200, published.body.error);

  const standalone = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(experiment.slug)}`);
  assert.equal(standalone.status, 200);
  assert.deepEqual(standalone.body.relationships, []);
  assert.deepEqual(standalone.body.state_links, []);

  const firstRelationship = await admin(runtimeEnv, "/api/admin/relationships", {
    source_entity_id: experiment.id,
    target_entity_id: "art-marbles",
    relationship_type_id: "rel-predecessor-of",
    public_visible: true,
  });
  assert.equal(firstRelationship.status, 201, firstRelationship.body.error);
  const single = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(experiment.slug)}`);
  assert.equal(single.body.relationships.length, 1);

  const secondRelationship = await admin(runtimeEnv, "/api/admin/relationships", {
    source_entity_id: experiment.id,
    target_entity_id: "art-lust",
    relationship_type_id: "rel-predecessor-of",
    public_visible: true,
  });
  assert.equal(secondRelationship.status, 201, secondRelationship.body.error);
  const multi = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(experiment.slug)}`);
  assert.equal(multi.body.relationships.length, 2);

  insertMedia(db, {
    id: "failed-relationship-card-image",
    altText: "An abandoned composition test on a wood panel",
  });
  const cardAttachment = await attachMedia(runtimeEnv, experiment.id, "failed-relationship-card-image", { role: "primary" });
  assert.equal(cardAttachment.status, 201, cardAttachment.body.error);
  const connectionBeforeAltRevocation = await api(runtimeEnv, "/api/connections/art-marbles");
  const experimentCardBefore = connectionBeforeAltRevocation.body.records.find((record) => record.related.id === experiment.id);
  assert.ok(experimentCardBefore, "note-backed experiment appears in the existing Connections response");
  assert.match(experimentCardBefore.related.imageUrl, /failed-relationship-card-image/);

  const revokeAlt = await admin(runtimeEnv, "/api/admin/media/failed-relationship-card-image", { alt_text: "" }, "PATCH");
  assert.equal(revokeAlt.status, 200, revokeAlt.body.error);
  const connectionAfterAltRevocation = await api(runtimeEnv, "/api/connections/art-marbles");
  const experimentCardAfter = connectionAfterAltRevocation.body.records.find((record) => record.related.id === experiment.id);
  assert.ok(experimentCardAfter, "authored note keeps the experiment connected after its image becomes inaccessible");
  assert.equal(experimentCardAfter.related.imageUrl, "", "shared connection card does not expose an inaccessible image");
  assert.equal((await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(experiment.slug)}`)).status, 200);

  const marblesState = stateFor(db, "art-marbles");
  const lustState = stateFor(db, "art-lust");
  assert.ok(marblesState?.id);
  assert.ok(lustState?.id);
  db.prepare("UPDATE archive_object_states SET publication_state='draft',public_visible=0 WHERE id=?").run(lustState.id);

  const stateLinks = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(experiment.id)}/state-links`, {
    links: [
      { relationship_id: firstRelationship.body.record.id, state_id: marblesState.id },
      { relationship_id: secondRelationship.body.record.id, state_id: lustState.id },
    ],
  }, "PATCH");
  assert.equal(stateLinks.status, 200, stateLinks.body.error);
  assert.equal(stateLinks.body.state_links.length, 2, "Studio retains both public and internal documentation links");

  const malformedLinks = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(experiment.id)}/state-links`, {
    links: [{ relationship_id: firstRelationship.body.record.id }],
  }, "PATCH");
  assert.equal(malformedLinks.status, 409);
  assert.match(malformedLinks.body.error, /relationship.*state|required/i);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_failed_experiment_state_links").get().count, 2, "malformed replacement leaves existing links intact");

  const publicDetail = await api(runtimeEnv, `/api/archive/failed-experiments/${encodeURIComponent(experiment.slug)}`);
  assert.equal(publicDetail.body.relationships.length, 2);
  assert.deepEqual(publicDetail.body.state_links.map((link) => link.state_id), [marblesState.id]);

  const connections = await api(runtimeEnv, `/api/connections/${encodeURIComponent(experiment.id)}`);
  assert.equal(connections.status, 200);
  assert.equal(connections.body.records.length, 2);
  assert.ok(connections.body.records.find((record) => record.id === firstRelationship.body.record.id).stateLink);
  assert.equal(connections.body.records.find((record) => record.id === secondRelationship.body.record.id).stateLink, null);

  const wrongOwner = await admin(runtimeEnv, `/api/admin/archive-failed-experiments/${encodeURIComponent(experiment.id)}/state-links`, {
    links: [{ relationship_id: firstRelationship.body.record.id, state_id: lustState.id }],
  }, "PATCH");
  assert.equal(wrongOwner.status, 409);
  assert.match(wrongOwner.body.error, /other end|work endpoint/i);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_failed_experiment_state_links").get().count, 2, "failed replacement leaves existing links intact");
});

test("API, Studio, and public surfaces share the approved failed-experiments contract", () => {
  const requiredFiles = [
    "migrations/0087_archive_failed_experiments.sql",
    "studio/archive-failed-experiments.js",
    "studio/archive-failed-experiments.css",
    "archive/failed-experiments/index.html",
    "js/archive-failed-experiments.js",
    "css/archive-failed-experiments.css",
  ];
  for (const path of requiredFiles) assert.ok(existsSync(join(ROOT, path)), `${path} must exist`);

  const migration = read("migrations/0087_archive_failed_experiments.sql");
  const api = read("functions/api/construct/_lib.js");
  const worker = read("_worker.js");
  const studioManager = read("studio/construct-manager.js");
  const studioPage = read("studio/submissions/index.html");
  const studioModule = read("studio/archive-failed-experiments.js");
  const publicHtml = read("archive/failed-experiments/index.html");
  const publicScript = read("js/archive-failed-experiments.js");
  const publicStyles = read("css/archive-failed-experiments.css");
  const archiveStyles = read("css/archive-public.css");
  const archiveNotebook = read("js/archive-public.js");
  const publicSurface = `${publicHtml}\n${publicScript}`;
  const openNotebookMarkup = archiveNotebook.match(/<section class="archive-document-section" id="notebook"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(migration, /archive_failed_experiments/);
  assert.match(migration, /archive_failed_experiment_state_links/);
  assert.doesNotMatch(migration, /INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+archive_failed_experiments/i, "migration must not invent public records");

  assert.match(api, /archiveFailedExperimentsAdminApi/);
  assert.match(api, /publicFailedExperimentsApi/);
  assert.match(api, /archive-failed-experiments/);
  assert.match(api, /archive_failed_experiment/);
  assert.match(api, /rel-predecessor-of/);
  assert.match(api, /media_asset_variants/);
  assert.match(api, /public-display/);
  assert.match(worker, /\/archive\/failed-experiments\//);

  assert.match(studioManager, /view==="failed-experiments"/);
  assert.match(studioManager, /ArchiveFailedExperimentsStudio/);
  const archiveNav = studioPage.match(/\[\["dossiers","Dossiers"\][^\n]+/)?.[0] || "";
  assert.ok(archiveNav.indexOf('"Dossiers"') < archiveNav.indexOf('"Failed Experiments"'), "Failed Experiments follows Dossiers in Archive navigation");
  assert.ok(studioPage.indexOf("/studio/archive-failed-experiments.js") < studioPage.indexOf("/studio/construct-manager.js"), "Studio module loads before its manager");
  assert.match(studioModule, /archive-failed-experiments/);
  assert.match(studioModule, /media-pair/);
  assert.match(studioModule, /image\/webp/);

  assert.match(publicSurface, /<h1[^>]*>Failed Experiments\.<\/h1>/);
  assert.match(publicSurface, /Abandoned concepts, flawed tests, and unresolved attempts preserved as part of the work\./);
  assert.match(publicHtml, /\/js\/construct-connections\.js/);
  assert.match(publicScript, /data-failed-experiment-connections/);
  assert.equal((publicScript.match(/ConstructConnections\.mount/g) || []).length, 1, "detail mounts the existing Connections system exactly once");
  assert.match(publicScript, /loading=["']lazy["']/);
  assert.match(publicScript, /preload=["']none["']/);
  assert.match(publicStyles, /aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(publicStyles, /border[^:]*:\s*var\(--archive-rule\)/);
  assert.match(archiveStyles, /--archive-rule:\s*5px/);
  assert.match(publicStyles, /background:\s*var\(--color-bg\)/);
  assert.ok(openNotebookMarkup, "Open Notebook markup remains present");
  assert.doesNotMatch(openNotebookMarkup, /failed[-_]experiments/i, "Open Notebook must not duplicate Failed Experiments");
  assert.doesNotMatch(`${studioModule}\n${publicSurface}`, /Behind the Curtain/i);
});
