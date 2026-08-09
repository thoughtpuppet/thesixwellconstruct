import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleAdminGetAvailabilityPreview,
  handleAdminUpdateSchedule,
} from "../functions/api/booking/_lib.js";

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
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
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

function adminRequest(path, token, method = "GET", payload) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

function scheduleSettings(database) {
  const row = database.prepare("SELECT * FROM booking_settings WHERE venture = 'tattooing'").get();
  return {
    timezone: row.timezone,
    bookingHorizonDays: row.booking_horizon_days,
    minimumNoticeHours: row.minimum_notice_hours,
    slotIntervalMinutes: row.slot_interval_minutes,
    maxBookingsPerDay: row.max_bookings_per_day,
    defaultCapacity: row.default_capacity,
    defaultBufferBeforeMinutes: row.default_buffer_before_minutes,
    defaultBufferAfterMinutes: row.default_buffer_after_minutes,
  };
}

function mondayWindows() {
  return [
    {
      id: "tattooing_monday",
      category: "tattooing",
      dayOfWeek: 1,
      active: true,
      startTime: "08:00",
      endTime: "12:00",
      capacity: 1,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      note: "Morning",
    },
    {
      id: "",
      category: "tattooing",
      dayOfWeek: 1,
      active: true,
      startTime: "16:00",
      endTime: "20:00",
      capacity: 1,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      note: "Evening",
    },
  ];
}

test("availability migration permits multiple recurring windows for one weekday and category", () => {
  const database = migratedDatabase();
  database.prepare(
    `INSERT INTO availability_rules
     (id, venture, day_of_week, start_time, end_time, active, capacity,
      buffer_before_minutes, buffer_after_minutes, note, created_at, updated_at, category)
     VALUES ('tattooing_monday_evening', 'tattooing', 1, '16:00', '20:00', 1, 1, 0, 0, '', datetime('now'), datetime('now'), 'tattooing')`
  ).run();

  const count = database.prepare(
    "SELECT COUNT(*) AS count FROM availability_rules WHERE venture = 'tattooing' AND category = 'tattooing' AND day_of_week = 1"
  ).get().count;
  assert.equal(count, 2);
  const index = database.prepare(
    "SELECT [unique] AS is_unique FROM pragma_index_list('availability_rules') WHERE name = 'idx_availability_rules_venture_category_day'"
  ).get();
  assert.equal(index.is_unique, 0);
});

test("Studio saves split weekday windows atomically and preserves other schedule categories", async () => {
  const database = migratedDatabase();
  const token = "weekly-admin-token";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const consultationCountBefore = database.prepare(
    "SELECT COUNT(*) AS count FROM availability_rules WHERE category = 'consultation'"
  ).get().count;

  const response = await handleAdminUpdateSchedule(
    adminRequest("/api/admin/booking/schedule", token, "PATCH", {
      settings: scheduleSettings(database),
      ruleCategories: ["tattooing"],
      rules: mondayWindows(),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  const tattooRules = payload.rules.filter((rule) => rule.category === "tattooing");
  assert.deepEqual(tattooRules.map((rule) => [rule.dayOfWeek, rule.startTime, rule.endTime]), [
    [1, "08:00", "12:00"],
    [1, "16:00", "20:00"],
  ]);
  assert.ok(tattooRules.every((rule) => rule.id));
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM availability_rules WHERE category = 'consultation'").get().count,
    consultationCountBefore,
  );

  const overlapping = mondayWindows();
  overlapping[1] = { ...overlapping[1], startTime: "11:00", endTime: "14:00" };
  const rejected = await handleAdminUpdateSchedule(
    adminRequest("/api/admin/booking/schedule", token, "PATCH", {
      settings: scheduleSettings(database),
      ruleCategories: ["tattooing"],
      rules: overlapping,
    }),
    env,
  );
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /Monday availability windows cannot overlap/);
  assert.deepEqual(
    database.prepare(
      "SELECT start_time, end_time FROM availability_rules WHERE category = 'tattooing' ORDER BY start_time"
    ).all().map((row) => [row.start_time, row.end_time]),
    [["08:00", "12:00"], ["16:00", "20:00"]],
  );
});

test("generated booking choices use both split windows and leave the midday gap closed", async () => {
  const database = migratedDatabase();
  const token = "weekly-preview-token";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  database.prepare(
    "UPDATE booking_settings SET minimum_notice_hours = 0, booking_horizon_days = 30 WHERE venture = 'tattooing'"
  ).run();
  const saved = await handleAdminUpdateSchedule(
    adminRequest("/api/admin/booking/schedule", token, "PATCH", {
      settings: scheduleSettings(database),
      ruleCategories: ["tattooing"],
      rules: mondayWindows(),
    }),
    env,
  );
  assert.equal(saved.status, 200);

  const response = await handleAdminGetAvailabilityPreview(
    adminRequest("/api/admin/booking/availability-preview?scope=tattoo", token),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  const localHour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const quarterDayMondayHours = payload.availabilityWindows
    .filter((windowItem) => windowItem.bookingTypeId === "tattoo_quarter")
    .map((windowItem) => Number(localHour.format(new Date(windowItem.startAt))));
  assert.ok(quarterDayMondayHours.includes(8));
  assert.ok(quarterDayMondayHours.includes(16));
  assert.ok(quarterDayMondayHours.every((hour) => hour < 12 || hour >= 16));
});

test("Studio weekly schedule exposes add/remove controls and submits category-owned rows", () => {
  const source = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(source, /data-add-weekly-rule/);
  assert.match(source, /data-remove-weekly-rule/);
  assert.match(source, /Add Time Window/);
  assert.match(source, /ruleCategories: availabilityConfig\(\)\.groups\.map/);
  assert.match(source, /category: row\.dataset\.ruleCategory/);
  assert.match(source, /dayOfWeek: Number\(row\.dataset\.ruleDay\)/);
});
