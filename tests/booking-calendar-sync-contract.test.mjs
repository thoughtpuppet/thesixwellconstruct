import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  calendarSyncTestHelpers,
  discoverIcloudCalendars,
  handleAdminGetCalendarSync,
  runIcloudCalendarSync,
} from "../functions/api/booking/_calendar-sync.js";
import { handleAdminCreateAppointment } from "../functions/api/booking/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));
  }
  return database;
}

function envFor(database) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: "admin-test-token",
    ICLOUD_CALDAV_USERNAME: "artist@example.test",
    ICLOUD_CALDAV_APP_PASSWORD: "test-app-password",
    PUBLIC_SITE_URL: "https://thesixwellconstruct.com",
    STUDIO_ADDRESS: "364 Nelson Street SW, Atlanta, GA 30313",
  };
}

function adminRequest(path = "/api/admin/booking/calendar-sync", method = "GET", payload) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { authorization: "Bearer admin-test-token" },
    ...(payload === undefined ? {} : {
      headers: { authorization: "Bearer admin-test-token", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
}

function responseWithUrl(body, init, url) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("0230 stores private sync metadata without credential fields", () => {
  const sql = readFileSync(join(ROOT, "migrations", "0230_icloud_calendar_sync.sql"), "utf8");
  assert.match(sql, /booking_calendar_sync_settings/);
  assert.match(sql, /booking_calendar_sync_runs/);
  assert.match(sql, /appointment_calendar_links/);
  assert.match(sql, /external_calendar_busy_sources/);
  const schemaOnly = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(schemaOnly, /password|credential|username/i);
});

test("CalDAV parser blocks transparent, all-day, multi-day, and expanded recurring events while ignoring cancelled events", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:transparent-event",
    "DTSTART;TZID=America/New_York:20260308T013000",
    "DTEND;TZID=America/New_York:20260308T033000",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:all-day-event",
    "DTSTART;VALUE=DATE:20260410",
    "DTEND;VALUE=DATE:20260413",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:recurring-event",
    "RECURRENCE-ID:20260502T140000Z",
    "DTSTART:20260502T140000Z",
    "DTEND:20260502T150000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled-event",
    "STATUS:CANCELLED",
    "DTSTART:20260503T140000Z",
    "DTEND:20260503T150000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const intervals = calendarSyncTestHelpers.parseCalendarData(ics, { href: "/event.ics", etag: "etag-1" });
  assert.equal(intervals.length, 3);
  assert.deepEqual(
    { startAt: intervals[0].startAt, endAt: intervals[0].endAt },
    { startAt: "2026-03-08T06:30:00.000Z", endAt: "2026-03-08T07:30:00.000Z" },
  );
  assert.equal(intervals[1].allDay, true);
  assert.equal(intervals[1].endAt, "2026-04-13T04:00:00.000Z");
  assert.equal(intervals[2].recurrenceKey, "20260502T140000Z");
});

test("CalDAV transport accepts only validated iCloud HTTPS hosts and bounds response bodies", async () => {
  assert.equal(calendarSyncTestHelpers.safeIcloudUrl("https://p123-caldav.icloud.com/123/calendars/").hostname, "p123-caldav.icloud.com");
  assert.throws(() => calendarSyncTestHelpers.safeIcloudUrl("https://caldav.icloud.com.attacker.test/private"), /untrusted/i);
  assert.throws(() => calendarSyncTestHelpers.safeIcloudUrl("http://caldav.icloud.com/private"), /untrusted/i);
  const oversized = new Response("small", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } });
  await assert.rejects(() => calendarSyncTestHelpers.boundedText(oversized), /size limit/i);
});

test("CalDAV discovery follows only trusted manual redirects and returns event calendars", async (t) => {
  const env = envFor(migratedDatabase());
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    calls += 1;
    assert.equal(init.method, "PROPFIND");
    assert.equal(init.redirect, "manual");
    assert.match(new Headers(init.headers).get("authorization") || "", /^Basic /);
    const url = String(input);
    if (calls === 1) {
      return responseWithUrl('<d:multistatus xmlns:d="DAV:"><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:multistatus>', { status: 207 }, url);
    }
    if (calls === 2) {
      return responseWithUrl('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:multistatus>', { status: 207 }, url);
    }
    return responseWithUrl('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/tattoo/</d:href><d:propstat><d:prop><d:displayname>art.pill Tattoo House</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response></d:multistatus>', { status: 207 }, url);
  };
  t.after(() => { globalThis.fetch = originalFetch; env.SUBMISSIONS_DB.database.close(); });
  const calendars = await discoverIcloudCalendars(env);
  assert.deepEqual(calendars, [{
    href: "https://caldav.icloud.com/123/calendars/tattoo/",
    name: "art.pill Tattoo House",
  }]);

  calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    return responseWithUrl("", {
      status: 302,
      headers: { location: "https://attacker.test/steal" },
    }, String(input));
  };
  await assert.rejects(() => discoverIcloudCalendars(env), /untrusted/i);
  assert.equal(calls, 1);
});

