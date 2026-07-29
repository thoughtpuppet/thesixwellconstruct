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
    (SELECT COUNT(*) FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ce.entity_type<>'event') cultural_objects,
    (SELECT COUNT(*) FROM archive_catalogue_entries) catalogue_entries,
    (SELECT COUNT(*) FROM archive_object_versions) versions,
    (SELECT COUNT(*) FROM archive_object_states) states`).get();
  assert.equal(counts.catalogue_entries, counts.cultural_objects);
  assert.equal(counts.versions, counts.cultural_objects);
  assert.equal(counts.states, counts.cultural_objects);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_catalogue_entries ace
    JOIN content_entities ce ON ce.id=ace.entity_id WHERE ce.entity_type='event'`).get().count, 0);
  const eventCounts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ce.entity_type='event') event_records,
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
  assert.equal(painting.medium_id, "art");
  assert.match(hoodie.catalogue_id, /^MER-\d{3}$/);
  assert.equal(hoodie.object_type_id, "merch-hoodie");
  assert.notEqual(painting.catalogue_id, hoodie.catalogue_id);

  const tattooPrefixes = db.prepare("SELECT id,catalogue_prefix FROM archive_cultural_object_types WHERE id IN ('tattoo-design','tattoo-execution') ORDER BY id").all();
  assert.deepEqual(tattooPrefixes.map((row) => row.catalogue_prefix), ["TAT-DES", "TAT-EXE"]);

  const unassigned = db.prepare("SELECT COUNT(*) count FROM archive_materials WHERE state_id IS NULL OR material_reference=''").get();
  assert.equal(unassigned.count, 0);
  assert.ok(db.prepare("SELECT id FROM relationship_types WHERE slug='executed-as'").get());
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

  const identityResponse = await handleConstructApi(request("/api/admin/archive-catalogue/art-marbles", {
    method: "PATCH",
    admin: true,
    body: { medium_id: "art", object_type_id: "art-painting", catalogue_number: 42, current_version: 1, current_state: "II" },
  }), runtime);
  assert.equal(identityResponse.status, 200);
  assert.equal((await identityResponse.json()).record.catalogue_id, "ART-042");

  const versionResponse = await handleConstructApi(request("/api/admin/archive-versions", {
    method: "POST",
    admin: true,
    body: { entity_id: "art-marbles", version_number: 2, title: "Version 2", date_precision: "undated", sort_order: 2 },
  }), runtime);
  assert.equal(versionResponse.status, 201);
  const version = (await versionResponse.json()).record;

  const stateResponse = await handleConstructApi(request("/api/admin/archive-states", {
    method: "POST",
    admin: true,
    body: { version_id: version.id, state_roman: "I", state_order: 1, title: "Revised composition", date_precision: "undated", sort_order: 1 },
  }), runtime);
  assert.equal(stateResponse.status, 201);
  const state = (await stateResponse.json()).record;

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
  assert.equal(publicRecord.item.catalogue_id, "ART-042");
  assert.ok(publicRecord.versions.some((item) => Number(item.version_number) === 2));
  assert.ok(publicRecord.states.some((item) => item.title === "Revised composition"));
  assert.ok(publicRecord.materials.some((item) => item.material_reference === "N01"));
  assert.deepEqual(new Set(publicRecord.terms.filter((term) => term.kind === "theme").map((term) => term.name)), new Set(["Lost Marbles", "memory", "transformation"]));

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

test("Studio and public Archive surfaces expose the catalogue system", () => {
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "archive-public.js"), "utf8");
  const publicCss = readFileSync(join(ROOT, "css", "archive-public.css"), "utf8");
  assert.match(studio, /Cultural object identity/);
  assert.match(studio, /Versions and states/);
  assert.match(studio, /Event authority identity/);
  assert.match(studio, /Contextual Archive record · no object versions or creative states/);
  assert.match(studio, /People, organizations, places, events, and themes/);
  assert.match(studio, /Merch sample \/ prototype/);
  assert.match(publicScript, /archive-catalogue-identifier/);
  assert.match(publicScript, /Version \$\{versionNumber\}, State/);
  assert.match(publicScript, /Concept or theme/);
  assert.match(publicCss, /\.archive-state-roman/);
});
