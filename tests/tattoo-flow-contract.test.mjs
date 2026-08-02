import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleCreateSubmission,
  handleDeleteSubmission,
  handleGetSubmission,
  handlePromoteMazeArchiveSubmission,
  handleUpdateMazeArchiveSubmission,
  handleUpdateSubmission,
} from "../functions/api/submissions/_lib.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { buildCompositionSnapshot } from "../js/build-composition.js";
import {
  handleCreateBuildDraft,
  handleDeleteBuildDraft,
  handleEmailBuildDraft,
  handleGetBuildDraft,
  handleUpdateBuildDraft,
  reapExpiredTattooBuildDrafts,
} from "../functions/api/build-drafts/_lib.js";
import {
  handleAdminCancelAppointment,
  handleAdminCompleteAppointment,
  handleAdminCreateAppointmentMeeting,
  handleAdminCreateTattooRenderingRequest,
  handleAdminResendTattooRenderingRequest,
  handleAdminCancelTattooRenderingRequest,
  handleAdminCreateAvailability,
  handleAdminCreateBookingToken,
  handleAdminCreateDirectBookingInvite,
  handleAdminRescheduleAppointment,
  handleAdminResolveTattooLifecycleReview,
  handleAdminRevokeSubmissionBookingTokens,
  handleAdminTattooSettings,
  handleAdminTattooSessionPlan,
  handleCancelAppointment,
  handleConfirmBooking,
  handleBookingContext,
  handleCreateBookingCheckout,
  handleCreateBookingHold,
  handleCreateReplacementCheckout,
  handlePublicConsultationContext,
  handlePublicSessionCheckout,
  handlePublicSessionContext,
  handlePublicTattooSettings,
  handleReleasePendingBookingHold,
  handleRescheduleAppointment,
  handleRescheduleContext,
  handleSaveBookingSessionPlan,
  handleSquareWebhook,
  reapExpiredBookingHolds,
  reapExpiredTattooRenderingRequests,
} from "../functions/api/booking/_lib.js";
import { ingestCrmSourceRecord } from "../functions/api/crm/ingest.js";
import {
  handleAdminEmailTemplates,
  handleAdminPreviewNotification,
  handleAdminResendNotification,
  notifyAdminAppointmentConfirmed,
  notifyAdminAppointmentRescheduled,
  notifyAdminSubmissionReceived,
  notifyAppointmentConfirmed,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
  notifySubmissionReceived,
  retryPendingAdminAppointmentNotifications,
  sendDueAppointmentReminders,
} from "../functions/api/notifications/_lib.js";
import {
  buildBookingLinkEmail,
  buildSubmissionReceivedEmail,
  clientEmailPreviewCatalog,
  renderClientEmailPreview,
} from "../functions/api/notifications/_email-templates.js";
import { escapeEmailHtml } from "../functions/api/notifications/_email-renderer.js";
import {
  generateSubmissionBriefDocument,
  handleAdminBriefTemplates,
  handleAdminSubmissionBriefDocument,
  handlePublicBriefDownload,
} from "../functions/api/brief-documents/_lib.js";
import {
  briefTemplateDefault,
  buildBriefSample,
  renderBriefHtml,
  validateBriefTemplateContent,
} from "../functions/api/brief-documents/_templates.js";
import {
  handleAdminTattooSpecialOffer,
  handleAdminTattooSpecialReview,
  handleAdminTattooSpecials,
  handleCreateTattooSpecialSubmission,
  handlePublicTattooSpecials,
} from "../functions/api/tattoo-specials/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TATTOO_BUDGET_RANGES = [
  "Up to $300",
  "$300–$500",
  "$500–$800",
  "$800–$1,200",
  "$1,200–$2,000",
  "$2,000+",
  "I’m flexible / I’d like guidance",
];

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

class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value, options = {}) {
    const body = value instanceof ReadableStream
      ? await new Response(value).arrayBuffer()
      : value instanceof ArrayBuffer
        ? value
        : await new Response(value).arrayBuffer();
    this.objects.set(key, { body, options });
  }

  async delete(key) {
    this.objects.delete(key);
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.body,
      arrayBuffer: async () => object.body,
      httpMetadata: object.options.httpMetadata || {},
      customMetadata: object.options.customMetadata || {},
    };
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

function draftRequest(path, method = "GET", payload, token = "", headers = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

function multipartRequest(path, payload, files = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  for (const file of files) {
    form.append(
      file.fieldName,
      new Blob([file.body || file.fileName], { type: file.contentType || "image/jpeg" }),
      file.fileName,
    );
  }
  return new Request(`https://example.test${path}`, {
    method: "POST",
    body: form,
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
    budget_range: "$500–$800",
    color_preference: "black",
    message: "A symbolic composition with clear visual direction.",
    review_consent: "yes",
    ...overrides,
  };
}

test("Tattoo project forms expose the same required total-budget ranges", () => {
  const formSources = [
    ["Custom", join(ROOT, "tattoos", "inquire", "custom", "index.html")],
    ["Flash", join(ROOT, "tattoos", "flash", "claim", "index.html")],
    ["Build", join(ROOT, "tattoos", "build", "index.html")],
    ["Special Projects", join(ROOT, "tattoos", "special-projects", "apply", "index.html")],
    ["Maze", join(ROOT, "apps", "maze", "src", "App.tsx")],
  ];
  for (const [label, path] of formSources) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /What total project budget are you comfortable working within\?/i, `${label} budget label`);
    assert.match(source, /name="budget_range"[^>]*required|required[^>]*name="budget_range"/, `${label} required budget field`);
    for (const range of TATTOO_BUDGET_RANGES) {
      assert.ok(source.includes(`value="${range}"`), `${label} includes ${range}`);
    }
  }
});

test("Original-design tattoo paths disclose the additional-rendering drawing fee", () => {
  const drawingFeeNotice = "One developed design direction is included after your deposit is paid. Additional concept sketches are $50 each, require artist approval, and must be paid before drawing begins.";
  const applicableSources = [
    ["Custom", join(ROOT, "tattoos", "inquire", "custom", "index.html")],
    ["Build", join(ROOT, "tattoos", "build", "index.html")],
    ["Maze", join(ROOT, "apps", "maze", "src", "App.tsx")],
    ["Special Projects", join(ROOT, "tattoos", "special-projects", "apply", "index.html")],
  ];
  for (const [label, path] of applicableSources) {
    assert.ok(readFileSync(path, "utf8").includes(drawingFeeNotice), `${label} drawing-fee notice`);
  }

  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  assert.equal(bookingPage.split(drawingFeeNotice).length - 1, 1, "booking approved-budget explanation");
  assert.match(bookingPage, /budgetLabel \? `<label class="form-check"><input class="form-check__input" id="budgetAck"/);
  assert.match(bookingPage, /Artist-approved additional concept sketches are separate, non-refundable \$50 fees that are not credited toward the tattoo total and must be paid before drawing begins/);

  const policies = readFileSync(join(ROOT, "tattoos", "policies", "index.html"), "utf8");
  assert.match(policies, /substantially different alternate concept/);
  assert.match(policies, /Minor refinements to the chosen direction and artist-initiated redraws remain included/);
  assert.match(policies, /fee is not credited toward the tattoo total/);
  assert.match(policies, /requested before the appointment/);

  const emailTemplates = readFileSync(join(ROOT, "functions", "api", "notifications", "_email-templates.js"), "utf8");
  const emailLib = readFileSync(join(ROOT, "functions", "api", "notifications", "_lib.js"), "utf8");
  assert.match(emailLib, /Your paid tattoo deposit includes one developed design direction/);
  assert.match(emailTemplates, /tattoo_rendering_payment_requested/);
  assert.match(emailTemplates, /tattoo_rendering_payment_confirmed/);

  const excludedSources = [
    ["Flash", join(ROOT, "tattoos", "flash", "claim", "index.html")],
    ["Consultation", join(ROOT, "tattoos", "inquire", "consultation", "index.html")],
    ["Build session", join(ROOT, "tattoos", "build", "in-person", "index.html")],
  ];
  for (const [label, path] of excludedSources) {
    assert.ok(!readFileSync(path, "utf8").includes(drawingFeeNotice), `${label} excludes drawing-fee notice`);
  }
});

test("public tattoo rates and session lengths keep their approved copy and peer section hierarchy", () => {
  const source = readFileSync(join(ROOT, "tattoos", "index.html"), "utf8");
  const siteTypography = readFileSync(join(ROOT, "css", "site-typography.css"), "utf8");
  assert.match(source, /<section class="section" id="project-fit">[\s\S]*?<h2 class="section-title"[^>]*>Hourly Rates<\/h2>[\s\S]*?<\/section>\s*<section class="section session-offerings" id="session-lengths"/);
  assert.match(source, /<h2 class="section-title" id="sessionOfferingsTitle">Session Lengths<\/h2>/);
  assert.doesNotMatch(source, /The Review Process:|Ways to Collaborate:/);
  assert.match(siteTypography, /\.section-title\s*\{[\s\S]*?color:\s*var\(--type-section-color,[\s\S]*?font-size:\s*var\(--type-section-size-active,/);
  assert.match(source, /\.section-title\s*\{\s*margin-bottom:24px;\s*\}/);
  assert.match(source, /\.section-label:empty,\s*\.section-label:has\(> br:only-child\)\s*\{\s*display:none;\s*\}/);
  assert.doesNotMatch(source, /Rates &amp; Project Scope|rates-intro/);
  assert.match(source, /Original flash pieces are offered at a lower rate/);
  assert.match(source, /class="section-body section-body--ghost"[^>]*>All sessions require a deposit, applied toward the total cost/);
  assert.match(source, /\.section-body--ghost,\s*\.section-body--ghost \*\s*\{\s*color:var\(--text-ghost\) !important;\s*\}/);
  assert.match(source, /line-height:1\.8; color:var\(--text-mute\); max-width:620px/);
  assert.match(source, /class="section-body path-body"/);
  assert.match(source, /class="section-body ledger-body"/);
  assert.match(source, /class="section-body fit-body"/);
  assert.match(source, /class="section-body session-description"/);

  const sessionIds = ["tattoo_quarter", "tattoo_half", "tattoo_full", "tattoo_extended"];
  const positions = sessionIds.map((id) => source.indexOf(`data-booking-type="${id}"`));
  positions.forEach((position, index) => assert.ok(position > -1, `${sessionIds[index]} is listed`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "session lengths use booking order");
  assert.match(source, /<ul class="session-list" id="tattooSessionList"[\s\S]*data-booking-type="tattoo_extended"[\s\S]*<\/ul>/);
  assert.doesNotMatch(source, /class="extended-day-policy"/);
  assert.match(source, /tattooSessionTypes = Array\.isArray\(payload\.bookingTypes\)/);
});

test("Extended Day client surfaces use the approved optional-session copy", () => {
  const description = "Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee.";
  const optionality = "Extended day sessions are always optional and are presented as an option for clients who want longer sessions. Quarter, Half, and Full Day sessions do not include the Extended Day fee, and your project may be split across shorter appointments if desired. If additional appointments are needed, I will coordinate the remaining dates with you.";
  const clientSources = [
    join(ROOT, "tattoos", "index.html"),
    join(ROOT, "booking", "index.html"),
    join(ROOT, "functions", "api", "notifications", "_lib.js"),
    join(ROOT, "studio", "previews", "index.html"),
    join(ROOT, "studio", "submissions", "index.html"),
  ];
  for (const path of clientSources) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(description), `${path} includes the Extended Day description`);
    assert.ok(source.includes(optionality), `${path} includes the Extended Day optionality policy`);
  }

  const deprecatedPolicy = /eight-hour billing|8-hour billing|eight-hour minimum|8-hour minimum/i;
  const updatedSources = [
    ...clientSources,
    join(ROOT, "booking", "confirmed", "index.html"),
    join(ROOT, "booking", "reschedule", "index.html"),
    join(ROOT, "docs", "email-templates", "appointment-cancelled.md"),
    join(ROOT, "docs", "email-templates", "appointment-confirmed.md"),
    join(ROOT, "docs", "email-templates", "appointment-reminder-24h.md"),
    join(ROOT, "docs", "email-templates", "private-booking-link.md"),
  ];
  for (const path of updatedSources) {
    assert.doesNotMatch(readFileSync(path, "utf8"), deprecatedPolicy, `${path} removes superseded client copy`);
  }
});

test("tattoo final-payment guidance consistently requires payment at the appointment before tattooing begins", () => {
  const paymentRule = "At the start of your appointment, after the final design, placement, and session price are confirmed, the remaining balance must be paid before tattooing begins";
  const fullRuleSources = [
    join(ROOT, "tattoos", "policies", "index.html"),
    join(ROOT, "tattoos", "day-of", "index.html"),
    join(ROOT, "functions", "api", "notifications", "_lib.js"),
    join(ROOT, "functions", "api", "notifications", "_email-templates.js"),
    join(ROOT, "docs", "email-templates", "client-resource-pages.md"),
    join(ROOT, "docs", "email-templates", "appointment-confirmed.md"),
    join(ROOT, "docs", "email-templates", "appointment-reminder-24h.md"),
  ];
  for (const path of fullRuleSources) {
    const source = readFileSync(path, "utf8").replace(/\s+/g, " ");
    assert.ok(source.includes(paymentRule), `${path} states the final-payment rule`);
  }

  const supportingSources = [
    join(ROOT, "booking", "confirmed", "index.html"),
    join(ROOT, "booking", "reschedule", "index.html"),
    join(ROOT, "functions", "api", "booking", "_lib.js"),
  ];
  for (const path of supportingSources) {
    assert.match(readFileSync(path, "utf8"), /before tattooing begins/i, `${path} keeps the payment timing visible`);
  }

  const supersededCopy = /final payment is due at the session|due at the time of your appointment|tattooing, final payment/i;
  for (const path of [...fullRuleSources, ...supportingSources]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), supersededCopy, `${path} removes end-of-session payment wording`);
  }
});

test("tattoo client-resource pages use an opaque solid canvas without the shared wash", () => {
  const resourcePages = [
    join(ROOT, "tattoos", "policies", "index.html"),
    join(ROOT, "tattoos", "day-of", "index.html"),
    join(ROOT, "tattoos", "location-parking", "index.html"),
  ];
  for (const path of resourcePages) {
    assert.match(readFileSync(path, "utf8"), /<body class="tattoos-page tattoo-resource-page"/);
  }

  const sharedStyles = readFileSync(join(ROOT, "css", "tattoos.css"), "utf8");
  assert.match(sharedStyles, /\.tattoos-page\.tattoo-resource-page\s*\{\s*background:\s*var\(--color-bg\)/);
  assert.match(sharedStyles, /\.tattoos-page\.tattoo-resource-page::before\s*\{\s*content:\s*none;\s*opacity:\s*0;\s*background-image:\s*none/);
  assert.match(sharedStyles, /\.tattoos-page\.tattoo-resource-page \.section-kicker,[\s\S]*color:\s*var\(--color-breadcrumb-dim/);
  assert.match(sharedStyles, /\.tattoos-page\.tattoo-resource-page \.section-title\s*\{\s*color:\s*var\(--venture-accent/);
  assert.match(sharedStyles, /\.tattoos-page\.tattoo-resource-page \.hero-panel p,[\s\S]*\.tattoos-page\.tattoo-resource-page \.resource-list,[\s\S]*color:\s*var\(--color-text-muted\)/);

  const tokens = readFileSync(join(ROOT, "css", "tokens.css"), "utf8");
  assert.match(tokens, /--color-breadcrumb-dim:\s*rgba\(252,\s*184,\s*103,\s*0\.30\)/);
  assert.match(tokens, /--color-breadcrumb-hover:\s*rgba\(252,\s*184,\s*103,\s*0\.55\)/);
  assert.match(tokens, /--color-breadcrumb-ghost:\s*rgba\(252,\s*184,\s*103,\s*0\.13\)/);
  assert.match(tokens, /--color-breadcrumb-current:\s*rgba\(252,\s*184,\s*103,\s*0\.80\)/);

  const typography = readFileSync(join(ROOT, "css", "site-typography.css"), "utf8");
  assert.match(typography, /\.construct-breadcrumb a \{[\s\S]*color:\s*var\(--type-breadcrumb-color,\s*var\(--color-breadcrumb-dim/);
  assert.match(typography, /\.construct-breadcrumb-sep \{[\s\S]*color:\s*var\(--color-breadcrumb-ghost/);
  assert.match(typography, /\.construct-breadcrumb-current \{[\s\S]*color:\s*var\(--color-breadcrumb-current/);

  const policies = readFileSync(join(ROOT, "tattoos", "policies", "index.html"), "utf8");
  const hero = readFileSync(join(ROOT, "css", "hero.css"), "utf8");
  assert.match(policies, /\.tattoos-page \.hero\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);\s*align-items:\s*start/);
  assert.match(hero, /\.site-hero \.hero-descriptor\s*\{[\s\S]*max-width:\s*min\(100%, 380px\)\s*!important/);
  assert.match(policies, /<p class="hero-lead hero-descriptor" id="policy-hero-intro">/);
  assert.match(policies, /<h1 class="hero-title">/);
  assert.doesNotMatch(policies, /\bdata-fit-width\b/);
  assert.doesNotMatch(policies, /<span class="panel-label"><br><\/span>/);
  assert.doesNotMatch(policies, /Before you book/);
});

test("tattoo forms keep short controls uniform while paragraph fields can grow", () => {
  const sharedStyles = readFileSync(join(ROOT, "css", "forms.css"), "utf8");
  assert.match(sharedStyles, /--form-control-height:\s*53px/);
  assert.match(sharedStyles, /--form-control-textarea-min-height:\s*124px/);
  assert.match(sharedStyles, /height:\s*var\(--form-control-height\)/);
  assert.match(sharedStyles, /\.public-form textarea,[\s\S]*min-height:\s*var\(--form-control-textarea-min-height\)[\s\S]*field-sizing:\s*content[\s\S]*resize:\s*vertical/);

  const formSources = [
    join(ROOT, "tattoos", "inquire", "custom", "index.html"),
    join(ROOT, "tattoos", "flash", "claim", "index.html"),
    join(ROOT, "tattoos", "build", "index.html"),
    join(ROOT, "tattoos", "build", "in-person", "index.html"),
    join(ROOT, "tattoos", "inquire", "consultation", "index.html"),
    join(ROOT, "tattoos", "special-projects", "apply", "index.html"),
  ];
  for (const path of formSources) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /<body class="tattoo-flow"/);
    assert.match(source, /href="\/css\/tattoos\.css"/);
    assert.match(source, /href="\/css\/forms\.css"/);
    assert.match(source, /class="public-form"/);
  }
});

test("rendering-request migration, Studio guards, Square line item, history, resend, and cancellation stay separate from deposits", async () => {
  const database = migratedDatabase();
  const adminToken = "rendering-admin";
  const sent = [];
  const env = squareEnv(database, {
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    SQUARE_WEBHOOK_SIGNATURE_KEY: "rendering-signature",
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  });
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tattoo_rendering_requests'").get());

  const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 3 * 60 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, {
    id: "render-project",
    type: "tattoo_inquiry",
    status: "booked",
    tattooStage: "tattoo_scheduled",
    name: "Rendering Client",
    email: "rendering@example.test",
  });
  insertAppointmentFixture(database, {
    id: "render-appointment",
    submissionId: "render-project",
    bookingTypeId: "tattoo_half",
    purpose: "tattoo",
    startAt,
    endAt,
    depositCents: 10000,
  });

  const unauthorized = await handleAdminCreateTattooRenderingRequest(
    jsonRequest("/api/admin/booking/rendering-requests", { submissionId: "render-project" }),
    env,
  );
  assert.notEqual(unauthorized.status, 200);

  const squareBodies = [];
  let paymentLinkNumber = 0;
  await withMockFetch(async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith("/v2/online-checkout/payment-links") && init.method === "POST") {
      squareBodies.push(JSON.parse(init.body));
      paymentLinkNumber += 1;
      return jsonFetchResponse({ payment_link: {
        id: `render-link-${paymentLinkNumber}`,
        order_id: `render-order-${paymentLinkNumber}`,
        url: `https://square.link/u/render-${paymentLinkNumber}`,
      } });
    }
    if (target.includes("/v2/orders/render-order-") && !init.method) {
      return jsonFetchResponse({ order: { state: "OPEN" } });
    }
    if (target.includes("/v2/online-checkout/payment-links/render-link-") && init.method === "DELETE") {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const created = await handleAdminCreateTattooRenderingRequest(adminJsonRequest(
      "/api/admin/booking/rendering-requests",
      { submissionId: "render-project", appointmentId: "render-appointment" },
      adminToken,
    ), env);
    assert.equal(created.status, 200);
    const first = (await created.json()).renderingRequest;
    assert.equal(first.status, "pending");
    assert.equal(first.amountCents, 5000);
    assert.equal(first.expiresAt, startAt);
    assert.equal(squareBodies[0].order.line_items.length, 1);
    assert.deepEqual(squareBodies[0].order.line_items[0], {
      name: "Additional Tattoo Concept Sketch",
      quantity: "1",
      base_price_money: { amount: 5000, currency: "USD" },
    });
    assert.equal(database.prepare("SELECT count(*) count FROM deposit_payments WHERE appointment_id='render-appointment'").get().count, 0);
    assert.match(sent.at(-1).text, /non-refundable/i);
    assert.match(sent.at(-1).text, /not credited toward the tattoo total/i);
    assert.match(sent.at(-1).text, /appointment and included design direction remain unchanged/i);

    const duplicate = await handleAdminCreateTattooRenderingRequest(adminJsonRequest(
      "/api/admin/booking/rendering-requests",
      { submissionId: "render-project" },
      adminToken,
    ), env);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, "RENDERING_REQUEST_PENDING");

    const detail = await handleGetSubmission(
      new Request("https://example.test/api/admin/submissions/render-project", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env,
      "render-project",
    );
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).submission.renderingRequests.length, 1);

    const resent = await handleAdminResendTattooRenderingRequest(adminJsonRequest(
      `/api/admin/booking/rendering-requests/${first.id}/resend`,
      {},
      adminToken,
    ), env, first.id);
    assert.equal(resent.status, 200);
    assert.equal(sent.length, 2);

    const cancelled = await handleAdminCancelTattooRenderingRequest(adminJsonRequest(
      `/api/admin/booking/rendering-requests/${first.id}/cancel`,
      {},
      adminToken,
    ), env, first.id);
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).renderingRequest.status, "cancelled");
    assert.equal(database.prepare("SELECT status FROM appointments WHERE id='render-appointment'").get().status, "confirmed");

    const sequential = await handleAdminCreateTattooRenderingRequest(adminJsonRequest(
      "/api/admin/booking/rendering-requests",
      { submissionId: "render-project" },
      adminToken,
    ), env);
    assert.equal(sequential.status, 200);
    assert.equal((await sequential.json()).renderingRequest.requestNumber, 2);
  });

  insertSubmissionFixture(database, { id: "render-flash", type: "flash_claim", status: "booked", tattooStage: "tattoo_scheduled" });
  insertAppointmentFixture(database, {
    id: "render-flash-appointment",
    submissionId: "render-flash",
    bookingTypeId: "tattoo_quarter",
    purpose: "tattoo",
    startAt,
    endAt,
  });
  const flashRejected = await handleAdminCreateTattooRenderingRequest(adminJsonRequest(
    "/api/admin/booking/rendering-requests",
    { submissionId: "render-flash" },
    adminToken,
  ), env);
  assert.equal(flashRejected.status, 409);
  assert.equal((await flashRejected.json()).code, "RENDERING_PROJECT_INELIGIBLE");
});

