import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleCreateSubmission,
  handleUpdateSubmission,
} from "../functions/api/submissions/_lib.js";
import {
  handleAdminCompleteAppointment,
  handleAdminCreateBookingToken,
  handleAdminCreateDirectBookingInvite,
  handleAdminRescheduleAppointment,
  handleAdminResolveTattooLifecycleReview,
  handleAdminTattooSettings,
  handleAdminTattooSessionPlan,
  handleCancelAppointment,
  handleBookingContext,
  handleCreateBookingHold,
  handleCreateReplacementCheckout,
  handlePublicConsultationContext,
  handlePublicSessionCheckout,
  handlePublicSessionContext,
  handleReleasePendingBookingHold,
  handleRescheduleAppointment,
  handleRescheduleContext,
  handleSaveBookingSessionPlan,
  handleSquareWebhook,
  reapExpiredBookingHolds,
} from "../functions/api/booking/_lib.js";
import { ingestCrmSourceRecord } from "../functions/api/crm/ingest.js";
import {
  handleAdminResendNotification,
  notifyAppointmentCancelled,
  retryPendingAdminAppointmentNotifications,
} from "../functions/api/notifications/_lib.js";

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
    this.batchQueue = Promise.resolve();
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    const execute = async () => {
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
    };
    const result = this.batchQueue.then(execute, execute);
    this.batchQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function migratedDatabase({ before = "" } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = join(ROOT, "migrations");
  const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    if (before && migration.localeCompare(before) >= 0) break;
    database.exec(readFileSync(join(directory, migration), "utf8"));
  }
  return database;
}

function jsonRequest(path, payload, headers = {}) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

function jsonPatchRequest(path, payload, token) {
  return new Request(`https://example.test${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

function adminJsonRequest(path, payload, token, method = "POST") {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

async function sha256HexForTest(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function squareWebhookSignatureForTest(rawBody, signatureKey, notificationUrl) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${notificationUrl}${rawBody}`),
  );
  return Buffer.from(signature).toString("base64");
}

function squareEnv(database, overrides = {}) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    SQUARE_ACCESS_TOKEN: "square-test-token",
    SQUARE_LOCATION_ID: "square-test-location",
    SQUARE_ENVIRONMENT: "sandbox",
    ...overrides,
  };
}

async function withMockFetch(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonFetchResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rowObject(row) {
  return row ? { ...row } : row;
}

function insertAvailabilityWindow(database, {
  id,
  bookingTypeId = "consult_in_person",
  startAt,
  endAt,
  capacity = 1,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
}) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO availability_windows (
      id, venture, booking_type_id, start_at, end_at, capacity,
      buffer_before_minutes, buffer_after_minutes, is_blackout, active,
      note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,0,1,'Payment contract fixture',?,?)`,
  ).run(
    id,
    "tattooing",
    bookingTypeId,
    startAt,
    endAt,
    capacity,
    bufferBeforeMinutes,
    bufferAfterMinutes,
    now,
    now,
  );
}

function insertSubmissionFixture(database, {
  id,
  type = "consultation",
  status = "new",
  tattooStage = null,
  name = "Payment Client",
  email = "payment@example.test",
  bookingUrl = "",
}) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO submissions (
      id, type, status, source_path, subject, contact_name, contact_email,
      contact_json, payload_json, request_meta_json, files_json, internal_notes,
      booking_url, tattoo_stage, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    type,
    status,
    "/tests/payment-contract/",
    "Payment contract fixture",
    name,
    email,
    JSON.stringify({ name, email }),
    "{}",
    "{}",
    "[]",
    "",
    bookingUrl,
    tattooStage,
    now,
    now,
  );
}

function insertAppointmentFixture(database, {
  id,
  submissionId = null,
  bookingTypeId = "consult_in_person",
  availabilityWindowId = null,
  status = "confirmed",
  purpose = "standalone_consultation",
  name = "Payment Client",
  email = "payment@example.test",
  startAt,
  endAt,
  depositCents = 5000,
  squareOrderId = null,
  squarePaymentLinkId = null,
  squareCheckoutUrl = null,
  holdExpiresAt = null,
  holdState = "converted",
  replacementForAppointmentId = null,
  replacedByAppointmentId = null,
  rescheduleCount = 0,
}) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO appointments (
      id, submission_id, booking_type_id, availability_window_id, status, purpose,
      client_name, client_email, start_at, end_at, deposit_cents, tip_cents,
      currency, square_order_id, square_payment_link_id, square_checkout_url,
      hold_expires_at, hold_state, replacement_for_appointment_id,
      replaced_by_appointment_id, reschedule_count, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    submissionId,
    bookingTypeId,
    availabilityWindowId,
    status,
    purpose,
    name,
    email,
    startAt,
    endAt,
    depositCents,
    0,
    "USD",
    squareOrderId,
    squarePaymentLinkId,
    squareCheckoutUrl,
    holdExpiresAt,
    holdState,
    replacementForAppointmentId,
    replacedByAppointmentId,
    rescheduleCount,
    now,
    now,
  );
}

function insertPaymentFixture(database, {
  id,
  appointmentId,
  checkoutId,
  orderId,
  status = "pending",
  amountCents = 5000,
}) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO deposit_payments (
      id, appointment_id, provider, provider_checkout_id, provider_order_id,
      amount_cents, tip_cents, currency, status, raw_json, created_at, updated_at
    ) VALUES (?,?,'square',?,?,?,?,'USD',?,'{}',?,?)`,
  ).run(
    id,
    appointmentId,
    checkoutId,
    orderId,
    amountCents,
    0,
    status,
    now,
    now,
  );
}

function validCustom(overrides = {}) {
  return {
    type: "tattoo_inquiry",
    name: "Test Client",
    email: "client@example.test",
    age_confirmed: "yes",
    dob: "1990-01-01",
    project_type: "new_piece",
    previous_client: "no",
    placement: "Forearm",
    size: "4 inches",
    budget_range: "$500-$1,000",
    color_preference: "black",
    message: "A symbolic composition with clear visual direction.",
    review_consent: "yes",
    ...overrides,
  };
}

test("all migrations apply with the tattoo lifecycle schema and managed defaults", () => {
  const database = migratedDatabase();
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

  const columns = (table) => new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  assert.ok(columns("submissions").has("tattoo_stage"));
  assert.ok(columns("submissions").has("idempotency_key"));
  assert.ok(columns("booking_tokens").has("purpose"));
  assert.ok(columns("tattoo_settings").has("session_estimate_copy_json"));
  for (const name of [
    "purpose",
    "hold_expires_at",
    "hold_state",
    "completed_at",
    "replacement_for_appointment_id",
    "reschedule_count",
    "cancelled_at",
  ]) assert.ok(columns("appointments").has(name), `appointments.${name}`);

  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const name of ["appointment_events", "tattoo_settings", "tattoo_rate_cards", "special_project_calls"]) {
    assert.ok(tables.has(name), name);
  }

  const rates = Object.fromEntries(database.prepare("SELECT service_key, rate_text FROM tattoo_rate_cards WHERE active = 1").all().map((row) => [row.service_key, row.rate_text]));
  assert.deepEqual(rates, {
    flash: "$150/hr",
    custom: "$200/hr",
    special: "$100+/hr",
    build: "Quoted after review",
  });
  assert.equal(database.prepare("SELECT count(*) AS count FROM special_project_calls WHERE status = 'open'").get().count, 3);
  assert.equal(database.prepare("SELECT lead_time_days FROM tattoo_settings WHERE id = 'default'").get().lead_time_days, 14);
});

test("the applied tattoo baseline keeps its production filename and 0039 stays replay-safe", () => {
  const baseline = readFileSync(
    join(ROOT, "migrations", "0036_tattoo_lifecycle_checkout_holds.sql"),
    "utf8",
  );
  const delta = readFileSync(
    join(ROOT, "migrations", "0039_tattoo_lifecycle_checkout_holds.sql"),
    "utf8",
  );

  assert.match(baseline, /ALTER TABLE submissions ADD COLUMN tattoo_stage/);
  assert.doesNotMatch(delta, /ALTER TABLE\s+/);
  assert.doesNotMatch(delta, /UPDATE submissions SET tattoo_stage/);
  assert.match(delta, /idx_appointments_one_active_token_hold/);
  assert.match(delta, /'build', 'Build Your Own', 'Quoted after review'/);
  assert.match(delta, /'mythic-body-studies'/);
});

test("0039 upgrades only the untouched early Tattoo Settings seed", () => {
  const migrationName = "0039_tattoo_lifecycle_checkout_holds.sql";
  const delta = readFileSync(join(ROOT, "migrations", migrationName), "utf8");
  const earlySeed = [
    "Most project submissions are reviewed within 5–7 business days.",
    2,
    "Walk-in availability is announced through scheduled walk-in windows. Check the tattoo page before traveling to the studio.",
    "saisolehman@artpilltattoohouse.com",
    "2026-07-15 01:32:00",
  ];

  const untouched = migratedDatabase({ before: migrationName });
  untouched.prepare(`
    UPDATE tattoo_settings
    SET review_time_message = ?, lead_time_days = ?, walk_in_guidance = ?,
        support_email = ?, updated_at = ?
    WHERE id = 'default'
  `).run(...earlySeed);
  untouched.exec(delta);
  assert.equal(
    untouched.prepare("SELECT lead_time_days FROM tattoo_settings WHERE id = 'default'").get().lead_time_days,
    14,
  );

  const edited = migratedDatabase({ before: migrationName });
  edited.prepare(`
    UPDATE tattoo_settings
    SET review_time_message = ?, lead_time_days = ?, walk_in_guidance = ?,
        support_email = ?, updated_at = ?
    WHERE id = 'default'
  `).run(earlySeed[0], earlySeed[1], "Studio-edited walk-in guidance.", earlySeed[3], earlySeed[4]);
  edited.exec(delta);
  assert.equal(
    edited.prepare("SELECT lead_time_days FROM tattoo_settings WHERE id = 'default'").get().lead_time_days,
    2,
  );
});

