import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION = "0160_atlanta_fall_2026_arts_preview.sql";

function databaseBeforeImport() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql") && item < MIGRATION).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function insertSource(db, id, name, url) {
  db.prepare(`INSERT OR IGNORE INTO calendar_sources
    (id,name,url,source_type,trust_level,enabled,cadence_hours,created_at,updated_at)
    VALUES(?,?,?,'official_html','official',1,24,datetime('now'),datetime('now'))`).run(id, name, url);
}

function insertCandidate(db, {
  id, title, sourceUrl, startsAt = null, endsAt = null, venueName = "", venueAddress = "",
  dateKind = "date_range", status = "published", verificationState = "verified",
  publicEntryId = "", pendingRevisionId = "",
}) {
  db.prepare(`INSERT INTO calendar_candidates
    (id,source_url,title,date_kind,starts_at,ends_at,venue_name,venue_address,status,verification_state,
     public_entry_id,pending_revision_id,first_seen_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'))`)
    .run(id, sourceUrl, title, dateKind, startsAt, endsAt, venueName, venueAddress, status, verificationState, publicEntryId, pendingRevisionId);
}

function seedProductionShape(db) {
  insertSource(db, "cal_source_forward_warrior_fixture", "Forward Warrior", "https://cabbagetown.com/forwardwarrior");
  insertSource(db, "cal_source_spalding_nix", "Spalding Nix Fine Art", "https://spaldingnixfineart.com/shows");
  insertSource(db, "cal_source_moca_fixture", "MOCA GA", "https://mocaga.org/calendar/");
  insertSource(db, "cal_source_beltline_fixture", "BELTLINE", "https://beltline.org/events/");

  insertCandidate(db, {
    id:"cal_candidate_forward_warrior_fixture", title:"Forward Warrior 2026",
    sourceUrl:"https://cabbagetown.com/forwardwarrior", startsAt:"2026-09-18", endsAt:"2026-09-20",
    venueName:"Wylie Street", venueAddress:"Cabbagetown, Atlanta, GA", status:"candidate", publicEntryId:"",
  });
  insertCandidate(db, {
    id:"cal_candidate_remote_atlanta_art_fair", title:"Atlanta Art Fair 2026",
    sourceUrl:"https://amp.events/projects/atlanta-art-fair-2", startsAt:"2026-10-01", endsAt:"2026-10-04",
    venueName:"Pullman Yards — Porter Hall", venueAddress:"225 Rogers Street NE, Atlanta, GA 30317",
    publicEntryId:"cal_entry_remote_atlanta_art_fair",
  });
  insertCandidate(db, {
    id:"cal_candidate_remote_calida_rawles", title:"Calida Rawles: Away with the Tides",
    sourceUrl:"https://www.artsatl.org/event/calida-rawles-away-with-the-tides/", startsAt:"2026-03-27", endsAt:"2026-09-05",
    venueName:"Spelman College Museum of Fine Art", venueAddress:"350 Spelman Lane SW, Atlanta, GA 30314",
    publicEntryId:"cal_entry_remote_calida_rawles",
  });
  insertCandidate(db, {
    id:"cal_candidate_remote_chuck_stewart", title:"Chuck Stewart: Framing the Sound",
    sourceUrl:"https://www.artsatl.org/event/chuck-stewart-framing-the-sound/", startsAt:"2026-08-08", endsAt:"2026-09-26",
    venueName:"The Sun ATL", venueAddress:"399 Edgewood Avenue, Atlanta, GA 30312",
    publicEntryId:"cal_entry_remote_chuck_stewart",
  });
  db.prepare(`INSERT INTO calendar_candidate_revisions
    (id,candidate_id,revision_number,revision_state,snapshot_json,change_summary,created_by,created_at)
    VALUES('cal_revision_existing_chuck','cal_candidate_remote_chuck_stewart',8,'pending','{}','Existing Studio revision','source_monitor',datetime('now'))`).run();
  db.prepare("UPDATE calendar_candidates SET pending_revision_id='cal_revision_existing_chuck' WHERE id='cal_candidate_remote_chuck_stewart'").run();

  insertCandidate(db, {
    id:"cal_candidate_remote_mindful_seeing", title:"MINDFUL SEEING",
    sourceUrl:"https://www.artsatl.org/event/mindful-seeing/2026-07-25/1/", startsAt:"2026-07-25", endsAt:"2026-09-11",
    venueName:"Spalding Nix Fine Art", status:"rejected", publicEntryId:"cal_entry_remote_mindful_seeing",
  });
  insertCandidate(db, {
    id:"cal_candidate_remote_walter_wick", title:"I SPY! Walter Wick’s Hidden Wonders",
    sourceUrl:"https://high.org/exhibition/walter-wick/", startsAt:"2026-08-28", endsAt:"2027-01-03",
    venueName:"High Museum of Art", publicEntryId:"cal_entry_remote_walter_wick",
  });
  insertCandidate(db, {
    id:"cal_candidate_remote_paper_trees", title:"Paper Trees",
    sourceUrl:"https://high.org/exhibition/paper-trees/", startsAt:"2026-07-31", endsAt:"2027-02-21",
    venueName:"High Museum of Art", publicEntryId:"cal_entry_remote_paper_trees",
  });
}