test("rendering webhooks are idempotent and late payments require attention without changing the appointment or deposit", async () => {
  const database = migratedDatabase();
  const adminToken = "rendering-webhook-admin";
  const signatureKey = "rendering-webhook-secret";
  const notificationUrl = "https://example.test/api/square/webhook";
  const sent = [];
  const env = squareEnv(database, {
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  });
  const startAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 90 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, { id: "webhook-render-project", type: "maze_design", status: "booked", tattooStage: "tattoo_scheduled" });
  insertAppointmentFixture(database, {
    id: "webhook-render-appointment",
    submissionId: "webhook-render-project",
    bookingTypeId: "tattoo_quarter",
    purpose: "tattoo",
    startAt,
    endAt,
    depositCents: 5000,
  });
  insertPaymentFixture(database, {
    id: "original-deposit",
    appointmentId: "webhook-render-appointment",
    checkoutId: "original-deposit-link",
    orderId: "original-deposit-order",
    status: "paid",
    amountCents: 5000,
  });

  let renderingId = "";
  await withMockFetch(async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith("/v2/online-checkout/payment-links") && init.method === "POST") {
      return jsonFetchResponse({ payment_link: { id: "webhook-render-link", order_id: "webhook-render-order", url: "https://square.link/u/webhook-render" } });
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const response = await handleAdminCreateTattooRenderingRequest(adminJsonRequest(
      "/api/admin/booking/rendering-requests",
      { submissionId: "webhook-render-project" },
      adminToken,
    ), env);
    assert.equal(response.status, 200);
    renderingId = (await response.json()).renderingRequest.id;
  });

  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: { id: "render-payment", order_id: "webhook-render-order", status: "COMPLETED" } } },
  });
  const signature = await squareWebhookSignatureForTest(rawBody, signatureKey, notificationUrl);
  const makeWebhook = () => new Request(notificationUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature },
    body: rawBody,
  });
  await withMockFetch(
    async () => jsonFetchResponse({ order: { id: "webhook-render-order", state: "COMPLETED", net_amount_due_money: { amount: 0, currency: "USD" } } }),
    async () => {
      assert.equal((await handleSquareWebhook(makeWebhook(), env)).status, 200);
      assert.equal((await handleSquareWebhook(makeWebhook(), env)).status, 200);
    },
  );
  assert.equal(database.prepare("SELECT status FROM tattoo_rendering_requests WHERE id=?").get(renderingId).status, "paid");
  assert.equal(database.prepare("SELECT count(*) count FROM notification_deliveries WHERE template_key='tattoo_rendering_payment_confirmed' AND related_id=?").get(renderingId).count, 1);
  assert.equal(database.prepare("SELECT status FROM appointments WHERE id='webhook-render-appointment'").get().status, "confirmed");
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE id='original-deposit'").get().status, "paid");

  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO tattoo_rendering_requests (
      id, submission_id, appointment_id, request_number, amount_cents, currency, status,
      square_order_id, square_payment_link_id, square_checkout_url, expires_at, raw_json, created_at, updated_at
    ) VALUES ('late-render','webhook-render-project','webhook-render-appointment',2,5000,'USD','pending',
              'late-render-order','late-render-link','https://square.link/u/late',?,'{}',?,?)`,
  ).run(new Date(Date.now() - 1000).toISOString(), now, now);
  await withMockFetch(async (input, init = {}) => {
    const target = String(input);
    if (target.includes("/v2/orders/late-render-order")) return jsonFetchResponse({ order: { state: "OPEN" } });
    if (target.includes("/v2/online-checkout/payment-links/late-render-link") && init.method === "DELETE") return new Response(null, { status: 200 });
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const summary = await reapExpiredTattooRenderingRequests(env);
    assert.equal(summary.expired, 1);
  });
  assert.equal(database.prepare("SELECT status FROM tattoo_rendering_requests WHERE id='late-render'").get().status, "expired");

  const lateBody = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: { id: "late-payment", order_id: "late-render-order", status: "COMPLETED" } } },
  });
  const lateSignature = await squareWebhookSignatureForTest(lateBody, signatureKey, notificationUrl);
  const lateRequest = new Request(notificationUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-square-hmacsha256-signature": lateSignature },
    body: lateBody,
  });
  await withMockFetch(
    async () => jsonFetchResponse({ order: { state: "COMPLETED", net_amount_due_money: { amount: 0, currency: "USD" } } }),
    async () => assert.equal((await handleSquareWebhook(lateRequest, env)).status, 200),
  );
  assert.equal(database.prepare("SELECT status FROM tattoo_rendering_requests WHERE id='late-render'").get().status, "payment_attention");
  assert.equal(database.prepare("SELECT status FROM appointments WHERE id='webhook-render-appointment'").get().status, "confirmed");
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE id='original-deposit'").get().status, "paid");

  const cancelledAppointment = await handleAdminCancelAppointment(adminJsonRequest(
    "/api/admin/booking/appointments/webhook-render-appointment/cancel",
    { reason: "Paid rendering retention contract" },
    adminToken,
  ), env, "webhook-render-appointment");
  assert.equal(cancelledAppointment.status, 200);
  assert.equal(database.prepare("SELECT status FROM tattoo_rendering_requests WHERE id=?").get(renderingId).status, "paid");
});

test("rescheduling moves rendering expiry and appointment cancellation invalidates only unpaid rendering links", async () => {
  const database = migratedDatabase();
  const adminToken = "rendering-lifecycle-admin";
  const env = squareEnv(database, { SUBMISSIONS_ADMIN_TOKEN: adminToken });
  const now = new Date().toISOString();
  const originalStart = new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString();
  const originalEnd = new Date(Date.now() + 121.5 * 60 * 60 * 1000).toISOString();
  const targetStart = new Date(Date.now() + 144 * 60 * 60 * 1000).toISOString();
  const targetEnd = new Date(Date.now() + 145.5 * 60 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, {
    id: "render-lifecycle-project",
    type: "special_project",
    status: "booked",
    tattooStage: "tattoo_scheduled",
  });
  insertAvailabilityWindow(database, {
    id: "render-lifecycle-target",
    bookingTypeId: "tattoo_quarter",
    startAt: targetStart,
    endAt: targetEnd,
  });
  insertAppointmentFixture(database, {
    id: "render-lifecycle-appointment",
    submissionId: "render-lifecycle-project",
    bookingTypeId: "tattoo_quarter",
    status: "confirmed",
    purpose: "tattoo",
    startAt: originalStart,
    endAt: originalEnd,
  });
  database.prepare(
    `INSERT INTO tattoo_rendering_requests (
      id, submission_id, appointment_id, request_number, amount_cents, currency, status,
      square_order_id, square_payment_link_id, square_checkout_url, expires_at, raw_json, created_at, updated_at
    ) VALUES ('render-lifecycle-request','render-lifecycle-project','render-lifecycle-appointment',1,5000,'USD','pending',
              'render-lifecycle-order','render-lifecycle-link','https://square.link/u/render-lifecycle',?,'{}',?,?)`,
  ).run(originalStart, now, now);

  const moved = await handleAdminRescheduleAppointment(adminJsonRequest(
    "/api/admin/booking/appointments/render-lifecycle-appointment/reschedule",
    { availabilityWindowId: "render-lifecycle-target", note: "Move rendering deadline with appointment" },
    adminToken,
  ), env, "render-lifecycle-appointment");
  const movedPayload = await moved.json();
  assert.equal(moved.status, 200, JSON.stringify(movedPayload));
  assert.equal(database.prepare("SELECT expires_at FROM tattoo_rendering_requests WHERE id='render-lifecycle-request'").get().expires_at, targetStart);

  await withMockFetch(async (input, init = {}) => {
    const target = String(input);
    if (target.includes("/v2/online-checkout/payment-links/render-lifecycle-link") && init.method === "DELETE") {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const cancelled = await handleAdminCancelAppointment(adminJsonRequest(
      "/api/admin/booking/appointments/render-lifecycle-appointment/cancel",
      { reason: "Lifecycle contract cancellation" },
      adminToken,
    ), env, "render-lifecycle-appointment");
    assert.equal(cancelled.status, 200, JSON.stringify(await cancelled.clone().json()));
  });
  assert.equal(database.prepare("SELECT status FROM tattoo_rendering_requests WHERE id='render-lifecycle-request'").get().status, "cancelled");
  assert.equal(database.prepare("SELECT status FROM appointments WHERE id='render-lifecycle-appointment'").get().status, "cancelled");
});

test("All tattoo project types require budget and canonical ranges remain accepted", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const missingBudgetPayloads = [
    validCustom({ budget_range: "" }),
    {
      type: "flash_claim",
      name: "Flash Budget",
      email: "flash-budget@example.test",
      age_confirmed: "yes",
      selected_flash: "placeholder-flash",
      flash_claim_acknowledged: "yes",
      review_consent: "yes",
    },
    {
      type: "build_brief",
      name: "Build Budget",
      email: "build-budget@example.test",
      age_confirmed: "yes",
      placement: "Upper arm",
      design_intent: "A protected route.",
      symbol_ids: ["maze-path"],
      review_consent: "yes",
    },
    {
      type: "maze_design",
      name: "Maze Budget",
      email: "maze-budget@example.test",
      age_confirmed: "yes",
      maze_explanation: "A returning path.",
      review_consent: "yes",
    },
    {
      type: "special_project",
      name: "Special Budget",
      email: "special-budget@example.test",
      age_confirmed: "yes",
      project_title: "Mythic Body Studies",
      placement: "Back",
      message: "A long-form symbolic study.",
      review_consent: "yes",
    },
  ];
  for (const payload of missingBudgetPayloads) {
    const response = await handleCreateSubmission(jsonRequest("/api/submissions", payload), env);
    assert.equal(response.status, 400, payload.type);
    assert.equal((await response.json()).error, "Budget range is required.", payload.type);
  }

  for (const [index, budgetRange] of TATTOO_BUDGET_RANGES.entries()) {
    const response = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
      email: `budget-range-${index}@example.test`,
      budget_range: budgetRange,
    })), env);
    assert.equal(response.status, 200, budgetRange);
    const submissionId = (await response.json()).submissionId;
    const saved = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(submissionId).payload_json);
    assert.equal(saved.budget_range, budgetRange);
  }
});

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
    "approved_budget_min_cents",
    "approved_budget_max_cents",
    "approved_budget_currency",
    "budget_acknowledged",
    "budget_acknowledged_at",
  ]) assert.ok(columns("tattoo_session_plans").has(name), `tattoo_session_plans.${name}`);
  assert.ok(columns("visual_symbols").has("build_guidance_json"));
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
  for (const name of ["appointment_events", "tattoo_settings", "tattoo_rate_cards", "special_project_calls", "visual_symbol_composition_rules", "visual_symbol_composition_rule_members"]) {
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
  assert.deepEqual(
    database.prepare(
      "SELECT id, label, duration_minutes, deposit_cents, session_fee_cents, minimum_billable_minutes FROM booking_types WHERE id IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended') ORDER BY id"
    ).all().map((row) => ({ ...row })),
    [
      { id: "tattoo_extended", label: "Extended Day Session", duration_minutes: 600, deposit_cents: 35000, session_fee_cents: 20000, minimum_billable_minutes: 0 },
      { id: "tattoo_full", label: "Full Day Session", duration_minutes: 360, deposit_cents: 20000, session_fee_cents: 0, minimum_billable_minutes: 0 },
      { id: "tattoo_half", label: "Half Day Session", duration_minutes: 180, deposit_cents: 10000, session_fee_cents: 0, minimum_billable_minutes: 0 },
      { id: "tattoo_quarter", label: "Quarter Day Session", duration_minutes: 90, deposit_cents: 5000, session_fee_cents: 0, minimum_billable_minutes: 0 },
    ],
  );
});

test("Legend Build Guidance and composition rules normalize, publish, deduplicate, and respect route precedence", async () => {
  const database = migratedDatabase();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: "legend-admin",
  };
  const adminRequest = (path, method, body) => new Request(`https://example.test${path}`, {
    method,
    headers: {
      authorization: "Bearer legend-admin",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const guidanceResponse = await handleConstructApi(adminRequest("/api/admin/legend/fig-eye", "PATCH", {
    build_guidance_json: {
      essence: "Holds what is not ready to be released.",
      emotional_tones: ["protective", "patient", "protective"],
      reflection_questions: ["What are you holding?", "What is ready to be released?"],
    },
  }), env);
  assert.equal(guidanceResponse.status, 200);

  const publicSymbolResponse = await handleConstructApi(
    new Request("https://example.test/api/legend/fig-eye"),
    env,
  );
  assert.equal(publicSymbolResponse.status, 200);
  const publicSymbol = await publicSymbolResponse.json();
  assert.equal(publicSymbol.record.buildGuidance.essence, "Holds what is not ready to be released.");
  assert.deepEqual(publicSymbol.record.buildGuidance.emotionalTones, ["protective", "patient"]);

  const createResponse = await handleConstructApi(adminRequest("/api/admin/legend/composition-rules", "POST", {
    type: "reading",
    interpretation: "Containment connected to a remembered path may suggest carrying something through repetition.",
    state: "published",
    symbolIds: ["fig-eye", "maze-path"],
  }), env);
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.deepEqual(created.record.symbolIds, ["fig-eye", "maze-path"]);

  const duplicateResponse = await handleConstructApi(adminRequest("/api/admin/legend/composition-rules", "POST", {
    type: "reading",
    interpretation: "A duplicate set in reverse order.",
    state: "draft",
    symbolIds: ["maze-path", "fig-eye"],
  }), env);
  assert.equal(duplicateResponse.status, 409);
  const repeatedMemberResponse = await handleConstructApi(adminRequest("/api/admin/legend/composition-rules", "POST", {
    type: "tension",
    interpretation: "Repeated members are invalid.",
    state: "draft",
    symbolIds: ["maze-path", "maze-path"],
  }), env);
  assert.equal(repeatedMemberResponse.status, 400);

  const publicRulesResponse = await handleConstructApi(
    new Request("https://example.test/api/legend/composition-rules"),
    env,
  );
  assert.equal(publicRulesResponse.status, 200);
  const publicRules = await publicRulesResponse.json();
  assert.equal(publicRules.count, 1);
  assert.equal(publicRules.records[0].id, created.record.id);

  const patchResponse = await handleConstructApi(adminRequest(`/api/admin/legend/composition-rules/${created.record.id}`, "PATCH", {
    interpretation: "An updated approved reading.",
    symbolIds: ["maze-path", "fig-eye"],
  }), env);
  assert.equal(patchResponse.status, 200);
  const patched = await patchResponse.json();
  assert.deepEqual(patched.record.symbolIds, ["maze-path", "fig-eye"]);
  assert.equal(patched.record.interpretation, "An updated approved reading.");

  database.prepare("UPDATE visual_symbols SET state='retired' WHERE id='maze-path'").run();
  const filteredRulesResponse = await handleConstructApi(
    new Request("https://example.test/api/legend/composition-rules"),
    env,
  );
  assert.equal((await filteredRulesResponse.json()).count, 0);
  const retireResponse = await handleConstructApi(adminRequest(`/api/admin/legend/composition-rules/${created.record.id}`, "DELETE"), env);
  assert.equal(retireResponse.status, 200);
  assert.equal(database.prepare("SELECT state FROM visual_symbol_composition_rules WHERE id=?").get(created.record.id).state, "retired");
});

