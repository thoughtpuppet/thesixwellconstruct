import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "archive-catalogue-test-token";

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

function databaseBefore(migrationName) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    if (name === migrationName) break;
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

test("migration assigns every existing cultural object an identity from the exact agreed families", () => {
  const db = database();
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ce.entity_type NOT IN ('event','appearance','organization')) cultural_objects,
    (SELECT COUNT(*) FROM archive_catalogue_entries) catalogue_entries,
    (SELECT COUNT(*) FROM archive_object_versions) versions,
    (SELECT COUNT(*) FROM archive_object_states) states`).get();
  assert.equal(counts.catalogue_entries, counts.cultural_objects);
  assert.equal(counts.versions, counts.cultural_objects);
  assert.equal(counts.states, counts.cultural_objects);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_catalogue_entries ace
    JOIN content_entities ce ON ce.id=ace.entity_id WHERE ce.entity_type IN ('event','appearance','organization')`).get().count, 0);
  assert.deepEqual({ ...db.prepare(`SELECT ad.record_type,ad.state,ad.public_visible
    FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE ad.entity_id='org-thoughtpuppet' AND ce.entity_type='organization'`).get() }, {
    record_type: "creative-identity",
    state: "draft",
    public_visible: 0,
  });
  const eventCounts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ce.entity_type IN ('event','appearance')) event_records,
    (SELECT COUNT(*) FROM archive_event_identifiers) event_identifiers`).get();
  assert.equal(eventCounts.event_identifiers, eventCounts.event_records);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_event_identifiers WHERE event_id NOT GLOB 'EVT-[0-9][0-9][0-9]*'").get().count, 0);

  const prefixes = db.prepare("SELECT DISTINCT catalogue_prefix FROM archive_cultural_object_types ORDER BY catalogue_prefix").all().map((row) => row.catalogue_prefix);
  assert.deepEqual(prefixes, ["ART", "FLM", "LEG", "MER", "MUS", "OBJ", "TAT-DES", "TAT-EXE", "WRI"]);
  const media = db.prepare("SELECT id FROM archive_catalogue_media ORDER BY id").all().map((row) => row.id);
  assert.deepEqual(media, ["art", "film", "legend", "merch", "music", "other", "tattoos", "writings"]);
  assert.equal(db.prepare("SELECT catalogue_prefix FROM archive_cultural_object_types WHERE id='tattoo-other'").get().catalogue_prefix, "TAT-DES");
  assert.equal(db.prepare("SELECT catalogue_prefix FROM archive_cultural_object_types WHERE id='other-event-derived-artifact'").get().catalogue_prefix, "OBJ");

  const painting = db.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id='art-marbles'").get();
  const hoodie = db.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id='merch-lostmarbles-hoodie'").get();
  assert.match(painting.catalogue_id, /^ART-\d{3}$/);
  assert.equal(painting.catalogue_id, "ART-004");
  assert.ok(painting.current_state_id);
  assert.equal(painting.medium_id, "art");
  assert.match(hoodie.catalogue_id, /^MER-\d{3}$/);
  assert.equal(hoodie.object_type_id, "merch-hoodie");
  assert.notEqual(painting.catalogue_id, hoodie.catalogue_id);

  const tattooPrefixes = db.prepare("SELECT id,catalogue_prefix FROM archive_cultural_object_types WHERE id IN ('tattoo-design','tattoo-execution') ORDER BY id").all();
  assert.deepEqual(tattooPrefixes.map((row) => row.catalogue_prefix), ["TAT-DES", "TAT-EXE"]);

  const unassigned = db.prepare(`SELECT COUNT(*) count FROM archive_materials am
    JOIN content_entities ce ON ce.id=am.dossier_entity_id
    WHERE ce.entity_type NOT IN ('event','appearance') AND (am.state_id IS NULL OR am.material_reference='')`).get();
  assert.equal(unassigned.count, 0);
  assert.ok(db.prepare(`SELECT COUNT(*) count FROM archive_object_versions version
    JOIN archive_dossiers dossier ON dossier.entity_id=version.entity_id
    WHERE dossier.state='draft' AND dossier.public_visible=0
      AND version.publication_state='draft' AND version.public_visible=0`).get().count > 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_versions version
    JOIN archive_dossiers dossier ON dossier.entity_id=version.entity_id
    WHERE dossier.created_by='migration-0183'
      AND (dossier.state<>'draft' OR dossier.public_visible<>0 OR dossier.published_at IS NOT NULL
        OR version.publication_state<>'draft' OR version.public_visible<>0)`).get().count, 0);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive_catalogue_documentation'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive_catalogue_identity_changes'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='archive_catalogue_identity_change_audit'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='archive_catalogue_lowest_open_insert'").get());
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_states aos
    JOIN archive_materials am ON am.id=aos.lead_material_id
    JOIN media_assets m ON m.id=am.media_id
    WHERE am.state_id<>aos.id OR (m.mime_type NOT LIKE 'image/%' AND m.mime_type NOT LIKE 'video/%')`).get().count, 0);
  assert.ok(db.prepare("SELECT id FROM relationship_types WHERE slug='executed-as'").get());
});

test("future tattoo dossier shells automatically receive a catalogue version and state", () => {
  const db = database();
  const previousMaximum = Number(db.prepare("SELECT COALESCE(MAX(catalogue_number),0) maximum FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE'").get().maximum);

  db.prepare(`INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,public_at,
      created_by,updated_by,created_at,updated_at
    ) VALUES('portfolio-future-structure','portfolio_item','node-tattoos','public',1,datetime('now'),
      'test','test',datetime('now'),datetime('now'))`).run();

  const dossier = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='portfolio-future-structure'").get();
  const catalogue = db.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id='portfolio-future-structure'").get();
  const version = db.prepare("SELECT * FROM archive_object_versions WHERE entity_id='portfolio-future-structure'").get();
  const state = db.prepare("SELECT * FROM archive_object_states WHERE version_id=?").get(version.id);

  assert.ok(dossier);
  assert.equal(dossier.record_type, "tattoo");
  assert.equal(catalogue.object_type_id, "tattoo-execution");
  assert.equal(catalogue.catalogue_prefix, "TAT-EXE");
  assert.equal(catalogue.catalogue_number, previousMaximum + 1);
  assert.equal(version.version_number, 1);
  assert.equal(version.publication_state, "draft");
  assert.equal(version.public_visible, 0);
  assert.equal(state.state_roman, "I");
  assert.equal(state.publication_state, "draft");
  assert.equal(state.public_visible, 0);
});

test("Tattoo Portfolio dossier labels stay consistent across automatic creation paths", () => {
  const db = database();

  assert.equal(db.prepare(`SELECT COUNT(*) count
    FROM archive_dossiers ad
    JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE ce.entity_type='portfolio_item' AND ad.record_type<>'tattoo'`).get().count, 0);

  db.prepare(`INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,
      created_by,updated_by,created_at,updated_at
    ) VALUES('portfolio-future-publish-label','portfolio_item','node-tattoos','internal',0,
      'test','test',datetime('now'),datetime('now'))`).run();
  db.prepare("UPDATE content_entities SET visibility='public',public_at=datetime('now') WHERE id='portfolio-future-publish-label'").run();

  const dossier = db.prepare("SELECT * FROM archive_dossiers WHERE entity_id='portfolio-future-publish-label'").get();
  assert.ok(dossier);
  assert.equal(dossier.record_type, "tattoo");
});

test("Archive presentation uses Tattoo and Tattoo Design without erasing internal catalogue types", async () => {
  const db = database();
  const runtime = env(db);

  db.exec(`
    INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES
      ('portfolio-presentation-label','portfolio_item','node-tattoos','public',1,'test','test',datetime('now'),datetime('now')),
      ('flash-presentation-label','flash_item','node-tattoos','public',1,'test','test',datetime('now'),datetime('now'));
  `);

  const response = await handleConstructApi(request("/api/admin/archive-dossiers", { admin: true }), runtime);
  assert.equal(response.status, 200);
  const records = (await response.json()).records;
  const tattoo = records.find((record) => record.entity_id === "portfolio-presentation-label");
  const tattooDesign = records.find((record) => record.entity_id === "flash-presentation-label");

  assert.equal(tattoo.cultural_object_type_id, "tattoo-execution");
  assert.equal(tattoo.cultural_object_type, "Tattoo");
  assert.equal(tattooDesign.cultural_object_type_id, "tattoo-flash-design");
  assert.equal(tattooDesign.cultural_object_type, "Tattoo Design");
});

test("0088 normalizes an existing Portfolio Item dossier label without changing its identity", () => {
  const migrationName = "0088_archive_tattoo_record_type_consistency.sql";
  const db = databaseBefore(migrationName);

  db.prepare(`INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,public_at,
      created_by,updated_by,created_at,updated_at
    ) VALUES('portfolio-legacy-label','portfolio_item','node-tattoos','public',1,datetime('now'),
      'test','test',datetime('now'),datetime('now'))`).run();

  const before = db.prepare(`SELECT ad.record_type,ace.catalogue_id
    FROM archive_dossiers ad
    JOIN archive_catalogue_entries ace ON ace.entity_id=ad.entity_id
    WHERE ad.entity_id='portfolio-legacy-label'`).get();
  assert.equal(before.record_type, "portfolio-item");

  db.exec(readFileSync(join(ROOT, "migrations", migrationName), "utf8"));

  const after = db.prepare(`SELECT ad.record_type,ace.catalogue_id
    FROM archive_dossiers ad
    JOIN archive_catalogue_entries ace ON ace.entity_id=ad.entity_id
    WHERE ad.entity_id='portfolio-legacy-label'`).get();
  assert.equal(after.record_type, "tattoo");
  assert.equal(after.catalogue_id, before.catalogue_id);
});

test("Studio catalogue initialization repairs a legacy shell and ignores a stale sequence number", async () => {
  const db = database();
  const runtime = env(db);
  db.prepare(`INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,public_at,
      created_by,updated_by,created_at,updated_at
    ) VALUES('portfolio-legacy-shell','portfolio_item','node-tattoos','public',1,datetime('now'),
      'test','test',datetime('now'),datetime('now'))`).run();

  db.prepare("DELETE FROM archive_catalogue_entries WHERE entity_id='portfolio-legacy-shell'").run();
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id='portfolio-legacy-shell'").get().count, 0);
  const previousMaximum = Number(db.prepare("SELECT COALESCE(MAX(catalogue_number),0) maximum FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE'").get().maximum);

  const response = await handleConstructApi(request("/api/admin/archive-catalogue/portfolio-legacy-shell", {
    method: "PATCH",
    admin: true,
    body: {
      medium_id: "tattoos",
      object_type_id: "tattoo-execution",
      catalogue_number: 1,
      current_state_id: null,
    },
  }), runtime);
  assert.equal(response.status, 200);
  const catalogue = (await response.json()).record;
  assert.equal(catalogue.catalogue_number, previousMaximum + 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id='portfolio-legacy-shell'").get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_states state
    JOIN archive_object_versions version ON version.id=state.version_id
    WHERE version.entity_id='portfolio-legacy-shell'`).get().count, 1);
});