test("Build submissions require intent, snapshot stable published symbol IDs, and are idempotent", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const payload = {
    type: "build_brief",
    name: "Build Client",
    email: "build@example.test",
    age_confirmed: "yes",
    placement: "Upper arm",
    design_intent: "A protective path made from three linked marks.",
    review_consent: "yes",
    symbol_ids: ["maze-path", "maze-room"],
  };
  const headers = { "idempotency-key": "build-contract-test" };

  const first = await handleCreateSubmission(jsonRequest("/api/submissions", payload, headers), env);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.ok(firstBody.submissionId);

  const second = await handleCreateSubmission(jsonRequest("/api/submissions", payload, headers), env);
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.submissionId, firstBody.submissionId);
  assert.equal(secondBody.idempotent, true);
  assert.equal(database.prepare("SELECT count(*) AS count FROM submissions WHERE idempotency_key = ?").get("build-contract-test").count, 1);
  const crmPerson = database.prepare(
    `SELECT p.id,p.display_name
     FROM crm_people p
     JOIN crm_identities i ON i.person_id=p.id
     WHERE i.kind='email' AND i.normalized_value='build@example.test' AND i.active=1`
  ).get();
  assert.equal(crmPerson.display_name, "Build Client");
  assert.deepEqual(
    { ...database.prepare(
      `SELECT person_id,interaction_type,status
       FROM crm_interactions
       WHERE source_provider='local' AND source_type='submission' AND source_id=?`
    ).get(firstBody.submissionId) },
    {
      person_id: crmPerson.id,
      interaction_type: "build_brief",
      status: "new",
    },
  );
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_interactions
     WHERE source_provider='local' AND source_type='submission' AND source_id=?`
  ).get(firstBody.submissionId).count, 1);

  const row = database.prepare("SELECT status, tattoo_stage, payload_json FROM submissions WHERE id = ?").get(firstBody.submissionId);
  const saved = JSON.parse(row.payload_json);
  assert.equal(row.status, "new");
  assert.equal(row.tattoo_stage, "review");
  assert.deepEqual(saved.symbol_ids, ["maze-path", "maze-room"]);
  assert.deepEqual(saved.symbol_snapshot.map((symbol) => symbol.id), saved.symbol_ids);
  assert.equal(saved.design_intent, payload.design_intent);

  const missingIntent = await handleCreateSubmission(jsonRequest("/api/submissions", { ...payload, design_intent: "" }), env);
  assert.equal(missingIntent.status, 400);
});

test("Custom submissions reject underage clients and dates inside the managed lead time", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };

  const underage = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({ dob: "2020-01-01" })), env);
  assert.equal(underage.status, 400);

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tooSoon = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({ requested_date: tomorrow })), env);
  assert.equal(tooSoon.status, 400);
  const body = await tooSoon.json();
  assert.equal(body.code, "REQUESTED_DATE_TOO_SOON");
});

test("preview and direct-session spoofing cannot write through the generic submission endpoint", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };

  for (const type of ["consultation", "build_session", "studio_booking"]) {
    const response = await handleCreateSubmission(jsonRequest("/api/submissions", { type }), env);
    assert.equal(response.status, 400, type);
  }

  const preview = await handleCreateSubmission(jsonRequest(
    "/api/submissions",
    validCustom(),
    { referer: "https://example.test/tattoos/inquire/custom/?preview=1" },
  ), env);
  assert.equal(preview.status, 403);
  assert.equal((await preview.json()).code, "PREVIEW_WRITE_BLOCKED");
  assert.equal(database.prepare("SELECT count(*) AS count FROM submissions").get().count, 0);
});

test("Studio can create a direct private booking invite without a prior inquiry", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const templateResponse = await handleAdminTattooSettings(adminJsonRequest(
    "/api/admin/tattoo/settings",
    {
      settings: {
        sessionEstimateCopy: {
          sectionHeading: "Plan Your Tattoo Session",
          confirmButtonLabel: "Accept This Estimate",
        },
      },
    },
    adminToken,
    "PATCH",
  ), env);
  assert.equal(templateResponse.status, 200);
  const storedTemplate = JSON.parse(database.prepare(
    "SELECT session_estimate_copy_json FROM tattoo_settings WHERE id = 'default'"
  ).get().session_estimate_copy_json);
  assert.equal(storedTemplate.sectionHeading, "Plan Your Tattoo Session");
  assert.equal(storedTemplate.confirmButtonLabel, "Accept This Estimate");

  const response = await handleAdminCreateDirectBookingInvite(adminJsonRequest(
    "/api/admin/booking/direct-invites",
    {
      projectNote: "Approved through an offline conversation.",
      clientEstimateNote: "Plan for one half-day session with room for natural breaks.",
      purpose: "tattoo",
      bookingTypeId: "tattoo_half",
    },
    adminToken,
  ), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.delivery.skipped, true);
  assert.equal(payload.delivery.reason, "not_requested");
  assert.deepEqual(payload.token.allowedBookingTypes, ["tattoo_half"]);

  const submission = database.prepare(
    "SELECT * FROM submissions WHERE id = ?"
  ).get(payload.directInvite.submissionId);
  assert.equal(submission.type, "tattoo_inquiry");
  assert.equal(submission.status, "approved");
  assert.equal(submission.tattoo_stage, "ready_to_book");
  assert.equal(submission.source_path, "/studio/direct-booking-invite");
  assert.equal(submission.contact_name, "");
  assert.equal(submission.contact_email, "");
  assert.equal(submission.internal_notes, "Approved through an offline conversation.");
  assert.equal(JSON.parse(submission.payload_json).direct_booking_invite, "yes");

  const plan = database.prepare(
    "SELECT * FROM tattoo_session_plans WHERE submission_id = ?"
  ).get(submission.id);
  assert.equal(plan.session_category, "one_session");
  assert.equal(plan.split_policy, "not_available");
  assert.equal(plan.estimated_sessions_min, 1);
  assert.equal(plan.estimated_total_minutes_min, 180);
  assert.equal(plan.estimated_total_minutes_max, 180);
  assert.equal(plan.client_acknowledged, 0);
  assert.equal(plan.artist_note, "Plan for one half-day session with room for natural breaks.");
  assert.doesNotMatch(plan.artist_note, /offline conversation/i);

  const rawToken = new URL(payload.token.bookingUrl).searchParams.get("token");
  const context = await handleBookingContext(
    new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`),
    env,
  );
  assert.equal(context.status, 200);
  const contextPayload = await context.json();
  assert.equal(contextPayload.requiresClientDetails, true);
  assert.equal(contextPayload.client.email, "");
  assert.deepEqual(contextPayload.bookingTypes.map((bookingType) => bookingType.id), ["tattoo_half"]);
  assert.equal(contextPayload.sessionPlan.artistNote, "Plan for one half-day session with room for natural breaks.");
  assert.equal(contextPayload.sessionEstimateCopy.sectionHeading, "Plan Your Tattoo Session");
  assert.equal(contextPayload.sessionEstimateCopy.confirmButtonLabel, "Accept This Estimate");
  assert.doesNotMatch(JSON.stringify(contextPayload), /offline conversation/i);

  const acknowledged = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: rawToken,
    preference: "studio_plan",
    acknowledged: true,
  }), env);
  assert.equal(acknowledged.status, 200);

  const start = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 75 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO availability_windows (
      id, venture, booking_type_id, start_at, end_at, capacity,
      buffer_before_minutes, buffer_after_minutes, is_blackout, active,
      note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "direct-invite-window",
    "tattooing",
    "tattoo_half",
    start,
    end,
    1,
    0,
    0,
    0,
    1,
    "Contract test",
    now,
    now,
  );
  const missingClientDetails = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_half",
    availabilityWindowId: "direct-invite-window",
  }), env);
  assert.equal(missingClientDetails.status, 400);
  const unclaimedSubmission = database.prepare(
    "SELECT contact_name, contact_email, contact_phone FROM submissions WHERE id = ?"
  ).get(submission.id);
  assert.equal(unclaimedSubmission.contact_name, "");
  assert.equal(unclaimedSubmission.contact_email, "");
  assert.equal(unclaimedSubmission.contact_phone, null);

  const hold = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_half",
    availabilityWindowId: "direct-invite-window",
    clientName: "Direct Client",
    clientEmail: "DIRECT@example.test",
    clientPhone: "404-555-0119",
  }), env);
  assert.equal(hold.status, 200);
  const holdPayload = await hold.json();
  const crmAppointment = database.prepare(
    `SELECT i.person_id,i.status,p.display_name
     FROM crm_interactions i
     JOIN crm_people p ON p.id=i.person_id
     WHERE i.source_provider='local' AND i.source_type='appointment' AND i.source_id=?`
  ).get(holdPayload.appointment.id);
  assert.ok(crmAppointment.person_id);
  assert.equal(crmAppointment.status, "pending_deposit");
  assert.equal(crmAppointment.display_name, "Direct Client");
  const claimedSubmission = database.prepare(
    "SELECT contact_name, contact_email, contact_phone, internal_notes FROM submissions WHERE id = ?"
  ).get(submission.id);
  assert.equal(claimedSubmission.contact_name, "Direct Client");
  assert.equal(claimedSubmission.contact_email, "direct@example.test");
  assert.equal(claimedSubmission.contact_phone, "404-555-0119");
  assert.equal(claimedSubmission.internal_notes, "Approved through an offline conversation.");
});

test("Studio direct invites can route a client into prerequisite consultation", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const response = await handleAdminCreateDirectBookingInvite(adminJsonRequest(
    "/api/admin/booking/direct-invites",
    {
      purpose: "consultation",
      bookingTypeId: "consult_in_person",
    },
    adminToken,
  ), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.token.purpose, "consultation");
  const submission = database.prepare(
    "SELECT tattoo_stage FROM submissions WHERE id = ?"
  ).get(payload.directInvite.submissionId);
  assert.equal(submission.tattoo_stage, "consultation_required");
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM tattoo_session_plans WHERE submission_id = ?")
      .get(payload.directInvite.submissionId).count,
    0,
  );
});