test("admin status redacts iCloud secret values", async () => {
  const database = migratedDatabase();
  const response = await handleAdminGetCalendarSync(adminRequest(), envFor(database));
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.deepEqual(payload.credentials, { username: true, appPassword: true });
  assert.doesNotMatch(text, /artist@example\.test|test-app-password/);
});

test("Studio manual scheduling requires an explicit override for cached iCloud busy time", async () => {
  const database = migratedDatabase();
  const env = envFor(database);
  const now = "2026-09-23T12:00:00.000Z";
  database.prepare("INSERT INTO availability_windows (id,venture,start_at,end_at,capacity,is_blackout,active,note,created_at,updated_at,availability_scope) VALUES (?,'tattooing',?,?,1,1,1,'iCloud Busy',?,?,'tattoo')")
    .run("icloud:manual-conflict", "2030-02-10T15:00:00.000Z", "2030-02-10T18:00:00.000Z", now, now);
  const body = {
    bookingTypeId: "tattoo_quarter",
    customStartAt: "2030-02-10T16:00:00.000Z",
    clientName: "Override Client",
    clientEmail: "",
    paymentMode: "none",
    notifyClient: false,
  };
  const rejected = await handleAdminCreateAppointment(adminRequest(
    "/api/admin/booking/appointments",
    "POST",
    body,
  ), env);
  const rejectedPayload = await rejected.json();
  assert.equal(rejected.status, 409);
  assert.equal(rejectedPayload.code, "EXTERNAL_CALENDAR_CONFLICT");
  assert.doesNotMatch(JSON.stringify(rejectedPayload), /Personal|Private|icloud:/i);

  const overridden = await handleAdminCreateAppointment(adminRequest(
    "/api/admin/booking/appointments",
    "POST",
    { ...body, overrideConflict: true },
  ), env);
  const overriddenPayload = await overridden.json();
  assert.equal(overridden.status, 201, JSON.stringify(overriddenPayload));
  assert.equal(overriddenPayload.appointment.status, "confirmed");
  assert.equal(overriddenPayload.appointment.clientName, "Override Client");
  database.close();
});

