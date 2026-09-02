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
  handleEventTicketCalendar,
  handleEventOpenMicSignup,
  handleEventWaitlist,
  handleEventsList,
} from "../functions/api/events/_lib.js";
import { sendDueEventTicketReminders } from "../functions/api/notifications/_lib.js";
import {
  buildEventReminderEmail,
  buildEventTicketPaidEmail,
} from "../functions/api/notifications/_email-templates.js";

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
  const database = databaseThrough();
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
  const database = databaseThrough();
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
  assert.deepEqual(
    { ...database.prepare("SELECT entity_id,archive_slug,state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(event.id) },
    { entity_id:event.id, archive_slug:"lifecycle-default", state:"draft", public_visible:0, published_at:null },
  );
  assert.ok(database.prepare("SELECT event_id FROM archive_event_identifiers WHERE entity_id=?").get(event.id)?.event_id);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_catalogue_entries WHERE entity_id=?").get(event.id).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id=?").get(event.id).count, 0);

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
  assert.deepEqual(
    { ...database.prepare("SELECT state,public_visible,published_at FROM archive_dossiers WHERE entity_id=?").get(event.id) },
    { state:"draft", public_visible:0, published_at:null },
  );
});

test("recurring event dates keep independent operations, capacity, and reservations", async () => {
  const database = databaseThrough();
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
        { sessionNumber:"01", title:"Opening Study", startsAt:"2030-09-07T23:00:00.000Z", endsAt:"2030-09-08T01:00:00.000Z", location:"Room One", capacity:2, maxSeatsPerOrder:2, status:"open" },
        { sessionNumber:"02", title:"Closing Study", startsAt:"2030-09-14T23:00:00.000Z", endsAt:"2030-09-15T01:00:00.000Z", location:"Room Two", capacity:1, maxSeatsPerOrder:1, status:"open" },
      ],
    },
  }), env);
  assert.equal(createResponse.status, 201, await createResponse.clone().text());
  const created = (await createResponse.json()).event;
  assert.equal(created.isRecurring, true);
  assert.equal(created.occurrences.length, 2);
  assert.deepEqual(created.occurrences.map((item) => item.capacity), [2, 1]);
  assert.deepEqual(created.occurrences.map((item) => [item.sessionNumber,item.title,item.displayTitle]), [
    ["01","Opening Study","Recurring Studio Night 01: Opening Study"],
    ["02","Closing Study","Recurring Studio Night 02: Closing Study"],
  ]);

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