test("large cover-ups move through prerequisite consultation completion before tattoo access", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };

  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    project_type: "large_cover_up",
  })), env);
  assert.equal(created.status, 200);
  const submissionId = (await created.json()).submissionId;

  const approved = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(approved.status, 200);
  const approvedRow = database.prepare("SELECT status, tattoo_stage FROM submissions WHERE id = ?").get(submissionId);
  assert.equal(approvedRow.status, "approved");
  assert.equal(approvedRow.tattoo_stage, "consultation_required");

  const consultationTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "consultation",
      allowedBookingTypes: ["consult_in_person"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(consultationTokenResponse.status, 200);
  const consultationToken = (await consultationTokenResponse.json()).token;
  assert.equal(consultationToken.purpose, "consultation");
  assert.deepEqual(consultationToken.allowedBookingTypes, ["consult_in_person"]);

  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO appointments (
      id, submission_id, booking_token_id, booking_type_id, status, purpose,
      client_name, client_email, start_at, end_at, deposit_cents, currency,
      hold_state, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "coverup-consultation",
    submissionId,
    consultationToken.id,
    "consult_in_person",
    "confirmed",
    "prerequisite_consultation",
    "Test Client",
    "client@example.test",
    start,
    end,
    5000,
    "USD",
    "converted",
    now,
    now,
  );
  database.prepare(
    "UPDATE submissions SET tattoo_stage = 'consultation_scheduled', updated_at = ? WHERE id = ?",
  ).run(now, submissionId);

  const completed = await handleAdminCompleteAppointment(adminJsonRequest(
    "/api/admin/booking/appointments/coverup-consultation/complete",
    { note: "Prerequisite planning completed." },
    adminToken,
  ), env, "coverup-consultation");
  assert.equal(completed.status, 200);
  assert.equal(
    database.prepare("SELECT tattoo_stage FROM submissions WHERE id = ?").get(submissionId).tattoo_stage,
    "consultation_complete",
  );

  const sessionPlan = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "multiple_sessions",
      splitPolicy: "required",
      estimatedSessionsMin: 2,
      estimatedSessionsMax: 3,
      estimatedTotalMinutesMin: 300,
      estimatedTotalMinutesMax: 480,
      artistNote: "Final plan after the prerequisite consultation.",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(sessionPlan.status, 200);
  assert.equal(
    database.prepare("SELECT tattoo_stage FROM submissions WHERE id = ?").get(submissionId).tattoo_stage,
    "ready_to_book",
  );

  const tattooTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_quarter"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(tattooTokenResponse.status, 200);
  const tattooToken = (await tattooTokenResponse.json()).token;
  assert.equal(tattooToken.purpose, "tattoo");
  assert.deepEqual(tattooToken.allowedBookingTypes, ["tattoo_quarter"]);
});

test("private booking holds enforce the token and parent lifecycle inside the atomic insert", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    project_type: "large_cover_up",
  })), env);
  const submissionId = (await created.json()).submissionId;
  const approved = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(approved.status, 200);

  const tokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "consultation",
      allowedBookingTypes: ["consult_in_person"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()).token;
  const rawToken = new URL(token.bookingUrl).searchParams.get("token");

  const start = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 72.5 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO availability_windows (
      id, venture, booking_type_id, start_at, end_at, capacity,
      buffer_before_minutes, buffer_after_minutes, is_blackout, active,
      note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "private-consult-window",
    "tattooing",
    "consult_in_person",
    start,
    end,
    1,
    0,
    0,
    0,
    1,
    "Contract test",
    now,
    now,
  );

  const holdResponse = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "consult_in_person",
    availabilityWindowId: "private-consult-window",
  }), env);
  const hold = await holdResponse.json();
  assert.equal(holdResponse.status, 200, JSON.stringify(hold));
  assert.equal(hold.appointment.purpose, "prerequisite_consultation");

  const blockedLifecycleEdit = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "cancelled" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(blockedLifecycleEdit.status, 409);
  assert.equal((await blockedLifecycleEdit.json()).code, "ACTIVE_APPOINTMENT_BLOCKS_LIFECYCLE_EDIT");
});

test("Neutral public sessions expose the managed Build service while the legacy consultation alias stays consultation-only", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };

  const neutral = await handlePublicSessionContext(
    new Request("https://example.test/api/booking/public-session/context?type=build_in_person"),
    env,
  );
  assert.equal(neutral.status, 200);
  const neutralBody = await neutral.json();
  assert.deepEqual(neutralBody.bookingTypes.map((type) => type.id), ["build_in_person"]);
  assert.equal(neutralBody.bookingTypes[0].durationMinutes, 90);
  assert.equal(neutralBody.bookingTypes[0].depositCents, 5000);

  const rejectedLegacyBuild = await handlePublicConsultationContext(
    new Request("https://example.test/api/booking/public-consultation/context?type=build_in_person"),
    env,
  );
  assert.equal(rejectedLegacyBuild.status, 503);

  const legacy = await handlePublicConsultationContext(
    new Request("https://example.test/api/booking/public-consultation/context"),
    env,
  );
  assert.equal(legacy.status, 200);
  const legacyBody = await legacy.json();
  assert.ok(legacyBody.bookingTypes.length > 0);
  assert.ok(legacyBody.bookingTypes.every((type) => ["consult_in_person", "consult_virtual"].includes(type.id)));
});

test("direct Build checkout atomically creates the correct server-owned lane and keeps retry keys immutable", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const start = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 97.5 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO availability_windows (
      id, venture, booking_type_id, start_at, end_at, capacity,
      buffer_before_minutes, buffer_after_minutes, is_blackout, active,
      note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "direct-build-window",
    "tattooing",
    "build_in_person",
    start,
    end,
    1,
    0,
    0,
    0,
    1,
    "Contract test",
    now,
    now,
  );
  const payload = {
    bookingTypeId: "build_in_person",
    availabilityWindowId: "direct-build-window",
    name: "Build Client",
    email: "build-checkout@example.test",
    direction: "A symbolic construction.",
    understand: "yes",
    age_confirmed: "yes",
    source_path: "/booking/studio/",
    subject: "Misleading client-controlled lane",
  };
  const first = await handlePublicSessionCheckout(jsonRequest(
    "/api/booking/public-session/checkout",
    payload,
    { "idempotency-key": "direct-build-contract" },
  ), env);
  assert.equal(first.status, 503);
  const submission = database.prepare(
    "SELECT * FROM submissions WHERE idempotency_key = ?",
  ).get("direct-build-contract");
  assert.equal(submission.type, "build_session");
  assert.equal(submission.source_path, "/tattoos/build/in-person/");
  assert.equal(submission.subject, "New In-Person Build Session");
  const appointment = database.prepare(
    "SELECT * FROM appointments WHERE submission_id = ?",
  ).get(submission.id);
  assert.equal(appointment.purpose, "build_session");

  database.prepare("UPDATE appointments SET status = 'cancelled', hold_state = 'released' WHERE id = ?")
    .run(appointment.id);
  database.prepare("UPDATE submissions SET status = 'cancelled' WHERE id = ?").run(submission.id);
  const retried = await handlePublicSessionCheckout(jsonRequest(
    "/api/booking/public-session/checkout",
    payload,
    { "idempotency-key": "direct-build-contract" },
  ), env);
  assert.equal(retried.status, 409);
  assert.equal((await retried.json()).code, "IDEMPOTENCY_REQUEST_FINALIZED");
});

test("client release terminally closes every direct public booking parent", async () => {
  const fixtures = [
    { purpose: "standalone_consultation", type: "consultation", bookingTypeId: "consult_in_person" },
    { purpose: "build_session", type: "build_session", bookingTypeId: "build_in_person" },
    { purpose: "studio", type: "studio_booking", bookingTypeId: "studio_visit" },
  ];
  for (const fixture of fixtures) {
    const database = migratedDatabase();
    const submissionId = `release-parent-${fixture.purpose}`;
    const appointmentId = `release-appointment-${fixture.purpose}`;
    const startAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 97 * 60 * 60 * 1000).toISOString();
    insertSubmissionFixture(database, {
      id: submissionId,
      type: fixture.type,
      status: "new",
      email: `${fixture.purpose}@example.test`,
    });
    insertAppointmentFixture(database, {
      id: appointmentId,
      submissionId,
      bookingTypeId: fixture.bookingTypeId,
      status: "deposit_pending",
      purpose: fixture.purpose,
      email: `${fixture.purpose}@example.test`,
      startAt,
      endAt,
      holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      holdState: "active",
    });

    const response = await handleReleasePendingBookingHold(jsonRequest(
      "/api/booking/pending-hold/release",
      {
        appointmentId,
        email: `${fixture.purpose}@example.test`,
        reason: "Choose another time",
      },
    ), { SUBMISSIONS_DB: new LocalD1(database) });
    assert.equal(response.status, 200, `${fixture.purpose}: ${await response.text()}`);
    const parent = database.prepare("SELECT status, booking_url FROM submissions WHERE id = ?").get(submissionId);
    assert.equal(parent.status, "cancelled", fixture.purpose);
    assert.equal(parent.booking_url, "", fixture.purpose);
    const appointment = database.prepare("SELECT status, hold_state FROM appointments WHERE id = ?").get(appointmentId);
    assert.equal(appointment.status, "cancelled", fixture.purpose);
    assert.equal(appointment.hold_state, "released", fixture.purpose);
  }
});

test("completed Square webhooks fail for retry when order reconciliation is transiently unavailable", async () => {
  const database = migratedDatabase();
  const appointmentId = "webhook-retry-appointment";
  const orderId = "webhook-retry-order";
  insertAppointmentFixture(database, {
    id: appointmentId,
    status: "deposit_pending",
    purpose: "standalone_consultation",
    startAt: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 97 * 60 * 60 * 1000).toISOString(),
    squareOrderId: orderId,
    squarePaymentLinkId: "webhook-retry-link",
    squareCheckoutUrl: "https://square.example.test/webhook-retry",
    holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: "webhook-retry-payment-row",
    appointmentId,
    checkoutId: "webhook-retry-link",
    orderId,
  });
  const notificationUrl = "https://example.test/api/square/webhook";
  const signatureKey = "webhook-retry-signature";
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: { id: "square-payment", order_id: orderId, status: "COMPLETED" },
      },
    },
  });
  const signature = await squareWebhookSignatureForTest(rawBody, signatureKey, notificationUrl);
  const makeRequest = () => new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  const env = squareEnv(database, {
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const response = await withMockFetch(
    async () => jsonFetchResponse({ errors: [{ detail: "Temporary Square order outage" }] }, 503),
    () => handleSquareWebhook(makeRequest(), env),
  );
  const payload = await response.json();
  assert.equal(response.status, 500, JSON.stringify(payload));
  assert.match(payload.detail, /Temporary Square order outage/);
  assert.equal(database.prepare("SELECT status FROM appointments WHERE id = ?").get(appointmentId).status, "deposit_pending");
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE appointment_id = ?").get(appointmentId).status, "pending");
});