test("Studio re-identifies catalogue families, audits privately, and releases the old number for lowest-gap reuse", async () => {
  const db = database();
  const runtime = env(db);
  const before = db.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id='art-marbles'").get();
  assert.equal(before.catalogue_id, "ART-004");

  for (const id of ["portfolio-gap-fixture-1", "portfolio-gap-fixture-2"]) {
    db.prepare(`INSERT INTO content_entities(
        id,entity_type,node_id,visibility,search_visibility,public_at,
        created_by,updated_by,created_at,updated_at
      ) VALUES(?,'portfolio_item','node-tattoos','public',1,datetime('now'),
        'test','test',datetime('now'),datetime('now'))`).run(id);
  }
  const releasedTarget = db.prepare("SELECT * FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE' ORDER BY catalogue_number LIMIT 1").get();
  assert.ok(releasedTarget);
  db.prepare("DELETE FROM archive_catalogue_entries WHERE entity_id=?").run(releasedTarget.entity_id);

  const preserved = db.prepare(`SELECT
    (SELECT COUNT(*) FROM archive_object_versions WHERE entity_id='art-marbles') versions,
    (SELECT COUNT(*) FROM archive_object_states state JOIN archive_object_versions version ON version.id=state.version_id WHERE version.entity_id='art-marbles') states,
    (SELECT COUNT(*) FROM archive_materials WHERE dossier_entity_id='art-marbles') materials,
    (SELECT COUNT(*) FROM entity_relationships WHERE source_entity_id='art-marbles' OR target_entity_id='art-marbles') relationships,
    (SELECT archive_slug FROM archive_dossiers WHERE entity_id='art-marbles') archive_slug`).get();

  const samePrefixResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles/reidentify", {
    method: "POST",
    admin: true,
    body: { medium_id: "art", object_type_id: "art-drawing", expected_catalogue_id: "ART-004" },
  }), runtime);
  assert.equal(samePrefixResponse.status, 409);

  const invalidTypeResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles/reidentify", {
    method: "POST",
    admin: true,
    body: { medium_id: "tattoos", object_type_id: "art-painting", expected_catalogue_id: "ART-004" },
  }), runtime);
  assert.equal(invalidTypeResponse.status, 409);

  const response = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles/reidentify", {
    method: "POST",
    admin: true,
    body: { medium_id: "tattoos", object_type_id: "tattoo-execution", expected_catalogue_id: "ART-004" },
  }), runtime);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.released_catalogue_id, "ART-004");
  assert.equal(payload.record.catalogue_prefix, "TAT-EXE");
  assert.equal(payload.record.catalogue_number, releasedTarget.catalogue_number);
  assert.equal(payload.record.catalogue_id, `TAT-EXE-${String(releasedTarget.catalogue_number).padStart(3, "0")}`);

  const change = db.prepare("SELECT * FROM archive_catalogue_identity_changes WHERE entity_id='art-marbles'").get();
  assert.equal(change.previous_catalogue_id, "ART-004");
  assert.equal(change.next_catalogue_id, payload.record.catalogue_id);
  assert.equal(change.changed_by, "studio-reidentify");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE catalogue_id='ART-004'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_documentation WHERE dossier_entity_id='art-marbles' AND field_key='former-catalogue-number'").get().count, 0);

  const after = db.prepare(`SELECT
    (SELECT COUNT(*) FROM archive_object_versions WHERE entity_id='art-marbles') versions,
    (SELECT COUNT(*) FROM archive_object_states state JOIN archive_object_versions version ON version.id=state.version_id WHERE version.entity_id='art-marbles') states,
    (SELECT COUNT(*) FROM archive_materials WHERE dossier_entity_id='art-marbles') materials,
    (SELECT COUNT(*) FROM entity_relationships WHERE source_entity_id='art-marbles' OR target_entity_id='art-marbles') relationships,
    (SELECT archive_slug FROM archive_dossiers WHERE entity_id='art-marbles') archive_slug`).get();
  assert.deepEqual(after, preserved);

  const staleResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles/reidentify", {
    method: "POST",
    admin: true,
    body: { medium_id: "tattoos", object_type_id: "tattoo-design", expected_catalogue_id: "ART-004" },
  }), runtime);
  assert.equal(staleResponse.status, 409);
  assert.equal(db.prepare("SELECT catalogue_id FROM archive_catalogue_entries WHERE entity_id='art-marbles'").get().catalogue_id, payload.record.catalogue_id);

  const publicResponse = await handleConstructApi(request("/api/archive/items?limit=100"), runtime);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json();
  assert.ok(publicPayload.groups.tattoo_executions.some((item) => item.entity_id === "art-marbles"));
  assert.ok(!publicPayload.groups.paintings.some((item) => item.entity_id === "art-marbles"));
  assert.ok(publicPayload.facets.medium.some((facet) => facet.slug === "tattoos"));
  const tattooFilterResponse = await handleConstructApi(request("/api/archive/items?medium=tattoos&limit=100"), runtime);
  assert.ok((await tattooFilterResponse.json()).items.some((item) => item.entity_id === "art-marbles"));
  const artFilterResponse = await handleConstructApi(request("/api/archive/items?medium=art&limit=100"), runtime);
  assert.ok(!(await artFilterResponse.json()).items.some((item) => item.entity_id === "art-marbles"));

  db.prepare(`INSERT INTO content_entities(
      id,entity_type,node_id,visibility,search_visibility,public_at,
      created_by,updated_by,created_at,updated_at
    ) VALUES('art-reuses-released-identity','art_work','node-art','public',1,datetime('now'),
      'test','test',datetime('now'),datetime('now'))`).run();
  const reused = db.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id='art-reuses-released-identity'").get();
  assert.equal(reused.catalogue_id, "ART-004");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_identity_changes WHERE entity_id='art-reuses-released-identity'").get().count, 0);
});