test("composition readings prefer exact authored rules, cap subsets, and keep conservative fallbacks", () => {
  const symbols = [
    { id: "a", name: "A", meaning: "First meaning.", themes: ["memory", "body"] },
    { id: "b", name: "B", meaning: "Second meaning.", themes: ["memory", "release"] },
    { id: "c", name: "C", meaning: "Third meaning.", themes: ["threshold"] },
  ];
  const rules = [
    { id: "ab", type: "reading", interpretation: "A and B may suggest remembered release.", symbolIds: ["a", "b"], sortOrder: 2 },
    { id: "ac", type: "tension", interpretation: "A and C hold memory against a threshold.", symbolIds: ["a", "c"], sortOrder: 1 },
    { id: "bc", type: "reading", interpretation: "B and C may suggest release through a threshold.", symbolIds: ["b", "c"], sortOrder: 3 },
    { id: "abc", type: "reading", interpretation: "The full set has one approved reading.", symbolIds: ["a", "b", "c"], sortOrder: 9 },
  ];

  const exact = buildCompositionSnapshot({ symbols, rules, selectedIds: ["a", "b", "c"] });
  assert.deepEqual(exact.appliedRules.map((rule) => rule.id), ["abc"]);
  assert.match(exact.reading, /One possible reading within the Legend/);

  const subset = buildCompositionSnapshot({ symbols, rules: rules.slice(0, 3), selectedIds: ["a", "b", "c"] });
  assert.deepEqual(subset.appliedRules.map((rule) => rule.id), ["ac", "ab", "bc"]);
  assert.equal(subset.appliedRules.length, 3);

  const shared = buildCompositionSnapshot({ symbols, rules: [], selectedIds: ["a", "b"] });
  assert.deepEqual(shared.sharedThemes, ["memory"]);
  assert.match(shared.reading, /may suggest a relationship/);

  const open = buildCompositionSnapshot({ symbols, rules: [], selectedIds: ["a", "c"] });
  assert.match(open.reading, /no fixed relationship has been authored/i);
  assert.match(open.reading, /Design Intent/);

  const single = buildCompositionSnapshot({ symbols, rules: [], selectedIds: ["a"] });
  assert.match(single.reading, /First meaning/);

  const largeSymbols = Array.from({ length: 12 }, (_, index) => ({
    id: `large-${index + 1}`,
    name: `Large ${index + 1}`,
    meaning: `Meaning ${index + 1} should not be concatenated into a large-build reading.`,
    themes: ["shared-theme", index % 2 ? "odd" : "even"],
  }));
  const large = buildCompositionSnapshot({
    symbols: largeSymbols,
    rules: [],
    selectedIds: largeSymbols.map((symbol) => symbol.id),
  });
  assert.match(large.reading, /12 selected symbols/);
  assert.match(large.reading, /shared-theme/);
  assert.doesNotMatch(large.reading, /Meaning 12/);
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

test("public tattoo settings publish active tattoo booking hours", async () => {
  const database = migratedDatabase();
  database.prepare(
    "UPDATE availability_rules SET active = 0 WHERE venture = 'tattooing'"
  ).run();
  database.prepare(
    "UPDATE availability_rules SET start_time = '11:00', end_time = '17:00', active = 1 WHERE id = 'tattooing_monday'"
  ).run();
  database.prepare(
    "UPDATE availability_rules SET start_time = '09:00', end_time = '15:00', active = 1 WHERE id = 'art_visit_tuesday'"
  ).run();

  class SelectBatchD1 extends LocalD1 {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()));
    }
  }

  const response = await handlePublicTattooSettings(
    new Request("https://example.test/api/tattoo/settings"),
    { SUBMISSIONS_DB: new SelectBatchD1(database) },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.displayedHours, [{
    dayOfWeek: 1,
    day: "Monday",
    dayLabel: "Monday",
    startTime: "11:00",
    endTime: "17:00",
    hoursText: "11:00 - 17:00",
    note: "",
    closed: false,
  }]);
});

test("Build submissions require intent, snapshot stable published symbol IDs, stay out of People, and are idempotent", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  database.prepare(
    `INSERT INTO visual_symbol_composition_rules
     (id,rule_type,interpretation,symbol_set_key,state,sort_order,created_at,updated_at)
     VALUES('path-room-reading','reading','A returning path inside a held room may suggest protected repetition.','maze-path|maze-room','published',1,datetime('now'),datetime('now'))`
  ).run();
  database.prepare(
    "INSERT INTO visual_symbol_composition_rule_members(rule_id,symbol_id,member_order) VALUES('path-room-reading','maze-path',0),('path-room-reading','maze-room',1)"
  ).run();
  const payload = {
    type: "build_brief",
    name: "Build Client",
    email: "build@example.test",
    age_confirmed: "yes",
    placement: "Upper arm",
    budget_range: "$500–$800",
    design_intent: "A protective path made from three linked marks.",
    review_consent: "yes",
    symbol_ids: ["maze-path", "maze-room"],
    composition_snapshot_json: JSON.stringify({
      version: 1,
      selectedSymbolIds: ["maze-path", "maze-room"],
      appliedRules: [],
      sharedThemes: ["protection"],
      reading: "This is the exact reading that remained visible in the client's resumed draft.",
    }),
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
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_people`
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_interactions
     WHERE source_provider='local' AND source_type='submission' AND source_id=?`
  ).get(firstBody.submissionId).count, 0);

  const row = database.prepare("SELECT status, tattoo_stage, payload_json FROM submissions WHERE id = ?").get(firstBody.submissionId);
  const saved = JSON.parse(row.payload_json);
  assert.equal(row.status, "new");
  assert.equal(row.tattoo_stage, "review");
  assert.deepEqual(saved.symbol_ids, ["maze-path", "maze-room"]);
  assert.deepEqual(saved.symbol_snapshot.map((symbol) => symbol.id), saved.symbol_ids);
  assert.equal(saved.design_intent, payload.design_intent);
  assert.deepEqual(saved.authored_composition_rules.map((rule) => rule.id), ["path-room-reading"]);
  assert.equal(saved.composition_snapshot.appliedRules[0].exact, true);
  assert.equal(saved.client_composition_snapshot.reading, "This is the exact reading that remained visible in the client's resumed draft.");

  const missingIntent = await handleCreateSubmission(jsonRequest("/api/submissions", { ...payload, design_intent: "" }), env);
  assert.equal(missingIntent.status, 400);
});

test("Build submissions reject empty, duplicate, oversized, and unavailable symbol selections", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const payload = {
    type: "build_brief",
    name: "Build Boundary Client",
    email: "build-boundary@example.test",
    age_confirmed: "yes",
    placement: "Upper arm",
    budget_range: "$300–$500",
    design_intent: "A protected route.",
    review_consent: "yes",
  };

  const empty = await handleCreateSubmission(jsonRequest("/api/submissions", payload), env);
  assert.equal(empty.status, 400);

  const duplicate = await handleCreateSubmission(jsonRequest("/api/submissions", {
    ...payload,
    symbol_ids: ["maze-path", "maze-path"],
  }), env);
  assert.equal(duplicate.status, 400);

  const oversized = await handleCreateSubmission(jsonRequest("/api/submissions", {
    ...payload,
    symbol_ids: Array.from({ length: 13 }, (_, index) => `symbol-${index}`),
  }), env);
  assert.equal(oversized.status, 400);

  const unavailable = await handleCreateSubmission(jsonRequest("/api/submissions", {
    ...payload,
    symbol_ids: ["missing-symbol"],
  }), env);
  assert.equal(unavailable.status, 409);
  assert.equal((await unavailable.json()).code, "SYMBOL_UNAVAILABLE");
});

test("Build drafts hash resume tokens, autosync with revisions, email links, and finalize into symbol notes", async () => {
  const database = migratedDatabase();
  const sent = [];
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: `draft-${sent.length}` };
      },
    },
  };
  const draftPayload = {
    version: 1,
    clientDraftId: "client-build-draft",
    symbolSelections: [{
      id: "maze-path",
      order: 0,
      name: "The Path",
      category: "MAZE",
      note: "Returning home with a different understanding.",
    }],
    compositionSnapshot: {
      version: 1,
      selectedSymbolIds: ["maze-path"],
      appliedRules: [],
      sharedThemes: [],
      reading: "The exact single-symbol reading shown before the draft was emailed.",
    },
    contact: { firstName: "Draft", lastName: "Client", email: "draft@example.test", phone: "" },
    placement: "Upper arm",
    scale: "Palm-size",
    budgetRange: "$500–$800",
    timeline: "No rush",
    designIntent: "A protected route.",
    message: "",
  };
  const created = await handleCreateBuildDraft(draftRequest(
    "/api/build-drafts",
    "POST",
    { kind: "build_brief", email: "draft@example.test", payload: draftPayload },
    "",
    { "cf-connecting-ip": "192.0.2.10" },
  ), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.emailSent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\/tattoos\/build\/#resume=/);
  assert.doesNotMatch(sent[0].text, /A protected route/);
  const stored = database.prepare("SELECT * FROM tattoo_build_drafts WHERE id=?").get(createdBody.draft.id);
  assert.notEqual(stored.token_hash, createdBody.resumeToken);
  assert.equal(stored.token_hash.length, 64);
  assert.equal(JSON.parse(stored.payload_json).budgetRange, "$500–$800");

  const fetched = await handleGetBuildDraft(draftRequest(
    "/api/build-drafts/current",
    "GET",
    undefined,
    createdBody.resumeToken,
  ), env);
  assert.equal(fetched.status, 200);
  const fetchedDraft = (await fetched.json()).draft;
  assert.equal(fetchedDraft.payload.symbolSelections[0].note, draftPayload.symbolSelections[0].note);
  assert.equal(fetchedDraft.payload.compositionSnapshot.reading, draftPayload.compositionSnapshot.reading);

  const updated = await handleUpdateBuildDraft(draftRequest(
    "/api/build-drafts/current",
    "PATCH",
    {
      revision: 1,
      payload: {
        ...draftPayload,
        designIntent: "A protected route that returns.",
      },
    },
    createdBody.resumeToken,
  ), env);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).draft.revision, 2);

  const conflict = await handleUpdateBuildDraft(draftRequest(
    "/api/build-drafts/current",
    "PATCH",
    { revision: 1, payload: draftPayload },
    createdBody.resumeToken,
  ), env);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "DRAFT_CONFLICT");

  const resent = await handleEmailBuildDraft(draftRequest(
    "/api/build-drafts/current/email",
    "POST",
    {},
    createdBody.resumeToken,
    { "cf-connecting-ip": "192.0.2.10" },
  ), env);
  assert.equal(resent.status, 200);
  assert.equal(sent.length, 2);

  const submissionPayload = {
    type: "build_brief",
    firstName: "Draft",
    lastName: "Client",
    email: "draft@example.test",
    age_confirmed: "yes",
    placement: "Upper arm",
    budget_range: "$500–$800",
    design_intent: "A protected route that returns.",
    review_consent: "yes",
    symbol_ids: ["maze-path"],
    symbol_selections: [{ id: "maze-path", order: 0, note: draftPayload.symbolSelections[0].note }],
    composition_snapshot: draftPayload.compositionSnapshot,
  };
  const submitted = await handleCreateSubmission(jsonRequest(
    "/api/submissions",
    submissionPayload,
    { "x-build-draft-token": createdBody.resumeToken },
  ), env);
  assert.equal(submitted.status, 200);
  const submissionId = (await submitted.json()).submissionId;
  const savedPayload = JSON.parse(database.prepare(
    "SELECT payload_json FROM submissions WHERE id=?"
  ).get(submissionId).payload_json);
  assert.equal(savedPayload.symbol_snapshot[0].client_note, draftPayload.symbolSelections[0].note);
  assert.equal(savedPayload.client_composition_snapshot.reading, draftPayload.compositionSnapshot.reading);
  const finalized = database.prepare(
    "SELECT status,submission_id,payload_json FROM tattoo_build_drafts WHERE id=?"
  ).get(createdBody.draft.id);
  assert.equal(finalized.status, "submitted");
  assert.equal(finalized.submission_id, submissionId);
  assert.equal(finalized.payload_json, "{}");
});

test("a failed resume email keeps the draft available and can be retried", async () => {
  const database = migratedDatabase();
  let attempts = 0;
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send() {
        attempts += 1;
        if (attempts === 1) throw new Error("Temporary delivery failure");
        return { messageId: "draft-retry-sent" };
      },
    },
  };
  const payload = {
    version: 1,
    clientDraftId: "email-retry-build",
    symbolSelections: [{
      id: "maze-path",
      order: 0,
      name: "The Path",
      category: "MAZE",
      note: "Keep this description while delivery is retried.",
    }],
    contact: { email: "retry-draft@example.test" },
    designIntent: "A route that can be resumed.",
  };
  const created = await handleCreateBuildDraft(draftRequest(
    "/api/build-drafts",
    "POST",
    { kind: "build_brief", email: "retry-draft@example.test", payload },
    "",
    { "cf-connecting-ip": "192.0.2.30" },
  ), env);
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.emailSent, false);
  assert.match(createdBody.deliveryError, /Temporary delivery failure/);
  assert.ok(createdBody.resumeToken);

  const stillAvailable = await handleGetBuildDraft(draftRequest(
    "/api/build-drafts/current",
    "GET",
    undefined,
    createdBody.resumeToken,
  ), env);
  assert.equal(stillAvailable.status, 200);
  assert.equal((await stillAvailable.json()).draft.payload.designIntent, payload.designIntent);

  const retried = await handleEmailBuildDraft(draftRequest(
    "/api/build-drafts/current/email",
    "POST",
    {},
    createdBody.resumeToken,
    { "cf-connecting-ip": "192.0.2.30" },
  ), env);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).emailSent, true);
  assert.equal(attempts, 2);
  assert.deepEqual(
    database.prepare(
      "SELECT delivered FROM tattoo_build_draft_email_attempts WHERE draft_id=? ORDER BY created_at,id"
    ).all(createdBody.draft.id).map((row) => row.delivered).sort(),
    [0, 1],
  );
});

test("Maze drafts enforce size, revocation, expiration cleanup, and email rate limits", async () => {
  const database = migratedDatabase();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: { async send() { return { messageId: crypto.randomUUID() }; } },
  };
  const mazePayload = {
    version: 1,
    clientDraftId: "maze-client-draft",
    mazeWalls: [{ instanceId: "wall-1", kind: "straight", points: [0, 0, 100, 0], stroke: "#151413", strokeWidth: 20, zIndex: 1 }],
    mazeShapes: [],
    contact: { email: "maze-draft@example.test" },
    placement: "",
    scale: "",
    budgetRange: "I’m flexible / I’d like guidance",
    mazeExplanation: "",
  };
  const created = await handleCreateBuildDraft(draftRequest(
    "/api/build-drafts",
    "POST",
    { kind: "maze_design", email: "maze-draft@example.test", payload: mazePayload },
    "",
    { "cf-connecting-ip": "192.0.2.20" },
  ), env);
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.match(database.prepare(
    "SELECT payload_json FROM tattoo_build_drafts WHERE id=?"
  ).get(createdBody.draft.id).payload_json, /wall-1/);
  assert.equal(
    JSON.parse(database.prepare("SELECT payload_json FROM tattoo_build_drafts WHERE id=?").get(createdBody.draft.id).payload_json).budgetRange,
    "I’m flexible / I’d like guidance",
  );

  const revoked = await handleDeleteBuildDraft(draftRequest(
    "/api/build-drafts/current",
    "DELETE",
    undefined,
    createdBody.resumeToken,
  ), env);
  assert.equal(revoked.status, 200);
  assert.equal(database.prepare(
    "SELECT status,payload_json FROM tattoo_build_drafts WHERE id=?"
  ).get(createdBody.draft.id).status, "revoked");

  const oversized = await handleCreateBuildDraft(draftRequest(
    "/api/build-drafts",
    "POST",
    {
      kind: "maze_design",
      email: "oversized@example.test",
      payload: { ...mazePayload, mazeWalls: [{ ...mazePayload.mazeWalls[0], extra: "x".repeat(2 * 1024 * 1024) }] },
    },
    "",
    { "cf-connecting-ip": "192.0.2.21" },
  ), env);
  assert.equal(oversized.status, 413);

  for (let index = 0; index < 3; index += 1) {
    const response = await handleCreateBuildDraft(draftRequest(
      "/api/build-drafts",
      "POST",
      { kind: "maze_design", email: "limited@example.test", payload: { ...mazePayload, clientDraftId: `limited-${index}` } },
      "",
      { "cf-connecting-ip": "192.0.2.22" },
    ), env);
    assert.equal(response.status, 201);
  }
  const limited = await handleCreateBuildDraft(draftRequest(
    "/api/build-drafts",
    "POST",
    { kind: "maze_design", email: "limited@example.test", payload: mazePayload },
    "",
    { "cf-connecting-ip": "192.0.2.22" },
  ), env);
  assert.equal(limited.status, 429);

  database.prepare(
    "UPDATE tattoo_build_drafts SET status='active',expires_at=? WHERE id=?"
  ).run(new Date(Date.now() - 1000).toISOString(), createdBody.draft.id);
  const reaped = await reapExpiredTattooBuildDrafts(env);
  assert.ok(reaped.expired >= 1);
  assert.equal(database.prepare(
    "SELECT status,payload_json FROM tattoo_build_drafts WHERE id=?"
  ).get(createdBody.draft.id).payload_json, "{}");
});

test("Maze submissions require generated artifacts and snapshot their wall and shape counts", async () => {
  const database = migratedDatabase();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSION_FILES: new MemoryBucket(),
    SUBMISSIONS_ADMIN_TOKEN: "maze-test-admin",
  };
  const payload = {
    type: "maze_design",
    name: "Maze Client",
    email: "maze@example.test",
    age_confirmed: "yes",
    budget_range: "$300–$500",
    maze_explanation: "A route through a protected threshold.",
    review_consent: "yes",
  };

  const missingArtifacts = await handleCreateSubmission(jsonRequest("/api/submissions", payload), env);
  assert.equal(missingArtifacts.status, 400);

  const created = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    payload,
    [
      {
        fieldName: "maze_image",
        fileName: "maze.png",
        contentType: "image/png",
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      },
      {
        fieldName: "maze_json_file",
        fileName: "maze.json",
        contentType: "application/json",
        body: JSON.stringify({
          mazeWalls: [{ id: "wall-1" }],
          mazeShapes: [{ id: "shape-1" }],
        }),
      },
    ],
  ), env);
  const createdPayload = await created.json();
  assert.equal(created.status, 200, createdPayload.detail || createdPayload.error);
  const submissionId = createdPayload.submissionId;
  const saved = JSON.parse(
    database.prepare("SELECT payload_json FROM submissions WHERE id = ?").get(submissionId).payload_json,
  );
  assert.deepEqual(saved.maze_artifact_snapshot, { wallCount: 1, shapeCount: 1 });
  assert.equal(database.prepare("SELECT status FROM maze_archive_consents WHERE submission_id=?").get(submissionId).status, "not_granted");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM maze_archive_entries WHERE submission_id=?").get(submissionId).count, 0);
  const ineligible = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, { title:"No Consent",altText:"A maze." }, "maze-test-admin"), env, submissionId);
  assert.equal(ineligible.status, 409);
});

test("Tattoo Specials public surface distinguishes scheduled, open, and closed sales windows", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const now = Date.now();

  database.prepare("UPDATE tattoo_special_settings SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='default'")
    .run(new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString());
  const scheduled = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(scheduled.state, "scheduled");
  assert.deepEqual(scheduled.offers, []);

  database.prepare("UPDATE tattoo_special_settings SET sales_opens_at=?,sales_closes_at=? WHERE id='default'")
    .run(new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString());
  const closed = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(closed.state, "closed");
  assert.deepEqual(closed.offers, []);
});

