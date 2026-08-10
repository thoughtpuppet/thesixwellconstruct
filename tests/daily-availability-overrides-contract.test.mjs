import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  handleAdminCreateAvailability,
  handleAdminDeleteDateOverride,
  handleAdminGetAvailabilityPreview,
  handleAdminListDateOverrides,
  handleAdminPutDateOverride,
  materializeGeneratedWindow,
} from "../functions/api/booking/_lib.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) {
      return { results: statement.all(...this.values) };
    }
    const result = statement.run(...this.values);
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

function localDateAfter(days) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayOfWeek(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function adminRequest(path, token, method = "GET", body) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function configureRule(database, category, date, startTime, endTime) {
  const weekday = dayOfWeek(date);
  database.prepare("DELETE FROM availability_rules WHERE venture = 'tattooing' AND category = ? AND day_of_week = ?")
    .run(category, weekday);
  database.prepare(
    `INSERT INTO availability_rules (
      id, venture, day_of_week, start_time, end_time, active, capacity,
      buffer_before_minutes, buffer_after_minutes, note, created_at, updated_at, category
    ) VALUES (?, 'tattooing', ?, ?, ?, 1, 1, 0, 0, '', datetime('now'), datetime('now'), ?)`
  ).run(`contract_${category}_${weekday}`, weekday, startTime, endTime, category);
}

async function preview(env, token, scope) {
  const response = await handleAdminGetAvailabilityPreview(
    adminRequest(`/api/admin/booking/availability-preview?scope=${scope}`, token),
    env,
  );
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

test("0116 creates date override storage and scopes legacy exception windows", () => {
  const database = migratedDatabase();
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'availability_date_override%' ORDER BY name"
  ).all().map((row) => row.name);
  assert.deepEqual(tables, ["availability_date_override_windows", "availability_date_overrides"]);
  const scopeColumn = database.prepare("SELECT name FROM pragma_table_info('availability_windows') WHERE name = 'availability_scope'").get();
  assert.equal(scopeColumn.name, "availability_scope");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("custom and closed dates replace only their own schedule category", async () => {
  const database = migratedDatabase();
  const token = "daily-override-admin";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const date = localDateAfter(7);
  configureRule(database, "tattooing", date, "08:00", "12:00");
  configureRule(database, "consultation", date, "10:00", "12:00");
  database.prepare(
    "UPDATE booking_settings SET minimum_notice_hours = 0, booking_horizon_days = 30, slot_interval_minutes = 30, max_bookings_per_day = 20 WHERE venture = 'tattooing'"
  ).run();

  const weekly = await preview(env, token, "tattoo");
  const originalWeeklySlot = weekly.availabilityWindows.find((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.includes("T12:00:00.000Z"))
    || weekly.availabilityWindows.find((item) => item.bookingTypeId === "tattoo_quarter");
  assert.ok(originalWeeklySlot);
  const consultationBefore = weekly.availabilityWindows.filter((item) => item.bookingTypeId === "consult_in_person").length;

  const customResponse = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "PUT", {
      mode: "custom",
      windows: [
        { startTime: "08:00", endTime: "12:00", capacity: 1, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, note: "Morning" },
        { startTime: "16:00", endTime: "20:00", capacity: 1, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, note: "Evening" },
      ],
    }),
    env,
    "tattooing",
    date,
  );
  assert.equal(customResponse.status, 200, await customResponse.clone().text());
  const custom = await preview(env, token, "tattoo");
  const tattooSlots = custom.availabilityWindows.filter((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === date);
  assert.ok(tattooSlots.length > 0);
  assert.ok(tattooSlots.some((item) => new Date(item.startAt).getUTCHours() >= 20));
  assert.equal(custom.availabilityWindows.filter((item) => item.bookingTypeId === "consult_in_person").length, consultationBefore);
  assert.ok(tattooSlots.every((item) => item.id.startsWith("gen:date:")));

  const staleWeekly = await materializeGeneratedWindow(env.SUBMISSIONS_DB, originalWeeklySlot.id, "tattoo_quarter");
  assert.match(staleWeekly.error, /active schedule/i);
  const materializedCustom = await materializeGeneratedWindow(env.SUBMISSIONS_DB, tattooSlots[0].id, "tattoo_quarter");
  assert.equal(materializedCustom.window.booking_type_id, "tattoo_quarter");

  const closeResponse = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "PUT", { mode: "closed", windows: [] }),
    env,
    "tattooing",
    date,
  );
  assert.equal(closeResponse.status, 200);
  const closed = await preview(env, token, "tattoo");
  assert.equal(closed.availabilityWindows.filter((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === date).length, 0);
  assert.equal(closed.availabilityWindows.filter((item) => item.bookingTypeId === "consult_in_person").length, consultationBefore);
  const staleCustom = await materializeGeneratedWindow(env.SUBMISSIONS_DB, tattooSlots[0].id, "tattoo_quarter");
  assert.match(staleCustom.error, /no longer available/i);

  const resetResponse = await handleAdminDeleteDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "DELETE"),
    env,
    "tattooing",
    date,
  );
  assert.equal(resetResponse.status, 200);
  const reset = await preview(env, token, "tattoo");
  assert.ok(reset.availabilityWindows.some((item) => item.bookingTypeId === "tattoo_quarter" && item.startAt.slice(0, 10) === date));
});