test("Studio re-identifies between Tattoo design and execution prefixes", async () => {
  const db = database();
  const runtime = env(db);
  const before = db.prepare("SELECT * FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-DES' ORDER BY catalogue_number LIMIT 1").get();
  assert.ok(before);
  const expectedNumber = db.prepare(`SELECT MIN(candidate) next_number FROM (
      SELECT 1 candidate
      UNION
      SELECT catalogue_number+1 FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE'
    ) candidates
    WHERE NOT EXISTS(SELECT 1 FROM archive_catalogue_entries occupied WHERE occupied.catalogue_prefix='TAT-EXE' AND occupied.catalogue_number=candidates.candidate)`).get().next_number;
  const response = await handleConstructApi(request(`/api/admin/archive-catalogue/${encodeURIComponent(before.entity_id)}/reidentify`, {
    method: "POST",
    admin: true,
    body: { medium_id: "tattoos", object_type_id: "tattoo-execution", expected_catalogue_id: before.catalogue_id },
  }), runtime);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.record.catalogue_prefix, "TAT-EXE");
  assert.equal(payload.record.catalogue_number, expectedNumber);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_identity_changes WHERE entity_id=?").get(before.entity_id).count, 1);
});

test("concurrent catalogue re-identifications allocate distinct lowest open target numbers", async () => {
  const db = database();
  const runtime = env(db);
  const sources = db.prepare("SELECT * FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-DES' ORDER BY catalogue_number LIMIT 2").all();
  assert.equal(sources.length, 2);
  const occupied = new Set(db.prepare("SELECT catalogue_number FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE'").all().map((row) => row.catalogue_number));
  const expected = [];
  for (let candidate = 1; expected.length < sources.length; candidate += 1) {
    if (!occupied.has(candidate)) expected.push(candidate);
  }

  const responses = await Promise.all(sources.map((source) => handleConstructApi(request(`/api/admin/archive-catalogue/${encodeURIComponent(source.entity_id)}/reidentify`, {
    method: "POST",
    admin: true,
    body: { medium_id: "tattoos", object_type_id: "tattoo-execution", expected_catalogue_id: source.catalogue_id },
  }), runtime)));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(payloads.map((payload) => payload.record.catalogue_number).sort((a, b) => a - b), expected);
  assert.equal(new Set(payloads.map((payload) => payload.record.catalogue_id)).size, 2);
  for (const source of sources) {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE catalogue_id=?").get(source.catalogue_id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_identity_changes WHERE entity_id=?").get(source.entity_id).count, 1);
  }
});

