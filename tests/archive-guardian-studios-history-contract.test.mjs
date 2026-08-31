import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_PATH = join(ROOT, "migrations", "0205_guardian_studios_personal_history.sql");

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

test("Guardian Studios history creates one zero-media public record and one private factual Journal", async () => {
  const db = database();
  const runtime = { SUBMISSIONS_DB: new LocalD1(db) };

  assert.deepEqual(
    { ...db.prepare("SELECT entity_type,visibility,search_visibility FROM content_entities WHERE id='place-guardian-studios'").get() },
    { entity_type: "place", visibility: "public", search_visibility: 1 },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT name,slug,public_location,privacy,state FROM places WHERE id='place-guardian-studios'").get() },
    {
      name: "Guardian Studios at Echo Street West",
      slug: "guardian-studios",
      public_location: "785 Echo Street NW, Atlanta, GA 30318",
      privacy: "public",
      state: "published",
    },
  );

  assert.deepEqual(
    { ...db.prepare("SELECT state,public_visible,record_type,empty_materials_note FROM archive_dossiers WHERE entity_id='archive-record-saiel-guardian-studios-years'").get() },
    {
      state: "published",
      public_visible: 1,
      record_type: "process",
      empty_materials_note: "No personal photographs have been added to this record.",
    },
  );
  const record = { ...db.prepare("SELECT title,slug,state,creator_entity_id,date_precision,body,source_note FROM archive_records WHERE id='archive-record-saiel-guardian-studios-years'").get() };
  assert.equal(record.title, "Guardian Studios Studio Years, 2023–2025");
  assert.equal(record.slug, "saiel-guardian-studios-years");
  assert.equal(record.state, "published");
  assert.equal(record.creator_entity_id, "person-saiel-dauhn-solehman");
  assert.equal(record.date_precision, "range");
  assert.match(record.body, /Studio 30[\s\S]*241-square-foot[\s\S]*\$588\.04 per month[\s\S]*Studio 20[\s\S]*380-square-foot[\s\S]*\$927\.70 per month/);
  assert.match(record.body, /approximate phase dates/);
  assert.match(record.body, /do not establish a residential or live\/work use, total rent paid, deposits, lease terms, or payment history/);
  assert.match(record.source_note, /No lease, payment record, financial document, photograph, or inferred memory is used/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_materials WHERE dossier_entity_id='archive-record-saiel-guardian-studios-years'").get().count, 0);

  const subjects = db.prepare(`SELECT subject_entity_id,role,public_visible FROM archive_dossier_subjects
    WHERE dossier_entity_id='archive-record-saiel-guardian-studios-years' ORDER BY sort_order`).all().map((row) => ({ ...row }));
  assert.deepEqual(subjects, [
    { subject_entity_id: "person-saiel-dauhn-solehman", role: "artist and studio tenant", public_visible: 1 },
    { subject_entity_id: "place-guardian-studios", role: "primary place", public_visible: 1 },
  ]);

  const note = { ...db.prepare("SELECT state,public_visible,note_type,date_label,body_markdown FROM archive_notes WHERE entity_id='archive-note-saiel-guardian-studios-years'").get() };
  assert.equal(note.state, "draft");
  assert.equal(note.public_visible, 0);
  assert.equal(note.note_type, "journal-entry");
  assert.equal(note.date_label, "2023–2025");
  assert.match(note.body_markdown, /No lease, payment record, financial document, photograph, or additional memory was requested or attached/);
  assert.deepEqual(
    { ...db.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='archive-note-saiel-guardian-studios-years'").get() },
    { visibility: "internal", search_visibility: 0 },
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_note_assets WHERE note_entity_id='archive-note-saiel-guardian-studios-years'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_note_links WHERE note_entity_id='archive-note-saiel-guardian-studios-years' AND public_visible=0").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM search_documents WHERE entity_id='archive-note-saiel-guardian-studios-years'").get().count, 0);

  const publicRecord = await json(await handleConstructApi(request("/api/archive/items/saiel-guardian-studios-years"), runtime));
  assert.equal(publicRecord.status, 200, publicRecord.body.error);
  assert.equal(publicRecord.body.item.entity_id, "archive-record-saiel-guardian-studios-years");
  assert.equal(publicRecord.body.materials.length, 0);
  assert.equal(publicRecord.body.dossier.empty_materials_note, "No personal photographs have been added to this record.");

  const timeline = await json(await handleConstructApi(request("/api/archive/timelines/saiel-dauhn-solehman"), runtime));
  assert.equal(timeline.status, 200, timeline.body.error);
  const milestones = timeline.body.entries.filter((entry) => entry.id === "activity-saiel-guardian-studios-years-2023-2025");
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].date_label, "Approximately April 29, 2023–January 7, 2025");
  assert.equal(milestones[0].date_precision, "range");
  assert.equal(milestones[0].archive_route, "/archive/records/saiel-guardian-studios-years/");
  assert.equal(milestones[0].lead_media, null);

  const notes = await json(await handleConstructApi(request("/api/archive/notes"), runtime));
  assert.equal(notes.status, 200);
  assert.ok(!notes.body.records.some((item) => item.entity_id === "archive-note-saiel-guardian-studios-years"));
  const privateNote = await json(await handleConstructApi(request("/api/archive/notes/saiel-guardian-studios-years-source-journal"), runtime));
  assert.equal(privateNote.status, 404);

  db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM places WHERE id='place-guardian-studios'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_records WHERE id='archive-record-saiel-guardian-studios-years'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM entity_activity WHERE id='activity-saiel-guardian-studios-years-2023-2025'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_notes WHERE entity_id='archive-note-saiel-guardian-studios-years'").get().count, 1);
});
