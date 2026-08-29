import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "creative-identities-test-token";
const COVER_ID = "archive-record-thought-puppet-puppet-thoughts";
const COVER_VERSION_ID = "archive-version-thought-puppet-puppet-thoughts-1";
const COVER_STATE_ID = "archive-state-thought-puppet-puppet-thoughts-1-I";
const PROFILE_ID = "org-thoughtpuppet";
const TIMELINE_ID = "archive-timeline-thoughtpuppet";
const THREAD_ID = "origin-thread-thoughtpuppet-origins";
const ORIGIN_ACTIVITY_ID = "activity-thought-puppet-puppet-thoughts-origin";
const MASTER_ID = "thoughtpuppet-master";
const DERIVATIVE_ID = "thoughtpuppet-public-display";
const LEAD_MATERIAL_ID = "cover-public-material";
const CREATOR_ID = "person-saiel-dauhn-solehman";
const PACKAGE_SYMBOL_IDS = ["identity-thoughtpuppet", "identity-six-well"];
const ALT = "Square digital album cover showing a red theater stage and audience, with a black puppet-like face centered beneath gold text reading “THOUGHT PUPPET”; smaller blue text reads “puppet thoughts.” A six-dot Six.Well signature appears in the lower-right corner.";
const CAPTION = "*Thought Puppet / Puppet Thoughts*, original class-project album cover, c. 2018–2019. Digital collage/design by Saiel Dauhn Solehman. The six-dot Six.Well signature appears at lower right.";
const PRIVATE_PROVENANCE = "Source: X:\\synthetic-fixtures\\private-master.webp\nSHA-256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA (synthetic test fixture)";

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

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(path.join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    database.exec(readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function runtime(database, additions = {}) {
  return { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: TOKEN, ...additions };
}

function request(route, { method = "GET", admin = false, body } = {}) {
  const headers = new Headers();
  if (admin) headers.set("authorization", `Bearer ${TOKEN}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://example.test${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function api(environment, route, options) {
  const response = await handleConstructApi(request(route, options), environment);
  const body = await response.json();
  return { response, body };
}

function publishThoughtPuppetDependencies(database) {
  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=datetime('now') WHERE entity_id IN (?,?)").run("org-thoughtpuppet", COVER_ID);
  database.prepare("UPDATE archive_records SET state='published' WHERE id=?").run(COVER_ID);
  database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1 WHERE id=?").run(COVER_ID);
  database.prepare("UPDATE archive_object_versions SET publication_state='published',public_visible=1 WHERE entity_id=?").run(COVER_ID);
  database.prepare("UPDATE archive_object_states SET publication_state='published',public_visible=1 WHERE version_id=?").run("archive-version-thought-puppet-puppet-thoughts-1");
  database.prepare("UPDATE archive_origin_threads SET state='published',public_visible=1 WHERE id=?").run("origin-thread-thoughtpuppet-origins");
  database.prepare("UPDATE entity_relationships SET public_visible=1 WHERE id IN (?,?)").run("relationship-thoughtpuppet-current-symbol", "relationship-thought-puppet-cover-six-well");
  database.prepare("UPDATE entity_activity SET public_visible=1 WHERE id=?").run("activity-thought-puppet-puppet-thoughts-origin");
  database.prepare("UPDATE entity_activity_subjects SET public_visible=1 WHERE activity_id=?").run("activity-thought-puppet-puppet-thoughts-origin");
}

function insertCoverMedia(database) {
  database.prepare(`INSERT INTO media_assets(
      id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,alt_text,caption,rights_notes,
      privacy,state,created_by,created_at,updated_at,public_presentation
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'),?)`).run(
    MASTER_ID, "/private/master-leak.webp", "archive/masters/thoughtpuppet-master/PRIVATE_MASTER_TEST.WEBP", "PRIVATE_MASTER_TEST.WEBP", "image/webp", 22164, 560, 560, "PRIVATE MASTER", "PRIVATE MASTER", PRIVATE_PROVENANCE,
    "internal", "active", "hidden",
  );
  database.prepare(`INSERT INTO media_assets(
      id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,alt_text,caption,rights_notes,
      privacy,state,created_by,created_at,updated_at,public_presentation
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'),?)`).run(
    DERIVATIVE_ID, "/assets/archive/thought-puppet-puppet-thoughts.png", "archive/derivatives/thought-puppet-puppet-thoughts.png", "thought-puppet-puppet-thoughts.png", "image/png", 30000, 560, 560, ALT, CAPTION, "",
    "public", "active", "inline",
  );
}

function prepareThoughtPuppetPublication(database, { exposeMasterAssociations = false } = {}) {
  insertCoverMedia(database);
  database.prepare(`INSERT INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
    VALUES(?,?,'public-display','test',datetime('now'),datetime('now'))`).run(MASTER_ID, DERIVATIVE_ID);
  database.prepare(`INSERT INTO archive_materials(
      id,dossier_entity_id,media_id,role,material_type,title,caption,date_precision,date_label,
      visibility,state,sort_order,created_by,updated_by,created_at,updated_at,state_id
    ) VALUES(?,?,?,'primary','final-image','Public display',?,'approximate','c. 2018–2019',
      'internal','draft',1,'test','test',datetime('now'),datetime('now'),?)`).run(
    LEAD_MATERIAL_ID, COVER_ID, DERIVATIVE_ID, CAPTION, COVER_STATE_ID,
  );
  database.prepare("UPDATE archive_object_states SET lead_material_id=? WHERE id=?").run(LEAD_MATERIAL_ID, COVER_STATE_ID);
  if (exposeMasterAssociations) {
    database.prepare(`INSERT INTO archive_materials(
        id,dossier_entity_id,media_id,role,material_type,title,caption,date_precision,date_label,
        visibility,state,sort_order,created_by,updated_by,created_at,updated_at,state_id
      ) VALUES('cover-master-material',?,?,'source','artifact','Archival master','Private archival source','approximate','c. 2018–2019',
        'public','published',2,'test','test',datetime('now'),datetime('now'),?)`).run(COVER_ID, MASTER_ID, COVER_STATE_ID);
    database.prepare(`INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at)
      VALUES(?,?,'archive-master',1,1,datetime('now'))`).run(COVER_ID, MASTER_ID);
  }
}

function privatizeThoughtPuppetCanonicalDependencies(database) {
  database.prepare("UPDATE visual_symbols SET state='draft' WHERE id IN (?,?)").run(...PACKAGE_SYMBOL_IDS);
  database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,public_at=NULL WHERE id IN (?,?)").run(...PACKAGE_SYMBOL_IDS);
  database.prepare("UPDATE archive_dossiers SET state='draft',public_visible=0,published_at=NULL WHERE entity_id IN (?,?)").run(...PACKAGE_SYMBOL_IDS);
  database.prepare("UPDATE people SET state='draft',privacy='internal' WHERE id=?").run(CREATOR_ID);
  database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,public_at=NULL WHERE id=?").run(CREATOR_ID);
}

function thoughtPuppetPublicationSnapshot(database) {
  return {
    profile: { ...database.prepare("SELECT publication_state,visibility,published_at FROM about_identity_profiles WHERE organization_id=?").get(PROFILE_ID) },
    organization: { ...database.prepare("SELECT organization.state,entity.visibility,entity.search_visibility FROM organizations organization JOIN content_entities entity ON entity.id=organization.id WHERE organization.id=?").get(PROFILE_ID) },
    identityDossier: { ...database.prepare("SELECT state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(PROFILE_ID) },
    record: { ...database.prepare("SELECT record.state,entity.visibility,entity.search_visibility FROM archive_records record JOIN content_entities entity ON entity.id=record.id WHERE record.id=?").get(COVER_ID) },
    recordDossier: { ...database.prepare("SELECT state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(COVER_ID) },
    version: { ...database.prepare("SELECT publication_state,public_visible FROM archive_object_versions WHERE id=?").get(COVER_VERSION_ID) },
    objectState: { ...database.prepare("SELECT publication_state,public_visible FROM archive_object_states WHERE id=?").get(COVER_STATE_ID) },
    material: { ...database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").get(LEAD_MATERIAL_ID) },
    timeline: { ...database.prepare("SELECT state,public_visible FROM archive_timelines WHERE id=?").get(TIMELINE_ID) },
    chapters: database.prepare("SELECT id,state,public_visible FROM archive_timeline_chapters WHERE timeline_id=? ORDER BY id").all(TIMELINE_ID).map((row) => ({ ...row })),
    thread: { ...database.prepare("SELECT state,public_visible FROM archive_origin_threads WHERE id=?").get(THREAD_ID) },
    appearances: database.prepare("SELECT id,publication_state,public_visible FROM visual_symbol_archive_appearances WHERE record_entity_id=? ORDER BY id").all(COVER_ID).map((row) => ({ ...row })),
    relationships: database.prepare("SELECT id,public_visible FROM entity_relationships WHERE id IN ('relationship-thoughtpuppet-current-symbol','relationship-thought-puppet-cover-six-well') ORDER BY id").all().map((row) => ({ ...row })),
    activity: { ...database.prepare("SELECT public_visible FROM entity_activity WHERE id=?").get(ORIGIN_ACTIVITY_ID) },
    activitySubject: { ...database.prepare("SELECT public_visible FROM entity_activity_subjects WHERE activity_id=? AND subject_entity_id=?").get(ORIGIN_ACTIVITY_ID, PROFILE_ID) },
    symbols: database.prepare(`SELECT symbol.id,symbol.state symbol_state,entity.visibility entity_visibility,entity.search_visibility,
        dossier.state dossier_state,dossier.public_visible dossier_public
      FROM visual_symbols symbol JOIN content_entities entity ON entity.id=symbol.id
      LEFT JOIN archive_dossiers dossier ON dossier.entity_id=symbol.id
      WHERE symbol.id IN (?,?) ORDER BY symbol.id`).all(...PACKAGE_SYMBOL_IDS).map((row) => ({ ...row })),
    creator: { ...database.prepare(`SELECT person.state person_state,person.privacy person_privacy,
        entity.visibility entity_visibility,entity.search_visibility
      FROM people person JOIN content_entities entity ON entity.id=person.id WHERE person.id=?`).get(CREATOR_ID) },
    currentMarkBrand: { ...database.prepare(`SELECT public_visible FROM archive_dossier_subjects
      WHERE dossier_entity_id='identity-thoughtpuppet' AND subject_entity_id=? AND role='brand'`).get(PROFILE_ID) },
    revisions: database.prepare("SELECT entity_id,action FROM entity_revisions WHERE entity_id IN (?,?) AND action IN ('creative-identity-publication','archive-publication') ORDER BY entity_id,action").all(PROFILE_ID, COVER_ID).map((row) => ({ ...row })),
  };
}

test("0187 stages the profile, origin record, lineage, and canonical brand membership without publishing", () => {
  const database = migratedDatabase();
  const profile = database.prepare("SELECT * FROM about_identity_profiles WHERE organization_id=?").get("org-thoughtpuppet");
  assert.equal(profile.slug, "thoughtpuppet");
  assert.equal(profile.lifecycle_status, "active");
  assert.equal(profile.publication_state, "draft");
  assert.equal(profile.visibility, "internal");
  assert.match(profile.hero_descriptor, /acknowledgment of source and process/i);
  assert.match(profile.origin_body, /\*Puppet Thoughts\*/);
  assert.deepEqual({ ...database.prepare("SELECT title,description FROM archive_timelines WHERE id=?").get("archive-timeline-thoughtpuppet") }, {
    title: "ThoughtPuppet",
    description: "Works and derivatives connected to ThoughtPuppet.",
  });
  assert.equal(database.prepare("SELECT name FROM archive_facets WHERE id=?").get("archive-facet-brand-thoughtpuppet").name, "ThoughtPuppet");

  const cover = database.prepare("SELECT * FROM archive_records WHERE id=?").get(COVER_ID);
  assert.equal(cover.title, "Thought Puppet / Puppet Thoughts");
  assert.equal(cover.room, "Ephemera");
  assert.equal(cover.medium_label, "Digital collage/design");
  assert.equal(cover.creator_label, "Saiel Dauhn Solehman");
  assert.equal(cover.date_precision, "approximate");
  assert.equal(cover.date_or_period, "c. 2018–2019");
  assert.equal(cover.state, "draft");

  const version = database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=?").get(COVER_ID);
  const state = database.prepare("SELECT * FROM archive_object_states WHERE version_id=?").get(version.id);
  assert.equal(version.title, "Version 1");
  assert.equal(version.description, "Original class-project export");
  assert.equal(version.date_precision, "approximate");
  assert.equal(version.publication_state, "draft");
  assert.equal(state.title, "State I");
  assert.equal(state.date_precision, "approximate");
  assert.equal(state.public_visible, 0);

  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-thoughtpuppet").count, 0);
  assert.match(database.prepare("SELECT catalogue_id FROM archive_catalogue_entries WHERE entity_id=?").get(COVER_ID).catalogue_id, /^ART-/);
  assert.equal(database.prepare("SELECT public_visible FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=? AND role='brand'").get(COVER_ID, "org-thoughtpuppet").public_visible, 0);
  assert.ok(database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").get("identity-thoughtpuppet"));
  assert.equal(database.prepare("SELECT public_visible FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=? AND role='brand'").get("identity-thoughtpuppet", "org-thoughtpuppet").public_visible, 0);
  assert.equal(database.prepare("SELECT role FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=?").get("art-marbles", "org-thoughtpuppet").role, "brand");
  assert.equal(database.prepare("SELECT role FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=?").get("merch-lostmarbles-hoodie", "org-thoughtpuppet").role, "brand");
  assert.equal(database.prepare("SELECT state FROM archive_origin_threads WHERE id=?").get("origin-thread-thoughtpuppet-origins").state, "draft");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_timeline_chapters WHERE timeline_id=? AND state='draft' AND public_visible=0").get("archive-timeline-thoughtpuppet").count, 3);
  assert.match(database.prepare("SELECT body FROM archive_timeline_chapters WHERE id=?").get("archive-chapter-thoughtpuppet-fictional-artist").body, /\*Puppet Thoughts\*/);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM visual_symbol_archive_appearances WHERE publication_state='draft' AND public_visible=0").get().count, 2);
  assert.equal(JSON.parse(database.prepare("SELECT variants_json FROM visual_symbols WHERE id='identity-thoughtpuppet'").get().variants_json).some((entry) => entry.record_entity_id === COVER_ID), false);
  assert.equal(JSON.parse(database.prepare("SELECT examples_json FROM visual_symbols WHERE id='identity-six-well'").get().examples_json).some((entry) => entry.record_entity_id === COVER_ID), false);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='archive_catalogue_no_organization_insert'").get());
  assert.ok(database.prepare("PRAGMA table_info(media_upload_sessions)").all().some((column) => column.name === "rights_notes"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});

test("identity CRUD separates lifecycle from publication and hard-gates organization dossiers", async () => {
  const database = migratedDatabase();
  const environment = runtime(database);

  assert.equal((await api(environment, "/api/admin/identities")).response.status, 401);
  let result = await api(environment, "/api/identities");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.records, []);

  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id=?").run("org-thoughtpuppet");
  result = await api(environment, "/api/archive/items?limit=100");
  assert.equal(result.body.records.some((record) => record.entity_id === "org-thoughtpuppet"), false);
  assert.equal((await api(environment, "/api/archive/items/thoughtpuppet")).response.status, 404);

  result = await api(environment, "/api/admin/identities/thoughtpuppet", { admin: true });
  assert.equal(result.body.record.publication_state, "draft");
  assert.equal(result.body.record.lifecycle_status, "active");
  result = await api(environment, "/api/admin/identities/thoughtpuppet", { method: "PATCH", admin: true, body: { lifecycle_status: "dormant" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.record.lifecycle_status, "dormant");
  assert.equal(result.body.record.publication_state, "draft");
  result = await api(environment, "/api/admin/identities/thoughtpuppet", { method: "PATCH", admin: true, body: { publication_state: "draft", visibility: "public" } });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.record.publication_state, "draft");
  assert.equal(result.body.record.visibility, "internal", "draft publication state must override a conflicting visibility input");
  assert.equal(result.body.record.public_visible, false);
  database.prepare("DELETE FROM archive_origin_thread_entities WHERE thread_id=? AND entity_id=?").run(THREAD_ID, COVER_ID);
  result = await api(environment, "/api/admin/identities/thoughtpuppet", { method: "PATCH", admin: true, body: { publication_state: "published", visibility: "public" } });
  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /needs review before it can publish/i);
  assert.equal(Array.isArray(result.body.details?.blockers), true);
  assert.equal(result.body.details.blockers.some((blocker) => blocker.component === "origin-thread"), true);
  assert.equal(result.body.details.blockers.some((blocker) => blocker.component === "origin-record"), true);
  result = await api(environment, "/api/admin/identities/thoughtpuppet", { method: "PATCH", admin: true, body: {
    timeline_id: null, current_symbol_id: null, origin_thread_id: null, featured_origin_entity_id: null,
  } });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.record.timeline_id, "");
  assert.equal(result.body.record.current_symbol_id, "");
  assert.equal(result.body.record.origin_thread_id, "");
  assert.equal(result.body.record.featured_origin_entity_id, "");

  result = await api(environment, "/api/admin/identities", { method: "POST", admin: true, body: {
    organization_entity_id: "org-six-well-clothing", slug: "six-well-clothing-identity", public_kind_label: "Creative identity",
    lifecycle_status: "forming", hero_descriptor: "A private identity draft.", current_role: "Private review.", origin_body: "Not public.",
    publication_state: "published", visibility: "public",
  } });
  assert.equal(result.response.status, 201, result.body.error);
  assert.equal(result.body.record.publication_state, "draft");
  assert.equal(result.body.record.visibility, "internal");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-six-well-clothing").count, 0);

  result = await api(environment, "/api/admin/archive-catalogue/org-six-well-clothing", { method: "PATCH", admin: true, body: { medium_id: "other", object_type_id: "other-cultural-object" } });
  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /do not receive/i);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-six-well-clothing").count, 0);

  database.exec("DROP TRIGGER archive_catalogue_no_organization_insert; DROP TRIGGER archive_catalogue_no_organization_reassignment;");
  database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at)
    VALUES(?,'other','other-cultural-object','OBJ',99999,'OBJ-99999',1,'I','','test','test',datetime('now'),datetime('now'))`).run("org-six-well-clothing");
  result = await api(environment, "/api/admin/archive-catalogue/org-six-well-clothing", { method: "PATCH", admin: true, body: { medium_id: "other", object_type_id: "other-cultural-object" } });
  assert.equal(result.response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-six-well-clothing").count, 0);

  database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at)
    VALUES(?,'other','other-cultural-object','OBJ',99999,'OBJ-99999',1,'I','','test','test',datetime('now'),datetime('now'))`).run("org-six-well-clothing");
  result = await api(environment, "/api/admin/archive-catalogue/org-six-well-clothing/reidentify", { method: "POST", admin: true, body: { expected_catalogue_id: "OBJ-99999", medium_id: "art", object_type_id: "art-other" } });
  assert.equal(result.response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-six-well-clothing").count, 0);

  database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at)
    VALUES(?,'other','other-cultural-object','OBJ',99999,'OBJ-99999',1,'I','','test','test',datetime('now'),datetime('now'))`).run("org-six-well-clothing");
  result = await api(environment, "/api/admin/entities/org-six-well-clothing/archive-dossier", { method: "POST", admin: true });
  assert.equal(result.response.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get("org-six-well-clothing").count, 0);
});

test("generic cultural-object creation is atomic, private, canonical, and brand-role aware", async () => {
  const database = migratedDatabase();
  const environment = runtime(database);
  let result = await api(environment, "/api/admin/archive-records/create-cultural-object", { method: "POST", admin: true, body: {
    id: "archive-record-test-object", slug: "test-object", title: "Test Object", room: "Ephemera",
    cultural_object_type_id: "art-digital-work", medium: "Digital design", creator_entity_id: "person-saiel-dauhn-solehman", creator_label: "Spoofed label",
    date_precision: "approximate", date_label: "c. 2020", version_description: "Original export", state_description: "Original condition",
    subject_entity_ids: [{ entity_id: "org-thoughtpuppet", role: "brand" }],
  } });
  assert.equal(result.response.status, 201, result.body.error);
  assert.equal(result.body.record.creator_label, "Saiel Dauhn Solehman");
  assert.equal(result.body.record.state, "draft");
  assert.equal(result.body.dossier.state, "draft");
  assert.equal(result.body.dossier.public_visible, 0);
  assert.match(result.body.catalogue.catalogue_id, /^ART-/);
  assert.equal(result.body.version.publication_state, "draft");
  assert.equal(result.body.state.public_visible, 0);
  assert.equal(database.prepare("SELECT role FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=?").get("archive-record-test-object", "org-thoughtpuppet").role, "brand");

  result = await api(environment, `/api/admin/archive-states/${encodeURIComponent(result.body.state.id)}`, {
    method: "PATCH",
    admin: true,
    body: { title: "Reviewed draft state" },
  });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.record.title, "Reviewed draft state");
  assert.equal(result.body.record.publication_state, "draft");
  assert.equal(result.body.record.public_visible, 0);

  result = await api(environment, "/api/admin/archive-records/create-cultural-object", { method: "POST", admin: true, body: {
    id: "archive-record-invalid-creator", slug: "invalid-creator", title: "Invalid", cultural_object_type_id: "art-digital-work", creator_entity_id: "identity-thoughtpuppet",
  } });
  assert.equal(result.response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM content_entities WHERE id=?").get("archive-record-invalid-creator").count, 0);

  result = await api(environment, "/api/admin/archive-records/create-cultural-object", { method: "POST", admin: true, body: {
    id: "archive-record-atomic-rollback", slug: "test-object", title: "Duplicate slug", cultural_object_type_id: "art-digital-work",
  } });
  assert.equal(result.response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM content_entities WHERE id=?").get("archive-record-atomic-rollback").count, 0);
});

test("coordinated identity publication makes the complete private ThoughtPuppet graph public in one idempotent action", async () => {
  const database = migratedDatabase();
  const environment = runtime(database);
  prepareThoughtPuppetPublication(database, { exposeMasterAssociations: true });
  privatizeThoughtPuppetCanonicalDependencies(database);

  database.prepare(`UPDATE archive_dossier_subjects SET public_visible=0
    WHERE dossier_entity_id='appearance-made-in-public' AND subject_entity_id=?`).run(PROFILE_ID);

  assert.equal((await api(environment, "/api/admin/identities/thoughtpuppet/publication-review")).response.status, 401);
  let result = await api(environment, "/api/admin/identities/thoughtpuppet/publication-review", { admin: true });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "ready");
  assert.equal(result.body.review.publishable, true);
  assert.deepEqual(result.body.review.blockers, []);
  assert.equal(result.body.review.components.length, 8);
  assert.equal(result.body.review.components.every((component) => component.ready), true);
  assert.equal(result.body.review.components.some((component) => component.state === "draft" || component.public_visible === false), true, "complete private dependencies must be publishable without first exposing them individually");
  assert.doesNotMatch(JSON.stringify(result.body), /private\/master-leak|PRIVATE_MASTER_TEST\.WEBP|rights_notes|storage_key|SHA-256/i);

  const before = thoughtPuppetPublicationSnapshot(database);
  assert.deepEqual(before.profile, { publication_state: "draft", visibility: "internal", published_at: null });
  assert.equal(before.record.state, "draft");
  assert.equal(before.record.visibility, "internal");
  assert.equal(before.identityDossier.public_visible, 0);
  assert.equal(before.recordDossier.public_visible, 0);
  assert.equal(before.version.public_visible, 0);
  assert.equal(before.objectState.public_visible, 0);
  assert.equal(before.material.visibility, "internal");
  assert.equal(before.chapters.every((chapter) => chapter.state === "draft" && chapter.public_visible === 0), true);
  assert.equal(before.appearances.every((appearance) => appearance.publication_state === "draft" && appearance.public_visible === 0), true);
  assert.equal(before.symbols.length, 2);
  assert.equal(before.symbols.every((symbol) => symbol.symbol_state === "draft" && symbol.entity_visibility === "internal" && symbol.search_visibility === 0 && symbol.dossier_state === "draft" && symbol.dossier_public === 0), true);
  assert.deepEqual(before.creator, { person_state: "draft", person_privacy: "internal", entity_visibility: "internal", search_visibility: 0 });
  assert.deepEqual(before.currentMarkBrand, { public_visible: 0 });
  assert.deepEqual(before.revisions, []);

  result = await api(environment, "/api/admin/identities/thoughtpuppet/publish-package", { method: "POST", admin: true, body: {} });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "published");
  assert.equal(result.body.review.public, true);
  assert.equal(result.body.record.publication_state, "published");
  assert.equal(result.body.record.visibility, "public");
  assert.doesNotMatch(JSON.stringify(result.body), /thoughtpuppet-master|private\/master-leak|PRIVATE_MASTER_TEST\.WEBP|rights_notes|storage_key|SHA-256|source_note/i);

  const after = thoughtPuppetPublicationSnapshot(database);
  assert.equal(after.profile.publication_state, "published");
  assert.equal(after.profile.visibility, "public");
  assert.ok(after.profile.published_at);
  assert.deepEqual(after.organization, { state: "published", visibility: "public", search_visibility: 1 });
  for (const dossier of [after.identityDossier, after.recordDossier]) {
    assert.equal(dossier.state, "published");
    assert.equal(dossier.public_visible, 1);
    assert.ok(dossier.published_at);
  }
  assert.deepEqual(after.record, { state: "published", visibility: "public", search_visibility: 1 });
  assert.deepEqual(after.version, { publication_state: "published", public_visible: 1 });
  assert.deepEqual(after.objectState, { publication_state: "published", public_visible: 1 });
  assert.deepEqual(after.material, { state: "published", visibility: "public" });
  assert.deepEqual(after.timeline, { state: "published", public_visible: 1 });
  assert.equal(after.chapters.length, 3);
  assert.equal(after.chapters.every((chapter) => chapter.state === "published" && chapter.public_visible === 1), true);
  assert.deepEqual(after.thread, { state: "published", public_visible: 1 });
  assert.equal(after.appearances.length, 2);
  assert.equal(after.appearances.every((appearance) => appearance.publication_state === "published" && appearance.public_visible === 1), true);
  assert.equal(after.relationships.length, 2);
  assert.equal(after.relationships.every((relationship) => relationship.public_visible === 1), true);
  assert.deepEqual(after.activity, { public_visible: 1 });
  assert.deepEqual(after.activitySubject, { public_visible: 1 });
  assert.equal(after.symbols.length, 2);
  assert.equal(after.symbols.every((symbol) => symbol.symbol_state === "published" && symbol.entity_visibility === "public" && symbol.search_visibility === 1 && symbol.dossier_state === "published" && symbol.dossier_public === 1), true);
  assert.deepEqual(after.creator, { person_state: "published", person_privacy: "public", entity_visibility: "public", search_visibility: 1 });
  assert.deepEqual(after.currentMarkBrand, { public_visible: 1 });
  assert.deepEqual(after.revisions.map((revision) => revision.action).sort(), ["archive-publication", "creative-identity-publication"]);
  assert.equal(database.prepare("SELECT public_visible FROM archive_dossier_subjects WHERE dossier_entity_id=? AND subject_entity_id=? AND role='brand'").get("identity-thoughtpuppet", PROFILE_ID).public_visible, 1);
  assert.equal(database.prepare("SELECT MIN(public_visible) minimum FROM archive_dossier_subjects WHERE dossier_entity_id=?").get(COVER_ID).minimum, 1);

  const master = database.prepare("SELECT source_url,storage_key,original_filename,rights_notes,privacy,state,public_presentation FROM media_assets WHERE id=?").get(MASTER_ID);
  assert.deepEqual({ ...master }, {
    source_url: "/private/master-leak.webp",
    storage_key: "archive/masters/thoughtpuppet-master/PRIVATE_MASTER_TEST.WEBP",
    original_filename: "PRIVATE_MASTER_TEST.WEBP",
    rights_notes: PRIVATE_PROVENANCE,
    privacy: "internal",
    state: "active",
    public_presentation: "hidden",
  });
  assert.deepEqual({ ...database.prepare("SELECT state,visibility FROM archive_materials WHERE id='cover-master-material'").get() }, { state: "draft", visibility: "internal" });
  assert.equal(database.prepare("SELECT public_visible FROM entity_media WHERE entity_id=? AND media_id=?").get(COVER_ID, MASTER_ID).public_visible, 0);
  assert.equal(database.prepare("SELECT public_visible FROM archive_dossier_subjects WHERE dossier_entity_id='appearance-made-in-public' AND subject_entity_id=?").get(PROFILE_ID).public_visible, 0, "the unrelated Made in Public record must not be swept into identity publication");

  result = await api(environment, "/api/admin/identities/thoughtpuppet/publication-review", { admin: true });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "already-published");
  assert.equal(result.body.review.public, true, "final review includes the now-public current-mark brand assignment and canonical dependencies");

  const revisionCount = database.prepare("SELECT COUNT(*) count FROM entity_revisions WHERE entity_id IN (?,?) AND action IN ('creative-identity-publication','archive-publication')").get(PROFILE_ID, COVER_ID).count;
  result = await api(environment, "/api/admin/identities/org-thoughtpuppet/publish-package", { method: "POST", admin: true, body: {} });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "already-published");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM entity_revisions WHERE entity_id IN (?,?) AND action IN ('creative-identity-publication','archive-publication')").get(PROFILE_ID, COVER_ID).count, revisionCount, "an idempotent repeat must not create publication revisions");

  const detail = await api(environment, "/api/identities/thoughtpuppet");
  assert.equal(detail.response.status, 200, detail.body.error);
  assert.equal(detail.body.featured_origin_record.primary_media.url, "/assets/archive/thought-puppet-puppet-thoughts.png");
  assert.doesNotMatch(JSON.stringify(detail.body), /thoughtpuppet-master|private\/master-leak|PRIVATE_MASTER_TEST\.WEBP|rights_notes|storage_key|SHA-256|source_note/i);
});

test("identity package review blocks unsafe derivative or master media without partial publication", async () => {
  const database = migratedDatabase();
  const environment = runtime(database);
  prepareThoughtPuppetPublication(database);

  database.prepare("UPDATE media_assets SET privacy='internal' WHERE id=?").run(DERIVATIVE_ID);
  let before = thoughtPuppetPublicationSnapshot(database);
  let result = await api(environment, "/api/admin/identities/thoughtpuppet/publication-review", { admin: true });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "blocked");
  assert.equal(result.body.review.publishable, false);
  assert.equal(result.body.review.blockers.some((blocker) => blocker.code === "origin-record-media"), true);
  assert.doesNotMatch(JSON.stringify(result.body), /private\/master-leak|PRIVATE_MASTER_TEST\.WEBP|rights_notes|storage_key|SHA-256/i);
  result = await api(environment, "/api/admin/identities/thoughtpuppet/publish-package", { method: "POST", admin: true, body: {} });
  assert.equal(result.response.status, 409);
  assert.deepEqual(thoughtPuppetPublicationSnapshot(database), before, "failed derivative review must not publish any linked table");

  database.prepare("UPDATE media_assets SET privacy='public' WHERE id=?").run(DERIVATIVE_ID);
  database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline' WHERE id=?").run(MASTER_ID);
  before = thoughtPuppetPublicationSnapshot(database);
  result = await api(environment, "/api/admin/identities/thoughtpuppet/publication-review", { admin: true });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "blocked");
  assert.equal(result.body.review.blockers.some((blocker) => blocker.code === "origin-record-master-privacy"), true);
  result = await api(environment, "/api/admin/identities/thoughtpuppet/publish-package", { method: "POST", admin: true, body: {} });
  assert.equal(result.response.status, 409);
  assert.deepEqual(thoughtPuppetPublicationSnapshot(database), before, "failed master review must not publish any linked table");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM entity_revisions WHERE entity_id IN (?,?) AND action IN ('creative-identity-publication','archive-publication')").get(PROFILE_ID, COVER_ID).count, 0);
});

test("published identity composition uses only the derivative and exposes exact public presentation metadata", async () => {
  const database = migratedDatabase();
  const uploadKeys = [];
  const environment = runtime(database, {
    SUBMISSION_FILES: {
      async createMultipartUpload(key) { uploadKeys.push(key); return { uploadId: "mock-upload", async abort() {} }; },
    },
  });

  let result = await api(environment, "/api/admin/media/uploads", { method: "POST", admin: true, body: {
    uploadKind: "archive-master", archiveScope: "creative-identity", filename: "PRIVATE_MASTER_TEST.WEBP", mimeType: "image/webp", byteSize: 22164,
    rights_notes: PRIVATE_PROVENANCE, privacy: "public", publicPresentation: "inline",
  } });
  assert.equal(result.response.status, 201, result.body.error);
  assert.match(uploadKeys[0], /^archive\/masters\//);
  assert.equal(database.prepare("SELECT rights_notes FROM media_upload_sessions WHERE id=?").get(result.body.upload.id).rights_notes, PRIVATE_PROVENANCE);

  insertCoverMedia(database);
  result = await api(environment, "/api/admin/media/thoughtpuppet-master/variants", { method: "POST", admin: true, body: { derivative_media_id: "thoughtpuppet-public-display" } });
  assert.equal(result.response.status, 201, result.body.error);
  assert.deepEqual(Object.keys(result.body.record).sort(), ["derivativeMediaId", "derivative_media_id", "masterMediaId", "master_media_id", "purpose"]);
  assert.doesNotMatch(JSON.stringify(result.body), /storage_key|rights_notes|SHA-256|iCloudDrive/i);

  database.prepare("INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at) VALUES(?,?,'primary',1,1,datetime('now'))").run("org-thoughtpuppet", "thoughtpuppet-public-display");
  assert.equal((await api(environment, "/api/construct/entity-media/thoughtpuppet-public-display")).response.status, 404);

  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id=?").run(COVER_ID);
  database.prepare("UPDATE archive_records SET state='published' WHERE id=?").run(COVER_ID);
  database.prepare("UPDATE content_entities SET visibility='public' WHERE id=?").run(COVER_ID);
  database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at,state_id)
    VALUES(?,?,?,'primary','final-image','Draft-state display',?,'approximate','c. 2018–2019','public','published',0,'test','test',datetime('now'),datetime('now'),?)`).run("cover-draft-state-material", COVER_ID, "thoughtpuppet-public-display", CAPTION, "archive-state-thought-puppet-puppet-thoughts-1-I");
  assert.equal((await api(environment, "/api/construct/media/thoughtpuppet-public-display")).response.status, 404);
  const draftStateDetail = await api(environment, "/api/archive/items/thought-puppet-puppet-thoughts");
  assert.equal(draftStateDetail.response.status, 200);
  assert.equal(draftStateDetail.body.materials.some((material) => material.id === "cover-draft-state-material"), false);
  assert.equal(draftStateDetail.body.item.primary_media, null);
  database.prepare("DELETE FROM archive_materials WHERE id=?").run("cover-draft-state-material");

  result = await api(environment, "/api/admin/media/thoughtpuppet-master", { method: "PATCH", admin: true, body: { rights_notes: `${PRIVATE_PROVENANCE}\nVerified private master.` } });
  assert.equal(result.response.status, 200);
  assert.match(result.body.record.rights_notes, /Verified private master/);
  result = await api(environment, "/api/admin/media/thoughtpuppet-master", { method: "PATCH", admin: true, body: { privacy: "public", public_presentation: "inline" } });
  assert.equal(result.response.status, 409);

  database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at,state_id)
    VALUES(?,?,?,'primary','final-image','Public display',?,'approximate','c. 2018–2019','internal','draft',2,'test','test',datetime('now'),datetime('now'),?)`).run(LEAD_MATERIAL_ID, COVER_ID, DERIVATIVE_ID, CAPTION, COVER_STATE_ID);
  database.prepare("UPDATE archive_object_states SET lead_material_id=? WHERE id=?").run(LEAD_MATERIAL_ID, COVER_STATE_ID);

  result = await api(environment, "/api/admin/identities/thoughtpuppet", { method: "PATCH", admin: true, body: { lifecycle_status: "dormant" } });
  assert.equal(result.response.status, 200, result.body.error);
  result = await api(environment, "/api/admin/identities/thoughtpuppet/publish-package", { method: "POST", admin: true, body: {} });
  assert.equal(result.response.status, 200, result.body.error);
  assert.equal(result.body.review.status, "published");
  assert.equal(result.body.record.lifecycle_status, "dormant");
  assert.equal(result.body.record.publication_state, "published");

  database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at,state_id)
    VALUES(?,?,?,'source','artifact','Private master','PRIVATE MASTER','approximate','c. 2018–2019','public','published',3,'test','test',datetime('now'),datetime('now'),?)`).run("cover-master-material", COVER_ID, MASTER_ID, COVER_STATE_ID);
  database.prepare("INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at) VALUES(?,?,'archive-master',1,1,datetime('now'))").run(COVER_ID, MASTER_ID);
  database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline' WHERE id=?").run(MASTER_ID);

  assert.equal((await api(environment, "/api/construct/media/thoughtpuppet-master")).response.status, 404);
  assert.equal((await api(environment, "/api/construct/entity-media/thoughtpuppet-master")).response.status, 404);

  assert.equal((await handleConstructApi(request("/api/construct/entity-media/thoughtpuppet-public-display"), environment)).status, 302);

  const list = await api(environment, "/api/identities");
  assert.equal(list.body.records.some((identity) => identity.slug === "thoughtpuppet" && identity.lifecycle_status === "dormant"), true);
  const detail = await api(environment, "/api/identities/thoughtpuppet");
  assert.equal(detail.response.status, 200, detail.body.error);
  assert.equal(detail.body.dossier.catalogue_id, "");
  assert.equal(detail.body.dossier.current_version, null);
  assert.equal(detail.body.dossier.current_state, "");
  assert.equal(detail.body.featured_origin_record.primary_media.url, "/assets/archive/thought-puppet-puppet-thoughts.png");
  assert.equal(detail.body.featured_origin_record.primary_media.alt_text, ALT);
  assert.equal(detail.body.featured_origin_record.primary_media.caption, CAPTION);
  assert.equal(detail.body.featured_origin_record.primary_media.width, 560);
  assert.equal(detail.body.featured_origin_record.primary_media.height, 560);
  assert.equal(detail.body.timeline.timeline.profile_route, "/about/identities/thoughtpuppet/");
  assert.equal(detail.body.timeline.chapters.some((chapter) => chapter.id === "archive-chapter-thoughtpuppet-fictional-artist"), true);
  const originActivity = detail.body.timeline.activities.find((activity) => activity.id === "activity-thought-puppet-puppet-thoughts-origin");
  assert.equal(originActivity.lead_media.url, "/assets/archive/thought-puppet-puppet-thoughts.png");
  assert.equal(originActivity.lead_media.caption, CAPTION);
  assert.equal(originActivity.archive_route, "/archive/records/thought-puppet-puppet-thoughts/");
  assert.equal(detail.body.origin_thread.members.some((member) => member.entity_id === COVER_ID && member.archive_route === "/archive/records/thought-puppet-puppet-thoughts/"), true);
  assert.equal(detail.body.related_records.some((record) => record.entity_id === "identity-thoughtpuppet"), true);
  const serialized = JSON.stringify(detail.body);
  assert.doesNotMatch(serialized, /thoughtpuppet-master|private\/master-leak|PRIVATE_MASTER_TEST\.WEBP|iCloudDrive|SHA-256|rights_notes|created_by|updated_by|source_note/i);

  const archiveDetail = await api(environment, "/api/archive/items/thought-puppet-puppet-thoughts");
  assert.equal(archiveDetail.response.status, 200);
  assert.equal(archiveDetail.body.materials.some((material) => material.media_id === "thoughtpuppet-master"), false);
  assert.equal(archiveDetail.body.materials.some((material) => material.media_id === "thoughtpuppet-public-display"), true);

  database.prepare("UPDATE archive_timelines SET public_visible=0 WHERE id=?").run("archive-timeline-thoughtpuppet");
  assert.equal((await api(environment, "/api/identities")).body.records.some((identity) => identity.slug === "thoughtpuppet"), false);
  assert.equal((await api(environment, "/api/identities/thoughtpuppet")).response.status, 404);
  database.prepare("UPDATE archive_timelines SET public_visible=1 WHERE id=?").run("archive-timeline-thoughtpuppet");
  database.prepare("UPDATE archive_dossiers SET state='draft',public_visible=0 WHERE entity_id=?").run("org-thoughtpuppet");
  assert.equal((await api(environment, "/api/identities/thoughtpuppet")).response.status, 404);
  assert.equal((await api(environment, "/api/archive/items/thoughtpuppet")).response.status, 404);
  assert.equal((await api(environment, "/api/construct/entity-media/thoughtpuppet-public-display")).response.status, 404);
  const driftSearch = await api(environment, "/api/search?q=ThoughtPuppet&include=pages");
  assert.equal(driftSearch.body.records.some((record) => record.result_kind === "Creative identity"), false);

  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id=?").run("org-thoughtpuppet");
  database.prepare("UPDATE archive_records SET state='draft' WHERE id=?").run(COVER_ID);
  const driftArchive = await api(environment, "/api/archive/items?limit=100");
  assert.equal(driftArchive.body.records.some((record) => record.entity_id === COVER_ID), false);
  assert.equal((await api(environment, "/api/archive/items/thought-puppet-puppet-thoughts")).response.status, 404);
});

test("brand union, Search destinations, Origin Thread, Legend appearances, and profile connections stay canonical", async () => {
  const database = migratedDatabase();
  const environment = runtime(database);
  publishThoughtPuppetDependencies(database);
  database.prepare("UPDATE about_identity_profiles SET publication_state='published',visibility='public',published_at=datetime('now') WHERE organization_id=?").run("org-thoughtpuppet");
  database.prepare("UPDATE archive_dossier_subjects SET public_visible=1 WHERE subject_entity_id=? AND role='brand' AND dossier_entity_id IN (?,?)").run("org-thoughtpuppet", COVER_ID, "identity-thoughtpuppet");
  database.prepare("INSERT OR IGNORE INTO archive_dossier_subjects(dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at) VALUES(?,?,'participating art identity',1,99,datetime('now'))").run("appearance-made-in-public", "org-thoughtpuppet");

  assert.equal((await api(environment, "/api/admin/legend/archive-appearances")).response.status, 401);
  let managedAppearances = await api(environment, "/api/admin/legend/archive-appearances", { admin: true });
  assert.equal(managedAppearances.body.count, 2);
  for (const appearanceId of ["legend-appearance-thoughtpuppet-early-puppet", "legend-appearance-six-well-cover-signature"]) {
    managedAppearances = await api(environment, `/api/admin/legend/archive-appearances/${appearanceId}`, { method: "PATCH", admin: true, body: { publication_state: "published", public_visible: false } });
    assert.equal(managedAppearances.response.status, 200, managedAppearances.body.error);
    assert.equal(managedAppearances.body.record.publication_state, "published");
    assert.equal(managedAppearances.body.record.public_visible, true);
  }
  managedAppearances = await api(environment, "/api/admin/legend/archive-appearances", { method: "POST", admin: true, body: { id: "legend-appearance-api-test", symbol_entity_id: "identity-six-well", record_entity_id: "art-marbles", appearance_role: "variant", title: "Temporary managed appearance", publication_state: "published", public_visible: true } });
  assert.equal(managedAppearances.response.status, 201);
  assert.equal(managedAppearances.body.record.publication_state, "draft");
  assert.equal(managedAppearances.body.record.public_visible, false);
  managedAppearances = await api(environment, "/api/admin/legend/archive-appearances/legend-appearance-api-test", { method: "DELETE", admin: true });
  assert.equal(managedAppearances.response.status, 200);

  const thoughtPuppetVariants = JSON.parse(database.prepare("SELECT variants_json FROM visual_symbols WHERE id='identity-thoughtpuppet'").get().variants_json);
  thoughtPuppetVariants.push({ name: "Legacy duplicate", href: "/archive/records/thought-puppet-puppet-thoughts/", record_entity_id: COVER_ID });
  database.prepare("UPDATE visual_symbols SET variants_json=? WHERE id='identity-thoughtpuppet'").run(JSON.stringify(thoughtPuppetVariants));

  let result = await api(environment, "/api/archive/items?brand=thoughtpuppet&limit=100");
  const ids = new Set(result.body.records.map((record) => record.entity_id));
  for (const expected of ["art-marbles", "merch-lostmarbles-hoodie", COVER_ID, "identity-thoughtpuppet"]) assert.equal(ids.has(expected), true, expected);
  assert.equal(ids.has("appearance-made-in-public"), false, "non-brand organization roles must not enter the brand facet");
  assert.equal(result.body.facets.brand.some((facet) => facet.slug === "thoughtpuppet"), true);

  result = await api(environment, "/api/search?q=ThoughtPuppet&include=pages");
  const destinations = result.body.records.filter((record) => ["Creative identity", "Archive timeline"].includes(record.result_kind));
  assert.deepEqual(new Set(destinations.map((record) => record.result_kind)), new Set(["Creative identity", "Archive timeline"]));
  assert.equal(destinations.some((record) => record.route === "/about/identities/thoughtpuppet/"), true);
  assert.equal(destinations.some((record) => record.route === "/archive/timelines/thoughtpuppet/"), true);

  const connection = await api(environment, "/api/connections/org-thoughtpuppet");
  assert.equal(connection.response.status, 200);
  assert.equal(connection.body.entity.canonical_route, "/about/identities/thoughtpuppet/");
  assert.equal(connection.body.records.some((record) => record.related.id === "identity-thoughtpuppet"), true);

  const thoughtPuppetLegend = await api(environment, "/api/legend/thoughtpuppet");
  assert.equal(thoughtPuppetLegend.body.record.variants.some((entry) => entry.record_entity_id === COVER_ID && entry.href === "/archive/records/thought-puppet-puppet-thoughts/"), true);
  assert.equal(thoughtPuppetLegend.body.record.variants.filter((entry) => entry.record_entity_id === COVER_ID).length, 1);
  assert.equal(thoughtPuppetLegend.body.record.examples.some((entry) => entry.href === "/about/identities/thoughtpuppet/"), true);
  assert.equal(thoughtPuppetLegend.body.record.examples.some((entry) => entry.href === "/archive/timelines/thoughtpuppet/"), true);
  const sixWellLegend = await api(environment, "/api/legend/six-well");
  assert.equal(sixWellLegend.body.record.examples.some((entry) => entry.record_entity_id === COVER_ID), true);

  const profile = await api(environment, "/api/identities/thoughtpuppet");
  assert.equal(profile.body.origin_thread.members.length, 4);
  assert.doesNotMatch(JSON.stringify(profile.body), /rights_notes|storage_key|original_filename|source_note|created_by|updated_by/i);

  database.prepare("UPDATE archive_records SET state='draft' WHERE id=?").run(COVER_ID);
  const driftedThoughtPuppetLegend = await api(environment, "/api/legend/thoughtpuppet");
  assert.equal(driftedThoughtPuppetLegend.body.record.variants.some((entry) => entry.record_entity_id === COVER_ID), false);
  assert.equal(driftedThoughtPuppetLegend.body.record.archive_appearances.some((entry) => entry.record_entity_id === COVER_ID), false);
  const driftedSixWellLegend = await api(environment, "/api/legend/six-well");
  assert.equal(driftedSixWellLegend.body.record.examples.some((entry) => entry.record_entity_id === COVER_ID), false);
});
