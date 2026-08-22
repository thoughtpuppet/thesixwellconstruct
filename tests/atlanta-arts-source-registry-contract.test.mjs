import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION = "0161_atlanta_verified_arts_sources.sql";

const SOURCE_IDS = [
  "cal_source_carlos_calendar",
  "cal_source_roswell_arts_fund",
  "cal_source_roswell_fine_arts_alliance",
  "cal_source_arts_alpharetta",
  "cal_source_the_art_center",
  "cal_source_dalton_gallery",
  "cal_source_dashboard_upcoming",
  "cal_source_marcia_wood",
  "cal_source_mason_fine_art",
  "cal_source_alan_avery",
  "cal_source_vinson_art",
  "cal_source_south_arts_events",
  "cal_source_atlanta_printmakers",
  "cal_source_papermaking_museum",
  "cal_source_september_gray",
  "cal_source_serenbe_events",
];

const DISABLED_SOURCE_IDS = new Set([
  "cal_source_roswell_fine_arts_alliance",
  "cal_source_dalton_gallery",
  "cal_source_south_arts_events",
  "cal_source_september_gray",
]);

function databaseBeforeRegistry() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql") && item < MIGRATION).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

test("verified metro Atlanta arts sources are registered without bypassing Studio review", () => {
  const db = databaseBeforeRegistry();
  const sql = readFileSync(join(ROOT, "migrations", MIGRATION), "utf8");
  const publicCountBefore = db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count;
  const candidateCountBefore = db.prepare("SELECT COUNT(*) count FROM calendar_candidates").get().count;

  db.exec(sql);

  const sources = db.prepare(`SELECT id,name,url,source_type,trust_level,enabled,adapter_key,render_mode,adapter_config_json
    FROM calendar_sources WHERE id IN (${placeholders(SOURCE_IDS)}) ORDER BY id`).all(...SOURCE_IDS);
  assert.equal(sources.length, 16);
  assert.equal(sources.filter((source) => source.enabled === 1).length, 12);
  assert.equal(sources.filter((source) => source.enabled === 0).length, 4);
  for (const source of sources) {
    assert.equal(source.enabled, DISABLED_SOURCE_IDS.has(source.id) ? 0 : 1);
    assert.doesNotThrow(() => JSON.parse(source.adapter_config_json));
  }

  assert.equal(db.prepare("SELECT url FROM calendar_sources WHERE id='cal_source_vinson_art'").get().url, "https://vinsonart.com/exhibitions/");
  assert.equal(db.prepare("SELECT adapter_key FROM calendar_sources WHERE id='cal_source_the_art_center'").get().adapter_key, "wix");
  assert.equal(JSON.parse(db.prepare("SELECT adapter_config_json FROM calendar_sources WHERE id='cal_source_atlanta_printmakers'").get().adapter_config_json).internalAdapter, "squarespace");
  assert.equal(db.prepare("SELECT render_mode FROM calendar_sources WHERE id='cal_source_mason_fine_art'").get().render_mode, "dynamic-fallback");

  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_sources WHERE url IN ('https://carlos.emory.edu/calendar','https://carlos.emory.edu/exhibitions')").get().count, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM (
    SELECT lower(rtrim(url,'/')) normalized_url,COUNT(*) duplicate_count
    FROM calendar_sources WHERE id IN (${placeholders(SOURCE_IDS)})
    GROUP BY normalized_url HAVING duplicate_count>1
  )`).get(...SOURCE_IDS).count, 0);

  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_known_organizations WHERE id LIKE 'cal_org_%' AND id IN ('cal_org_carlos_museum','cal_org_roswell_arts_fund','cal_org_roswell_fine_arts_alliance','cal_org_arts_alpharetta','cal_org_the_art_center','cal_org_dalton_gallery','cal_org_dashboard','cal_org_marcia_wood','cal_org_mason_fine_art','cal_org_alan_avery','cal_org_vinson_art','cal_org_south_arts','cal_org_atlanta_printmakers','cal_org_papermaking_museum','cal_org_september_gray','cal_org_serenbe_institute')").get().count, 16);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_sources WHERE lower(name) LIKE '%mint%' OR lower(name) LIKE '%camayuhs%' OR lower(name) LIKE '%different trains%'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count, publicCountBefore);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates").get().count, candidateCountBefore);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

  db.exec(sql);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM calendar_sources WHERE id IN (${placeholders(SOURCE_IDS)})`).get(...SOURCE_IDS).count, 16);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name='calendar_verified_arts_sources_stage'").get().count, 0);
});