test("outbound sync creates stable events, verifies ETags, restores Apple drift, and deletes cancelled appointments", async (t) => {
  const database = migratedDatabase();
  const env = envFor(database);
  const now = "2026-09-23T12:00:00.000Z";
  database.prepare("UPDATE booking_calendar_sync_settings SET outbound_enabled=1,destination_calendar_href=?,destination_calendar_name=?,updated_at=? WHERE id='icloud'")
    .run("https://p123-caldav.icloud.com/1/calendars/tattoo/", "art.pill Tattoo House", now);
  database.prepare(`INSERT INTO appointments (id,booking_type_id,status,purpose,client_name,client_email,client_phone,start_at,end_at,deposit_cents,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)`)
    .run("appt-calendar-1", "tattoo_half", "confirmed", "tattoo", "Calendar Client", "client@example.test", "404-555-0199", "2030-01-10T15:00:00.000Z", "2030-01-10T18:00:00.000Z", 10000, "USD", now, now);

  const calls = [];
  let mode = "create";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body || "" });
    if (mode === "create" && method === "PUT") return responseWithUrl("", { status: 201, headers: { etag: '"e1"' } }, url);
    if (mode === "unchanged" && method === "GET") return responseWithUrl(null, { status: 304 }, url);
    if (mode === "update" && method === "PUT") return responseWithUrl(null, { status: 204, headers: { etag: '"e2"' } }, url);
    if (mode === "missing" && method === "GET") return responseWithUrl("", { status: 404 }, url);
    if (mode === "missing" && method === "PUT" && new Headers(init.headers).has("if-match")) return responseWithUrl("", { status: 412 }, url);
    if (mode === "missing" && method === "PUT") return responseWithUrl("", { status: 201, headers: { etag: '"e3"' } }, url);
    if (mode === "cancel" && method === "DELETE") return responseWithUrl(null, { status: 204 }, url);
    throw new Error(`Unexpected ${mode} request: ${method} ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; database.close(); });

  const created = await runIcloudCalendarSync(env, "manual");
  assert.equal(created.status, "succeeded");
  assert.equal(created.counts.outbound.updated, 1);
  const createCall = calls.find((call) => call.method === "PUT");
  const unfoldedBody = createCall.body.replace(/\r\n /g, "");
  assert.match(unfoldedBody, /UID:appointment-appt-calendar-1@thesixwellconstruct\.com/);
  assert.match(unfoldedBody, /Calendar Client/);
  assert.match(unfoldedBody, /client@example\.test/);
  assert.match(unfoldedBody, /404-555-0199/);
  assert.match(unfoldedBody, /appointment=appt-calendar-1/);

  mode = "unchanged";
  const unchanged = await runIcloudCalendarSync(env, "scheduled");
  assert.equal(unchanged.counts.outbound.unchanged, 1);
  assert.equal(calls.at(-1).headers.get("if-none-match"), '"e1"');

  mode = "update";
  database.prepare("UPDATE appointments SET start_at=?,end_at=?,updated_at=? WHERE id=?")
    .run("2030-01-11T16:00:00.000Z", "2030-01-11T19:00:00.000Z", "2026-09-23T13:00:00.000Z", "appt-calendar-1");
  const updated = await runIcloudCalendarSync(env, "scheduled");
  assert.equal(updated.counts.outbound.updated, 1);
  assert.equal(calls.at(-1).headers.get("if-match"), '"e1"');

  mode = "missing";
  const restored = await runIcloudCalendarSync(env, "scheduled");
  assert.equal(restored.counts.outbound.restored, 1);
  assert.deepEqual(calls.slice(-3).map((call) => call.method), ["GET", "PUT", "PUT"]);

  mode = "cancel";
  database.prepare("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=?")
    .run("2026-09-23T14:00:00.000Z", "appt-calendar-1");
  const cancelled = await runIcloudCalendarSync(env, "scheduled");
  assert.equal(cancelled.counts.outbound.deleted, 1);
  assert.equal(database.prepare("SELECT state FROM appointment_calendar_links WHERE appointment_id=?").get("appt-calendar-1").state, "deleted");
});

test("inbound refresh atomically replaces iCloud blackout snapshots and preserves the last complete snapshot on failure", async (t) => {
  const database = migratedDatabase();
  const env = envFor(database);
  const calendarHref = "https://p123-caldav.icloud.com/1/calendars/personal/";
  const oldRun = "old-calendar-run";
  const oldTime = "2026-09-20T12:00:00.000Z";
  database.prepare("INSERT INTO booking_calendar_sync_runs (id,provider,direction,trigger_kind,status,counts_json,error,started_at,completed_at) VALUES (?,'icloud','full','scheduled','succeeded','{}','',?,?)")
    .run(oldRun, oldTime, oldTime);
  database.prepare("INSERT INTO availability_windows (id,venture,start_at,end_at,capacity,is_blackout,active,note,created_at,updated_at,availability_scope) VALUES (?,'tattooing',?,?,1,1,1,'iCloud Busy',?,?,'tattoo')")
    .run("icloud:old", "2030-01-01T15:00:00.000Z", "2030-01-01T16:00:00.000Z", oldTime, oldTime);
  database.prepare("INSERT INTO external_calendar_busy_sources (availability_window_id,provider,calendar_href_hash,calendar_name,event_uid_hash,recurrence_key,source_etag,sync_run_id,observed_at) VALUES (?,'icloud',?,?,?,?,?,?,?)")
    .run("icloud:old", "old-calendar-hash", "Personal", "old-event-hash", "", "", oldRun, oldTime);
  database.prepare("UPDATE booking_calendar_sync_settings SET inbound_enabled=1,blocking_calendars_json=?,updated_at=? WHERE id='icloud'")
    .run(JSON.stringify([{ href: calendarHref, name: "Personal" }]), oldTime);

  const report = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/1/calendars/personal/event.ics</d:href><d:propstat><d:prop><d:getetag>busy-etag</d:getetag><c:calendar-data>BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:private-title-never-stored\r\nSUMMARY:Private Medical Appointment\r\nDTSTART:20300102T150000Z\r\nDTEND:20300102T170000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nEND:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;
  const originalFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(init.method, "REPORT");
    return responseWithUrl(fail ? "unavailable" : report, { status: fail ? 503 : 207 }, String(input));
  };
  t.after(() => { globalThis.fetch = originalFetch; database.close(); });

  const succeeded = await runIcloudCalendarSync(env, "manual");
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.counts.inbound.intervals, 1);
  const snapshot = database.prepare("SELECT id,note,start_at,end_at FROM availability_windows WHERE id LIKE 'icloud:%'").all();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].note, "iCloud Busy");
  assert.equal(snapshot[0].start_at, "2030-01-02T15:00:00.000Z");
  const storedSource = JSON.stringify(database.prepare("SELECT * FROM external_calendar_busy_sources").all());
  assert.doesNotMatch(storedSource, /Private Medical Appointment|private-title-never-stored/);
  const stableId = snapshot[0].id;

  fail = true;
  const failed = await runIcloudCalendarSync(env, "scheduled");
  assert.equal(failed.status, "failed");
  assert.deepEqual(database.prepare("SELECT id FROM availability_windows WHERE id LIKE 'icloud:%'").all().map((row) => row.id), [stableId]);
});

test("Studio and Worker expose protected sync controls, generic public conflicts, and no credential-entry fields", () => {
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  const booking = readFileSync(join(ROOT, "functions", "api", "booking", "_lib.js"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(worker, /\/api\/admin\/booking\/calendar-sync/);
  assert.match(worker, /runIcloudCalendarSync\(env, "scheduled"\)/);
  assert.match(booking, /EXTERNAL_CALENDAR_CONFLICT/);
  assert.match(studio, /Apple Calendar Sync/);
  assert.match(studio, /data-calendar-sync-discover/);
  assert.match(studio, /data-calendar-sync-run/);
  assert.match(studio, /Choose art\.pill Tattoo House/);
  assert.match(studio, /new URLSearchParams\(window\.location\.search\)\.get\("appointment"\)/);
  assert.doesNotMatch(studio, /name=["'](?:password|username|icloudPassword|icloudUsername)["']/i);
});
