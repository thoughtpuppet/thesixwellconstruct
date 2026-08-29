import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class LocalD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.database, this.sql, values);
  }

  async all() {
    return this.executeAll();
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    if (row === undefined) return null;
    return column ? row[column] : row;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }

  executeAll() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: {} };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.executeAll());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function migrate(database) {
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(path.join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    database.exec(readFileSync(path.join(root, "migrations", migration), "utf8").replace(/^\uFEFF/, ""));
  }
  return migrations.length;
}

function seedPrivacyMatrix(database) {
  const insertMedia = database.prepare(`INSERT INTO media_assets
    (id,source_url,original_filename,mime_type,byte_size,alt_text,caption,privacy,state,created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation)
    VALUES(?,?,?,?,1,?,?,?,?,'qa',datetime('now'),datetime('now'),?,?,?,?,?,?)`);
  const media = [
    ["qa-media-ready","/assets/qa-ready.mp3","qa-ready.mp3","audio/mpeg","Ready audio","Reviewed voice memo","public","active","orbital whisper in the blue room","ready","en","Ready voice memo","Reviewed transcript","inline"],
    ["qa-media-pending","/assets/qa-pending.mp3","qa-pending.mp3","audio/mpeg","Pending audio","Pending voice memo","public","active","pending secret phrase","pending","en","Pending voice memo","Not reviewed","inline"],
    ["qa-media-additional","/assets/qa-additional.jpg","qa-additional.jpg","image/jpeg","Additional image","Public process evidence","public","active","additional public phrase","ready","en","Additional image","Public process evidence","inline"],
    ["qa-media-hidden","/assets/qa-hidden.jpg","qa-hidden.jpg","image/jpeg","Hidden image","Hidden presentation","public","active","hidden secret phrase","ready","en","Hidden image","Must stay hidden","hidden"],
    ["qa-media-archived","/assets/qa-archived.jpg","qa-archived.jpg","image/jpeg","Archived image","Archived asset","public","archived","archived secret phrase","ready","en","Archived image","Must stay archived","inline"],
    ["qa-media-internal","/assets/qa-internal.jpg","qa-internal.jpg","image/jpeg","Internal image","Internal asset","internal","active","internal secret phrase","ready","en","Internal image","Must stay internal","inline"],
    ["qa-media-detached","/assets/qa-detached.jpg","qa-detached.jpg","image/jpeg","Detached image","No public attachment","public","active","detached secret phrase","ready","en","Detached image","Must stay detached","inline"],
  ];
  for (const row of media) insertMedia.run(...row);

  const insertMaterial = database.prepare(`INSERT INTO archive_materials
    (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'qa','qa',datetime('now'),datetime('now'))`);
  const materials = [
    ["qa-note-public","art-marbles",null,"notebook","note","Blue punctuation note","A public notebook caption",'Notebook punctuation: "blue?" dots & memory.',"research","2023-04-01",null,"approximate","Around spring 2023","public","published",20],
    ["qa-note-unlisted","art-marbles",null,"notebook-unlisted","note","Unlisted note","","unlisted secret phrase","",null,null,"undated","","unlisted","published",21],
    ["qa-note-private","art-marbles",null,"notebook-private","note","Private note","","private secret phrase","",null,null,"undated","","private","published",22],
    ["qa-note-internal","art-marbles",null,"notebook-internal","note","Internal note","","internal note phrase","",null,null,"undated","","internal","published",23],
    ["qa-note-draft","art-marbles",null,"notebook-draft","note","Draft note","","draft secret phrase","",null,null,"undated","","public","draft",24],
    ["qa-audio-ready","art-marbles","qa-media-ready","notebook-ready","voice-memo","Ready voice memo","A reviewed audio excerpt","","reflection","2023-06-01",null,"exact","June 1, 2023","public","published",25],
    ["qa-audio-pending","art-marbles","qa-media-pending","notebook-pending","voice-memo","Pending voice memo","Transcript is under review","","reflection",null,null,"undated","Date not verified","public","published",26],
    ["qa-media-additional-material","art-marbles","qa-media-additional","notebook-additional","process-photo","Additional public material","","","process",null,null,"undated","","public","published",27],
    ["qa-media-hidden-material","art-marbles","qa-media-hidden","notebook-hidden","process-photo","Hidden material","","","process",null,null,"undated","","public","published",28],
    ["qa-media-archived-material","art-marbles","qa-media-archived","notebook-archived","process-photo","Archived material","","","process",null,null,"undated","","public","published",29],
    ["qa-media-internal-material","art-marbles","qa-media-internal","notebook-media-internal","process-photo","Internal media material","","","process",null,null,"undated","","public","published",30],
  ];
  for (const row of materials) insertMaterial.run(...row);

  const insertActivity = database.prepare(`INSERT INTO entity_activity
    (id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
    VALUES(?,?,?,?,?,?,?,?,?,?,'qa',datetime('now'),datetime('now'),?,?,?,?,?)`);
  const activities = [
    ["qa-activity-exact","art-marbles","milestone","Exact test entry","","2023-02-03",null,null,1,20,"Exact date body","","exact","February 3, 2023","QA"],
    ["qa-activity-approximate","art-marbles","milestone","Approximate test entry","","2023-03-01",null,null,1,21,"Approximate activity searchable phrase","","approximate","Around March 2023","QA"],
    ["qa-activity-year","art-marbles","milestone","Year test entry","","2024-01-01",null,null,1,22,"Year-only body","","year","2024","QA"],
    ["qa-activity-range","art-marbles","milestone","Range test entry","","2024-05-01","2024-08-31",null,1,23,"Ranged body","","range","May–August 2024","QA"],
    ["qa-activity-undated","art-marbles","milestone","Undated test entry","",null,null,null,1,24,"Undated body","","undated","Date not verified","QA"],
    ["qa-hoodie-dossier-gate","merch-lostmarbles-hoodie","milestone","Hidden hoodie timeline entry","","2025-01-01",null,null,1,25,"Must disappear with dossier","","exact","January 1, 2025","QA"],
  ];
  for (const row of activities) insertActivity.run(...row);

  const insertSubject = database.prepare("INSERT INTO entity_activity_subjects(activity_id,subject_entity_id,public_visible,sort_order,created_at) VALUES(?,?,1,?,datetime('now'))");
  for (const id of ["qa-activity-exact","qa-activity-approximate","qa-activity-year","qa-activity-range","qa-activity-undated","qa-hoodie-dossier-gate"]) insertSubject.run(id,"node-art",1);
  insertSubject.run("qa-activity-approximate","org-thoughtpuppet",2);

  database.prepare(`INSERT INTO archive_timeline_chapters
    (id,timeline_id,title,summary,body,occurred_at,ended_at,date_precision,date_label,anchor_slug,dedupe_key,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
    VALUES('qa-chapter-dedupe','archive-timeline-art','Exact test entry','Authored frame','Authored duplicate frame','2023-02-03',NULL,'exact','February 3, 2023','qa-exact','', 'published',1,20,'qa','qa',datetime('now'),datetime('now'))`).run();
}

