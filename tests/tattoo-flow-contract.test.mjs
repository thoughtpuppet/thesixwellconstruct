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
  handleSubmissionDecision,
  handleSubmissionDecisionNotification,
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
  handleAdminDeleteAppointment,
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
  handleAdminEmailDesign,
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
  defaultEmailDesignProfile,
  resolveEmailDesign,
  validateEmailDesignProfile,
} from "../functions/api/notifications/_email-design.js";
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
  handleAdminTattooSpecialCampaign,
  handleAdminTattooSpecialOffer,
  handleAdminTattooSpecialDeposit,
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
  const publicContactPath = path === "/api/submissions"
    || path === "/api/booking/public-session/checkout";
  const requestPayload = publicContactPath && payload?.phone === undefined
    ? { ...payload, phone: "404-555-0100" }
    : payload;
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(requestPayload),
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
  const requestPayload = path === "/api/submissions" && payload?.phone === undefined
    ? { ...payload, phone: "404-555-0100" }
    : payload;
  for (const [key, value] of Object.entries(requestPayload)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else {
      form.append(key, String(value));
    }
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
  bookingTokenId = null,
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
  approvalState = "not_required",
  paymentDueAt = null,
}) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO appointments (
      id, submission_id, booking_token_id, booking_type_id, availability_window_id, status, purpose,
      client_name, client_email, start_at, end_at, deposit_cents, tip_cents,
      currency, square_order_id, square_payment_link_id, square_checkout_url,
      hold_expires_at, hold_state, replacement_for_appointment_id,
      replaced_by_appointment_id, reschedule_count, approval_state, payment_due_at,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    submissionId,
    bookingTokenId,
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
    approvalState,
    paymentDueAt,
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
    project_type: "new_work",
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

function decideSubmission(env, submissionId, token, action, fields = {}) {
  return handleSubmissionDecision(adminJsonRequest(
    `/api/admin/submissions/${submissionId}/decision`,
    { action, confirmed: true, ...fields },
    token,
  ), env, submissionId);
}

function saveReviewedTattooPlan(env, submissionId, token, fields = {}) {
  return handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 120,
      estimatedTotalMinutesMax: 240,
      artistNote: "Reviewed for contract coverage.",
      approvedBudgetMinCents: 30000,
      approvedBudgetMaxCents: 60000,
      approvedBudgetCurrency: "USD",
      ...fields,
    },
    token,
    "PATCH",
  ), env, submissionId);
}

function validCustomForProject(projectType, overrides = {}) {
  const fields = {
    new_work: {},
    cover_up: {
      cover_up_goal: "transform",
      size_placement_flexibility: "flexible",
    },
    large_cover_up: {
      cover_up_goal: "transform",
      size_placement_flexibility: "flexible",
      existing_tattoo_dimensions: "8 x 12 inches",
      open_to_larger_footprint: "yes",
      open_to_multiple_sessions: "yes",
    },
    rework: {
      rework_interventions: ["refresh_color", "repair_linework"],
      rework_expansion_flexibility: "unsure",
    },
    space_filler: {
      gap_dimensions: "2 x 4 inches",
      surrounding_work: "Black and grey tattoos around the open area.",
      filler_relationship: "connect_blend",
    },
  };
  return validCustom({ project_type: projectType, ...(fields[projectType] || {}), ...overrides });
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
  assert.match(bookingPage, /const ADDITIONAL_SKETCH_DISCLAIMER = "Additional concept sketches are \$50 each, require artist approval, and must be paid before drawing begins\."/);
  assert.match(bookingPage, /plan\?\.includeAdditionalSketchDisclaimer \? ADDITIONAL_SKETCH_DISCLAIMER : ""/);
  assert.match(bookingPage, /Your tattoo deposit holds your appointment slot and is applied to the final total\./);
  assert.match(bookingPage, /One developed design direction is included after your deposit is paid, if applicable\./);
  assert.match(bookingPage, /pacing\.extended \? " before any optional Extended Day fee" : ""/);
  assert.match(bookingPage, /budgetLabel \? `<label class="form-check"><input class="form-check__input" id="budgetAck"/);
  assert.match(bookingPage, /Artist-approved additional concept sketches are separate, non-refundable \$50 fees that are not credited toward the tattoo total and must be paid before drawing begins/);

  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /id="includeAdditionalSketchDisclaimer" name="includeAdditionalSketchDisclaimer" type="checkbox"/);
  assert.match(studio, /includeAdditionalSketchDisclaimer: form\.elements\.includeAdditionalSketchDisclaimer\?\.checked === true/);

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

test("Studio approved booking links allow per-client tattoo appointment types", () => {
  const source = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(source, /For an approved tattoo link, choose the appointment types this client may book\./);
  assert.doesNotMatch(source, /<input type="checkbox" data-token-type[^>]* disabled>/);
  assert.match(source, /const lockSelection = submission\.type === "tattoo_special" \|\| purpose === "consultation";/);
  assert.match(source, /input\.disabled = !allowed \|\| lockSelection;/);
  assert.doesNotMatch(source, /input\.checked = allowed;/);
  assert.match(source, /Choose at least one session type for this booking link\./);
  assert.match(source, /Object\.assign\(values, bookingTokenDraftBody\(submissionId\)\);/);
  assert.match(source, /id="saveBookingChoicesBtn"[^>]*>Save Booking Choices<\/button>/);
  assert.match(source, /id="saveReviewNotesBtn"[^>]*>Save Internal Notes<\/button>/);
  assert.match(source, /id="sessionPlanSaveState" role="status" aria-live="polite"/);
  assert.match(source, /Saved: \$\{savedSessionPlanSummary\(savedPlan\)\}\. Booking choices were also saved\. Nothing was sent\./);
  assert.match(source, /return parts\.join\(" \| "\);/);
  assert.match(source, /\? `\$\{message\.replace\(\/\\\.\\s\*\$\/, ""\)\} at \$\{new Date\(\)\.toLocaleTimeString/);
  assert.match(source, /Booking choices saved\. No link was generated and nothing was sent\./);
  assert.match(source, /Internal notes saved\. Nothing was sent\./);
  assert.doesNotMatch(source, /id="planSessionCategory"/);
  assert.match(source, /id="planSplitPolicy" name="splitPolicy" data-select-menu-skip/);
  assert.doesNotMatch(source, /sessionCategory: form\.elements\.sessionCategory/);
  assert.match(source, /The system derives the internal session structure from this choice\./);
  assert.match(source, /Estimated total project time [^<]* minimum \(minutes\)/);
  assert.match(source, /Optional\. This is the estimated tattooing time for the entire project across every session\./);
  assert.doesNotMatch(source, /id="saveBtn"/);
  assert.match(source, /const message = error\.message \|\| "The session plan could not be saved";[\s\S]*?setSaveFeedback\("sessionPlanSaveState", message, "error"\);/);
});

test("Studio session-plan saves persist booking choices without preparing access or sending", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = squareEnv(database, { SUBMISSIONS_ADMIN_TOKEN: adminToken });
  const submissionId = "session-plan-booking-draft";
  insertSubmissionFixture(database, {
    id: submissionId,
    type: "tattoo_inquiry",
    status: "new",
    tattooStage: "review",
  });
  const expiresAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();

  const saved = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      sessionCategory: "one_session",
      splitPolicy: "not_available",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 1,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "One reviewed session.",
      includeAdditionalSketchDisclaimer: true,
      approvedBudgetMinCents: 80000,
      approvedBudgetMaxCents: 120000,
      approvedBudgetCurrency: "USD",
      bookingLinkPurpose: "tattoo",
      allowedBookingTypes: ["tattoo_half"],
      bookingLinkExpiresAt: expiresAt,
      bookingLinkRevokeExisting: false,
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(saved.status, 200, await saved.clone().text());
  const savedPlan = (await saved.json()).sessionPlan;
  assert.equal(savedPlan.bookingLinkPurpose, "tattoo");
  assert.equal(savedPlan.includeAdditionalSketchDisclaimer, true);
  assert.deepEqual(savedPlan.allowedBookingTypes, ["tattoo_half"]);
  assert.equal(savedPlan.bookingLinkExpiresAt, expiresAt);
  assert.equal(savedPlan.bookingLinkRevokeExisting, false);
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id = ?").get(submissionId).status, "reviewing");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM booking_tokens WHERE submission_id = ?").get(submissionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE related_id = ?").get(submissionId).count, 0);

  const reloaded = await handleAdminTattooSessionPlan(draftRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    "GET",
    undefined,
    adminToken,
  ), env, submissionId);
  assert.equal(reloaded.status, 200);
  const reloadedPlan = (await reloaded.json()).sessionPlan;
  assert.deepEqual(reloadedPlan.allowedBookingTypes, ["tattoo_half"]);
  assert.equal(reloadedPlan.includeAdditionalSketchDisclaimer, true);
  database.prepare(
    "UPDATE tattoo_session_plans SET budget_acknowledged=1,budget_acknowledged_at=? WHERE submission_id=?",
  ).run(new Date().toISOString(), submissionId);

  const flexible = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      splitPolicy: "client_choice",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 2,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 240,
      artistNote: "Choose one longer appointment or two shorter sessions.",
      includeAdditionalSketchDisclaimer: false,
      approvedBudgetMinCents: 80000,
      approvedBudgetMaxCents: 120000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(flexible.status, 200, await flexible.clone().text());
  const flexiblePlan = (await flexible.json()).sessionPlan;
  assert.equal(flexiblePlan.sessionCategory, "multiple_sessions", "category is derived internally");
  assert.equal(flexiblePlan.splitPolicy, "client_choice");
  assert.equal(flexiblePlan.estimatedSessionsMin, 1);
  assert.equal(flexiblePlan.estimatedSessionsMax, 2);
  assert.equal(flexiblePlan.includeAdditionalSketchDisclaimer, false);
  assert.equal(flexiblePlan.budgetAcknowledged, false, "changing client-facing budget disclosures requires fresh agreement");
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

