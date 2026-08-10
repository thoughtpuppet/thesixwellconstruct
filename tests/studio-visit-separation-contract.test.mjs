import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleAdminGetAvailabilityPreview } from "../functions/api/booking/_lib.js";
import {
  notifyAdminAppointmentConfirmed,
  notifyAdminAppointmentRescheduled,
  notifyAdminSubmissionReceived,
} from "../functions/api/notifications/_lib.js";
import { renderClientEmailPreview } from "../functions/api/notifications/_email-templates.js";

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
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }
}

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function databaseBeforeArtVisitSplit() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = join(ROOT, "migrations");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql") && name.localeCompare("0072_art_visit_availability.sql") < 0)
    .sort();
  for (const migration of migrations) {
    database.exec(source(join("migrations", migration)));
  }
  return database;
}

test("Studio Visit migration preserves visit hours and leaves room booking closed", () => {
  const database = databaseBeforeArtVisitSplit();
  database.prepare(
    `UPDATE availability_rules
     SET active = CASE WHEN day_of_week IN (0, 1, 2, 3, 6) THEN 1 ELSE 0 END,
         start_time = '08:00',
         end_time = '18:00'
     WHERE category = 'studio'`
  ).run();

  database.exec(source("migrations/0072_art_visit_availability.sql"));

  const visitRules = database.prepare(
    `SELECT day_of_week, start_time, end_time, active
     FROM availability_rules
     WHERE category = 'art_visit'
     ORDER BY day_of_week`
  ).all();
  assert.equal(visitRules.length, 7);
  assert.deepEqual(
    visitRules.filter((rule) => rule.active).map((rule) => rule.day_of_week),
    [0, 1, 2, 3, 6],
  );
  assert.ok(visitRules.every((rule) => rule.start_time === "08:00" && rule.end_time === "18:00"));

  const roomRules = database.prepare(
    `SELECT active FROM availability_rules WHERE category = 'studio_space'`
  ).all();
  assert.equal(roomRules.length, 7);
  assert.ok(roomRules.every((rule) => rule.active === 0));
});

