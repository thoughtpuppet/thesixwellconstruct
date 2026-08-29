import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleCalendarFeed, handleCalendarPublicApi } from "../functions/api/calendar/_lib.js";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new DatabaseSync(":memory:");
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE events(
    id TEXT PRIMARY KEY,slug TEXT,title TEXT,description TEXT,starts_at TEXT,ends_at TEXT,
    location TEXT,status TEXT,publication_state TEXT,updated_at TEXT
  );
  CREATE TABLE event_occurrences(
    id TEXT PRIMARY KEY,event_id TEXT,starts_at TEXT,ends_at TEXT,
    location TEXT,status TEXT,updated_at TEXT
  );
  CREATE TABLE construct_pathways(id TEXT PRIMARY KEY,name TEXT,route TEXT,updated_at TEXT);
  INSERT INTO construct_pathways VALUES('path-events-03','x','x',datetime('now'));
  CREATE TABLE media_assets(
    id TEXT PRIMARY KEY,state TEXT,privacy TEXT,
    public_presentation TEXT,mime_type TEXT,width INTEGER,height INTEGER,
    alt_text TEXT,caption TEXT
  );
`);

const migrations = readdirSync(join(root, "migrations"))
  .filter((name) => /^01(29|3[0-9]|4[0-9]|5[0-2])_/.test(name))
  .sort();

for (const name of migrations) {
  db.exec(readFileSync(join(root, "migrations", name), "utf8"));
  console.log("ok", name);
}

const counts = db.prepare(`
  SELECT
    (SELECT count(*) FROM calendar_entries) entries,
    (SELECT count(*) FROM calendar_candidates WHERE status='published') published,
    (SELECT count(*) FROM calendar_candidate_notes) notes,
    (SELECT count(*) FROM calendar_scout_strong_picks) strong_picks
`).get();

if (counts.entries < 14 || counts.published < 14) {
  throw new Error(`Expected at least 14 published Scout entries, received ${JSON.stringify(counts)}`);
}
if (counts.strong_picks !== 21) {
  throw new Error(`Expected 21 historical Strong Picks, received ${JSON.stringify(counts)}`);
}

const recovered = db.prepare(`
  SELECT id,status,verification_state,public_entry_id
  FROM calendar_candidates
  WHERE id IN (
    'cal_candidate_adama_mending_to_preserve_2026',
    'cal_candidate_plaza_film_love_milestones_2026',
    'cal_candidate_plaza_lockjaw_2026',
    'cal_candidate_miya_bailey_today_tomorrow_2026',
    'cal_candidate_plaza_faust_nebulous_2026'
  )
  ORDER BY id
`).all();
if (recovered.length !== 5 || recovered.some((candidate) => candidate.public_entry_id)) {
  throw new Error(`Recovered events must remain private candidates: ${JSON.stringify(recovered)}`);
}
const unresolvedToday = recovered.find((candidate) => candidate.id === 'cal_candidate_miya_bailey_today_tomorrow_2026');
if (unresolvedToday?.status !== 'needs_verification' || unresolvedToday?.verification_state !== 'needs_verification') {
  throw new Error(`Today and Tomorrow must remain unresolved: ${JSON.stringify(unresolvedToday)}`);
}

const leaked = db.prepare(`
  SELECT count(*) n FROM calendar_entries
  WHERE factual_description LIKE '%Private Scout%'
     OR factual_description LIKE '%Attend and network%'
     OR factual_description LIKE '%Future Six.Well%'
`).get();

if (leaked.n !== 0) throw new Error("Private Scout intelligence leaked into public entries.");

const synergy = db.prepare(`
  SELECT status,verification_state,public_entry_id
  FROM calendar_candidates WHERE id='cal_candidate_synergy'
`).get();
const publicSynergy = db.prepare(`
  SELECT count(*) n
  FROM calendar_entries e
  JOIN calendar_candidates c ON c.id=e.candidate_id
  WHERE c.id='cal_candidate_synergy'
     OR c.source_url='https://www.kailinart.com/news/synergy-opening-at-annex'
`).get();

if (synergy.status !== 'needs_verification' || synergy.public_entry_id || publicSynergy.n !== 0) {
  throw new Error(`SYNERGY must remain private until its dates are verified: ${JSON.stringify(synergy)}`);
}

const runtime = { SUBMISSIONS_DB: new LocalD1(db) };
const publicResponse = await handleCalendarPublicApi(
  new Request("https://example.test/api/calendar/events"),
  runtime,
);
if (publicResponse.status !== 200) {
  throw new Error(`Public calendar returned ${publicResponse.status}: ${await publicResponse.text()}`);
}
const publicJson = await publicResponse.text();
const publicPayload = JSON.parse(publicJson);
const publicTitles = [...publicPayload.events, ...publicPayload.series].map((event) => event.title);
for (const title of ["Words on Wylie 2026", "Cut Corners Presents: GRRL", "SITE 2026", "A Measure Without"]) {
  if (!publicTitles.includes(title)) throw new Error(`Expected ${title} on the public calendar.`);
}
if (publicTitles.some((title) => title.startsWith("SYNERGY"))) {
  throw new Error("SYNERGY leaked onto the public calendar.");
}

const feedResponse = await handleCalendarFeed(
  new Request("https://example.test/calendars/atlanta.ics"),
  runtime,
);
if (feedResponse.status !== 200) {
  throw new Error(`Atlanta ICS returned ${feedResponse.status}: ${await feedResponse.text()}`);
}
const feed = await feedResponse.text();
for (const title of ["Words on Wylie 2026", "Cut Corners Presents: GRRL", "SITE 2026", "A Measure Without"]) {
  if (!feed.includes(`SUMMARY:${title}`)) throw new Error(`Expected ${title} in the Atlanta ICS feed.`);
}
if (feed.includes("SUMMARY:SYNERGY")) throw new Error("SYNERGY leaked into the Atlanta ICS feed.");

const publicSurface = `${publicJson}\n${feed}`;
const privateKeys = ["privateRationale", "attendanceUse", "programmingIdeas", "potentialCollaborators", "internalNotes"];
for (const key of privateKeys) {
  if (publicSurface.includes(key)) throw new Error(`Private Studio field ${key} leaked publicly.`);
}
const privateNotes = db.prepare(`
  SELECT private_rationale,attendance_use,programming_ideas,potential_collaborators,internal_notes
  FROM calendar_candidate_notes
`).all();
for (const note of privateNotes) {
  for (const value of Object.values(note)) {
    if (value && publicSurface.includes(value)) {
      throw new Error(`Private Studio note leaked publicly: ${value}`);
    }
  }
}

console.log({
  ...counts,
  privateNoteLeaks: leaked.n,
  publicEvents: publicPayload.events.length,
  atlantaIcsEvents: (feed.match(/BEGIN:VEVENT/g) || []).length,
  synergy,
});
