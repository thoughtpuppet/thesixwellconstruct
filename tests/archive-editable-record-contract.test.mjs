import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { ensureEditableArchiveDossier } from "../functions/api/_shared/archive-dossiers.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION = "0183_archive_editable_studio_records.sql";
const TOKEN = "archive-editable-record-token";

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

class RefinementRaceStatement {
  constructor(inner, owner, values = []) { this.inner = inner; this.owner = owner; this.values = values; }
  bind(...values) { return new RefinementRaceStatement(this.inner.bind(...values), this.owner, values); }
  async first() { return this.inner.first(); }
  async all() { return this.inner.all(); }
  async run() {
    if (!this.owner.raced) {
      this.owner.raced = true;
      this.owner.database.prepare(`INSERT INTO archive_dossiers(
        entity_id,archive_slug,record_type,state,public_visible,
        created_by,updated_by,created_at,updated_at
      ) VALUES(?,?,'special-project','draft',0,'test','test',datetime('now'),datetime('now'))`)
        .run(this.owner.competingEntityId, this.values[0]);
    }
    return this.inner.run();
  }
}

class RefinementRaceD1 extends LocalD1 {
  constructor(database, competingEntityId) {
    super(database);
    this.competingEntityId = competingEntityId;
    this.raced = false;
  }
  prepare(sql) {
    const statement = super.prepare(sql);
    if (/^UPDATE archive_dossiers SET archive_slug=/i.test(sql.trim())) {
      return new RefinementRaceStatement(statement, this);
    }
    return statement;
  }
}

class FailingFirstStatement {
  constructor(inner) { this.inner = inner; }
  bind(...values) { return new FailingFirstStatement(this.inner.bind(...values)); }
  async first() { throw new Error("Injected D1 structure failure"); }
  async all() { return this.inner.all(); }
  async run() { return this.inner.run(); }
}

class FailingStructureD1 extends LocalD1 {
  prepare(sql) {
    const statement = super.prepare(sql);
    return sql.trim() === "SELECT * FROM archive_catalogue_entries WHERE entity_id=?"
      ? new FailingFirstStatement(statement)
      : statement;
  }
}

function database({ stopBefore = "", through = "" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    if (name === stopBefore) break;
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
    if (through && name === through) break;
  }
  return db;
}

function environment(database) {
  return { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: TOKEN };
}

