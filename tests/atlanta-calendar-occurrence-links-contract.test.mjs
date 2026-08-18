import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function databaseThrough(lastMigration) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql")).sort()) {
    if (name > lastMigration) break;
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

test("Walter Wick related program keeps an occurrence detail URL and direct ticket URL", () => {
  const db = databaseThrough("0141_calendar_ticket_platform_sources.sql");
  const candidateId = "cal_candidate_gulch_we_hold_truths";
  const occurrence = db.prepare("SELECT id FROM calendar_candidate_occurrences WHERE candidate_id=? ORDER BY sort_order LIMIT 1").get(candidateId);

  db.prepare("UPDATE calendar_candidates SET title=? WHERE id=?").run("I SPY! Walter Wick’s Hidden Wonders", candidateId);
  db.prepare("UPDATE calendar_candidate_occurrences SET title=?,source_url=?,ticket_url='' WHERE id=?")
    .run("Behind the Scenes with Walter Wick, Artist and Author of I SPY! and Can You See What I See?", "https://high.org/", occurrence.id);
  db.prepare("UPDATE calendar_candidate_revisions SET snapshot_json=json_set(snapshot_json,'$.occurrences[0].title',?,'$.occurrences[0].sourceUrl',?,'$.occurrences[0].ticketUrl','') WHERE candidate_id=?")
    .run("Behind the Scenes with Walter Wick, Artist and Author of I SPY! and Can You See What I See?", "https://high.org/", candidateId);

  db.exec(readFileSync(join(ROOT, "migrations", "0143_calendar_walter_wick_occurrence_links.sql"), "utf8"));

  const corrected = db.prepare("SELECT source_url,ticket_url FROM calendar_candidate_occurrences WHERE id=?").get(occurrence.id);
  assert.deepEqual({ ...corrected }, {
    source_url:"https://high.org/event/behind-the-scenes-with-walter-wick/",
    ticket_url:"https://my.high.org/169092/169739",
  });

  const revision = db.prepare("SELECT snapshot_json FROM calendar_candidate_revisions WHERE candidate_id=? AND json_extract(snapshot_json,'$.occurrences[0].title') LIKE 'Behind the Scenes with Walter Wick%' LIMIT 1").get(candidateId);
  const snapshot = JSON.parse(revision.snapshot_json);
  assert.equal(snapshot.occurrences[0].sourceUrl, "https://high.org/event/behind-the-scenes-with-walter-wick/");
  assert.equal(snapshot.occurrences[0].ticketUrl, "https://my.high.org/169092/169739");
});

test("public occurrence cards expose separate official and registration actions", () => {
  const publicCalendar = readFileSync(join(ROOT, "js", "atlanta-calendar.js"), "utf8");
  assert.match(publicCalendar, /var officialUrl = event\.sourceUrl/);
  assert.match(publicCalendar, /var ticketUrl = event\.ticketUrl/);
  assert.match(publicCalendar, />Official details<\/a>/);
  assert.match(publicCalendar, />Tickets \/ Register<\/a>/);
});
