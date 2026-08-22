import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION = "0162_calendar_latest_creative_scout_strong_picks.sql";
const IDS = [
  "cal_candidate_spelman_between_here_infinity_2026",
  "cal_candidate_eyedrum_chamber_cartel_benator_2026",
  "cal_candidate_plaza_gandahar_2026",
  "cal_candidate_artists_afternoon_writing_narrative_2026",
  "cal_candidate_poetic_jazz_under_stars_2026",
];

function databaseBeforeImport() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql") && item < MIGRATION).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

test("latest Creative Scout report becomes five private Strong Picks without publishing strategy notes", () => {
  const db = databaseBeforeImport();
  const publicBefore = db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count;

  db.exec(readFileSync(join(ROOT, "migrations", MIGRATION), "utf8"));

  const placeholders = IDS.map(() => "?").join(",");
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM calendar_candidates WHERE id IN (${placeholders})`).get(...IDS).count, 5);
  assert.deepEqual(
    db.prepare(`SELECT status,COUNT(*) count FROM calendar_candidates WHERE id IN (${placeholders}) GROUP BY status ORDER BY status`).all(...IDS).map((row) => ({ ...row })),
    [{ status:"candidate", count:3 }, { status:"needs_verification", count:2 }],
  );
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM calendar_candidate_notes WHERE candidate_id IN (${placeholders})`).get(...IDS).count, 5);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM calendar_scout_strong_picks WHERE candidate_id IN (${placeholders})`).get(...IDS).count, 5);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM calendar_candidate_revisions WHERE candidate_id IN (${placeholders}) AND revision_state='pending'`).get(...IDS).count, 5);
  assert.equal(db.prepare("SELECT strong_pick_count FROM calendar_scout_runs WHERE id='cal_run_scheduled_chat_20260821_latest'").get().strong_pick_count, 5);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count, publicBefore);

  const publicPayload = JSON.stringify(db.prepare("SELECT * FROM calendar_entries").all());
  for (const phrase of ["Root / Threshold", "commissioning model", "Pure visual inspiration", "film and media relationships", "strongest programming model"]) {
    assert.equal(publicPayload.includes(phrase), false);
  }
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});
