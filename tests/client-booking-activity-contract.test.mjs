import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleBookingAccessEvent,
  handleSquareCheckoutRedirect,
} from "../functions/api/booking/_lib.js";
import {
  handleGetSubmission,
  handleListSubmissions,
} from "../functions/api/submissions/_lib.js";

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
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));
  }
  return database;
}

function tokenHash(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function jsonRequest(path, body) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function redirectRequest(body) {
  return new Request("https://example.test/api/booking/square-redirect", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

function adminRequest(path) {
  return new Request(`https://example.test${path}`, {
    headers: { authorization: "Bearer test-admin" },
  });
}

function insertSubmission(database, id = "tracked-submission") {
  const now = "2026-08-05T12:00:00.000Z";
  database.prepare(
    `INSERT INTO submissions (
       id, type, status, source_path, subject, contact_name, contact_email,
       contact_json, payload_json, request_meta_json, files_json,
       internal_notes, booking_url, tattoo_stage, created_at, updated_at
     ) VALUES (?, 'tattoo_inquiry', 'approved', '/tattoos/inquire/', 'Tracked booking',
       'Tracked Client', 'tracked@example.com', '{}', '{}', '{}', '[]', '', '',
       'ready_to_book', ?, ?)`
  ).run(id, now, now);
}

function insertToken(database, {
  id,
  rawToken,
  submissionId = "tracked-submission",
  expiresAt = "2099-01-01T00:00:00.000Z",
  revokedAt = null,
  usedAt = null,
}) {
  database.prepare(
    `INSERT INTO booking_tokens (
       id, token_hash, submission_id, allowed_booking_types_json, purpose,
       expires_at, used_at, revoked_at, created_at, updated_at
     ) VALUES (?, ?, ?, '["tattoo_quarter"]', 'tattoo', ?, ?, ?,
       '2026-08-05T12:00:00.000Z', '2026-08-05T12:00:00.000Z')`
  ).run(id, tokenHash(rawToken), submissionId, expiresAt, usedAt, revokedAt);
}

test("private booking opens retain complete idempotent history without identifying metadata", async () => {
  const database = migratedDatabase();
  insertSubmission(database);
  insertToken(database, { id: "active-token", rawToken: "Ab3dE7xQ9wK2" });
  insertToken(database, {
    id: "expired-token",
    rawToken: "Bc4eF8yR0xL3",
    expiresAt: "2026-08-04T00:00:00.000Z",
  });
  insertToken(database, {
    id: "revoked-token",
    rawToken: "Cd5fG9zS1yM4",
    revokedAt: "2026-08-05T12:30:00.000Z",
  });
  insertToken(database, {
    id: "used-token",
    rawToken: "De6gH0aT2zN5",
    usedAt: "2026-08-05T12:45:00.000Z",
  });
  const env = { SUBMISSIONS_DB: new LocalD1(database) };

  const events = [
    ["Ab3dE7xQ9wK2", "open:active-one", "active"],
    ["Ab3dE7xQ9wK2", "open:active-two", "active"],
    ["Bc4eF8yR0xL3", "open:expired", "expired"],
    ["Cd5fG9zS1yM4", "open:revoked", "revoked"],
    ["De6gH0aT2zN5", "open:used", "used"],
  ];
  for (const [rawToken, eventId] of events) {
    const response = await handleBookingAccessEvent(jsonRequest(
      "/api/booking/access-events",
      { token: rawToken, eventId },
    ), env);
    assert.equal(response.status, 204);
  }
  const duplicate = await handleBookingAccessEvent(jsonRequest(
    "/api/booking/access-events",
    { token: "Ab3dE7xQ9wK2", eventId: "open:active-one" },
  ), env);
  const unknown = await handleBookingAccessEvent(jsonRequest(
    "/api/booking/access-events",
    { token: "Ef7hI1bU3aP6", eventId: "open:unknown" },
  ), env);
  assert.equal(duplicate.status, 204);
  assert.equal(unknown.status, 204);

  const rows = database.prepare(
    `SELECT event_type, metadata_json FROM booking_client_events ORDER BY idempotency_key`
  ).all();
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => JSON.parse(row.metadata_json).accessState).sort(),
    events.map((event) => event[2]).sort(),
  );
  assert.equal(Object.keys(JSON.parse(rows[0].metadata_json)).join(","), "accessState");
});

test("private Square handoff validates ownership and records only successful redirects", async () => {
  const database = migratedDatabase();
  insertSubmission(database);
  const rawToken = "Ab3dE7xQ9wK2";
  insertToken(database, { id: "active-token", rawToken });
  const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  database.prepare(
    `INSERT INTO appointments (
       id, submission_id, booking_token_id, booking_type_id, status, purpose,
       client_name, client_email, start_at, end_at, deposit_cents, currency,
       square_checkout_url, hold_expires_at, hold_state, created_at, updated_at
     ) VALUES ('tracked-appointment', 'tracked-submission', 'active-token',
       'tattoo_quarter', 'deposit_pending', 'tattoo', 'Tracked Client',
       'tracked@example.com', ?, ?, 5000, 'USD',
       'https://square.test/tracked-checkout', ?, 'active',
       '2026-08-05T12:00:00.000Z', '2026-08-05T12:00:00.000Z')`
  ).run(startAt, endAt, expiresAt);
  const env = { SUBMISSIONS_DB: new LocalD1(database) };

  const first = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "tracked-appointment",
    eventId: "square:first-handoff",
  }), env);
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), "https://square.test/tracked-checkout");
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("referrer-policy"), "no-referrer");

  const duplicate = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "tracked-appointment",
    eventId: "square:first-handoff",
  }), env);
  assert.equal(duplicate.status, 303);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM booking_client_events WHERE event_type='square_checkout_redirected'"
  ).get().count, 1);

  const missingEventId = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "tracked-appointment",
  }), env);
  assert.match(missingEventId.headers.get("location"), /checkout=unavailable/);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM booking_client_events WHERE event_type='square_checkout_redirected'"
  ).get().count, 1);

  const forged = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "not-the-client-appointment",
    eventId: "square:forged-handoff",
  }), env);
  assert.equal(forged.status, 303);
  assert.match(forged.headers.get("location"), /\/b\/Ab3dE7xQ9wK2\?checkout=unavailable$/);

  database.prepare(
    "UPDATE appointments SET status='confirmed',hold_state='converted' WHERE id='tracked-appointment'"
  ).run();
  const finalized = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "tracked-appointment",
    eventId: "square:finalized-handoff",
  }), env);
  assert.match(finalized.headers.get("location"), /checkout=unavailable/);

  database.prepare("UPDATE booking_tokens SET revoked_at=datetime('now') WHERE id='active-token'").run();
  const revoked = await handleSquareCheckoutRedirect(redirectRequest({
    token: rawToken,
    appointmentId: "tracked-appointment",
    eventId: "square:revoked-handoff",
  }), env);
  assert.match(revoked.headers.get("location"), /checkout=unavailable/);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM booking_client_events WHERE event_type='square_checkout_redirected'"
  ).get().count, 1);
});