test("0127 creates SOLEHMAN'S NEW YEAR I as one draft event with session-specific admission", async () => {
  const database = databaseThrough();
  const event = database.prepare(
    "SELECT title,publication_state,status,starts_at,ends_at,is_recurring FROM events WHERE slug='solehmans-new-year'"
  ).get();
  assert.deepEqual({ ...event }, {
    title:"SOLEHMAN'S NEW YEAR I",
    publication_state:"draft",
    status:"closed",
    starts_at:"2027-10-15T19:00:00-04:00",
    ends_at:"2027-10-18T23:00:00-04:00",
    is_recurring:1,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM event_occurrences WHERE event_id='evt_solehmans_new_year_i'").get().count, 4);

  const options = database.prepare(
    `SELECT slug,price_cents,capacity,registration_status,attendance_mode
     FROM event_admission_options WHERE event_id='evt_solehmans_new_year_i'
     ORDER BY sort_order`
  ).all();
  assert.equal(options.length, 8);
  assert.deepEqual({ ...options.find((option) => option.slug === "live-tattoo-in-person") }, {
    slug:"live-tattoo-in-person", price_cents:10000, capacity:12, registration_status:"closed", attendance_mode:"in_person",
  });
  assert.deepEqual({ ...options.find((option) => option.slug === "live-tattoo-virtual") }, {
    slug:"live-tattoo-virtual", price_cents:5000, capacity:null, registration_status:"closed", attendance_mode:"virtual",
  });
  assert.deepEqual({ ...options.find((option) => option.slug === "tattoo-party") }, {
    slug:"tattoo-party", price_cents:6000, capacity:10, registration_status:"closed", attendance_mode:"in_person",
  });
  assert.equal(options.filter((option) => option.price_cents === 0 && option.registration_status === "open").length, 5);
  assert.deepEqual(
    { ...database.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='evt_solehmans_new_year_i'").get() },
    { visibility:"internal", search_visibility:0 },
  );

  database.prepare("UPDATE events SET publication_state='published' WHERE id='evt_solehmans_new_year_i'").run();
  const env = runtime(database);
  const contextResponse = await handleEventContext(
    request("/api/events/solehmans-new-year/context"),
    env,
    "solehmans-new-year",
  );
  assert.equal(contextResponse.status, 200, await contextResponse.clone().text());
  const context = await contextResponse.json();
  assert.equal(context.event.admissionOptions.length, 8);
  assert.equal(context.event.registrationOpen, true);
  assert.equal(context.event.paidSalesOpen, false);
  assert.equal(context.event.location, "art.pill Tattoo House, Castleberry Hill, Atlanta");
  assert.match(context.event.venueLocation, /364 Nelson Street SW, Atlanta, GA 30313/);

  const revisedAdmissions = context.event.admissionOptions.map((option) => ({
    ...option,
    startsAt:option.id === "adm_sny_i_artist_talk" ? "2027-10-17T16:00:00-04:00" : option.startsAt,
  }));
  const admissionUpdate = await handleAdminEventUpdate(request("/api/admin/events/solehmans-new-year", {
    method:"PATCH",
    admin:true,
    body:{ admissionOptions:revisedAdmissions },
  }), env, "solehmans-new-year");
  assert.equal(admissionUpdate.status, 200, await admissionUpdate.clone().text());
  assert.equal(
    database.prepare("SELECT starts_at FROM event_admission_options WHERE id='adm_sny_i_artist_talk'").get().starts_at,
    "2027-10-17T16:00:00-04:00",
  );

  const contact = { name:"Annual Guest", email:"annual@example.test", phone:"404-555-0130", seats:1 };
  const rsvp = await handleEventCheckout(request("/api/events/solehmans-new-year/checkout", {
    method:"POST",
    body:{ ...contact, admissionOptionId:"adm_sny_i_artist_talk" },
  }), env, "solehmans-new-year");
  assert.equal(rsvp.status, 200, await rsvp.clone().text());
  const savedRsvp = database.prepare(
    "SELECT admission_option_id,occurrence_id,amount_cents,status FROM event_tickets WHERE contact_email=?"
  ).get(contact.email);
  assert.deepEqual({ ...savedRsvp }, {
    admission_option_id:"adm_sny_i_artist_talk",
    occurrence_id:"occ_sny_i_2027_10_17",
    amount_cents:0,
    status:"paid",
  });
  const calendar = await handleEventTicketCalendar(
    request("/api/events/tickets/calendar-admission"),
    env,
    database.prepare("SELECT id FROM event_tickets WHERE contact_email=?").get(contact.email).id,
  );
  assert.equal(calendar.status, 200);
  const calendarText = await calendar.text();
  assert.match(calendarText, /SUMMARY:SOLEHMAN'S NEW YEAR I — Artist Talk \+ Creative Ecosystem Showing \+ Closing/);
  assert.match(calendarText, /DTSTART:20271017T200000Z/);

  const paidClosed = await handleEventCheckout(request("/api/events/solehmans-new-year/checkout", {
    method:"POST",
    body:{ ...contact, admissionOptionId:"adm_sny_i_live_in_person" },
  }), env, "solehmans-new-year");
  assert.equal(paidClosed.status, 409);

  database.prepare("UPDATE event_admission_options SET registration_status='open' WHERE id='adm_sny_i_live_in_person'").run();
  const paidWithoutSquare = await handleEventCheckout(request("/api/events/solehmans-new-year/checkout", {
    method:"POST",
    body:{ ...contact, admissionOptionId:"adm_sny_i_live_in_person" },
  }), env, "solehmans-new-year");
  assert.equal(paidWithoutSquare.status, 503);
});

test("event reminders follow the selected admission time and title", async () => {
  const database = databaseThrough();
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  database.prepare(
    "UPDATE event_admission_options SET starts_at=?,registration_status='open' WHERE id='adm_sny_i_artist_talk'"
  ).run(startsAt);
  database.prepare(
    `INSERT INTO event_tickets (
      id,event_id,occurrence_id,admission_option_id,contact_name,contact_email,contact_phone,
      seats,amount_cents,currency,status,created_at,updated_at
    ) VALUES ('reminder-admission-ticket','evt_solehmans_new_year_i','occ_sny_i_2027_10_17',
      'adm_sny_i_artist_talk','Reminder Guest','reminder@example.test','404-555-0199',
      1,0,'USD','paid',datetime('now'),datetime('now'))`
  ).run();
  const sent = [];
  const result = await sendDueEventTicketReminders({
    SUBMISSIONS_DB:new LocalD1(database),
    EMAIL:{ async send(message) { sent.push(message); return { messageId:"event-reminder-1" }; } },
    PUBLIC_SITE_URL:"https://example.test",
    NOTIFICATION_FROM_EMAIL:"notifications@example.test",
  });
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /SOLEHMAN'S NEW YEAR I/);
  assert.match(sent[0].subject, /Artist Talk/);
  assert.ok(database.prepare("SELECT reminder_sent_at FROM event_tickets WHERE id='reminder-admission-ticket'").get().reminder_sent_at);
});

test("0220 consolidates the existing KINMARKING editions under one preserved Event identity", () => {
  const database = databaseThrough("0219_atl_creative_calendar_navigation.sql");
  const records = [
    ["evt_kin_01","kinmarking-01-skin-as-archive","KINMARKING 01: Skin As Archive","2026-11-21T19:00:00.000Z","2026-11-22T00:00:00.000Z","occ_kin_01"],
    ["evt_kin_02","kinmarking-02","KINMARKING 02","2027-03-20T18:00:00.000Z","2027-03-20T23:00:00.000Z","occ_kin_02"],
    ["evt_kin_03","kinmarking-03","KINMARKING 03","2027-07-17T18:00:00.000Z","2027-07-17T23:00:00.000Z","occ_kin_03"],
    ["evt_kin_04","kinmarking-04","KINMARKING 04","2027-11-20T19:00:00.000Z","2027-11-21T00:00:00.000Z","occ_kin_04"],
  ];
  for (const [id,slug,title,startsAt,endsAt,occurrenceId] of records) {
    database.prepare(
      `INSERT INTO events(id,slug,title,description,starts_at,ends_at,location,price_cents,currency,capacity,max_seats_per_order,status,publication_state,image_url,waitlist_enabled,is_recurring,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'art.pill Tattoo House',0,'USD',0,1,'closed','announced','',0,0,?,?)`
    ).run(id,slug,title,slug === "kinmarking-01-skin-as-archive" ? "First edition" : "Theme to be announced.",startsAt,endsAt,"2026-09-01T00:00:00.000Z","2026-09-01T00:00:00.000Z");
    database.prepare(
      `INSERT INTO event_occurrences(id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,sort_order,created_at,updated_at)
       VALUES(?,?,?,?,?,0,1,'closed',0,?,?)`
    ).run(occurrenceId,id,startsAt,endsAt,"art.pill Tattoo House","2026-09-01T00:00:00.000Z","2026-09-01T00:00:00.000Z");
    database.prepare(
      `INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
       VALUES(?,'event','node-events','public',1,'test','test',?,?)`
    ).run(id,"2026-09-01T00:00:00.000Z","2026-09-01T00:00:00.000Z");
  }

  database.exec(readFileSync(join(ROOT, "migrations", "0220_kinmarking_series_sessions.sql"), "utf8"));
  assert.deepEqual({ ...database.prepare("SELECT id,slug,title,is_recurring,publication_state,status FROM events WHERE slug='kinmarking'").get() }, {
    id:"evt_kin_01", slug:"kinmarking", title:"KINMARKING", is_recurring:1, publication_state:"announced", status:"closed",
  });
  assert.deepEqual(
    database.prepare("SELECT event_id,session_number,title,sort_order FROM event_occurrences WHERE event_id='evt_kin_01' ORDER BY sort_order").all().map((row) => ({ ...row })),
    [
      { event_id:"evt_kin_01", session_number:"01", title:"Skin As Archive", sort_order:0 },
      { event_id:"evt_kin_01", session_number:"02", title:"", sort_order:1 },
      { event_id:"evt_kin_01", session_number:"03", title:"", sort_order:2 },
      { event_id:"evt_kin_01", session_number:"04", title:"", sort_order:3 },
    ],
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM events WHERE slug LIKE 'kinmarking-%'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM content_entities WHERE id IN ('evt_kin_02','evt_kin_03','evt_kin_04')").get().count, 0);
  assert.equal(database.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id='evt_kin_01'").get().archive_slug, "kinmarking");
});

test("KINMARKING is one announced and closed Studio event with four named sessions", async () => {
  const database = databaseThrough();
  const env = runtime(database);
  const location = "art.pill Tattoo House, 364 Nelson Street SW, Atlanta, GA 30313";
  const sessions = [
    { sessionNumber:"01", title:"Skin As Archive", startsAt:"2026-11-21T14:00:00-05:00", endsAt:"2026-11-21T19:00:00-05:00" },
    { sessionNumber:"02", title:"", startsAt:"2027-03-20T14:00:00-04:00", endsAt:"2027-03-20T19:00:00-04:00" },
    { sessionNumber:"03", title:"", startsAt:"2027-07-17T14:00:00-04:00", endsAt:"2027-07-17T19:00:00-04:00" },
    { sessionNumber:"04", title:"", startsAt:"2027-11-20T14:00:00-05:00", endsAt:"2027-11-20T19:00:00-05:00" },
  ];
  const response = await handleAdminEventCreate(request("/api/admin/events", {
    method:"POST",
    admin:true,
    body:{
      title:"KINMARKING",
      slug:"kinmarking",
      description:"A participatory memory, archive, and tattoo practice.",
      publicationState:"announced",
      status:"closed",
      location,
      priceCents:0,
      capacity:0,
      maxSeatsPerOrder:1,
      waitlistEnabled:false,
      isRecurring:true,
      imageUrl:"",
      occurrences:sessions.map((session) => ({ ...session, location, capacity:0, maxSeatsPerOrder:1, status:"closed" })),
    },
  }), env);
  assert.equal(response.status, 201, await response.clone().text());

  const row = database.prepare(
    `SELECT slug,title,publication_state,status,is_recurring,image_url,waitlist_enabled,max_seats_per_order
     FROM events WHERE slug='kinmarking'`
  ).get();
  assert.deepEqual({ ...row }, {
    slug:"kinmarking", title:"KINMARKING", publication_state:"announced", status:"closed",
    is_recurring:1, image_url:"", waitlist_enabled:0, max_seats_per_order:1,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM event_occurrences WHERE event_id=(SELECT id FROM events WHERE slug='kinmarking') AND capacity=0 AND max_seats_per_order=1 AND status='closed'").get().count, 4);

  const publicList = await (await handleEventsList(request("/api/events"), env)).json();
  const kinmarking = publicList.events.find((event) => event.slug === "kinmarking");
  assert.ok(kinmarking);
  assert.deepEqual(kinmarking.occurrences.map((occurrence) => [occurrence.sessionNumber,occurrence.title,occurrence.displayTitle]), [
    ["01","Skin As Archive","KINMARKING 01: Skin As Archive"],
    ["02","","KINMARKING 02"],
    ["03","","KINMARKING 03"],
    ["04","","KINMARKING 04"],
  ]);
  const blocked = await handleEventCheckout(request("/api/events/kinmarking/checkout", {
    method:"POST",
    body:{ name:"Archive Guest", email:"archive@example.test", phone:"404-555-0123", seats:1, occurrenceId:kinmarking.occurrences[0].id },
  }), env, "kinmarking");
  assert.equal(blocked.status, 409);
});

test("KINMARKING session reminders use the composed session title and preparation guide", async () => {
  const database = databaseThrough();
  const env = runtime(database);
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const response = await handleAdminEventCreate(request("/api/admin/events", {
    method:"POST",
    admin:true,
    body:{
      title:"KINMARKING",
      slug:"kinmarking",
      publicationState:"published",
      status:"open",
      priceCents:0,
      maxSeatsPerOrder:1,
      waitlistEnabled:false,
      isRecurring:true,
      occurrences:[{ sessionNumber:"01", title:"Skin As Archive", startsAt, location:"art.pill Tattoo House", capacity:0, maxSeatsPerOrder:1, status:"open" }],
    },
  }), env);
  assert.equal(response.status, 201, await response.clone().text());
  const event = (await response.json()).event;
  database.prepare(
    `INSERT INTO event_tickets (
      id,event_id,occurrence_id,contact_name,contact_email,contact_phone,
      seats,amount_cents,currency,status,created_at,updated_at
    ) VALUES ('kinmarking-reminder-ticket',?,?, 'Archive Guest','archive@example.test','404-555-0123',
      1,0,'USD','paid',datetime('now'),datetime('now'))`
  ).run(event.id,event.occurrences[0].id);
  const sent = [];
  const result = await sendDueEventTicketReminders({
    SUBMISSIONS_DB:new LocalD1(database),
    EMAIL:{ async send(message) { sent.push(message); return { messageId:"kinmarking-reminder-1" }; } },
    PUBLIC_SITE_URL:"https://example.test",
    NOTIFICATION_FROM_EMAIL:"notifications@example.test",
  });
  assert.equal(result.sent, 1);
  assert.match(sent[0].subject, /KINMARKING 01: Skin As Archive/);
  assert.match(sent[0].text, /Event guide/);
  assert.match(sent[0].text, /one to three references/i);
  assert.doesNotMatch(sent[0].text, /ticket purchased|confirmed and paid/i);
});

test("free event correspondence uses RSVP language and links the preparation guide", () => {
  const confirmation = buildEventTicketPaidEmail({
    free:true,
    title:"KINMARKING 01: Skin As Archive",
    clientName:"Archive Guest",
    seats:"1",
    when:"Saturday, November 21, 2026 at 2:00 PM EST",
    where:"art.pill Tattoo House",
    ticketUrl:"https://example.test/events/confirmed/",
    calendarUrl:"https://example.test/calendar.ics",
    eventUrl:"https://example.test/events/kinmarking-01-skin-as-archive/",
    preparationNote:"Review the event guide. An RSVP does not reserve tattoo time.",
    subject:"RSVP confirmed — KINMARKING 01: Skin As Archive",
  });
  assert.match(confirmation.text, /Your RSVP is confirmed/);
  assert.match(confirmation.text, /Event guide/);
  assert.match(confirmation.text, /does not reserve tattoo time/);
  assert.doesNotMatch(confirmation.text, /confirmed and paid|ticket purchased/i);

  const reminder = buildEventReminderEmail({
    title:"KINMARKING 01: Skin As Archive",
    clientName:"Archive Guest",
    when:"Saturday, November 21, 2026 at 2:00 PM EST",
    where:"art.pill Tattoo House",
    seats:"1",
    calendarUrl:"https://example.test/calendar.ics",
    eventUrl:"https://example.test/events/kinmarking-01-skin-as-archive/",
    preparationNote:"Bring one to three references. Same-day tattooing is not guaranteed.",
    subject:"Reminder: KINMARKING 01 is tomorrow",
  });
  assert.match(reminder.text, /Event guide/);
  assert.match(reminder.text, /Bring one to three references/);
  assert.doesNotMatch(reminder.text, /paid|ticket purchased/i);
});

test("KINMARKING public pages retain the event shell, conditional flyer, guidance, and connected editions", () => {
  const hub = readFileSync(join(ROOT, "events", "kinmarking", "index.html"), "utf8");
  const detail = readFileSync(join(ROOT, "events", "detail", "index.html"), "utf8");
  const series = readFileSync(join(ROOT, "js", "kinmarking-series.js"), "utf8");
  assert.match(hub, /class="venture-hero site-hero site-hero--supporting"/);
  assert.match(hub, /html,body \{ background:var\(--color-bg\); \}/);
  assert.match(hub, /border:5px solid/);
  assert.match(hub, /Every four months/);
  assert.match(detail, /id="kinmarkingFlyer" hidden/);
  assert.match(detail, /\.event-form\[hidden\][\s\S]*display:none !important/);
  assert.match(detail, /event\.imageUrl[\s\S]*kinmarkingFlyer\.hidden = false/);
  assert.match(detail, /What to bring[\s\S]*How it works[\s\S]*Possible outcomes[\s\S]*Privacy \+ consent[\s\S]*RSVP \+ walk-ins/);
  assert.match(detail, /if \(isKinmarking\) form\.hidden = true/);
  assert.match(series, /kinmarking-01-skin-as-archive[\s\S]*kinmarking-02[\s\S]*kinmarking-03[\s\S]*kinmarking-04/);
  assert.match(series, /SERIES_SLUG = "kinmarking"/);
  assert.match(series, /parent\.occurrences/);
  assert.match(detail, /apiSlug = isKinmarking \? kinmarking\.seriesSlug : slug/);
  assert.match(series, /aria-current="page"/);
});

test("Events board contracts retain the shared shell, 5px cards, calendar, and state actions", () => {
  const page = readFileSync(join(ROOT, "events", "index.html"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(page, /href="\/css\/booking-calendar\.css"/);
  assert.match(page, /\.event-card\s*\{[\s\S]*?border:5px solid var\(--ring-faint\)/);
  assert.match(page, /\.event-card:hover,\.event-card:focus-within\s*\{\s*border-color:var\(--color-events\)/);
  assert.match(page, /Upcoming Events[\s\S]*Event Calendar[\s\S]*Past Events/);
  for (const label of ["Announced", "Reserve a seat", "RSVP", "Sold out", "Booking closed", "Cancelled", "View event"]) assert.match(page, new RegExp(label, "i"));
  assert.match(page, /href="\/events\/kinmarking\/">KINMARKING series<\/a>/);
  assert.match(page, /Announced<\/button><a class="event-action is-secondary" href="' \+ href \+ '">View event<\/a>/);
  assert.match(page, /has-multiple[\s\S]*event-day-agenda/);
  assert.match(studio, /Public stage[\s\S]*Event operations/);
  assert.match(studio, /\["draft", "announced", "published"\]/);
  assert.match(studio, /Recurring event[\s\S]*Event dates[\s\S]*Add date/);
  assert.match(studio, /Session number[\s\S]*Session title/);
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

test("SOLEHMAN'S NEW YEAR I page publishes the confirmed program and draft registration states", () => {
  const page = readFileSync(join(ROOT, "events", "solehmans-new-year", "index.html"), "utf8");
  const behavior = readFileSync(join(ROOT, "js", "solehmans-new-year.js"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  for (const value of [
    "SOLEHMAN'S NEW YEAR I.",
    "October 15–17, 2027",
    "bonus viewing October 18",
    "8:30 PM",
    "11 AM–2 PM",
    "$100 · 12 seats",
    "$50 · unlimited",
    "$60 · 10 places",
    "Artist Talk",
  ]) assert.match(page, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /class="location-address" id="eventLocation" hidden/);
  assert.doesNotMatch(page, /364 Nelson Street SW/);
  assert.match(page, /class="venture-hero site-hero site-hero--supporting"/);
  assert.match(page, /class="hero-descriptor"/);
  assert.match(page, /border:5px solid/);
  assert.match(page, /id="registrationForm"/);
  assert.match(page, /Draft · RSVP and sales not public/);
  assert.match(page, /<script src="\/js\/transition\.js"><\/script>/);
  assert.match(behavior, /admissionOptionId/);
  assert.match(behavior, /event\.venueLocation \|\| event\.location/);
  assert.match(behavior, /location\.hidden = !publicLocation/);
  assert.match(behavior, /Confirm RSVP/);
  assert.match(behavior, /Paid-session sales are still closed/);
  assert.match(studio, /RSVP \+ ticket options/);
  assert.match(studio, /collectEventAdmissionOptions/);
});