test("Tattoo index keeps the lower Specials block and reveals a matching brand-band action only while open", () => {
  const source = readFileSync(join(ROOT, "tattoos", "index.html"), "utf8");
  assert.match(source, /class="brand-band-link" id="tattooSpecialsBandCta" href="\/tattoos\/specials\/" hidden>View Current Specials<\/a>/);
  assert.match(source, /class="booking-cta" id="tattooSpecialsCta" hidden/);
  assert.match(source, /if \(payload\.state !== "open"\) return;[\s\S]*?if \(cta\) cta\.hidden = false;[\s\S]*?if \(bandCta\) bandCta\.hidden = false;/);
});

test("Tattoo Specials seed immutable versions and direct submissions keep server-side price, deposit, duration, and token cutoff", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const bucket = new MemoryBucket();
  const adminToken = "studio-specials-test";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: db, SUBMISSION_FILES: bucket, SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test", SQUARE_ACCESS_TOKEN: "square-token", SQUARE_LOCATION_ID: "square-location",
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  };
  const opens = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closes = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  database.prepare("UPDATE tattoo_special_settings SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='default'").run(opens, closes);

  const publicResponse = await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json();
  assert.equal(publicPayload.state, "open");
  assert.equal(publicPayload.offers.length, 6);
  assert.equal(publicPayload.offers.find((offer) => offer.id === "special-anime").variants.length, 2);

  const directResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm",
    variantId: "special-palm-v1-standard",
    idempotencyKey: "special-direct-palm-1",
    name: "Primary Person",
    email: "primary@example.com",
    phone: "4045550101",
    ageConfirmed: "yes",
    policyAccepted: "yes",
    placement: "Upper arm",
    projectDetails: "A palm-sized symbolic composition.",
    // These values are intentionally hostile; the server must ignore them.
    priceCents: "1",
    depositCents: "1",
    durationMinutes: "30",
  }), env);
  assert.equal(directResponse.status, 201);
  const direct = await directResponse.json();
  assert.equal(direct.reviewRequired, false);
  assert.match(direct.bookingUrl, /^\/booking\/\?token=/);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=? AND template_key='booking_link_created'",
  ).get(direct.submissionId).count, 0);
  const directReceipt = sent.find((message) => message.subject?.includes("Tattoo Special received"));
  assert.ok(directReceipt);
  assert.match(directReceipt.text, /no appointment is booked yet/i);
  assert.match(directReceipt.text, /confirmation email is sent only after Square reports a successful payment/i);

  const replayResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm", variantId: "special-palm-v1-standard", idempotencyKey: "special-direct-palm-1",
    name: "Primary Person", email: "primary@example.com", phone: "4045550101",
    ageConfirmed: "yes", policyAccepted: "yes", placement: "Upper arm", projectDetails: "Retry.",
  }), env);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.submissionId, direct.submissionId);
  assert.equal(replay.bookingUrl, direct.bookingUrl);

  const submission = database.prepare("SELECT * FROM submissions WHERE id=?").get(direct.submissionId);
  const terms = database.prepare("SELECT * FROM tattoo_special_submission_terms WHERE submission_id=?").get(direct.submissionId);
  assert.equal(submission.type, "tattoo_special");
  assert.equal(submission.status, "approved");
  assert.equal(submission.tattoo_stage, "ready_to_book");
  assert.equal(terms.advertised_price_cents, 20000);
  assert.equal(terms.approved_price_cents, 20000);
  assert.equal(terms.deposit_cents, 5000);
  assert.equal(terms.duration_minutes, 120);
  const tokenRow = database.prepare("SELECT * FROM booking_tokens WHERE submission_id=?").get(direct.submissionId);
  assert.equal(tokenRow.expires_at, closes);
  assert.deepEqual(JSON.parse(tokenRow.allowed_booking_types_json), ["tattoo_special_palm_v1"]);
  const directEmailVariants = database.prepare(
    "SELECT template_key,template_variant FROM notification_deliveries WHERE related_id=? ORDER BY template_key"
  ).all(direct.submissionId).map((row) => ({ ...row }));
  assert.deepEqual(directEmailVariants, [
    { template_key: "admin_submission_received", template_variant: "tattoo_special" },
    { template_key: "submission_received", template_variant: "tattoo_special" },
  ]);
  assert.ok(sent.some((message) => message.to === "primary@example.com" && /Tattoo Special has been received/i.test(message.html)));

  const rawToken = new URL(direct.bookingUrl, "https://example.test").searchParams.get("token");
  const contextResponse = await handleBookingContext(new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`), env);
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.equal(context.submission.special.offerTitle, "Palm Sized Tattoo");
  assert.equal(context.submission.special.quotedPriceCents, 20000);
  assert.equal(context.bookingTypes[0].durationMinutes, 120);
  assert.equal(context.bookingTypes[0].depositCents, 5000);
  assert.equal(context.sessionPlan, null);

  const unnecessaryApproval = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: rawToken, preference: "studio_plan", acknowledged: true, budgetAcknowledged: true,
  }), env);
  assert.equal(unnecessaryApproval.status, 409);
  assert.match((await unnecessaryApproval.json()).error, /do not require session-plan approval/i);
  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  assert.match(bookingPage, /Your Tattoo Special & Deposit/);
  assert.match(bookingPage, /special-offering/);
  const nearCutoff = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  database.prepare("UPDATE booking_tokens SET expires_at=? WHERE submission_id=?").run(nearCutoff, direct.submissionId);
  database.prepare("UPDATE tattoo_special_submission_terms SET sales_closes_at=? WHERE submission_id=?").run(nearCutoff, direct.submissionId);
  const appointmentStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const appointmentEnd = new Date(appointmentStart.getTime() + 120 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-palm-window", bookingTypeId: "tattoo_special_palm_v1",
    startAt: appointmentStart.toISOString(), endAt: appointmentEnd.toISOString(),
  });
  let squareRequestBody = null;
  const checkout = await withMockFetch(async (_url, init) => {
    squareRequestBody = JSON.parse(init.body);
    return jsonFetchResponse({ payment_link: { id: "special-palm-link", order_id: "special-palm-order", url: "https://square.test/special" } });
  }, () => handleCreateBookingCheckout(jsonRequest("/api/booking/checkout", {
    token: rawToken, bookingTypeId: "tattoo_special_palm_v1", availabilityWindowId: "special-palm-window",
  }), env));
  const checkoutPayload = await checkout.json();
  assert.equal(checkout.status, 200, checkoutPayload.detail || checkoutPayload.error);
  assert.deepEqual(squareRequestBody.order.line_items.map((item) => item.base_price_money.amount), [5000]);
  const specialAppointment = database.prepare("SELECT hold_expires_at,start_at,end_at FROM appointments WHERE id=?").get(checkoutPayload.appointmentId);
  assert.ok(new Date(specialAppointment.hold_expires_at).getTime() <= new Date(nearCutoff).getTime());
  assert.equal(specialAppointment.start_at, appointmentStart.toISOString());
  assert.equal(specialAppointment.end_at, appointmentEnd.toISOString());
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=? AND template_key IN ('appointment_confirmed','admin_appointment_confirmed')",
  ).get(checkoutPayload.appointmentId).count, 0);

  const webhookUrl = "https://example.test/api/square/webhook";
  const signatureKey = "specials-webhook-signature";
  const webhookBody = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: { id: "special-palm-payment", order_id: "special-palm-order", status: "COMPLETED" } } },
  });
  const webhookSignature = await squareWebhookSignatureForTest(webhookBody, signatureKey, webhookUrl);
  database.prepare("UPDATE tattoo_special_submission_terms SET sales_closes_at=? WHERE submission_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), direct.submissionId);
  const webhookResponse = await withMockFetch(async (url) => {
    assert.match(String(url), /\/v2\/orders\/special-palm-order$/);
    return jsonFetchResponse({ order: { id: "special-palm-order", state: "COMPLETED" } });
  }, () => handleSquareWebhook(new Request(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-square-hmacsha256-signature": webhookSignature },
    body: webhookBody,
  }), { ...env, SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey, SQUARE_WEBHOOK_NOTIFICATION_URL: webhookUrl }));
  const webhookPayload = await webhookResponse.json();
  assert.equal(webhookResponse.status, 200, webhookPayload.error);
  assert.equal(webhookPayload.attention, true);
  assert.match(webhookPayload.reason, /manual refund review/i);
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE appointment_id=?").get(checkoutPayload.appointmentId).status, "payment_attention");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointment_events WHERE appointment_id=? AND event_type='tattoo_special_late_payment_attention'").get(checkoutPayload.appointmentId).count, 1);

  const invalidSecondEmail = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-two-small",
    variantId: "special-two-small-v1-standard",
    idempotencyKey: "special-two-participants-invalid-email",
    name: "Primary Adult", email: "primary-adult@example.com", phone: "4045550120",
    participant2Name: "Second Adult", participant2Email: "second-adult@example", participant2Phone: "4045550121",
    ageConfirmed: "yes", participant2AgeConfirmed: "yes", policyAccepted: "yes",
    placement: "Two placements", projectDetails: "One small tattoo for each adult.",
  }), env);
  assert.equal(invalidSecondEmail.status, 400);
  assert.deepEqual(await invalidSecondEmail.json(), {
    error: "Enter a complete email address for the second adult participant, such as name@example.com.",
    field: "participant2Email",
  });

  const sharedAppointment = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-two-small",
    variantId: "special-two-small-v1-standard",
    idempotencyKey: "special-two-participants-1",
    name: "Primary Adult", email: "primary-adult@example.com", phone: "4045550120",
    participant2Name: "Second Adult", participant2Email: "second-adult@example.com", participant2Phone: "4045550121",
    ageConfirmed: "yes", participant2AgeConfirmed: "yes", policyAccepted: "yes",
    placement: "Two placements", projectDetails: "One small tattoo for each adult.",
  }), env);
  assert.equal(sharedAppointment.status, 201);
  const shared = await sharedAppointment.json();
  const sharedSubmission = database.prepare("SELECT payload_json,contact_email FROM submissions WHERE id=?").get(shared.submissionId);
  const sharedPayload = JSON.parse(sharedSubmission.payload_json);
  assert.equal(sharedPayload.participants.length, 2);
  assert.equal(sharedPayload.automated_messages_recipient, "primary-adult@example.com");
  assert.equal(sharedSubmission.contact_email, "primary-adult@example.com");
  assert.equal(database.prepare("SELECT participant_count,advertised_price_cents,duration_minutes FROM tattoo_special_submission_terms WHERE submission_id=?").get(shared.submissionId).participant_count, 2);
  assert.equal(sent.some((message) => message.to === "second-adult@example.com"), false);
  assert.ok(sent.some((message) => message.to === "primary-adult@example.com"));

  const beforeVersion = terms.offer_version_id;
  const adminState = await (await handleAdminTattooSpecials(draftRequest("/api/admin/tattoo/specials", "GET", undefined, adminToken), env)).json();
  const palm = adminState.offers.find((offer) => offer.id === "special-palm");
  const versionResponse = await handleAdminTattooSpecialOffer(adminJsonRequest(
    "/api/admin/tattoo/specials/offers/special-palm",
    {
      title: palm.title, slug: palm.slug, description: palm.description,
      durationMinutes: 150, depositCents: 6000, mode: "direct",
      referenceRequirement: "optional", participantCount: 1, active: true, sortOrder: palm.sortOrder,
      variants: [{ label: "Standard", priceCents: 22500, sortOrder: 10 }],
    }, adminToken, "PATCH",
  ), env, "special-palm");
  assert.equal(versionResponse.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM tattoo_special_offer_versions WHERE offer_id='special-palm'").get().count, 2);
  assert.equal(database.prepare("SELECT offer_version_id FROM tattoo_special_submission_terms WHERE submission_id=?").get(direct.submissionId).offer_version_id, beforeVersion);
  assert.equal(database.prepare("SELECT deposit_cents FROM booking_types WHERE id='tattoo_special_palm_v1'").get().deposit_cents, 5000);
});

test("Anime review requires a reference and approval can raise the exact price while preserving the advertised base", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const bucket = new MemoryBucket();
  const adminToken = "studio-specials-review";
  const env = { SUBMISSIONS_DB: db, SUBMISSION_FILES: bucket, SUBMISSIONS_ADMIN_TOKEN: adminToken };
  database.prepare("UPDATE tattoo_special_settings SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='default'")
    .run(new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString());
  const base = {
    offerId: "special-anime", variantId: "special-anime-v1-color", name: "Anime Client",
    email: "anime@example.com", phone: "4045550110", ageConfirmed: "yes", policyAccepted: "yes",
    placement: "Forearm", projectDetails: "Color character portrait with a detailed background.",
  };
  const missing = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", { ...base, idempotencyKey: "anime-missing-ref" }), env);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /requires at least one reference/i);

  const received = await handleCreateTattooSpecialSubmission(multipartRequest(
    "/api/tattoo/specials/submissions",
    { ...base, idempotencyKey: "anime-with-ref", referenceLink: "https://example.com/reference" },
  ), env);
  assert.equal(received.status, 201);
  const requestPayload = await received.json();
  assert.equal(requestPayload.reviewRequired, true);
  assert.equal(requestPayload.bookingUrl, "");
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id=?").get(requestPayload.submissionId).status, "new");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(requestPayload.submissionId).count, 0);

  const approved = await handleAdminTattooSpecialReview(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${requestPayload.submissionId}/review`,
    { outcome: "approved", approvedPriceCents: 25000, note: "Approved with simplified background detail." },
    adminToken, "PATCH",
  ), env, requestPayload.submissionId);
  assert.equal(approved.status, 200);
  const approval = await approved.json();
  assert.equal(approval.approvedPriceCents, 25000);
  assert.match(approval.bookingUrl, /^\/booking\/\?token=/);
  const storedTerms = database.prepare("SELECT * FROM tattoo_special_submission_terms WHERE submission_id=?").get(requestPayload.submissionId);
  assert.equal(storedTerms.advertised_price_cents, 20000);
  assert.equal(storedTerms.approved_price_cents, 25000);
  assert.equal(storedTerms.review_outcome, "approved");
  const savedPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(requestPayload.submissionId).payload_json);
  assert.equal(savedPayload.approved_price_cents, 25000);
  const approvedBookingEmail = database.prepare(
    "SELECT template_key,template_variant FROM notification_deliveries WHERE related_id=? AND template_key='booking_link_created'"
  ).get(requestPayload.submissionId);
  assert.deepEqual({ ...approvedBookingEmail }, { template_key: "booking_link_created", template_variant: "tattoo_special" });
});

test("Anime approval cannot issue a new Special booking link after the sales cutoff", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const adminToken = "studio-specials-cutoff";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: db, SUBMISSION_FILES: new MemoryBucket(), SUBMISSIONS_ADMIN_TOKEN: adminToken,
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  };
  database.prepare("UPDATE tattoo_special_settings SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='default'")
    .run(new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 3600000).toISOString());
  const received = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-anime", variantId: "special-anime-v1-bg", idempotencyKey: "anime-cutoff-review",
    name: "Cutoff Client", email: "cutoff@example.com", phone: "4045550199", ageConfirmed: "yes", policyAccepted: "yes",
    placement: "Forearm", projectDetails: "Character portrait.", referenceLink: "https://example.com/reference",
  }), env);
  const review = await received.json();
  assert.equal(received.status, 201);
  database.prepare("UPDATE tattoo_special_settings SET sales_closes_at=? WHERE id='default'")
    .run(new Date(Date.now() - 1000).toISOString());
  database.prepare("UPDATE tattoo_special_submission_terms SET sales_closes_at=? WHERE submission_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), review.submissionId);

  const approval = await handleAdminTattooSpecialReview(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${review.submissionId}/review`,
    { outcome: "approved", approvedPriceCents: 15000 }, adminToken, "PATCH",
  ), env, review.submissionId);
  assert.equal(approval.status, 409);
  assert.match((await approval.json()).error, /sales window has closed/i);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(review.submissionId).count, 0);

  const simplification = await handleAdminTattooSpecialReview(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${review.submissionId}/review`,
    { outcome: "simplification_requested", note: "Please remove the background and keep the portrait." }, adminToken, "PATCH",
  ), env, review.submissionId);
  assert.equal(simplification.status, 200);
  const reviewMessage = sent.find((message) => message.to === "cutoff@example.com" && /needs simplification/i.test(message.subject));
  assert.ok(reviewMessage);
  assert.match(reviewMessage.html, /TATTOO SPECIAL REVIEW/);
  assert.match(reviewMessage.html, /Please remove the background and keep the portrait/);
  const reviewDelivery = database.prepare(
    "SELECT template_key,template_variant FROM notification_deliveries WHERE related_id=? AND template_key='tattoo_special_review'"
  ).get(review.submissionId);
  assert.deepEqual({ ...reviewDelivery }, { template_key: "tattoo_special_review", template_variant: "simplification_requested" });
});

test("Maze Archive consent is explicit, separately scoped, versioned, and idempotent", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSION_FILES: bucket };
  const base = {
    type: "maze_design", firstName: "Jordan", lastName: "Rivera", email: "jordan@example.test",
    age_confirmed: "yes", budget_range: "Up to $300", maze_explanation: "A private path through grief.", review_consent: "yes",
  };
  const files = [
    { fieldName: "maze_image", fileName: "maze.png", contentType: "image/png", body: new Uint8Array([137,80,78,71,13,10,26,10]) },
    { fieldName: "maze_json_file", fileName: "maze.json", contentType: "application/json", body: JSON.stringify({ mazeWalls:[{id:"w"}],mazeShapes:[] }) },
  ];
  const invalid = await handleCreateSubmission(multipartRequest("/api/submissions", { ...base, maze_archive_opt_in:"yes", maze_archive_attribution:"display_name" }, files), env);
  assert.equal(invalid.status, 400);

  const request = multipartRequest("/api/submissions", {
    ...base, maze_archive_opt_in:"yes", maze_archive_attribution:"first_name", maze_archive_include_explanation:"yes",
  }, files);
  request.headers.set("idempotency-key", "maze-archive-consent-test");
  const first = await handleCreateSubmission(request, env);
  const firstPayload = await first.json();
  assert.equal(first.status, 200, firstPayload.detail || firstPayload.error);
  assert.equal(firstPayload.mazeArchive.consentStatus, "granted");
  assert.equal(firstPayload.mazeArchive.publicCredit, "Jordan");
  assert.equal(firstPayload.mazeArchive.includeExplanation, true);
  assert.equal(firstPayload.mazeArchive.curationStatus, "candidate");
  assert.equal(firstPayload.mazeArchive.consentVersion, "maze-archive-v1");

  const replay = multipartRequest("/api/submissions", {
    ...base, maze_archive_opt_in:"yes", maze_archive_attribution:"first_name", maze_archive_include_explanation:"yes",
  }, files);
  replay.headers.set("idempotency-key", "maze-archive-consent-test");
  const second = await handleCreateSubmission(replay, env);
  const secondPayload = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondPayload.idempotent, true);
  assert.equal(secondPayload.submissionId, firstPayload.submissionId);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM maze_archive_consents WHERE submission_id=?").get(firstPayload.submissionId).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM maze_archive_entries WHERE submission_id=?").get(firstPayload.submissionId).count, 1);
});

