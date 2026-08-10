import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  handleAdminCreateSchedulePeriod,
  handleAdminDeleteSchedulePeriod,
  handleAdminGetAvailabilityPreview,
  handleAdminListSchedulePeriods,
  handleAdminPutDateOverride,
  handleAdminPutSchedulePeriod,
  materializeGeneratedWindow,
} from "../functions/api/booking/_lib.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
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
function localDateAfter(days) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + days * 86400000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function weekday(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function request(path, token, method = "GET", body) {
  return new Request(`https://example.test${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function envFor(database, token = "admin") { return { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token }; }
async function preview(env, token = "admin") {
  const response = await handleAdminGetAvailabilityPreview(request("/api/admin/booking/availability-preview?scope=tattoo", token), env);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function periodBody(startDate, endDate = "") {
  return {
    label: "School Schedule", startDate, endDate,
    windows: [
      { dayOfWeek: weekday(startDate), startTime: "08:00", endTime: "12:00", capacity: 1, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, note: "Morning" },
      { dayOfWeek: weekday(startDate), startTime: "16:00", endTime: "20:00", capacity: 1, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, note: "Evening" },
    ],
  };
}

test("0117 creates scheduled-period tables with cascading windows", () => {
  const db = migratedDatabase();
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'availability_schedule_period%' ORDER BY name").all().map((row) => row.name), ["availability_schedule_period_windows", "availability_schedule_periods"]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("scheduled weekly hours activate inclusively, replace baseline, and then fall back", async () => {
  const db = migratedDatabase();
  const env = envFor(db);
  db.prepare("UPDATE booking_settings SET minimum_notice_hours=0, booking_horizon_days=30, slot_interval_minutes=30, max_bookings_per_day=40 WHERE venture='tattooing'").run();
  const start = localDateAfter(7);
  const end = localDateAfter(14);
  const afterDate = localDateAfter(15);
  db.prepare("DELETE FROM availability_rules WHERE venture='tattooing' AND category='tattooing' AND day_of_week=?").run(weekday(afterDate));
  db.prepare(`INSERT INTO availability_rules (id,venture,day_of_week,start_time,end_time,active,capacity,buffer_before_minutes,buffer_after_minutes,note,created_at,updated_at,category)
    VALUES ('future-fallback','tattooing',?,'09:00','13:00',1,1,0,0,'',datetime('now'),datetime('now'),'tattooing')`).run(weekday(afterDate));
  const before = await preview(env);
  const oldWeekly = before.availabilityWindows.find((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === start);
  const response = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", periodBody(start, end)), env, "tattooing");
  assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()).schedulePeriod;
  const during = await preview(env);
  const scheduled = during.availabilityWindows.filter((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === start);
  assert.ok(scheduled.length > 0);
  assert.ok(scheduled.every((item) => item.id.startsWith("gen:period:")));
  if (oldWeekly) assert.match((await materializeGeneratedWindow(env.SUBMISSIONS_DB, oldWeekly.id, "tattoo_quarter")).error, /active schedule/i);
  assert.equal((await materializeGeneratedWindow(env.SUBMISSIONS_DB, scheduled[0].id, "tattoo_quarter")).window.booking_type_id, "tattoo_quarter");
  assert.ok(during.availabilityWindows.some((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === afterDate && !item.id.startsWith("gen:period:")));
  const deleted = await handleAdminDeleteSchedulePeriod(request(`/api/admin/booking/schedule-periods/tattooing/${created.id}?scope=tattoo`, "admin", "DELETE"), env, "tattooing", created.id);
  assert.equal(deleted.status, 200);
  assert.match((await materializeGeneratedWindow(env.SUBMISSIONS_DB, scheduled[0].id, "tattoo_quarter")).error, /no longer available/i);
});

test("period APIs reject overlap and daily overrides retain precedence", async () => {
  const db = migratedDatabase();
  const env = envFor(db);
  db.prepare("UPDATE booking_settings SET minimum_notice_hours=0, booking_horizon_days=30, max_bookings_per_day=40 WHERE venture='tattooing'").run();
  const start = localDateAfter(8);
  const invalidRange = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", { ...periodBody(start), endDate: localDateAfter(7) }), env, "tattooing");
  assert.equal(invalidRange.status, 400);
  const invalidWindows = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", {
    ...periodBody(start),
    windows: [
      { dayOfWeek: weekday(start), startTime: "08:00", endTime: "12:00", capacity: 1 },
      { dayOfWeek: weekday(start), startTime: "11:00", endTime: "13:00", capacity: 1 },
    ],
  }), env, "tattooing");
  assert.equal(invalidWindows.status, 400);
  const invalidScope = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/art_visit?scope=tattoo", "admin", "POST", { ...periodBody(start), windows: [] }), env, "art_visit");
  assert.equal(invalidScope.status, 400);
  const first = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", periodBody(start, localDateAfter(12))), env, "tattooing");
  assert.equal(first.status, 201);
  const overlap = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", periodBody(localDateAfter(10), localDateAfter(15))), env, "tattooing");
  assert.equal(overlap.status, 409);
  const closed = await handleAdminPutDateOverride(request(`/api/admin/booking/date-overrides/tattooing/${start}?scope=tattoo`, "admin", "PUT", { mode: "closed", windows: [] }), env, "tattooing", start);
  assert.equal(closed.status, 200);
  const available = await preview(env);
  assert.equal(available.availabilityWindows.filter((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === start).length, 0);
  const listed = await handleAdminListSchedulePeriods(request("/api/admin/booking/schedule-periods?scope=tattoo", "admin"), env);
  assert.equal((await listed.json()).schedulePeriods.length, 1);
});

test("editing a scheduled period warns about existing appointments and preserves them", async () => {
  const db = migratedDatabase();
  const env = envFor(db);
  const start = localDateAfter(9);
  const createdResponse = await handleAdminCreateSchedulePeriod(request("/api/admin/booking/schedule-periods/tattooing?scope=tattoo", "admin", "POST", periodBody(start, start)), env, "tattooing");
  const created = (await createdResponse.json()).schedulePeriod;
  db.prepare(`INSERT INTO availability_windows (id, venture, booking_type_id, start_at, end_at, capacity, buffer_before_minutes, buffer_after_minutes, is_blackout, active, note, created_at, updated_at, availability_scope)
    VALUES ('manual','tattooing','tattoo_quarter',?,?,1,0,0,0,1,'',datetime('now'),datetime('now'),'tattoo')`)
    .run(`${start}T18:00:00.000Z`, `${start}T20:00:00.000Z`);
  db.prepare(`INSERT INTO appointments (id, booking_type_id, availability_window_id, status, purpose, client_name, client_email, start_at, end_at, deposit_cents, currency, created_at, updated_at)
    VALUES ('future-conflict','tattoo_quarter','manual','confirmed','tattoo','Existing Client','client@example.test',?,?,0,'USD',datetime('now'),datetime('now'))`)
    .run(`${start}T18:00:00.000Z`, `${start}T20:00:00.000Z`);
  const closedWeek = { label: "Closed School Week", startDate: start, endDate: start, windows: [] };
  const warning = await handleAdminPutSchedulePeriod(request(`/api/admin/booking/schedule-periods/tattooing/${created.id}?scope=tattoo`, "admin", "PUT", closedWeek), env, "tattooing", created.id);
  assert.equal(warning.status, 409);
  const warningBody = await warning.json();
  assert.equal(warningBody.requiresConfirmation, true);
  assert.equal(warningBody.appointments[0].id, "future-conflict");
  const confirmed = await handleAdminPutSchedulePeriod(request(`/api/admin/booking/schedule-periods/tattooing/${created.id}?scope=tattoo`, "admin", "PUT", { ...closedWeek, confirmExistingAppointments: true }), env, "tattooing", created.id);
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal(db.prepare("SELECT status FROM appointments WHERE id='future-conflict'").get().status, "confirmed");
});

test("Studio includes scheduled-period controls and route wiring", () => {
  const html = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  assert.match(html, /Scheduled Weekly Changes/);
  assert.match(html, /Schedule Future Hours/);
  assert.match(html, /data-scheduled-day/);
  assert.match(html, /Following scheduled weekly hours/);
  assert.match(html, /typeValue = "";\s+schedulePeriodDraft = null;\s+subView = tab ===/);
  assert.match(html, /statusValue = "";\s+typeValue = "";\s+schedulePeriodDraft = null;\s+renderActiveTab\(\);/);
  assert.match(html, /!container\.isConnected \|\| container !== document\.getElementById\("scheduledWeeklyChanges"\)/);
  assert.match(html, /!calendar\.isConnected \|\| calendar !== document\.getElementById\("dateOverrideCalendar"\)/);
  assert.match(html, /!form\.isConnected \|\| form !== document\.getElementById\("scheduleForm"\)/);
  assert.match(worker, /handleAdminCreateSchedulePeriod/);
});