test("Studio dossier list orders catalogue identities newest to oldest", async () => {
  const db = database();
  const runtime = env(db);
  for (const id of ["portfolio-order-1", "portfolio-order-2", "portfolio-order-3"]) {
    db.prepare(`INSERT INTO content_entities(
        id,entity_type,node_id,visibility,search_visibility,public_at,
        created_by,updated_by,created_at,updated_at
      ) VALUES(?,'portfolio_item','node-tattoos','public',1,datetime('now'),
        'test','test',datetime('now'),datetime('now'))`).run(id);
  }
  const entries = db.prepare("SELECT * FROM archive_catalogue_entries WHERE catalogue_prefix='TAT-EXE' ORDER BY catalogue_number LIMIT 3").all();
  assert.equal(entries.length, 3);

  db.prepare("UPDATE archive_catalogue_entries SET created_at='2024-01-01 00:00:00' WHERE entity_id=?").run(entries[0].entity_id);
  db.prepare("UPDATE archive_catalogue_entries SET created_at='2025-01-01 00:00:00' WHERE entity_id IN (?,?)").run(entries[1].entity_id, entries[2].entity_id);
  db.prepare("UPDATE archive_dossiers SET updated_at='2099-01-01 00:00:00' WHERE entity_id=?").run(entries[0].entity_id);
  db.prepare("UPDATE archive_dossiers SET updated_at='2000-01-01 00:00:00' WHERE entity_id IN (?,?)").run(entries[1].entity_id, entries[2].entity_id);

  const response = await handleConstructApi(request("/api/admin/archive-dossiers", { admin: true }), runtime);
  assert.equal(response.status, 200);
  const ids = (await response.json()).records.map((record) => record.entity_id);
  assert.ok(ids.indexOf(entries[2].entity_id) < ids.indexOf(entries[1].entity_id));
  assert.ok(ids.indexOf(entries[1].entity_id) < ids.indexOf(entries[0].entity_id));
});

