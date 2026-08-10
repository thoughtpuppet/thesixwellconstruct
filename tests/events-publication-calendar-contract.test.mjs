import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleAdminEventCreate,
  handleAdminEventUpdate,
  handleEventCheckout,
  handleEventContext,
  handleEventOpenMicSignup,
  handleEventWaitlist,
  handleEventsList,
} from "../functions/api/events/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "events-publication-contract-token";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results:this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success:true, meta:{ changes:Number(result.changes || 0), last_row_id:Number(result.lastInsertRowid || 0) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

function migrations() {
  return readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort();
}

function databaseThrough(lastMigration = "") {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of migrations()) {
    if (lastMigration && name > lastMigration) break;
    database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function runtime(database) {
  return { SUBMISSIONS_DB:new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN:TOKEN };
}

function request(path, { method="GET", body, admin=false } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers:{ ...(body ? { "content-type":"application/json" } : {}), ...(admin ? { authorization:`Bearer ${TOKEN}` } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
}

test("0119 and 0120 separate publication from operations and retire legacy visibility triggers", () => {
  const database = databaseThrough("0118_about_exhibitions_appearances.sql");
  database.exec(`
    INSERT INTO events(id,slug,title,status,created_at,updated_at)
    VALUES('event-private-draft','private-draft','Private draft','draft',datetime('now'),datetime('now'));
  `);
  database.exec(readFileSync(join(ROOT, "migrations", "0119_event_publication_state.sql"), "utf8"));
  database.exec(readFileSync(join(ROOT, "migrations", "0120_event_publication_triggers.sql"), "utf8"));

  const published = database.prepare("SELECT publication_state,status FROM events WHERE slug='signal-symbol'").get();
  const draft = database.prepare("SELECT publication_state,status FROM events WHERE slug='private-draft'").get();
  assert.deepEqual({ ...published }, { publication_state:"published", status:"open" });
  assert.deepEqual({ ...draft }, { publication_state:"draft", status:"closed" });

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_connections_events_%'").get().count, 0);
});

test("0121 backfills dated events and gives SS&F a Studio-managed announced record", () => {
  const database = databaseThrough("0121_event_occurrences.sql");
  const signal = database.prepare("SELECT e.id,e.starts_at,o.id AS occurrence_id,o.starts_at AS occurrence_start FROM events e JOIN event_occurrences o ON o.event_id=e.id WHERE e.slug='signal-symbol'").get();
  assert.equal(signal.occurrence_id, `occ_${signal.id}`);
  assert.equal(signal.occurrence_start, signal.starts_at);
  assert.deepEqual(
    { ...database.prepare("SELECT publication_state,status,is_recurring,starts_at FROM events WHERE slug='ss-and-f-live-audience'").get() },
    { publication_state:"announced", status:"closed", is_recurring:0, starts_at:null },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='evt_ss_and_f_live_audience'").get() },
    { visibility:"public", search_visibility:1 },
  );
});

test("public APIs expose Announced details but block every public action", async () => {
  const database = databaseThrough("0121_event_occurrences.sql");
  database.prepare("UPDATE events SET publication_state='announced',status='open' WHERE slug='signal-symbol'").run();
  const env = runtime(database);

  const listResponse = await handleEventsList(request("/api/events"), env);
  const list = await listResponse.json();
  const announced = list.events.find((event) => event.slug === "signal-symbol");
  assert.equal(announced.publicationState, "announced");

  const contextResponse = await handleEventContext(request("/api/events/signal-symbol/context"), env, "signal-symbol");
  assert.equal(contextResponse.status, 200);
  assert.equal((await contextResponse.json()).event.publicationState, "announced");

  const contact = { name:"Event Person", email:"event@example.test", phone:"404-555-0100", seats:1 };
  assert.equal((await handleEventCheckout(request("/api/events/signal-symbol/checkout", { method:"POST", body:contact }), env, "signal-symbol")).status, 409);
  assert.equal((await handleEventWaitlist(request("/api/events/signal-symbol/waitlist", { method:"POST", body:contact }), env, "signal-symbol")).status, 409);
  assert.equal((await handleEventOpenMicSignup(request("/api/events/signal-symbol/open-mic", { method:"POST", body:{ performerName:contact.name, performerEmail:contact.email, performerPhone:contact.phone } }), env, "signal-symbol")).status, 409);

  database.prepare("UPDATE events SET publication_state='draft' WHERE slug='signal-symbol'").run();
  assert.equal((await handleEventContext(request("/api/events/signal-symbol/context"), env, "signal-symbol")).status, 404);
});

test("admin event creation defaults to Draft and Closed", async () => {
  const database = databaseThrough("0121_event_occurrences.sql");
  const response = await handleAdminEventCreate(request("/api/admin/events", {
    method:"POST",
    admin:true,
    body:{ title:"Lifecycle Default" },
  }), runtime(database));
  assert.equal(response.status, 201);
  const event = (await response.json()).event;
  assert.equal(event.publicationState, "draft");
  assert.equal(event.status, "closed");
  assert.deepEqual(
    { ...database.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id=?").get(event.id) },
    { visibility:"internal", search_visibility:0 },
  );

  const updateResponse = await handleAdminEventUpdate(request(`/api/admin/events/${event.slug}`, {
    method:"PATCH",
    admin:true,
    body:{ publicationState:"announced" },
  }), runtime(database), event.slug);
  assert.equal(updateResponse.status, 200, await updateResponse.clone().text());
  assert.deepEqual(
    { ...database.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id=?").get(event.id) },
    { visibility:"public", search_visibility:1 },
  );
});

test("recurring event dates keep independent operations, capacity, and reservations", async () => {
  const database = databaseThrough("0121_event_occurrences.sql");
  const env = runtime(database);
  const createResponse = await handleAdminEventCreate(request("/api/admin/events", {
    method:"POST",
    admin:true,
    body:{
      title:"Recurring Studio Night",
      publicationState:"published",
      priceCents:0,
      isRecurring:true,
      occurrences:[
        { startsAt:"2030-09-07T23:00:00.000Z", endsAt:"2030-09-08T01:00:00.000Z", location:"Room One", capacity:2, maxSeatsPerOrder:2, status:"open" },
        { startsAt:"2030-09-14T23:00:00.000Z", endsAt:"2030-09-15T01:00:00.000Z", location:"Room Two", capacity:1, maxSeatsPerOrder:1, status:"open" },
      ],
    },
  }), env);
  assert.equal(createResponse.status, 201, await createResponse.clone().text());
  const created = (await createResponse.json()).event;
  assert.equal(created.isRecurring, true);
  assert.equal(created.occurrences.length, 2);
  assert.deepEqual(created.occurrences.map((item) => item.capacity), [2, 1]);

  const list = await (await handleEventsList(request("/api/events"), env)).json();
  const recurring = list.events.find((event) => event.slug === "recurring-studio-night");
  assert.equal(recurring.occurrenceCount, 2);
  assert.deepEqual(recurring.occurrences.map((item) => item.location), ["Room One", "Room Two"]);

  const contact = { name:"Recurring Guest", email:"recurring@example.test", phone:"404-555-0110" };
  const missingDate = await handleEventCheckout(request("/api/events/recurring-studio-night/checkout", { method:"POST", body:{ ...contact, seats:1 } }), env, recurring.slug);
  assert.equal(missingDate.status, 400);
  assert.equal((await missingDate.json()).occurrenceRequired, true);

  const firstDate = recurring.occurrences[0];
  const secondDate = recurring.occurrences[1];
  const selectedContext = await (await handleEventContext(request(`/api/events/recurring-studio-night/context?occurrence=${firstDate.id}`), env, recurring.slug)).json();
  assert.equal(selectedContext.occurrence.id, firstDate.id);
  assert.equal(selectedContext.occurrence.capacity, 2);
  assert.equal((await handleEventCheckout(request("/api/events/recurring-studio-night/checkout", { method:"POST", body:{ ...contact, seats:2, occurrenceId:firstDate.id } }), env, recurring.slug)).status, 200);
  assert.equal((await handleEventCheckout(request("/api/events/recurring-studio-night/checkout", { method:"POST", body:{ ...contact, seats:1, occurrenceId:firstDate.id } }), env, recurring.slug)).status, 409);
  assert.equal((await handleEventCheckout(request("/api/events/recurring-studio-night/checkout", { method:"POST", body:{ ...contact, seats:1, occurrenceId:secondDate.id } }), env, recurring.slug)).status, 200);

  const reservations = database.prepare("SELECT occurrence_id,seats,status FROM event_tickets WHERE event_id=? ORDER BY created_at").all(created.id);
  assert.deepEqual(reservations.map((row) => ({ occurrence_id:row.occurrence_id, seats:row.seats, status:row.status })), [
    { occurrence_id:firstDate.id, seats:2, status:"paid" },
    { occurrence_id:secondDate.id, seats:1, status:"paid" },
  ]);
});

test("Events board contracts retain the shared shell, 5px cards, calendar, and state actions", () => {
  const page = readFileSync(join(ROOT, "events", "index.html"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(page, /href="\/css\/booking-calendar\.css"/);
  assert.match(page, /\.event-card\s*\{[\s\S]*?border:5px solid var\(--ring-faint\)/);
  assert.match(page, /\.event-card:hover,\.event-card:focus-within\s*\{\s*border-color:var\(--color-events\)/);
  assert.match(page, /Upcoming Events[\s\S]*Event Calendar[\s\S]*Past Events/);
  for (const label of ["Announced", "Reserve a seat", "RSVP", "Sold out", "Booking closed", "Cancelled", "View event"]) assert.match(page, new RegExp(label, "i"));
  assert.match(page, /has-multiple[\s\S]*event-day-agenda/);
  assert.match(studio, /Public stage[\s\S]*Event operations/);
  assert.match(studio, /\["draft", "announced", "published"\]/);
  assert.match(studio, /Recurring event[\s\S]*Event dates[\s\S]*Add date/);
  assert.match(page, /function eventHref\(ev, occurrence\)[\s\S]*occurrence\.id/);
  assert.match(page, /occurrencesForEvent\(ev\)\.forEach/);
  assert.match(readFileSync(join(ROOT, "events", "detail", "index.html"), "utf8"), /occurrenceId:selected\.id/);
  assert.match(readFileSync(join(ROOT, "_worker.js"), "utf8"), /bespokeEventPage\.status !== 404[\s\S]*events\/detail\/index\.html/);
});

test("SS&F bespoke event page activates the shared entrance transition", () => {
  const page = readFileSync(join(ROOT, "events", "ss-and-f-live-audience", "index.html"), "utf8");
  assert.match(page, /class="venture-shell entrance-fade"/);
  assert.match(page, /<script src="\/js\/transition\.js"><\/script>/);
  assert.match(page, /api\/events\/ss-and-f-live-audience\/context/);
});
