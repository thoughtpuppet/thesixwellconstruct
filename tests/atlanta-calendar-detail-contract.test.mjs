import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import worker from "../_worker.js";
import { handleCalendarAdminApi, handleCalendarPublicApi } from "../functions/api/calendar/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "calendar-detail-contract-token";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results:this.database.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success:true, meta:{ changes:Number(result.changes || 0) } }; }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((item) => item.endsWith(".sql") && !["0147_calendar_creative_scout_import.sql", "0160_atlanta_fall_2026_arts_preview.sql", "0162_calendar_latest_creative_scout_strong_picks.sql"].includes(item)).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function environment(db) {
  return {
    SUBMISSIONS_DB:new LocalD1(db),
    SUBMISSIONS_ADMIN_TOKEN:TOKEN,
    PUBLIC_SITE_URL:"https://example.test",
    ASSETS:{
      async fetch(assetRequest) {
        const pathname = new URL(assetRequest.url).pathname;
        const file = join(ROOT, ...pathname.split("/").filter(Boolean));
        try {
          return new Response(readFileSync(file), { status:200, headers:{ "content-type":pathname.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
        } catch {
          return new Response("not found", { status:404, headers:{ "content-type":"text/plain; charset=utf-8" } });
        }
      },
    },
  };
}

function request(path, { method="GET", body, admin=false } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers:{ ...(body === undefined ? {} : { "content-type":"application/json" }), ...(admin ? { authorization:`Bearer ${TOKEN}` } : {}) },
    body:body === undefined ? undefined : JSON.stringify(body),
  });
}

async function admin(env, path, options = {}) {
  return handleCalendarAdminApi(request(`/api/admin/calendar${path}`, { ...options, admin:true }), env);
}