test("Studio permanently deletes only unpaid or cancelled appointments and preserves paid history", async () => {
  const database = migratedDatabase();
  const adminToken = "permanent-appointment-delete-admin";
  const env = squareEnv(database, { SUBMISSIONS_ADMIN_TOKEN: adminToken });
  const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 73.5 * 60 * 60 * 1000).toISOString();

  insertSubmissionFixture(database, {
    id: "delete-pending-submission",
    type: "tattoo_special",
    status: "new",
    tattooStage: "review",
  });
  database.prepare(
    `UPDATE submissions SET payload_json=json_object(
      'held_appointment_id','delete-pending',
      'held_start_at',?,
      'held_end_at',?,
      'approval_hold_expires_at',?
    ) WHERE id='delete-pending-submission'`
  ).run(startAt, endAt, endAt);
  insertAppointmentFixture(database, {
    id: "delete-pending",
    submissionId: "delete-pending-submission",
    bookingTypeId: "tattoo_quarter",
    status: "pending_deposit",
    purpose: "tattoo",
    startAt,
    endAt,
    holdExpiresAt: endAt,
    holdState: "active",
    approvalState: "pending",
  });
  insertPaymentFixture(database, {
    id: "delete-pending-payment",
    appointmentId: "delete-pending",
    checkoutId: null,
    orderId: null,
  });

  const pendingDelete = await handleAdminDeleteAppointment(
    draftRequest("/api/admin/booking/appointments/delete-pending", "DELETE", undefined, adminToken),
    env,
    "delete-pending",
  );
  assert.equal(pendingDelete.status, 200, await pendingDelete.clone().text());
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointments WHERE id='delete-pending'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM deposit_payments WHERE appointment_id='delete-pending'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointment_events WHERE appointment_id='delete-pending'").get().count, 0);
  assert.equal(
    database.prepare("SELECT json_extract(payload_json,'$.held_appointment_id') held FROM submissions WHERE id='delete-pending-submission'").get().held,
    null,
  );

  insertAppointmentFixture(database, {
    id: "delete-confirmed",
    bookingTypeId: "tattoo_quarter",
    status: "confirmed",
    purpose: "tattoo",
    startAt,
    endAt,
  });
  const confirmedDelete = await handleAdminDeleteAppointment(
    draftRequest("/api/admin/booking/appointments/delete-confirmed", "DELETE", undefined, adminToken),
    env,
    "delete-confirmed",
  );
  assert.equal(confirmedDelete.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointments WHERE id='delete-confirmed'").get().count, 1);

  insertAppointmentFixture(database, {
    id: "delete-paid-cancelled",
    bookingTypeId: "tattoo_quarter",
    status: "cancelled",
    purpose: "tattoo",
    startAt,
    endAt,
    holdState: "released",
  });
  insertPaymentFixture(database, {
    id: "delete-paid-payment",
    appointmentId: "delete-paid-cancelled",
    checkoutId: "delete-paid-link",
    orderId: "delete-paid-order",
    status: "paid",
  });
  const paidDelete = await handleAdminDeleteAppointment(
    draftRequest("/api/admin/booking/appointments/delete-paid-cancelled", "DELETE", undefined, adminToken),
    env,
    "delete-paid-cancelled",
  );
  assert.equal(paidDelete.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointments WHERE id='delete-paid-cancelled'").get().count, 1);

  insertAppointmentFixture(database, {
    id: "delete-unpaid-cancelled",
    bookingTypeId: "tattoo_quarter",
    status: "cancelled",
    purpose: "tattoo",
    startAt,
    endAt,
    holdState: "released",
  });
  const cancelledDelete = await handleAdminDeleteAppointment(
    draftRequest("/api/admin/booking/appointments/delete-unpaid-cancelled", "DELETE", undefined, adminToken),
    env,
    "delete-unpaid-cancelled",
  );
  assert.equal(cancelledDelete.status, 200, await cancelledDelete.clone().text());
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointments WHERE id='delete-unpaid-cancelled'").get().count, 0);
});

test("permanent appointment deletion reconciles and invalidates an unpaid Square checkout", async () => {
  const database = migratedDatabase();
  const adminToken = "permanent-appointment-square-admin";
  const env = squareEnv(database, { SUBMISSIONS_ADMIN_TOKEN: adminToken });
  const startAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 97.5 * 60 * 60 * 1000).toISOString();
  insertAppointmentFixture(database, {
    id: "delete-square-cancelled",
    bookingTypeId: "tattoo_quarter",
    status: "cancelled",
    purpose: "tattoo",
    startAt,
    endAt,
    squareOrderId: "delete-square-order",
    squarePaymentLinkId: "delete-square-link",
    squareCheckoutUrl: "https://square.link/u/delete-square-link",
    holdState: "released",
  });
  insertPaymentFixture(database, {
    id: "delete-square-payment",
    appointmentId: "delete-square-cancelled",
    checkoutId: "delete-square-link",
    orderId: "delete-square-order",
    status: "cancelled",
  });

  const calls = [];
  await withMockFetch(async (input, init = {}) => {
    const target = String(input);
    calls.push({ target, method: init.method || "GET" });
    if (target.includes("/v2/orders/delete-square-order")) {
      return jsonFetchResponse({
        order: { state: "OPEN", net_amount_due_money: { amount: 5000, currency: "USD" } },
      });
    }
    if (target.includes("/v2/online-checkout/payment-links/delete-square-link") && init.method === "DELETE") {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected Square request: ${target}`);
  }, async () => {
    const response = await handleAdminDeleteAppointment(
      draftRequest("/api/admin/booking/appointments/delete-square-cancelled", "DELETE", undefined, adminToken),
      env,
      "delete-square-cancelled",
    );
    assert.equal(response.status, 200, await response.clone().text());
  });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "DELETE"]);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointments WHERE id='delete-square-cancelled'").get().count, 0);
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
      dob: "1990-01-01",
      age_confirmed: "yes",
      selected_flash: "placeholder-flash",
      flash_claim_acknowledged: "yes",
      review_consent: "yes",
    },
    {
      type: "build_brief",
      name: "Build Budget",
      email: "build-budget@example.test",
      dob: "1990-01-01",
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
      dob: "1990-01-01",
      age_confirmed: "yes",
      maze_explanation: "A returning path.",
      review_consent: "yes",
    },
    {
      type: "special_project",
      name: "Special Budget",
      email: "special-budget@example.test",
      dob: "1990-01-01",
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
    "include_additional_sketch_disclaimer",
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
    dob: "1990-01-01",
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
    dob: "1990-01-01",
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
    dob: "1990-01-01",
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
    dob: "1990-01-01",
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

test("every tattoo intake asks for date of birth alongside adult confirmation", () => {
  const formPaths = [
    ["tattoos", "inquire", "custom", "index.html"],
    ["tattoos", "inquire", "consultation", "index.html"],
    ["tattoos", "build", "index.html"],
    ["tattoos", "build", "in-person", "index.html"],
    ["tattoos", "build-managed-preview", "index.html"],
    ["tattoos", "flash", "claim", "index.html"],
    ["tattoos", "special-projects", "apply", "index.html"],
    ["tattoos", "specials", "index.html"],
  ];
  const requiredDob = /<input(?=[^>]*name="dob")(?=[^>]*type="date")(?=[^>]*required)[^>]*>/;
  for (const segments of formPaths) {
    const source = readFileSync(join(ROOT, ...segments), "utf8");
    assert.match(source, requiredDob, segments.join("/"));
    assert.match(source, /name="(?:age_confirmed|ageConfirmed)"[^>]*required/, segments.join("/"));
  }
  const specials = readFileSync(join(ROOT, "tattoos", "specials", "index.html"), "utf8");
  assert.match(specials, /name="participant2Dob"/);
  assert.match(specials, /name="participant2AgeConfirmed"/);
  const mazeSource = readFileSync(join(ROOT, "apps", "maze", "src", "App.tsx"), "utf8");
  assert.match(mazeSource, /name="dob" type="date" autoComplete="bday" required/);
  assert.match(mazeSource, /name="age_confirmed" value="yes" required/);
  const submissionsApi = readFileSync(join(ROOT, "functions", "api", "submissions", "_lib.js"), "utf8");
  const bookingApi = readFileSync(join(ROOT, "functions", "api", "booking", "_lib.js"), "utf8");
  assert.match(submissionsApi, /TATTOO_SUBMISSION_TYPES\.has\(submission\.type\) && !isAtLeastEighteen\(payload\.dob\)/);
  assert.match(bookingApi, /!publicClientIsAtLeastEighteen\(client\.dob\)/);
});

test("tattoo intake APIs reject missing and underage birth dates even when adult confirmation is checked", async () => {
  const env = { SUBMISSIONS_DB: new LocalD1(migratedDatabase()) };
  const base = {
    type: "build_brief",
    name: "Age Verification Client",
    email: "age-verification@example.test",
    phone: "4045550100",
    age_confirmed: "yes",
    placement: "Upper arm",
    budget_range: "$300â€“$500",
    design_intent: "A protected route.",
    symbol_ids: ["maze-path"],
    review_consent: "yes",
  };
  const missing = await handleCreateSubmission(jsonRequest("/api/submissions", base), env);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /date of birth.*18 or older/i);
  const underage = await handleCreateSubmission(jsonRequest("/api/submissions", { ...base, dob: "2010-01-01" }), env);
  assert.equal(underage.status, 400);
  assert.match((await underage.json()).error, /date of birth.*18 or older/i);
});

test("Tattoo Specials public surface distinguishes scheduled, open, and closed sales windows", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const now = Date.now();

  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='campaign-fka-2026'")
    .run(new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString());
  const scheduled = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(scheduled.state, "scheduled");
  assert.deepEqual(scheduled.offers, []);

  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=? WHERE id='campaign-fka-2026'")
    .run(new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString());
  const closed = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(closed.state, "closed");
  assert.deepEqual(closed.offers, []);
  assert.equal(closed.normalInquiryUrl, "/tattoos/inquire/");
});

test("Studio creates campaigns and individual specials while the published campaign owns the public window", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const token = "studio-special-campaigns";
  const env = { SUBMISSIONS_DB: db, SUBMISSIONS_ADMIN_TOKEN: token };
  const opensAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const initialAdmin = await (await handleAdminTattooSpecials(
    draftRequest("/api/admin/tattoo/specials", "GET", undefined, token), env,
  )).json();
  assert.equal(initialAdmin.campaigns.length, 1);
  assert.equal(initialAdmin.campaigns[0].id, "campaign-fka-2026");
  assert.ok(initialAdmin.offers.every((offer) => offer.campaignId === "campaign-fka-2026"));

  const createdCampaignResponse = await handleAdminTattooSpecialCampaign(adminJsonRequest(
    "/api/admin/tattoo/specials/campaigns",
    {
      title: "Autumn Tattoo Specials",
      slug: "autumn-tattoo-specials",
      salesOpensAt: opensAt,
      salesClosesAt: closesAt,
      defaultDepositCents: 5000,
      enabled: true,
      isPublic: false,
      sortOrder: 20,
    },
    token,
  ), env);
  assert.equal(createdCampaignResponse.status, 201);
  const createdCampaignPayload = await createdCampaignResponse.json();
  const campaign = createdCampaignPayload.campaigns.find((item) => item.slug === "autumn-tattoo-specials");
  assert.ok(campaign);
  assert.equal(campaign.isPublic, false);

  const createdSpecialResponse = await handleAdminTattooSpecialOffer(adminJsonRequest(
    "/api/admin/tattoo/specials/offers",
    {
      campaignId: campaign.id,
      title: "Autumn Hand Tattoo",
      slug: "autumn-hand-tattoo",
      description: "One hand-sized autumn tattoo.",
      durationMinutes: 120,
      depositCents: 5000,
      referenceRequirement: "optional",
      participantCount: 1,
      active: true,
      sortOrder: 10,
      variants: [{ label: "Standard", priceCents: 22000, sortOrder: 10 }],
    },
    token,
  ), env);
  assert.equal(createdSpecialResponse.status, 201);
  const createdSpecialPayload = await createdSpecialResponse.json();
  const special = createdSpecialPayload.offers.find((item) => item.slug === "autumn-hand-tattoo");
  assert.ok(special);
  assert.equal(special.campaignId, campaign.id);

  const beforePublish = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(beforePublish.campaignId, "campaign-fka-2026");
  assert.equal(beforePublish.offers.some((item) => item.id === special.id), false);

  const publishResponse = await handleAdminTattooSpecialCampaign(adminJsonRequest(
    `/api/admin/tattoo/specials/campaigns/${campaign.id}`,
    { isPublic: true },
    token,
    "PATCH",
  ), env, campaign.id);
  assert.equal(publishResponse.status, 200);
  const published = await (await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env)).json();
  assert.equal(published.campaignId, campaign.id);
  assert.equal(published.campaignTitle, "Autumn Tattoo Specials");
  assert.deepEqual(published.offers.map((item) => item.id), [special.id]);

  const submissionResponse = await handleCreateTattooSpecialSubmission(multipartRequest(
    "/api/tattoo/specials/submissions",
    {
      offerId: special.id,
      variantId: special.variants[0].id,
      idempotencyKey: "autumn-special-request",
      name: "Campaign Client",
      email: "campaign@example.com",
      phone: "4045550123",
      dob: "1990-01-01",
      ageConfirmed: "yes",
      policyAccepted: "yes",
      transactionalMessagesAccepted: "yes",
      placement: "Upper arm",
      projectDetails: "Autumn leaves.",
    },
  ), env);
  assert.equal(submissionResponse.status, 201);
  const submission = await submissionResponse.json();
  const terms = database.prepare(
    "SELECT campaign_id,campaign_title,offer_id FROM tattoo_special_submission_terms WHERE submission_id=?",
  ).get(submission.submissionId);
  assert.equal(terms.campaign_id, campaign.id);
  assert.equal(terms.campaign_title, "Autumn Tattoo Specials");
  assert.equal(terms.offer_id, special.id);
});

test("Studio Tattoo Specials metrics preserve lifetime conversion and separate genuine paid cancellations", async () => {
  const database = migratedDatabase();
  const token = "studio-special-metrics";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const now = Date.now();
  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='campaign-fka-2026'")
    .run(new Date(now - 3600000).toISOString(), new Date(now + 86400000).toISOString());

  const initial = await (await handleAdminTattooSpecials(
    draftRequest("/api/admin/tattoo/specials", "GET", undefined, token), env,
  )).json();
  const initialOffer = initial.offers.find((offer) => offer.id === "special-palm");
  assert.deepEqual(initialOffer.metrics, {
    requests: 0,
    awaitingDeposit: 0,
    booked: 0,
    cancelled: 0,
    conversionPercent: 0,
  });

  async function createMetricRequest(key) {
    const response = await handleCreateTattooSpecialSubmission(multipartRequest(
      "/api/tattoo/specials/submissions",
      {
        offerId: "special-palm",
        variantId: "special-palm-v3-standard",
        idempotencyKey: `special-metric-${key}`,
        name: `Metric Client ${key}`,
        email: `metric-${key}@example.com`,
        phone: "4045550199",
        dob: "1990-01-01",
        ageConfirmed: "yes",
        policyAccepted: "yes",
        transactionalMessagesAccepted: "yes",
        placement: "Upper arm",
        projectDetails: `Metric fixture ${key}.`,
      },
    ), env);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).submissionId;
  }

  const requestOnlyId = await createMetricRequest("request-only");
  const awaitingId = await createMetricRequest("awaiting");
  const bookedId = await createMetricRequest("booked");
  const cancelledId = await createMetricRequest("cancelled");
  const rescheduledId = await createMetricRequest("rescheduled");
  const expiredId = await createMetricRequest("expired");
  const unpaidCancelledId = await createMetricRequest("unpaid-cancelled");
  assert.ok(requestOnlyId);

  const bookingTypeId = database.prepare(
    "SELECT booking_type_id FROM tattoo_special_submission_terms WHERE submission_id=?",
  ).get(awaitingId).booking_type_id;
  const startAt = new Date(now + 48 * 60 * 60 * 1000);
  function fixtureTime(offsetHours) {
    const start = new Date(startAt.getTime() + offsetHours * 60 * 60 * 1000);
    return { startAt: start.toISOString(), endAt: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString() };
  }
  function addMetricAppointment(id, submissionId, offsetHours, values = {}) {
    insertAppointmentFixture(database, {
      id,
      submissionId,
      bookingTypeId,
      purpose: "tattoo",
      name: "Metric Client",
      email: "metric@example.com",
      ...fixtureTime(offsetHours),
      ...values,
    });
  }

  addMetricAppointment("metric-awaiting", awaitingId, 0, {
    status: "pending_deposit",
    holdState: "active",
    holdExpiresAt: new Date(now + 3600000).toISOString(),
    approvalState: "pending",
  });

  addMetricAppointment("metric-booked", bookedId, 3, {
    status: "confirmed",
    holdState: "converted",
    approvalState: "approved",
  });
  insertPaymentFixture(database, {
    id: "metric-payment-booked",
    appointmentId: "metric-booked",
    checkoutId: "metric-checkout-booked",
    orderId: "metric-order-booked",
    status: "paid",
  });

  addMetricAppointment("metric-cancelled", cancelledId, 6, {
    status: "cancelled",
    holdState: "released",
    approvalState: "approved",
  });
  database.prepare("UPDATE appointments SET cancelled_at=? WHERE id='metric-cancelled'")
    .run(new Date(now + 1000).toISOString());
  insertPaymentFixture(database, {
    id: "metric-payment-cancelled",
    appointmentId: "metric-cancelled",
    checkoutId: "metric-checkout-cancelled",
    orderId: "metric-order-cancelled",
    status: "paid",
  });

  addMetricAppointment("metric-rescheduled-old", rescheduledId, 9, {
    status: "cancelled",
    holdState: "released",
    approvalState: "approved",
  });
  addMetricAppointment("metric-rescheduled-new", rescheduledId, 12, {
    status: "confirmed",
    holdState: "converted",
    approvalState: "approved",
    replacementForAppointmentId: "metric-rescheduled-old",
  });
  database.prepare(
    "UPDATE appointments SET cancelled_at=?,replaced_by_appointment_id=? WHERE id='metric-rescheduled-old'",
  ).run(new Date(now + 2000).toISOString(), "metric-rescheduled-new");
  insertPaymentFixture(database, {
    id: "metric-payment-rescheduled",
    appointmentId: "metric-rescheduled-old",
    checkoutId: "metric-checkout-rescheduled",
    orderId: "metric-order-rescheduled",
    status: "paid",
  });

  addMetricAppointment("metric-expired", expiredId, 15, {
    status: "pending_deposit",
    holdState: "expiry_attention",
    holdExpiresAt: new Date(now - 3600000).toISOString(),
    approvalState: "pending",
  });
  addMetricAppointment("metric-unpaid-cancelled", unpaidCancelledId, 18, {
    status: "cancelled",
    holdState: "released",
    approvalState: "declined",
  });
  database.prepare("UPDATE appointments SET cancelled_at=? WHERE id='metric-unpaid-cancelled'")
    .run(new Date(now + 3000).toISOString());

  const measured = await (await handleAdminTattooSpecials(
    draftRequest("/api/admin/tattoo/specials", "GET", undefined, token), env,
  )).json();
  assert.deepEqual(measured.offers.find((offer) => offer.id === "special-palm").metrics, {
    requests: 7,
    awaitingDeposit: 1,
    booked: 3,
    cancelled: 1,
    conversionPercent: 43,
  });

  const versionResponse = await handleAdminTattooSpecialOffer(adminJsonRequest(
    "/api/admin/tattoo/specials/offers/special-palm",
    {
      campaignId: initialOffer.campaignId,
      title: initialOffer.title,
      slug: initialOffer.slug,
      description: initialOffer.description,
      durationMinutes: initialOffer.durationMinutes,
      depositCents: initialOffer.depositCents,
      referenceRequirement: initialOffer.referenceRequirement,
      participantCount: initialOffer.participantCount,
      maxWordCount: initialOffer.maxWordCount,
      active: true,
      sortOrder: initialOffer.sortOrder,
      variants: initialOffer.variants.map((variant) => ({
        label: variant.label,
        priceCents: variant.priceCents,
        sortOrder: variant.sortOrder,
      })),
    },
    token,
    "PATCH",
  ), env, "special-palm");
  assert.equal(versionResponse.status, 200, await versionResponse.clone().text());
  const versionedOffer = (await versionResponse.json()).offers.find((offer) => offer.id === "special-palm");
  assert.equal(versionedOffer.versionNumber, initialOffer.versionNumber + 1);
  assert.deepEqual(versionedOffer.metrics, measured.offers.find((offer) => offer.id === "special-palm").metrics);

  const archivedResponse = await handleAdminTattooSpecialOffer(
    draftRequest("/api/admin/tattoo/specials/offers/special-palm", "DELETE", undefined, token),
    env,
    "special-palm",
  );
  assert.equal(archivedResponse.status, 200);
  const archivedOffer = (await archivedResponse.json()).offers.find((offer) => offer.id === "special-palm");
  assert.ok(archivedOffer.archivedAt);
  assert.deepEqual(archivedOffer.metrics, measured.offers.find((offer) => offer.id === "special-palm").metrics);
});

test("Tattoo index keeps the lower Specials block and reveals a matching brand-band action only while open", () => {
  const source = readFileSync(join(ROOT, "tattoos", "index.html"), "utf8");
  assert.match(source, /class="brand-band-link" id="tattooSpecialsBandCta" href="\/tattoos\/specials\/" hidden>View Current Specials<\/a>/);
  assert.match(source, /class="booking-cta" id="tattooSpecialsCta" hidden/);
  assert.match(source, /if \(payload\.state !== "open"\) return;[\s\S]*?if \(cta\) cta\.hidden = false;[\s\S]*?if \(bandCta\) bandCta\.hidden = false;/);
});

test("Tattoo Specials public copy matches the held-time approval lifecycle", () => {
  const page = readFileSync(join(ROOT, "tattoos", "specials", "index.html"), "utf8");
  const script = readFileSync(join(ROOT, "js", "tattoo-specials.js"), "utf8");
  const booking = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  const reschedule = readFileSync(join(ROOT, "booking", "reschedule", "index.html"), "utf8");
  assert.match(page, /select an available time, and pay the deposit after Studio approval/i);
  assert.doesNotMatch(page, /<dt>Campaign<\/dt>/i);
  assert.doesNotMatch(script, /Studio approval required/);
  assert.match(script, /appointment is booked only after payment/i);
  assert.match(page, /id="scriptTextField" hidden[\s\S]*?name="scriptText"/);
  assert.match(script, /selectedOffer\?\.maxWordCount[\s\S]*?words maximum/);
  assert.doesNotMatch(script, /special-card__meta/);
  assert.match(script, /Keep the script to \$\{maximum\} words or fewer/);
  assert.match(script, /There are no special available at this time\./);
  assert.match(script, /Check back another time or <a href="\$\{escape\(payload\.normalInquiryUrl\)\}">submit a normal tattoo request<\/a>\./);
  assert.match(page, /id="specialsSubmit">Continue to Select Time Slot<\/button>/);
  assert.match(page, />I agree to receive transactional email about this Tattoo Special request\.<\/span>/);
  assert.match(page, />The studio stores this person’s details, but automated email goes only to the primary participant\.<\/p>/);
  assert.doesNotMatch(page, /request, approval, deposit, and appointment|Message and data rates may apply|Reply STOP to opt out/i);
  assert.doesNotMatch(page, /specials-booking-cue|Book Your Appointment/);
  assert.doesNotMatch(script, /specialsCampaign|campaign\.hidden/);
  assert.doesNotMatch(readFileSync(join(ROOT, "css", "tattoo-specials.css"), "utf8"), /specials-booking-cue/);
  assert.match(readFileSync(join(ROOT, "css", "tattoo-specials.css"), "utf8"), /#specialsDates\s*\{[\s\S]*?color:\s*var\(--color-accent, #f8b468\)/);
  assert.match(readFileSync(join(ROOT, "css", "tattoo-specials.css"), "utf8"), /\.specials-window-copy strong\s*\{[\s\S]*?color:\s*var\(--special-accent\)/);
  assert.match(page, /<h2 id="offersTitle">Choose your Tattoo Special\.<\/h2>[\s\S]*?class="specials-window-copy"[\s\S]*?id="specialsDates"[\s\S]*?id="specialsDeposit"/);
  assert.doesNotMatch(page, /specialsArtwork|specials-artwork/);
  assert.doesNotMatch(script, /payload\.artwork|specialsArtwork/);
  assert.match(booking, /pendingSpecialApproval \? "Submit Request for Approval" : "Continue to Square"/);
  assert.doesNotMatch(script, /Direct booking|normal private booking link/);
  assert.doesNotMatch(script, /complexity approval|special-anime/);
  assert.match(reschedule, /flow.*special-request/);
  assert.match(reschedule, /No additional Studio approval is required/);
  assert.match(reschedule, /payload\.mode === 'special_request_changed'[\s\S]*?location\.assign\(payload\.checkoutUrl\)/);
});

test("Studio Tattoo Special requests show the client tattoo description", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /if \(t === "tattoo_special"\)[\s\S]*?Tattoo Special Request[\s\S]*?Client Tattoo Description[\s\S]*?p\("project_details"\)/);
  assert.match(studio, /if \(t === "tattoo_special"\)[\s\S]*?field\("Placement", p\("placement"\)\)/);
  assert.match(studio, /if \(t === "tattoo_special"\)[\s\S]*?p\("reference_link"\)/);
  assert.match(studio, /if \(t === "tattoo_special"\)[\s\S]*?Requested Script[\s\S]*?p\("script_text"\)/);
  assert.match(studio, /name="maxWordCount"[\s\S]*?offer\.maxWordCount/);
});

test("Studio Tattoo Specials manager creates complete campaigns and campaign-owned individual specials", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  assert.match(studio, /Add an entire campaign[\s\S]*?data-tattoo-special-campaign-form/);
  assert.match(studio, /Add an individual special[\s\S]*?data-tattoo-special-offer-form/);
  assert.match(studio, /Publish at \/tattoos\/specials\//);
  assert.match(studio, /name="campaignId" required/);
  assert.match(studio, /class="tattoo-special-metrics"[\s\S]*?Requests[\s\S]*?Awaiting deposit[\s\S]*?Booked[\s\S]*?Cancelled[\s\S]*?Conversion/);
  assert.match(studio, /Booked is a lifetime conversion count; Cancelled is included in Booked, and reschedules are not cancellations\./);
  assert.match(studio, /\/api\/admin\/tattoo\/specials\/campaigns/);
  assert.match(worker, /handleAdminTattooSpecialCampaign/);
  assert.match(worker, /tattooSpecialCampaignMatch/);
});

test("Studio request details open an editable native text message to the submitted client phone", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /function smsHref\(phone\)[\s\S]*?return `sms:\$\{source\.startsWith\("\+"\)/);
  assert.match(studio, /clientSmsHref = smsHref\(submission\.contactPhone \|\| payloadValue\(submission, "phone"\)\)/);
  assert.match(studio, /id="textClientBtn" href="\$\{escapeHtml\(clientSmsHref\)\}">Text Client<\/a>/);
  assert.match(studio, /Text Client opens your device's Messages app with the editable copy above\. Review it, then press Send yourself\./);
  assert.match(studio, /textClientButton[\s\S]*?navigator\.clipboard\?\.writeText\(value\)[\s\S]*?body=\$\{encodeURIComponent\(value\)\}/);
});

test("Studio prepares a Tattoo Special deposit link silently before explicit client email", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /data-prepare-special-deposit[\s\S]*?Prepare Deposit Link/);
  assert.match(studio, /\/tattoo\/specials\/submissions\/\$\{encodeURIComponent\(prepareSpecialDeposit\.dataset\.prepareSpecialDeposit\)\}\/deposit/);
  assert.match(studio, /data-send-decision-notification[\s\S]*?Send Approval Notification/);
  assert.match(studio, /Prepare the required booking or deposit link before sending approval/);
  assert.match(studio, /const specialClientUrl = submission\.type === "tattoo_special"[\s\S]*?Boolean\(appointment\.checkoutUrl \|\| appointment\.squareCheckoutUrl\)[\s\S]*?\? bookingUrl/);
  assert.match(studio, /if \(specialClientUrl\)[\s\S]*?pay the deposit to confirm your appointment here: \$\{specialClientUrl\}/);
});

test("Studio saves a client-facing decline reason separately from the decision notification", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studio, /Client-facing decline reason[\s\S]*?id="decisionClientMessage"/);
  assert.match(studio, /Saving this reason sends nothing/);
  assert.match(studio, /data-decision-action="decline"/);
  assert.match(studio, /id="decisionConfirmation" hidden/);
  assert.match(studio, /data-confirm-decision="\$\{escapeHtml\(action\)\}"/);
  assert.match(studio, /id="decisionActionState" role="status" aria-live="polite"/);
  assert.match(studio, /if \(state\) state\.textContent = message;/);
  assert.match(studio, /data-send-decision-notification[\s\S]*?Send Decline Notification/);
  assert.match(studio, /Decline notifications require a saved client-facing reason/);
});