test("Studio UI and public booking pages keep visits under Art and room booking separate", () => {
  const studio = source("studio/submissions/index.html");
  const roomBooking = source("booking/studio/index.html");
  const studioVisit = source("booking/studio-visit/index.html");
  const confirmation = source("booking/confirmed/studio/index.html");
  const bookingApi = source("functions/api/booking/_lib.js");

  assert.match(studio, /data-tab="art">Art<\/button>/);
  assert.match(studio, /data-subview="studio-visits">Studio Visits<\/button>/);
  assert.match(studio, /data-subview="visit-availability">Visit Availability<\/button>/);
  assert.match(studio, /category: "art_visit"/);
  assert.match(studio, /category: "studio_space"/);

  assert.match(roomBooking, /const STUDIO_TYPE_IDS = \["studio_gathering", "studio_rental"\]/);
  assert.doesNotMatch(roomBooking, /<p class="offering-name">Open Studio Visit<\/p>/);
  assert.match(studioVisit, /const VISIT_TYPE_IDS = \["studio_visit"\]/);
  assert.match(studioVisit, /--art:var\(--color-art\)/);
  assert.match(studioVisit, /--art-bright:var\(--color-art-bright\)/);
  assert.match(studioVisit, /\.nav-inquire\{[^}]*color:var\(--art-bright\)/);
  assert.match(studioVisit, /\.block-kicker\{[^}]*color:var\(--art-bright\)/);
  assert.match(studioVisit, /\.cal-next-tag,\.booking-next-tag,\.slot-item-num,\.time-add-btn\{color:var\(--art-bright\);\}/);
  assert.doesNotMatch(studioVisit, /#0071EB|rgba\(0,113,235/i);
  assert.match(confirmation, /appointment\?\.bookingTypeId === "studio_visit"/);
  assert.match(confirmation, /confirmedBadge: "Open Studio Visit Confirmed"/);
  assert.match(confirmation, /confirmedTitle: "Your Open Studio Visit is reserved\."/);
  assert.match(confirmation, /cancelledTitle: "This Open Studio Visit has been cancelled\."/);
  assert.match(confirmation, /rebookUrl: "\/booking\/studio-visit\/\?rebook=1"/);
  assert.match(confirmation, /confirmedBadge: "Studio Booking Confirmed"/);
  assert.match(confirmation, /rebookUrl: "\/booking\/studio\/\?rebook=1"/);

  assert.match(studio, /Your Open Studio Visit is confirmed\./);
  assert.match(studio, /We received your Open Studio Visit request/);
  assert.match(studio, /studioVisit \? "Open Studio Visit" : "studio booking"/);
  assert.match(studio, /Your studio booking is confirmed\./);
  assert.match(studio, /We received your studio booking request/);

  assert.match(bookingApi, /art_visit: ART_VISIT_BOOKING_TYPE_IDS/);
  assert.match(bookingApi, /studio_space: STUDIO_SPACE_BOOKING_TYPE_IDS/);
  assert.match(bookingApi, /scope === "art"/);
});

test("Open Studio Visit notification templates never fall back to studio-booking copy", () => {
  const lifecycleTemplates = [
    "studio_booking_confirmed",
    "appointment_rescheduled",
    "appointment_cancelled",
    "appointment_reminder_24h",
  ];

  for (const templateKey of lifecycleTemplates) {
    const visit = renderClientEmailPreview(templateKey, "studio_visit");
    const room = renderClientEmailPreview(templateKey, "studio_space");
    const visitCopy = `${visit.subject}\n${visit.text}`;
    const roomCopy = `${room.subject}\n${room.text}`;

    assert.match(visitCopy, /Open Studio Visit/);
    assert.doesNotMatch(visitCopy, /\bstudio booking\b/i);
    assert.match(roomCopy, /\bstudio booking\b/i);
    assert.doesNotMatch(roomCopy, /Open Studio Visit/);
  }
});

test("Studio admin alerts name studio_visit even when its stored label is absent", async () => {
  const sent = [];
  const env = {
    ADMIN_NOTIFICATION_EMAIL: "studio@example.test",
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: `studio-visit-copy-${sent.length}` };
      },
    },
  };

  await notifyAdminSubmissionReceived(env, {
    id: "visit-submission",
    type: "studio_booking",
    contact: { name: "Visitor", email: "visitor@example.test" },
    payload: { booking_type_id: "studio_visit" },
  });
  assert.equal(sent.at(-1).subject, "New submission: Open Studio Visit");
  assert.match(sent.at(-1).text, /Type: Open Studio Visit/);
  assert.doesNotMatch(sent.at(-1).text, /\bstudio booking\b/i);

  const visit = {
    id: "visit-appointment",
    bookingTypeId: "studio_visit",
    purpose: "studio",
    clientName: "Visitor",
    clientEmail: "visitor@example.test",
    startAt: "2026-08-08T16:00:00.000Z",
    endAt: "2026-08-08T17:00:00.000Z",
    depositCents: 5000,
    totalDueCents: 5000,
    currency: "USD",
  };
  await notifyAdminAppointmentConfirmed(env, null, visit);
  assert.equal(sent.at(-1).subject, "Booking confirmed: Open Studio Visit");
  assert.match(sent.at(-1).text, /Booking type: Open Studio Visit/);
  assert.doesNotMatch(sent.at(-1).text, /studio_visit|\bstudio booking\b/i);

  await notifyAdminAppointmentRescheduled(env, null, visit, {
    previousStartAt: "2026-08-07T16:00:00.000Z",
    previousEndAt: "2026-08-07T17:00:00.000Z",
  });
  assert.equal(sent.at(-1).subject, "Booking rescheduled: Open Studio Visit");
  assert.match(sent.at(-1).text, /Booking type: Open Studio Visit/);
  assert.doesNotMatch(sent.at(-1).text, /studio_visit|\bstudio booking\b/i);

  await notifyAdminSubmissionReceived(env, {
    id: "room-submission",
    type: "studio_booking",
    contact: { name: "Host", email: "host@example.test" },
    payload: { booking_type_id: "studio_gathering" },
  });
  assert.equal(sent.at(-1).subject, "New submission: Studio Booking");
  assert.match(sent.at(-1).text, /Type: Studio Booking/);
  assert.doesNotMatch(sent.at(-1).text, /Open Studio Visit/);
});

test("availability preview scopes never cross Studio Visits into room bookings", async () => {
  const database = databaseBeforeArtVisitSplit();
  database.exec(source("migrations/0072_art_visit_availability.sql"));
  database.exec(source("migrations/0116_daily_availability_overrides.sql"));
  database.prepare(
    `UPDATE availability_rules
     SET active = CASE WHEN day_of_week IN (0, 1, 2, 3, 6) THEN 1 ELSE 0 END
     WHERE category = 'art_visit'`
  ).run();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: "admin-token",
  };
  const request = (scope) => new Request(
    `https://example.test/api/admin/booking/availability-preview?scope=${scope}`,
    { headers: { authorization: "Bearer admin-token" } },
  );

  const artResponse = await handleAdminGetAvailabilityPreview(request("art"), env);
  assert.equal(artResponse.status, 200);
  const art = await artResponse.json();
  assert.deepEqual(art.bookingTypes.map((type) => type.id), ["studio_visit"]);
  assert.ok(art.availabilityWindows.length > 0);
  assert.ok(art.availabilityWindows.every((windowItem) => windowItem.bookingTypeId === "studio_visit"));

  const roomResponse = await handleAdminGetAvailabilityPreview(request("studio"), env);
  assert.equal(roomResponse.status, 200);
  const room = await roomResponse.json();
  assert.deepEqual(
    room.bookingTypes.map((type) => type.id).sort(),
    ["studio_gathering", "studio_rental"],
  );
  assert.equal(room.availabilityWindows.length, 0);
});