function request(path, { method = "GET", admin = false, body } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function seedBackfillFixtures(db) {
  db.exec(`
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES
      ('editable-art','art_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-merch','merch_item','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-portfolio','portfolio_item','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-flash','flash_item','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-tattoo-design','tattoo_design','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-event','event','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-appearance','appearance','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-symbol','visual_symbol','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-writing','writing_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-film','film_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-music','music_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-existing','art_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-archived','art_work','internal',0,'test','test',datetime('now'),datetime('now'));

    UPDATE content_entities SET archived_at=datetime('now') WHERE id='editable-archived';

    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at) VALUES
      ('editable-art','editable-art-slug','Editable Art','not-for-sale','draft',datetime('now'),datetime('now')),
      ('editable-existing','editable-existing-source','Existing Art','not-for-sale','draft',datetime('now'),datetime('now')),
      ('editable-archived','editable-archived-source','Archived Art','not-for-sale','archived',datetime('now'),datetime('now'));
    INSERT INTO merch_items(id,slug,title,product_type,route,state,created_at,updated_at)
      VALUES('editable-merch','editable-merch-slug','Editable Merch','other','/merch/editable-merch-slug/','draft',datetime('now'),datetime('now'));
    INSERT INTO portfolio_items(id,title,state,created_at,updated_at)
      VALUES('editable-portfolio','Editable Tattoo','draft',datetime('now'),datetime('now'));
    INSERT INTO flash_items(id,slug,title,state,created_at,updated_at)
      VALUES('editable-flash','editable-flash-slug','Editable Flash','draft',datetime('now'),datetime('now'));
    INSERT INTO tattoo_designs(id,slug,title,state,created_at,updated_at)
      VALUES('editable-tattoo-design','editable-tattoo-design-slug','Editable Tattoo Design','draft',datetime('now'),datetime('now'));
    INSERT INTO events(id,slug,title,status,publication_state,created_at,updated_at)
      VALUES('editable-event','editable-event-slug','Editable Event','closed','draft',datetime('now'),datetime('now'));
    INSERT INTO artist_appearances(id,slug,title,starts_at,state,created_at,updated_at)
      VALUES('editable-appearance','editable-appearance-slug','Editable Appearance','2026-09-01T19:00:00-04:00','draft',datetime('now'),datetime('now'));
    INSERT INTO visual_symbols(id,category_id,slug,name,meaning,svg_markup,state,created_at,updated_at)
      VALUES('editable-symbol','maze','editable-symbol-slug','Editable Symbol','Test symbol','<svg></svg>','draft',datetime('now'),datetime('now'));

    INSERT INTO archive_dossiers(
      entity_id,archive_slug,orientation,story,record_type,state,public_visible,published_at,
      created_by,updated_by,created_at,updated_at
    ) VALUES(
      'editable-existing','curated-existing-archive','Curated orientation','Curated story','artwork',
      'published',1,'2026-01-02T03:04:05Z','test','test','2026-01-01T00:00:00Z','2026-01-02T03:04:05Z'
    );
  `);
}

test("0183 backfills every active eligible creative type as a private canonical dossier", () => {
  const db = database({ stopBefore: MIGRATION });
  seedBackfillFixtures(db);
  const existingBefore = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='editable-existing'").get();

  db.exec(readFileSync(join(ROOT, "migrations", MIGRATION), "utf8"));

  const expected = new Map([
    ["editable-art", ["editable-art-slug", "artwork"]],
    ["editable-merch", ["editable-merch-slug", "merchandise"]],
    ["editable-portfolio", ["editable-portfolio", "tattoo"]],
    ["editable-flash", ["editable-flash-slug", "flash"]],
    ["editable-tattoo-design", ["editable-tattoo-design-slug", "tattoo-design"]],
    ["editable-event", ["editable-event-slug", "event"]],
    ["editable-appearance", ["editable-appearance-slug", "event"]],
    ["editable-symbol", ["editable-symbol-slug", "symbol"]],
    ["editable-writing", ["editable-writing", "writing-work"]],
    ["editable-film", ["editable-film", "film-work"]],
    ["editable-music", ["editable-music", "music-work"]],
  ]);
  for (const [entityId, [archiveSlug, recordType]] of expected) {
    const dossier = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").get(entityId);
    assert.ok(dossier, entityId);
    assert.equal(dossier.archive_slug, archiveSlug);
    assert.equal(dossier.record_type, recordType);
    assert.equal(dossier.state, "draft");
    assert.equal(dossier.public_visible, 0);
    assert.equal(dossier.published_at, null);
  }

  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='editable-archived'").get().count, 0);
  assert.deepEqual({ ...db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='editable-existing'").get() }, { ...existingBefore });

  for (const entityId of [
    "editable-art", "editable-merch", "editable-portfolio", "editable-flash",
    "editable-tattoo-design", "editable-symbol", "editable-writing", "editable-film", "editable-music",
  ]) {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get(entityId).count, 1, entityId);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id=?").get(entityId).count, 1, entityId);
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_states state
      JOIN archive_object_versions version ON version.id=state.version_id WHERE version.entity_id=?`).get(entityId).count, 1, entityId);
  }
  for (const entityId of ["editable-event", "editable-appearance"]) {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_event_identifiers WHERE entity_id=?").get(entityId).count, 1, entityId);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get(entityId).count, 0, entityId);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id=?").get(entityId).count, 0, entityId);
  }
});

test("0183 normalizes blank slugs and deterministically escapes every occupied fallback", () => {
  const db = database({ stopBefore: MIGRATION });
  const entityId = "editable-collision-target";
  const collisionRoot = `art-work-collision-entity-${Buffer.from(entityId).toString("hex")}`;
  db.exec(`
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES
      ('editable-blank-slug','art_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('${entityId}','art_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-cross-backfill','art_work','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-1','special_project','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-2','special_project','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-3','special_project','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-4','special_project','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at) VALUES
      ('editable-blank-slug','','Blank Slug Art','not-for-sale','draft',datetime('now'),datetime('now')),
      ('${entityId}','collision','Collision Art','not-for-sale','draft',datetime('now'),datetime('now')),
      ('editable-cross-backfill','${collisionRoot}-3','Cross Backfill Art','not-for-sale','draft',datetime('now'),datetime('now'));
    INSERT INTO archive_dossiers(entity_id,archive_slug,record_type,state,public_visible,created_by,updated_by,created_at,updated_at) VALUES
      ('editable-slug-occupant-1','collision','special-project','draft',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-2','art-work-collision','special-project','draft',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-3','${collisionRoot}','special-project','draft',0,'test','test',datetime('now'),datetime('now')),
      ('editable-slug-occupant-4','${collisionRoot}-2','special-project','draft',0,'test','test',datetime('now'),datetime('now'));
  `);

  db.exec(readFileSync(join(ROOT, "migrations", MIGRATION), "utf8"));

  assert.equal(
    db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='editable-blank-slug'").get().archive_slug,
    "editable-blank-slug",
  );
  assert.equal(
    db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id=?").get(entityId).archive_slug,
    `${collisionRoot}-3`,
  );
  assert.equal(
    db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='editable-cross-backfill'").get().archive_slug,
    `art-work-${collisionRoot}-3`,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM archive_dossiers").get().count,
    db.prepare("SELECT COUNT(DISTINCT archive_slug) count FROM archive_dossiers").get().count,
  );
});

test("source creation and publication only ensure a private editable shell", async () => {
  const db = database();
  db.exec(`
    INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-trigger-art','art_work','node-art','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at)
      VALUES('editable-trigger-art','editable-trigger-slug','Trigger Art','not-for-sale','draft',datetime('now'),datetime('now'));
    UPDATE content_entities SET visibility='public',search_visibility=1,public_at=datetime('now') WHERE id='editable-trigger-art';
  `);

  let dossier = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='editable-trigger-art'").get();
  assert.equal(dossier.archive_slug, "editable-trigger-art");
  assert.equal(dossier.state, "draft");
  assert.equal(dossier.public_visible, 0);
  assert.equal(dossier.published_at, null);

  const response = await handleConstructApi(request("/api/admin/entities/editable-trigger-art/archive-dossier", {
    method: "POST", admin: true,
  }), environment(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.created, false);
  assert.equal(payload.record.entity_id, "editable-trigger-art");
  assert.equal(payload.record.archive_slug, "editable-trigger-slug");

  dossier = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='editable-trigger-art'").get();
  assert.equal(dossier.state, "draft");
  assert.equal(dossier.public_visible, 0);
  const publicResponse = await handleConstructApi(request("/api/archive/items/editable-trigger-slug"), environment(db));
  assert.equal(publicResponse.status, 404);

  db.prepare("UPDATE archive_dossiers SET archive_slug='' WHERE entity_id='editable-trigger-art'").run();
  const recovered = await ensureEditableArchiveDossier(new LocalD1(db), "editable-trigger-art", { actor: "test" });
  assert.equal(recovered.record.archive_slug, "editable-trigger-slug");
});

test("provisional slug refinement re-reads and retries a cross-entity UNIQUE race", async () => {
  const db = database();
  db.exec(`
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-refinement-race','art_work','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at)
      VALUES('editable-refinement-race','refinement-race-slug','Race Art','not-for-sale','draft',datetime('now'),datetime('now'));
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-refinement-competitor','special_project','internal',0,'test','test',datetime('now'),datetime('now'));
  `);
  const racingDatabase = new RefinementRaceD1(db, "editable-refinement-competitor");

  const ensured = await ensureEditableArchiveDossier(racingDatabase, "editable-refinement-race", { actor: "test" });

  assert.equal(racingDatabase.raced, true);
  assert.equal(ensured.created, false);
  assert.equal(ensured.record.archive_slug, "art-work-refinement-race-slug");
  assert.equal(db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='editable-refinement-competitor'").get().archive_slug, "refinement-race-slug");
  assert.equal(db.prepare("SELECT state FROM archive_dossiers WHERE entity_id='editable-refinement-race'").get().state, "draft");
});

test("the authenticated ensure endpoint is idempotent and reports 404 and 409 boundaries", async () => {
  const db = database();
  const runtime = environment(db);
  db.exec(`
    INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,archived_at,created_by,updated_by,created_at,updated_at
    ) VALUES(
      'editable-on-demand','art_work','node-art','internal',0,datetime('now'),'test','test',datetime('now'),datetime('now')
    );
    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at)
      VALUES('editable-on-demand','editable-on-demand-slug','Archived On Demand','not-for-sale','archived',datetime('now'),datetime('now'));
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-ineligible','current_project','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES
      ('editable-ineligible-existing','current_project','internal',0,'test','test',datetime('now'),datetime('now')),
      ('editable-archive-native','archive_record','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO archive_records(id,slug,title,record_type,state,created_at,updated_at)
      VALUES('editable-archive-native','editable-archive-native','Archive Native Record','practice','draft',datetime('now'),datetime('now'));
    INSERT INTO archive_dossiers(entity_id,archive_slug,record_type,state,public_visible,created_by,updated_by,created_at,updated_at) VALUES
      ('editable-ineligible-existing','editable-ineligible-existing','current-project','draft',0,'test','test',datetime('now'),datetime('now')),
      ('editable-archive-native','editable-archive-native','practice','draft',0,'test','test',datetime('now'),datetime('now'));
  `);

  let response = await handleConstructApi(request("/api/admin/entities/editable-on-demand/archive-dossier", { method: "POST" }), runtime);
  assert.equal(response.status, 401);
  response = await handleConstructApi(request("/api/admin/entities/missing-entity/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 404);
  response = await handleConstructApi(request("/api/admin/entities/editable-ineligible/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 409);
  response = await handleConstructApi(request("/api/admin/entities/editable-ineligible-existing/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 409);
  response = await handleConstructApi(request("/api/admin/entities/editable-archive-native/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).created, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='editable-archive-native'").get().count, 1);

  response = await handleConstructApi(request("/api/admin/entities/editable-on-demand/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 201);
  let payload = await response.json();
  assert.equal(payload.created, true);
  assert.equal(payload.record.entity_id, "editable-on-demand");
  assert.equal(payload.record.archive_slug, "editable-on-demand-slug");
  assert.equal(payload.record.state, "draft");
  assert.equal(payload.record.public_visible, 0);

  response = await handleConstructApi(request("/api/admin/entities/editable-on-demand/archive-dossier", { method: "POST", admin: true }), runtime);
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.created, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='editable-on-demand'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id='editable-on-demand'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id='editable-on-demand'").get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_states state
    JOIN archive_object_versions version ON version.id=state.version_id
    WHERE version.entity_id='editable-on-demand'`).get().count, 1);
});