test("Studio client preview opens synchronously and carries the Tattoo Special lifecycle", () => {
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const booking = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  const handlerStart = studio.indexOf('if (event.target.id === "previewBookingBtn"');
  const handlerEnd = studio.indexOf('if (event.target.id === "generateBookingBtn"', handlerStart);
  const handler = studio.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.ok(handler.indexOf('window.open("about:blank", "_blank")') >= 0);
  assert.ok(handler.indexOf('window.open("about:blank", "_blank")') < handler.indexOf("await Promise.all"));
  assert.ok(handler.indexOf("/api/booking/context?token=") < handler.indexOf("/api/admin/booking/availability-preview"));
  assert.match(handler, /previewSource: "prepared_access"/);
  assert.match(handler, /Saved draft client flow opened; no client access has been prepared yet/);
  assert.match(studio, /sessionPlan\?\.bookingLinkPurpose \|\| defaultTokenPurpose\(submission\)/);
  assert.match(studio, /sessionPlan\?\.allowedBookingTypes/);
  assert.match(studio, /function clientPreviewContext[\s\S]*?allowedTypeIds[\s\S]*?special_offer_title[\s\S]*?pendingApproval[\s\S]*?pendingCheckout/);
  assert.match(booking, /function adminPreviewContext[\s\S]*?previewSource: payload\.previewSource[\s\S]*?pendingCheckout: payload\.pendingCheckout \|\| null/);
  assert.match(booking, /id="walkInSection"[\s\S]*?walkInSection\.classList\.toggle\("hidden", Boolean\(special\)\)/);
  assert.match(booking, /<strong>Notes from the artist:<\/strong><br>\$\{sessionCopyHtml\(plan\.artistNote \|\| copy\.fallbackNote\)\}/);
  assert.match(booking, /if \(!renderPendingCheckout\(\)\) appEl\.classList\.remove\("hidden"\)/);
  assert.match(booking, /if \(previewMode\)[\s\S]*?client's Square checkout is not opened from Studio preview/);
  assert.match(booking, /pending\.approvalState === "approved"[\s\S]*?Confirm and pay deposit[\s\S]*?resumeCheckoutLink\.classList\.remove\("hidden"\)/);
  assert.match(booking, /changeRequestedDateLink\.href = `\/booking\/reschedule\/\?appointment=\$\{encodeURIComponent\(pending\.appointmentId\)\}&flow=special-request`/);
});

test("Tattoo Specials require Studio approval and preserve server-side price, deposit, duration, and token cutoff", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const bucket = new MemoryBucket();
  const adminToken = "studio-specials-test";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: db, SUBMISSION_FILES: bucket, SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test", SQUARE_ACCESS_TOKEN: "square-token", SQUARE_LOCATION_ID: "square-location",
    TWILIO_ACCOUNT_SID: "ACspecial", TWILIO_AUTH_TOKEN: "twilio-token", TWILIO_MESSAGING_SERVICE_SID: "MGspecial",
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  };
  const opens = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closes = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='campaign-fka-2026'").run(opens, closes);

  const publicResponse = await handlePublicTattooSpecials(new Request("https://example.test/api/tattoo/specials"), env);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json();
  assert.equal(publicPayload.state, "open");
  assert.equal(publicPayload.offers.length, 6);
  const scriptSpecial = publicPayload.offers.find((offer) => offer.id === "special-script");
  const handSizedSpecial = publicPayload.offers.find((offer) => offer.id === "special-palm");
  assert.equal(scriptSpecial.variants.length, 2);
  assert.equal(scriptSpecial.durationMinutes, 90);
  assert.equal(scriptSpecial.maxWordCount, 21);
  assert.deepEqual(scriptSpecial.variants.map((variant) => variant.priceCents), [15000, 17000]);
  assert.equal(publicPayload.offers.some((offer) => offer.id === "special-anime"), false);
  assert.equal(handSizedSpecial.title, "Hand Sized Tattoo");
  assert.match(handSizedSpecial.description, /hand-sized tattoo/i);
  assert.deepEqual(
    publicPayload.offers.map((offer) => [offer.id, offer.mode]),
    [
      ["special-quarter-bg", "review"],
      ["special-quarter-color", "review"],
      ["special-floral-color", "review"],
      ["special-script", "review"],
      ["special-palm", "review"],
      ["special-two-small", "review"],
    ],
  );

  const underageResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm", variantId: "special-palm-v3-standard", idempotencyKey: "special-underage",
    name: "Underage Client", email: "underage@example.com", phone: "4045550197", dob: "2010-01-01",
    ageConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
    placement: "Upper arm", projectDetails: "This request must not pass age verification.",
  }), env);
  assert.equal(underageResponse.status, 400);
  assert.match((await underageResponse.json()).error, /date of birth.*at least 18/i);

  const requestResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm",
    variantId: "special-palm-v3-standard",
    idempotencyKey: "special-review-palm-1",
    name: "Primary Person",
    email: "primary@example.com",
    phone: "4045550101",
    dob: "1990-01-01",
    ageConfirmed: "yes",
    policyAccepted: "yes",
    transactionalMessagesAccepted: "yes",
    placement: "Upper arm",
    projectDetails: "A hand-sized symbolic composition.",
    // These values are intentionally hostile; the server must ignore them.
    priceCents: "1",
    depositCents: "1",
    durationMinutes: "30",
  }), env);
  assert.equal(requestResponse.status, 201);
  const submitted = await requestResponse.json();
  assert.equal(submitted.reviewRequired, true);
  assert.match(submitted.bookingUrl, /^\/booking\/\?token=/);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?",
  ).get(submitted.submissionId).count, 0);
  assert.equal(sent.length, 0);

  const replayResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm", variantId: "special-palm-v3-standard", idempotencyKey: "special-review-palm-1",
    name: "Primary Person", email: "primary@example.com", phone: "4045550101",
    dob: "1990-01-01",
    ageConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
    placement: "Upper arm", projectDetails: "Retry.",
  }), env);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.submissionId, submitted.submissionId);
  assert.equal(replay.bookingUrl, submitted.bookingUrl);

  let submission = database.prepare("SELECT * FROM submissions WHERE id=?").get(submitted.submissionId);
  const terms = database.prepare("SELECT * FROM tattoo_special_submission_terms WHERE submission_id=?").get(submitted.submissionId);
  assert.equal(submission.type, "tattoo_special");
  assert.equal(submission.status, "new");
  assert.equal(submission.tattoo_stage, "review");
  assert.equal(terms.advertised_price_cents, 20000);
  assert.equal(terms.approved_price_cents, null);
  assert.equal(terms.deposit_cents, 5000);
  assert.equal(terms.duration_minutes, 120);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(submitted.submissionId).count, 1);
  const tokenRow = database.prepare("SELECT * FROM booking_tokens WHERE submission_id=?").get(submitted.submissionId);
  assert.equal(tokenRow.expires_at, closes);
  assert.deepEqual(JSON.parse(tokenRow.allowed_booking_types_json), ["tattoo_special_palm_v3"]);
  const rawToken = new URL(submitted.bookingUrl, "https://example.test").searchParams.get("token");
  const contextResponse = await handleBookingContext(new Request(`https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`), env);
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.equal(context.submission.pendingApproval, true);
  assert.equal(context.submission.special.offerTitle, "Hand Sized Tattoo");
  assert.equal(context.submission.special.quotedPriceCents, 20000);
  assert.equal(context.bookingTypes[0].durationMinutes, 120);
  assert.equal(context.bookingTypes[0].depositCents, 5000);
  assert.equal(context.sessionPlan, null);

  const appointmentStart = new Date(
    Math.ceil((Date.now() + 7 * 24 * 60 * 60 * 1000) / (60 * 60 * 1000)) * 60 * 60 * 1000,
  );
  const appointmentEnd = new Date(appointmentStart.getTime() + 120 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-palm-window", bookingTypeId: "tattoo_special_palm_v3",
    startAt: appointmentStart.toISOString(), endAt: appointmentEnd.toISOString(),
    capacity: 2,
    bufferBeforeMinutes: 30,
    bufferAfterMinutes: 30,
  });
  const holdResponse = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_special_palm_v3",
    availabilityWindowId: "special-palm-window",
  }), env);
  const hold = await holdResponse.json();
  assert.equal(holdResponse.status, 200, hold.detail || hold.error);
  assert.equal(hold.pendingApproval, true);
  assert.equal(hold.appointment.approvalState, "pending");
  assert.equal(hold.appointment.startAt, appointmentStart.toISOString());
  assert.equal(hold.appointment.endAt, appointmentEnd.toISOString());
  assert.ok(new Date(hold.appointment.holdExpiresAt).getTime() <= new Date(closes).getTime());
  assert.equal(database.prepare("SELECT square_checkout_url FROM appointments WHERE id=?").get(hold.appointment.id).square_checkout_url, null);

  const overlappingStart = new Date(appointmentStart.getTime() + 30 * 60 * 1000);
  const overlappingEnd = new Date(overlappingStart.getTime() + 120 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-palm-overlapping-window", bookingTypeId: "tattoo_special_palm_v3",
    startAt: overlappingStart.toISOString(), endAt: overlappingEnd.toISOString(),
    capacity: 2,
    bufferBeforeMinutes: 30,
    bufferAfterMinutes: 30,
  });
  const competingResponse = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-palm", variantId: "special-palm-v3-standard", idempotencyKey: "special-review-palm-overlap",
    name: "Competing Client", email: "competing@example.com", phone: "4045550198",
    dob: "1990-01-01",
    ageConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
    placement: "Forearm", projectDetails: "A second hand-sized request.",
  }), env);
  assert.equal(competingResponse.status, 201);
  const competing = await competingResponse.json();
  const competingToken = new URL(competing.bookingUrl, "https://example.test").searchParams.get("token");
  const competingContextResponse = await handleBookingContext(new Request(
    `https://example.test/api/booking/context?token=${encodeURIComponent(competingToken)}`,
  ), env);
  assert.equal(competingContextResponse.status, 200);
  const competingContext = await competingContextResponse.json();
  assert.equal(competingContext.availabilityWindows.some((item) => item.id === "special-palm-overlapping-window"), false);
  const competingHold = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: competingToken,
    bookingTypeId: "tattoo_special_palm_v3",
    availabilityWindowId: "special-palm-overlapping-window",
  }), env);
  const competingHoldPayload = await competingHold.json();
  assert.equal(competingHold.status, 400, JSON.stringify(competingHoldPayload));
  assert.match(competingHoldPayload.error, /overlaps another booking/i);

  const adjacentStart = new Date(appointmentEnd.getTime() + 60 * 60 * 1000);
  const adjacentEnd = new Date(adjacentStart.getTime() + 120 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-palm-adjacent-window", bookingTypeId: "tattoo_special_palm_v3",
    startAt: adjacentStart.toISOString(), endAt: adjacentEnd.toISOString(),
    capacity: 2,
    bufferBeforeMinutes: 30,
    bufferAfterMinutes: 30,
  });
  const adjacentHoldResponse = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: competingToken,
    bookingTypeId: "tattoo_special_palm_v3",
    availabilityWindowId: "special-palm-adjacent-window",
  }), env);
  const adjacentHold = await adjacentHoldResponse.json();
  assert.equal(adjacentHoldResponse.status, 200, adjacentHold.detail || adjacentHold.error);
  assert.equal(adjacentHold.appointment.startAt, adjacentStart.toISOString());

  database.prepare("UPDATE submissions SET internal_notes=? WHERE id=?")
    .run("Private operator note.", competing.submissionId);
  const declineReason = "The requested composition exceeds the size and time included in this Tattoo Special.";
  const savedDeclineReason = await handleUpdateSubmission(jsonPatchRequest(
    `/api/admin/submissions/${competing.submissionId}`,
    { decisionClientMessage: declineReason },
    adminToken,
  ), env, competing.submissionId);
  assert.equal(savedDeclineReason.status, 200, await savedDeclineReason.clone().text());
  const declined = await decideSubmission(env, competing.submissionId, adminToken, "decline");
  assert.equal(declined.status, 200);
  assert.equal(sent.some((message) => message.to === "competing@example.com" && /declined/i.test(message.subject)), false);
  const declinedSubmission = database.prepare("SELECT status,internal_notes FROM submissions WHERE id=?").get(competing.submissionId);
  assert.equal(declinedSubmission.status, "declined");
  assert.equal(declinedSubmission.internal_notes, "Private operator note.");
  const declinedAppointment = database.prepare("SELECT status,hold_state,approval_state,cancellation_reason FROM appointments WHERE id=?").get(adjacentHold.appointment.id);
  assert.deepEqual({ ...declinedAppointment }, {
    status: "cancelled",
    hold_state: "released",
    approval_state: "declined",
    cancellation_reason: declineReason,
  });
  assert.match(database.prepare(
    "SELECT note FROM submission_events WHERE submission_id=? AND event_type='decision_declined' ORDER BY created_at DESC LIMIT 1",
  ).get(competing.submissionId).note, /declined/);
  const declineNotification = await handleSubmissionDecisionNotification(adminJsonRequest(
    `/api/admin/submissions/${competing.submissionId}/decision-notification`,
    { kind: "decline" },
    adminToken,
  ), env, competing.submissionId);
  assert.equal(declineNotification.status, 200, await declineNotification.clone().text());
  const declineEmail = sent.filter((message) => message.to === "competing@example.com").at(-1);
  assert.ok(declineEmail);
  assert.match(declineEmail.html, /Why this request was declined/);
  assert.match(declineEmail.text, new RegExp(declineReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const requestEmailVariants = database.prepare(
    "SELECT template_key,template_variant FROM notification_deliveries WHERE related_id=? ORDER BY template_key"
  ).all(submitted.submissionId).map((row) => ({ ...row }));
  assert.deepEqual(requestEmailVariants, [
    { template_key: "admin_submission_received", template_variant: "tattoo_special" },
    { template_key: "submission_received", template_variant: "tattoo_special" },
  ]);
  const requestEmail = sent.find((message) => message.to === "primary@example.com" && /request received/i.test(message.subject));
  assert.ok(requestEmail);
  assert.match(requestEmail.subject, /Tattoo Special request received$/);
  assert.match(requestEmail.html, /Your request has been received\./);
  assert.match(requestEmail.text, /Your request has been received\./);
  assert.doesNotMatch(requestEmail.html, /Your Tattoo Special request has been received\./);
  assert.doesNotMatch(requestEmail.text, /Your Tattoo Special request has been received\./);
  assert.match(requestEmail.html, /Requested time \(held\)/i);
  assert.match(requestEmail.html, /no appointment is booked/i);

  const prematureCheckout = await handleCreateBookingCheckout(jsonRequest("/api/booking/checkout", {
    token: rawToken,
    bookingTypeId: "tattoo_special_palm_v3",
    availabilityWindowId: "special-palm-window",
  }), env);
  assert.equal(prematureCheckout.status, 409);
  assert.equal((await prematureCheckout.json()).code, "SPECIAL_APPROVAL_REQUIRED");

  let squareRequestBody = null;
  const approvalLinkStartedAt = Date.now();
  const approvalResponse = await decideSubmission(env, submitted.submissionId, adminToken, "approve", {
    approvedPriceCents: 1,
  });
  assert.equal(approvalResponse.status, 200, await approvalResponse.clone().text());
  assert.equal(sent.some((message) => message.to === "primary@example.com" && /deposit required/i.test(message.subject)), false);
  assert.equal(database.prepare("SELECT revoked_at FROM booking_tokens WHERE id=?").get(tokenRow.id).revoked_at, null);
  const approvedBeforePreparation = await handleBookingContext(new Request(
    `https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`,
  ), env);
  assert.equal(approvedBeforePreparation.status, 200);
  const approvedBeforePreparationPayload = await approvedBeforePreparation.json();
  assert.equal(approvedBeforePreparationPayload.submission.pendingApproval, false);
  assert.equal(approvedBeforePreparationPayload.pendingCheckout.checkoutUrl, "");
  const depositResponse = await withMockFetch(async (url, init) => {
    const target = String(url);
    if (target.endsWith("/v2/online-checkout/payment-links")) {
      squareRequestBody = JSON.parse(init.body);
      return jsonFetchResponse({ payment_link: { id: "special-palm-link", order_id: "special-palm-order", url: "https://square.test/special" } });
    }
    throw new Error(`Unexpected deposit request: ${target}`);
  }, () => handleAdminTattooSpecialDeposit(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${submitted.submissionId}/deposit`,
    {}, adminToken,
  ), env, submitted.submissionId));
  assert.equal(depositResponse.status, 200, await depositResponse.clone().text());
  const approval = await depositResponse.json();
  assert.equal(approval.checkoutUrl, "https://square.test/special");
  assert.match(approval.clientUrl, /^https:\/\/example\.test\/booking\/\?token=/);
  assert.notEqual(approval.clientUrl, new URL(submitted.bookingUrl, "https://example.test").toString());
  assert.equal(approval.appointmentId, hold.appointment.id);
  assert.ok(new Date(approval.paymentDueAt).getTime() <= new Date(closes).getTime());
  assert.ok(new Date(approval.paymentDueAt).getTime() <= Date.now() + 24 * 60 * 60 * 1000);
  assert.ok(new Date(approval.paymentDueAt).getTime() >= approvalLinkStartedAt + (23 * 60 + 59) * 60 * 1000);
  assert.deepEqual(squareRequestBody.order.line_items.map((item) => item.base_price_money.amount), [5000]);
  submission = database.prepare("SELECT * FROM submissions WHERE id=?").get(submitted.submissionId);
  assert.equal(submission.status, "approved");
  assert.equal(submission.tattoo_stage, "ready_to_book");
  assert.equal(submission.booking_url, new URL(approval.clientUrl).pathname + new URL(approval.clientUrl).search);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(submitted.submissionId).count, 2);
  assert.ok(database.prepare("SELECT revoked_at FROM booking_tokens WHERE id=?").get(tokenRow.id).revoked_at);
  const replacedContext = await handleBookingContext(new Request(
    `https://example.test/api/booking/context?token=${encodeURIComponent(rawToken)}`,
  ), env);
  assert.equal(replacedContext.status, 403);
  const preparedRawToken = new URL(approval.clientUrl).searchParams.get("token");
  const approvedContextResponse = await handleBookingContext(new Request(
    `https://example.test/api/booking/context?token=${encodeURIComponent(preparedRawToken)}`,
  ), env);
  assert.equal(approvedContextResponse.status, 200);
  const approvedContext = await approvedContextResponse.json();
  assert.equal(approvedContext.submission.pendingApproval, false);
  assert.equal(approvedContext.pendingCheckout.appointmentId, hold.appointment.id);
  assert.equal(approvedContext.pendingCheckout.approvalState, "approved");
  assert.equal(approvedContext.pendingCheckout.holdState, "active");
  assert.equal(approvedContext.pendingCheckout.resumable, true);
  assert.equal(approvedContext.pendingCheckout.checkoutUrl, "https://square.test/special");
  const repeatedPreparation = await handleAdminTattooSpecialDeposit(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${submitted.submissionId}/deposit`,
    {}, adminToken,
  ), env, submitted.submissionId);
  assert.equal(repeatedPreparation.status, 200, await repeatedPreparation.clone().text());
  const repeatedPreparationPayload = await repeatedPreparation.json();
  assert.equal(repeatedPreparationPayload.clientUrl, approval.clientUrl);
  assert.equal(repeatedPreparationPayload.existing, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(submitted.submissionId).count, 2);
  const nonAnimeSimplification = await handleAdminTattooSpecialReview(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${submitted.submissionId}/review`,
    { outcome: "simplification_requested", note: "This option should remain Anime-only." },
    adminToken, "PATCH",
  ), env, submitted.submissionId);
  assert.equal(nonAnimeSimplification.status, 409);
  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  assert.match(bookingPage, /Submit Request for Approval/);
  assert.match(bookingPage, /special-offering/);
  const specialAppointment = database.prepare("SELECT booking_token_id,hold_expires_at,start_at,end_at,approval_state,payment_due_at,square_checkout_url FROM appointments WHERE id=?").get(hold.appointment.id);
  assert.notEqual(specialAppointment.booking_token_id, tokenRow.id);
  assert.equal(specialAppointment.approval_state, "approved");
  assert.equal(specialAppointment.payment_due_at, approval.paymentDueAt);
  assert.equal(specialAppointment.hold_expires_at, approval.paymentDueAt);
  assert.equal(specialAppointment.square_checkout_url, "https://square.test/special");
  assert.equal(specialAppointment.start_at, appointmentStart.toISOString());
  assert.equal(specialAppointment.end_at, appointmentEnd.toISOString());
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=? AND template_key IN ('appointment_confirmed','admin_appointment_confirmed')",
  ).get(hold.appointment.id).count, 0);
  const approvalNotification = await handleSubmissionDecisionNotification(adminJsonRequest(
    `/api/admin/submissions/${submitted.submissionId}/decision-notification`,
    { kind: "approval" }, adminToken,
  ), env, submitted.submissionId);
  assert.equal(approvalNotification.status, 200, await approvalNotification.clone().text());
  const approvalEmail = sent.find((message) => message.to === "primary@example.com" && /deposit required/i.test(message.subject));
  assert.ok(approvalEmail);
  assert.match(approvalEmail.html, /Pay deposit and confirm/i);
  assert.match(approvalEmail.text, new RegExp(approval.clientUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(approvalEmail.text, /square\.test\/special/);
  assert.match(approvalEmail.html, /Change requested time/i);
  assert.match(approvalEmail.html, /booking\/reschedule\/\?appointment=/i);
  assert.match(approvalEmail.text, /Change requested time:/i);
  assert.match(approvalEmail.text, /flow=special-request/i);
  assert.match(approvalEmail.html, /booked only after Square confirms/i);
  assert.match(approvalEmail.text, /expires after 24 hours or at the Tattoo Specials sales deadline, whichever comes first/i);
  assert.deepEqual(database.prepare(
    "SELECT channel,status FROM notification_deliveries WHERE related_id=? AND template_key='tattoo_special_deposit_requested' ORDER BY channel",
  ).all(hold.appointment.id).map((row) => ({ ...row })), [
    { channel: "email", status: "sent" },
  ]);

  const webhookUrl = "https://example.test/api/square/webhook";
  const signatureKey = "specials-webhook-signature";
  const webhookBody = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: { id: "special-palm-payment", order_id: "special-palm-order", status: "COMPLETED" } } },
  });
  const webhookSignature = await squareWebhookSignatureForTest(webhookBody, signatureKey, webhookUrl);
  database.prepare("UPDATE tattoo_special_submission_terms SET sales_closes_at=? WHERE submission_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), submitted.submissionId);
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
  assert.equal(database.prepare("SELECT status FROM deposit_payments WHERE appointment_id=?").get(hold.appointment.id).status, "payment_attention");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM appointment_events WHERE appointment_id=? AND event_type='tattoo_special_late_payment_attention'").get(hold.appointment.id).count, 1);

  const onePersonTwoSmall = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-two-small",
    variantId: "special-two-small-v2-standard",
    idempotencyKey: "special-two-tattoos-one-person",
    name: "One Recipient", email: "one-recipient@example.com", phone: "4045550119",
    dob: "1990-01-01",
    ageConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
    placement: "Left and right forearms", projectDetails: "Both small tattoos are for the primary purchaser.",
  }), env);
  assert.equal(onePersonTwoSmall.status, 201);
  const onePersonSubmission = await onePersonTwoSmall.json();
  const onePersonPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(onePersonSubmission.submissionId).payload_json);
  assert.equal(onePersonPayload.participants.length, 1);

  const invalidSecondEmail = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-two-small",
    variantId: "special-two-small-v2-standard",
    idempotencyKey: "special-two-participants-invalid-email",
    name: "Primary Adult", email: "primary-adult@example.com", phone: "4045550120",
    participant2Name: "Second Adult", participant2Email: "second-adult@example", participant2Phone: "4045550121",
    dob: "1990-01-01", participant2Dob: "1990-01-01",
    ageConfirmed: "yes", participant2AgeConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
    placement: "Two placements", projectDetails: "One small tattoo for each adult.",
  }), env);
  assert.equal(invalidSecondEmail.status, 400);
  assert.deepEqual(await invalidSecondEmail.json(), {
    error: "Enter a complete email address for the second adult participant, such as name@example.com.",
    field: "participant2Email",
  });

  const sharedAppointment = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-two-small",
    variantId: "special-two-small-v2-standard",
    idempotencyKey: "special-two-participants-1",
    name: "Primary Adult", email: "primary-adult@example.com", phone: "4045550120",
    participant2Name: "Second Adult", participant2Email: "second-adult@example.com", participant2Phone: "4045550121",
    dob: "1990-01-01", participant2Dob: "1990-01-01",
    ageConfirmed: "yes", participant2AgeConfirmed: "yes", policyAccepted: "yes", transactionalMessagesAccepted: "yes",
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
  assert.equal(sent.some((message) => message.to === "primary-adult@example.com"), false);

  const beforeVersion = terms.offer_version_id;
  const adminState = await (await handleAdminTattooSpecials(draftRequest("/api/admin/tattoo/specials", "GET", undefined, adminToken), env)).json();
  const palm = adminState.offers.find((offer) => offer.id === "special-palm");
  const versionResponse = await handleAdminTattooSpecialOffer(adminJsonRequest(
    "/api/admin/tattoo/specials/offers/special-palm",
    {
      title: palm.title, slug: palm.slug, description: palm.description,
      durationMinutes: 150, depositCents: 6000, mode: "direct",
      referenceRequirement: "optional", participantCount: 1, active: true, sortOrder: palm.sortOrder,
      maxWordCount: 0,
      variants: [{ label: "Standard", priceCents: 22500, sortOrder: 10 }],
    }, adminToken, "PATCH",
  ), env, "special-palm");
  assert.equal(versionResponse.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM tattoo_special_offer_versions WHERE offer_id='special-palm'").get().count, 4);
  assert.equal(database.prepare("SELECT offer_version_id FROM tattoo_special_submission_terms WHERE submission_id=?").get(submitted.submissionId).offer_version_id, beforeVersion);
  assert.equal(database.prepare("SELECT deposit_cents FROM booking_types WHERE id='tattoo_special_palm_v2'").get().deposit_cents, 5000);
  assert.equal(database.prepare("SELECT booking_mode FROM tattoo_special_offer_versions WHERE id=(SELECT current_version_id FROM tattoo_special_offers WHERE id='special-palm')").get().booking_mode, "review");
});