test("approved curated records expose canonical detail APIs, routes, metadata, and relationships", async () => {
  const db = database();
  const env = environment(db);
  const createdResponse = await admin(env, "/candidates", {
    method:"POST",
    body:{
      title:"Canonical Atlanta Sound Series",
      factualDescription:"A public sound series with one related performance.",
      eventStructure:"series",
      dateKind:"timed",
      startsAt:"2026-10-05T19:00:00-04:00",
      endsAt:"2026-10-05T21:00:00-04:00",
      timezone:"America/New_York",
      organizer:"Atlanta Sound Room",
      sourceUrl:"https://sound.example/canonical-series",
      organizerUrl:"https://sound.example/canonical-series",
      sourceAuthority:"organizer_event",
      venueName:"Atlanta Sound Room",
      venueAddress:"100 Sound Way, Atlanta, GA",
      city:"Atlanta",
      region:"GA",
      accessStatus:"public",
      audiences:["Public"],
      subjects:["poetry-music"],
      formats:["performance"],
      verificationState:"verified",
      occurrences:[{
        occurrenceType:"performance",
        title:"Opening Performance",
        factualDescription:"The opening performance in the series.",
        sourceUrl:"https://sound.example/canonical-series/opening",
        dateKind:"timed",
        startsAt:"2026-10-05T19:00:00-04:00",
        endsAt:"2026-10-05T21:00:00-04:00",
        timezone:"America/New_York",
        venueName:"Atlanta Sound Room",
        venueAddress:"100 Sound Way, Atlanta, GA",
        accessStatus:"public",
        audiences:["Public"],
        verificationState:"verified",
      }],
    },
  });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const candidate = (await createdResponse.json()).candidate;
  const approval = await admin(env, `/candidates/${candidate.id}/approve`, { method:"POST", body:{} });
  assert.equal(approval.status, 200, await approval.clone().text());
  db.exec(`
    INSERT INTO events(id,slug,title,description,location,status,publication_state,is_recurring,created_at,updated_at)
    VALUES('evt_detail_owned','owned-detail','Owned Detail Event','A Six.Well-owned event.','Atlanta, GA','closed','published',0,datetime('now'),datetime('now'));
    INSERT INTO event_occurrences(id,event_id,starts_at,ends_at,location,status,sort_order,created_at,updated_at)
    VALUES('occ_detail_owned','evt_detail_owned','2026-10-06T19:00:00-04:00','2026-10-06T21:00:00-04:00','Atlanta, GA','closed',0,datetime('now'),datetime('now'));
    INSERT INTO calendar_event_metadata(event_id,subjects_json,formats_json,updated_at)
    VALUES('evt_detail_owned','["art"]','["performance"]',datetime('now'));
  `);

  const listResponse = await handleCalendarPublicApi(request("/api/calendar/events"), env);
  const list = await listResponse.json();
  const series = list.series.find((item) => item.title === "Canonical Atlanta Sound Series");
  const occurrence = list.events.find((item) => item.title.includes("Opening Performance"));
  assert.match(series.detailUrl, /^\/calendar\/events\/canonical-atlanta-sound-series--curated%3A/);
  assert.match(occurrence.detailUrl, /^\/calendar\/events\/canonical-atlanta-sound-series-opening-performance--curated-occurrence%3A/);
  assert.equal(occurrence.parentDetailUrl, series.detailUrl);
  assert.equal(series.relatedOccurrences[0].detailUrl, occurrence.detailUrl);
  const owned = list.events.find((item) => item.id === "sixwell:occ_detail_owned");
  assert.equal(owned.detailUrl, "/events/owned-detail/?occurrence=occ_detail_owned");

  const detailResponse = await handleCalendarPublicApi(request(`/api/calendar/events/${encodeURIComponent(occurrence.id)}`), env);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).event;
  assert.equal(detail.id, occurrence.id);
  assert.equal(detail.parentDetailUrl, series.detailUrl);
  assert.doesNotMatch(JSON.stringify(detail), /verification|provenance|privateRationale|sourceEventId|candidateId/i);
  assert.equal((await handleCalendarPublicApi(request(`/api/calendar/events/${encodeURIComponent(occurrence.id)}`, { method:"POST" }), env)).status, 405);
  assert.equal((await handleCalendarPublicApi(request("/api/calendar/events/curated%3Amissing"), env)).status, 404);
  assert.equal((await handleCalendarPublicApi(request(`/api/calendar/events/${encodeURIComponent(occurrence.id)}.ics`), env)).status, 200);

  const page = await worker.fetch(new Request(`https://example.test${occurrence.detailUrl}`), env, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title data-calendar-event-title>Canonical Atlanta Sound Series — Opening Performance · Atlanta Calendar · the six\.well construct<\/title>/);
  assert.match(html, new RegExp(`href="https://example\\.test${occurrence.detailUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, new RegExp(`"id":"${occurrence.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(html, /verificationNotes|privateRationale|sourceEventId/);

  const withoutSlash = await worker.fetch(new Request(`https://example.test${occurrence.detailUrl.slice(0, -1)}`), env, {});
  assert.equal(withoutSlash.status, 308);
  assert.equal(withoutSlash.headers.get("location"), `https://example.test${occurrence.detailUrl}`);
  const staleSlug = occurrence.detailUrl.replace("canonical-atlanta-sound-series-opening-performance", "old-title");
  const stale = await worker.fetch(new Request(`https://example.test${staleSlug}`), env, {});
  assert.equal(stale.status, 308);
  assert.equal(stale.headers.get("location"), `https://example.test${occurrence.detailUrl}`);
  assert.equal((await worker.fetch(new Request("https://example.test/calendar/events/missing--curated%3Amissing/"), env, {})).status, 404);
  const ownedRedirect = await worker.fetch(new Request("https://example.test/calendar/events/owned-detail-event--sixwell%3Aocc_detail_owned/"), env, {});
  assert.equal(ownedRedirect.status, 308);
  assert.equal(ownedRedirect.headers.get("location"), "https://example.test/events/owned-detail/?occurrence=occ_detail_owned");
});

test("calendar detail UI keeps titles plain and replaces new in-page event anchors", () => {
  const calendar = readFileSync(join(ROOT, "js", "atlanta-calendar.js"), "utf8");
  const record = readFileSync(join(ROOT, "js", "atlanta-calendar-record.js"), "utf8");
  const detail = readFileSync(join(ROOT, "js", "atlanta-calendar-detail.js"), "utf8");
  const html = readFileSync(join(ROOT, "calendar", "event", "index.html"), "utf8");
  const css = readFileSync(join(ROOT, "css", "atlanta-calendar.css"), "utf8");
  assert.match(record, /data-calendar-detail-link>View event<\/a>/);
  assert.match(record, /headingTag \+ \(options\.detail/);
  assert.doesNotMatch(record, /<h3><a/);
  assert.match(calendar, /calendar-day-agenda-item/);
  assert.match(calendar, /data-calendar-detail-link>View event<\/a>/);
  assert.doesNotMatch(calendar, /data-calendar-event-link/);
  assert.match(calendar, /atlanta-calendar-return-state-v1/);
  assert.match(calendar, /selectedDate:selectedDate/);
  assert.match(calendar, /subjects:checkedValues\(subjectRoot\)/);
  assert.match(calendar, /scrollY:Math\.max/);
  assert.match(calendar, /else syncFromHash\(\)/);
  assert.match(record, /data-share-url=/);
  assert.match(detail, /Back to your calendar view/);
  assert.match(html, /data-calendar-event-canonical/);
  assert.match(html, /data-calendar-event-og-title/);
  assert.match(html, /atlanta-calendar-record\.js\?v=20260821-calendar-event-pages/);
  assert.match(css, /\.calendar-day-agenda-item>a \{ min-height:44px/);
  assert.match(css, /\.calendar-event-detail-record/);
});