test("Studio edits identity, versions, states, contextual entities, themes, and subordinate material references", async () => {
  const db = database();
  const runtime = env(db);

  const vocabularyResponse = await handleConstructApi(request("/api/admin/archive-catalogue", { admin: true }), runtime);
  assert.equal(vocabularyResponse.status, 200);
  const vocabulary = await vocabularyResponse.json();
  assert.ok(vocabulary.media.some((medium) => medium.id === "merch"));
  assert.ok(!vocabulary.media.some((medium) => medium.id === "events"));
  assert.ok(vocabulary.object_types.some((type) => type.id === "tattoo-execution"));
  assert.ok(!vocabulary.object_types.some((type) => type.catalogue_prefix === "TAT" || type.catalogue_prefix === "EVT"));
  assert.ok(vocabulary.documentation_fields.some((field) => field.field_key === "object-description"));
  assert.ok(vocabulary.documentation_fields.some((field) => field.field_key === "rights-permissions"));

  db.exec(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES('event-context-only','event','node-events','public',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO events(id,slug,title,description,status,created_at,updated_at)
    VALUES('event-context-only','event-context-only','Context-only event','An event connected to cultural objects.','open',datetime('now'),datetime('now'));`);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id='event-context-only'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id='event-context-only'").get().count, 0);
  const initialEventIdentity = db.prepare("SELECT * FROM archive_event_identifiers WHERE entity_id='event-context-only'").get();
  assert.match(initialEventIdentity.event_id, /^EVT-\d{3}$/);

  const eventIdentityResponse = await handleConstructApi(request("/api/admin/archive-event-identifiers/event-context-only", {
    method: "PATCH",
    admin: true,
    body: { event_number: 77 },
  }), runtime);
  assert.equal(eventIdentityResponse.status, 200);
  assert.equal((await eventIdentityResponse.json()).record.event_id, "EVT-077");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id='event-context-only'").get().count, 0);

  const initialCatalogueId = db.prepare("SELECT catalogue_id FROM archive_catalogue_entries WHERE entity_id='art-marbles'").get().catalogue_id;
  assert.equal(initialCatalogueId, "ART-004");
  const rejectedRenumber = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { medium_id: "art", object_type_id: "art-painting", catalogue_number: 42, current_version: 1, current_state: "II" },
  }), runtime);
  assert.equal(rejectedRenumber.status, 409);

  const identityResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { medium_id: "art", object_type_id: "art-painting" },
  }), runtime);
  assert.equal(identityResponse.status, 200);
  assert.equal((await identityResponse.json()).record.catalogue_id, "ART-004");

  const versionResponse = await handleConstructApi(request("/api/admin/archive-versions", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      version_number: 2,
      title: "Version 2",
      date_precision: "undated",
      sort_order: 2,
      publication_state: "published",
      public_visible: false,
    },
  }), runtime);
  assert.equal(versionResponse.status, 201);
  const version = (await versionResponse.json()).record;
  assert.equal(version.publication_state, "published");
  assert.equal(version.public_visible, 1, "published version state must override a conflicting visibility input");

  const stateResponse = await handleConstructApi(request("/api/admin/archive-states", {
    method: "POST",
    admin: true,
    body: {
      version_id: version.id,
      state_roman: "I",
      state_order: 1,
      title: "Revised composition",
      date_precision: "undated",
      sort_order: 1,
      publication_state: "draft",
      public_visible: true,
    },
  }), runtime);
  assert.equal(stateResponse.status, 201);
  const state = (await stateResponse.json()).record;
  assert.equal(state.publication_state, "draft");
  assert.equal(state.public_visible, 0, "draft state must override a conflicting visibility input");

  db.exec(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,state,public_presentation,created_by,created_at,updated_at)
    VALUES
      ('media-art-marbles-v2-lead','https://cdn.example.test/art-marbles-v2.jpg','art-marbles-v2.jpg','image/jpeg',
       'Revised Lost Marbles composition','public','active','inline','test',datetime('now'),datetime('now'));`);
  assert.deepEqual({...db.prepare("SELECT privacy,state,public_presentation FROM media_assets WHERE id='media-art-marbles-v2-lead'").get()},{privacy:"public",state:"active",public_presentation:"inline"});
  const leadResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      state_id: state.id,
      media_id: "media-art-marbles-v2-lead",
      material_type: "process-photo",
      title: "Revised composition image",
      visibility: "internal",
      state: "published",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(leadResponse.status, 201);
  const lead = (await leadResponse.json()).record;
  assert.equal(lead.state, "published");
  assert.equal(lead.visibility, "public", "published material state must override a conflicting visibility input");

  const publishStateResponse = await handleConstructApi(request(`/api/admin/archive-states/${encodeURIComponent(state.id)}`, {
    method: "PATCH",
    admin: true,
    body: {
      publication_state: "published",
      public_visible: false,
      lead_material_id: lead.id,
    },
  }), runtime);
  assert.equal(publishStateResponse.status, 200);
  assert.equal((await publishStateResponse.json()).record.public_visible, 1);

  const currentStateResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { current_state_id: state.id },
  }), runtime);
  assert.equal(currentStateResponse.status, 200);
  assert.equal((await currentStateResponse.json()).record.catalogue_label, "ART-004.2/I");

  const publicDocumentationResponse = await handleConstructApi(request("/api/admin/archive-documentation", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      field_key: "object-description",
      value: "A painted cultural object documented through successive material states.",
      citation: "Studio catalogue review",
      url: "https://example.test/lost-marbles",
      public_visible: true,
      sort_order: 1,
    },
  }), runtime);
  assert.equal(publicDocumentationResponse.status, 201);
  const publicDocumentation = (await publicDocumentationResponse.json()).record;

  const privateDocumentationResponse = await handleConstructApi(request("/api/admin/archive-documentation", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      field_key: "rights-permissions",
      value: "Internal rights review note.",
      public_visible: false,
      sort_order: 2,
    },
  }), runtime);
  assert.equal(privateDocumentationResponse.status, 201);
  const privateDocumentation = (await privateDocumentationResponse.json()).record;

  const documentationUpdateResponse = await handleConstructApi(request(`/api/admin/archive-documentation/${encodeURIComponent(publicDocumentation.id)}`, {
    method: "PATCH",
    admin: true,
    body: { label: "Object description", sort_order: 3 },
  }), runtime);
  assert.equal(documentationUpdateResponse.status, 200);
  assert.equal((await documentationUpdateResponse.json()).record.sort_order, 3);

  const adminDocumentationResponse = await handleConstructApi(request("/api/admin/archive-documentation?entity_id=art-marbles", { admin: true }), runtime);
  assert.equal(adminDocumentationResponse.status, 200);
  assert.equal((await adminDocumentationResponse.json()).records.length, 2);

  const noteResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      state_id: state.id,
      material_type: "note",
      title: "Background decision",
      inline_text: "The blue background was reconsidered.",
      visibility: "public",
      state: "published",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(noteResponse.status, 201);
  assert.equal((await noteResponse.json()).record.material_reference, "N01");

  const rejectedSample = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      state_id: state.id,
      material_type: "artifact",
      title: "Not a Merch sample",
      inline_text: "A test object.",
      visibility: "internal",
      state: "draft",
      date_precision: "undated",
      is_sample: true,
    },
  }), runtime);
  assert.equal(rejectedSample.status, 409);

  const hoodieState = db.prepare(`SELECT aos.id FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    WHERE aov.entity_id='merch-lostmarbles-hoodie' ORDER BY aos.state_order LIMIT 1`).get();
  const sampleResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "merch-lostmarbles-hoodie",
      state_id: hoodieState.id,
      material_type: "artifact",
      title: "First hoodie sample",
      inline_text: "Physical sample retained during production.",
      visibility: "internal",
      state: "draft",
      date_precision: "undated",
      is_sample: true,
    },
  }), runtime);
  assert.equal(sampleResponse.status, 201);
  assert.match((await sampleResponse.json()).record.material_reference, /^S\d{2}$/);

  db.exec(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
    VALUES('place-test-studio','place','node-art','public',0,'test','test',datetime('now'),datetime('now')),
          ('event-test-exhibition','event','node-events','public',0,'test','test',datetime('now'),datetime('now'));
    INSERT INTO places(id,name,slug,public_location,privacy,state,created_at,updated_at)
    VALUES('place-test-studio','Test Studio','test-studio','Atlanta','public','published',datetime('now'),datetime('now'));
    INSERT INTO events(id,slug,title,description,status,created_at,updated_at)
    VALUES('event-test-exhibition','test-exhibition','Test Exhibition','A test exhibition.','open',datetime('now'),datetime('now'));`);

  const contextResponse = await handleConstructApi(request("/api/admin/archive-dossiers/art-marbles", {
    method: "PATCH",
    admin: true,
    body: {
      context_assignments: [
        { entity_id: "person-saiel-dauhn-solehman", role: "artist", public_visible: true },
        { entity_id: "org-six-well-construct", role: "organization", public_visible: true },
        { entity_id: "place-test-studio", role: "studio", public_visible: true },
        { entity_id: "event-test-exhibition", role: "exhibition", public_visible: true },
      ],
      theme_names: ["Lost Marbles", "transformation", "memory"],
    },
  }), runtime);
  assert.equal(contextResponse.status, 200);
  const context = (await contextResponse.json()).record;
  assert.deepEqual(new Set(context.context_assignments.map((item) => item.entity_type)), new Set(["person", "organization", "place", "event"]));
  assert.deepEqual(new Set(context.theme_names), new Set(["Lost Marbles", "memory", "transformation"]));

  const archiveSlug = db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='art-marbles'").get().archive_slug;
  const publicResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(archiveSlug)}`), runtime);
  assert.equal(publicResponse.status, 200);
  const publicRecord = await publicResponse.json();
  assert.equal(publicRecord.item.catalogue_id, "ART-004");
  assert.equal(publicRecord.item.catalogue_label, "ART-004.2/I");
  assert.ok(publicRecord.versions.some((item) => Number(item.version_number) === 2));
  assert.ok(publicRecord.states.some((item) => item.title === "Revised composition"));
  assert.ok(publicRecord.materials.some((item) => item.material_reference === "N01"));
  assert.equal(publicRecord.documentation.length, 1);
  assert.equal(publicRecord.documentation[0].field_key, "object-description");
  assert.ok(!JSON.stringify(publicRecord).includes("Internal rights review note."));
  const publicDigitalAssetMaterial = publicRecord.materials.find((item) => item.media_id);
  assert.ok(publicDigitalAssetMaterial?.digital_asset);
  assert.equal(publicDigitalAssetMaterial.digital_asset.kind, "digital-asset");
  assert.match(publicDigitalAssetMaterial.digital_asset.mime_type, /^[a-z]+\/[a-z0-9.+-]+$/i);
  assert.equal("privacy" in publicDigitalAssetMaterial.digital_asset, false);
  assert.deepEqual(new Set(publicRecord.terms.filter((term) => term.kind === "theme").map((term) => term.name)), new Set(["Lost Marbles", "memory", "transformation"]));

  const earlierState = publicRecord.states.find((item) => item.id !== state.id);
  assert.ok(earlierState);
  const stateCompareResponse = await handleConstructApi(request(
    `/api/archive/compare?left=${encodeURIComponent(archiveSlug)}&left_state=${encodeURIComponent(earlierState.id)}&right=${encodeURIComponent(archiveSlug)}&right_state=${encodeURIComponent(state.id)}`
  ), runtime);
  assert.equal(stateCompareResponse.status, 200);
  const stateCompare = await stateCompareResponse.json();
  assert.equal(stateCompare.left.kind, "state");
  assert.equal(stateCompare.right.kind, "state");
  assert.equal(stateCompare.right.catalogue_label, "ART-004.2/I");

  const hoodieSlug = db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='merch-lostmarbles-hoodie'").get().archive_slug;
  const crossMediumCompareResponse = await handleConstructApi(request(
    `/api/archive/compare?left=${encodeURIComponent(archiveSlug)}&right=${encodeURIComponent(hoodieSlug)}`
  ), runtime);
  assert.equal(crossMediumCompareResponse.status, 200);
  const crossMediumCompare = await crossMediumCompareResponse.json();
  assert.equal(crossMediumCompare.left.catalogue_medium, "art");
  assert.equal(crossMediumCompare.right.catalogue_medium, "merch");

  const blockedCurrentStateDelete = await handleConstructApi(request(`/api/admin/archive-states/${encodeURIComponent(state.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(blockedCurrentStateDelete.status, 409);
  const blockedLeadDelete = await handleConstructApi(request(`/api/admin/archive-materials/${encodeURIComponent(lead.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(blockedLeadDelete.status, 409);
  const blockedVersionDelete = await handleConstructApi(request(`/api/admin/archive-versions/${encodeURIComponent(version.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(blockedVersionDelete.status, 409);

  const unassignedPublishedMaterialResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      material_type: "note",
      title: "Unassigned public note",
      inline_text: "This must be assigned to a creative state.",
      visibility: "public",
      state: "published",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(unassignedPublishedMaterialResponse.status, 409);

  const privateStateResponse = await handleConstructApi(request("/api/admin/archive-states", {
    method: "POST",
    admin: true,
    body: {
      version_id: version.id,
      state_roman: "II",
      state_order: 2,
      title: "Internal review state",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(privateStateResponse.status, 201);
  const privateState = (await privateStateResponse.json()).record;
  const privateCompareResponse = await handleConstructApi(request(
    `/api/archive/compare?left=${encodeURIComponent(archiveSlug)}&left_state=${encodeURIComponent(privateState.id)}&right=${encodeURIComponent(hoodieSlug)}`
  ), runtime);
  assert.equal(privateCompareResponse.status, 404);

  const documentationDeleteResponse = await handleConstructApi(request(`/api/admin/archive-documentation/${encodeURIComponent(privateDocumentation.id)}`, {
    method: "DELETE",
    admin: true,
  }), runtime);
  assert.equal(documentationDeleteResponse.status, 200);

  const adminMaterialsResponse = await handleConstructApi(request("/api/admin/archive-materials?entity_id=art-marbles", { admin: true }), runtime);
  assert.equal(adminMaterialsResponse.status, 200);
  const adminMaterials = await adminMaterialsResponse.json();
  const adminDigitalAssetMaterial = adminMaterials.records.find((item) => item.id === lead.id);
  assert.equal(adminDigitalAssetMaterial.digital_asset.kind, "digital-asset");
  assert.equal(adminDigitalAssetMaterial.digital_asset.privacy, "public");
  assert.ok(adminDigitalAssetMaterial.digital_asset.original_filename);

  db.prepare("UPDATE media_assets SET privacy='internal' WHERE id=?").run(adminDigitalAssetMaterial.media_id);
  const gatedPublicResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(archiveSlug)}`), runtime);
  assert.equal(gatedPublicResponse.status, 200);
  const gatedPublicRecord = await gatedPublicResponse.json();
  const gatedCurrentState = gatedPublicRecord.states.find((item) => item.id === state.id);
  assert.equal(gatedCurrentState.lead_material, null);
  assert.equal(gatedCurrentState.material_count, 1);
  const blockedDigitalAssetPublish = await handleConstructApi(request(`/api/admin/archive-materials/${encodeURIComponent(adminDigitalAssetMaterial.id)}`, {
    method: "PATCH",
    admin: true,
    body: { state: "published", visibility: "public" },
  }), runtime);
  assert.equal(blockedDigitalAssetPublish.status, 409);
  assert.match((await blockedDigitalAssetPublish.json()).error, /Digital asset|state lead/);

  const digitalAssetUpdate = await handleConstructApi(request(`/api/admin/media/${encodeURIComponent(adminDigitalAssetMaterial.media_id)}`, {
    method: "PATCH",
    admin: true,
    body: { state: "active", privacy: "public", public_presentation: "inline" },
  }), runtime);
  assert.equal(digitalAssetUpdate.status, 200);
  const updatedDigitalAsset = (await digitalAssetUpdate.json()).record;
  assert.deepEqual({privacy:updatedDigitalAsset.privacy,state:updatedDigitalAsset.state,public_presentation:updatedDigitalAsset.public_presentation},{privacy:"public",state:"active",public_presentation:"inline"});
  const publishedDigitalAssetMaterial = await handleConstructApi(request(`/api/admin/archive-materials/${encodeURIComponent(adminDigitalAssetMaterial.id)}`, {
    method: "PATCH",
    admin: true,
    body: { state: "published", visibility: "public" },
  }), runtime);
  assert.equal(publishedDigitalAssetMaterial.status, 200);
  assert.equal((await publishedDigitalAssetMaterial.json()).record.digital_asset.privacy, "public");

  db.prepare("UPDATE archive_object_states SET lead_material_id=NULL WHERE id=?").run(state.id);
  const unchangedLegacyPointerResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { medium_id: "art", object_type_id: "art-painting", current_state_id: state.id },
  }), runtime);
  assert.equal(unchangedLegacyPointerResponse.status, 200);
  db.prepare("UPDATE archive_object_states SET lead_material_id=? WHERE id=?").run(lead.id, state.id);

  db.exec(`UPDATE archive_dossiers
    SET state='published',public_visible=1,updated_at=datetime('now')
    WHERE entity_id='event-context-only'`);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_search_fragments
    WHERE dossier_entity_id='event-context-only' AND fragment_type='event-identifier' AND label='EVT-077'`).get().count, 1);
  const eventSlug = db.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='event-context-only'").get().archive_slug;
  const publicEventResponse = await handleConstructApi(request(`/api/archive/items/${encodeURIComponent(eventSlug)}`), runtime);
  assert.equal(publicEventResponse.status, 200);
  const publicEventRecord = await publicEventResponse.json();
  assert.equal(publicEventRecord.item.event_id, "EVT-077");
  assert.equal(publicEventRecord.item.record_identifier, "EVT-077");
  assert.equal(publicEventRecord.versions.length, 0);
  assert.equal(publicEventRecord.states.length, 0);

  const eventSearchResponse = await handleConstructApi(request("/api/archive/items?q=EVT-077"), runtime);
  assert.equal(eventSearchResponse.status, 200);
  const eventSearch = await eventSearchResponse.json();
  assert.ok(eventSearch.items.some((item) => item.entity_id === "event-context-only"));
});

test("public Archive media prefers explicit evidence, then explicitly public canonical covers and symbols", async () => {
  const db = database();
  const runtime = env(db);

  db.exec(`INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
    VALUES
      ('portfolio-archive-cover-test','portfolio_item','node-tattoos','public',1,datetime('now'),'test','test',datetime('now'),datetime('now'));
    INSERT INTO portfolio_items
      (id,source_url,storage_key,original_filename,content_type,title,alt_text,year,placement,primary_style,collection,caption,state,sort_order,created_at,updated_at,primary_public_visible)
    VALUES
      ('portfolio-archive-cover-test','https://cdn.example.test/canonical-tattoo.jpg','','canonical-tattoo.jpg','image/jpeg',
       'Canonical tattoo cover','A documented tattoo','2026','arm','blackwork','','','published',1,datetime('now'),datetime('now'),1);`);

  db.exec(`UPDATE archive_dossiers
      SET state='published',public_visible=1,published_at=datetime('now')
      WHERE entity_id='portfolio-archive-cover-test';
    UPDATE archive_object_versions
      SET publication_state='published',public_visible=1
      WHERE entity_id='portfolio-archive-cover-test';
    UPDATE archive_object_states
      SET publication_state='published',public_visible=1
      WHERE version_id IN (SELECT id FROM archive_object_versions WHERE entity_id='portfolio-archive-cover-test');`);
  assert.deepEqual({...db.prepare("SELECT state,primary_public_visible FROM portfolio_items WHERE id='portfolio-archive-cover-test'").get()},{state:"published",primary_public_visible:1});
  assert.deepEqual({...db.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id='portfolio-archive-cover-test'").get()},{state:"published",public_visible:1});

  const canonicalResponse = await handleConstructApi(request("/api/archive/items/portfolio-archive-cover-test"), runtime);
  assert.equal(canonicalResponse.status, 200);
  const canonicalRecord = await canonicalResponse.json();
  assert.equal(canonicalRecord.item.primary_media.url, "https://cdn.example.test/canonical-tattoo.jpg");
  assert.equal(canonicalRecord.item.primary_media.kind, "image");

  db.exec(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,state,public_presentation,created_by,created_at,updated_at)
    VALUES
      ('media-archive-cover-test','https://cdn.example.test/archive-final.jpg','archive-final.jpg','image/jpeg',
       'Archive final image','public','active','inline','test',datetime('now'),datetime('now'));
    INSERT INTO archive_materials
      (id,dossier_entity_id,media_id,role,material_type,title,visibility,state,sort_order,material_reference,created_by,updated_by,created_at,updated_at)
    VALUES
      ('material-archive-cover-test','portfolio-archive-cover-test','media-archive-cover-test','notebook','final-image',
       'Archive final image','public','published',1,'M01','test','test',datetime('now'),datetime('now'));`);

  const explicitResponse = await handleConstructApi(request("/api/archive/items/portfolio-archive-cover-test"), runtime);
  assert.equal(explicitResponse.status, 200);
  const explicitRecord = await explicitResponse.json();
  assert.equal(explicitRecord.item.primary_media.url, "https://cdn.example.test/archive-final.jpg");

  const symbolResponse = await handleConstructApi(request("/api/archive/items/maze-room"), runtime);
  assert.equal(symbolResponse.status, 200);
  const symbolRecord = await symbolResponse.json();
  assert.equal(symbolRecord.item.primary_media.kind, "symbol");
  assert.match(symbolRecord.item.primary_media.svg_markup, /^<svg\b/);
  assert.equal(symbolRecord.item.primary_image, "");
});