test("Script Tattoo enforces twenty-one words and preserves its fixed approved price", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const bucket = new MemoryBucket();
  const adminToken = "studio-specials-review";
  const env = {
    SUBMISSIONS_DB: db, SUBMISSION_FILES: bucket, SUBMISSIONS_ADMIN_TOKEN: adminToken,
    SQUARE_ACCESS_TOKEN: "square-token", SQUARE_LOCATION_ID: "square-location",
  };
  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='campaign-fka-2026'")
    .run(new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString());
  const base = {
    offerId: "special-script", variantId: "special-script-v2-color", name: "Script Client",
    email: "script@example.com", phone: "4045550110", dob: "1990-01-01", ageConfirmed: "yes", policyAccepted: "yes",
    transactionalMessagesAccepted: "yes",
    placement: "Forearm", projectDetails: "Fine-line script with a clean, readable layout.",
  };
  const missing = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", { ...base, idempotencyKey: "script-missing-text" }), env);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /enter the script text/i);

  const tooLong = await handleCreateTattooSpecialSubmission(multipartRequest(
    "/api/tattoo/specials/submissions",
    { ...base, idempotencyKey: "script-too-long", scriptText: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two" },
  ), env);
  assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /21 words or fewer/i);

  const received = await handleCreateTattooSpecialSubmission(multipartRequest(
    "/api/tattoo/specials/submissions",
    { ...base, idempotencyKey: "script-valid", scriptText: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one" },
  ), env);
  assert.equal(received.status, 201);
  const requestPayload = await received.json();
  assert.equal(requestPayload.reviewRequired, true);
  assert.match(requestPayload.bookingUrl, /^\/booking\/\?token=/);
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id=?").get(requestPayload.submissionId).status, "new");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(requestPayload.submissionId).count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?",
  ).get(requestPayload.submissionId).count, 0);
  const rawToken = new URL(requestPayload.bookingUrl, "https://example.test").searchParams.get("token");
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-script-window", bookingTypeId: "tattoo_special_script_v2",
    startAt: start.toISOString(), endAt: end.toISOString(),
  });
  const heldResponse = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_special_script_v2",
    availabilityWindowId: "special-script-window",
  }), env);
  const held = await heldResponse.json();
  assert.equal(heldResponse.status, 200, held.detail || held.error);
  assert.equal(held.pendingApproval, true);
  assert.deepEqual(database.prepare(
    "SELECT template_key FROM notification_deliveries WHERE related_id=? ORDER BY template_key",
  ).all(requestPayload.submissionId).map((row) => row.template_key), [
    "admin_submission_received",
    "submission_received",
  ]);

  const decision = await decideSubmission(env, requestPayload.submissionId, adminToken, "approve", {
    approvedPriceCents: 25000,
  });
  assert.equal(decision.status, 200, await decision.clone().text());
  const approved = await withMockFetch(async (url) => {
    assert.match(String(url), /\/v2\/online-checkout\/payment-links$/);
    return jsonFetchResponse({ payment_link: { id: "script-link", order_id: "script-order", url: "https://square.test/script" } });
  }, () => handleAdminTattooSpecialDeposit(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${requestPayload.submissionId}/deposit`,
    {}, adminToken,
  ), env, requestPayload.submissionId));
  assert.equal(approved.status, 200);
  const approval = await approved.json();
  assert.equal(approval.checkoutUrl, "https://square.test/script");
  const storedTerms = database.prepare("SELECT * FROM tattoo_special_submission_terms WHERE submission_id=?").get(requestPayload.submissionId);
  assert.equal(storedTerms.advertised_price_cents, 17000);
  assert.equal(storedTerms.approved_price_cents, 17000);
  assert.equal(storedTerms.duration_minutes, 90);
  assert.equal(storedTerms.max_word_count, 21);
  assert.equal(storedTerms.review_outcome, "approved");
  const savedPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(requestPayload.submissionId).payload_json);
  assert.equal(savedPayload.approved_price_cents, 17000);
  assert.equal(savedPayload.script_text, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one");
  assert.equal(savedPayload.max_word_count, 21);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=? AND template_key='tattoo_special_deposit_requested'"
  ).get(held.appointment.id).count, 0);
});

test("Script Tattoo approval cannot issue a deposit link after the sales cutoff", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const adminToken = "studio-specials-cutoff";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: db, SUBMISSION_FILES: new MemoryBucket(), SUBMISSIONS_ADMIN_TOKEN: adminToken,
    EMAIL: { async send(message) { sent.push(message); return { messageId: crypto.randomUUID() }; } },
  };
  database.prepare("UPDATE tattoo_special_campaigns SET sales_opens_at=?,sales_closes_at=?,enabled=1 WHERE id='campaign-fka-2026'")
    .run(new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 3600000).toISOString());
  const received = await handleCreateTattooSpecialSubmission(multipartRequest("/api/tattoo/specials/submissions", {
    offerId: "special-script", variantId: "special-script-v2-bg", idempotencyKey: "script-cutoff-review",
    name: "Cutoff Client", email: "cutoff@example.com", phone: "4045550199", dob: "1990-01-01", ageConfirmed: "yes", policyAccepted: "yes",
    transactionalMessagesAccepted: "yes",
    placement: "Forearm", projectDetails: "Simple black script.", scriptText: "Keep going",
  }), env);
  const review = await received.json();
  assert.equal(received.status, 201);
  const rawToken = new URL(review.bookingUrl, "https://example.test").searchParams.get("token");
  const start = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  insertAvailabilityWindow(database, {
    id: "special-script-cutoff-window", bookingTypeId: "tattoo_special_script_v2",
    startAt: start.toISOString(), endAt: end.toISOString(),
  });
  const held = await handleCreateBookingHold(jsonRequest("/api/booking/hold", {
    token: rawToken,
    bookingTypeId: "tattoo_special_script_v2",
    availabilityWindowId: "special-script-cutoff-window",
  }), env);
  assert.equal(held.status, 200);
  database.prepare("UPDATE tattoo_special_campaigns SET sales_closes_at=? WHERE id='campaign-fka-2026'")
    .run(new Date(Date.now() - 1000).toISOString());
  database.prepare("UPDATE tattoo_special_submission_terms SET sales_closes_at=? WHERE submission_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), review.submissionId);

  const approval = await decideSubmission(env, review.submissionId, adminToken, "approve", {
    approvedPriceCents: 15000,
  });
  assert.equal(approval.status, 409);
  assert.match((await approval.json()).error, /sales window has closed/i);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM booking_tokens WHERE submission_id=?").get(review.submissionId).count, 1);

  const simplification = await handleAdminTattooSpecialReview(adminJsonRequest(
    `/api/admin/tattoo/specials/submissions/${review.submissionId}/review`,
    { outcome: "simplification_requested", note: "Please remove the background and keep the portrait." }, adminToken, "PATCH",
  ), env, review.submissionId);
  assert.equal(simplification.status, 409);
  assert.match((await simplification.json()).error, /only for the Anime\/Cartoon/i);
  assert.equal(sent.some((message) => /needs simplification/i.test(message.subject || "")), false);
});

test("approved Tattoo Special clients can replace the requested time and pay without another approval", async () => {
  const database = migratedDatabase();
  const db = new LocalD1(database);
  const sent = [];
  const adminToken = "special-resend-admin";
  const now = Date.now();
  const oldStart = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  const oldEnd = new Date(new Date(oldStart).getTime() + 120 * 60 * 1000).toISOString();
  const newStart = new Date(now + 17 * 24 * 60 * 60 * 1000).toISOString();
  const newEnd = new Date(new Date(newStart).getTime() + 120 * 60 * 1000).toISOString();
  const paymentDueAt = new Date(now + 20 * 60 * 60 * 1000).toISOString();
  const submissionId = "special-change-request-submission";
  const appointmentId = "special-change-request-appointment";
  const clientRawToken = "special-change-client-page-token";
  const clientTokenId = "special-change-client-page-access";
  const clientBookingUrl = `/booking/?token=${clientRawToken}`;
  insertSubmissionFixture(database, {
    id: submissionId,
    type: "tattoo_special",
    status: "approved",
    tattooStage: "ready_to_book",
    name: "Change Client",
    email: "change@example.test",
    bookingUrl: clientBookingUrl,
  });
  database.prepare(
    `INSERT INTO booking_tokens (
      id,token_hash,submission_id,allowed_booking_types_json,purpose,
      expires_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    clientTokenId,
    await sha256HexForTest(clientRawToken),
    submissionId,
    JSON.stringify(["tattoo_special_palm_v2"]),
    "tattoo",
    paymentDueAt,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  database.prepare("UPDATE submissions SET payload_json=? WHERE id=?").run(JSON.stringify({
    special_offer_id: "special-palm",
    special_offer_version_id: "special-palm-v2",
    special_offer_title: "Palm Sized Tattoo",
    special_variant_id: "special-palm-v2-standard",
    special_variant_label: "Standard",
    quoted_price_cents: 20000,
    approved_price_cents: 20000,
    deposit_cents: 5000,
    duration_minutes: 120,
    booking_mode: "review",
    booking_type_id: "tattoo_special_palm_v2",
    held_appointment_id: appointmentId,
    held_start_at: oldStart,
    held_end_at: oldEnd,
  }), submissionId);
  const createdAt = new Date().toISOString();
  database.prepare(
    `INSERT INTO tattoo_special_submission_terms (
      submission_id, offer_id, offer_version_id, variant_id, offer_title, variant_label,
      advertised_price_cents, approved_price_cents, deposit_cents, duration_minutes,
      booking_mode, booking_type_id, sales_closes_at, participant_count, review_outcome,
      max_word_count, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    submissionId, "special-palm", "special-palm-v2", "special-palm-v2-standard",
    "Palm Sized Tattoo", "Standard", 20000, 20000, 5000, 120, "review",
    "tattoo_special_palm_v2", new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    1, "approved", null, createdAt, createdAt,
  );
  insertAvailabilityWindow(database, {
    id: "special-change-old-window",
    bookingTypeId: "tattoo_special_palm_v2",
    startAt: oldStart,
    endAt: oldEnd,
  });
  insertAvailabilityWindow(database, {
    id: "special-change-new-window",
    bookingTypeId: "tattoo_special_palm_v2",
    startAt: newStart,
    endAt: newEnd,
  });
  insertAppointmentFixture(database, {
    id: appointmentId,
    submissionId,
    bookingTokenId: clientTokenId,
    bookingTypeId: "tattoo_special_palm_v2",
    availabilityWindowId: "special-change-old-window",
    status: "deposit_pending",
    purpose: "tattoo",
    name: "Change Client",
    email: "change@example.test",
    startAt: oldStart,
    endAt: oldEnd,
    squareOrderId: "special-change-old-order",
    squarePaymentLinkId: "special-change-old-link",
    squareCheckoutUrl: "https://square.test/special-change-old",
    holdExpiresAt: paymentDueAt,
    holdState: "active",
    approvalState: "approved",
    paymentDueAt,
  });
  insertPaymentFixture(database, {
    id: "special-change-old-payment",
    appointmentId,
    checkoutId: "special-change-old-link",
    orderId: "special-change-old-order",
  });
  const env = {
    SUBMISSIONS_DB: db,
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    SQUARE_ACCESS_TOKEN: "square-token",
    SQUARE_LOCATION_ID: "square-location",
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: { async send(message) { sent.push(message); return { id: `special-resend-${sent.length}` }; } },
  };

  const resendResponse = await handleAdminResendNotification(adminJsonRequest(
    "/api/admin/notifications/resend",
    { templateKey: "tattoo_special_deposit_requested", appointmentId },
    adminToken,
  ), env);
  const resendPayload = await resendResponse.json();
  assert.equal(resendResponse.status, 200, JSON.stringify(resendPayload));
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Tattoo Special was approved/i);
  assert.match(sent[0].text, /example\.test\/booking\/\?token=special-change-client-page-token/);
  assert.doesNotMatch(sent[0].text, /square\.test\/special-change-old/);
  assert.match(sent[0].text, /Change requested time/i);

  const contextResponse = await handleRescheduleContext(jsonRequest("/api/booking/reschedule/context", {
    appointmentId,
    email: "change@example.test",
  }), env);
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.equal(context.mode, "special_request_change");
  assert.equal(context.canReschedule, true);
  assert.equal(context.requiresReplacementPayment, false);
  assert.equal(context.availabilityWindows.some((windowItem) => windowItem.id === "special-change-new-window"), true);

  let invalidatedOldLink = false;
  let newSquareBody = null;
  const changedResponse = await withMockFetch(async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    if (method === "GET" && target.endsWith("/v2/orders/special-change-old-order")) {
      return jsonFetchResponse({ order: { id: "special-change-old-order", state: "OPEN" } });
    }
    if (method === "DELETE" && target.endsWith("/v2/online-checkout/payment-links/special-change-old-link")) {
      invalidatedOldLink = true;
      return new Response(null, { status: 200 });
    }
    if (method === "POST" && target.endsWith("/v2/online-checkout/payment-links")) {
      newSquareBody = JSON.parse(init.body);
      return jsonFetchResponse({ payment_link: {
        id: "special-change-new-link",
        order_id: "special-change-new-order",
        url: "https://square.test/special-change-new",
      } });
    }
    throw new Error(`Unexpected time-change request: ${method} ${target}`);
  }, () => handleRescheduleAppointment(jsonRequest("/api/booking/reschedule", {
    appointmentId,
    email: "change@example.test",
    availabilityWindowId: "special-change-new-window",
  }), env));
  assert.equal(changedResponse.status, 200);
  const changed = await changedResponse.json();
  assert.equal(changed.mode, "special_request_changed");
  assert.equal(changed.checkoutUrl, "https://square.test/special-change-new");
  assert.equal(changed.appointment.startAt, newStart);
  assert.equal(changed.appointment.approvalState, "approved");
  assert.equal(invalidatedOldLink, true);
  assert.notEqual(newSquareBody.idempotency_key, appointmentId);

  const appointment = database.prepare(
    "SELECT * FROM appointments WHERE id=?",
  ).get(appointmentId);
  assert.equal(appointment.start_at, newStart);
  assert.equal(appointment.end_at, newEnd);
  assert.equal(appointment.status, "deposit_pending");
  assert.equal(appointment.approval_state, "approved");
  assert.equal(appointment.reschedule_count, 0);
  assert.equal(appointment.square_payment_link_id, "special-change-new-link");
  assert.equal(appointment.square_checkout_url, "https://square.test/special-change-new");
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id=?").get(submissionId).status, "approved");
  const submissionPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(submissionId).payload_json);
  assert.equal(submissionPayload.held_start_at, newStart);
  assert.equal(submissionPayload.held_end_at, newEnd);
  assert.deepEqual(database.prepare(
    "SELECT provider_checkout_id,status FROM deposit_payments WHERE appointment_id=? ORDER BY created_at,provider_checkout_id",
  ).all(appointmentId).map((row) => ({ ...row })), [
    { provider_checkout_id: "special-change-old-link", status: "cancelled" },
    { provider_checkout_id: "special-change-new-link", status: "pending" },
  ]);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM appointment_events WHERE appointment_id=? AND event_type='special_requested_time_changed'",
  ).get(appointmentId).count, 1);
});

test("Maze Archive consent is explicit, separately scoped, versioned, and idempotent", async () => {
  const database = migratedDatabase();
  const bucket = new MemoryBucket();
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSION_FILES: bucket };
  const base = {
    type: "maze_design", firstName: "Jordan", lastName: "Rivera", email: "jordan@example.test",
    dob: "1990-01-01", age_confirmed: "yes", budget_range: "Up to $300", maze_explanation: "A private path through grief.", review_consent: "yes",
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
    placement:"forearm",dob:"1990-01-01",budget_range:"Up to $300",maze_explanation:"This sentence may be considered.",review_consent:"yes",age_confirmed:"yes",
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

test("public submissions reject a missing phone number", async () => {
  const database = migratedDatabase();
  const env = { SUBMISSIONS_DB: new LocalD1(database) };
  const response = await handleCreateSubmission(
    jsonRequest("/api/submissions", validCustom({ phone: "" })),
    env,
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Phone number is required.");
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
          oneSessionLabel: "One-session plan",
          multipleSessionsLabel: "Multi-session plan",
          notAvailablePolicy: "I’ve included my recommended pacing below. If you have any questions, reach out to me directly: 7708205800",
          clientChoicePolicy: "I’ve included my recommended pacing below. Choose the option that feels like the best fit. If you have any questions reach out to me directly : 7708205800",
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
  assert.equal(storedTemplate.oneSessionLabel, "Session Plan");
  assert.equal(storedTemplate.multipleSessionsLabel, "Session Plan");
  assert.equal(storedTemplate.notAvailablePolicy, "This is my recommended session plan. If you have any questions, reach out to me directly: 7708205800");
  assert.equal(storedTemplate.clientChoicePolicy, "This is my recommended session plan. Choose the option that feels like the best fit. If you have any questions, reach out to me directly: 7708205800");
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
  assert.equal(payload.delivery.reason, "explicit_client_notification_required");
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
    "This is my recommended session plan. If you have any questions, reach out to me directly: 7708205800",
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

test("project-aware custom inquiries validate conditional answers, upload counts, aliases, and limits", async () => {
  const database = migratedDatabase();
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSION_FILES: new MemoryBucket(),
    PUBLIC_SITE_URL: "https://example.test",
  };

  const unsupported = await handleCreateSubmission(
    jsonRequest("/api/submissions", validCustom({ project_type: "portrait" })),
    env,
  );
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json()).error, /supported tattoo project type/i);

  const incompleteCoverUp = await handleCreateSubmission(
    jsonRequest("/api/submissions", validCustom({ project_type: "cover_up" })),
    env,
  );
  assert.equal(incompleteCoverUp.status, 400);
  assert.match((await incompleteCoverUp.json()).error, /cover-up goal/i);

  const legacyCoverUp = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("cover_up", { email: "cover-up@example.test" }),
    [{ fieldName: "cover_up_photos", fileName: "existing.jpg" }],
  ), env);
  assert.equal(legacyCoverUp.status, 200);
  const legacyCoverUpId = (await legacyCoverUp.json()).submissionId;
  const legacyFiles = JSON.parse(database.prepare("SELECT files_json FROM submissions WHERE id=?").get(legacyCoverUpId).files_json);
  assert.deepEqual(legacyFiles.map((file) => file.fieldName), ["existing_tattoo_photos"]);

  const missingReworkChoices = await handleCreateSubmission(
    jsonRequest("/api/submissions", validCustomForProject("rework", {
      email: "rework-missing@example.test",
      rework_interventions: [],
    })),
    env,
  );
  assert.equal(missingReworkChoices.status, 400);
  assert.match((await missingReworkChoices.json()).error, /at least one kind of rework/i);

  const rework = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("rework", { email: "rework@example.test" }),
    [{ fieldName: "existing_tattoo_photos", fileName: "current.jpg" }],
  ), env);
  assert.equal(rework.status, 200);
  const reworkId = (await rework.json()).submissionId;
  const reworkPayload = JSON.parse(database.prepare("SELECT payload_json FROM submissions WHERE id=?").get(reworkId).payload_json);
  assert.deepEqual(reworkPayload.rework_interventions, ["refresh_color", "repair_linework"]);

  const oneSpacePhoto = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("space_filler", { email: "space-one@example.test" }),
    [{ fieldName: "placement_photos", fileName: "wide.jpg" }],
  ), env);
  assert.equal(oneSpacePhoto.status, 400);
  assert.match((await oneSpacePhoto.json()).error, /at least 2 area photographs/i);

  const twoSpacePhotos = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("space_filler", { email: "space-two@example.test" }),
    [
      { fieldName: "placement_photos", fileName: "wide.jpg" },
      { fieldName: "placement_photos", fileName: "close.jpg" },
    ],
  ), env);
  assert.equal(twoSpacePhotos.status, 200);

  const placementPdf = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("new_work", { email: "placement-pdf@example.test" }),
    [{ fieldName: "placement_photo", fileName: "placement.pdf", contentType: "application/pdf" }],
  ), env);
  assert.equal(placementPdf.status, 415);
  assert.match((await placementPdf.json()).error, /placement and existing-tattoo photographs/i);

  const twelveFiles = Array.from({ length: 12 }, (_, index) => ({
    fieldName: index < 6 ? "references" : "placement_photos",
    fileName: `photo-${index + 1}.jpg`,
  }));
  const acceptedTwelve = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("new_work", { email: "twelve-files@example.test" }),
    twelveFiles,
  ), env);
  assert.equal(acceptedTwelve.status, 200);

  const rejectedThirteen = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("new_work", { email: "thirteen-files@example.test" }),
    [...twelveFiles, { fieldName: "references", fileName: "photo-13.jpg" }],
  ), env);
  assert.equal(rejectedThirteen.status, 413);
  assert.match((await rejectedThirteen.json()).error, /at most 12 uploaded files/i);
});

test("saved review work, decisions, access preparation, and client email remain separate", async () => {
  const database = migratedDatabase();
  const adminToken = "decision-workflow-admin";
  const sent = [];
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: crypto.randomUUID() };
      },
    },
  };

  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom()), env);
  assert.equal(created.status, 200);
  const submissionId = (await created.json()).submissionId;
  const initialDeliveryCount = database.prepare(
    "SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?"
  ).get(submissionId).count;

  const opened = await handleGetSubmission(draftRequest(
    `/api/admin/submissions/${submissionId}`, "GET", undefined, adminToken,
  ), env, submissionId);
  assert.equal(opened.status, 200);
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id=?").get(submissionId).status, "new");

  const saved = await handleUpdateSubmission(jsonPatchRequest(
    `/api/admin/submissions/${submissionId}`,
    { internalNotes: "Reviewed composition and references." },
    adminToken,
  ), env, submissionId);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(database.prepare("SELECT status FROM submissions WHERE id=?").get(submissionId).status, "reviewing");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?").get(submissionId).count, initialDeliveryCount);

  const genericApproval = await handleUpdateSubmission(jsonPatchRequest(
    `/api/admin/submissions/${submissionId}`, { status: "approved" }, adminToken,
  ), env, submissionId);
  assert.equal(genericApproval.status, 409);
  assert.equal((await genericApproval.json()).code, "DECISION_ENDPOINT_REQUIRED");

  const unconfirmed = await handleSubmissionDecision(adminJsonRequest(
    `/api/admin/submissions/${submissionId}/decision`, { action: "approve" }, adminToken,
  ), env, submissionId);
  assert.equal(unconfirmed.status, 400);
  assert.equal((await unconfirmed.json()).code, "DECISION_CONFIRMATION_REQUIRED");

  const missingPlan = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(missingPlan.status, 409);
  assert.equal((await missingPlan.json()).code, "REVIEWED_PLAN_AND_BUDGET_REQUIRED");
  assert.equal((await saveReviewedTattooPlan(env, submissionId, adminToken)).status, 200);

  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(approved.status, 200, await approved.clone().text());
  assert.equal(database.prepare("SELECT status,decision_revision FROM submissions WHERE id=?").get(submissionId).decision_revision, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?").get(submissionId).count, initialDeliveryCount);

  const linkResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    { submissionId, purpose: "tattoo", allowedBookingTypes: ["tattoo_quarter"], revokeExisting: true },
    adminToken,
  ), env);
  assert.equal(linkResponse.status, 200, await linkResponse.clone().text());
  assert.equal((await linkResponse.json()).delivery.reason, "explicit_client_notification_required");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?").get(submissionId).count, initialDeliveryCount);

  const blockedReopen = await decideSubmission(env, submissionId, adminToken, "reopen");
  assert.equal(blockedReopen.status, 409);
  assert.equal((await blockedReopen.json()).code, "ACTIVE_ACCESS_BLOCKS_REOPEN");
  assert.equal((await handleAdminRevokeSubmissionBookingTokens(adminJsonRequest(
    "/api/admin/booking/tokens/revoke-submission", { submissionId }, adminToken,
  ), env)).status, 200);
  assert.equal((await decideSubmission(env, submissionId, adminToken, "reopen")).status, 200);
  assert.equal((await decideSubmission(env, submissionId, adminToken, "decline")).status, 200);

  const reason = "The current scope is not a fit for this booking cycle.";
  assert.equal((await handleUpdateSubmission(jsonPatchRequest(
    `/api/admin/submissions/${submissionId}`, { decisionClientMessage: reason }, adminToken,
  ), env, submissionId)).status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_id=?").get(submissionId).count, initialDeliveryCount);

  const declineNotification = await handleSubmissionDecisionNotification(adminJsonRequest(
    `/api/admin/submissions/${submissionId}/decision-notification`, { kind: "decline" }, adminToken,
  ), env, submissionId);
  assert.equal(declineNotification.status, 200, await declineNotification.clone().text());
  assert.equal(database.prepare("SELECT status,decision_revision FROM submissions WHERE id=?").get(submissionId).decision_revision, 2);
  assert.match(sent.at(-1).text, new RegExp(reason));

  const unconfirmedResend = await handleSubmissionDecisionNotification(adminJsonRequest(
    `/api/admin/submissions/${submissionId}/decision-notification`, { kind: "decline", resend: true }, adminToken,
  ), env, submissionId);
  assert.equal(unconfirmedResend.status, 400);
  assert.equal((await unconfirmedResend.json()).code, "RESEND_CONFIRMATION_REQUIRED");
  const confirmedResend = await handleSubmissionDecisionNotification(adminJsonRequest(
    `/api/admin/submissions/${submissionId}/decision-notification`,
    { kind: "decline", resend: true, confirmed: true }, adminToken,
  ), env, submissionId);
  assert.equal(confirmedResend.status, 200, await confirmedResend.clone().text());
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

  const missing = await handleCreateSubmission(jsonRequest(
    "/api/submissions",
    validCustomForProject("large_cover_up"),
  ), env);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /at least 3 photographs/i);

  const twoPhotos = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("large_cover_up"),
    [
      { fieldName: "cover_up_photos", fileName: "angle-1.jpg" },
      { fieldName: "cover_up_photos", fileName: "angle-2.jpg" },
    ],
  ), env);
  assert.equal(twoPhotos.status, 400);
  assert.match((await twoPhotos.json()).error, /at least 3 photographs/i);

  const created = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("large_cover_up"),
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
  assert.equal(storedFiles.filter((file) => file.fieldName === "existing_tattoo_photos").length, 3);
  assert.equal(storedFiles.some((file) => file.fieldName === "placement_photos"), false);

  const additionalPhotos = await handleCreateSubmission(multipartRequest(
    "/api/submissions",
    validCustomForProject("large_cover_up", {
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

  const reviewedPlan = await saveReviewedTattooPlan(env, submissionId, adminToken);
  assert.equal(reviewedPlan.status, 200, await reviewedPlan.clone().text());
  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(approved.status, 200);
  const approvedRow = database.prepare("SELECT status, tattoo_stage FROM submissions WHERE id = ?").get(submissionId);
  assert.equal(approvedRow.status, "approved");
  assert.equal(approvedRow.tattoo_stage, "ready_to_book");
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

  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
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
  assert.deepEqual(tattooToken.allowedBookingTypes, ["tattoo_quarter"]);
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

  const missingBudgetApproval = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(missingBudgetApproval.status, 409);
  assert.equal((await missingBudgetApproval.json()).code, "REVIEWED_PLAN_AND_BUDGET_REQUIRED");

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

  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(approved.status, 200, await approved.clone().text());
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
  assert.equal(sent.length, 0, "booking-link preparation must be silent");
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

  const unchangedActiveTokenPlan = await handleAdminTattooSessionPlan(adminJsonRequest(
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
  assert.equal(unchangedActiveTokenPlan.status, 200);
  const unchangedActiveTokenPayload = await unchangedActiveTokenPlan.json();
  assert.equal(unchangedActiveTokenPayload.unchanged, true);
  assert.equal(unchangedActiveTokenPayload.sessionPlan.budgetAcknowledged, true);

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
  assert.equal((await activeTokenRevision.json()).code, "REOPEN_REVIEW_REQUIRED");

  const revoked = await handleAdminRevokeSubmissionBookingTokens(adminJsonRequest(
    "/api/admin/booking/tokens/revoke-submission",
    { submissionId },
    adminToken,
  ), env);
  assert.equal(revoked.status, 200);

  const reopened = await decideSubmission(env, submissionId, adminToken, "reopen");
  assert.equal(reopened.status, 200, await reopened.clone().text());

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

  const reapproved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(reapproved.status, 200, await reapproved.clone().text());

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
  assert.equal(sent.length, 0, "regenerated booking access must remain silent");
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
  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(approved.status, 200, await approved.clone().text());

  const tokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_quarter", "tattoo_half", "tattoo_full", "tattoo_extended"],
      revokeExisting: true,
    },
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

test("session-plan preferences cannot exceed the appointment types approved for the booking link", async () => {
  const database = migratedDatabase();
  const adminToken = "test-admin-token";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
  };
  const created = await handleCreateSubmission(jsonRequest("/api/submissions", validCustom()), env);
  const submissionId = (await created.json()).submissionId;
  const planResponse = await handleAdminTattooSessionPlan(adminJsonRequest(
    `/api/admin/booking/session-plans/${submissionId}`,
    {
      splitPolicy: "client_choice",
      estimatedSessionsMin: 1,
      estimatedSessionsMax: 2,
      estimatedTotalMinutesMin: 180,
      estimatedTotalMinutesMax: 360,
      artistNote: "Choose the approved pacing that works for you.",
      approvedBudgetMinCents: 80000,
      approvedBudgetMaxCents: 120000,
      approvedBudgetCurrency: "USD",
    },
    adminToken,
    "PATCH",
  ), env, submissionId);
  assert.equal(planResponse.status, 200, await planResponse.clone().text());
  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
  assert.equal(approved.status, 200, await approved.clone().text());

  const halfTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_half"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(halfTokenResponse.status, 200, await halfTokenResponse.clone().text());
  const halfToken = new URL((await halfTokenResponse.json()).token.bookingUrl).searchParams.get("token");

  const blockedLonger = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: halfToken,
    preference: "one_longer_session",
    acknowledged: true,
    budgetAcknowledged: true,
  }), env);
  assert.equal(blockedLonger.status, 409);
  assert.match((await blockedLonger.json()).error, /does not include a longer-session option/i);

  const allowedShorter = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: halfToken,
    preference: "multiple_shorter_sessions",
    acknowledged: true,
    budgetAcknowledged: true,
  }), env);
  assert.equal(allowedShorter.status, 200, await allowedShorter.clone().text());

  const fullTokenResponse = await handleAdminCreateBookingToken(adminJsonRequest(
    "/api/admin/booking/tokens",
    {
      submissionId,
      purpose: "tattoo",
      allowedBookingTypes: ["tattoo_full"],
      revokeExisting: true,
    },
    adminToken,
  ), env);
  assert.equal(fullTokenResponse.status, 200, await fullTokenResponse.clone().text());
  const fullToken = new URL((await fullTokenResponse.json()).token.bookingUrl).searchParams.get("token");

  const blockedShorter = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: fullToken,
    preference: "multiple_shorter_sessions",
    acknowledged: true,
    budgetAcknowledged: true,
  }), env);
  assert.equal(blockedShorter.status, 409);
  assert.match((await blockedShorter.json()).error, /does not include a shorter-session option/i);

  const allowedLonger = await handleSaveBookingSessionPlan(jsonRequest("/api/booking/session-plan", {
    token: fullToken,
    preference: "one_longer_session",
    acknowledged: true,
    budgetAcknowledged: true,
  }), env);
  assert.equal(allowedLonger.status, 200, await allowedLonger.clone().text());
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
  const approved = await decideSubmission(env, submissionId, adminToken, "approve");
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
    dob: "1990-01-01",
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
    assert.match(rendered.html, /background-color:#0E0E0E/);
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
    "tattoo_special_deposit_requested:default",
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
  const specialDepositPreview = renderClientEmailPreview("tattoo_special_deposit_requested", "default");
  const specialDepositApprovalCopy = "Sai Solehman has approved your Tattoo Special request. Your requested time is still held, but it is not booked yet. Use the link below to confirm your appointment and pay your deposit. You can also change your requested time below if needed.";
  assert.match(specialDepositPreview.html, new RegExp(specialDepositApprovalCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(specialDepositPreview.text, new RegExp(specialDepositApprovalCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(specialDepositPreview.html, /Change requested time/);
  assert.match(specialDepositPreview.html, /flow=special-request/);
  assert.match(specialDepositPreview.text, /without another Studio approval/i);
  const specialReceiptPreview = renderClientEmailPreview("submission_received", "tattoo_special");
  assert.match(specialReceiptPreview.subject, /Tattoo Special request received$/);
  assert.match(specialReceiptPreview.html, /Your request has been received\./);
  assert.match(specialReceiptPreview.text, /Your request has been received\./);
  assert.doesNotMatch(specialReceiptPreview.html, /Your Tattoo Special request has been received\./);
  assert.doesNotMatch(specialReceiptPreview.text, /Your Tattoo Special request has been received\./);
  assert.match(specialReceiptPreview.html, /Questions or corrections\? Email saisolehman@artpilltattoohouse\.com, call <a href="tel:\+17708205800"[^>]*>\(770\) 820-5800<\/a>, or text <a href="sms:\+17708205800"[^>]*>\(770\) 820-5800<\/a>, and include your submission reference\./);
  assert.match(specialReceiptPreview.text, /Questions or corrections\? Email saisolehman@artpilltattoohouse\.com, call \(770\) 820-5800, or text \(770\) 820-5800, and include your submission reference\./);
  assert.match(renderClientEmailPreview("submission_received", "art_acquisition").html, /#0039BD/);
  assert.match(renderClientEmailPreview("studio_booking_confirmed", "studio_visit").html, /#0039BD/);
  assert.match(renderClientEmailPreview("studio_booking_confirmed", "studio_space").html, /#005D25/);
});

test("paid tattoo confirmations include final-payment, grace-period, and all client-resource guidance", () => {
  for (const variant of ["tattoo", "tip", "tattoo_extended", "tattoo_extended_tip", "tattoo_special", "tattoo_special_tip"]) {
    const rendered = renderClientEmailPreview("appointment_confirmed", variant);
    const identity = `appointment_confirmed:${variant}`;
    assert.match(rendered.text, /remaining balance must be paid before tattooing begins/, identity);
    assert.match(rendered.text, /Cash is preferred/, identity);
    assert.match(rendered.text, /Cash App, Apple Pay, and credit\/debit cards are also accepted/, identity);
    assert.match(rendered.text, /3% processing fee applies to all digital transactions/, identity);
    assert.match(rendered.text, /15-minute grace period/, identity);
    assert.match(rendered.text, /Arrival later than 15 minutes may require cancellation, rescheduling, and a new deposit/, identity);
    assert.match(rendered.html, /href="https:\/\/thesixwellconstruct\.com\/tattoos\/policies\/"/, identity);
    assert.match(rendered.html, /href="https:\/\/thesixwellconstruct\.com\/tattoos\/day-of\/"/, identity);
    assert.match(rendered.html, /href="https:\/\/thesixwellconstruct\.com\/tattoos\/location-parking\/"/, identity);
    const secondaryUrls = [
      "https://thesixwellconstruct.com/api/booking/calendar?appointment=demo-appointment",
      "https://thesixwellconstruct.com/tattoos/policies/",
      "https://thesixwellconstruct.com/tattoos/day-of/",
      "https://thesixwellconstruct.com/tattoos/location-parking/",
    ];
    secondaryUrls.forEach((url) => {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.equal((rendered.html.match(new RegExp(`href="${escaped}"`, "g")) || []).length, 1, `${identity} should render ${url} once`);
    });
    assert.match(rendered.html, /<a href="https:\/\/thesixwellconstruct\.com\/api\/booking\/calendar\?appointment=demo-appointment"[^>]*>Add to calendar<\/a>/, identity);
  }
});

test("private booking pacing choices follow the Studio-approved appointment types", () => {
  const bookingPage = readFileSync(join(ROOT, "booking", "index.html"), "utf8");
  assert.match(bookingPage, /function pacingOptionsForContext\(\)/);
  assert.match(bookingPage, /bookingTypeIds\.has\("tattoo_full"\)/);
  assert.match(bookingPage, /bookingTypeIds\.has\("tattoo_quarter"\)/);
  assert.match(bookingPage, /pacing\.longer \? \[\["one_longer_session"/);
  assert.match(bookingPage, /pacing\.shorter \? \[\["multiple_shorter_sessions"/);
  assert.match(bookingPage, /if \(!flexible \|\| \(!pacing\.longer && !pacing\.shorter\)\)/);
  assert.match(bookingPage, /Extended Day is optional and adds its fee only when you choose that session type\./);
});

test("Custom Inquiry configures project-aware questions and multi-file upload roles", () => {
  const formSource = readFileSync(join(ROOT, "tattoos", "inquire", "custom", "index.html"), "utf8");
  const projectTypeIndex = formSource.indexOf('name="project_type"');
  const firstNameIndex = formSource.indexOf('name="firstName"');
  assert.ok(projectTypeIndex > -1 && projectTypeIndex < firstNameIndex, "project type appears before client details");
  assert.match(formSource, /data-project-field="cover_up large_cover_up"/);
  assert.match(formSource, /name="rework_interventions" value="refresh_color"/);
  assert.match(formSource, /name="rework_interventions" value="repair_linework"/);
  assert.match(formSource, /name="rework_interventions" value="redesign_part"/);
  assert.match(formSource, /name="rework_interventions" value="extend_new_work"/);
  assert.match(formSource, /name="rework_interventions" value="needs_assessment"/);
  assert.match(formSource, /name="placement_photos"[^>]*multiple|multiple[^>]*name="placement_photos"/);
  assert.match(formSource, /name="existing_tattoo_photos"[^>]*multiple|multiple[^>]*name="existing_tattoo_photos"/);
  assert.match(formSource, /name="references"[^>]*multiple|multiple[^>]*name="references"/);
  assert.match(formSource, /var maxFiles = 12;/);
  assert.match(formSource, /control\.disabled = !active;/);
  assert.doesNotMatch(formSource, /(?:existingPhotos|placementPhotos|references)\.value\s*=\s*""/);

  const submissionsSource = readFileSync(join(ROOT, "functions", "api", "submissions", "_lib.js"), "utf8");
  assert.match(submissionsSource, /tattoo_inquiry:\s*12/);
  assert.match(submissionsSource, /placement_photo:\s*"placement_photos"/);
  assert.match(submissionsSource, /cover_up_photos:\s*"existing_tattoo_photos"/);

  const studioSource = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(studioSource, /Rework Interventions/);
  assert.match(studioSource, /Existing tattoo photograph/);

  const notificationSource = readFileSync(join(ROOT, "functions", "api", "notifications", "_lib.js"), "utf8");
  assert.match(notificationSource, /rework_interventions:\s*"Rework interventions"/);
  assert.match(notificationSource, /refresh_color:\s*"Refresh or restore color"/);
});

test("paid tattoo confirmations render live remaining-balance breakdowns", async () => {
  const database = migratedDatabase();
  const sent = [];
  const adminToken = "confirmation-pricing-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: adminToken,
    PUBLIC_SITE_URL: "https://example.test",
    EMAIL: { async send(message) { sent.push(message); return { messageId: `pricing-${sent.length}` }; } },
  };
  const headers = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
  const templateBase = "https://example.test/api/admin/notifications/templates/appointment_confirmed";
  const initial = await (await handleAdminEmailTemplates(
    new Request(`${templateBase}?variant=tattoo`, { headers }),
    env,
  )).json();
  let response = await handleAdminEmailTemplates(new Request(`${templateBase}/draft?variant=tattoo`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ baseRevision: 0, content: initial.defaultContent }),
  }), env);
  assert.equal(response.status, 200);
  response = await handleAdminEmailTemplates(new Request(`${templateBase}/publish?variant=tattoo`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(response.status, 200);

  const insertPlan = (submissionId, minimumCents, maximumCents) => {
    insertSubmissionFixture(database, {
      id: submissionId,
      type: "tattoo_inquiry",
      status: "approved",
      tattooStage: "tattoo_scheduled",
      email: `${submissionId}@example.test`,
    });
    database.prepare(
      `INSERT INTO tattoo_session_plans (
        id, submission_id, approved_budget_min_cents, approved_budget_max_cents,
        approved_budget_currency
      ) VALUES (?,?,?,?, 'USD')`,
    ).run(`plan-${submissionId}`, submissionId, minimumCents, maximumCents);
  };
  const sendConfirmation = async ({
    id,
    minimumCents,
    maximumCents,
    bookingTypeId = "tattoo_half",
    bookingTypeLabel = "Half Day Session",
    depositCents = 10000,
    sessionFeeCents = 0,
    tipCents = 0,
    withPlan = true,
  }) => {
    const submissionId = `submission-${id}`;
    if (withPlan) insertPlan(submissionId, minimumCents, maximumCents);
    else insertSubmissionFixture(database, {
      id: submissionId,
      type: "tattoo_inquiry",
      status: "approved",
      tattooStage: "tattoo_scheduled",
      email: `${submissionId}@example.test`,
    });
    await notifyAppointmentConfirmed(env, null, {
      id: `appointment-${id}`,
      submissionId,
      bookingTypeId,
      bookingTypeLabel,
      purpose: "tattoo",
      clientName: "Pricing Client",
      clientEmail: `${id}@example.test`,
      startAt: "2026-08-08T16:00:00.000Z",
      endAt: "2026-08-08T19:00:00.000Z",
      depositCents,
      sessionFeeCents,
      tipCents,
      currency: "USD",
    });
    return sent.at(-1);
  };

  const exact = await sendConfirmation({
    id: "exact",
    minimumCents: 60000,
    maximumCents: 60000,
    sessionFeeCents: 20000,
  });
  assert.match(exact.text, /Approved tattoo work: \$600/);
  assert.match(exact.text, /Appointment total: \$600/);
  assert.match(exact.text, /Deposit: \$100 received/);
  assert.match(exact.text, /Remaining balance: \$500/);
  assert.doesNotMatch(exact.text, /Extended Day fee/);
  assert.doesNotMatch(exact.text, /\$800|Estimated:/);

  insertAppointmentFixture(database, {
    id: "appointment-exact-resend",
    submissionId: "submission-exact",
    bookingTypeId: "tattoo_half",
    status: "confirmed",
    purpose: "tattoo",
    name: "Pricing Client",
    email: "exact-resend@example.test",
    startAt: "2026-08-08T16:00:00.000Z",
    endAt: "2026-08-08T19:00:00.000Z",
    depositCents: 10000,
  });
  const resend = await handleAdminResendNotification(adminJsonRequest(
    "/api/admin/notifications/resend",
    { templateKey: "appointment_confirmed", appointmentId: "appointment-exact-resend" },
    adminToken,
  ), env);
  assert.equal(resend.status, 200);
  assert.match(sent.at(-1).text, /Appointment total: \$600/);
  assert.match(sent.at(-1).text, /Remaining balance: \$500/);

  const ranged = await sendConfirmation({ id: "range", minimumCents: 160000, maximumCents: 200000 });
  assert.match(ranged.text, /Approved tattoo work: Estimated: \$1,600[^\d]+\$2,000/);
  assert.match(ranged.text, /Appointment total: Estimated: \$1,600[^\d]+\$2,000/);
  assert.match(ranged.text, /Remaining balance: Estimated: \$1,500[^\d]+\$1,900/);
  assert.doesNotMatch(ranged.text, /Extended Day fee/);

  const exactExtended = await sendConfirmation({
    id: "exact-extended",
    minimumCents: 200000,
    maximumCents: 200000,
    bookingTypeId: "tattoo_extended",
    bookingTypeLabel: "Extended Day Session",
    depositCents: 35000,
    sessionFeeCents: 20000,
    tipCents: 2500,
  });
  assert.match(exactExtended.text, /Approved tattoo work: \$2,000/);
  assert.match(exactExtended.text, /Extended Day fee: \+\$200/);
  assert.match(exactExtended.text, /Appointment total: \$2,200/);
  assert.match(exactExtended.text, /Deposit: \$350 received/);
  assert.match(exactExtended.text, /Remaining balance: \$1,850/);
  assert.match(exactExtended.text, /Optional tip: \$25/);
  assert.match(exactExtended.text, /Total paid today: \$375/);

  const rangedExtended = await sendConfirmation({
    id: "range-extended",
    minimumCents: 160000,
    maximumCents: 200000,
    bookingTypeId: "tattoo_extended",
    bookingTypeLabel: "Extended Day Session",
    depositCents: 35000,
    sessionFeeCents: 20000,
  });
  assert.match(rangedExtended.text, /Extended Day fee: \+\$200/);
  assert.match(rangedExtended.text, /Appointment total: Estimated: \$1,800[^\d]+\$2,200/);
  assert.match(rangedExtended.text, /Remaining balance: Estimated: \$1,450[^\d]+\$1,850/);

  const legacy = await sendConfirmation({ id: "legacy", withPlan: false });
  assert.doesNotMatch(legacy.text, /Approved tattoo work:|Appointment total:|Remaining balance: \$/);
  assert.match(legacy.text, /remaining balance must be paid before tattooing begins/);

  const legacyExtended = await sendConfirmation({
    id: "legacy-extended",
    bookingTypeId: "tattoo_extended",
    bookingTypeLabel: "Extended Day Session",
    depositCents: 35000,
    sessionFeeCents: 20000,
    withPlan: false,
  });
  assert.match(legacyExtended.text, /Extended Day fee: \+\$200/);
  assert.doesNotMatch(legacyExtended.text, /Approved tattoo work:|Appointment total:|Remaining balance: \$/);

  const studioPreviewSource = readFileSync(join(ROOT, "studio", "previews", "index.html"), "utf8");
  assert.match(studioPreviewSource, /Approved tattoo work: \$2,000[\s\S]*Extended Day fee: \+\$200[\s\S]*Remaining balance: \$1,850/);
  assert.match(studioPreviewSource, /Approved tattoo work: \$600[\s\S]*Appointment total: \$600[\s\S]*Remaining balance: \$500/);
});

test("client transactional emails protect table backgrounds and reserve Gmail blending for white text", () => {
  clientEmailPreviewCatalog().forEach((entry) => {
    const rendered = renderClientEmailPreview(entry.templateKey, entry.variant);
    const presentationTables = rendered.html.match(/<table\b[^>]*role="presentation"[^>]*>/gi) || [];
    const tableCells = rendered.html.match(/<td\b[^>]*>/gi) || [];
    const blendScreens = rendered.html.match(/class="gmail-blend-screen"/g) || [];
    const blendDifferences = rendered.html.match(/class="gmail-blend-difference"/g) || [];
    const identity = `${entry.templateKey}:${entry.variant}`;

    assert.doesNotMatch(rendered.html, /color-scheme/i, identity);
    assert.doesNotMatch(rendered.html, /supported-color-schemes/i, identity);
    assert.match(rendered.html, /<html lang="en">/, identity);
    assert.match(rendered.html, /<body class="email-body" style="margin:0;padding:0;">/, identity);
    assert.doesNotMatch(rendered.html, /<body[^>]*(?:bgcolor|background-color)/i, identity);
    assert.match(rendered.html, /u \+ \.email-body \.gmail-blend-screen\{[^}]*mix-blend-mode:screen/, identity);
    assert.match(rendered.html, /u \+ \.email-body \.gmail-blend-difference\{[^}]*mix-blend-mode:difference/, identity);
    assert.doesNotMatch(rendered.html, /border(?:-top|-bottom|-left|-right)?:5px solid #[0-9A-F]{6}/i, `${identity} should use protected rails instead of recolorable CSS borders`);
    assert.equal(blendScreens.length, 0, `${identity} should leave non-white foreground roles unblended`);
    assert.equal(blendScreens.length, blendDifferences.length, `${identity} blend layers should stay paired`);
    assert.ok(presentationTables.length > 0, `${identity} should use presentation tables`);
    assert.ok(tableCells.length > 0, `${identity} should use table cells`);
    presentationTables.forEach((tag) => {
      assert.match(tag, /bgcolor="#[0-9A-F]{6}"/i, `${identity} table should have a legacy-safe background`);
      assert.match(tag, /background-color:#[0-9A-F]{6}!important/i, `${identity} table should have an inline background`);
      assert.match(tag, /background-image:linear-gradient\((#[0-9A-F]{6}),\1\)!important/i, `${identity} table should have a solid anti-inversion background image`);
    });
    tableCells.forEach((tag) => {
      assert.match(tag, /bgcolor="#[0-9A-F]{6}"/i, `${identity} cell should have a legacy-safe background`);
      assert.match(tag, /background-color:#[0-9A-F]{6}!important/i, `${identity} cell should have an inline background`);
      assert.match(tag, /background-image:linear-gradient\((#[0-9A-F]{6}),\1\)!important/i, `${identity} cell should have a solid anti-inversion background image`);
    });
  });

  const whiteProfile = defaultEmailDesignProfile();
  whiteProfile.global.title = { hex: "#FFFFFF", opacity: 1 };
  const whiteRendered = renderClientEmailPreview("appointment_confirmed", "tattoo", whiteProfile).html;
  const whiteBlendScreens = whiteRendered.match(/class="gmail-blend-screen(?: gmail-blend-inline)?"/g) || [];
  const whiteBlendDifferences = whiteRendered.match(/class="gmail-blend-difference"/g) || [];
  assert.ok(whiteBlendScreens.length > 0, "an explicitly white title role should use Gmail blend protection");
  assert.equal(whiteBlendScreens.length, whiteBlendDifferences.length, "white-text blend layers should stay paired");
  assert.match(whiteRendered, /<h1[^>]*color:#FFFFFF[^>]*><span class="gmail-blend-screen">/);
});

test("client transactional emails use the shared title, supporting-copy, descriptor, and node-accent hierarchy", () => {
  const tattoo = renderClientEmailPreview("tattoo_special_review", "simplification_requested").html;
  const tattooConfirmation = renderClientEmailPreview("appointment_confirmed", "tattoo").html;
  const art = renderClientEmailPreview("submission_received", "art_acquisition").html;
  const events = renderClientEmailPreview("studio_booking_confirmed", "studio_space").html;
  const studio = renderClientEmailPreview("crm_relationship_followup", "default").html;

  assert.match(tattoo, /<h1[^>]*color:#FBD19D/);
  assert.match(tattoo, /<p[^>]*color:rgba\(251,209,157,0\.85\)/);
  assert.match(tattooConfirmation, /<a[^>]*color:#090909!important[^>]*>\s*View confirmation\s*<\/a>/);
  assert.match(tattoo, /font-size:10px[^>]*color:rgba\(252,184,103,0\.30\)|color:rgba\(252,184,103,0\.30\)[^>]*font-size:10px/);
  assert.match(tattoo, /color:#FBD19D[^>]*font-size:12px[^>]*>art\.pill TATTOO HOUSE<\/span>/);
  assert.match(tattoo, /color:#9A2323[^>]*font-size:10px[^>]*>\[art\.pill TATTOO HOUSE\]<\/span>/);
  assert.match(tattoo, /<td height="5" bgcolor="#6E0404"[^>]*background-image:linear-gradient\(#6E0404,#6E0404\)!important/);
  assert.match(tattoo, /\.detail-label,\.detail-value\{display:block!important;box-sizing:border-box!important;width:100%!important\}/);
  assert.match(tattoo, /\.email-pad\{padding-left:20px!important;padding-right:20px!important;overflow-wrap:anywhere!important;word-break:break-word!important\}/);
  assert.match(tattoo, /class="detail-label"[^>]*style="box-sizing:border-box;/);
  assert.match(tattoo, /class="detail-value"[^>]*style="box-sizing:border-box;/);
  assert.match(art, /<td height="5" bgcolor="#0039BD"[^>]*background-image:linear-gradient\(#0039BD,#0039BD\)!important/);
  assert.match(events, /<td height="5" bgcolor="#005D25"[^>]*background-image:linear-gradient\(#005D25,#005D25\)!important/);
  assert.match(studio, /<td height="5" bgcolor="#FCB467"[^>]*background-image:linear-gradient\(#FCB467,#FCB467\)!important/);
});

test("email design profiles validate fixed roles, inherit global values, and preserve code-owned node accents", () => {
  const profile = defaultEmailDesignProfile();
  profile.global.title = { hex: "#AABBCC", opacity: 1 };
  profile.global.supporting = { hex: "#DDEEFF", opacity: 0.5 };
  profile.nodes.tattoo.title = { hex: "#112233", opacity: 1 };
  profile.nodes.tattoo.signatureMark = { mode: "custom", color: { hex: "#334455", opacity: 0.75 } };

  const validation = validateEmailDesignProfile(profile);
  assert.equal(validation.ok, true);
  assert.deepEqual(resolveEmailDesign(validation.profile, "tattoo", "#9A2323"), {
    canvas: "#0E0E0E",
    panel: "#151515",
    title: "#112233",
    supporting: "rgba(221,238,255,0.50)",
    descriptor: "rgba(252,184,103,0.30)",
    signatureMark: "rgba(51,68,85,0.75)",
    node: "tattoo",
  });
  assert.equal(resolveEmailDesign(validation.profile, "construct_art", "#0F72DB").title, "#AABBCC");
  assert.equal(resolveEmailDesign(validation.profile, "construct_art", "#0F72DB").signatureMark, "#0F72DB");

  const transparentCanvas = structuredClone(profile);
  transparentCanvas.global.canvas.opacity = 0.8;
  assert.equal(validateEmailDesignProfile(transparentCanvas).ok, false);
  const noncanonical = structuredClone(profile);
  noncanonical.global.title.hex = "#aabbcc";
  assert.equal(validateEmailDesignProfile(noncanonical).ok, false);
  const unknownRole = structuredClone(profile);
  unknownRole.global.rawCss = "color:red";
  assert.equal(validateEmailDesignProfile(unknownRole).ok, false);

  clientEmailPreviewCatalog().forEach((entry) => {
    const rendered = renderClientEmailPreview(entry.templateKey, entry.variant, validation.profile);
    assert.ok(rendered?.html, `${entry.templateKey}:${entry.variant} should render with the profile`);
    if (rendered.theme === "tattoo") assert.match(rendered.html, /<td height="5" bgcolor="#6E0404"[^>]*background-image:linear-gradient\(#6E0404,#6E0404\)!important/);
    if (rendered.theme === "construct_art") assert.match(rendered.html, /<td height="5" bgcolor="#0039BD"[^>]*background-image:linear-gradient\(#0039BD,#0039BD\)!important/);
    if (rendered.theme === "construct_event") assert.match(rendered.html, /<td height="5" bgcolor="#005D25"[^>]*background-image:linear-gradient\(#005D25,#005D25\)!important/);
    if (rendered.theme === "construct_studio") assert.match(rendered.html, /<td height="5" bgcolor="#FCB467"[^>]*background-image:linear-gradient\(#FCB467,#FCB467\)!important/);
  });
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
    bookingTypeId: "tattoo_special_palm_v3",
    bookingTypeLabel: "Hand Sized Tattoo",
    purpose: "tattoo",
    clientName: "Special Client",
    clientEmail: "special-client@example.test",
    startAt: "2026-08-08T16:00:00.000Z",
    endAt: "2026-08-08T18:00:00.000Z",
    depositCents: 5000,
    currency: "USD",
    specialOfferTitle: "Hand Sized Tattoo",
    specialVariantLabel: "Standard",
    specialApprovedPriceCents: 20000,
    specialDurationMinutes: 120,
  };

  await notifyAppointmentConfirmed(env, null, appointment);
  const specialConfirmation = sent.at(-1);
  assert.match(specialConfirmation.text, /Tattoo Special total: \$200/);
  assert.match(specialConfirmation.text, /Deposit received: \$50 received/);
  assert.match(specialConfirmation.text, /Remaining balance: \$150/);
  assert.match(specialConfirmation.text, /Duration: 120 minutes/);
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

test("Studio email design revisions save, preview one or four nodes, test, publish, audit, and restore atomically", async () => {
  const database = migratedDatabase();
  const sent = [];
  const token = "email-design-admin";
  const env = {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: token,
    ADMIN_NOTIFICATION_EMAIL: "studio@example.test",
    EMAIL: { async send(message) { sent.push(message); return { messageId: `design-${sent.length}` }; } },
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/design";
  const initialResponse = await handleAdminEmailDesign(new Request(base, { headers }), env);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.draft, null);
  assert.equal(initial.published, null);
  assert.deepEqual(initial.nodes.map((node) => node.node), ["tattoo", "art", "events", "studio"]);

  const profile = structuredClone(initial.defaultProfile);
  profile.global.title = { hex: "#AABBCC", opacity: 1 };
  profile.nodes.tattoo.title = { hex: "#112233", opacity: 1 };
  profile.nodes.tattoo.signatureMark = { mode: "custom", color: { hex: "#334455", opacity: 1 } };
  let response = await handleAdminEmailDesign(new Request(`${base}/draft`, {
    method: "PUT", headers, body: JSON.stringify({ profile, baseRevision: 0 }),
  }), env);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.draft.revision, 1);

  response = await handleAdminEmailDesign(new Request(`${base}/draft`, {
    method: "PUT", headers, body: JSON.stringify({ profile, baseRevision: 0 }),
  }), env);
  assert.equal(response.status, 409);

  const invalid = structuredClone(profile);
  invalid.global.panel.opacity = 0.5;
  response = await handleAdminEmailDesign(new Request(`${base}/draft`, {
    method: "PUT", headers, body: JSON.stringify({ profile: invalid, baseRevision: 1 }),
  }), env);
  assert.equal(response.status, 422);

  response = await handleAdminEmailDesign(new Request(`${base}/preview`, {
    method: "POST", headers, body: JSON.stringify({ profile, scope: "global" }),
  }), env);
  assert.equal(response.status, 200);
  const globalPreview = await response.json();
  assert.equal(globalPreview.previews.length, 4);
  assert.match(globalPreview.previews.find((item) => item.node === "tattoo").html, /color:#112233/);
  assert.match(globalPreview.previews.find((item) => item.node === "tattoo").html, /color:#334455/);
  assert.match(globalPreview.previews.find((item) => item.node === "art").html, /color:#AABBCC/);
  assert.match(globalPreview.previews.find((item) => item.node === "art").html, /<td height="5" bgcolor="#0039BD"[^>]*background-image:linear-gradient\(#0039BD,#0039BD\)!important/);

  response = await handleAdminEmailDesign(new Request(`${base}/preview`, {
    method: "POST", headers, body: JSON.stringify({ profile, scope: "tattoo" }),
  }), env);
  assert.equal((await response.json()).previews.length, 1);

  response = await handleAdminEmailDesign(new Request(`${base}/test`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1, scope: "global" }),
  }), env);
  assert.equal(response.status, 200);
  const testBatch = await response.json();
  assert.equal(testBatch.deliveries.length, 4);
  assert.equal(sent.length, 4);
  assert.deepEqual(sent.map((message) => message.subject.match(/^\[DESIGN TEST\]\[([^\]]+)\]/)?.[1]), ["TATTOO", "ART", "EVENTS", "STUDIO"]);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM notification_deliveries WHERE related_type='email_design_test' AND email_design_revision=1",
  ).get().count, 4);

  response = await handleAdminEmailDesign(new Request(`${base}/publish`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).published.revision, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_design_revisions WHERE status='published'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_design_revisions WHERE status='draft'").get().count, 0);

  const delivery = await notifySubmissionReceived(env, {
    id: "published-design-submission",
    type: "tattoo_inquiry",
    contact_name: "Designed Client",
    contact_email: "designed@example.test",
    payload_json: JSON.stringify({}),
  });
  assert.equal(delivery.ok, true);
  assert.match(sent.at(-1).html, /color:#112233/);
  const normalAudit = database.prepare(
    "SELECT template_revision,email_design_revision FROM notification_deliveries WHERE related_id='published-design-submission' AND template_key='submission_received'",
  ).get();
  assert.equal(normalAudit.template_revision, 0);
  assert.equal(normalAudit.email_design_revision, 1);

  const templateBase = "https://example.test/api/admin/notifications/templates/appointment_confirmed";
  const templateInitial = await (await handleAdminEmailTemplates(new Request(`${templateBase}?variant=tattoo`, { headers }), env)).json();
  response = await handleAdminEmailTemplates(new Request(`${templateBase}/draft?variant=tattoo`, {
    method: "PUT", headers, body: JSON.stringify({ baseRevision: 0, content: templateInitial.defaultContent }),
  }), env);
  assert.equal(response.status, 200);
  response = await handleAdminEmailTemplates(new Request(`${templateBase}/test?variant=tattoo`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1 }),
  }), env);
  assert.equal(response.status, 200);
  assert.match(sent.at(-1).html, /color:#112233/);
  const copyTestAudit = database.prepare(
    "SELECT template_revision,email_design_revision FROM notification_deliveries WHERE related_type='email_template_test'",
  ).get();
  assert.equal(copyTestAudit.template_revision, 1);
  assert.equal(copyTestAudit.email_design_revision, 1);

  response = await handleAdminEmailDesign(new Request(`${base}/restore`, {
    method: "POST", headers, body: JSON.stringify({ revision: 1, baseRevision: 1 }),
  }), env);
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.equal(restored.draft.revision, 2);
  assert.deepEqual(restored.draft.profile, profile);
  response = await handleAdminEmailDesign(new Request(`${base}/publish`, {
    method: "POST", headers, body: JSON.stringify({ revision: 2 }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_design_revisions WHERE status='published'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_design_revisions WHERE status='retired'").get().count, 1);
});

test("Studio creates the email design store from repository defaults when migration 0092 is pending", async () => {
  const database = migratedDatabase({ before: "0092_email_design_editor.sql" });
  const token = "email-design-bootstrap-admin";
  const env = { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: token };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://example.test/api/admin/notifications/design";
  const initial = await (await handleAdminEmailDesign(new Request(base, { headers }), env)).json();
  assert.equal(initial.draft, null);
  assert.equal(initial.published, null);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_design_revisions'").get(), undefined);
  const response = await handleAdminEmailDesign(new Request(`${base}/draft`, {
    method: "PUT", headers, body: JSON.stringify({ profile: initial.defaultProfile, baseRevision: 0 }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.revision, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_design_revisions").get().count, 1);
});

test("Studio email editor exposes batch design roles, inheritance, revision actions, and responsive preview controls", () => {
  const script = readFileSync(join(ROOT, "studio", "email-preview.js"), "utf8");
  const styles = readFileSync(join(ROOT, "studio", "email-preview.css"), "utf8");
  assert.match(script, /Design System/);
  assert.match(script, /Save Batch Draft/);
  assert.match(script, /Send Batch Test/);
  assert.match(script, /Publish Batch/);
  assert.match(script, /Use global/);
  assert.match(script, /Ending-signature mark/);
  assert.match(script, /Node accents remain code-owned/);
  assert.match(script, /\/api\/admin\/notifications\/design\/(preview|draft|test|publish|history|restore)/);
  assert.match(styles, /\.email-design-role/);
  assert.match(styles, /\.email-design-preview-card/);
  assert.match(styles, /@media \(max-width: 760px\)/);
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

test("published Tattoo Special request copy stays independent from Special Project correspondence", async () => {
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
  content.headline = "Your {{submission_label}} is now in the dedicated Studio review queue.";
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
    payload_json: JSON.stringify({
      booking_mode: "review",
      offer_id: "special-anime",
      held_start_at: "2026-08-15T17:00:00.000Z",
      held_end_at: "2026-08-15T19:00:00.000Z",
    }),
  });
  await notifySubmissionReceived(env, {
    id: "ordinary-special-project-receipt",
    type: "special_project",
    contact_name: "Project Client",
    contact_email: "project@example.test",
    payload_json: JSON.stringify({}),
  });
  assert.match(sent[0].html, /request is now in the dedicated Studio review queue/);
  assert.match(sent[0].html, /Requested time \(held\)/i);
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
    dob: "1990-01-01",
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

  assert.equal((await saveReviewedTattooPlan(env, firstId, adminToken)).status, 200);
  assert.equal((await saveReviewedTattooPlan(env, secondId, adminToken)).status, 200);
  const firstApproval = await decideSubmission(env, firstId, adminToken, "approve");
  assert.equal(firstApproval.status, 200);
  assert.equal(database.prepare("SELECT reserved_submission_id FROM flash_items WHERE id = ?").get(flash.id).reserved_submission_id, firstId);

  const competingApproval = await decideSubmission(env, secondId, adminToken, "approve");
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
    dob: "1990-01-01",
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

  assert.equal((await saveReviewedTattooPlan(env, firstId, adminToken)).status, 200);
  assert.equal((await saveReviewedTattooPlan(env, secondId, adminToken)).status, 200);
  assert.equal((await saveReviewedTattooPlan(env, conflictId, adminToken)).status, 200);
  let response = await decideSubmission(env, firstId, adminToken, "approve", {
    approved_sheet_design_ids: [designs[0].id],
  });
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

  response = await decideSubmission(env, firstId, adminToken, "reopen");
  assert.equal(response.status, 200, await response.clone().text());
  response = await decideSubmission(env, firstId, adminToken, "decline");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(database.prepare("SELECT state FROM flash_sheet_designs WHERE id=?").get(designs[0].id).state, "available");

  response = await decideSubmission(env, secondId, adminToken, "approve", {
    approved_sheet_design_ids: [designs[1].id, designs[2].id],
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));

  response = await decideSubmission(env, conflictId, adminToken, "approve", {
    approved_sheet_design_ids: [designs[0].id, designs[2].id],
  });
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
    dob: "1990-01-01",
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
  assert.match(worker, /handleAdminDeleteAppointment/);
  assert.match(worker, /appointmentDeleteMatch/);
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
  assert.match(submissionsStudio, /data-delete-appointment/);
  assert.match(submissionsStudio, /Permanently Delete Appointment/);
  assert.match(submissionsStudio, /Additional Renderings/);
  assert.match(submissionsStudio, /data-create-rendering-request/);
  assert.match(submissionsStudio, /data-copy-rendering-link/);
  assert.match(submissionsStudio, /data-resend-rendering-request/);
  assert.match(submissionsStudio, /data-cancel-rendering-request/);
  assert.match(submissionsStudio, /data-force-delete="1"/);
  assert.match(submissionsStudio, /data-decision-action="approve"/);
  assert.match(submissionsStudio, /\/decision-notification/);
  assert.match(worker, /handleSubmissionDecision/);
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
    dob: "1990-01-01",
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
      dob: "1990-01-01",
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