test("Maze Archive promotion copies one presentation PNG, stays private until canonical publication, and withdraws immediately", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const token = "maze-archive-admin";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSION_FILES: bucket, SUBMISSIONS_ADMIN_TOKEN: token };
  const request = multipartRequest("/api/submissions", {
    type:"maze_design",firstName:"Avery",lastName:"Stone",email:"avery@example.test",phone:"555-0100",
    placement:"forearm",budget_range:"Up to $300",maze_explanation:"This sentence may be considered.",review_consent:"yes",age_confirmed:"yes",
    maze_archive_opt_in:"yes",maze_archive_attribution:"display_name",maze_archive_display_name:"A. Stone",maze_archive_include_explanation:"yes",
  }, [
    { fieldName:"maze_image",fileName:"maze.png",contentType:"image/png",body:new Uint8Array([137,80,78,71,13,10,26,10]) },
    { fieldName:"maze_json_file",fileName:"maze.json",contentType:"application/json",body:JSON.stringify({mazeWalls:[{id:"w"}],mazeShapes:[{id:"s"}]}) },
  ]);
  const created = await handleCreateSubmission(request, env);
  const createdPayload = await created.json();
  assert.equal(created.status, 200, createdPayload.detail || createdPayload.error);
  const submissionId = createdPayload.submissionId;

  const rejected = await handleUpdateMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive`, { action:"reject",reviewNote:"Not this round." }, token, "PATCH"), env, submissionId);
  assert.equal((await rejected.json()).mazeArchive.curationStatus, "rejected");
  const restored = await handleUpdateMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive`, { action:"restore" }, token, "PATCH"), env, submissionId);
  assert.equal((await restored.json()).mazeArchive.curationStatus, "candidate");

  const originalFilesJson = database.prepare("SELECT files_json FROM submissions WHERE id=?").get(submissionId).files_json;
  database.prepare("UPDATE submissions SET files_json='[]' WHERE id=?").run(submissionId);
  const missingPng = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, { title:"Threshold Maze",altText:"A maze." }, token), env, submissionId);
  assert.equal(missingPng.status, 409);
  database.prepare("UPDATE submissions SET files_json=? WHERE id=?").run(originalFilesJson,submissionId);

  const missingAlt = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, { title:"Threshold Maze" }, token), env, submissionId);
  assert.equal(missingAlt.status, 400);
  class FailingPromotionD1 extends LocalD1 {
    async batch(statements) {
      if (statements.some(statement=>statement.sql.includes("INSERT INTO content_entities"))) throw new Error("simulated database failure");
      return super.batch(statements);
    }
  }
  env.SUBMISSIONS_DB = new FailingPromotionD1(database);
  const rolledBack = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, { title:"Threshold Maze",altText:"A maze." }, token), env, submissionId);
  assert.equal(rolledBack.status, 500);
  assert.equal(bucket.objects.has(`archive/maze/${submissionId}/public.png`), false);
  env.SUBMISSIONS_DB = new LocalD1(database);
  const promoted = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, {
    title:"Threshold Maze",altText:"Angular black maze walls and a centered circle.",publicExplanation:"A reviewed public version.",
  }, token), env, submissionId);
  const promotedPayload = await promoted.json();
  assert.equal(promoted.status, 201, promotedPayload.detail || promotedPayload.error);
  assert.equal(promotedPayload.mazeArchive.curationStatus, "promoted");
  const archiveKey = `archive/maze/${submissionId}/public.png`;
  assert.equal(bucket.objects.has(archiveKey), true);
  assert.equal([...bucket.objects.keys()].filter(key=>key===archiveKey).length, 1);
  assert.equal(database.prepare("SELECT visibility FROM content_entities WHERE id=?").get(promotedPayload.mazeArchive.archiveEntityId).visibility, "internal");
  assert.equal(database.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id=?").get(promotedPayload.mazeArchive.archiveEntityId).state, "draft");

  const replay = await handlePromoteMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive/promote`, {
    title:"Threshold Maze",altText:"Angular black maze walls and a centered circle.",
  }, token), env, submissionId);
  assert.equal((await replay.json()).idempotent, true);
  assert.equal(bucket.objects.size, 3); // two private source artifacts plus one public derivative

  const entityId = promotedPayload.mazeArchive.archiveEntityId;
  database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=datetime('now') WHERE id=?").run(entityId);
  database.prepare("UPDATE archive_records SET state='published' WHERE id=?").run(entityId);
  database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=datetime('now') WHERE entity_id=?").run(entityId);
  const publishedState = database.prepare("SELECT ce.visibility,ad.state dossier_state,ad.public_visible,ar.state record_state FROM content_entities ce JOIN archive_dossiers ad ON ad.entity_id=ce.id JOIN archive_records ar ON ar.id=ce.id WHERE ce.id=?").get(entityId);
  assert.equal(`${publishedState.visibility}/${publishedState.dossier_state}/${publishedState.public_visible}/${publishedState.record_state}`, "public/published/1/published");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id WHERE adc.dossier_entity_id=? AND ac.slug='maze-built-by-others' AND ac.state='published'").get(entityId).count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND EXISTS (SELECT 1 FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id WHERE adc.dossier_entity_id=ad.entity_id AND ac.state='published' AND (ac.slug=? OR lower(ac.name)=?))`).get("maze-built-by-others","maze-built-by-others").count, 1);
  class QueryD1 extends LocalD1 {
    async batch(statements) {
      return statements.every(statement=>/^SELECT\b/i.test(statement.sql.trim()))
        ? Promise.all(statements.map(statement=>statement.all()))
        : super.batch(statements);
    }
  }
  env.SUBMISSIONS_DB = new QueryD1(database);
  const publicResponse = await handleConstructApi(new Request("https://example.test/api/archive/items?collection=maze-built-by-others"), env);
  const publicPayload = await publicResponse.json();
  assert.equal(publicPayload.items.length, 1, JSON.stringify(publicPayload));
  assert.equal(publicPayload.items[0].title, "Threshold Maze");
  assert.equal(publicPayload.items[0].publicCredit, "A. Stone");
  assert.equal(publicPayload.items[0].primaryImageAlt, "Angular black maze walls and a centered circle.", JSON.stringify(publicPayload.items[0]));
  assert.match(publicPayload.items[0].primaryImage, /\/api\/construct\/entity-media\//, JSON.stringify(publicPayload.items[0]));
  const publicText = JSON.stringify(publicPayload);
  for (const secret of ["avery@example.test","555-0100","forearm","Up to $300","maze_json_file","submissions/"]) assert.doesNotMatch(publicText, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"));

  const withdrawn = await handleUpdateMazeArchiveSubmission(adminJsonRequest(`/api/admin/submissions/${submissionId}/maze-archive`, { action:"withdraw" }, token, "PATCH"), env, submissionId);
  assert.equal(withdrawn.status, 200);
  const after = await handleConstructApi(new Request("https://example.test/api/archive/items?collection=maze-built-by-others"), env);
  assert.equal((await after.json()).items.length, 0);
  assert.equal(bucket.objects.has(archiveKey), true);
  assert.equal(database.prepare("SELECT status FROM maze_archive_consents WHERE submission_id=?").get(submissionId).status, "withdrawn");
});

test("Build review UI keeps managed themes, load recovery, readable snapshots, and responsive Maze sizing", () => {
  const builder = readFileSync(join(ROOT, "js", "build-builder.js"), "utf8");
  const buildPage = readFileSync(join(ROOT, "tattoos", "build", "index.html"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const constructManager = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const composition = readFileSync(join(ROOT, "js", "build-composition.js"), "utf8");
  const mazeStyles = readFileSync(join(ROOT, "apps", "maze", "src", "styles.css"), "utf8");
  const mazeBuild = readFileSync(join(ROOT, "apps", "maze", "vite.config.ts"), "utf8");
  const receipt = readFileSync(join(ROOT, "tattoos", "submission-received", "index.html"), "utf8");
  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");

  assert.match(builder, /const otherThemes = \[\.\.\.availableThemes\]/);
  assert.match(builder, /setBuilderState\("The Legend could not be loaded\./);
  assert.match(builder, /legendRetry\?\.addEventListener\("click", init\)/);
  assert.match(buildPage, /id="builderState"/);
  assert.match(buildPage, /id="legendRetry"/);
  assert.match(buildPage, /\.symbol-info-button\{/);
  assert.match(buildPage, /id="legendDrawer"/);
  assert.match(buildPage, /id="compositionSnapshotJson"/);
  assert.match(buildPage, /type="module" src="\/js\/build-builder\.js"/);
  assert.doesNotMatch(buildPage, /class="grain"/);
  assert.match(builder, /openDrawer\(sym\.id, info\)/);
  assert.match(builder, /card\.addEventListener\("click", \(\) => toggleSymbol\(sym, card\)\)/);
  assert.match(builder, /drawerNoteInput\.disabled = !isSelected/);
  assert.match(builder, /event\.key === "Escape"/);
  assert.match(builder, /payload\.designIntent \|\| payload\.placement \|\| payload\.budgetRange \|\| payload\.message/);
  assert.match(composition, /MAX_APPLIED_RULES = 3/);
  assert.match(constructManager, /Legend Composition Rules/);
  assert.match(constructManager, /Build Guidance/);
  assert.match(studio, /class="symbol-snapshot-item"/);
  assert.match(studio, /Exact reading shown to client/);
  assert.match(studio, /p\("budget_range"\) \|\| p\("claim_bid"\)/);
  assert.match(studio, /\$\{field\("Budget", p\("budget_range"\)\)\}/);
  assert.match(studio, /typeof item === "object" \? JSON\.stringify\(item\)/);
  assert.match(receipt, /placement, scale, and budget before recommending/);
  assert.match(receipt, /placement, scale, and budget can translate/);
  assert.match(studio, /Approved Tattoo-Work Budget/);
  assert.match(studio, /approvedBudgetMinCents/);
  assert.match(studio, /Client-submitted comfort range/);
  assert.match(bookingPage, /Approved tattoo-work budget/);
  assert.match(bookingPage, /id="budgetAck"/);
  assert.match(bookingPage, /budgetAcknowledged:planHasReviewedBudget/);
  assert.match(mazeStyles, /grid-template-columns: minmax\(240px, 280px\) minmax\(500px, 1fr\) minmax\(280px, 330px\)/);
  assert.match(mazeStyles, /background: var\(--color-bg\)/);
  assert.match(mazeBuild, /codeSplitting:/);
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
  assert.equal(plan.artist_note, "The composition is planned for a Half Day Session.");
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
  assert.deepEqual(contextPayload.bookingTypes.map((bookingType) => bookingType.label), ["Half Day Session"]);
  assert.equal(contextPayload.sessionPlan.artistNote, "The composition is planned for a Half Day Session.");
  assert.equal(contextPayload.sessionEstimateCopy.sectionHeading, "Plan Your Tattoo Session");
  assert.equal(contextPayload.sessionEstimateCopy.confirmButtonLabel, "Accept This Estimate");
  assert.equal(
    contextPayload.sessionEstimateCopy.notAvailablePolicy,
    "I’ve included my recommended pacing below. If you have any questions, reach out to me directly: 7708205800",
  );
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

test("unused approved direct booking invites can be permanently deleted with their private links", async () => {
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
      purpose: "tattoo",
      bookingTypeId: "tattoo_quarter",
    },
    adminToken,
  ), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const submissionId = payload.directInvite.submissionId;
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id = ?").get(submissionId).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM tattoo_session_plans WHERE submission_id = ?").get(submissionId).count, 1);

  const deleted = await handleDeleteSubmission(
    adminJsonRequest(`/api/admin/submissions/${submissionId}`, {}, adminToken, "DELETE"),
    env,
    submissionId,
  );
  assert.equal(deleted.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM submissions WHERE id = ?").get(submissionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id = ?").get(submissionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM tattoo_session_plans WHERE submission_id = ?").get(submissionId).count, 0);
});

test("Studio can permanently delete a protected submission while retaining detached appointment and payment history", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  insertSubmissionFixture(database, {
    id: "submission-force-delete",
    type: "tattoo_inquiry",
    status: "booked",
    tattooStage: "tattoo_scheduled",
    email: "force-delete@example.test",
  });
  insertAppointmentFixture(database, {
    id: "appointment-force-delete",
    submissionId: "submission-force-delete",
    bookingTypeId: "tattoo_half",
    status: "cancelled",
    purpose: "tattoo",
    email: "force-delete@example.test",
    startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString(),
  });
  insertPaymentFixture(database, {
    id: "payment-force-delete",
    appointmentId: "appointment-force-delete",
    checkoutId: "checkout-force-delete",
    orderId: "order-force-delete",
    status: "paid",
    amountCents: 10000,
  });
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
  };

  const protectedResponse = await handleDeleteSubmission(
    adminJsonRequest("/api/admin/submissions/submission-force-delete", {}, adminToken, "DELETE"),
    env,
    "submission-force-delete",
  );
  assert.equal(protectedResponse.status, 409);

  const deleted = await handleDeleteSubmission(
    new Request("https://example.test/api/admin/submissions/submission-force-delete?force=1", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    }),
    env,
    "submission-force-delete",
  );
  const payload = await deleted.json();
  assert.equal(deleted.status, 200, JSON.stringify(payload));
  assert.equal(payload.detachedAppointments, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM submissions WHERE id = ?").get("submission-force-delete").count, 0);
  assert.equal(database.prepare("SELECT submission_id FROM appointments WHERE id = ?").get("appointment-force-delete").submission_id, null);
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE id = ?").get("payment-force-delete").status, "paid");
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

test("large cover-ups require at least three angle photographs without automatically requiring consultation", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    SUBMISSION_FILES: new MemoryBucket(),
    PUBLIC_SITE_URL: "https://example.test",
  };

  const missing = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    project_type: "large_cover_up",
  })), env);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /at least 3 photographs/i);

  const twoPhotos = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustom({ project_type: "large_cover_up" }),
    [
      { fieldName: "cover_up_photos", fileName: "angle-1.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-2.jpg" },
    ],
  ), env);
  assert.equal(twoPhotos.status, 400);
  assert.match((await twoPhotos.json()).error, /at least 3 photographs/i);

  const created = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustom({ project_type: "large_cover_up" }),
    [
      { fieldName: "cover_up_photos", fileName: "angle-1.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-2.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-3.jpg" },
    ],
  ), env);
  assert.equal(created.status, 200);
  const submissionId = (await created.json()).submissionId;
  const storedFiles = JSON.parse(
    database.prepare("SELECT files_json FROM submissions WHERE id = ?").get(submissionId).files_json,
  );
  assert.equal(storedFiles.filter((file) => file.fieldName === "cover_up_photos").length, 3);
  assert.equal(storedFiles.some((file) => file.fieldName === "placement_photo"), false);

  const additionalPhotos = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustom({
      project_type: "large_cover_up",
      email: "additional-photos@example.test",
    }),
    [
      { fieldName: "cover_up_photos", fileName: "angle-1.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-2.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-3.jpg" },
      { fieldName: "cover_up_photos", fileName: "detail-4.jpg" },
    ],
  ), env);
  assert.equal(additionalPhotos.status, 200);

  const approved = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(approved.status, 200);
  const approvedRow = database.prepare("SELECT status, tattoo_stage FROM submissions WHERE id = ?").get(submissionId);
  assert.equal(approvedRow.status, "approved");
  assert.equal(approvedRow.tattoo_stage, "review");
});

test("explicit consultation requirements move through completion before tattoo access", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };

  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    consult_required: "yes",
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
      approvedBudgetMinCents: 120000,
      approvedBudgetMaxCents: 180000,
      approvedBudgetCurrency: "USD",
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
  assert.deepEqual(tattooToken.allowedBookingTypes, ["tattoo_quarter", "tattoo_half", "tattoo_full", "tattoo_extended"]);
});