test("Studio lists Archive People and Places without requiring sortable columns", async () => {
  const db = database();
  const runtime = env(db);
  db.exec(`
    INSERT INTO content_entities(id,entity_type,node_id,created_at,updated_at) VALUES
      ('person-alpha-list-test','person','archive',datetime('now'),datetime('now')),
      ('person-zulu-list-test','person','archive',datetime('now'),datetime('now')),
      ('place-alpha-list-test','place','archive',datetime('now'),datetime('now')),
      ('place-zulu-list-test','place','archive',datetime('now'),datetime('now'));
    INSERT INTO people(id,name,slug,created_at,updated_at) VALUES
      ('person-zulu-list-test','Zulu Person','zulu-person-list-test',datetime('now'),datetime('now')),
      ('person-alpha-list-test','Alpha Person','alpha-person-list-test',datetime('now'),datetime('now'));
    INSERT INTO places(id,name,slug,created_at,updated_at) VALUES
      ('place-zulu-list-test','Zulu Place','zulu-place-list-test',datetime('now'),datetime('now')),
      ('place-alpha-list-test','Alpha Place','alpha-place-list-test',datetime('now'),datetime('now'));
  `);

  const peopleResponse = await handleConstructApi(request("/api/admin/people", { admin: true }), runtime);
  assert.equal(peopleResponse.status, 200);
  const people = (await peopleResponse.json()).records;
  assert.deepEqual(people.map((record) => record.name), ["Alpha Person", "Saiel Dauhn Solehman", "Zulu Person"]);

  const placesResponse = await handleConstructApi(request("/api/admin/places", { admin: true }), runtime);
  assert.equal(placesResponse.status, 200);
  const places = (await placesResponse.json()).records;
  assert.deepEqual(places.map((record) => record.name), ["Alpha Place", "Purple Fish Studios", "Zulu Place"]);
});

