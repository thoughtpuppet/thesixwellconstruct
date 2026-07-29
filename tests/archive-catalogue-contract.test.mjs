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
  assert.equal(painting.catalogue_id, "ART-004");
  assert.ok(painting.current_state_id);
  assert.equal(painting.medium_id, "art");
  assert.match(hoodie.catalogue_id, /^MER-\d{3}$/);
  assert.equal(hoodie.object_type_id, "merch-hoodie");
  assert.notEqual(painting.catalogue_id, hoodie.catalogue_id);

  const tattooPrefixes = db.prepare("SELECT id,catalogue_prefix FROM archive_cultural_object_types WHERE id IN ('tattoo-design','tattoo-execution') ORDER BY id").all();
  assert.deepEqual(tattooPrefixes.map((row) => row.catalogue_prefix), ["TAT-DES", "TAT-EXE"]);

  const unassigned = db.prepare("SELECT COUNT(*) count FROM archive_materials WHERE state_id IS NULL OR material_reference=''").get();
  assert.equal(unassigned.count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE publication_state<>'published' OR public_visible<>1").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_states WHERE publication_state<>'published' OR public_visible<>1").get().count, 0);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive_catalogue_documentation'").get());
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM archive_object_states aos
    JOIN archive_materials am ON am.id=aos.lead_material_id
    JOIN media_assets m ON m.id=am.media_id
    WHERE am.state_id<>aos.id OR (m.mime_type NOT LIKE 'image/%' AND m.mime_type NOT LIKE 'video/%')`).get().count, 0);
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
      public_visible: true,
    },
  }), runtime);
  assert.equal(versionResponse.status, 201);
  const version = (await versionResponse.json()).record;

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
      public_visible: false,
    },
  }), runtime);
  assert.equal(stateResponse.status, 201);
  const state = (await stateResponse.json()).record;

  db.exec(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at)
    VALUES
      ('media-art-marbles-v2-lead','https://cdn.example.test/art-marbles-v2.jpg','art-marbles-v2.jpg','image/jpeg',
       'Revised Lost Marbles composition','public','granted','active','inline','test',datetime('now'),datetime('now'));`);
  const leadResponse = await handleConstructApi(request("/api/admin/archive-materials", {
    method: "POST",
    admin: true,
    body: {
      entity_id: "art-marbles",
      state_id: state.id,
      media_id: "media-art-marbles-v2-lead",
      material_type: "process-photo",
      title: "Revised composition image",
      visibility: "public",
      state: "published",
      date_precision: "undated",
    },
  }), runtime);
  assert.equal(leadResponse.status, 201);
  const lead = (await leadResponse.json()).record;

  const publishStateResponse = await handleConstructApi(request(`/api/admin/archive-states/${encodeURIComponent(state.id)}`, {
    method: "PATCH",
    admin: true,
    body: {
      publication_state: "published",
      public_visible: true,
      lead_material_id: lead.id,
    },
  }), runtime);
  assert.equal(publishStateResponse.status, 200);

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
    body: { state: "active", privacy: "public", consent_status: "not-required", public_presentation: "inline" },
  }), runtime);
  assert.equal(digitalAssetUpdate.status, 200);
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

test("public Archive media prefers explicit evidence, then approved canonical covers and symbols", async () => {
  const db = database();
  const runtime = env(db);

  db.exec(`INSERT INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,public_at,created_by,updated_by,created_at,updated_at)
    VALUES
      ('portfolio-archive-cover-test','portfolio_item','node-tattoos','public',1,datetime('now'),'test','test',datetime('now'),datetime('now'));
    INSERT INTO portfolio_items
      (id,source_url,storage_key,original_filename,content_type,title,alt_text,year,placement,primary_style,collection,caption,state,sort_order,created_at,updated_at,primary_consent_status)
    VALUES
      ('portfolio-archive-cover-test','https://cdn.example.test/canonical-tattoo.jpg','','canonical-tattoo.jpg','image/jpeg',
       'Canonical tattoo cover','A documented tattoo','2026','arm','blackwork','','','published',1,datetime('now'),datetime('now'),'granted');`);

  const canonicalResponse = await handleConstructApi(request("/api/archive/items/portfolio-archive-cover-test"), runtime);
  assert.equal(canonicalResponse.status, 200);
  const canonicalRecord = await canonicalResponse.json();
  assert.equal(canonicalRecord.item.primary_media.url, "https://cdn.example.test/canonical-tattoo.jpg");
  assert.equal(canonicalRecord.item.primary_media.kind, "image");

  db.exec(`INSERT INTO media_assets
      (id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at)
    VALUES
      ('media-archive-cover-test','https://cdn.example.test/archive-final.jpg','archive-final.jpg','image/jpeg',
       'Archive final image','public','granted','active','inline','test',datetime('now'),datetime('now'));
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

test("Studio and public Archive surfaces expose the catalogue system", () => {
  const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "archive-public.js"), "utf8");
  const publicCss = readFileSync(join(ROOT, "css", "archive-public.css"), "utf8");
  const archiveCardsCss = readFileSync(join(ROOT, "css", "archive-cards.css"), "utf8");
  const compareScript = readFileSync(join(ROOT, "js", "archive-compare.js"), "utf8");
  const compareCss = readFileSync(join(ROOT, "css", "archive-compare.css"), "utf8");
  const comparePage = readFileSync(join(ROOT, "archive", "compare", "index.html"), "utf8");
  assert.match(studio, /Cultural object identity/);
  assert.match(studio, /Versions and states/);
  assert.match(studio, /Current public condition/);
  assert.match(studio, /Adaptive catalogue documentation/);
  assert.match(studio, /Lead material/);
  assert.match(studio, /Visible in the public evolution/);
  assert.match(studio, /Event authority identity/);
  assert.match(studio, /Contextual Archive record · no object versions or creative states/);
  assert.match(studio, /People, organizations, places, events, and themes/);
  assert.match(studio, /Merch sample \/ prototype/);
  assert.match(studio, /The uploaded file that represents or documents this material/);
  assert.match(studio, /Shared Digital asset privacy/);
  assert.match(publicScript, /archive-catalogue-identifier/);
  assert.match(publicScript, /archive-digital-asset-label/);
  assert.match(publicScript, /Version \$\{versionNumber\}, State/);
  assert.match(publicScript, /Concept or theme/);
  assert.match(publicScript, /archive-record-card-catalogue/);
  assert.match(publicScript, /archive-record-card-symbol/);
  assert.match(publicScript, /archive-record-symbol/);
  assert.match(publicScript, /archive-notebook-item/);
  assert.match(publicScript, /archive-material-dialog/);
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
});