test("a completed Square webhook settles the booking once in People", async () => {
  const database = migratedDatabase();
  const appointmentId = "crm-paid-appointment";
  const paymentRowId = "crm-paid-payment";
  const orderId = "crm-paid-order";
  insertAppointmentFixture(database, {
    id: appointmentId,
    status: "deposit_pending",
    purpose: "standalone_consultation",
    name: "Paid CRM Client",
    email: "paid-crm@example.test",
    startAt: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 97 * 60 * 60 * 1000).toISOString(),
    depositCents: 5000,
    squareOrderId: orderId,
    squarePaymentLinkId: "crm-paid-link",
    squareCheckoutUrl: "https://square.example.test/crm-paid",
    holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: paymentRowId,
    appointmentId,
    checkoutId: "crm-paid-link",
    orderId,
    amountCents: 5000,
  });

  const notificationUrl = "https://example.test/api/square/webhook";
  const signatureKey = "crm-paid-webhook-signature";
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "crm-paid-square-payment",
          order_id: orderId,
          status: "COMPLETED",
        },
      },
    },
  });
  const signature = await squareWebhookSignatureForTest(rawBody, signatureKey, notificationUrl);
  const makeRequest = () => new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  const env = squareEnv(database, {
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const responses = await withMockFetch(async (url) => {
    assert.match(String(url), new RegExp(`/v2/orders/${orderId}$`));
    return jsonFetchResponse({
      order: {
        id: orderId,
        state: "COMPLETED",
        net_amount_due_money: { amount: 0, currency: "USD" },
      },
    });
  }, async () => [
    await handleSquareWebhook(makeRequest(), env),
    await handleSquareWebhook(makeRequest(), env),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200, await response.text());
  }

  assert.equal(database.prepare(
    "SELECT status FROM appointments WHERE id=?"
  ).get(appointmentId).status, "confirmed");
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE id=?"
  ).get(paymentRowId).status, "paid");
  assert.deepEqual(
    { ...database.prepare(
      `SELECT status,person_id FROM crm_interactions
       WHERE source_provider='local' AND source_type='appointment' AND source_id=?`
    ).get(appointmentId) },
    {
      status: "confirmed",
      person_id: database.prepare(
        "SELECT person_id FROM crm_transactions WHERE source_provider='local' AND source_type='deposit_payment' AND source_id=?"
      ).get(paymentRowId).person_id,
    },
  );
  assert.deepEqual(
    { ...database.prepare(
      `SELECT status,amount_cents
       FROM crm_transactions
       WHERE source_provider='local' AND source_type='deposit_payment' AND source_id=?`
    ).get(paymentRowId) },
    { status: "settled", amount_cents: 5000 },
  );
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_transactions
     WHERE source_provider='local' AND source_type='deposit_payment' AND source_id=?`
  ).get(paymentRowId).count, 1);
});

test("a paid replacement updates both appointment states in People", async () => {
  const database = migratedDatabase();
  const originalId = "crm-replacement-original";
  const replacementId = "crm-replacement-new";
  const orderId = "crm-replacement-order";
  const originalStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const originalEnd = new Date(new Date(originalStart).getTime() + 45 * 60 * 1000).toISOString();
  const replacementStart = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const replacementEnd = new Date(new Date(replacementStart).getTime() + 45 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: originalId,
    status: "confirmed",
    name: "Replacement CRM Client",
    email: "crm-replacement@example.test",
    startAt: originalStart,
    endAt: originalEnd,
    holdState: "converted",
  });
  insertPaymentFixture(database, {
    id: "crm-replacement-original-payment",
    appointmentId: originalId,
    checkoutId: "crm-replacement-original-link",
    orderId: "crm-replacement-original-order",
    status: "paid",
  });
  insertAppointmentFixture(database, {
    id: replacementId,
    status: "deposit_pending",
    name: "Replacement CRM Client",
    email: "crm-replacement@example.test",
    startAt: replacementStart,
    endAt: replacementEnd,
    squareOrderId: orderId,
    squarePaymentLinkId: "crm-replacement-link",
    squareCheckoutUrl: "https://square.example.test/crm-replacement",
    holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    holdState: "active",
    replacementForAppointmentId: originalId,
    rescheduleCount: 1,
  });
  insertPaymentFixture(database, {
    id: "crm-replacement-new-payment",
    appointmentId: replacementId,
    checkoutId: "crm-replacement-link",
    orderId,
    status: "pending",
  });
  await ingestCrmSourceRecord(new LocalD1(database), {
    contact: {
      displayName: "Replacement CRM Client",
      email: "crm-replacement@example.test",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: originalId,
      nodeId: "node-tattoos",
      interactionType: "appointment",
      status: "confirmed",
      occurredAt: originalStart,
    },
  });

  const notificationUrl = "https://example.test/api/square/webhook";
  const signatureKey = "crm-replacement-webhook-signature";
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "crm-replacement-square-payment",
          order_id: orderId,
          status: "COMPLETED",
        },
      },
    },
  });
  const signature = await squareWebhookSignatureForTest(rawBody, signatureKey, notificationUrl);
  const makeRequest = () => new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  const env = squareEnv(database, {
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const responses = await withMockFetch(async (url) => {
    assert.match(String(url), new RegExp(`/v2/orders/${orderId}$`));
    return jsonFetchResponse({
      order: {
        id: orderId,
        state: "COMPLETED",
        net_amount_due_money: { amount: 0, currency: "USD" },
      },
    });
  }, async () => [
    await handleSquareWebhook(makeRequest(), env),
    await handleSquareWebhook(makeRequest(), env),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200, await response.text());
  }

  assert.deepEqual(
    database.prepare(`
      SELECT id,status FROM appointments WHERE id IN (?,?) ORDER BY id
    `).all(replacementId, originalId).map((row) => ({ ...row })),
    [
      { id: replacementId, status: "confirmed" },
      { id: originalId, status: "cancelled" },
    ],
  );
  assert.deepEqual(
    database.prepare(`
      SELECT source_id,status FROM crm_interactions
      WHERE source_provider='local' AND source_type='appointment'
        AND source_id IN (?,?)
      ORDER BY source_id
    `).all(replacementId, originalId).map((row) => ({ ...row })),
    [
      { source_id: replacementId, status: "confirmed" },
      { source_id: originalId, status: "cancelled" },
    ],
  );
});

test("pending admin appointment notifications survive the request and retry from the scheduler", async () => {
  const database = migratedDatabase();
  const appointmentId = "durable-admin-notification";
  const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: appointmentId,
    status: "confirmed",
    purpose: "tattoo",
    bookingTypeId: "tattoo_full",
    email: "collector@example.test",
    startAt: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 102 * 60 * 60 * 1000).toISOString(),
  });
  database.prepare(
    `INSERT INTO notification_deliveries (
      id, channel, template_key, recipient, subject, related_type,
      related_id, idempotency_key, status, error, sent_at, created_at
    ) VALUES (?, 'email', 'admin_appointment_confirmed', ?, NULL, 'appointment',
              ?, ?, 'pending', NULL, NULL, ?)`
  ).run(
    "durable-admin-notification-delivery",
    "studio@example.test",
    appointmentId,
    `admin_appointment_confirmed:${appointmentId}`,
    createdAt,
  );

  const sent = [];
  const result = await retryPendingAdminAppointmentNotifications({
    SUBMISSIONS_DB: new LocalD1(database),
    ADMIN_NOTIFICATION_EMAIL: "studio@example.test",
    ADMIN_NOTIFICATION_FROM_EMAIL: "notifications@example.test",
    NOTIFICATION_REPLY_TO: "studio@example.test",
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: "durable-admin-notification-message" };
      },
    },
  });

  assert.deepEqual(result, { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "studio@example.test");
  assert.match(sent[0].subject, /Booking confirmed/);
  assert.equal(database.prepare(
    "SELECT status FROM notification_deliveries WHERE idempotency_key = ?",
  ).get(`admin_appointment_confirmed:${appointmentId}`).status, "sent");
});

test("expired replacement holds never expose a stale Square checkout URL", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 24.5 * 60 * 60 * 1000).toISOString();
  const expiredAt = new Date(now.getTime() - 60 * 1000).toISOString();
  const createdAt = now.toISOString();
  database.prepare(
    `INSERT INTO appointments (
      id, booking_type_id, status, purpose, client_name, client_email,
      start_at, end_at, deposit_cents, currency, hold_state, reschedule_count,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "original-reschedule",
    "consult_in_person",
    "confirmed",
    "standalone_consultation",
    "Reschedule Client",
    "reschedule@example.test",
    start,
    end,
    5000,
    "USD",
    "converted",
    0,
    createdAt,
    createdAt,
  );
  database.prepare(
    `INSERT INTO appointments (
      id, booking_type_id, status, purpose, client_name, client_email,
      start_at, end_at, deposit_cents, currency, square_checkout_url,
      hold_expires_at, hold_state, replacement_for_appointment_id,
      reschedule_count, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "expired-replacement",
    "consult_in_person",
    "pending_deposit",
    "standalone_consultation",
    "Reschedule Client",
    "reschedule@example.test",
    start,
    end,
    5000,
    "USD",
    "https://square.example.test/stale-checkout",
    expiredAt,
    "active",
    "original-reschedule",
    1,
    createdAt,
    createdAt,
  );

  const response = await handleRescheduleContext(jsonRequest("/api/booking/reschedule/context", {
    appointmentId: "original-reschedule",
    email: "reschedule@example.test",
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pendingCheckout.resumable, false);
  assert.equal(payload.pendingCheckout.checkoutUrl, "");

  const wrongEmail = await handleRescheduleContext(jsonRequest("/api/booking/reschedule/context", {
    appointmentId: "original-reschedule",
    email: "wrong@example.test",
  }), env);
  assert.equal(wrongEmail.status, 403);
});

test("admin reschedule atomically enforces availability and increments calendar revision state", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const now = new Date().toISOString();
  const originalStart = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const originalEnd = new Date(Date.now() + 96.5 * 60 * 60 * 1000).toISOString();
  // The target overlaps only the appointment being moved. Preflight and the
  // atomic update must both exclude that original from capacity checks.
  const targetStart = new Date(Date.now() + 96.25 * 60 * 60 * 1000).toISOString();
  const targetEnd = new Date(Date.now() + 96.75 * 60 * 60 * 1000).toISOString();
  database.prepare(
    `INSERT INTO availability_windows (
      id, venture, booking_type_id, start_at, end_at, capacity,
      buffer_before_minutes, buffer_after_minutes, is_blackout, active,
      note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "reschedule-target",
    "tattooing",
    "consult_in_person",
    targetStart,
    targetEnd,
    1,
    0,
    0,
    0,
    1,
    "Contract test target",
    now,
    now,
  );
  database.prepare(
    `INSERT INTO appointments (
      id, booking_type_id, status, purpose, client_name, client_email,
      start_at, end_at, deposit_cents, currency, hold_state,
      reschedule_count, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "admin-reschedule-contract",
    "consult_in_person",
    "confirmed",
    "standalone_consultation",
    "Move Client",
    "move@example.test",
    originalStart,
    originalEnd,
    5000,
    "USD",
    "converted",
    0,
    now,
    now,
  );

  const response = await handleAdminRescheduleAppointment(adminJsonRequest(
    "/api/admin/booking/appointments/admin-reschedule-contract/reschedule",
    { availabilityWindowId: "reschedule-target", note: "Contract move" },
    adminToken,
  ), env, "admin-reschedule-contract");
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.appointment.rescheduleCount, 1);
  assert.equal(payload.appointment.startAt, targetStart);
});

test("client and admin reschedules surface Zoom recreation attention", async () => {
  for (const actor of ["client", "admin"]) {
    const database = migratedDatabase();
    const appointmentId = `${actor}-zoom-reschedule`;
    const targetId = `${actor}-zoom-target`;
    const adminToken = "test-admin-token";
    const now = new Date().toISOString();
    const originalStart = new Date(Date.now() + 144 * 60 * 60 * 1000).toISOString();
    const originalEnd = new Date(Date.now() + 144.75 * 60 * 60 * 1000).toISOString();
    const targetStart = new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString();
    const targetEnd = new Date(Date.now() + 168.75 * 60 * 60 * 1000).toISOString();
    insertAvailabilityWindow(database, {
      id: targetId,
      bookingTypeId: "consult_virtual",
      startAt: targetStart,
      endAt: targetEnd,
    });
    insertAppointmentFixture(database, {
      id: appointmentId,
      bookingTypeId: "consult_virtual",
      status: "confirmed",
      purpose: "standalone_consultation",
      email: `${actor}-zoom@example.test`,
      startAt: originalStart,
      endAt: originalEnd,
      holdState: "converted",
    });
    database.prepare(
      `INSERT INTO appointment_meetings (
        id, appointment_id, provider, provider_meeting_id, join_url,
        password, raw_json, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      `${actor}-meeting-row`,
      appointmentId,
      "zoom",
      `${actor}-old-zoom-meeting`,
      `https://zoom.example.test/${actor}-old`,
      "",
      "{}",
      now,
      now,
    );
    const env = {
      SUBMISSIONS_DB: new LocalD1(database),
      SUBMISSIONS_ADMIN_TOKEN: adminToken,
      PUBLIC_SITE_URL: "https://example.test",
      ZOOM_ACCOUNT_ID: "zoom-account",
      ZOOM_CLIENT_ID: "zoom-client",
      ZOOM_CLIENT_SECRET: "zoom-secret",
      ZOOM_HOST_USER_ID: "zoom-host",
    };
    const response = await withMockFetch(async (input, options = {}) => {
      const url = String(input);
      const method = options.method || "GET";
      if (url.includes("zoom.us/oauth/token")) {
        return jsonFetchResponse({ access_token: "zoom-access-token" });
      }
      if (url.includes("api.zoom.us/v2/meetings/") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("api.zoom.us/v2/users/") && method === "POST") {
        return jsonFetchResponse({ message: "Zoom recreation failed" }, 503);
      }
      throw new Error(`Unexpected fetch in Zoom reschedule test: ${method} ${url}`);
    }, () => actor === "admin"
      ? handleAdminRescheduleAppointment(adminJsonRequest(
        `/api/admin/booking/appointments/${appointmentId}/reschedule`,
        { availabilityWindowId: targetId, note: "Move virtual consultation" },
        adminToken,
      ), env, appointmentId)
      : handleRescheduleAppointment(jsonRequest("/api/booking/reschedule", {
        appointmentId,
        email: `${actor}-zoom@example.test`,
        availabilityWindowId: targetId,
      }), env));
    const payload = await response.json();
    assert.equal(response.status, 200, `${actor}: ${JSON.stringify(payload)}`);
    assert.equal(payload.meetingNeedsAttention, true, actor);
    assert.match(payload.meetingError, /Zoom recreation failed/, actor);
    assert.equal(payload.appointment.startAt, targetStart, actor);
    assert.equal(
      database.prepare(
        "SELECT count(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'zoom_creation_attention'",
      ).get(appointmentId).count,
      1,
      actor,
    );
  }
});

