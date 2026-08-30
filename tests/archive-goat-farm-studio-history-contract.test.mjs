import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
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
  prepare(sql) { return new Statement(this.database, sql); }
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
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function request(path) {
  return new Request(`https://example.test${path}`);
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test("Goat Farm studio history creates one linked public record and one private source Journal", async () => {
  const db = database();
  const runtime = { SUBMISSIONS_DB: new LocalD1(db) };

  assert.deepEqual(
    { ...db.prepare("SELECT entity_type,visibility,search_visibility FROM content_entities WHERE id='place-goat-farm-arts-center'").get() },
    { entity_type: "place", visibility: "public", search_visibility: 1 },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT name,slug,privacy,state FROM places WHERE id='place-goat-farm-arts-center'").get() },
    { name: "Goat Farm Arts Center", slug: "goat-farm-arts-center", privacy: "public", state: "published" },
  );

  assert.deepEqual(
    { ...db.prepare("SELECT state,public_visible,record_type FROM archive_dossiers WHERE entity_id='archive-record-saiel-goat-farm-studio-years'").get() },
    { state: "published", public_visible: 1, record_type: "process" },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT title,slug,state,creator_entity_id,date_precision FROM archive_records WHERE id='archive-record-saiel-goat-farm-studio-years'").get() },
    {
      title: "Goat Farm Studio Years, 2018–2021",
      slug: "saiel-goat-farm-studio-years",
      state: "published",
      creator_entity_id: "person-saiel-dauhn-solehman",
      date_precision: "range",
    },
  );

  const materials = db.prepare(`SELECT am.id,am.sort_order,am.process_phase,am.date_label,m.source_url,m.privacy,m.public_presentation
    FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
    WHERE am.dossier_entity_id='archive-record-saiel-goat-farm-studio-years'
    ORDER BY am.sort_order`).all().map((row) => ({ ...row }));
  assert.equal(materials.length, 4);
  assert.deepEqual(materials.map((row) => row.date_label), ["September 24, 2019", "November 13, 2019", "January 25, 2020", "May 11, 2021"]);
  assert.deepEqual(materials.map((row) => row.process_phase), [
    "Work-only studio · 2018–2019",
    "Work-only studio · 2018–2019",
    "Live/work studio · 2019–2021",
    "Live/work studio · 2019–2021",
  ]);
  assert.ok(materials.every((row) => row.privacy === "public" && row.public_presentation === "inline"));
  assert.ok(materials.every((row) => row.source_url.startsWith("/assets/archive/goat-farm-arts-center/saiel-goat-farm-")));
  const mediaCredits = db.prepare("SELECT credit FROM media_assets WHERE id LIKE 'media-saiel-goat-farm-%' ORDER BY id").all();
  assert.equal(mediaCredits.length, 4);
  assert.ok(mediaCredits.every((row) => row.credit === "Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license."));

  const subjects = db.prepare(`SELECT subject_entity_id,role,public_visible FROM archive_dossier_subjects
    WHERE dossier_entity_id='archive-record-saiel-goat-farm-studio-years' ORDER BY sort_order`).all().map((row) => ({ ...row }));
  assert.deepEqual(subjects, [
    { subject_entity_id: "person-saiel-dauhn-solehman", role: "artist and resident", public_visible: 1 },
    { subject_entity_id: "place-goat-farm-arts-center", role: "primary place", public_visible: 1 },
    { subject_entity_id: "place-jr-erikson-building", role: "relocation place", public_visible: 1 },
  ]);

  assert.deepEqual(
    { ...db.prepare("SELECT state,public_visible,note_type,date_label FROM archive_notes WHERE entity_id='archive-note-saiel-goat-farm-studio-years'").get() },
    { state: "draft", public_visible: 0, note_type: "journal-entry", date_label: "2018–2021" },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='archive-note-saiel-goat-farm-studio-years'").get() },
    { visibility: "internal", search_visibility: 0 },
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_note_assets WHERE note_entity_id='archive-note-saiel-goat-farm-studio-years' AND public_visible=0").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_note_links WHERE note_entity_id='archive-note-saiel-goat-farm-studio-years' AND public_visible=0").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM search_documents WHERE entity_id='archive-note-saiel-goat-farm-studio-years'").get().count, 0);

  const publicRecord = await json(await handleConstructApi(request("/api/archive/items/saiel-goat-farm-studio-years"), runtime));
  assert.equal(publicRecord.status, 200, publicRecord.body.error);
  assert.equal(publicRecord.body.item.entity_id, "archive-record-saiel-goat-farm-studio-years");
  assert.deepEqual(publicRecord.body.materials.map((material) => material.date_label), ["September 24, 2019", "November 13, 2019", "January 25, 2020", "May 11, 2021"]);

  const timeline = await json(await handleConstructApi(request("/api/archive/timelines/saiel-dauhn-solehman"), runtime));
  assert.equal(timeline.status, 200, timeline.body.error);
  const milestones = timeline.body.entries.filter((entry) => entry.id === "activity-saiel-goat-farm-studio-years-2018-2021");
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].date_label, "2018–2021");
  assert.equal(milestones[0].date_precision, "range");
  assert.equal(milestones[0].archive_route, "/archive/records/saiel-goat-farm-studio-years/");
  assert.equal(milestones[0].lead_media.url, "/assets/archive/goat-farm-arts-center/saiel-goat-farm-work-studio-2019-09-24.jpg");

  const notes = await json(await handleConstructApi(request("/api/archive/notes"), runtime));
  assert.equal(notes.status, 200);
  assert.ok(!notes.body.records.some((note) => note.entity_id === "archive-note-saiel-goat-farm-studio-years"));
  const privateNote = await json(await handleConstructApi(request("/api/archive/notes/saiel-goat-farm-studio-years-source-journal"), runtime));
  assert.equal(privateNote.status, 404);
});
