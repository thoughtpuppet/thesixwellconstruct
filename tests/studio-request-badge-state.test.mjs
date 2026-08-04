import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { handleOpenSubmission } from "../functions/api/submissions/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function loadResolver() {
  const context = {};
  vm.runInNewContext(source("studio/request-badge-state.js"), context);
  return context.StudioRequestBadgeState.resolve;
}

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
    return this.database.prepare(this.sql).run(...this.values);
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

function openStateDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      booking_url TEXT NOT NULL DEFAULT '',
      opened_at TEXT,
      decision_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE notification_deliveries (
      template_key TEXT,
      status TEXT,
      sent_at TEXT,
      created_at TEXT,
      idempotency_key TEXT,
      related_type TEXT,
      related_id TEXT,
      channel TEXT
    );
    CREATE TABLE appointments (id TEXT PRIMARY KEY, submission_id TEXT);
    CREATE TABLE deposit_payments (appointment_id TEXT, status TEXT, provider_payment_id TEXT, updated_at TEXT);
    CREATE TABLE booking_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      submission_id TEXT,
      revoked_at TEXT,
      used_at TEXT,
      expires_at TEXT,
      created_at TEXT
    );
  `);
  database.prepare(
    `INSERT INTO submissions (id,type,status,contact_name,contact_email,created_at,updated_at)
     VALUES ('request-1','tattoo_inquiry','new','Test Client','test@example.com','2026-08-03T12:00:00.000Z','2026-08-03T12:00:00.000Z')`
  ).run();
  return database;
}

function adminRequest(token = "test-admin") {
  return new Request("https://example.test/api/admin/submissions/request-1/open", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

test("request badge resolver follows the approved operational vocabulary", () => {
  const resolve = loadResolver();
  const base = { type: "tattoo_inquiry", status: "approved", tattooStage: "ready_to_book" };
  const cases = [
    [{ ...base, depositPaymentStatus: "paid_attention", clientNotificationStatus: "failed" }, "PAYMENT NEEDS REVIEW", "error"],
    [{ ...base, clientNotificationStatus: "failed" }, "EMAIL FAILED", "error"],
    [{ ...base, status: "declined" }, "DECLINED", "terminal"],
    [{ ...base, status: "cancelled" }, "CANCELLED", "terminal"],
    [{ ...base, status: "archived" }, "ARCHIVED", "terminal"],
    [{ ...base, status: "booked" }, "BOOKED", "success"],
    [{ ...base, tattooStage: "tattoo_scheduled" }, "BOOKED", "success"],
    [{ ...base, depositPaymentStatus: "paid" }, "DEPOSIT PAID", "success"],
    [{ ...base, depositPaymentStatus: "pending" }, "AWAITING DEPOSIT", "waiting"],
    [{ ...base, tattooStage: "consultation_scheduled" }, "CONSULTATION SCHEDULED", "success"],
    [{ ...base, tattooStage: "consultation_required" }, "SCHEDULE CONSULTATION", "action"],
    [{ ...base, tattooStage: "review", payload: { consult_required: "yes" } }, "SCHEDULE CONSULTATION", "action"],
    [{ ...base, tattooStage: "consultation_complete" }, "COMPLETE SESSION PLAN", "action"],
    [{ ...base, payload: { direct_booking_invite: "yes" }, contactName: "" }, "AWAITING CLIENT", "waiting"],
    [{ ...base, bookingUrl: "/booking/?token=active", clientAccessStatus: "active", clientLinkNotificationStatus: "sent" }, "AWAITING CLIENT", "waiting"],
    [{ ...base, bookingUrl: "/booking/?token=active", clientAccessStatus: "active", clientLinkNotificationStatus: "unsent" }, "SEND BOOKING LINK", "action"],
    [{ ...base, bookingUrl: "/booking/?token=expired", clientAccessStatus: "none" }, "CREATE BOOKING LINK", "action"],
    [{ type: "tattoo_inquiry", status: "reviewing" }, "IN REVIEW", "review"],
    [{ type: "tattoo_inquiry", status: "new", openedAt: "2026-08-03T13:00:00.000Z" }, "NEEDS REVIEW", "needs-review"],
    [{ type: "tattoo_inquiry", status: "new", openedAt: "" }, "NEW", "new"],
  ];

  for (const [submission, label, tone] of cases) {
    const result = resolve(submission);
    assert.equal(result?.label, label, JSON.stringify(submission));
    assert.equal(result?.tone, tone, JSON.stringify(submission));
  }
  assert.equal(resolve({ type: "art_inquiry", status: "approved" }), null);
});

test("first-open endpoint is authenticated, idempotent, and preserves new status", async () => {
  const database = openStateDatabase();
  const env = { SUBMISSIONS_ADMIN_TOKEN: "test-admin", SUBMISSIONS_DB: new LocalD1(database) };

  const denied = await handleOpenSubmission(adminRequest("wrong-token"), env, "request-1");
  assert.equal(denied.status, 401);

  const first = await handleOpenSubmission(adminRequest(), env, "request-1");
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.submission.status, "new");
  assert.ok(firstPayload.submission.openedAt);
  const openedAt = firstPayload.submission.openedAt;

  const second = await handleOpenSubmission(adminRequest(), env, "request-1");
  assert.equal(second.status, 200);
  const secondPayload = await second.json();
  assert.equal(secondPayload.submission.openedAt, openedAt);
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id='request-1'").get().status, "new");
});

test("admin submission state distinguishes generic notifications from active-link delivery", async () => {
  const genericDatabase = openStateDatabase();
  genericDatabase.prepare(
    `INSERT INTO notification_deliveries
      (template_key,status,sent_at,created_at,idempotency_key,related_type,related_id,channel)
     VALUES ('submission_approved','sent','2026-08-03T13:00:00.000Z','2026-08-03T13:00:00.000Z',
       'decision_notification:request-1:0:approval','submission','request-1','email')`
  ).run();
  const genericEnv = { SUBMISSIONS_ADMIN_TOKEN: "test-admin", SUBMISSIONS_DB: new LocalD1(genericDatabase) };
  const genericResponse = await handleOpenSubmission(adminRequest(), genericEnv, "request-1");
  const generic = (await genericResponse.json()).submission;
  assert.equal(generic.clientNotificationStatus, "sent");
  assert.equal(generic.clientLinkNotificationStatus, "unsent");
  assert.equal(generic.clientAccessStatus, "none");

  const linkDatabase = openStateDatabase();
  linkDatabase.prepare("UPDATE submissions SET booking_url='/booking/?token=active' WHERE id='request-1'").run();
  const activeTokenHash = createHash("sha256").update("active").digest("hex");
  linkDatabase.prepare(
    `INSERT INTO booking_tokens (id,token_hash,submission_id,revoked_at,used_at,expires_at,created_at)
     VALUES ('active-token',?,'request-1',NULL,NULL,'2099-01-01T00:00:00.000Z','2026-08-03T12:30:00.000Z')`
  ).run(activeTokenHash);
  linkDatabase.prepare(
    `INSERT INTO notification_deliveries
      (template_key,status,sent_at,created_at,idempotency_key,related_type,related_id,channel)
     VALUES ('booking_link_created','sent','2026-08-03T13:00:00.000Z','2026-08-03T13:00:00.000Z',
       'decision_notification:request-1:0:link','submission','request-1','email')`
  ).run();
  const linkEnv = { SUBMISSIONS_ADMIN_TOKEN: "test-admin", SUBMISSIONS_DB: new LocalD1(linkDatabase) };
  const linkResponse = await handleOpenSubmission(adminRequest(), linkEnv, "request-1");
  const linked = (await linkResponse.json()).submission;
  assert.equal(linked.clientNotificationStatus, "sent");
  assert.equal(linked.clientLinkNotificationStatus, "sent");
  assert.equal(linked.clientAccessStatus, "active");

  linkDatabase.prepare(
    `INSERT INTO notification_deliveries
      (template_key,status,sent_at,created_at,idempotency_key,related_type,related_id,channel)
     VALUES ('booking_link_created','failed',NULL,'2026-08-03T14:00:00.000Z',
       'booking_link_created:active-token:resend:attempt','submission','request-1','email')`
  ).run();
  const failedResendResponse = await handleOpenSubmission(adminRequest(), linkEnv, "request-1");
  const failedResend = (await failedResendResponse.json()).submission;
  assert.equal(failedResend.clientNotificationStatus, "failed");
  assert.equal(failedResend.clientLinkNotificationStatus, "failed");

  linkDatabase.prepare("DELETE FROM notification_deliveries").run();
  linkDatabase.prepare(
    `INSERT INTO notification_deliveries
      (template_key,status,sent_at,created_at,idempotency_key,related_type,related_id,channel)
     VALUES ('booking_link_created','sent','2026-08-03T12:00:00.000Z','2026-08-03T12:00:00.000Z',
       'booking_link_created:old-token','submission','request-1','email')`
  ).run();
  const staleDeliveryResponse = await handleOpenSubmission(adminRequest(), linkEnv, "request-1");
  const staleDelivery = (await staleDeliveryResponse.json()).submission;
  assert.equal(staleDelivery.clientLinkNotificationStatus, "unsent");
  assert.equal(staleDelivery.clientAccessStatus, "active");
});

test("Studio request surfaces render one operational badge slot and quiet metadata", () => {
  const studio = source("studio/submissions/index.html");
  const tokens = source("css/tokens.css");
  const worker = source("_worker.js");

  assert.match(tokens, /--studio-status-info:\s*#79B8D1/);
  assert.match(studio, /src="\/studio\/request-badge-state\.js\?v=1"/);
  assert.match(studio, /data-request-badge=/);
  assert.match(studio, /data-request-state-meta=/);
  assert.doesNotMatch(studio, /nextActionBadge|submissionProgressBadges|data-submission-progress/);
  assert.match(worker, /const openMatch = pathname\.match\([\s\S]*?handleOpenSubmission/);
});