test("reviewed project budgets gate tattoo booking and require client agreement", async () => {
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
        return { id: crypto.randomUUID() };
      },
    },
  };

  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom({
    budget_range: "$500â€“$800",
  })), env);
  assert.equal(created.status, 200);
  const submissionId = (await created.json()).submissionId;

  const planWithoutBudget = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed tattoo session.",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(planWithoutBudget.status, 200);

  const approved = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(approved.status, 200);
  assert.equal(
    database.prepare("SELECT tattoo_stage FROM submissions WHERE id = ?").get(submissionId).tattoo_stage,
    "ready_to_book",
  );

  const missingBudgetToken = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_quarter"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(missingBudgetToken.status, 409);
  assert.equal((await missingBudgetToken.json()).code, "APPROVED_BUDGET_REQUIRED");

  const reversedBudget = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed tattoo session.",
      approvedBudgetMinCents: 120000,
      approvedBudgetMaxCents: 80000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(reversedBudget.status, 400);
  assert.equal((await reversedBudget.json()).code, "INVALID_APPROVED_BUDGET");

  const reviewedBudget = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed tattoo session.",
      approvedBudgetMinCents: 80000,
      approvedBudgetMaxCents: 120000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(reviewedBudget.status, 200);
  assert.equal((await reviewedBudget.json()).sessionPlan.budgetAcknowledged, false);
  assert.equal(
    JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id = ?").get(submissionId).payload_json).budget_range,
    "$500â€“$800",
  );

  sent.length = 0;
  const firstTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_quarter"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(firstTokenResponse.status, 200);
  const firstToken = (await firstTokenResponse.json()).token;
  assert.deepEqual(firstToken.approvedBudget, {
    minimumCents: 80000,
    maximumCents: 120000,
    currency: "USD",
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Approved tattoo-work budget: \$800.+\$1,200/);
  const firstRawToken = new URL(firstToken.bookingUrl).searchParams.get("token");

  const firstContextResponse = await handleBookingContext(
    new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(firstRawToken)}`),
    env,
  );
  const firstContext = await firstContextResponse.json();
  assert.equal(firstContextResponse.status, 200);
  assert.equal(firstContext.sessionPlan.approvedBudgetMinCents, 80000);
  assert.equal(firstContext.sessionPlan.approvedBudgetMaxCents, 120000);
  assert.equal(firstContext.sessionPlan.budgetAcknowledged, false);

  const missingBudgetAgreement = await handleSaveBookingSessionPlan(jsonRequest(
    "/api/booking/session-plan",
    {
      token: firstRawToken,
      preference: "studio_plan",
      acknowledged: true,
    },
  ), env);
  assert.equal(missingBudgetAgreement.status, 400);
  assert.equal(
    (await missingBudgetAgreement.json()).code,
    "APPROVED_BUDGET_ACKNOWLEDGEMENT_REQUIRED",
  );

  const firstAgreement = await handleSaveBookingSessionPlan(jsonRequest(
    "/api/booking/session-plan",
    {
      token: firstRawToken,
      preference: "studio_plan",
      acknowledged: true,
      budgetAcknowledged: true,
    },
  ), env);
  assert.equal(firstAgreement.status, 200);
  assert.equal((await firstAgreement.json()).sessionPlan.budgetAcknowledged, true);
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM submission_events WHERE submission_id = ? AND event_type = 'approved_budget_acknowledged'",
    ).get(submissionId).count,
    1,
  );

  const activeTokenRevision = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed tattoo session.",
      approvedBudgetMinCents: 125000,
      approvedBudgetMaxCents: 125000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(activeTokenRevision.status, 409);
  assert.equal((await activeTokenRevision.json()).code, "ACTIVE_BOOKING_BLOCKS_SESSION_PLAN_EDIT");

  const revoked = await handleAdminRevokeSubmissionBookingTokens(adminJsonRequest(
    "/api/admin/booking/tokens/revoke-submission",
    { submissionId },
    adminToken,
  ), env);
  assert.equal(revoked.status, 200);

  const exactBudget = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed tattoo session.",
      approvedBudgetMinCents: 125000,
      approvedBudgetMaxCents: 125000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(exactBudget.status, 200);
  const exactPlan = (await exactBudget.json()).sessionPlan;
  assert.equal(exactPlan.budgetAcknowledged, false);
  assert.equal(exactPlan.budgetAcknowledgedAt, "");

  const secondTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_quarter"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(secondTokenResponse.status, 200);
  const secondToken = (await secondTokenResponse.json()).token;
  assert.match(sent.at(-1).text, /Approved tattoo-work budget: \$1,250/);
  assert.doesNotMatch(sent.at(-1).text, /\$1,250.+\$1,250/);
  const secondRawToken = new URL(secondToken.bookingUrl).searchParams.get("token");
  const startAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 90 * 60 * 1000).toISOString();
  insertAvailabilityWindow(database, {
    id: "reviewed-budget-window",
    bookingTypeId: "tattoo_quarter",
    startAt,
    endAt,
  });

  const blockedHold = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: secondRawToken,
    bookingTypeId: "tattoo_quarter",
    availabilityWindowId: "reviewed-budget-window",
  }), env);
  assert.equal(blockedHold.status, 409);
  assert.match((await blockedHold.json()).error, /agree to the approved project budget/i);

  const secondAgreement = await handleSaveBookingSessionPlan(jsonRequest(
    "/api/booking/session-plan",
    {
      token: secondRawToken,
      preference: "studio_plan",
      acknowledged: true,
      budgetAcknowledged: true,
    },
  ), env);
  assert.equal(secondAgreement.status, 200);

  const hold = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: secondRawToken,
    bookingTypeId: "tattoo_quarter",
    availabilityWindowId: "reviewed-budget-window",
  }), env);
  assert.equal(hold.status, 200);
});

test("Extended Day is optional, has no billing minimum, remains acknowledged, and charges only its deposit in Square", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
    SQUARE_ACCESS_TOKEN: "square-token",
    SQUARE_LOCATION_ID: "square-location",
  };

  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom()), env);
  const submissionId = (await created.json()).submissionId;
  const approved = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken),
    env,
    submissionId,
  );
  assert.equal(approved.status, 200);
  const planResponse = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "client_choice",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 2,
      estimatedTotalMinutesMin: 480,
      estimatedTotalMinutesMax: 600,
      artistNote: "Choose one longer appointment or split the work.",
      approvedBudgetMinCents: 160000,
      approvedBudgetMaxCents: 200000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(planResponse.status, 200);

  const tokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    { submissionId, purpose: "tattoo", allowedBookingTypes: ["tattoo_half"], revokeExisting: true },
    adminToken,
  ), env);
  assert.equal(tokenResponse.status, 200);
  const issuedToken = (await tokenResponse.json()).token;
  assert.deepEqual(issuedToken.allowedBookingTypes, [
    "tattoo_quarter",
    "tattoo_half",
    "tattoo_full",
    "tattoo_extended",
  ]);
  const rawToken = new URL(issuedToken.bookingUrl).searchParams.get("token");
  const agreement = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: rawToken,
    preference: "one_longer_session",
    acknowledged: true,
    budgetAcknowledged: true,
  }), env);
  assert.equal(agreement.status, 200);

  const noExtendedDatesResponse = await handleBookingContext(
    new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`),
    env,
  );
  const noExtendedDatesContext = await noExtendedDatesResponse.json();
  assert.ok(noExtendedDatesContext.bookingTypes.some((type) => type.id === "tattoo_extended"));
  assert.equal(noExtendedDatesContext.availabilityWindows.some((windowItem) => windowItem.bookingTypeId === "tattoo_extended"), false);

  const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  startAt.setUTCHours(14, 0, 0, 0);
  const tooShortEnd = new Date(startAt.getTime() + 9 * 60 * 60 * 1000);
  const rejectedWindow = await handleAdminCreateAvailability(adminJsonRequest(
    "/api/admin/booking/availability",
    { venture: "tattooing", bookingTypeId: "tattoo_extended", startAt: startAt.toISOString(), endAt: tooShortEnd.toISOString(), isBlackout: false },
    adminToken,
  ), env);
  assert.equal(rejectedWindow.status, 400);
  assert.match((await rejectedWindow.json()).error, /exactly 10 hours/i);

  const endAt = new Date(startAt.getTime() + 10 * 60 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "extended-day-window",
    bookingTypeId: "tattoo_extended",
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  });
  const contextResponse = await handleBookingContext(
    new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`),
    env,
  );
  const context = await contextResponse.json();
  const extendedType = context.bookingTypes.find((type) => type.id === "tattoo_extended");
  assert.deepEqual(
    {
      durationMinutes: extendedType.durationMinutes,
      durationRangeLabel: extendedType.durationRangeLabel,
      depositCents: extendedType.depositCents,
      sessionFeeCents: extendedType.sessionFeeCents,
    },
    { durationMinutes: 600, durationRangeLabel: "8-10 hours", depositCents: 35000, sessionFeeCents: 20000 },
  );
  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  assert.match(bookingPage, /No Extended Day dates are currently available\. Shorter sessions remain bookable\./);

  const missingAcknowledgement = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_extended",
    availabilityWindowId: "extended-day-window",
  }), env);
  assert.equal(missingAcknowledgement.status, 400);
  assert.match((await missingAcknowledgement.json()).error, /acknowledge the Extended Day/i);

  let squareRequestBody = null;
  const checkoutResponse = await withMockFetch(async (_url, init) => {
    squareRequestBody = JSON.parse(init.body);
    return jsonFetchResponse({ payment_link: { id: "extended-link", order_id: "extended-order", url: "https://square.test/extended" } });
  }, () => handleCreateBookingCheckout(jsonRequest("/api/booking/checkout", {
    token: rawToken,
    bookingTypeId: "tattoo_extended",
    availabilityWindowId: "extended-day-window",
    tipCents: 2500,
    extendedDayAcknowledged: true,
  }), env));
  assert.equal(checkoutResponse.status, 200);
  assert.deepEqual(squareRequestBody.order.line_items.map((item) => item.base_price_money.amount), [35000, 2500]);
  assert.doesNotMatch(JSON.stringify(squareRequestBody.order.line_items), /20000|Extended Day Fee/);

  const appointmentId = (await checkoutResponse.json()).appointmentId;
  const appointmentRow = rowObject(database.prepare(
    "SELECT session_fee_cents, minimum_billable_minutes, extended_day_acknowledged_at FROM appointments WHERE id = ?",
  ).get(appointmentId));
  assert.equal(appointmentRow.session_fee_cents, 20000);
  assert.equal(appointmentRow.minimum_billable_minutes, 0);
  assert.ok(appointmentRow.extended_day_acknowledged_at);

  const confirmation = await handleConfirmBooking(
    new Request(`https://example.test/api/booking/confirm?appointment=${encodeURIComponent(appointmentId)}`),
    { ...env, SQUARE_ACCESS_TOKEN: "", SQUARE_LOCATION_ID: "" },
  );
  const confirmedPayload = await confirmation.json();
  assert.deepEqual(confirmedPayload.pricingSummary, {
    laborMinimumCents: 160000,
    laborMaximumCents: 200000,
    sessionFeeCents: 20000,
    combinedMinimumCents: 180000,
    combinedMaximumCents: 220000,
    depositCreditCents: 35000,
    remainingMinimumCents: 145000,
    remainingMaximumCents: 185000,
    currency: "USD",
  });
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
    consult_required: "yes",
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
  assert.equal(
    database.prepare("SELECT description FROM booking_types WHERE id = 'tattoo_extended'").get().description,
    "Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee.",
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
  assert.equal(sent[0].subject, "art.pill Tattoo House Tattoo Booking Confirmed");
  assert.equal(database.prepare(
    "SELECT status FROM notification_deliveries WHERE idempotency_key = ?",
  ).get(`admin_appointment_confirmed:${appointmentId}`).status, "sent");
});

test("tattoo admin notification subjects use canonical art.pill names without changing client subjects", async () => {
  const database = migratedDatabase();
  const sent = [];
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    ADMIN_NOTIFICATION_EMAIL: "studio@example.test",
    ADMIN_NOTIFICATION_FROM_EMAIL: "notifications@example.test",
    NOTIFICATION_REPLY_TO: "studio@example.test",
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: `subject-${sent.length}` };
      },
    },
  };
  const formNames = {
    tattoo_inquiry: "Custom Tattoo Inquiry",
    flash_claim: "Flash Claim",
    build_brief: "Build Your Own",
    maze_design: "Maze Studio Submission",
    special_project: "Special Projects Application",
  };
  for (const [type, name] of Object.entries(formNames)) {
    await notifyAdminSubmissionReceived(env, {
      id: `subject-${type}`,
      type,
      contact: { name: "Collector", email: "collector@example.test" },
      payload: {},
    });
    assert.equal(sent.at(-1).subject, `art.pill Tattoo House ${name}`);
  }

  await notifyAdminSubmissionReceived(env, {
    id: "build-detail-notification",
    type: "build_brief",
    contact: { name: "Collector", email: "collector@example.test" },
    payload: {
      selected_elements: "The Path",
      symbol_ids: ["maze-path"],
      placement: "Upper arm",
      scale: "Palm-size",
      budget_range: "$500–$800",
      design_intent: "A protected route.",
    },
  });
  assert.match(sent.at(-1).text, /Symbol Ids: maze-path/);
  assert.match(sent.at(-1).text, /Scale: Palm-size/);
  assert.match(sent.at(-1).text, /Budget Range: \$500–\$800/);
  assert.match(sent.at(-1).text, /Design Intent: A protected route\./);

  await notifyAdminSubmissionReceived(env, {
    id: "maze-detail-notification",
    type: "maze_design",
    contact: { name: "Collector", email: "collector@example.test" },
    payload: {
      maze_explanation: "A returning path.",
      scale: "Forearm-size",
      budget_range: "$800–$1,200",
      maze_artifact_snapshot: { wallCount: 4, shapeCount: 2 },
    },
  });
  assert.match(sent.at(-1).text, /Scale: Forearm-size/);
  assert.match(sent.at(-1).text, /Budget Range: \$800–\$1,200/);
  assert.match(sent.at(-1).text, /Maze Artifact Snapshot: \{"wallCount":4,"shapeCount":2\}/);

  const managedSheetPayload = {
    claim_bid: "$300-$600",
    sheet_design_selections: [
      { id: "sheet-a", code: "A", label: "Moth", placement: "Forearm", scale: "4 in" },
      { id: "sheet-b", code: "B", label: "Key", placement: "Ankle", scale: "" },
    ],
    approved_sheet_designs: [
      { id: "sheet-a", code: "A", label: "Moth", placement: "Forearm", scale: "4 in" },
    ],
  };
  await notifyAdminSubmissionReceived(env, {
    id: "managed-sheet-notification",
    type: "flash_claim",
    contact: { name: "Collector", email: "collector@example.test" },
    payload: managedSheetPayload,
  });
  assert.match(sent.at(-1).text, /Budget Range: \$300-\$600/);
  assert.match(sent.at(-1).text, /Requested sheet designs[\s\S]*A is Moth[\s\S]*B is Key/);
  assert.match(sent.at(-1).text, /Approved sheet designs[\s\S]*A is Moth/);

  await notifySubmissionReceived(env, {
    id: "client-subject-unchanged",
    type: "tattoo_inquiry",
    contact: { name: "Collector", email: "collector@example.test" },
    payload: {},
  });
  assert.equal(sent.at(-1).subject, "art.pill TATTOO HOUSE — Custom tattoo project received");

  await notifySubmissionReceived(env, {
    id: "managed-sheet-client-receipt",
    type: "flash_claim",
    contact: { name: "Collector", email: "collector@example.test" },
    payload: managedSheetPayload,
  });
  assert.match(sent.at(-1).text, /Requested sheet designs:[\s\S]*A is Moth[\s\S]*B is Key/);

  const appointmentFixtures = [
    ["tattoo_full", "tattoo", "art.pill Tattoo House Tattoo Booking Confirmed"],
    ["consult_in_person", "standalone_consultation", "art.pill Tattoo House In-Person Consultation Confirmed"],
    ["consult_virtual", "standalone_consultation", "art.pill Tattoo House Virtual Consultation Confirmed"],
    ["build_in_person", "build_session", "art.pill Tattoo House In-Person Build Session Confirmed"],
  ];
  for (const [bookingTypeId, purpose, expectedSubject] of appointmentFixtures) {
    const appointment = {
      id: `subject-${bookingTypeId}`,
      bookingTypeId,
      purpose,
      bookingTypeLabel: bookingTypeId,
      clientName: "Collector",
      clientEmail: "collector@example.test",
      startAt: "2026-08-08T16:00:00.000Z",
      endAt: "2026-08-08T17:00:00.000Z",
      depositCents: 5000,
      currency: "USD",
    };
    await notifyAdminAppointmentConfirmed(env, null, appointment);
    assert.equal(sent.at(-1).subject, expectedSubject);
    await notifyAdminAppointmentRescheduled(env, null, appointment, {
      previousStartAt: "2026-08-07T16:00:00.000Z",
      previousEndAt: "2026-08-07T17:00:00.000Z",
    });
    assert.equal(sent.at(-1).subject, expectedSubject.replace("Confirmed", "Rescheduled"));
  }
});

