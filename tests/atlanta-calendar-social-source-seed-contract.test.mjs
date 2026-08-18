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

test("Culture x Canvas is seeded as a canonical enabled Instagram discovery source", () => {
  const db = databaseThrough("0141_calendar_ticket_platform_sources.sql");
  db.exec(readFileSync(join(ROOT, "migrations", "0144_calendar_culturexcanvas_social_source.sql"), "utf8"));

  const source = db.prepare(
    "SELECT platform,name,handle,profile_url,trust_level,enabled,cadence_hours FROM calendar_social_sources WHERE platform='instagram' AND handle='culturexcanvasartshow'"
  ).get();

  assert.deepEqual({ ...source }, {
    platform:"instagram",
    name:"Culture x Canvas Art Show",
    handle:"culturexcanvasartshow",
    profile_url:"https://www.instagram.com/culturexcanvasartshow/",
    trust_level:"trusted",
    enabled:1,
    cadence_hours:24,
  });
});