test("Archive dossier publication state alone controls dossier public visibility", async () => {
  const db = database();
  const runtime = env(db);

  let response = await handleConstructApi(request("/api/admin/archive-dossiers/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { state: "draft", public_visible: true },
  }), runtime);
  assert.equal(response.status, 200);
  let record = (await response.json()).record;
  assert.equal(record.state, "draft");
  assert.equal(record.public_visible, 0);
  assert.deepEqual({ ...db.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id='art-marbles'").get() }, { state: "draft", public_visible: 0 });

  response = await handleConstructApi(request("/api/admin/archive-dossiers/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { state: "published", public_visible: false },
  }), runtime);
  assert.equal(response.status, 200);
  record = (await response.json()).record;
  assert.equal(record.state, "published");
  assert.equal(record.public_visible, 1);
  assert.deepEqual({ ...db.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id='art-marbles'").get() }, { state: "published", public_visible: 1 });
});

test("Studio and public Archive surfaces expose the catalogue system", () => {
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "archive-public.js"), "utf8");
  const publicCss = readFileSync(join(ROOT, "css", "archive-public.css"), "utf8");
  const archiveCardsCss = readFileSync(join(ROOT, "css", "archive-cards.css"), "utf8");
  const compareScript = readFileSync(join(ROOT, "js", "archive-compare.js"), "utf8");
  const compareCss = readFileSync(join(ROOT, "css", "archive-compare.css"), "utf8");
  const comparePage = readFileSync(join(ROOT, "archive", "compare", "index.html"), "utf8");
  const studioSection = (startMarker, endMarker) => {
    const start = studio.indexOf(startMarker);
    const end = studio.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Studio section ${startMarker} must remain discoverable`);
    return studio.slice(start, end);
  };
  const versionEditor = studioSection("function versionForm(", "function stateForm(");
  const stateEditor = studioSection("function stateForm(", "function evolutionMarkup(");
  const materialEditor = studioSection("function materialForm(", "function materialCard(");
  const sourceSetEditor = studioSection("function sourceMaterialForm(", "function sourceEntryPreview(");
  const dossierPublication = studioSection("const publicationControls=", "return `<section class=\"construct-manager cm-dossier-workspace\"");
  const originThreadEditor = studioSection("function originThreadForm(", "async function renderOriginThreads(");
  const timelineEditor = studioSection("function timelineForm(", "function chapterForm(");
  const chapterEditor = studioSection("function chapterForm(", "function blackboardOptions(");
  assert.match(studio, /Cultural object identity/);
  assert.match(studio, /Versions and states/);
  assert.match(studio, /Initialize catalogue, version, and state/);
  assert.match(studio, /Assigned automatically/);
  assert.match(studio, /catalogueReidentify/);
  assert.match(studio, /Re-identify catalogue family/);
  assert.doesNotMatch(studio, /preserve its permanent sequence/);
  assert.match(studio, /released for future use/);
  assert.match(studio, /manually written references will not redirect/);
  assert.match(studio, /Do not add a version separately/);
  assert.match(studio, /portfolio_item:\["tattoos","tattoo-execution"\]/);
  assert.match(studio, /Current public condition/);
  assert.match(studio, /Adaptive catalogue documentation/);
  assert.match(studio, /Lead material/);
  assert.match(versionEditor, /Published automatically makes this version visible in the public evolution/);
  assert.match(stateEditor, /Published automatically makes this state visible in the public evolution/);
  assert.match(studio, /Event authority identity/);
  assert.match(studio, /Contextual Archive record · no object versions or creative states/);
  assert.match(studio, /People, organizations, places, events, and themes/);
  assert.match(studio, /Merch sample \/ prototype/);
  assert.match(studio, /The uploaded file that represents or documents this material/);
  assert.match(studio, /Shared Digital asset privacy/);
  assert.match(studio, /Source materials/);
  assert.match(studio, /Add client correspondence/);

  for (const [label, editor] of [
    ["dossier", dossierPublication],
    ["version", versionEditor],
    ["state", stateEditor],
    ["material", materialEditor],
    ["source set", sourceSetEditor],
    ["Origin Thread", originThreadEditor],
    ["timeline", timelineEditor],
    ["chapter", chapterEditor],
  ]) {
    assert.doesNotMatch(editor, /name="(?:public_visible|visibility)"/, `${label} publication must not expose a second visibility control`);
  }
  assert.match(dossierPublication, /Published automatically makes this Archive record publicly visible/);
  assert.match(materialEditor, /Published automatically makes this material public\. Draft and Archived keep it internal/);
  assert.match(materialEditor, /Shared Digital asset privacy<select name="media_privacy"/, "Digital-asset privacy remains an independent safety control");
  assert.match(sourceSetEditor, /Published automatically makes this source set public\. Draft and Archived keep it internal/);
  assert.match(originThreadEditor, /Published automatically makes this Origin Thread public/);
  assert.match(timelineEditor, /Published automatically makes this timeline public/);
  assert.match(chapterEditor, /Published automatically makes this chapter public on its timeline/);

  assert.match(studio, /publication_state:publicationState,public_visible:publicationState==="published"/);
  assert.match(studio, /state:publicationState,public_visible:publicationState==="published",lead_material_id/);
  assert.match(studio, /archiveEndpoints\.dossier\(entityId\),"PATCH",\{state:publicationState,public_visible:publicationState==="published",featured:/);
  assert.match(studio, /visibility:publicationState==="published"\?"public":"internal",state:publicationState/);
  assert.match(studio, /visibility:publicationState==="published"\?"public":"internal",publication_state:publicationState/);
  assert.match(studio, /state:publicationState,public_visible:publicationState==="published",sort_order/);
  assert.match(studio, /function serializeTimelineForm[\s\S]*?state:publicationState,public_visible:publicationState==="published"/);
  assert.match(studio, /function serializeChapterForm[\s\S]*?state:publicationState,public_visible:publicationState==="published"/);
  assert.match(publicScript, /archive-catalogue-identifier/);
  assert.match(publicScript, /archive-digital-asset-label/);
  assert.match(publicScript, /Version \$\{versionNumber\}, State/);
  assert.match(publicScript, /Concept or theme/);
  assert.match(publicScript, /archive-record-card-catalogue/);
  assert.match(publicScript, /function archiveObjectTypeLabel\(record\)/);
  assert.match(publicScript, /return "Tattoo"/);
  assert.match(publicScript, /return "Tattoo Design"/);
  assert.match(studio, /function archiveObjectTypeLabel\(record\)/);
  assert.match(publicScript, /archive-record-card-symbol/);
  assert.match(publicScript, /archive-record-symbol/);
  assert.match(publicScript, /archive-notebook-item/);
  assert.match(publicScript, /archive-material-dialog/);
  assert.match(publicScript, /archive-source-material-dialog/);
  assert.match(publicScript, /Client correspondence/);
  assert.match(publicScript, /archive-state-card/);
  assert.match(publicScript, /You are here · current condition/);
  assert.match(publicScript, /archive-documentation-groups/);
  assert.match(publicScript, /href="\/archive\/compare\/">Compare records/);
  assert.doesNotMatch(publicScript, /archive-compare-add|>c\|c<\/button>|compareButtonMarkup/);
  assert.match(publicCss, /\.archive-state-roman/);
  assert.doesNotMatch(publicCss, /archive-compare-add/);
  assert.match(compareScript, /Catalogue identity/);
  assert.match(compareScript, /State information/);
  assert.match(compareScript, /Undocumented/);
  assert.match(compareScript, /left_state/);
  assert.match(compareScript, /data-compare-chooser/);
  assert.match(compareScript, /\/api\/archive\/items\?limit=100/);
  assert.match(compareScript, /Choose two different public records/);
  assert.match(compareCss, /\.archive-compare-chooser/);
  assert.match(comparePage, /data-archive-compare-app/);
  assert.match(archiveCardsCss, /\.archive-record-card/);
  assert.doesNotMatch(archiveCardsCss, /archive-compare-add/);
  assert.match(archiveCardsCss, /\.archive-record-card-symbol/);
  assert.match(archiveCardsCss, /\.archive-record-symbol/);
  assert.match(archiveCardsCss, /\.archive-material-dialog/);
  assert.match(archiveCardsCss, /\.archive-source-material-summary/);
});