test("client transactional email catalog renders exact HTML and plain-text variants", () => {
  const catalog = clientEmailPreviewCatalog();
  const required = new Set([
    "tattoo_build_draft_resume",
    "submission_received",
    "booking_link_created",
    "tattoo_special_review",
    "appointment_confirmed",
    "consultation_confirmed_in_person",
    "consultation_confirmed_virtual",
    "build_session_confirmed",
    "studio_booking_confirmed",
    "appointment_rescheduled",
    "appointment_cancelled",
    "appointment_reminder_24h",
    "event_ticket_paid",
    "event_ticket_cancelled",
    "event_ticket_reminder_24h",
    "event_open_mic_slot",
    "admin_submission_received",
    "admin_appointment_confirmed",
    "admin_appointment_rescheduled",
    "admin_event_waitlist_received",
    "admin_event_open_mic_received",
    "admin_event_ticket_paid",
    "admin_test",
    "crm_relationship_followup",
    "crm_communication_preferences",
  ]);
  assert.ok(catalog.length >= 25);
  catalog.forEach((entry) => {
    required.delete(entry.templateKey);
    const rendered = renderClientEmailPreview(entry.templateKey, entry.variant);
    assert.ok(rendered, `${entry.templateKey}:${entry.variant} should render`);
    assert.ok(rendered.subject);
    assert.ok(rendered.preheader);
    assert.ok(rendered.text);
    assert.match(rendered.html, /<!doctype html>/i);
    assert.match(rendered.html, /role="presentation"/);
    assert.match(rendered.html, /background:#0E0E0E/);
    assert.match(
      rendered.html,
      new RegExp(escapeEmailHtml(rendered.preheader).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(rendered.html, /href="javascript:/i);
    assert.doesNotMatch(rendered.html, />undefined<|>null</i);
    assert.doesNotMatch(rendered.text, /\bundefined\b|\bnull\b/);
  });
  assert.deepEqual([...required], []);
  const nodeVariants = new Map(catalog.map((entry) => [`${entry.templateKey}:${entry.variant}`, entry.brand]));
  assert.equal(nodeVariants.get("submission_received:art_acquisition"), "art");
  assert.equal(nodeVariants.get("submission_received:studio_visit"), "art");
  assert.equal(nodeVariants.get("studio_booking_confirmed:studio_visit"), "art");
  assert.equal(nodeVariants.get("appointment_reminder_24h:studio_visit"), "art");
  assert.equal(nodeVariants.get("submission_received:studio_space"), "events");
  assert.equal(nodeVariants.get("studio_booking_confirmed:studio_space"), "events");
  assert.equal(nodeVariants.get("admin_submission_received:construct_art"), "art");
  assert.equal(nodeVariants.get("admin_appointment_confirmed:construct_event"), "events");
  const tattooSpecialVariants = [
    "submission_received:tattoo_special",
    "booking_link_created:tattoo_special",
    "tattoo_special_review:simplification_requested",
    "tattoo_special_review:declined",
    "appointment_confirmed:tattoo_special",
    "appointment_confirmed:tattoo_special_tip",
    "appointment_rescheduled:tattoo_special",
    "appointment_cancelled:tattoo_special",
    "appointment_reminder_24h:tattoo_special",
    "admin_submission_received:tattoo_special",
    "admin_appointment_confirmed:tattoo_special",
    "admin_appointment_rescheduled:tattoo_special",
  ];
  tattooSpecialVariants.forEach((key) => assert.equal(nodeVariants.get(key), "tattoo", `${key} should be independently editable`));
  assert.match(renderClientEmailPreview("submission_received", "art_acquisition").html, /#0039BD/);
  assert.match(renderClientEmailPreview("studio_booking_confirmed", "studio_visit").html, /#0039BD/);
  assert.match(renderClientEmailPreview("studio_booking_confirmed", "studio_space").html, /#005D25/);
});

test("Tattoo Special lifecycle correspondence uses dedicated editable variants", async () => {
  const database = migratedDatabase();
  const sent = [];
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: { async send(message) { sent.push(message); return { messageId: `tattoo-special-email-${sent.length}` }; } },
  };
  const appointment = {
    id: "tattoo-special-lifecycle-email",
    submissionId: "tattoo-special-lifecycle-submission",
    submissionType: "tattoo_special",
    bookingTypeId: "tattoo_special_palm_v1",
    bookingTypeLabel: "Palm Sized Tattoo",
    purpose: "tattoo",
    clientName: "Special Client",
    clientEmail: "special-client@example.test",
    startAt: "2026-08-08T16:00:00.000Z",
    endAt: "2026-08-08T18:00:00.000Z",
    depositCents: 5000,
    currency: "USD",
    specialOfferTitle: "Palm Sized Tattoo",
    specialVariantLabel: "Standard",
    specialApprovedPriceCents: 20000,
    specialDurationMinutes: 120,
  };

  await notifyAppointmentConfirmed(env, null, appointment);
  await notifyAdminAppointmentConfirmed(env, null, appointment);
  await notifyAppointmentRescheduled(env, null, appointment, {
    previousStartAt: "2026-08-07T16:00:00.000Z",
    previousEndAt: "2026-08-07T18:00:00.000Z",
  });
  await notifyAdminAppointmentRescheduled(env, null, appointment, {
    previousStartAt: "2026-08-07T16:00:00.000Z",
    previousEndAt: "2026-08-07T18:00:00.000Z",
  });
  await notifyAppointmentCancelled(env, null, appointment);

  const variants = database.prepare(
    "SELECT template_key,template_variant FROM notification_deliveries WHERE related_id=? ORDER BY template_key"
  ).all(appointment.id).map((row) => ({ ...row }));
  assert.deepEqual(variants, [
    { template_key: "admin_appointment_confirmed", template_variant: "tattoo_special" },
    { template_key: "admin_appointment_rescheduled", template_variant: "tattoo_special" },
    { template_key: "appointment_cancelled", template_variant: "tattoo_special" },
    { template_key: "appointment_confirmed", template_variant: "tattoo_special" },
    { template_key: "appointment_rescheduled", template_variant: "tattoo_special" },
  ]);
  assert.ok(sent.some((message) => /TATTOO SPECIAL APPOINTMENT/.test(message.html)));
  assert.ok(sent.some((message) => /UPDATED TATTOO SPECIAL/.test(message.html)));
  assert.ok(sent.some((message) => /TATTOO SPECIAL CANCELLED/.test(message.html)));

  const reminderStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const reminderEnd = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "tattoo-special-reminder-email",
    bookingTypeId: "tattoo_special_palm_v1",
    purpose: "tattoo",
    name: "Reminder Client",
    email: "reminder-client@example.test",
    startAt: reminderStart,
    endAt: reminderEnd,
  });
  const reminder = await sendDueAppointmentReminders(env);
  assert.equal(reminder.sent, 1);
  const reminderDelivery = database.prepare(
    "SELECT template_variant FROM notification_deliveries WHERE related_id='tattoo-special-reminder-email' AND template_key='appointment_reminder_24h'"
  ).get();
  assert.equal(reminderDelivery.template_variant, "tattoo_special");
  assert.match(sent.at(-1).html, /TATTOO SPECIAL REMINDER/);
});

test("Art inquiries and studio bookings use their routed node email families", async () => {
  const sent = [];
  const env = {
    PUBLIC_SITE_URL: "https://example.test",
    EVENTS_FROM_EMAIL: "studio@example.test",
    EVENTS_FROM_NAME: "the six.well construct",
    EVENTS_REPLY_TO: "studio@example.test",
    EMAIL: { async send(message) { sent.push(message); return { messageId: `node-email-${sent.length}` }; } },
  };

  await notifySubmissionReceived(env, {
    id: "art-acquisition-email",
    type: "art_acquisition",
    contact_name: "Collector",
    contact_email: "collector@example.test",
    payload_json: JSON.stringify({ artwork_title: "Signal Study" }),
  });
  assert.match(sent.at(-1).subject, /six\.well construct.*art acquisition inquiry received/i);
  assert.match(sent.at(-1).html, /#0039BD/);
  assert.doesNotMatch(sent.at(-1).html, /art\.pill TATTOO HOUSE/);

  await notifyAppointmentConfirmed(env, null, {
    id: "open-studio-visit-email",
    booking_type_id: "studio_visit",
    booking_type_label: "Open Studio Visit",
    purpose: "studio",
    client_name: "Visitor",
    client_email: "visitor@example.test",
    start_at: "2026-08-08T16:00:00.000Z",
    end_at: "2026-08-08T17:00:00.000Z",
    deposit_cents: 5000,
    currency: "USD",
  });
  assert.match(sent.at(-1).html, /ART STUDIO VISIT/);
  assert.match(sent.at(-1).html, /#0039BD/);

  await notifyAppointmentConfirmed(env, null, {
    id: "studio-gathering-email",
    booking_type_id: "studio_gathering",
    booking_type_label: "Studio Gathering",
    purpose: "studio",
    client_name: "Host",
    client_email: "host@example.test",
    start_at: "2026-08-08T18:00:00.000Z",
    end_at: "2026-08-08T20:00:00.000Z",
    deposit_cents: 15000,
    currency: "USD",
  });
  assert.match(sent.at(-1).html, /STUDIO RESERVATION/);
  assert.match(sent.at(-1).html, /#005D25/);
});

test("client email renderer escapes dynamic HTML and rejects unsafe action URLs", () => {
  const receipt = buildSubmissionReceivedEmail({
    subject: "Project <receipt>",
    clientName: "<img src=x onerror=alert(1)>",
    label: "custom <project>",
    submissionId: "ref-<014>",
    requestedSheetDesigns: ["<script>alert(1)</script>"],
    expectation: "Review <carefully>.",
    next: "Wait for the studio.",
    reviewLine: "Reviewed soon.",
    supportEmail: "studio@example.test",
  });
  assert.match(receipt.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(receipt.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(receipt.html, /<script>alert\(1\)<\/script>/);

  const booking = buildBookingLinkEmail({
    subject: "Private link",
    clientName: "Collector",
    consultation: false,
    sessionOptions: "Half Day Session",
    depositText: "$100",
    bookingUrl: "javascript:alert(1)",
    bookingTermsUrl: "https://example.test/terms",
    dayOfInstructionsUrl: "https://example.test/day-of",
  });
  assert.doesNotMatch(booking.html, /javascript:alert/i);
  assert.doesNotMatch(booking.text, /javascript:alert/i);
});

test("protected client email preview exposes only approved canned variants", async () => {
  const token = "preview-admin-token";
  const unauthorized = await handleAdminPreviewNotification(
    new Request("https://example.test/api/admin/notifications/preview"),
    { SUBMISSIONS_ADMIN_TOKEN: token },
  );
  assert.equal(unauthorized.status, 401);

  const headers = { Authorization: `Bearer ${token}` };
  const catalogResponse = await handleAdminPreviewNotification(
    new Request("https://example.test/api/admin/notifications/preview", { headers }),
    { SUBMISSIONS_ADMIN_TOKEN: token },
  );
  assert.equal(catalogResponse.status, 200);
  const catalogPayload = await catalogResponse.json();
  assert.ok(catalogPayload.templates.length >= 25);
  assert.equal(JSON.stringify(catalogPayload).includes("client@example"), false);

  const previewResponse = await handleAdminPreviewNotification(
    new Request(
      "https://example.test/api/admin/notifications/preview?templateKey=appointment_confirmed&variant=tip",
      { headers },
    ),
    { SUBMISSIONS_ADMIN_TOKEN: token },
  );
  assert.equal(previewResponse.status, 200);
  const previewPayload = await previewResponse.json();
  const exact = renderClientEmailPreview("appointment_confirmed", "tip");
  assert.equal(previewPayload.html, exact.html);
  assert.equal(previewPayload.text, exact.text);

  const unsupported = await handleAdminPreviewNotification(
    new Request(
      "https://example.test/api/admin/notifications/preview?templateKey=appointment_confirmed&variant=client-controlled",
      { headers },
    ),
    { SUBMISSIONS_ADMIN_TOKEN: token },
  );
  assert.equal(unsupported.status, 404);
});

test("Studio email templates save, validate, preview, test, publish, and restore revisions", async () => {
  const database = migratedDatabase();
  const sent = [];
  const token = "email-template-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: token,
    ADMIN_NOTIFICATION_EMAIL: "studio@example.test",
    EMAIL: { async send(message) { sent.push(message); return { messageId: "template-test" }; } },
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/templates/appointment_confirmed";

  const initialResponse = await handleAdminEmailTemplates(new Request(`${base}?variant=tattoo`, { headers }), env);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.draft, null);
  assert.equal(initial.published, null);
  assert.ok(initial.schema.allowedTokens.includes("client_name"));

  const content = structuredClone(initial.defaultContent);
  content.headline = "Your private appointment dossier is ready.";
  const saveResponse = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=tattoo`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 0, content }),
  }), env);
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.draft.revision, 1);

  const staleResponse = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=tattoo`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 0, content }),
  }), env);
  assert.equal(staleResponse.status, 409);

  const invalid = structuredClone(content);
  invalid.greeting = "Hello <script>alert(1)</script>";
  const invalidResponse = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=tattoo`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 1, content: invalid }),
  }), env);
  assert.equal(invalidResponse.status, 422);

  const previewResponse = await handleAdminPreviewNotification(new Request("https://example.test/api/admin/notifications/preview", {
    method: "POST", headers, body: JSON.stringify({ templateKey: "appointment_confirmed", variant: "tattoo", content }),
  }), env);
  const preview = await previewResponse.json();
  assert.match(preview.html, /private appointment dossier/);
  assert.match(preview.text, /private appointment dossier/);

  const testResponse = await handleAdminEmailTemplates(new Request(`${base}/test?variant=tattoo`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(testResponse.status, 200);
  const testResult = await testResponse.json();
  assert.equal(testResult.ok, true);
  assert.equal(testResult.delivery.recipient, "studio@example.test");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "studio@example.test");
  assert.match(sent[0].subject, /^\[TEST\] /);

  const publishResponse = await handleAdminEmailTemplates(new Request(`${base}/publish?variant=tattoo`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(publishResponse.status, 200);
  const published = await publishResponse.json();
  assert.equal(published.published.revision, 1);

  const restoreResponse = await handleAdminEmailTemplates(new Request(`${base}/restore?variant=tattoo`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1, baseRevision: 1 }),
  }), env);
  assert.equal(restoreResponse.status, 200);
  const restored = await restoreResponse.json();
  assert.equal(restored.draft.revision, 2);
  assert.deepEqual(restored.draft.content, content);

  const delivery = database.prepare(
    "SELECT template_variant,template_revision,email_theme FROM notification_deliveries WHERE related_type='email_template_test'",
  ).get();
  assert.equal(delivery.template_variant, "tattoo");
  assert.equal(delivery.template_revision, 1);
  assert.equal(delivery.email_theme, "tattoo");
});

test("Studio creates the email revision store on the first draft save when migration 0063 is pending", async () => {
  const database = migratedDatabase({ before: "0063_email_template_editor.sql" });
  const token = "email-template-bootstrap-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: token,
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/templates/appointment_confirmed";
  const initial = await (await handleAdminEmailTemplates(
    new Request(`${base}?variant=tattoo`, { headers }),
    env,
  )).json();

  assert.equal(initial.draft, null);
  assert.equal(initial.published, null);
  assert.equal(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='email_template_revisions'",
  ).get(), undefined);

  const saveResponse = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=tattoo`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ baseRevision: 0, content: initial.defaultContent }),
  }), env);
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.draft.revision, 1);
  assert.equal(saved.draft.status, "draft");
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM email_template_revisions WHERE template_key=? AND variant=?",
  ).get("appointment_confirmed", "tattoo").count, 1);
});

test("production email sends use only the published copy revision and keep live business data", async () => {
  const database = migratedDatabase();
  const sent = [];
  const token = "published-template-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: token,
    EMAIL: { async send(message) { sent.push(message); return { messageId: "published-copy" }; } },
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/templates/submission_received";
  const initial = await (await handleAdminEmailTemplates(new Request(`${base}?variant=custom`, { headers }), env)).json();
  const content = structuredClone(initial.defaultContent);
  content.headline = "Your {{submission_label}} is now inside the Studio dossier.";
  let response = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=custom`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 0, content }),
  }), env);
  assert.equal(response.status, 200);
  response = await handleAdminEmailTemplates(new Request(`${base}/publish?variant=custom`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(response.status, 200);

  const delivery = await notifySubmissionReceived(env, {
    id: "published-template-submission",
    type: "tattoo_inquiry",
    contact_name: "Live Client",
    contact_email: "live-client@example.test",
    payload_json: JSON.stringify({}),
  });
  assert.equal(delivery.ok, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /custom tattoo project is now inside the Studio dossier/);
  assert.match(sent[0].html, /Hi Live Client/);
  assert.match(sent[0].html, /published-template-submission/);
  const recorded = database.prepare(
    "SELECT template_variant,template_revision,email_theme FROM notification_deliveries WHERE related_id='published-template-submission' AND template_key='submission_received'",
  ).get();
  assert.equal(recorded.template_variant, "custom");
  assert.equal(recorded.template_revision, 1);
  assert.equal(recorded.email_theme, "tattoo");
});

test("published Tattoo Special receipt copy stays independent from Special Project correspondence", async () => {
  const database = migratedDatabase();
  const sent = [];
  const token = "tattoo-special-template-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: token,
    EMAIL: { async send(message) { sent.push(message); return { messageId: `special-template-${sent.length}` }; } },
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/templates/submission_received";
  const initial = await (await handleAdminEmailTemplates(
    new Request(`${base}?variant=tattoo_special`, { headers }),
    env,
  )).json();
  const content = structuredClone(initial.defaultContent);
  content.headline = "Your {{submission_label}} request is now in the dedicated Studio review queue.";
  let response = await handleAdminEmailTemplates(new Request(`${base}/draft?variant=tattoo_special`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 0, content }),
  }), env);
  assert.equal(response.status, 200);
  response = await handleAdminEmailTemplates(new Request(`${base}/publish?variant=tattoo_special`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(response.status, 200);

  await notifySubmissionReceived(env, {
    id: "dedicated-tattoo-special-receipt",
    type: "tattoo_special",
    contact_name: "Special Client",
    contact_email: "special@example.test",
    payload_json: JSON.stringify({}),
  });
  await notifySubmissionReceived(env, {
    id: "ordinary-special-project-receipt",
    type: "special_project",
    contact_name: "Project Client",
    contact_email: "project@example.test",
    payload_json: JSON.stringify({}),
  });
  assert.match(sent[0].html, /Tattoo Special request is now in the dedicated Studio review queue/);
  assert.doesNotMatch(sent[1].html, /dedicated Studio review queue/);
  assert.match(sent[1].html, /special project application has been received/i);
});

test("Open Studio Visit cancellations and reminders keep the Art node identity", async () => {
  const cancellationSends = [];
  const cancellation = await notifyAppointmentCancelled(
    {
      PUBLIC_SITE_URL: "https://example.test",
      EVENTS_FROM_EMAIL: "events@example.test",
      EVENTS_FROM_NAME: "the six.well construct",
      EVENTS_REPLY_TO: "events@example.test",
      EMAIL: {
        async send(message) {
          cancellationSends.push(message);
          return { messageId: "studio-cancelled" };
        },
      },
    },
    new Request("https://example.test/api/booking/cancel"),
    {
      id: "studio-cancelled",
      booking_type_id: "studio_visit",
      booking_type_label: "Open Studio Visit",
      purpose: "studio",
      client_name: "Studio Guest",
      client_email: "guest@example.test",
      start_at: "2026-08-08T16:00:00.000Z",
      end_at: "2026-08-08T17:00:00.000Z",
    },
  );
  assert.equal(cancellation.ok, true);
  assert.equal(cancellationSends[0].from.name, "the six.well construct");
  assert.match(cancellationSends[0].subject, /Open Studio Visit/i);
  assert.match(cancellationSends[0].html, /ART STUDIO VISIT CANCELLED/);
  assert.match(cancellationSends[0].html, /#0039BD/);
  assert.doesNotMatch(cancellationSends[0].html, /art\.pill/i);
  assert.doesNotMatch(cancellationSends[0].text, /art\.pill/i);

  const database = migratedDatabase();
  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "studio-reminder",
    bookingTypeId: "studio_visit",
    purpose: "studio",
    name: "Studio Guest",
    email: "guest@example.test",
    startAt,
    endAt,
    depositCents: 5000,
  });
  const reminderSends = [];
  const reminderResult = await sendDueAppointmentReminders({
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    EVENTS_FROM_EMAIL: "events@example.test",
    EVENTS_FROM_NAME: "the six.well construct",
    EVENTS_REPLY_TO: "events@example.test",
    EMAIL: {
      async send(message) {
        reminderSends.push(message);
        return { messageId: "studio-reminder" };
      },
    },
  });
  assert.equal(reminderResult.sent, 1);
  assert.equal(reminderSends[0].from.name, "the six.well construct");
  assert.match(reminderSends[0].html, /ART STUDIO VISIT REMINDER/);
  assert.match(reminderSends[0].html, /#0039BD/);
  assert.doesNotMatch(reminderSends[0].html, /art\.pill/i);
  assert.doesNotMatch(reminderSends[0].text, /art\.pill/i);
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

test("Zoom meetings send Eastern wall-clock time without applying the UTC offset twice", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  insertAppointmentFixture(database, {
    id: "zoom-time-contract",
    bookingTypeId: "consult_virtual",
    status: "confirmed",
    purpose: "standalone_consultation",
    name: "Taylor Bond",
    email: "taylor@example.test",
    startAt: "2026-07-24T16:30:00.000Z",
    endAt: "2026-07-24T17:15:00.000Z",
    holdState: "converted",
  });
  const meetingCreatedAt = new Date().toISOString();
  database.prepare(
    `INSERT INTO appointment_meetings (
      id, appointment_id, provider, provider_meeting_id, join_url,
      password, raw_json, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    "zoom-time-contract-existing-row",
    "zoom-time-contract",
    "zoom",
    "zoom-time-contract-existing",
    "https://zoom.example.test/j/old-time-contract",
    "",
    "{}",
    meetingCreatedAt,
    meetingCreatedAt,
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
  let zoomRequest = null;
  let oldMeetingDeleted = false;
  const response = await withMockFetch(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("zoom.us/oauth/token")) {
      return jsonFetchResponse({ access_token: "zoom-access-token" });
    }
    if (url.includes("api.zoom.us/v2/meetings/zoom-time-contract-existing") && options.method === "DELETE") {
      oldMeetingDeleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes("api.zoom.us/v2/users/") && options.method === "POST") {
      zoomRequest = JSON.parse(options.body);
      return jsonFetchResponse({
        id: "zoom-meeting-time-contract",
        join_url: "https://zoom.example.test/j/time-contract",
        password: "",
      }, 201);
    }
    throw new Error(`Unexpected Zoom time-contract fetch: ${options.method || "GET"} ${url}`);
  }, () => handleAdminCreateAppointmentMeeting(
    adminJsonRequest(
      "/api/admin/booking/appointments/zoom-time-contract/meeting",
      {},
      adminToken,
    ),
    env,
    "zoom-time-contract",
  ));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.replaced, true);
  assert.equal(oldMeetingDeleted, true);
  assert.equal(zoomRequest.start_time, "2026-07-24T12:30:00");
  assert.equal(zoomRequest.timezone, "America/New_York");
  assert.equal(zoomRequest.duration, 45);
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
  assert.equal(
    JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(firstId).payload_json).budget_range,
    "$300-$600",
  );

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

