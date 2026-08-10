import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleAdminEventCreate,
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

test("0119 separates publication from operations and synchronizes Construct visibility", () => {
  const database = databaseThrough("0118_about_exhibitions_appearances.sql");
  database.exec(`
    INSERT INTO events(id,slug,title,status,created_at,updated_at)
    VALUES('event-private-draft','private-draft','Private draft','draft',datetime('now'),datetime('now'));
  `);
  database.exec(readFileSync(join(ROOT, "migrations", "0119_event_publication_state.sql"), "utf8"));

  const published = database.prepare("SELECT publication_state,status FROM events WHERE slug='signal-symbol'").get();
  const draft = database.prepare("SELECT publication_state,status FROM events WHERE slug='private-draft'").get();
  assert.deepEqual({ ...published }, { publication_state:"published", status:"open" });
  assert.deepEqual({ ...draft }, { publication_state:"draft", status:"closed" });

  database.prepare("UPDATE events SET publication_state='announced',updated_at=datetime('now') WHERE id='event-private-draft'").run();
  assert.deepEqual(
    { ...database.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='event-private-draft'").get() },
    { visibility:"public", search_visibility:1 },
  );

  database.exec(`INSERT INTO events(id,slug,title,created_at,updated_at) VALUES('event-new-default','new-default','New default',datetime('now'),datetime('now'));`);
  assert.deepEqual(
    { ...database.prepare("SELECT publication_state,status FROM events WHERE id='event-new-default'").get() },
    { publication_state:"draft", status:"closed" },
  );
});

test("public APIs expose Announced details but block every public action", async () => {
  const database = databaseThrough("0119_event_publication_state.sql");
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
  const database = databaseThrough("0119_event_publication_state.sql");
  const response = await handleAdminEventCreate(request("/api/admin/events", {
    method:"POST",
    admin:true,
    body:{ title:"Lifecycle Default" },
  }), runtime(database));
  assert.equal(response.status, 201);
  const event = (await response.json()).event;
  assert.equal(event.publicationState, "draft");
  assert.equal(event.status, "closed");
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
});