test("admin submission responses expose activity summaries and full client history", async () => {
  const database = migratedDatabase();
  insertSubmission(database);
  insertToken(database, { id: "active-token", rawToken: "Ab3dE7xQ9wK2" });
  database.prepare(
    `INSERT INTO booking_client_events (
       id,idempotency_key,submission_id,booking_token_id,appointment_id,event_type,metadata_json,created_at
     ) VALUES
       ('event-open-1','open:one','tracked-submission','active-token',NULL,'booking_link_opened','{"accessState":"active"}','2026-08-05T13:00:00.000Z'),
       ('event-open-2','open:two','tracked-submission','active-token',NULL,'booking_link_opened','{"accessState":"active"}','2026-08-05T14:00:00.000Z'),
       ('event-square','square:one','tracked-submission','active-token',NULL,'square_checkout_redirected','{}','2026-08-05T15:00:00.000Z')`
  ).run();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: "test-admin",
  };

  const listResponse = await handleListSubmissions(adminRequest("/api/admin/submissions"), env);
  assert.equal(listResponse.status, 200, await listResponse.clone().text());
  const listed = (await listResponse.json()).submissions.find((item) => item.id === "tracked-submission");
  assert.deepEqual(listed.clientActivity, {
    bookingLinkOpenCount: 2,
    firstBookingLinkOpenedAt: "2026-08-05T13:00:00.000Z",
    latestBookingLinkOpenedAt: "2026-08-05T14:00:00.000Z",
    squareRedirectCount: 1,
    firstSquareRedirectAt: "2026-08-05T15:00:00.000Z",
    latestSquareRedirectAt: "2026-08-05T15:00:00.000Z",
  });

  const detailResponse = await handleGetSubmission(
    adminRequest("/api/admin/submissions/tracked-submission"),
    env,
    "tracked-submission",
  );
  assert.equal(detailResponse.status, 200, await detailResponse.clone().text());
  const detail = await detailResponse.json();
  assert.deepEqual(detail.clientEvents.map((event) => event.eventType), [
    "booking_link_opened",
    "booking_link_opened",
    "square_checkout_redirected",
  ]);
  assert.deepEqual(detail.clientEvents[0].metadata, { accessState: "active" });
});

test("private booking and Studio surfaces use tracked activity without adding a badge", () => {
  const booking = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(booking, /if \(previewMode \|\| !token\) return;[\s\S]*?\/api\/booking\/access-events/);
  assert.match(booking, /form\.action = "\/api\/booking\/square-redirect"/);
  assert.doesNotMatch(booking, /window\.location\.href = payload\.checkoutUrl/);
  assert.match(studio, /function clientActivitySummaryMarkup\(submission\)/);
  assert.match(studio, /Client opened booking link/);
  assert.match(studio, /Sent to Square records the first-party handoff/);
  assert.match(studio, /data-client-activity-summary/);
  assert.match(studio, /class="request-badge-slot"/);
});