test("the first Flash approval reserves the managed design and a competing approval conflicts", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
  };
  const flash = database.prepare(
    "SELECT id FROM flash_items WHERE state = 'available' AND claimable = 1 ORDER BY id LIMIT 1",
  ).get();
  assert.ok(flash?.id, "expected seeded claimable Flash");

  const claim = (name, email) => ({
    type: "flash_claim",
    name,
    email,
    age_confirmed: "yes",
    selected_flash: flash.id,
    placement: "Forearm",
    claim_bid: "$300-$600",
    review_consent: "yes",
    flash_claim_acknowledged: "yes",
    session_plan_acknowledged: "yes",
  });
  const firstCreate = await handleCreateSubmission(jsonRequest("/api/submissions", claim("First Claim", "first@example.test")), env);
  const secondCreate = await handleCreateSubmission(jsonRequest("/api/submissions", claim("Second Claim", "second@example.test")), env);
  assert.equal(firstCreate.status, 200);
  assert.equal(secondCreate.status, 200);
  const firstId = (await firstCreate.json()).submissionId;
  const secondId = (await secondCreate.json()).submissionId;

  const firstApproval = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${firstId}`, { status: "approved" }, adminToken),
    env,
    firstId,
  );
  assert.equal(firstApproval.status, 200);
  assert.equal(database.prepare("SELECT reserved_submission_id FROM flash_items WHERE id = ?").get(flash.id).reserved_submission_id, firstId);

  const competingApproval = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${secondId}`, { status: "approved" }, adminToken),
    env,
    secondId,
  );
  assert.equal(competingApproval.status, 409);
  const conflict = await competingApproval.json();
  assert.equal(conflict.code, "FLASH_RESERVATION_CONFLICT");
  assert.equal(database.prepare("SELECT reserved_submission_id FROM flash_items WHERE id = ?").get(flash.id).reserved_submission_id, firstId);
});

test("Flash claim acknowledgement and browser retry keys are enforced end to end", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const flash = database.prepare(
    "SELECT id FROM flash_items WHERE state = 'available' AND claimable = 1 ORDER BY id LIMIT 1",
  ).get();
  const response = await handleCreateSubmission(jsonRequest("/api/submissions", {
    type: "flash_claim",
    name: "Missing Acknowledgement",
    email: "flash@example.test",
    age_confirmed: "yes",
    selected_flash: flash.id,
    placement: "Forearm",
    claim_bid: "$300-$600",
    review_consent: "yes",
    session_plan_acknowledged: "yes",
  }), env);
  assert.equal(response.status, 400);

  const submissionClient = readFileSync(join(ROOT, "js", "submission-form.js"), "utf8");
  const bookingClient = readFileSync(join(ROOT, "js", "booking-calendar.js"), "utf8");
  const mazeSource = readFileSync(join(ROOT, "apps", "maze", "src", "App.tsx"), "utf8");
  for (const source of [submissionClient, bookingClient, mazeSource]) {
    assert.match(source, /idempotency-key/);
  }
});

test("Worker routes expose neutral public sessions, lifecycle actions, settings, and the five-minute reaper", () => {
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const submissionsStudio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const privateBookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  for (const route of [
    "/api/booking/public-session/context",
    "/api/booking/public-session/checkout",
    "/api/booking/pending-hold",
    "/api/booking/pending-hold/release",
    "/api/booking/reschedule/context",
    "/api/booking/reschedule",
    "/api/booking/replacement-checkout",
    "/api/admin/booking/direct-invites",
    "/api/tattoo/settings",
    "/api/admin/tattoo/settings",
  ]) assert.match(worker, new RegExp(route.replaceAll("/", "\\/")), route);
  assert.match(worker, /appointmentCompleteMatch/);
  assert.match(worker, /handleAdminCompleteAppointment/);
  assert.match(worker, /lifecycleReviewResolveMatch/);
  assert.match(worker, /handleAdminResolveTattooLifecycleReview/);
  assert.match(worker, /handleAdminRescheduleAppointment/);
  assert.match(worker, /appointmentRescheduleMatch/);
  assert.match(worker, /tattoos\/flash\/detail\/index\.html/);
  assert.match(submissionsStudio, /Resolve Historic Lifecycle/);
  assert.match(submissionsStudio, /data-resolve-historic-lifecycle/);
  assert.match(submissionsStudio, /resolveHistorical/);
  assert.match(submissionsStudio, /data-direct-invite-form/);
  assert.match(privateBookingPage, /id="clientDetailsSection"/);
  assert.match(privateBookingPage, /clientNameInput/);
  assert.match(privateBookingPage, /clientEmailInput/);
  assert.match(privateBookingPage, /clientPhoneInput/);
  assert.match(privateBookingPage, /The composition is planned across more than one sitting\./);
  assert.match(privateBookingPage, /data-phone-menu/);
  assert.match(privateBookingPage, /href="tel:\$\{e164\}"/);
  assert.match(privateBookingPage, /href="sms:\$\{e164\}"/);
  assert.match(wrangler, /\*\/5 \* \* \* \*/);
});