test("managed sheet claims approve subsets atomically and place only approved designs", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
  };
  const flash = database.prepare(
    "SELECT id FROM flash_items WHERE state='available' AND claimable=1 ORDER BY id LIMIT 1",
  ).get();
  assert.ok(flash?.id);
  database.prepare("UPDATE flash_items SET item_type='sheet' WHERE id=?").run(flash.id);
  const now = new Date().toISOString();
  const designs = [
    { id: "sheet-design-a", code: "A", label: "Moth" },
    { id: "sheet-design-b", code: "B", label: "Key" },
    { id: "sheet-design-c", code: "C", label: "Candle" },
  ];
  for (const [index, design] of designs.entries()) {
    database.prepare(
      `INSERT INTO flash_sheet_designs
       (id,flash_item_id,code,label,state,sort_order,created_at,updated_at)
       VALUES (?,?,?,?, 'available', ?, ?, ?)`,
    ).run(design.id, flash.id, design.code, design.label, index + 1, now, now);
  }

  const claim = (name, email, selections) => ({
    type: "flash_claim",
    name,
    email,
    age_confirmed: "yes",
    selected_flash: flash.id,
    sheet_design_selections_json: selections,
    budget_range: "$800–$1,200",
    review_consent: "yes",
    flash_claim_acknowledged: "yes",
    session_plan_acknowledged: "yes",
  });
  const missingSelection = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Missing Selection",
    "missing@example.test",
    undefined,
  )), env);
  assert.equal(missingSelection.status, 400);
  const otherFlash = database.prepare(
    "SELECT id FROM flash_items WHERE id<>? ORDER BY id LIMIT 1",
  ).get(flash.id);
  assert.ok(otherFlash?.id);
  database.prepare(
    `INSERT INTO flash_sheet_designs
     (id,flash_item_id,code,label,state,sort_order,created_at,updated_at)
     VALUES ('other-sheet-design',?,'A','Other sheet design','available',1,?,?)`,
  ).run(otherFlash.id, now, now);
  const crossSheet = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Cross Sheet",
    "cross@example.test",
    [
      { id: designs[0].id, placement: "Forearm", scale: "" },
      { id: "other-sheet-design", placement: "Ankle", scale: "" },
    ],
  )), env);
  assert.equal(crossSheet.status, 409);
  database.prepare("UPDATE flash_sheet_designs SET state='retired' WHERE id=?").run(designs[2].id);
  const unavailableSelection = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Unavailable Design",
    "unavailable@example.test",
    [{ id: designs[2].id, placement: "Calf", scale: "" }],
  )), env);
  assert.equal(unavailableSelection.status, 409);
  database.prepare("UPDATE flash_sheet_designs SET state='available' WHERE id=?").run(designs[2].id);
  const invalidDuplicate = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Duplicate Claim",
    "duplicate@example.test",
    [
      { id: designs[0].id, placement: "Left forearm", scale: "4 in" },
      { id: designs[0].id, placement: "Right forearm", scale: "5 in" },
    ],
  )), env);
  assert.equal(invalidDuplicate.status, 400);

  const firstClaimPayload = claim(
    "Subset Claim",
    "subset@example.test",
    [
      { id: designs[0].id, placement: "Left forearm", scale: "4 in" },
      { id: designs[1].id, placement: "Right ankle", scale: "" },
    ],
  );
  const firstCreate = await handleCreateSubmission(jsonRequest(
    "/api/submissions",
    firstClaimPayload,
    { "idempotency-key": "managed-sheet-subset-claim" },
  ), env);
  const secondCreate = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Grouped Claim",
    "grouped@example.test",
    [
      { id: designs[1].id, placement: "Left calf", scale: "5 in" },
      { id: designs[2].id, placement: "Right calf", scale: "5 in" },
    ],
  )), env);
  const conflictCreate = await handleCreateSubmission(jsonRequest("/api/submissions", claim(
    "Atomic Conflict",
    "conflict@example.test",
    [
      { id: designs[0].id, placement: "Upper arm", scale: "" },
      { id: designs[2].id, placement: "Shoulder", scale: "" },
    ],
  )), env);
  assert.equal(firstCreate.status, 200);
  assert.equal(secondCreate.status, 200);
  assert.equal(conflictCreate.status, 200);
  const firstId = (await firstCreate.json()).submissionId;
  const secondId = (await secondCreate.json()).submissionId;
  const conflictId = (await conflictCreate.json()).submissionId;
  const firstRetry = await handleCreateSubmission(jsonRequest(
    "/api/submissions",
    firstClaimPayload,
    { "idempotency-key": "managed-sheet-subset-claim" },
  ), env);
  const firstRetryPayload = await firstRetry.json();
  assert.equal(firstRetry.status, 200);
  assert.equal(firstRetryPayload.submissionId, firstId);
  assert.equal(firstRetryPayload.idempotent, true);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM submission_flash_designs WHERE submission_id=?").get(firstId).count,
    2,
  );
  assert.deepEqual(
    database.prepare(
      "SELECT code_snapshot,label_snapshot,placement,scale FROM submission_flash_designs WHERE submission_id=? ORDER BY requested_order",
    ).all(firstId).map((row) => [row.code_snapshot, row.label_snapshot, row.placement, row.scale]),
    [
      ["A", "Moth", "Left forearm", "4 in"],
      ["B", "Key", "Right ankle", ""],
    ],
  );

  let response = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${firstId}`, {
      status: "approved",
      approved_sheet_design_ids: [designs[0].id],
    }, adminToken),
    env,
    firstId,
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(
    database.prepare("SELECT code,state,reserved_submission_id FROM flash_sheet_designs WHERE flash_item_id=? ORDER BY sort_order").all(flash.id)
      .map((row) => [row.code, row.state, row.reserved_submission_id]),
    [
      ["A", "reserved", firstId],
      ["B", "available", null],
      ["C", "available", null],
    ],
  );
  assert.deepEqual(
    database.prepare("SELECT outcome FROM submission_flash_designs WHERE submission_id=? ORDER BY requested_order").all(firstId).map((row) => row.outcome),
    ["approved", "not_approved"],
  );
  const approvedPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(firstId).payload_json);
  assert.deepEqual(approvedPayload.approved_sheet_designs.map((design) => design.code), ["A"]);

  response = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${firstId}`, { status: "declined" }, adminToken),
    env,
    firstId,
  );
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT state FROM flash_sheet_designs WHERE id=?").get(designs[0].id).state, "available");

  response = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${secondId}`, {
      status: "approved",
      approved_sheet_design_ids: [designs[1].id, designs[2].id],
    }, adminToken),
    env,
    secondId,
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));

  response = await handleUpdateSubmission(
    jsonPatchRequest(`/api/admin/submissions/${conflictId}`, {
      status: "approved",
      approved_sheet_design_ids: [designs[0].id, designs[2].id],
    }, adminToken),
    env,
    conflictId,
  );
  assert.equal(response.status, 409);
  assert.equal(database.prepare("SELECT state FROM flash_sheet_designs WHERE id=?").get(designs[0].id).state, "available", "atomic conflict must not reserve the otherwise-free subset");

  database.prepare("UPDATE submissions SET tattoo_stage='tattoo_scheduled' WHERE id=?").run(secondId);
  const startAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "managed-sheet-tattoo",
    submissionId: secondId,
    bookingTypeId: "tattoo_half",
    purpose: "tattoo",
    startAt,
    endAt,
  });
  response = await handleAdminCompleteAppointment(adminJsonRequest(
    "/api/admin/booking/appointments/managed-sheet-tattoo/complete",
    { note: "Grouped sheet tattoo completed." },
    adminToken,
  ), env, "managed-sheet-tattoo");
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(
    database.prepare("SELECT code,state FROM flash_sheet_designs WHERE flash_item_id=? ORDER BY sort_order").all(flash.id)
      .map((row) => [row.code, row.state]),
    [
      ["A", "available"],
      ["B", "placed"],
      ["C", "placed"],
    ],
  );
  assert.deepEqual(
    database.prepare("SELECT outcome FROM submission_flash_designs WHERE submission_id=? ORDER BY requested_order").all(secondId).map((row) => row.outcome),
    ["placed", "placed"],
  );
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
    "/api/admin/booking/rendering-requests",
    "/api/tattoo/settings",
    "/api/admin/tattoo/settings",
  ]) assert.match(worker, new RegExp(route.replaceAll("/", "\\/")), route);
  assert.match(worker, /appointmentCompleteMatch/);
  assert.match(worker, /handleAdminCompleteAppointment/);
  assert.match(worker, /lifecycleReviewResolveMatch/);
  assert.match(worker, /handleAdminResolveTattooLifecycleReview/);
  assert.match(worker, /handleAdminRescheduleAppointment/);
  assert.match(worker, /appointmentRescheduleMatch/);
  assert.match(worker, /handleAdminCancelAppointment/);
  assert.match(worker, /appointmentCancelMatch/);
  assert.match(worker, /renderingRequestMatch/);
  assert.match(worker, /reapExpiredTattooRenderingRequests/);
  assert.match(worker, /tattoos\/flash\/detail\/index\.html/);
  assert.match(submissionsStudio, /Resolve Historic Lifecycle/);
  assert.match(submissionsStudio, /data-resolve-historic-lifecycle/);
  assert.match(submissionsStudio, /resolveHistorical/);
  assert.match(submissionsStudio, /data-direct-invite-form/);
  assert.match(submissionsStudio, /data-subview="appointments">Appointments/);
  assert.match(submissionsStudio, /activeTab === "tattoo" && subView === "appointments"/);
  assert.match(submissionsStudio, /tab === "tattoo" \? "appointments"/);
  assert.match(submissionsStudio, /function renderAppointmentsManager\(\)/);
  assert.match(submissionsStudio, /data-cancel-appointment/);
  assert.match(submissionsStudio, /Additional Renderings/);
  assert.match(submissionsStudio, /data-create-rendering-request/);
  assert.match(submissionsStudio, /data-copy-rendering-link/);
  assert.match(submissionsStudio, /data-resend-rendering-request/);
  assert.match(submissionsStudio, /data-cancel-rendering-request/);
  assert.match(submissionsStudio, /data-force-delete="1"/);
  assert.match(submissionsStudio, /if \(nextStatus !== submission\.status\) changes\.status = nextStatus/);
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
      consult_required: "yes",
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

test("Studio can cancel a confirmed appointment without client-email ownership and records the admin actor", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 90 * 60 * 1000).toISOString();
  insertSubmissionFixture(database, {
    id: "submission-admin-cancel",
    type: "tattoo_inquiry",
    status: "booked",
    tattooStage: "tattoo_scheduled",
    email: "admin-cancel@example.test",
  });
  insertAppointmentFixture(database, {
    id: "appointment-admin-cancel",
    submissionId: "submission-admin-cancel",
    bookingTypeId: "tattoo_quarter",
    status: "confirmed",
    purpose: "tattoo",
    email: "admin-cancel@example.test",
    startAt,
    endAt,
    holdState: "converted",
  });
  insertPaymentFixture(database, {
    id: "payment-admin-cancel",
    appointmentId: "appointment-admin-cancel",
    checkoutId: "checkout-admin-cancel",
    orderId: "order-admin-cancel",
    status: "paid",
    amountCents: 5000,
  });
  const env = squareEnv(database, { SUBMISSIONS_ADMIN_TOKEN: adminToken });

  const response = await handleAdminCancelAppointment(
    adminJsonRequest(
      "/api/admin/booking/appointments/appointment-admin-cancel/cancel",
      { reason: "Cancelled during Studio review" },
      adminToken,
    ),
    env,
    "appointment-admin-cancel",
  );
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(database.prepare(
    "SELECT status FROM appointments WHERE id = ?",
  ).get("appointment-admin-cancel").status, "cancelled");
  assert.equal(database.prepare(
    "SELECT status FROM deposit_payments WHERE appointment_id = ?",
  ).get("appointment-admin-cancel").status, "paid");
  assert.equal(database.prepare(
    "SELECT actor FROM appointment_events WHERE appointment_id = ? AND event_type = 'cancelled'",
  ).get("appointment-admin-cancel").actor, "admin");
  assert.deepEqual(rowObject(database.prepare(
    "SELECT status, tattoo_stage FROM submissions WHERE id = ?",
  ).get("submission-admin-cancel")), {
    status: "approved",
    tattoo_stage: "ready_to_book",
  });
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

test("Build and Maze brief templates render required client content without sensitive fields", () => {
  for (const [templateKey, kind] of [["tattoo_build_brief_pdf", "build"], ["tattoo_maze_brief_pdf", "maze"]]) {
    const content = briefTemplateDefault(templateKey);
    const validation = validateBriefTemplateContent(templateKey, content);
    assert.equal(validation.ok, true, validation.errors.join(" "));
    const source = buildBriefSample(kind);
    source.payload.dob = "1990-01-01";
    source.payload.consent = "private consent answer";
    source.payload.internal_notes = "never show this";
    const rendered = renderBriefHtml({
      templateKey,
      content,
      source,
      mazeImageDataUrl: source.mazeImageDataUrl || "",
    });
    assert.match(rendered.html, /Submission reference/);
    assert.match(rendered.html, /not final tattoo artwork, a quote, or booking approval/i);
    assert.doesNotMatch(rendered.html, /1990-01-01|private consent answer|never show this/);
    if (kind === "build") {
      assert.match(rendered.html, /Threshold/);
      assert.match(rendered.html, /Shared themes/);
      assert.match(rendered.html, /The passage is read before/);
    } else {
      assert.match(rendered.html, /Submitted Maze design/);
      assert.match(rendered.html, /open center represents/);
    }
  }
  const unsafe = briefTemplateDefault("tattoo_build_brief_pdf");
  unsafe.copy.disclaimer = "No protected policy token";
  unsafe.style.accent = "custom-hex";
  const invalid = validateBriefTemplateContent("tattoo_build_brief_pdf", unsafe);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /policy_scope|approved accent/i);
  const receipt = buildSubmissionReceivedEmail({
    variant: "build",
    clientName: "Jordan",
    label: "Build Your Own submission",
    submissionId: "build-brief-receipt",
    expectation: "The Studio will review the brief.",
    next: "The Studio will follow up.",
    reviewLine: "Review timing applies.",
    supportEmail: "studio@example.test",
    briefUrl: "https://example.test/api/tattoo/briefs/document?v=1&sig=test",
  });
  assert.match(receipt.html, /Download submitted brief/);
  assert.match(receipt.html, /api\/tattoo\/briefs\/document/);
});

test("brief document migration replays safely and enforces one final document per submission and kind", () => {
  const database = migratedDatabase({ before: "0068_submission_brief_documents.sql" });
  const migration = readFileSync(join(ROOT, "migrations", "0068_submission_brief_documents.sql"), "utf8");
  database.exec(migration);
  database.exec(migration);
  insertSubmissionFixture(database, { id: "submission-brief-unique", type: "build_brief" });
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO submission_brief_documents
     (id,submission_id,document_kind,status,template_key,template_revision,template_snapshot_json,source_snapshot_json,client_access_status,access_version,created_at,updated_at)
     VALUES(?,?,?,'pending','tattoo_build_brief_pdf',0,'{}','{}','disabled',1,?,?)`,
  );
  insert.run("document-one", "submission-brief-unique", "build", now, now);
  assert.throws(() => insert.run("document-two", "submission-brief-unique", "build", now, now), /UNIQUE constraint failed/);
});

test("brief PDF generation freezes one document, stores it privately, and revokes or replaces signed access", async () => {
  const database = migratedDatabase();
  insertSubmissionFixture(database, { id: "submission-brief-build", type: "build_brief", name: "Jordan Rivera", email: "jordan@example.test" });
  const sample = buildBriefSample("build");
  database.prepare("UPDATE submissions SET payload_json=? WHERE id=?")
    .run(JSON.stringify(sample.payload), "submission-brief-build");
  const bucket = new MemoryBucket();
  let renders = 0;
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSION_FILES: bucket,
    SUBMISSIONS_ADMIN_TOKEN: "brief-admin-token",
    BRIEF_LINK_SECRET: "brief-link-secret-for-tests",
    PUBLIC_SITE_URL: "https://example.test",
    BROWSER: {
      async quickAction(action, payload) {
        renders += 1;
        assert.equal(action, "pdf");
        assert.match(payload.html, /Jordan Rivera/);
        assert.equal(payload.pdfOptions.format, "letter");
        return new Response(new TextEncoder().encode("%PDF-1.7\nbrief-test\n%%EOF"), { status: 200 });
      },
    },
  };
  const row = database.prepare("SELECT * FROM submissions WHERE id=?").get("submission-brief-build");
  const first = await generateSubmissionBriefDocument(env, new Request("https://example.test/api/submissions"), row);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.document.status, "ready");
  assert.match(first.document.clientUrl, /\/api\/tattoo\/briefs\//);
  assert.equal(renders, 1);
  assert.equal(bucket.objects.has("submission-briefs/submission-brief-build/final.pdf"), true);
  const frozenSnapshot = database.prepare("SELECT template_snapshot_json,source_snapshot_json FROM submission_brief_documents WHERE submission_id=?")
    .get("submission-brief-build");
  database.prepare("UPDATE submissions SET payload_json=? WHERE id=?").run(JSON.stringify({ changed: true }), "submission-brief-build");
  const replay = await generateSubmissionBriefDocument(env, new Request("https://example.test/api/submissions"), row);
  assert.equal(replay.ok, true);
  assert.equal(renders, 1);
  assert.deepEqual(database.prepare("SELECT template_snapshot_json,source_snapshot_json FROM submission_brief_documents WHERE submission_id=?")
    .get("submission-brief-build"), frozenSnapshot);

  const initialUrl = first.document.clientUrl;
  const initialDownload = await handlePublicBriefDownload(new Request(initialUrl), env, first.document.id);
  assert.equal(initialDownload.status, 200);
  assert.equal(initialDownload.headers.get("cache-control"), "private, no-store, max-age=0");
  const revoke = await handleAdminSubmissionBriefDocument(adminJsonRequest(
    "/api/admin/submissions/submission-brief-build/brief-document/revoke", {}, "brief-admin-token",
  ), env, "submission-brief-build", "revoke");
  assert.equal(revoke.status, 200);
  assert.equal((await handlePublicBriefDownload(new Request(initialUrl), env, first.document.id)).status, 404);
  const internal = await handleAdminSubmissionBriefDocument(draftRequest(
    "/api/admin/submissions/submission-brief-build/brief-document/download", "GET", undefined, "brief-admin-token",
  ), env, "submission-brief-build", "download");
  assert.equal(internal.status, 200);
  const reissue = await handleAdminSubmissionBriefDocument(adminJsonRequest(
    "/api/admin/submissions/submission-brief-build/brief-document/reissue", {}, "brief-admin-token",
  ), env, "submission-brief-build", "reissue");
  const reissuedPayload = await reissue.json();
  assert.equal(reissuedPayload.briefDocument.clientAccessStatus, "active");
  assert.notEqual(reissuedPayload.briefDocument.clientUrl, initialUrl);
  assert.equal((await handlePublicBriefDownload(new Request(initialUrl), env, first.document.id)).status, 403);
  assert.equal((await handlePublicBriefDownload(new Request(reissuedPayload.briefDocument.clientUrl), env, first.document.id)).status, 200);
});

test("PDF template manager protects authentication, stale drafts, publishing, history, and discard", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: "brief-admin-token" };
  const unauthorized = await handleAdminBriefTemplates(draftRequest("/api/admin/brief-templates", "GET"), env);
  assert.equal(unauthorized.status, 401);
  const catalogResponse = await handleAdminBriefTemplates(draftRequest("/api/admin/brief-templates", "GET", undefined, "brief-admin-token"), env);
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).templates.length, 2);
  const content = briefTemplateDefault("tattoo_build_brief_pdf");
  content.copy.intro = "Edited future Build brief introduction.";
  const saved = await handleAdminBriefTemplates(adminJsonRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/draft", { content, baseRevision: 0 }, "brief-admin-token", "PUT",
  ), env);
  const savedPayload = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedPayload));
  assert.equal(savedPayload.draft.revision, 1);
  const stale = await handleAdminBriefTemplates(adminJsonRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/draft", { content, baseRevision: 0 }, "brief-admin-token", "PUT",
  ), env);
  assert.equal(stale.status, 409);
  const published = await handleAdminBriefTemplates(adminJsonRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/publish", { revision: 1 }, "brief-admin-token",
  ), env);
  assert.equal(published.status, 200);
  const secondContent = JSON.parse(JSON.stringify(content));
  secondContent.copy.intro = "Second draft to discard.";
  const secondDraft = await handleAdminBriefTemplates(adminJsonRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/draft", { content: secondContent, baseRevision: 1 }, "brief-admin-token", "PUT",
  ), env);
  const secondDraftPayload = await secondDraft.json();
  const discarded = await handleAdminBriefTemplates(adminJsonRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/discard", { revision: secondDraftPayload.draft.revision }, "brief-admin-token",
  ), env);
  assert.equal(discarded.status, 200);
  const history = await handleAdminBriefTemplates(draftRequest(
    "/api/admin/brief-templates/tattoo_build_brief_pdf/history", "GET", undefined, "brief-admin-token",
  ), env);
  const historyPayload = await history.json();
  assert.equal(history.status, 200);
  assert.ok(historyPayload.history.some((entry) => entry.status === "published"));
  assert.ok(historyPayload.history.some((entry) => entry.status === "retired"));
});

test("brief PDF routes, Studio controls, Browser binding, and client email templates remain contractually wired", () => {
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const previews = readFileSync(join(ROOT, "studio", "previews", "index.html"), "utf8");
  const submissionsStudio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const templates = readFileSync(join(ROOT, "functions", "api", "notifications", "_email-templates.js"), "utf8");
  assert.match(worker, /handlePublicBriefDownload/);
  assert.match(worker, /handleAdminBriefTemplates/);
  assert.match(worker, /brief-document/);
  assert.match(worker, /async function handleSubmissionsApi[\s\S]*briefDocumentMatch[\s\S]*Unknown submissions API route/);
  assert.match(wrangler, /"browser"\s*:\s*\{\s*"binding"\s*:\s*"BROWSER"/s);
  assert.match(previews, /PDF Template Manager/);
  assert.match(previews, /studio\/pdf-preview\.js/);
  assert.match(submissionsStudio, /Client Brief PDF/);
  assert.match(submissionsStudio, /Generate &amp; Email Client/);
  assert.match(templates, /tattoo_brief_ready/);
  assert.match(templates, /Download submitted brief/);
});