test("date override API validates scope, dates, windows, overlap, and monthly listing", async () => {
  const database = migratedDatabase();
  const token = "daily-validation-admin";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const date = localDateAfter(10);
  const invalidScope = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/art_visit/${date}?scope=tattoo`, token, "PUT", { mode: "closed" }),
    env,
    "art_visit",
    date,
  );
  assert.equal(invalidScope.status, 400);
  const invalidDate = await handleAdminPutDateOverride(
    adminRequest("/api/admin/booking/date-overrides/tattooing/2026-02-30?scope=tattoo", token, "PUT", { mode: "closed" }),
    env,
    "tattooing",
    "2026-02-30",
  );
  assert.equal(invalidDate.status, 400);
  const emptyCustom = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "PUT", { mode: "custom", windows: [] }),
    env,
    "tattooing",
    date,
  );
  assert.equal(emptyCustom.status, 400);
  const overlapping = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "PUT", {
      mode: "custom",
      windows: [
        { startTime: "08:00", endTime: "12:00", capacity: 1 },
        { startTime: "11:30", endTime: "14:00", capacity: 1 },
      ],
    }),
    env,
    "tattooing",
    date,
  );
  assert.equal(overlapping.status, 400);

  const invalidWindows = [
    { label: "malformed time", window: { startTime: "8:00", endTime: "12:00", capacity: 1 } },
    { label: "end before start", window: { startTime: "13:00", endTime: "12:00", capacity: 1 } },
    { label: "invalid capacity", window: { startTime: "08:00", endTime: "12:00", capacity: 0 } },
    { label: "negative buffer", window: { startTime: "08:00", endTime: "12:00", capacity: 1, bufferBeforeMinutes: -5 } },
  ];
  for (const invalid of invalidWindows) {
    const response = await handleAdminPutDateOverride(
      adminRequest(`/api/admin/booking/date-overrides/tattooing/${date}?scope=tattoo`, token, "PUT", {
        mode: "custom",
        windows: [invalid.window],
      }),
      env,
      "tattooing",
      date,
    );
    assert.equal(response.status, 400, invalid.label);
  }

  const saved = await handleAdminPutDateOverride(
    adminRequest(`/api/admin/booking/date-overrides/consultation/${date}?scope=tattoo`, token, "PUT", {
      mode: "custom",
      windows: [{ startTime: "09:00", endTime: "11:00", capacity: 2, bufferBeforeMinutes: 0, bufferAfterMinutes: 5 }],
    }),
    env,
    "consultation",
    date,
  );
  assert.equal(saved.status, 200);
  const month = date.slice(0, 7);
  const listed = await handleAdminListDateOverrides(
    adminRequest(`/api/admin/booking/date-overrides?scope=tattoo&month=${month}`, token),
    env,
  );
  const listedPayload = await listed.json();
  assert.equal(listed.status, 200, JSON.stringify(listedPayload));
  assert.deepEqual(listedPayload.overrides.map((item) => [item.category, item.date, item.mode, item.windows.length]), [
    ["consultation", date, "custom", 1],
  ]);
});

test("advanced blackouts stay inside their Availability tab scope", async () => {
  const database = migratedDatabase();
  const token = "daily-scope-admin";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const date = localDateAfter(6);
  configureRule(database, "tattooing", date, "09:00", "17:00");
  configureRule(database, "art_visit", date, "09:00", "17:00");
  database.prepare(
    "UPDATE booking_settings SET minimum_notice_hours = 0, booking_horizon_days = 30, slot_interval_minutes = 30, max_bookings_per_day = 20 WHERE venture = 'tattooing'"
  ).run();
  const tattooBefore = await preview(env, token, "tattoo");
  const artBefore = await preview(env, token, "art");
  const artSlot = artBefore.availabilityWindows.find((item) => item.bookingTypeId === "studio_visit" && item.startAt.slice(0, 10) === date);
  assert.ok(artSlot);

  const created = await handleAdminCreateAvailability(
    adminRequest("/api/admin/booking/availability?scope=art", token, "POST", {
      venture: "tattooing",
      bookingTypeId: "studio_visit",
      startAt: artSlot.startAt,
      endAt: artSlot.endAt,
      capacity: 1,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      isBlackout: true,
    }),
    env,
  );
  assert.equal(created.status, 200, await created.clone().text());
  const stored = database.prepare("SELECT availability_scope FROM availability_windows WHERE is_blackout = 1").get();
  assert.equal(stored.availability_scope, "art");
  const tattooAfter = await preview(env, token, "tattoo");
  const artAfter = await preview(env, token, "art");
  assert.equal(tattooAfter.availabilityWindows.length, tattooBefore.availabilityWindows.length);
  assert.equal(artAfter.availabilityWindows.some((item) => item.id === artSlot.id), false);
});

test("Studio Availability exposes calendar override controls for every scoped tab", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, />Day Overrides</);
  assert.match(studio, /Follow Weekly Schedule/);
  assert.match(studio, /Custom Hours/);
  assert.match(studio, /data-add-date-window/);
  assert.match(studio, /data-reset-date-override/);
  assert.match(studio, />Advanced Exceptions</);
  assert.match(studio, /Changing availability affects new bookings only/);
  assert.match(studio, /groups\.map\(\(group\)/);
});