test("flagged prerequisite consultations resolve from confirmed and completed history", async () => {
  for (const appointmentStatus of ["confirmed", "completed"]) {
    const database = migratedDatabase();
    const adminToken = "test-admin-token";
    const env = {
      SUBMISSIONS_DB: new LocalD1(database),
      SUBMISSIONS_ADMIN_TOKEN: adminToken,
      PUBLIC_SITE_URL: "https://example.test",
    };
    const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
      project_type: "large_cover_up",
      email: `${appointmentStatus}-historic@example.test`,
    })), env);
    const submissionId = (await created.json()).submissionId;
    const appointmentId = `historic-prerequisite-${appointmentStatus}`;
    const now = new Date().toISOString();
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    database.prepare(
      `UPDATE submissions
       SET status = 'booked', tattoo_stage = 'consultation_required',
           lifecycle_review_required = 1, lifecycle_review_note = 'Historic prerequisite requires review',
           updated_at = ? WHERE id = ?`,
    ).run(now, submissionId);
    database.prepare(
      `INSERT INTO appointments (
        id, submission_id, booking_type_id, status, purpose, client_name,
        client_email, start_at, end_at, deposit_cents, currency, hold_state,
        completed_at, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      appointmentId,
      submissionId,
      "consult_in_person",
      appointmentStatus,
      "prerequisite_consultation",
      "Historic Client",
      `${appointmentStatus}-historic@example.test`,
      start,
      end,
      5000,
      "USD",
      "converted",
      appointmentStatus === "completed" ? end : null,
      now,
      now,
    );

    const response = appointmentStatus === "confirmed"
      ? await handleAdminCompleteAppointment(adminJsonRequest(
        `/api/admin/booking/appointments/${appointmentId}/complete`,
        { resolveHistorical: true, note: "Confirmed historic prerequisite reviewed." },
        adminToken,
      ), env, appointmentId)
      : await handleAdminResolveTattooLifecycleReview(adminJsonRequest(
        `/api/admin/booking/lifecycle-review/${submissionId}/resolve`,
        { appointmentId, note: "Completed historic prerequisite reviewed." },
        adminToken,
      ), env, submissionId);
    const payload = await response.json();
    assert.equal(response.status, 200, `${appointmentStatus}: ${JSON.stringify(payload)}`);
    assert.equal(payload.historicalResolved, true);
    const parent = database.prepare(
      `SELECT status, tattoo_stage, lifecycle_review_required, lifecycle_review_note
       FROM submissions WHERE id = ?`,
    ).get(submissionId);
    assert.equal(parent.status, "approved");
    assert.equal(parent.tattoo_stage, "consultation_complete");
    assert.equal(parent.lifecycle_review_required, 0);
    assert.equal(parent.lifecycle_review_note, "");
    assert.equal(database.prepare("SELECT status FROM appointments WHERE id = ?").get(appointmentId).status, "completed");
    assert.equal(
      database.prepare(
        "SELECT count(*) AS count FROM submission_events WHERE submission_id = ? AND event_type = 'historical_lifecycle_resolved'",
      ).get(submissionId).count,
      1,
    );
  }
});

test("ordinary flagged projects require a final plan before audited lifecycle resolution", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    email: "ordinary-historic@example.test",
  })), env);
  const submissionId = (await created.json()).submissionId;
  const now = new Date().toISOString();
  database.prepare(
    `UPDATE submissions
     SET status = 'approved', tattoo_stage = 'review', lifecycle_review_required = 1,
         lifecycle_review_note = 'Historic final plan requires review', updated_at = ?
     WHERE id = ?`,
  ).run(now, submissionId);

  const blocked = await handleAdminResolveTattooLifecycleReview(adminJsonRequest(
    `/api/admin/booking/lifecycle-review/${submissionId}/resolve`,
    {},
    adminToken,
  ), env, submissionId);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "FINAL_SESSION_PLAN_REQUIRED");

  const planSaved = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 120,
      estimatedTotalMinutesMax: 180,
      artistNote: "Historic final plan reviewed in Studio.",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(planSaved.status, 200);
  assert.equal(
    database.prepare("SELECT lifecycle_review_required FROM submissions WHERE id = ?").get(submissionId).lifecycle_review_required,
    1,
  );

  const resolved = await handleAdminResolveTattooLifecycleReview(adminJsonRequest(
    `/api/admin/booking/lifecycle-review/${submissionId}/resolve`,
    { note: "Ordinary historic project reconciled from final plan." },
    adminToken,
  ), env, submissionId);
  const resolvedPayload = await resolved.json();
  assert.equal(resolved.status, 200, JSON.stringify(resolvedPayload));
  assert.equal(resolvedPayload.resolution, "final_session_plan");
  const parent = database.prepare(
    `SELECT status, tattoo_stage, lifecycle_review_required, lifecycle_review_note
     FROM submissions WHERE id = ?`,
  ).get(submissionId);
  assert.equal(parent.status, "approved");
  assert.equal(parent.tattoo_stage, "ready_to_book");
  assert.equal(parent.lifecycle_review_required, 0);
  assert.equal(parent.lifecycle_review_note, "");
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM submission_events WHERE submission_id = ? AND event_type = 'historical_lifecycle_resolved'",
    ).get(submissionId).count,
    1,
  );
});

test("prerequisite-consultation cancellation stays in the reviewed tattoo-project lane", async () => {
  const sent = [];
  const env = {
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { id: "cancel-email" };
      },
    },
  };
  const response = await notifyAppointmentCancelled(
    env,
    new Request("https://example.test/api/booking/cancel"),
    {
      id: "prerequisite-cancelled",
      booking_type_id: "consult_in_person",
      booking_type_label: "In-Person Consultation",
      purpose: "prerequisite_consultation",
      status: "cancelled",
      client_name: "Cover-up Client",
      client_email: "coverup@example.test",
      start_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 24.5 * 60 * 60 * 1000).toISOString(),
    },
  );
  assert.equal(response.ok, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /belongs to your reviewed tattoo project/i);
  assert.match(sent[0].text, /contact the studio to continue that project/i);
  assert.doesNotMatch(sent[0].text, /tattoos\/inquire\/consultation/i);
  assert.doesNotMatch(sent[0].text, /start a new reservation/i);
});

test("booking-link resend resolves the exact active token encoded in the stored URL", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { id: "resend-email" };
      },
    },
  };
  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom()), env);
  const submissionId = (await created.json()).submissionId;
  sent.length = 0;
  const consultationRawToken = "consultation-token-from-stored-url";
  const newerTattooRawToken = "newer-parallel-tattoo-token";
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  database.prepare(
    `UPDATE submissions
     SET status = 'approved', tattoo_stage = 'consultation_required', booking_url = ?, updated_at = ?
     WHERE id = ?`,
  ).run(`/booking/?token=${consultationRawToken}`, now.toISOString(), submissionId);
  database.prepare(
    `INSERT INTO booking_tokens (
      id, token_hash, submission_id, allowed_booking_types_json, purpose,
      expires_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "stored-url-token",
    await sha256HexForTest(consultationRawToken),
    submissionId,
    JSON.stringify(["consult_in_person"]),
    "consultation",
    expiresAt,
    new Date(now.getTime() - 60 * 1000).toISOString(),
    now.toISOString(),
  );
  database.prepare(
    `INSERT INTO booking_tokens (
      id, token_hash, submission_id, allowed_booking_types_json, purpose,
      expires_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "newer-parallel-token",
    await sha256HexForTest(newerTattooRawToken),
    submissionId,
    JSON.stringify(["tattoo_full"]),
    "tattoo",
    expiresAt,
    now.toISOString(),
    now.toISOString(),
  );

  const resend = await handleAdminResendNotification(adminJsonRequest(
    "/api/admin/notifications/resend",
    { templateKey: "booking_link_created", submissionId },
    adminToken,
  ), env);
  const payload = await resend.json();
  assert.equal(resend.status, 200, JSON.stringify(payload));
  assert.equal(sent.length, 1);
  const resentMessage = sent.at(-1);
  assert.match(resentMessage.text, /required in-person planning consultation/i);
  assert.match(resentMessage.text, new RegExp(consultationRawToken));
  assert.doesNotMatch(resentMessage.text, new RegExp(newerTattooRawToken));
});

test("direct public checkout is resumable and idempotent without creating a second Square link", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 90 * 60 * 1000).toISOString();
  insertAvailabilityWindow(database, {
    id: "window-idempotent-build",
    bookingTypeId: "build_in_person",
    startAt,
    endAt,
  });
  const env = squareEnv(database);
  let squareCreates = 0;
  const payload = {
    bookingTypeId: "build_in_person",
    availabilityWindowId: "window-idempotent-build",
    firstName: "Repeat",
    lastName: "Client",
    email: "repeat@example.test",
    direction: "A stable Build direction.",
    understand: "yes",
    age_confirmed: "yes",
  };
  const makeRequest = () => jsonRequest(
    "/api/booking/public-session/checkout",
    payload,
    { "idempotency-key": "public-build-repeat-key" },
  );

  const [first, second] = await withMockFetch(async (url, options = {}) => {
    assert.match(String(url), /\/v2\/online-checkout\/payment-links$/);
    assert.equal(options.method, "POST");
    squareCreates += 1;
    return jsonFetchResponse({
      payment_link: {
        id: "square-link-idempotent",
        order_id: "square-order-idempotent",
        url: "https://square.test/checkout/idempotent",
      },
    });
  }, async () => {
    const firstResponse = await handlePublicSessionCheckout(makeRequest(), env);
    const secondResponse = await handlePublicSessionCheckout(makeRequest(), env);
    return [
      { response: firstResponse, payload: await firstResponse.json() },
      { response: secondResponse, payload: await secondResponse.json() },
    ];
  });

  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.resumed, true);
  assert.equal(first.payload.appointmentId, second.payload.appointmentId);
  assert.equal(first.payload.checkoutUrl, second.payload.checkoutUrl);
  assert.equal(first.payload.holdExpiresAt, second.payload.holdExpiresAt);
  assert.equal(squareCreates, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM submissions WHERE idempotency_key = ?",
  ).get("public-build-repeat-key").count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointments WHERE availability_window_id = ?",
  ).get("window-idempotent-build").count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM deposit_payments WHERE appointment_id = ?",
  ).get(first.payload.appointmentId).count, 1);
  assert.deepEqual(
    { ...database.prepare(
      `SELECT status,interaction_type FROM crm_interactions
       WHERE source_provider='local' AND source_type='appointment' AND source_id=?`
    ).get(first.payload.appointmentId) },
    { status: "deposit_pending", interaction_type: "appointment" },
  );
  assert.deepEqual(
    { ...database.prepare(
      `SELECT status,amount_cents FROM crm_transactions
       WHERE source_provider='local' AND source_type='deposit_payment'
         AND source_id=(SELECT id FROM deposit_payments WHERE appointment_id=?)`
    ).get(first.payload.appointmentId) },
    { status: "pending", amount_cents: 5000 },
  );

  const released = await withMockFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/square-order-idempotent")) {
      return jsonFetchResponse({
        order: { id: "square-order-idempotent", state: "OPEN" },
      });
    }
    if (target.endsWith("/v2/online-checkout/payment-links/square-link-idempotent")) {
      assert.equal(options.method, "DELETE");
      return jsonFetchResponse({});
    }
    throw new Error(`Unexpected Square release request: ${target}`);
  }, () => handleReleasePendingBookingHold(jsonRequest(
    "/api/booking/pending-hold/release",
    {
      appointmentId: first.payload.appointmentId,
      email: payload.email,
      reason: "Contract release",
    },
  ), env));
  assert.equal(released.status, 200, await released.text());
  assert.equal(database.prepare(
    `SELECT status FROM crm_interactions
     WHERE source_provider='local' AND source_type='appointment' AND source_id=?`
  ).get(first.payload.appointmentId).status, "cancelled");
  assert.equal(database.prepare(
    `SELECT status FROM crm_transactions
     WHERE source_provider='local' AND source_type='deposit_payment'
       AND source_id=(SELECT id FROM deposit_payments WHERE appointment_id=?)`
  ).get(first.payload.appointmentId).status, "void");
});

test("concurrent public checkout attempts cannot overbook a capacity-one window", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 100 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 45 * 60 * 1000).toISOString();
  insertAvailabilityWindow(database, {
    id: "window-concurrent-capacity",
    bookingTypeId: "consult_in_person",
    startAt,
    endAt,
    capacity: 1,
  });
  const env = squareEnv(database);
  let squareCreates = 0;
  const makeRequest = (suffix) => jsonRequest(
    "/api/booking/public-session/checkout",
    {
      bookingTypeId: "consult_in_person",
      availabilityWindowId: "window-concurrent-capacity",
      name: `Concurrent ${suffix}`,
      email: `concurrent-${suffix}@example.test`,
      direction: `Direction ${suffix}`,
      understand: "yes",
      age_confirmed: "yes",
    },
    { "idempotency-key": `concurrent-key-${suffix}` },
  );

  const attempts = await withMockFetch(async (url, options = {}) => {
    assert.match(String(url), /\/v2\/online-checkout\/payment-links$/);
    assert.equal(options.method, "POST");
    squareCreates += 1;
    return jsonFetchResponse({
      payment_link: {
        id: `square-link-concurrent-${squareCreates}`,
        order_id: `square-order-concurrent-${squareCreates}`,
        url: `https://square.test/checkout/concurrent-${squareCreates}`,
      },
    });
  }, async () => Promise.all([
    handlePublicSessionCheckout(makeRequest("one"), env),
    handlePublicSessionCheckout(makeRequest("two"), env),
  ]));
  const results = await Promise.all(attempts.map(async (response) => ({
    status: response.status,
    payload: await response.json(),
  })));

  assert.equal(results.filter(({ status }) => status === 200).length, 1, JSON.stringify(results));
  assert.equal(results.filter(({ status }) => status >= 400).length, 1, JSON.stringify(results));
  assert.match(results.find(({ status }) => status >= 400).payload.error, /already been claimed/i);
  assert.equal(squareCreates, 1);
  assert.equal(database.prepare(
    `SELECT COUNT(*) AS count FROM appointments
     WHERE availability_window_id = ? AND status IN ('pending_deposit','deposit_pending','confirmed')`,
  ).get("window-concurrent-capacity").count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM submissions WHERE idempotency_key LIKE 'concurrent-key-%'",
  ).get().count, 1);
});