test("the ensure endpoint reports unexpected structure failures as 500, not 409", async () => {
  const db = database();
  db.exec(`
    INSERT INTO content_entities(id,entity_type,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-structure-failure','art_work','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO art_works(id,slug,title,availability,state,created_at,updated_at)
      VALUES('editable-structure-failure','editable-structure-failure-slug','Structure Failure','not-for-sale','draft',datetime('now'),datetime('now'));
  `);
  const runtime = { SUBMISSIONS_DB: new FailingStructureD1(db), SUBMISSIONS_ADMIN_TOKEN: TOKEN };

  const response = await handleConstructApi(request(
    "/api/admin/entities/editable-structure-failure/archive-dossier",
    { method: "POST", admin: true },
  ), runtime);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "The Archive dossier could not be prepared." });
});

test("event ensure uses its canonical ID and preserves any pre-existing structure", async () => {
  const db = database();
  const runtime = environment(db);
  db.exec(`
    INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
      VALUES('editable-event-runtime','event','node-events','internal',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO events(id,slug,title,status,publication_state,created_at,updated_at)
      VALUES('editable-event-runtime','editable-event-runtime-slug','Runtime Event','closed','draft',datetime('now'),datetime('now'));
  `);

  const nextNumber = Number(db.prepare(`SELECT MIN(candidate) next_number FROM (
      SELECT 1 candidate UNION SELECT catalogue_number+1 FROM archive_catalogue_entries WHERE catalogue_prefix='OBJ'
    ) candidates WHERE NOT EXISTS(
      SELECT 1 FROM archive_catalogue_entries occupied
      WHERE occupied.catalogue_prefix='OBJ' AND occupied.catalogue_number=candidates.candidate
    )`).get().next_number);
  const catalogueId = `OBJ-${String(nextNumber).padStart(3, "0")}`;
  db.prepare(`INSERT INTO archive_catalogue_entries(
      entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,
      current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at
    ) VALUES('editable-event-runtime','other','other-cultural-object','OBJ',?,?,1,'I','','test','test',datetime('now'),datetime('now'))`).run(nextNumber, catalogueId);
  db.exec(`
    INSERT INTO archive_object_versions(id,entity_id,version_number,created_at,updated_at)
      VALUES('editable-event-version','editable-event-runtime',1,datetime('now'),datetime('now'));
    INSERT INTO archive_object_states(id,version_id,state_roman,state_order,created_at,updated_at)
      VALUES('editable-event-state','editable-event-version','I',1,datetime('now'),datetime('now'));
  `);

  const response = await handleConstructApi(request("/api/admin/entities/editable-event-runtime/archive-dossier", {
    method: "POST", admin: true,
  }), runtime);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.record.entity_id, "editable-event-runtime");
  assert.equal(payload.record.archive_slug, "editable-event-runtime-slug");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_event_identifiers WHERE entity_id='editable-event-runtime'").get().count, 1);
  assert.equal(db.prepare("SELECT catalogue_id FROM archive_catalogue_entries WHERE entity_id='editable-event-runtime'").get().catalogue_id, catalogueId);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id='editable-event-runtime'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_states WHERE version_id='editable-event-version'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_records WHERE source_event_id='editable-event-runtime'").get().count, 0);

  const legacyRouteResponse = await handleConstructApi(request(
    "/api/admin/events/editable-event-runtime/create-archive-record",
    { method: "POST", admin: true },
  ), runtime);
  assert.equal(legacyRouteResponse.status, 200);
  assert.equal((await legacyRouteResponse.json()).record.entity_id, "editable-event-runtime");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_records WHERE source_event_id='editable-event-runtime'").get().count, 0);
});