async function requestApi(env, pathname, { method = "GET", body, auth = false } = {}) {
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (auth) headers.set("authorization", `Bearer ${env.SUBMISSIONS_ADMIN_TOKEN}`);
  return handleConstructApi(new Request(`https://local.test${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}

async function jsonApi(env, pathname, options) {
  const response = await requestApi(env, pathname, options);
  const payload = await response.json();
  return { response, payload };
}

function includesId(rows, id) {
  return Array.isArray(rows) && rows.some((row) => row.id === id);
}

async function run() {
  const database = new DatabaseSync(":memory:");
  const migrationCount = migrate(database);
  seedPrivacyMatrix(database);
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: "archive-local-test" };

  const items = await jsonApi(env, "/api/archive/items?limit=100");
  assert.equal(items.response.status, 200);
  assert.equal(items.payload.pagination.total, 24);
  assert.equal(items.payload.items.filter((item) => item.entity_id === "art-marbles").length, 1);
  assert.ok(items.payload.facets.material_type.some((facet) => facet.slug === "note"));

  const detail = await jsonApi(env, "/api/archive/items/lostmarbles");
  assert.equal(detail.response.status, 200);
  assert.ok(includesId(detail.payload.materials, "qa-note-public"));
  assert.ok(includesId(detail.payload.materials, "qa-audio-ready"));
  assert.ok(includesId(detail.payload.materials, "qa-audio-pending"));
  assert.ok(includesId(detail.payload.materials, "qa-media-additional-material"));
  for (const id of ["qa-note-unlisted","qa-note-private","qa-note-internal","qa-note-draft","qa-media-hidden-material","qa-media-archived-material","qa-media-internal-material"]) {
    assert.ok(!includesId(detail.payload.materials, id), `${id} leaked into public detail`);
  }
  const detailText = JSON.stringify(detail.payload);
  assert.match(detailText, /orbital whisper/);
  for (const secret of ["pending secret phrase","hidden secret phrase","archived secret phrase","internal secret phrase","unlisted secret phrase","private secret phrase","draft secret phrase"]) assert.ok(!detailText.includes(secret), `${secret} leaked`);

  for (const query of ["blue?", '"blue?"', "dots & memory"] ) {
    const search = await jsonApi(env, `/api/search?q=${encodeURIComponent(query)}`);
    assert.equal(search.response.status, 200);
    const marbles = search.payload.records.find((record) => record.entity_id === "art-marbles");
    assert.ok(marbles, `Marbles missing for ${query}`);
    assert.ok(marbles.matches.some((match) => match.anchor === "material-qa-note-public"));
  }
  const transcriptSearch = await jsonApi(env, "/api/search?q=orbital%20whisper");
  assert.ok(transcriptSearch.payload.records.some((record) => record.entity_id === "art-marbles"));
  const pendingSearch = await jsonApi(env, "/api/search?q=pending%20secret%20phrase");
  assert.ok(!pendingSearch.payload.records.some((record) => record.entity_id === "art-marbles" && record.matches?.length));
  const activitySearch = await jsonApi(env, "/api/search?q=Approximate%20activity%20searchable%20phrase");
  assert.ok(activitySearch.payload.records.find((record) => record.entity_id === "art-marbles")?.matches.some((match) => match.fragment_type === "activity"));
  const relationshipSearch = await jsonApi(env, "/api/search?q=Derived%20from");
  assert.ok(relationshipSearch.payload.records.some((record) => ["art-marbles","merch-lostmarbles-hoodie"].includes(record.entity_id) && record.matches.some((match) => match.fragment_type === "relationship")));

  const publicFragmentKeys = database.prepare("SELECT fragment_type||':'||source_id key FROM archive_search_fragments WHERE dossier_entity_id='art-marbles' ORDER BY key").all().map((row) => row.key);
  assert.ok(publicFragmentKeys.length > 0, "Marbles search fragments were not seeded");
  database.prepare("UPDATE archive_dossiers SET state='draft',public_visible=0 WHERE entity_id='art-marbles'").run();
  assert.deepEqual(database.prepare("SELECT id FROM archive_search_fragments WHERE dossier_entity_id='art-marbles'").all(), [], "unpublishing did not remove all dossier fragments");
  const unpublishedSearch = await jsonApi(env, "/api/search?q=orbital%20whisper");
  assert.ok(!unpublishedSearch.payload.records.some((record) => record.entity_id === "art-marbles"), "unpublished dossier remained searchable");
  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id='art-marbles'").run();
  const rebuiltFragmentKeys = database.prepare("SELECT fragment_type||':'||source_id key FROM archive_search_fragments WHERE dossier_entity_id='art-marbles' ORDER BY key").all().map((row) => row.key);
  assert.deepEqual(rebuiltFragmentKeys, publicFragmentKeys, "dossier republish did not restore the complete fragment set");
  const rebuildExpectations = [
    { query: "blue%3F", fragmentType: "material", sourceId: "qa-note-public" },
    { query: "orbital%20whisper", fragmentType: "material", sourceId: "qa-audio-ready" },
    { query: "Approximate%20activity%20searchable%20phrase", fragmentType: "activity", sourceId: "qa-activity-approximate" },
    { query: "Source%20for", fragmentType: "relationship", sourceId: "connection-marbles-hoodie-art" },
  ];
  for (const { query, fragmentType, sourceId } of rebuildExpectations) {
    const rebuiltSearch = await jsonApi(env, `/api/search?q=${query}`);
    const rebuiltMarbles = rebuiltSearch.payload.records.find((record) => record.entity_id === "art-marbles");
    assert.ok(rebuiltMarbles?.matches.some((match) => match.fragment_type === fragmentType && match.source_id === sourceId), `dossier republish did not rebuild ${fragmentType}:${sourceId}`);
  }

  database.prepare("UPDATE content_entities SET visibility='internal' WHERE id='art-marbles'").run();
  const privateEntitySearch = await jsonApi(env, "/api/search?q=orbital%20whisper");
  assert.ok(!privateEntitySearch.payload.records.some((record) => record.entity_id === "art-marbles"), "non-public entity remained searchable");
  database.prepare("UPDATE content_entities SET visibility='public' WHERE id='art-marbles'").run();
  const republishedEntitySearch = await jsonApi(env, "/api/search?q=orbital%20whisper");
  const republishedEntity = republishedEntitySearch.payload.records.find((record) => record.entity_id === "art-marbles");
  assert.ok(republishedEntity?.matches.some((match) => match.fragment_type === "material" && match.source_id === "qa-audio-ready"), "entity republish did not rebuild child search fragments");

  const artTimeline = await jsonApi(env, "/api/archive/timelines/art");
  assert.equal(artTimeline.response.status, 200);
  for (const id of ["qa-activity-exact","qa-activity-approximate","qa-activity-year","qa-activity-range","qa-activity-undated","qa-hoodie-dossier-gate"]) assert.ok(includesId(artTimeline.payload.activities, id));
  assert.equal(artTimeline.payload.entries.filter((entry) => entry.title === "Exact test entry").length, 1, "authored/generated entry was not deduplicated");
  assert.equal(artTimeline.payload.entries.at(-1).date_precision, "undated");
  const thoughtpuppetTimeline = await jsonApi(env, "/api/archive/timelines/thoughtpuppet");
  assert.ok(includesId(thoughtpuppetTimeline.payload.activities, "qa-activity-approximate"));

  database.prepare("UPDATE archive_dossiers SET state='draft',public_visible=0 WHERE entity_id='merch-lostmarbles-hoodie'").run();
  const gatedTimeline = await jsonApi(env, "/api/archive/timelines/art");
  assert.ok(!includesId(gatedTimeline.payload.activities, "qa-hoodie-dossier-gate"), "unpublished owner leaked into timeline");

  const publicMedia = await requestApi(env, "/api/construct/media/qa-media-ready");
  assert.equal(publicMedia.status, 302);
  assert.equal(publicMedia.headers.get("cache-control"), "private, no-store");
  assert.match(publicMedia.headers.get("location"), /qa-ready\.mp3$/);
  const additionalPublicMedia = await requestApi(env, "/api/construct/media/qa-media-additional");
  assert.equal(additionalPublicMedia.status, 302);
  assert.match(additionalPublicMedia.headers.get("location"), /qa-additional\.jpg$/);
  for (const id of ["qa-media-hidden","qa-media-archived","qa-media-internal","qa-media-detached"]) assert.equal((await requestApi(env, `/api/construct/media/${id}`)).status, 404, `${id} file gate failed`);
  assert.equal((await requestApi(env, "/api/construct/media/qa-media-ready", { method: "POST" })).status, 405);
  assert.equal((await requestApi(env, "/api/construct/entity-media/qa-media-hidden")).status, 404);
  assert.equal((await requestApi(env, "/api/admin/media/qa-media-internal/file")).status, 401);
  const adminPreview = await requestApi(env, "/api/admin/media/qa-media-internal/file", { auth: true });
  assert.equal(adminPreview.status, 302);
  assert.equal(adminPreview.headers.get("cache-control"), "private, no-store");
  assert.equal((await requestApi(env, "/api/admin/media/qa-media-internal/file", { method: "POST", auth: true })).status, 405);
  const publicArt = await jsonApi(env, "/api/art/art-marbles");
  assert.ok(!JSON.stringify(publicArt.payload).includes("qa-hidden.jpg"), "hidden entity media leaked through catalog");

  assert.equal((await requestApi(env, "/api/admin/archive-dossiers")).status, 401);
  const createdMaterial = await jsonApi(env, "/api/admin/archive-materials", { method: "POST", auth: true, body: { dossier_entity_id: "art-marbles", material_type: "note", title: "Soft archive material", body: "Internal QA", visibility: "internal", state: "draft" } });
  assert.equal(createdMaterial.response.status, 201);
  const materialId = createdMaterial.payload.record.id;
  const deletedMaterial = await jsonApi(env, `/api/admin/archive-materials/${materialId}`, { method: "DELETE", auth: true });
  assert.equal(deletedMaterial.payload.archived, true);
  const archivedMaterial = database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").get(materialId);
  assert.equal(archivedMaterial.state, "archived");
  assert.equal(archivedMaterial.visibility, "internal");

  const createdActivity = await jsonApi(env, "/api/admin/archive-activities", { method: "POST", auth: true, body: { entity_id: "art-marbles", activity_type: "milestone", title: "Soft archive activity", summary: "QA", date_precision: "undated", date_label: "Date not verified", subject_ids: ["node-art"], public_visible: true } });
  assert.equal(createdActivity.response.status, 201);
  const activityId = createdActivity.payload.record.id;
  const deletedActivity = await jsonApi(env, `/api/admin/archive-activities/${activityId}`, { method: "DELETE", auth: true });
  assert.equal(deletedActivity.payload.archived, true);
  assert.equal(database.prepare("SELECT public_visible FROM entity_activity WHERE id=?").get(activityId).public_visible, 0);
  assert.equal(database.prepare("SELECT public_visible FROM entity_activity_subjects WHERE activity_id=?").get(activityId).public_visible, 0);

  const createdChapter = await jsonApi(env, "/api/admin/archive-timelines/archive-timeline-art/chapters", { method: "POST", auth: true, body: { title: "Soft archive chapter", body: "QA", date_precision: "undated", state: "draft", public_visible: false } });
  assert.equal(createdChapter.response.status, 201);
  const chapterId = createdChapter.payload.record.id;
  const deletedChapter = await jsonApi(env, `/api/admin/archive-timelines/archive-timeline-art/chapters/${chapterId}`, { method: "DELETE", auth: true });
  assert.equal(deletedChapter.payload.archived, true);
  const archivedChapter = database.prepare("SELECT state,public_visible FROM archive_timeline_chapters WHERE id=?").get(chapterId);
  assert.equal(archivedChapter.state, "archived");
  assert.equal(archivedChapter.public_visible, 0);

  console.log(`Archive API tests passed (${migrationCount} migrations, privacy/search/timeline/soft-archive matrix).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