test("hold reaper expires confirmed-unpaid Square checkouts and blocks capacity on reconciliation failure", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 45 * 60 * 1000).toISOString();
  const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "appointment-reaper-expire",
    status: "deposit_pending",
    startAt,
    endAt,
    squareOrderId: "order-reaper-expire",
    squarePaymentLinkId: "link-reaper-expire",
    squareCheckoutUrl: "https://square.test/checkout/reaper-expire",
    holdExpiresAt: expiredAt,
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: "payment-reaper-expire",
    appointmentId: "appointment-reaper-expire",
    checkoutId: "link-reaper-expire",
    orderId: "order-reaper-expire",
  });
  insertAppointmentFixture(database, {
    id: "appointment-reaper-attention",
    status: "deposit_pending",
    name: "Attention Client",
    email: "attention@example.test",
    startAt: new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(new Date(endAt).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    squareOrderId: "order-reaper-attention",
    squarePaymentLinkId: "link-reaper-attention",
    squareCheckoutUrl: "https://square.test/checkout/reaper-attention",
    holdExpiresAt: expiredAt,
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: "payment-reaper-attention",
    appointmentId: "appointment-reaper-attention",
    checkoutId: "link-reaper-attention",
    orderId: "order-reaper-attention",
  });
  const env = squareEnv(database);

  const summary = await withMockFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/order-reaper-expire")) {
      return jsonFetchResponse({ order: { id: "order-reaper-expire", state: "OPEN" } });
    }
    if (target.endsWith("/v2/online-checkout/payment-links/link-reaper-expire")) {
      assert.equal(options.method, "DELETE");
      return jsonFetchResponse({});
    }
    if (target.endsWith("/v2/orders/order-reaper-attention")) {
      return jsonFetchResponse({ errors: [{ detail: "Square is temporarily unavailable." }] }, 503);
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, () => reapExpiredBookingHolds(env));

  assert.deepEqual(summary, { checked: 2, confirmed: 0, expired: 1, attention: 1 });
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, hold_state FROM appointments WHERE id = ?",
  ).get("appointment-reaper-expire")), { status: "cancelled", hold_state: "expired" });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-reaper-expire").status, "cancelled");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'hold_expired'",
  ).get("appointment-reaper-expire").count, 1);
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, hold_state FROM appointments WHERE id = ?",
  ).get("appointment-reaper-attention")), { status: "deposit_pending", hold_state: "expiry_attention" });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-reaper-attention").status, "pending");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'hold_expiry_attention'",
  ).get("appointment-reaper-attention").count, 1);
});

test("a paid webhook arriving after terminal hold expiry records payment attention without reviving the appointment", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 45 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "appointment-late-webhook",
    status: "cancelled",
    startAt,
    endAt,
    squareOrderId: "order-late-webhook",
    squarePaymentLinkId: "link-late-webhook",
    squareCheckoutUrl: "https://square.test/checkout/late-webhook",
    holdExpiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    holdState: "expired",
  });
  insertPaymentFixture(database, {
    id: "payment-late-webhook",
    appointmentId: "appointment-late-webhook",
    checkoutId: "link-late-webhook",
    orderId: "order-late-webhook",
    status: "cancelled",
  });
  const notificationUrl = "https://example.test/api/square/webhook";
  const signatureKey = "square-webhook-signature-test-key";
  const body = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "square-payment-late-webhook",
          order_id: "order-late-webhook",
          status: "COMPLETED",
        },
      },
    },
  });
  const signature = await squareWebhookSignatureForTest(body, signatureKey, notificationUrl);
  const request = new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body,
  });
  const env = squareEnv(database, {
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const response = await withMockFetch(async (url) => {
    assert.match(String(url), /\/v2\/orders\/order-late-webhook$/);
    return jsonFetchResponse({ order: { id: "order-late-webhook", state: "COMPLETED" } });
  }, () => handleSquareWebhook(request, env));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.paid, true);
  assert.equal(payload.attention, true);
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, hold_state FROM appointments WHERE id = ?",
  ).get("appointment-late-webhook")), { status: "cancelled", hold_state: "expiry_attention" });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-late-webhook").status, "payment_attention");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'late_payment_attention'",
  ).get("appointment-late-webhook").count, 1);
  assert.deepEqual(
    rowObject(database.prepare(`
      SELECT i.status interaction_status,t.status transaction_status,t.amount_cents
      FROM crm_interactions i
      JOIN crm_transactions t ON t.person_id=i.person_id
      WHERE i.source_type='appointment' AND i.source_id='appointment-late-webhook'
        AND t.source_type='deposit_payment' AND t.source_id='payment-late-webhook'
    `).get()),
    {
      interaction_status: "cancelled",
      transaction_status: "settled",
      amount_cents: 5000,
    },
  );
});

test("a signed completed-payment webhook remains retryable when Square order reconciliation fails", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 45 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "appointment-webhook-retry",
    status: "deposit_pending",
    startAt,
    endAt,
    squareOrderId: "order-webhook-retry",
    squarePaymentLinkId: "link-webhook-retry",
    squareCheckoutUrl: "https://square.test/checkout/webhook-retry",
    holdExpiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: "payment-webhook-retry",
    appointmentId: "appointment-webhook-retry",
    checkoutId: "link-webhook-retry",
    orderId: "order-webhook-retry",
  });
  const notificationUrl = "https://example.test/api/square/webhook";
  const signatureKey = "square-webhook-retry-key";
  const body = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: {
      id: "square-payment-webhook-retry",
      order_id: "order-webhook-retry",
      status: "COMPLETED",
    } } },
  });
  const signature = await squareWebhookSignatureForTest(body, signatureKey, notificationUrl);
  const request = new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body,
  });
  const env = squareEnv(database, {
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const response = await withMockFetch(
    async () => jsonFetchResponse({ errors: [{ detail: "Transient Square outage" }] }, 503),
    () => handleSquareWebhook(request, env),
  );
  const payload = await response.json();

  assert.ok(response.status >= 500, `completed webhook must remain retryable: ${JSON.stringify(payload)}`);
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, hold_state FROM appointments WHERE id = ?",
  ).get("appointment-webhook-retry")), { status: "deposit_pending", hold_state: "active" });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-webhook-retry").status, "pending");
});

test("client hold release invalidates Square, frees capacity, and closes the direct-session parent lifecycle", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 45 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, {
    id: "submission-hold-release",
    status: "new",
    email: "release@example.test",
  });
  insertAppointmentFixture(database, {
    id: "appointment-hold-release",
    submissionId: "submission-hold-release",
    status: "deposit_pending",
    email: "release@example.test",
    startAt,
    endAt,
    squareOrderId: "order-hold-release",
    squarePaymentLinkId: "link-hold-release",
    squareCheckoutUrl: "https://square.test/checkout/hold-release",
    holdExpiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    holdState: "active",
  });
  insertPaymentFixture(database, {
    id: "payment-hold-release",
    appointmentId: "appointment-hold-release",
    checkoutId: "link-hold-release",
    orderId: "order-hold-release",
  });
  const env = squareEnv(database);

  const response = await withMockFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/order-hold-release")) {
      return jsonFetchResponse({ order: { id: "order-hold-release", state: "OPEN" } });
    }
    if (target.endsWith("/v2/online-checkout/payment-links/link-hold-release")) {
      assert.equal(options.method, "DELETE");
      return jsonFetchResponse({});
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, () => handleReleasePendingBookingHold(jsonRequest(
    "/api/booking/pending-hold/release",
    {
      appointmentId: "appointment-hold-release",
      email: "release@example.test",
      reason: "Choosing a different time",
    },
  ), env));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.released, true);
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, hold_state FROM appointments WHERE id = ?",
  ).get("appointment-hold-release")), { status: "cancelled", hold_state: "released" });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-hold-release").status, "cancelled");
  assert.equal(database.prepare(
    "SELECT status FROM submissions WHERE id = ?",
  ).get("submission-hold-release").status, "cancelled");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'hold_released'",
  ).get("appointment-hold-release").count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM submission_events WHERE submission_id = ? AND event_type = 'checkout_hold_released'",
  ).get("submission-hold-release").count, 1);
});