test("Fall 2026 arts crawl stays private, deduplicates production-shaped records, and leaves Forward Warrior unchanged", () => {
  const db = databaseBeforeImport();
  seedProductionShape(db);
  const forwardBefore = { ...db.prepare("SELECT * FROM calendar_candidates WHERE id='cal_candidate_forward_warrior_fixture'").get() };
  const forwardSourceBefore = { ...db.prepare("SELECT * FROM calendar_sources WHERE id='cal_source_forward_warrior_fixture'").get() };
  const publicCountBefore = db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count;

  db.exec(readFileSync(join(ROOT, "migrations", MIGRATION), "utf8"));

  assert.deepEqual({ ...db.prepare("SELECT * FROM calendar_candidates WHERE id='cal_candidate_forward_warrior_fixture'").get() }, forwardBefore);
  assert.deepEqual({ ...db.prepare("SELECT * FROM calendar_sources WHERE id='cal_source_forward_warrior_fixture'").get() }, forwardSourceBefore);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_entries").get().count, publicCountBefore);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE discovery_channel='arts_atl_fall_2026' AND public_entry_id<>''").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE discovery_channel='arts_atl_fall_2026' AND status='needs_verification'").get().count, 8);

  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE lower(title)='site 2026'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE lower(title)='paper trees'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE lower(title)='i spy! walter wick’s hidden wonders'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE lower(title)='mindful seeing'").get().count, 1);
  assert.equal(db.prepare("SELECT status FROM calendar_candidates WHERE id='cal_candidate_remote_mindful_seeing'").get().status, "rejected");

  const artFair = db.prepare("SELECT source_url,pending_revision_id FROM calendar_candidates WHERE id='cal_candidate_remote_atlanta_art_fair'").get();
  assert.equal(artFair.source_url, "https://amp.events/projects/atlanta-art-fair-2");
  assert.equal(artFair.pending_revision_id, "cal_revision_fall_2026_cal_candidate_remote_atlanta_art_fair");
  assert.equal(
    JSON.parse(db.prepare("SELECT snapshot_json FROM calendar_candidate_revisions WHERE id=?").get(artFair.pending_revision_id).snapshot_json).sourceUrl,
    "https://theatlantaartfair.com/",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidate_occurrences WHERE candidate_id='cal_candidate_remote_atlanta_art_fair'").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidate_links WHERE candidate_id='cal_candidate_remote_atlanta_art_fair' AND url LIKE '%low-grit-grins%'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidates WHERE lower(title)='low grit grins'").get().count, 0);

  const calida = db.prepare("SELECT source_url,pending_revision_id FROM calendar_candidates WHERE id='cal_candidate_remote_calida_rawles'").get();
  assert.equal(calida.source_url, "https://www.artsatl.org/event/calida-rawles-away-with-the-tides/");
  assert.equal(
    JSON.parse(db.prepare("SELECT snapshot_json FROM calendar_candidate_revisions WHERE id=?").get(calida.pending_revision_id).snapshot_json).sourceUrl,
    "https://www.spelman.edu/museum-of-fine-art/art-and-events/exhibitions/calida-rawles.html",
  );
  assert.equal(db.prepare("SELECT pending_revision_id FROM calendar_candidates WHERE id='cal_candidate_remote_chuck_stewart'").get().pending_revision_id, "cal_revision_existing_chuck");

  assert.deepEqual(
    { ...db.prepare("SELECT starts_at,ends_at FROM calendar_candidates WHERE id='cal_candidate_fall_2026_amy_sherald'").get() },
    { starts_at:"2026-05-15", ends_at:"2026-09-27" },
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidate_occurrences WHERE candidate_id='cal_candidate_fall_2026_amy_sherald'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_candidate_occurrences WHERE candidate_id='cal_candidate_fall_2026_ma_architecture_tours'").get().count, 2);

  assert.equal(db.prepare("SELECT url FROM calendar_sources WHERE id='cal_source_spalding_nix'").get().url, "https://spaldingnixfineart.com/shows");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_sources WHERE lower(rtrim(url,'/'))=lower(rtrim('https://mocaga.org/calendar/','/'))").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_sources WHERE lower(rtrim(url,'/'))=lower(rtrim('https://beltline.org/events/','/'))").get().count, 1);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name LIKE 'calendar_fall_2026_%'").get().count, 0);
});