test("tattoo cancellation checks ownership, preserves paid funds, and returns the project to ready-to-book", async () => {
  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 3 * 60 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, {
    id: "submission-tattoo-cancel",
    type: "tattoo_inquiry",
    status: "booked",
    tattooStage: "tattoo_scheduled",
    email: "tattoo-cancel@example.test",
    bookingUrl: "/booking/?token=old-tattoo-token",
  });
  insertAppointmentFixture(database, {
    id: "appointment-tattoo-cancel",
    submissionId: "submission-tattoo-cancel",
    bookingTypeId: "tattoo_half",
    status: "confirmed",
    purpose: "tattoo",
    email: "tattoo-cancel@example.test",
    startAt,
    endAt,
    depositCents: 10000,
    holdState: "converted",
  });
  insertPaymentFixture(database, {
    id: "payment-tattoo-cancel",
    appointmentId: "appointment-tattoo-cancel",
    checkoutId: "link-tattoo-cancel",
    orderId: "order-tattoo-cancel",
    status: "paid",
    amountCents: 10000,
  });
  const env = squareEnv(database);

  const wrongEmail = await handleCancelAppointment(jsonRequest(
    "/api/booking/cancel",
    { appointmentId: "appointment-tattoo-cancel", email: "wrong@example.test" },
  ), env);
  assert.equal(wrongEmail.status, 403);
  assert.equal(database.prepare(
    "SELECT status FROM appointments WHERE id = ?",
  ).get("appointment-tattoo-cancel").status, "confirmed");

  const response = await handleCancelAppointment(jsonRequest(
    "/api/booking/cancel",
    {
      appointmentId: "appointment-tattoo-cancel",
      email: "tattoo-cancel@example.test",
      reason: "Client can no longer attend",
    },
  ), env);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, tattoo_stage, booking_url FROM submissions WHERE id = ?",
  ).get("submission-tattoo-cancel")), {
    status: "approved",
    tattoo_stage: "ready_to_book",
    booking_url: "",
  });
  assert.equal(database.prepare(
    "SELECT status FROM appointments WHERE id = ?",
  ).get("appointment-tattoo-cancel").status, "cancelled");
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-tattoo-cancel").status, "paid");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'cancelled'",
  ).get("appointment-tattoo-cancel").count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM submission_events WHERE submission_id = ? AND event_type = 'appointment_cancelled'",
  ).get("submission-tattoo-cancel").count, 1);
});

test("a client reschedule with at least 48 hours notice moves the paid appointment once", async () => {
  const database = migratedDatabase();
  const originalStart = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const originalEnd = new Date(new Date(originalStart).getTime() + 45 * 60 * 1000).toISOString();
  const firstTargetStart = new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString();
  const firstTargetEnd = new Date(new Date(firstTargetStart).getTime() + 45 * 60 * 1000).toISOString();
  const secondTargetStart = new Date(Date.now() + 144 * 60 * 60 * 1000).toISOString();
  const secondTargetEnd = new Date(new Date(secondTargetStart).getTime() + 45 * 60 * 1000).toISOString();
  insertAvailabilityWindow(database, {
    id: "window-reschedule-first",
    startAt: firstTargetStart,
    endAt: firstTargetEnd,
  });
  insertAvailabilityWindow(database, {
    id: "window-reschedule-second",
    startAt: secondTargetStart,
    endAt: secondTargetEnd,
  });
  insertAppointmentFixture(database, {
    id: "appointment-reschedule-once",
    status: "confirmed",
    email: "reschedule@example.test",
    startAt: originalStart,
    endAt: originalEnd,
    holdState: "converted",
  });
  insertPaymentFixture(database, {
    id: "payment-reschedule-once",
    appointmentId: "appointment-reschedule-once",
    checkoutId: "link-reschedule-once",
    orderId: "order-reschedule-once",
    status: "paid",
  });
  const env = squareEnv(database);

  const moved = await handleRescheduleAppointment(jsonRequest(
    "/api/booking/reschedule",
    {
      appointmentId: "appointment-reschedule-once",
      email: "reschedule@example.test",
      availabilityWindowId: "window-reschedule-first",
    },
  ), env);
  const movedPayload = await moved.json();
  assert.equal(moved.status, 200, JSON.stringify(movedPayload));
  assert.equal(movedPayload.mode, "moved");
  const movedRow = database.prepare(
    `SELECT availability_window_id, start_at, original_start_at,
            reschedule_count, rescheduled_at, status
     FROM appointments WHERE id = ?`,
  ).get("appointment-reschedule-once");
  assert.equal(movedRow.availability_window_id, "window-reschedule-first");
  assert.equal(movedRow.start_at, firstTargetStart);
  assert.equal(movedRow.original_start_at, originalStart);
  assert.equal(movedRow.reschedule_count, 1);
  assert.ok(movedRow.rescheduled_at);
  assert.equal(movedRow.status, "confirmed");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'rescheduled'",
  ).get("appointment-reschedule-once").count, 1);

  const secondMove = await handleRescheduleAppointment(jsonRequest(
    "/api/booking/reschedule",
    {
      appointmentId: "appointment-reschedule-once",
      email: "reschedule@example.test",
      availabilityWindowId: "window-reschedule-second",
    },
  ), env);
  const secondPayload = await secondMove.json();
  assert.equal(secondMove.status, 409, JSON.stringify(secondPayload));
  assert.match(secondPayload.error, /not eligible|already used/i);
  assert.equal(database.prepare(
    "SELECT availability_window_id FROM appointments WHERE id = ?",
  ).get("appointment-reschedule-once").availability_window_id, "window-reschedule-first");
});

test("inside 48 hours reschedule creates one resumable paid replacement and preserves the original until payment", async () => {
  const database = migratedDatabase();
  const originalStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const originalEnd = new Date(new Date(originalStart).getTime() + 45 * 60 * 1000).toISOString();
  const targetStart = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const targetEnd = new Date(new Date(targetStart).getTime() + 45 * 60 * 1000).toISOString();
  insertAvailabilityWindow(database, {
    id: "window-replacement-checkout",
    startAt: targetStart,
    endAt: targetEnd,
  });
  insertAppointmentFixture(database, {
    id: "appointment-replacement-original",
    status: "confirmed",
    email: "replacement@example.test",
    startAt: originalStart,
    endAt: originalEnd,
    holdState: "converted",
  });
  insertPaymentFixture(database, {
    id: "payment-replacement-original",
    appointmentId: "appointment-replacement-original",
    checkoutId: "link-replacement-original",
    orderId: "order-replacement-original",
    status: "paid",
  });
  const env = squareEnv(database);
  let squareCreates = 0;
  const requestBody = {
    appointmentId: "appointment-replacement-original",
    email: "replacement@example.test",
    availabilityWindowId: "window-replacement-checkout",
  };

  const [first, resumed] = await withMockFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/online-checkout/payment-links") && options.method === "POST") {
      squareCreates += 1;
      return jsonFetchResponse({ payment_link: {
        id: "link-replacement-new",
        order_id: "order-replacement-new",
        url: "https://square.test/checkout/replacement-new",
      } });
    }
    if (target.endsWith("/v2/orders/order-replacement-new")) {
      return jsonFetchResponse({ order: { id: "order-replacement-new", state: "OPEN" } });
    }
    if (target.endsWith("/v2/online-checkout/payment-links/link-replacement-new")) {
      assert.equal(options.method, "DELETE");
      return jsonFetchResponse({});
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const firstResponse = await handleRescheduleAppointment(jsonRequest(
      "/api/booking/reschedule",
      requestBody,
    ), env);
    const resumedResponse = await handleCreateReplacementCheckout(jsonRequest(
      "/api/booking/replacement-checkout",
      requestBody,
    ), env);
    return [
      { response: firstResponse, payload: await firstResponse.json() },
      { response: resumedResponse, payload: await resumedResponse.json() },
    ];
  });

  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.mode, "replacement_checkout");
  assert.equal(resumed.response.status, 200, JSON.stringify(resumed.payload));
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.appointmentId, first.payload.appointmentId);
  assert.equal(resumed.payload.checkoutUrl, first.payload.checkoutUrl);
  assert.equal(squareCreates, 1);
  assert.deepEqual(rowObject(database.prepare(
    `SELECT status, reschedule_count, replaced_by_appointment_id
     FROM appointments WHERE id = ?`,
  ).get("appointment-replacement-original")), {
    status: "confirmed",
    reschedule_count: 0,
    replaced_by_appointment_id: null,
  });
  const replacementRow = database.prepare(
    `SELECT status, hold_state, replacement_for_appointment_id, reschedule_count,
            availability_window_id
     FROM appointments WHERE id = ?`,
  ).get(first.payload.appointmentId);
  assert.deepEqual(rowObject(replacementRow), {
    status: "deposit_pending",
    hold_state: "active",
    replacement_for_appointment_id: "appointment-replacement-original",
    reschedule_count: 1,
    availability_window_id: "window-replacement-checkout",
  });
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get(first.payload.appointmentId).status, "pending");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM appointment_events WHERE appointment_id = ? AND event_type = 'replacement_hold_created'",
  ).get(first.payload.appointmentId).count, 1);

  database.prepare(
    "UPDATE appointments SET hold_expires_at = ? WHERE id = ?",
  ).run(new Date(Date.now() - 60 * 1000).toISOString(), first.payload.appointmentId);
  const reaped = await withMockFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/order-replacement-new")) {
      return jsonFetchResponse({ order: { id: "order-replacement-new", state: "OPEN" } });
    }
    if (target.endsWith("/v2/online-checkout/payment-links/link-replacement-new")) {
      assert.equal(options.method, "DELETE");
      return jsonFetchResponse({});
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, () => reapExpiredBookingHolds(env));
  assert.equal(reaped.expired, 1);
  assert.equal(database.prepare(
    "SELECT status FROM appointments WHERE id = ?",
  ).get(first.payload.appointmentId).status, "cancelled");
  assert.deepEqual(rowObject(database.prepare(
    `SELECT status, reschedule_count, replaced_by_appointment_id
     FROM appointments WHERE id = ?`,
  ).get("appointment-replacement-original")), {
    status: "confirmed",
    reschedule_count: 0,
    replaced_by_appointment_id: null,
  });
});
