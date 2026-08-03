import {
  notifyAdminAppointmentConfirmed,
  notifyAdminAppointmentRescheduled,
  notifyAppointmentCancelled,
  notifyAppointmentConfirmed,
  notifyAppointmentRescheduled,
  notifyAdminSubmissionReceived,
  notifySubmissionReceived,
  notifyTattooRenderingPaymentConfirmed,
  notifyTattooRenderingPaymentRequested,
} from "../notifications/_lib.js";
import { ingestCrmSourceRecord } from "../crm/ingest.js";
import { captureMarketingConsent } from "../outreach/_lib.js";
import {
  reviewedTattooBudgetIsComplete as reviewedBudgetIsComplete,
  tattooPricingSummary as pricingSummaryForAppointment,
} from "./_pricing.js";

const BOOKING_STATUSES = new Set([
  "pending_deposit",
  "deposit_pending",
  "confirmed",
  "completed",
  "cancelled",
  "archived",
]);

const BOOKING_TOKEN_PURPOSES = new Set(["consultation", "tattoo"]);
const APPOINTMENT_PURPOSES = new Set([
  "tattoo",
  "prerequisite_consultation",
  "standalone_consultation",
  "build_session",
  "studio",
]);
const TATTOO_STAGES = new Set([
  "review",
  "consultation_required",
  "consultation_scheduled",
  "consultation_complete",
  "ready_to_book",
  "tattoo_scheduled",
  "closed",
]);
const CAPACITY_BLOCKING_STATUSES = ["pending_deposit", "deposit_pending", "confirmed"];
const HOLD_DURATION_MS = 30 * 60 * 1000;
const RESCHEDULE_CUTOFF_HOURS = 48;

const PUBLIC_CONSULTATION_BOOKING_TYPE_IDS = ["consult_in_person", "consult_virtual"];
const PUBLIC_SESSION_BOOKING_TYPE_IDS = [...PUBLIC_CONSULTATION_BOOKING_TYPE_IDS, "build_in_person"];
const VIRTUAL_CONSULTATION_BOOKING_TYPE_ID = "consult_virtual";

// Studio bookings (open visits / private gatherings / external rentals) are
// deposit-based and route to a dedicated Square location, but otherwise reuse
// the tattoo deposit appointment pipeline.
const ART_VISIT_BOOKING_TYPE_IDS = ["studio_visit"];
const STUDIO_SPACE_BOOKING_TYPE_IDS = ["studio_gathering", "studio_rental"];
const STUDIO_BOOKING_TYPE_IDS = [...ART_VISIT_BOOKING_TYPE_IDS, ...STUDIO_SPACE_BOOKING_TYPE_IDS];

const SCHEDULE_CATEGORY_BOOKING_TYPE_IDS = {
  tattooing: ["tattoo_quarter", "tattoo_half", "tattoo_full", "tattoo_extended"],
  consultation: ["consult_in_person", "consult_virtual", "build_in_person"],
  art_visit: ART_VISIT_BOOKING_TYPE_IDS,
  studio_space: STUDIO_SPACE_BOOKING_TYPE_IDS,
  // During deployment, legacy rows represent the Studio Visit schedule only.
  studio: ART_VISIT_BOOKING_TYPE_IDS,
};
const TATTOO_DAY_SESSION_LABELS = Object.freeze({
  tattoo_quarter: "Quarter Day Session",
  tattoo_half: "Half Day Session",
  tattoo_full: "Full Day Session",
  tattoo_extended: "Extended Day Session",
});
const EXTENDED_DAY_BOOKING_TYPE_ID = "tattoo_extended";

// Consultation and build-session bookings charge their full fee up front, not a deposit toward a future session.
const FULL_PAYMENT_BOOKING_TYPE_IDS = ["consult_in_person", "consult_virtual", "build_in_person"];
const TATTOO_PROJECT_SUBMISSION_TYPES = new Set(["tattoo_inquiry", "flash_claim", "build_brief", "build_your_own", "byo", "maze_design", "special_project", "tattoo_special"]);
const ORIGINAL_TATTOO_PROJECT_SUBMISSION_TYPES = new Set(["tattoo_inquiry", "build_brief", "build_your_own", "byo", "maze_design", "special_project", "tattoo_special"]);
const TATTOO_RENDERING_FEE_CENTS = 5000;
const TATTOO_RENDERING_CURRENCY = "USD";
const SPLIT_POLICIES = new Set(["artist_review", "required", "client_choice", "not_available"]);
const CLIENT_SESSION_PREFERENCES = new Set(["studio_plan", "one_longer_session", "multiple_shorter_sessions"]);

const CONFIRMATION_PATHS = {
  consult_in_person: "/booking/confirmed/consultation/",
  consult_virtual: "/booking/confirmed/virtual-consultation/",
  build_in_person: "/booking/confirmed/build/",
  studio_visit: "/booking/confirmed/studio/",
  studio_gathering: "/booking/confirmed/studio/",
  studio_rental: "/booking/confirmed/studio/",
};

function confirmationPathForBookingType(bookingTypeId) {
  return CONFIRMATION_PATHS[bookingTypeId] || "/booking/confirmed/";
}

const DEFAULT_SUPPORT_EMAIL = "saisolehman@artpilltattoohouse.com";
const DEFAULT_STUDIO_CALENDAR_LOCATION = "364 Nelson Street SW, Atlanta, GA 30313";
const DEFAULT_STUDIO_CONTACT_PHONE = "(770) 820-5800";
const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";
const DEFAULT_SESSION_ESTIMATE_COPY = Object.freeze({
  sectionHeading: "Your Session Plan",
  oneSessionLabel: "Session Plan",
  multipleSessionsLabel: "Session Plan",
  artistReviewLabel: "Plan in progress",
  fallbackNote: "Based on the current design, placement, and level of detail, this is the session format I recommend. We’ll continue to adjust around your comfort, skin response, and the natural pace of the work.",
  requiredPolicy: "This project is best completed across multiple sessions so the work can progress at a comfortable, considered pace.",
  notAvailablePolicy: "This is my recommended session plan. If you have any questions, reach out to me directly: 7708205800",
  clientChoicePolicy: "This is my recommended session plan. Choose the option that feels like the best fit. If you have any questions, reach out to me directly: 7708205800",
  artistReviewPolicy: "I’m still reviewing the best session format for this project. I’ll confirm the plan before scheduling.",
  studioPlanLabel: "Use the recommended plan",
  studioPlanDescription: "Schedule using the pacing outlined above.",
  oneLongerSessionLabel: "Ask about one longer session",
  oneLongerSessionDescription: "I’ll confirm whether the design and available appointment time make this a good fit.",
  multipleShorterSessionsLabel: "Ask about shorter sessions",
  multipleShorterSessionsDescription: "Spread the work across shorter appointments.",
  acceptRequiredLabel: "Continue with this plan",
  acceptRequiredDescription: "Choose a date for the recommended session.",
  continuePlanLabel: "Continue with this plan",
  continuePlanDescription: "Choose a date for the recommended session.",
  savedMessage: "Your preference is saved: {{preference}}. You can update it before booking.",
  acknowledgement: "I’ve reviewed the estimated session time and understand that the final timing may adjust as the work progresses.",
  confirmButtonLabel: "Continue to Scheduling",
});
const SUPERSEDED_SESSION_ESTIMATE_COPY = Object.freeze({
  oneSessionLabel: "One-session plan",
  multipleSessionsLabel: "Multi-session plan",
  notAvailablePolicy: "I’ve included my recommended pacing below. If you have any questions, reach out to me directly: 7708205800",
  clientChoicePolicy: "I’ve included my recommended pacing below. Choose the option that feels like the best fit. If you have any questions reach out to me directly : 7708205800",
});
const LEGACY_SESSION_ESTIMATE_COPY = Object.freeze({
  sectionHeading: "Your Session Estimate",
  oneSessionLabel: "One session",
  multipleSessionsLabel: "Multiple sessions",
  artistReviewLabel: "Artist review",
  fallbackNote: "Your estimate is based on the approved design, placement, and studio process.",
  requiredPolicy: "This tattoo will have to be completed across multiple sessions.",
  notAvailablePolicy: "This tattoo will be completed in one session; splitting is not available for this project.",
  clientChoicePolicy: "The studio has provided its recommendation, but you may choose how you would prefer to pace the work.",
  artistReviewPolicy: "The artist is still reviewing the final session structure.",
  studioPlanLabel: "Follow the studio recommendation",
  studioPlanDescription: "Use the pacing shown in the estimate.",
  oneLongerSessionLabel: "Request one longer session",
  oneLongerSessionDescription: "The studio will confirm whether the work and your appointment window allow it.",
  multipleShorterSessionsLabel: "Request multiple shorter sessions",
  multipleShorterSessionsDescription: "Complete the work across shorter appointments.",
  acceptRequiredLabel: "Accept the required session structure",
  acceptRequiredDescription: "This structure is part of the approved process.",
  continuePlanLabel: "Continue with the studio plan",
  continuePlanDescription: "The studio will confirm the final pacing.",
  savedMessage: "Saved: {{preference}}. You may update this choice before booking.",
  acknowledgement: "I have reviewed the estimated time and session structure. I understand the final pace can change with placement, detail, skin response, breaks, and my comfort during the appointment.",
  confirmButtonLabel: "Confirm Session Plan",
});

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
    status: init.status || 200,
  });
}

function errorResponse(message, status = 400, extras = {}) {
  return json({ error: message, ...extras }, { status });
}

function bookingDb(env) {
  return env.SUBMISSIONS_DB || null;
}

function requireBookingDb(env) {
  const db = bookingDb(env);
  if (!db) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return db;
}

function asString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function asOptionalString(value) {
  const normalized = asString(value);
  return normalized || null;
}

function asPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

function parseTipCents(value) {
  if (value === undefined || value === null || value === "") return { tipCents: 0 };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { error: "Tip must be a whole dollar-and-cent amount." };
  }
  if (parsed < 0) return { error: "Tip cannot be negative." };
  if (parsed > 50000) return { error: "Tip cannot be more than $500." };
  return { tipCents: parsed };
}

function parseDepositCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { error: "Deposit must be a whole dollar-and-cent amount." };
  }
  if (parsed < 0) return { error: "Deposit cannot be negative." };
  if (parsed > 1000000) return { error: "Deposit cannot be more than $10,000." };
  return { depositCents: parsed };
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeBookingType(row) {
  const durationMinutes = Number(row.duration_minutes ?? row.durationMinutes ?? 0);
  return {
    id: row.id,
    venture: row.venture,
    label: TATTOO_DAY_SESSION_LABELS[row.id] || row.label,
    description: row.description || "",
    durationMinutes,
    depositCents: row.deposit_cents,
    depositLabel: formatMoney(row.deposit_cents, row.currency || "USD"),
    currency: row.currency || "USD",
    active: Boolean(row.active),
    sortOrder: row.sort_order || 0,
    sessionFeeCents: Number(row.session_fee_cents ?? row.sessionFeeCents ?? 0),
    sessionFeeLabel: formatMoney(Number(row.session_fee_cents ?? row.sessionFeeCents ?? 0), row.currency || "USD"),
    durationRangeLabel: row.id === EXTENDED_DAY_BOOKING_TYPE_ID
      ? "8-10 hours"
      : formatDurationLabel(durationMinutes),
  };
}

function formatDurationLabel(minutes) {
  const total = Number(minutes || 0);
  if (!total) return "";
  if (total % 60 === 0) {
    const hours = total / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder} minutes`;
}

function normalizeWindow(row) {
  return {
    id: row.id,
    venture: row.venture,
    bookingTypeId: row.booking_type_id || "",
    startAt: row.start_at,
    endAt: row.end_at,
    capacity: row.capacity,
    bufferBeforeMinutes: row.buffer_before_minutes || 0,
    bufferAfterMinutes: row.buffer_after_minutes || 0,
    isBlackout: Boolean(row.is_blackout),
    active: Boolean(row.active),
    note: row.note || "",
  };
}

function normalizeWalkInWindow(row) {
  return {
    id: row.id,
    venture: row.venture || "tattooing",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    title: row.title || "Walk-in Window",
    note: row.note || "",
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMeeting(row) {
  if (!row || !row.meeting_provider) return null;
  return {
    provider: row.meeting_provider,
    providerMeetingId: row.provider_meeting_id || "",
    joinUrl: row.meeting_join_url || "",
    password: row.meeting_password || "",
    createdAt: row.meeting_created_at || "",
    updatedAt: row.meeting_updated_at || "",
  };
}

function normalizeSettings(row) {
  return {
    venture: row.venture,
    timezone: row.timezone || "America/New_York",
    bookingHorizonDays: row.booking_horizon_days,
    minimumNoticeHours: row.minimum_notice_hours,
    slotIntervalMinutes: row.slot_interval_minutes,
    maxBookingsPerDay: row.max_bookings_per_day,
    defaultCapacity: row.default_capacity,
    defaultBufferBeforeMinutes: row.default_buffer_before_minutes,
    defaultBufferAfterMinutes: row.default_buffer_after_minutes,
  };
}

function normalizeRule(row) {
  return {
    id: row.id,
    venture: row.venture,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    active: Boolean(row.active),
    capacity: row.capacity,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    note: row.note || "",
    category: row.category || "tattooing",
  };
}

function normalizeAppointment(row) {
  const bookingTypeId = row.booking_type_id || row.bookingTypeId || "";
  return {
    id: row.id,
    submissionId: row.submission_id || "",
    bookingTokenId: row.booking_token_id || "",
    bookingTypeId,
    bookingTypeLabel: TATTOO_DAY_SESSION_LABELS[bookingTypeId] || row.booking_type_label || row.bookingTypeLabel || "",
    submissionType: row.submission_type || row.submissionType || "",
    isTattooSpecial: (row.submission_type || row.submissionType) === "tattoo_special",
    specialOfferTitle: row.special_offer_title || row.specialOfferTitle || "",
    specialVariantLabel: row.special_variant_label || row.specialVariantLabel || "",
    availabilityWindowId: row.availability_window_id || "",
    status: row.status,
    purpose: row.purpose || purposeForBookingType(row.booking_type_id, Boolean(row.booking_token_id)),
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone || "",
    startAt: row.start_at,
    endAt: row.end_at,
    depositCents: row.deposit_cents,
    tipCents: row.tip_cents || 0,
    totalDueCents: row.deposit_cents + (row.tip_cents || 0),
    sessionFeeCents: Number(row.session_fee_cents || 0),
    extendedDayAcknowledgedAt: row.extended_day_acknowledged_at || "",
    currency: row.currency || "USD",
    squareOrderId: row.square_order_id || "",
    squarePaymentLinkId: row.square_payment_link_id || "",
    squareCheckoutUrl: row.square_checkout_url || "",
    holdExpiresAt: row.hold_expires_at || "",
    holdState: row.hold_state || "",
    approvalState: row.approval_state || "not_required",
    approvalDecidedAt: row.approval_decided_at || "",
    paymentDueAt: row.payment_due_at || "",
    holdReconciledAt: row.hold_reconciled_at || "",
    completedAt: row.completed_at || "",
    completionNote: row.completion_note || "",
    replacementForAppointmentId: row.replacement_for_appointment_id || "",
    replacedByAppointmentId: row.replaced_by_appointment_id || "",
    rescheduleCount: Number(row.reschedule_count || 0),
    rescheduledAt: row.rescheduled_at || "",
    originalStartAt: row.original_start_at || "",
    originalEndAt: row.original_end_at || "",
    cancelledAt: row.cancelled_at || "",
    cancellationReason: row.cancellation_reason || "",
    canPermanentlyDelete: Boolean(row.can_permanently_delete),
    meeting: normalizeMeeting(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function purposeForBookingType(bookingTypeId, prerequisite = false) {
  if (STUDIO_BOOKING_TYPE_IDS.includes(bookingTypeId)) return "studio";
  if (bookingTypeId === "build_in_person") return "build_session";
  if (["consult_in_person", "consult_virtual"].includes(bookingTypeId)) {
    return prerequisite ? "prerequisite_consultation" : "standalone_consultation";
  }
  return "tattoo";
}

function bookingTypesMatchPurpose(purpose, bookingTypeIds) {
  const ids = (bookingTypeIds || []).filter(Boolean);
  if (!ids.length) return false;
  if (purpose === "consultation") {
    return ids.length === 1 && ids[0] === "consult_in_person";
  }
  if (purpose === "tattoo") {
    return ids.every((id) => isTattooingBookingType(id));
  }
  return false;
}

function pacingOptionsForBookingTypeIds(bookingTypeIds) {
  const ids = new Set((bookingTypeIds || []).filter(Boolean));
  return {
    longer: ids.has("tattoo_full") || ids.has(EXTENDED_DAY_BOOKING_TYPE_ID),
    shorter: ids.has("tattoo_quarter") || ids.has("tattoo_half"),
  };
}

function isTattooSpecialBookingType(id) {
  return String(id || "").startsWith("tattoo_special_");
}

function isTattooingBookingType(id) {
  return SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing.includes(id) || isTattooSpecialBookingType(id);
}

function holdExpiryFromNow(cutoff = "") {
  const normalExpiry = Date.now() + HOLD_DURATION_MS;
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : Number.POSITIVE_INFINITY;
  return new Date(Math.min(normalExpiry, Number.isFinite(cutoffMs) ? cutoffMs : normalExpiry)).toISOString();
}

function approvalHoldExpiry(cutoff = "") {
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : Number.NaN;
  const fallback = Date.now() + 24 * 60 * 60 * 1000;
  return new Date(Number.isFinite(cutoffMs) && cutoffMs > Date.now() ? cutoffMs : fallback).toISOString();
}

function availabilityScopeFromRequest(request) {
  const scope = new URL(request.url).searchParams.get("scope") || "";
  if (scope === "art") {
    return {
      scope,
      bookingTypeIds: ART_VISIT_BOOKING_TYPE_IDS,
      includeUnscoped: false,
    };
  }
  if (scope === "studio") {
    return {
      scope,
      bookingTypeIds: STUDIO_SPACE_BOOKING_TYPE_IDS,
      includeUnscoped: false,
    };
  }
  if (scope === "tattoo") {
    return {
      scope,
      bookingTypeIds: [
        ...SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing,
        ...SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.consultation,
      ],
      includeUnscoped: true,
    };
  }
  return {
    scope: "all",
    bookingTypeIds: [],
    includeUnscoped: true,
  };
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function intervalWithBuffer(row) {
  const start = new Date(row.start_at).getTime() - Number(row.buffer_before_minutes || 0) * 60 * 1000;
  const end = new Date(row.end_at).getTime() + Number(row.buffer_after_minutes || 0) * 60 * 1000;
  return { start, end };
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isBlockedByBlackout(windowRow, blackoutRows) {
  const windowInterval = intervalWithBuffer(windowRow);
  return blackoutRows.some((blackout) => intervalsOverlap(windowInterval, intervalWithBuffer(blackout)));
}

function overlappingAppointmentCount(windowRow, appointmentRows) {
  const windowInterval = intervalWithBuffer(windowRow);
  return appointmentRows.filter((appointment) =>
    intervalsOverlap(windowInterval, intervalWithBuffer(appointment))
  ).length;
}

function isExclusiveTattooBookingType(bookingTypeId) {
  return SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing.includes(bookingTypeId)
    || isTattooSpecialBookingType(bookingTypeId);
}

function hasSlotCapacity(windowRow, appointmentRows, candidateBookingTypeId = "") {
  const overlapCount = overlappingAppointmentCount(windowRow, appointmentRows);
  const bookingTypeId = candidateBookingTypeId || windowRow.booking_type_id || windowRow.bookingTypeId || "";
  return isExclusiveTattooBookingType(bookingTypeId)
    ? overlapCount === 0
    : overlapCount < Number(windowRow.capacity || 1);
}

function datePartsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    dayOfWeek: dayMap[value.weekday],
  };
}

function parseTime(value) {
  const [hour = 0, minute = 0] = String(value || "00:00").split(":").map(Number);
  return { hour, minute };
}

function isValidTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function minutesFromTime(value) {
  const { hour, minute } = parseTime(value);
  return hour * 60 + minute;
}

function zonedLocalToUtcIso(timezone, year, month, day, hour, minute) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMinutes = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day),
    Number(local.hour),
    Number(local.minute)
  );
  const desiredMinutes = Date.UTC(year, month - 1, day, hour, minute);
  const offset = localMinutes - desiredMinutes;
  return new Date(utcGuess - offset).toISOString();
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

function directInviteSessionNote(bookingTypeId) {
  const label = TATTOO_DAY_SESSION_LABELS[bookingTypeId] || "selected session";
  return `The composition is planned for a ${label}.`;
}

function normalizeSessionEstimateCopy(value) {
  const parsed = typeof value === "string" ? parseJsonField(value, {}) : value;
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SESSION_ESTIMATE_COPY).map(([key, fallback]) => [
      key,
      asString(source[key])
        && asString(source[key]) !== LEGACY_SESSION_ESTIMATE_COPY[key]
        && asString(source[key]) !== SUPERSEDED_SESSION_ESTIMATE_COPY[key]
        ? asString(source[key])
        : fallback,
    ]),
  );
}

async function loadSessionEstimateCopy(db) {
  const row = await db.prepare(
    "SELECT session_estimate_copy_json FROM tattoo_settings WHERE id = 'default'"
  ).first();
  return normalizeSessionEstimateCopy(row?.session_estimate_copy_json);
}

async function bookingDayGuardForWindow(db, windowId) {
  const row = await db.prepare(
    `SELECT aw.start_at, aw.venture,
            COALESCE(bs.timezone, ?) AS timezone,
            COALESCE(bs.max_bookings_per_day, 999999) AS max_bookings_per_day
     FROM availability_windows aw
     LEFT JOIN booking_settings bs ON bs.venture = aw.venture
     WHERE aw.id = ?`
  ).bind(DEFAULT_CALENDAR_TIME_ZONE, windowId).first();
  if (!row) return null;
  const local = datePartsInZone(new Date(row.start_at), row.timezone);
  const following = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return {
    startAt: zonedLocalToUtcIso(row.timezone, local.year, local.month, local.day, 0, 0),
    endAt: zonedLocalToUtcIso(
      row.timezone,
      following.getUTCFullYear(),
      following.getUTCMonth() + 1,
      following.getUTCDate(),
      0,
      0,
    ),
    maxBookingsPerDay: Math.max(1, Number(row.max_bookings_per_day || 999999)),
  };
}

function crmNodeForAppointment(appointment) {
  if (appointment.bookingTypeId === "studio_visit") return "node-art";
  if (["studio_gathering", "studio_rental"].includes(appointment.bookingTypeId)) {
    return "node-events";
  }
  return appointment.purpose === "studio" ? "node-events" : "node-tattoos";
}

async function mirrorAppointmentToCrm(database, appointmentValue, { includePayment = false } = {}) {
  if (!appointmentValue?.id) return { status: "skipped", reason: "source_required" };
  const appointment = appointmentValue.start_at !== undefined
    ? normalizeAppointment(appointmentValue)
    : appointmentValue;
  const nodeId = crmNodeForAppointment(appointment);
  let transaction = null;
  let profile = {};

  try {
    if (appointment.submissionId) {
      const submission = await database.prepare(
        "SELECT contact_json,payload_json FROM submissions WHERE id=?"
      ).bind(appointment.submissionId).first();
      const contact = parseJsonField(submission?.contact_json, {});
      const payload = parseJsonField(submission?.payload_json, {});
      profile = {
        preferredName: contact.preferredName || contact.preferred_name
          || payload.preferredName || payload.preferred_name,
        pronouns: contact.pronouns || payload.pronouns,
        instagram: contact.instagram || payload.instagram,
        preferredContactMethod: contact.preferredContactMethod || contact.preferred_contact_method
          || payload.preferredContactMethod || payload.preferred_contact_method,
        referralSource: contact.referralSource || contact.referral_source
          || payload.referralSource || payload.referral_source,
      };
    }
    if (includePayment) {
      const payment = await database.prepare(
        `SELECT * FROM deposit_payments
         WHERE appointment_id=?
         ORDER BY created_at DESC,id DESC
         LIMIT 1`
      ).bind(appointment.id).first();
      if (payment) {
        const paymentStatus = String(payment.status || "").toLowerCase();
        transaction = {
          sourceProvider: "local",
          sourceType: "deposit_payment",
          sourceId: payment.id,
          nodeId,
          transactionType: "charge",
          status: ["paid", "completed", "settled", "payment_attention"].includes(paymentStatus)
            ? "settled"
            : paymentStatus === "failed"
              ? "failed"
              : paymentStatus === "cancelled" || paymentStatus === "void"
                ? "void"
                : "pending",
          amountCents: payment.amount_cents,
          tipCents: payment.tip_cents,
          currency: payment.currency,
          occurredAt: payment.updated_at || payment.created_at,
          externalOrderId: payment.provider_order_id,
          metadata: {
            appointmentId: appointment.id,
            provider: payment.provider || "square",
            providerPaymentId: payment.provider_payment_id || "",
          },
        };
      }
    }

    return await ingestCrmSourceRecord(database, {
      contact: {
        displayName: appointment.clientName,
        email: appointment.clientEmail,
        phone: appointment.clientPhone,
        ...profile,
      },
      interaction: {
        sourceProvider: "local",
        sourceType: "appointment",
        sourceId: appointment.id,
        nodeId,
        channel: "website",
        interactionType: "appointment",
        label: appointment.bookingTypeLabel || appointment.bookingTypeId || appointment.purpose,
        status: appointment.status,
        occurredAt: appointment.startAt || appointment.createdAt,
        metadata: {
          appointmentId: appointment.id,
          submissionId: appointment.submissionId || "",
          bookingTypeId: appointment.bookingTypeId || "",
          purpose: appointment.purpose || "",
          startAt: appointment.startAt || "",
          endAt: appointment.endAt || "",
        },
      },
      transaction,
    });
  } catch (error) {
    // Booking remains the source of truth. The owner-only CRM backfill can
    // reconcile the appointment if live mirroring is temporarily unavailable.
    console.warn(JSON.stringify({
      event: "crm.live_mirror_failed",
      sourceType: "appointment",
      sourceId: String(appointment.id),
      errorName: error?.name || "Error",
    }));
    return { status: "skipped", reason: "ingest_failed" };
  }
}

function generatedWindowPolicyVersion(rule, settings, bookingType) {
  const source = JSON.stringify([
    Number(rule.day_of_week),
    rule.start_time,
    rule.end_time,
    rule.category || "tattooing",
    Number(rule.capacity || settings.defaultCapacity),
    Number(rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes),
    Number(rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes),
    Number(settings.slotIntervalMinutes || 30),
    Number(bookingType.duration_minutes || bookingType.durationMinutes),
  ]);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedWindowId(ruleId, bookingTypeId, startAt, policyVersion) {
  return `gen:${ruleId}:${bookingTypeId}:${new Date(startAt).getTime()}:${policyVersion}`;
}

function parseGeneratedWindowId(id) {
  const parts = String(id || "").split(":");
  if (![4, 5].includes(parts.length) || parts[0] !== "gen") return null;
  return {
    ruleId: parts[1],
    bookingTypeId: parts[2],
    startMs: Number(parts[3]),
    policyVersion: parts[4] || "",
  };
}

function authTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token") || "";
}

function requireAdmin(request, env) {
  const expectedToken = env.SUBMISSIONS_ADMIN_TOKEN;
  if (!expectedToken) return errorResponse("Admin booking is not configured.", 503);
  if (authTokenFromRequest(request) !== expectedToken) {
    return errorResponse("Unauthorized.", 401);
  }
  return null;
}

function baseUrlFromRequest(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function publicBaseUrl(env, request) {
  if (env.PUBLIC_SITE_URL) return String(env.PUBLIC_SITE_URL).replace(/\/+$/g, "");
  return baseUrlFromRequest(request);
}

function publicUrl(env, request, path) {
  return `${publicBaseUrl(env, request)}${path}`;
}

function studioCalendarLocation(env) {
  return asString(env.STUDIO_CALENDAR_LOCATION) || DEFAULT_STUDIO_CALENDAR_LOCATION;
}

function studioContactPhone(env) {
  return asString(env.STUDIO_CONTACT_PHONE) || DEFAULT_STUDIO_CONTACT_PHONE;
}

function studioContactEmail(env) {
  return asString(env.NOTIFICATION_REPLY_TO) || DEFAULT_SUPPORT_EMAIL;
}

function appointmentConfirmationUrl(env, request, appointment) {
  const path = confirmationPathForBookingType(appointment.bookingTypeId || appointment.booking_type_id);
  return `${publicBaseUrl(env, request)}${path}?appointment=${encodeURIComponent(appointment.id)}`;
}

function appointmentCalendarUrl(env, request, appointment) {
  return `${publicBaseUrl(env, request)}/api/booking/calendar?appointment=${encodeURIComponent(appointment.id)}`;
}

function isVirtualAppointment(appointment) {
  return (appointment.bookingTypeId || appointment.booking_type_id) === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID;
}

function icsDate(value) {
  const date = new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsLocalDate(value, timeZone = DEFAULT_CALENDAR_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}T${map.hour}${map.minute}${map.second}`;
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line) {
  const parts = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function icsProperty(name, value) {
  return foldIcsLine(`${name}:${icsEscape(value)}`);
}

function appointmentResourceUrls(env, request) {
  return {
    bookingTermsUrl: publicUrl(env, request, "/tattoos/policies/"),
    dayOfInstructionsUrl: publicUrl(env, request, "/tattoos/day-of/"),
    locationParkingUrl: publicUrl(env, request, "/tattoos/location-parking/"),
  };
}

function appointmentCalendarDescription(env, request, appointment) {
  const resources = appointmentResourceUrls(env, request);
  const virtual = isVirtualAppointment(appointment);
  const lines = [
    "Point of contact: art.pill TATTOO HOUSE",
    `Email: ${studioContactEmail(env)}`,
    `Phone: ${studioContactPhone(env)}`,
    "",
    `Manage / cancel / reschedule: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    `Booking policies: ${resources.bookingTermsUrl}`,
  ];

  if (virtual) {
    lines.push(`Zoom link: ${appointment.meeting?.joinUrl || ""}`);
  } else {
    lines.push(`Studio address: ${studioCalendarLocation(env)}`);
    if (appointment.purpose === "tattoo") {
      lines.push("Final payment: At the start of your appointment, the remaining balance is collected after the final session price is confirmed and before tattooing begins.");
      lines.push(`Day-of prep: ${resources.dayOfInstructionsUrl}`);
    }
    lines.push(`Location & parking: ${resources.locationParkingUrl}`);
  }

  return lines.join("\n");
}

function appointmentCalendarLocation(env, appointment) {
  if (isVirtualAppointment(appointment) && appointment.meeting?.joinUrl) {
    return appointment.meeting.joinUrl;
  }
  return studioCalendarLocation(env);
}

function buildAppointmentIcs(env, request, appointment) {
  const label = appointment.bookingTypeLabel || "Tattoo session";
  const summary = `art.pill TATTOO HOUSE - ${label}`;
  const confirmationUrl = appointmentConfirmationUrl(env, request, appointment);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Six Well Construct//Art.Pill Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    icsProperty("X-WR-TIMEZONE", DEFAULT_CALENDAR_TIME_ZONE),
    "BEGIN:VEVENT",
    icsProperty("UID", `${appointment.id}@thesixwellconstruct.com`),
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `LAST-MODIFIED:${icsDate(appointment.updatedAt || appointment.rescheduledAt || appointment.createdAt || new Date().toISOString())}`,
    `SEQUENCE:${Math.max(0, Number(appointment.rescheduleCount || 0))}`,
    foldIcsLine(`DTSTART;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.startAt)}`),
    foldIcsLine(`DTEND;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.endAt)}`),
    icsProperty("SUMMARY", summary),
    icsProperty("LOCATION", appointmentCalendarLocation(env, appointment)),
    icsProperty("DESCRIPTION", appointmentCalendarDescription(env, request, appointment)),
    icsProperty("URL", confirmationUrl),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.join("\r\n");
}

function buildCancelledAppointmentIcs(appointment) {
  const label = appointment.bookingTypeLabel || "Tattoo session";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Six Well Construct//Art.Pill Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:CANCEL",
    "BEGIN:VEVENT",
    icsProperty("UID", `${appointment.id}@thesixwellconstruct.com`),
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `LAST-MODIFIED:${icsDate(appointment.updatedAt || appointment.cancelledAt || new Date().toISOString())}`,
    `SEQUENCE:${Math.max(1, Number(appointment.rescheduleCount || 0) + 1)}`,
    foldIcsLine(`DTSTART;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.startAt)}`),
    foldIcsLine(`DTEND;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.endAt)}`),
    icsProperty("SUMMARY", `Cancelled: art.pill TATTOO HOUSE - ${label}`),
    icsProperty("DESCRIPTION", "This appointment was cancelled or replaced. Remove the old event from your calendar."),
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.join("\r\n");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createRawToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadTokenContext(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const token = await db
    .prepare(
      `SELECT bt.*, s.status AS submission_status, s.contact_name, s.contact_email,
        s.contact_phone, s.type AS submission_type, s.source_path, s.tattoo_stage,
        s.lifecycle_review_required, s.lifecycle_review_note, s.payload_json
       FROM booking_tokens bt
       JOIN submissions s ON s.id = bt.submission_id
       WHERE bt.token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  if (!token) return null;
  const now = new Date().toISOString();
  if (token.revoked_at || token.used_at) return { invalid: "This booking link is no longer active." };
  if (token.expires_at && token.expires_at < now) return { invalid: "This booking link has expired." };
  const pendingSpecialApproval = token.submission_type === "tattoo_special"
    && token.submission_status === "new"
    && token.tattoo_stage === "review";
  if (token.submission_status !== "approved" && !pendingSpecialApproval) {
    return { invalid: "This booking link is waiting on approval." };
  }

  const purpose = token.purpose || "tattoo";
  const allowedBookingTypes = parseJsonField(token.allowed_booking_types_json, []);
  if (!BOOKING_TOKEN_PURPOSES.has(purpose) || !bookingTypesMatchPurpose(purpose, allowedBookingTypes)) {
    return { invalid: "This booking link has an incompatible purpose. Ask the studio for a new link." };
  }
  if (purpose === "consultation" && token.tattoo_stage !== "consultation_required") {
    return { invalid: "This project is not currently waiting for a prerequisite consultation." };
  }
  if (purpose === "tattoo" && token.tattoo_stage !== "ready_to_book" && !pendingSpecialApproval) {
    return { invalid: "This project is not ready for tattoo scheduling yet." };
  }

  return {
    token,
    purpose,
    allowedBookingTypes,
    pendingSpecialApproval,
  };
}

function normalizeTattooSessionPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    sessionCategory: row.session_category || "artist_review",
    splitPolicy: row.split_policy || "artist_review",
    estimatedSessionsMin: row.estimated_sessions_min ?? null,
    estimatedSessionsMax: row.estimated_sessions_max ?? null,
    estimatedTotalMinutesMin: row.estimated_total_minutes_min ?? null,
    estimatedTotalMinutesMax: row.estimated_total_minutes_max ?? null,
    artistNote: row.artist_note || "",
    includeAdditionalSketchDisclaimer: Boolean(row.include_additional_sketch_disclaimer),
    approvedBudgetMinCents: row.approved_budget_min_cents ?? null,
    approvedBudgetMaxCents: row.approved_budget_max_cents ?? null,
    approvedBudgetCurrency: row.approved_budget_currency || "USD",
    budgetAcknowledged: Boolean(row.budget_acknowledged),
    budgetAcknowledgedAt: row.budget_acknowledged_at || "",
    bookingLinkPurpose: row.booking_purpose || "",
    allowedBookingTypes: parseJsonField(row.allowed_booking_types_json, []),
    bookingLinkExpiresAt: row.booking_link_expires_at || "",
    bookingLinkRevokeExisting: row.booking_link_revoke_existing === null || row.booking_link_revoke_existing === undefined
      ? true
      : Boolean(row.booking_link_revoke_existing),
    clientPreference: row.client_preference || "",
    clientAcknowledged: Boolean(row.client_acknowledged),
    clientInformedAt: row.client_informed_at || "",
    clientSelectedAt: row.client_selected_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadTattooSessionPlan(db, submissionId) {
  if (!submissionId) return null;
  return db.prepare("SELECT * FROM tattoo_session_plans WHERE submission_id = ?").bind(submissionId).first();
}

function sessionPlanRequiresClientResponse(plan) {
  return Boolean(plan && ["required", "client_choice", "not_available"].includes(plan.split_policy));
}

function sessionPlanResponseComplete(plan) {
  const sessionComplete = !sessionPlanRequiresClientResponse(plan)
    || Boolean(Number(plan.client_acknowledged) === 1 && plan.client_preference && plan.client_selected_at);
  const budgetComplete = !reviewedBudgetIsComplete(plan)
    || Boolean(Number(plan.budget_acknowledged) === 1 && plan.budget_acknowledged_at);
  return sessionComplete && budgetComplete;
}

async function ensureSessionPlanResponse(db, tokenContext) {
  const plan = await loadTattooSessionPlan(db, tokenContext?.token?.submission_id);
  if (tokenContext?.token?.submission_type === "tattoo_special") {
    return { plan };
  }
  if (plan && !sessionPlanResponseComplete(plan)) {
    return {
      error: reviewedBudgetIsComplete(plan) && !Number(plan.budget_acknowledged)
        ? "Review and agree to the approved project budget before choosing an appointment."
        : "Review and confirm the studio's session plan before choosing an appointment.",
    };
  }
  return { plan };
}

async function listBookingTypes(db, allowedBookingTypes) {
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .all();
  const allowed = new Set(allowedBookingTypes || []);
  return (result.results || [])
    .filter((row) => !allowed.size || allowed.has(row.id))
    .map(normalizeBookingType);
}

async function listPublicWindows(db, bookingTypes) {
  const ids = bookingTypes.map((type) => type.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const manualResult = await db
    .prepare(
      `SELECT aw.*,
        (
          SELECT COUNT(*) FROM appointments a
          WHERE a.availability_window_id = aw.id
            AND a.status IN ('pending_deposit', 'deposit_pending', 'confirmed')
        ) AS appointment_count
       FROM availability_windows aw
       WHERE aw.active = 1
         AND aw.is_blackout = 0
         AND aw.id NOT LIKE 'gen:%'
         AND aw.start_at > ?
         AND (aw.booking_type_id IS NULL OR aw.booking_type_id IN (${placeholders}))
       ORDER BY aw.start_at ASC`
    )
    .bind(new Date().toISOString(), ...ids)
    .all();

  const blackoutResult = await db
    .prepare(
      `SELECT * FROM availability_windows
       WHERE active = 1 AND is_blackout = 1 AND end_at > ?`
    )
    .bind(new Date().toISOString())
    .all();
  const blackouts = blackoutResult.results || [];
  const activeAppointments = await loadActiveAppointments(db, new Date().toISOString());
  const soleBookingTypeId = ids.length === 1 ? ids[0] : "";

  const manualWindows = (manualResult.results || [])
    .filter((row) => Number(row.appointment_count || 0) < Number(row.capacity || 1))
    .filter((row) => !isBlockedByBlackout(row, blackouts))
    .filter((row) => hasSlotCapacity(row, activeAppointments, row.booking_type_id || soleBookingTypeId))
    .map(normalizeWindow);

  const generatedWindows = await listGeneratedWindows(db, bookingTypes, blackouts, activeAppointments);
  return [...manualWindows, ...generatedWindows]
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

async function listGeneratedWindows(db, bookingTypes, blackouts, activeAppointments) {
  const settingsRow = await db
    .prepare("SELECT * FROM booking_settings WHERE venture = ?")
    .bind("tattooing")
    .first();
  if (!settingsRow) return [];
  const settings = normalizeSettings(settingsRow);
  const rulesResult = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE venture = ? AND active = 1
       ORDER BY day_of_week ASC`
    )
    .bind("tattooing")
    .all();
  const rules = rulesResult.results || [];
  if (!rules.length) return [];

  const now = new Date();
  const earliest = new Date(now.getTime() + settings.minimumNoticeHours * 60 * 60 * 1000);
  const days = Math.max(1, Math.min(settings.bookingHorizonDays || 60, 180));
  const generated = [];
  const bookingsByDay = await loadBookingsByLocalDay(db, settings.timezone, earliest.toISOString());
  const appointmentCounts = await loadAppointmentCounts(db);

  for (let offset = 0; offset <= days; offset += 1) {
    const cursor = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = datePartsInZone(cursor, settings.timezone);
    const localKey = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
    if (Number(bookingsByDay.get(localKey) || 0) >= settings.maxBookingsPerDay) continue;

    for (const rule of rules.filter((item) => Number(item.day_of_week) === local.dayOfWeek)) {
      const startParts = parseTime(rule.start_time);
      const endParts = parseTime(rule.end_time);
      const ruleStart = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, startParts.hour, startParts.minute);
      const ruleEnd = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, endParts.hour, endParts.minute);
      if (new Date(ruleEnd).getTime() <= new Date(ruleStart).getTime()) continue;

      const allowedTypeIds = SCHEDULE_CATEGORY_BOOKING_TYPE_IDS[rule.category] || SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing;
      for (const bookingType of bookingTypes.filter((type) => allowedTypeIds.includes(type.id) || (rule.category === "tattooing" && isTattooSpecialBookingType(type.id)))) {
        let slotStart = ruleStart;
        while (new Date(addMinutes(slotStart, bookingType.durationMinutes)).getTime() <= new Date(ruleEnd).getTime()) {
          const slotEnd = addMinutes(slotStart, bookingType.durationMinutes);
          const row = {
            id: generatedWindowId(
              rule.id,
              bookingType.id,
              slotStart,
              generatedWindowPolicyVersion(rule, settings, bookingType),
            ),
            venture: rule.venture,
            booking_type_id: bookingType.id,
            start_at: slotStart,
            end_at: slotEnd,
            capacity: rule.capacity || settings.defaultCapacity,
            buffer_before_minutes: rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
            buffer_after_minutes: rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
            is_blackout: 0,
            active: 1,
            note: rule.note || "Generated from weekly schedule",
          };
          if (
            new Date(slotStart).getTime() >= earliest.getTime() &&
            Number(appointmentCounts.get(row.id) || 0) < Number(row.capacity || 1) &&
            hasSlotCapacity(row, activeAppointments) &&
            !isBlockedByBlackout(row, blackouts)
          ) {
            generated.push(normalizeWindow(row));
          }
          slotStart = addMinutes(slotStart, settings.slotIntervalMinutes || 30);
        }
      }
    }
  }
  return generated;
}

async function loadBookingsByLocalDay(db, timezone, afterIso, bookingTypeIds = []) {
  const ids = (bookingTypeIds || []).filter(Boolean);
  const typeClause = ids.length ? ` AND booking_type_id IN (${ids.map(() => "?").join(", ")})` : "";
  const result = await db
    .prepare(
      `SELECT start_at FROM appointments
       WHERE start_at > ? AND status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
        + typeClause
    )
    .bind(afterIso, ...ids)
    .all();
  const map = new Map();
  for (const row of result.results || []) {
    const parts = datePartsInZone(new Date(row.start_at), timezone);
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    map.set(key, Number(map.get(key) || 0) + 1);
  }
  return map;
}

function bookedDaysFromMap(map) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

async function loadActiveAppointments(db, afterIso) {
  const result = await db
    .prepare(
      `SELECT a.id, a.booking_type_id, a.start_at, a.end_at,
              COALESCE(aw.buffer_before_minutes, 0) AS buffer_before_minutes,
              COALESCE(aw.buffer_after_minutes, 0) AS buffer_after_minutes
       FROM appointments a
       LEFT JOIN availability_windows aw ON aw.id = a.availability_window_id
       WHERE a.end_at > ?
         AND a.status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
    )
    .bind(afterIso)
    .all();
  return result.results || [];
}

async function loadAppointmentCounts(db) {
  const result = await db
    .prepare(
      `SELECT availability_window_id, COUNT(*) AS count FROM appointments
       WHERE status IN ('pending_deposit', 'deposit_pending', 'confirmed')
       GROUP BY availability_window_id`
    )
    .all();
  return new Map((result.results || []).map((row) => [row.availability_window_id, Number(row.count || 0)]));
}

export async function handleBookingContext(request, env) {
  try {
    const db = requireBookingDb(env);
    const rawToken = new URL(request.url).searchParams.get("token") || "";
    const context = await loadTokenContext(db, rawToken);
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);

    const bookingTypes = await listBookingTypes(db, context.allowedBookingTypes);
    const windows = await listPublicWindows(db, bookingTypes);
    const isTattooSpecial = context.token.submission_type === "tattoo_special";
    const sessionPlan = context.purpose === "tattoo" && !isTattooSpecial
      ? await loadTattooSessionPlan(db, context.token.submission_id)
      : null;
    const sessionEstimateCopy = context.purpose === "tattoo" && !isTattooSpecial
      ? await loadSessionEstimateCopy(db)
      : null;
    const pendingRow = await db.prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND status IN ('pending_deposit','deposit_pending')
         AND hold_state IN ('active','expiry_attention')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(context.token.id).first();
    const pendingAppointment = pendingRow ? normalizeAppointment(pendingRow) : null;
    const pendingResumable = Boolean(
      pendingAppointment
      && pendingAppointment.holdState === "active"
      && new Date(pendingAppointment.holdExpiresAt).getTime() > Date.now()
      && pendingAppointment.squareCheckoutUrl
    );

    return json({
      ok: true,
      client: {
        name: context.token.contact_name,
        email: context.token.contact_email,
        phone: context.token.contact_phone || "",
      },
      submission: {
        id: context.token.submission_id,
        type: context.token.submission_type,
        tattooStage: context.token.tattoo_stage || "",
        pendingApproval: Boolean(context.pendingSpecialApproval),
        lifecycleReviewRequired: Boolean(context.token.lifecycle_review_required),
        lifecycleReviewNote: context.token.lifecycle_review_note || "",
        special: context.token.submission_type === "tattoo_special"
          ? (() => {
              const payload = parseJsonField(context.token.payload_json, {});
              return {
                campaign: "Tattoo Special",
                offerTitle: payload.special_offer_title || "Tattoo Special",
                variantLabel: payload.special_variant_label || "",
                quotedPriceCents: Number(payload.approved_price_cents || payload.quoted_price_cents || 0),
                depositCents: Number(payload.deposit_cents || 0),
                durationMinutes: Number(payload.duration_minutes || 0),
                participants: Array.isArray(payload.participants) ? payload.participants : [],
              };
            })()
          : null,
      },
      requiresClientDetails: directInviteNeedsClient(context.token),
      purpose: context.purpose,
      expiresAt: context.token.expires_at || "",
      sessionPlan: normalizeTattooSessionPlan(sessionPlan),
      sessionEstimateCopy,
      bookingTypes,
      availabilityWindows: windows,
      pendingCheckout: pendingAppointment ? {
        appointmentId: pendingAppointment.id,
        startAt: pendingAppointment.startAt,
        endAt: pendingAppointment.endAt,
        checkoutUrl: pendingResumable ? pendingAppointment.squareCheckoutUrl : "",
        holdExpiresAt: pendingAppointment.holdExpiresAt,
        holdState: pendingAppointment.holdState,
        resumable: pendingResumable,
        approvalState: pendingAppointment.approvalState,
        paymentDueAt: pendingAppointment.paymentDueAt,
      } : null,
    });
  } catch (error) {
    return errorResponse("Unable to load booking context.", 500, {
      detail: error.message,
    });
  }
}

export async function handleSaveBookingSessionPlan(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);
    if (context.purpose !== "tattoo") {
      return errorResponse("Prerequisite consultation links do not use a final tattoo session plan.", 409);
    }
    if (context.token.submission_type === "tattoo_special") {
      return errorResponse("Tattoo Specials use the chosen selection and do not require session-plan approval.", 409);
    }
    const plan = await loadTattooSessionPlan(db, context.token.submission_id);
    if (!plan) return errorResponse("No session plan is attached to this project.", 404);
    if (body.acknowledged !== true) return errorResponse("Acknowledge the session estimate before continuing.", 400);
    const requiresBudgetAcknowledgement = reviewedBudgetIsComplete(plan);
    if (requiresBudgetAcknowledgement && body.budgetAcknowledged !== true) {
      return errorResponse("Agree to the approved project budget before continuing.", 400, {
        code: "APPROVED_BUDGET_ACKNOWLEDGEMENT_REQUIRED",
      });
    }
    const preference = asString(body.preference);
    if (!CLIENT_SESSION_PREFERENCES.has(preference)) return errorResponse("Choose a valid session preference.", 400);
    const pacingOptions = pacingOptionsForBookingTypeIds(context.allowedBookingTypes);
    if (preference === "one_longer_session" && !pacingOptions.longer) {
      return errorResponse("This booking link does not include a longer-session option.", 409);
    }
    if (preference === "multiple_shorter_sessions" && !pacingOptions.shorter) {
      return errorResponse("This booking link does not include a shorter-session option.", 409);
    }
    if (["required", "not_available"].includes(plan.split_policy) && preference !== "studio_plan") {
      return errorResponse("This project has a required session structure.", 409);
    }
    if (plan.split_policy === "artist_review" && preference !== "studio_plan") {
      return errorResponse("The artist must finish reviewing this session structure.", 409);
    }
    const now = new Date().toISOString();
    const firstBudgetAcknowledgement = requiresBudgetAcknowledgement && Number(plan.budget_acknowledged || 0) !== 1;
    const statements = [
      db.prepare(
        `UPDATE tattoo_session_plans
         SET client_preference = ?, client_acknowledged = 1,
             client_informed_at = COALESCE(client_informed_at, ?), client_selected_at = ?,
             budget_acknowledged = CASE WHEN approved_budget_min_cents IS NULL THEN budget_acknowledged ELSE 1 END,
             budget_acknowledged_at = CASE
               WHEN approved_budget_min_cents IS NULL THEN budget_acknowledged_at
               ELSE COALESCE(budget_acknowledged_at, ?)
             END,
             updated_at = ?
         WHERE submission_id = ?`
      ).bind(preference, now, now, now, now, context.token.submission_id),
    ];
    if (firstBudgetAcknowledgement) {
      statements.push(
        db.prepare(
          `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
           VALUES (?, ?, 'approved_budget_acknowledged', 'client', ?, ?)`
        ).bind(
          crypto.randomUUID(),
          context.token.submission_id,
          plan.approved_budget_min_cents === plan.approved_budget_max_cents
            ? formatMoney(plan.approved_budget_min_cents, plan.approved_budget_currency || "USD")
            : `${formatMoney(plan.approved_budget_min_cents, plan.approved_budget_currency || "USD")}–${formatMoney(plan.approved_budget_max_cents, plan.approved_budget_currency || "USD")}`,
          now,
        ),
      );
    }
    await db.batch(statements);
    return json({ ok: true, sessionPlan: normalizeTattooSessionPlan(await loadTattooSessionPlan(db, context.token.submission_id)) });
  } catch (error) {
    return errorResponse("Unable to save the session preference.", 500, { detail: error.message });
  }
}

async function ensureAvailable(db, windowId, bookingTypeId, excludeAppointmentId = "") {
  let window;
  if (parseGeneratedWindowId(windowId)) {
    const materialized = await materializeGeneratedWindow(db, windowId, bookingTypeId);
    if (materialized.error) return materialized;
    window = materialized.window;
  } else {
    window = await db
      .prepare("SELECT * FROM availability_windows WHERE id = ? AND active = 1")
      .bind(windowId)
      .first();
  }
  if (!window || window.is_blackout) return { error: "That appointment time is unavailable." };
  if (window.booking_type_id && window.booking_type_id !== bookingTypeId) {
    return { error: "That appointment time does not match the selected session." };
  }
  if (
    bookingTypeId === EXTENDED_DAY_BOOKING_TYPE_ID
    && (
      window.booking_type_id !== EXTENDED_DAY_BOOKING_TYPE_ID
      || new Date(window.end_at).getTime() - new Date(window.start_at).getTime() !== 600 * 60 * 1000
    )
  ) {
    return { error: "Extended Day requires a dedicated 10-hour availability window." };
  }

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM appointments
       WHERE availability_window_id = ?
         AND (? = '' OR id <> ?)
         AND status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
    )
    .bind(windowId, excludeAppointmentId, excludeAppointmentId)
    .first();
  if (Number(countRow?.count || 0) >= Number(window.capacity || 1)) {
    return { error: "That appointment time has already been claimed." };
  }
  const blackoutResult = await db
    .prepare(
      `SELECT * FROM availability_windows
       WHERE active = 1 AND is_blackout = 1 AND end_at > ?`
    )
    .bind(new Date().toISOString())
    .all();
  if (isBlockedByBlackout(window, blackoutResult.results || [])) {
    return { error: "That appointment time is blocked out." };
  }
  const activeAppointments = (await loadActiveAppointments(
    db,
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  )).filter((appointment) => appointment.id !== excludeAppointmentId);
  if (!hasSlotCapacity(window, activeAppointments, bookingTypeId)) {
    return { error: "That appointment time overlaps another booking." };
  }
  return { window };
}

async function materializeGeneratedWindow(db, windowId, bookingTypeId) {
  const parsed = parseGeneratedWindowId(windowId);
  if (!parsed || parsed.bookingTypeId !== bookingTypeId || !Number.isFinite(parsed.startMs)) {
    return { error: "That appointment time is unavailable." };
  }

  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType) return { error: "Unknown booking type." };

  const rule = await db
    .prepare("SELECT * FROM availability_rules WHERE id = ? AND active = 1")
    .bind(parsed.ruleId)
    .first();
  if (!rule) return { error: "That appointment time is no longer available." };
  const ruleCategory = rule.category || "tattooing";
  if (!(SCHEDULE_CATEGORY_BOOKING_TYPE_IDS[ruleCategory] || []).includes(bookingTypeId)
      && !(ruleCategory === "tattooing" && isTattooSpecialBookingType(bookingTypeId))) {
    return { error: "That appointment time no longer matches the selected session category." };
  }

  const settingsRow = await db
    .prepare("SELECT * FROM booking_settings WHERE venture = ?")
    .bind(rule.venture)
    .first();
  if (!settingsRow) return { error: "Booking settings are not configured." };
  const settings = normalizeSettings(settingsRow);
  const expectedPolicyVersion = generatedWindowPolicyVersion(rule, settings, bookingType);
  if (!parsed.policyVersion || parsed.policyVersion !== expectedPolicyVersion) {
    return { error: "That generated appointment time is stale. Refresh availability and choose again." };
  }

  const startAt = new Date(parsed.startMs).toISOString();
  const endAt = addMinutes(startAt, bookingType.duration_minutes);
  const local = datePartsInZone(new Date(startAt), settings.timezone);
  if (local.dayOfWeek !== Number(rule.day_of_week)) {
    return { error: "That appointment time is outside the current weekly schedule." };
  }

  const startParts = parseTime(rule.start_time);
  const endParts = parseTime(rule.end_time);
  const ruleStart = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, startParts.hour, startParts.minute);
  const ruleEnd = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, endParts.hour, endParts.minute);
  const elapsedMinutes = (new Date(startAt).getTime() - new Date(ruleStart).getTime()) / (60 * 1000);
  const earliest = new Date(Date.now() + settings.minimumNoticeHours * 60 * 60 * 1000);
  if (
    new Date(startAt).getTime() < earliest.getTime() ||
    new Date(startAt).getTime() < new Date(ruleStart).getTime() ||
    new Date(endAt).getTime() > new Date(ruleEnd).getTime() ||
    elapsedMinutes < 0 ||
    elapsedMinutes % Number(settings.slotIntervalMinutes || 30) !== 0
  ) {
    return { error: "That appointment time is no longer available." };
  }

  const dayBookings = await loadBookingsByLocalDay(db, settings.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const localKey = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  if (Number(dayBookings.get(localKey) || 0) >= settings.maxBookingsPerDay) {
    return { error: "That day has reached its booking limit." };
  }

  const candidateWindow = {
    start_at: startAt,
    end_at: endAt,
    buffer_before_minutes: rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
    buffer_after_minutes: rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
    capacity: rule.capacity || settings.defaultCapacity,
  };
  const activeAppointments = await loadActiveAppointments(db, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (!hasSlotCapacity(candidateWindow, activeAppointments)) {
    return { error: "That appointment time overlaps another booking." };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO availability_windows (
        id, venture, booking_type_id, start_at, end_at, capacity,
        buffer_before_minutes, buffer_after_minutes, is_blackout,
        active, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      windowId,
      rule.venture,
      bookingTypeId,
      startAt,
      endAt,
      rule.capacity || settings.defaultCapacity,
      rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
      rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
      0,
      1,
      rule.note || "Generated from weekly schedule",
      now,
      now
    )
    .run();

  const window = await db.prepare("SELECT * FROM availability_windows WHERE id = ? AND active = 1")
    .bind(windowId)
    .first();
  if (
    !window
    || window.booking_type_id !== bookingTypeId
    || window.start_at !== startAt
    || window.end_at !== endAt
    || Number(window.capacity || 1) !== Number(candidateWindow.capacity || 1)
    || Number(window.buffer_before_minutes || 0) !== Number(candidateWindow.buffer_before_minutes || 0)
    || Number(window.buffer_after_minutes || 0) !== Number(candidateWindow.buffer_after_minutes || 0)
  ) {
    return { error: "That generated appointment time is stale. Refresh availability and choose again." };
  }
  return { window };
}

function finalTattooSessionPlanIsAppropriate(row) {
  if (!row) return false;
  const category = row.session_category || "artist_review";
  const splitPolicy = row.split_policy || "artist_review";
  if (!["one_session", "multiple_sessions"].includes(category)) return false;
  if (!["required", "client_choice", "not_available"].includes(splitPolicy)) return false;
  const sessionsMin = Number(row.estimated_sessions_min || 0);
  const sessionsMax = Number(row.estimated_sessions_max || 0);
  if (category === "one_session") {
    return sessionsMin === 1 && sessionsMax === 1 && splitPolicy !== "required";
  }
  return sessionsMin >= 2 && sessionsMax >= sessionsMin && splitPolicy !== "not_available";
}

function tattooSubmissionRequiresPrerequisiteConsultation(row) {
  const payload = parseJsonField(row?.payload_json, {});
  return payload.consult_required === "yes";
}

async function insertPendingAppointment(db, values, eventType = "hold_created") {
  const dayGuard = await bookingDayGuardForWindow(db, values.availabilityWindowId);
  if (!dayGuard) return false;
  const statements = [
    db.prepare(
      `INSERT OR IGNORE INTO appointments (
        id, submission_id, booking_token_id, booking_type_id, availability_window_id,
        status, purpose, client_name, client_email, client_phone, start_at, end_at,
        deposit_cents, tip_cents, session_fee_cents,
        extended_day_acknowledged_at, currency, hold_expires_at, hold_state, approval_state,
        replacement_for_appointment_id, reschedule_count, original_start_at,
        original_end_at, created_at, updated_at
      )
       SELECT ?, ?, ?, ?, aw.id, 'pending_deposit', ?, ?, ?, ?, aw.start_at, aw.end_at,
              ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?
      FROM availability_windows aw
      WHERE aw.id = ? AND aw.active = 1 AND aw.is_blackout = 0
        AND (aw.booking_type_id IS NULL OR aw.booking_type_id = ?)
        AND aw.start_at > ?
        AND (
          SELECT COUNT(*) FROM appointments day_appointment
          WHERE day_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
            AND day_appointment.start_at >= ? AND day_appointment.start_at < ?
            AND (? IS NULL OR day_appointment.id <> ?)
        ) < ?
        AND NOT EXISTS (
          SELECT 1 FROM availability_windows blackout
          WHERE blackout.active = 1 AND blackout.is_blackout = 1
            AND (
              unixepoch(blackout.start_at) - COALESCE(blackout.buffer_before_minutes, 0) * 60
                < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
              AND unixepoch(blackout.end_at) + COALESCE(blackout.buffer_after_minutes, 0) * 60
                > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
            )
        )
        AND (
          SELECT COUNT(*) FROM appointments overlap_appointment
          LEFT JOIN availability_windows overlap_window
            ON overlap_window.id = overlap_appointment.availability_window_id
          WHERE overlap_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
            AND (
              unixepoch(overlap_appointment.start_at) - COALESCE(overlap_window.buffer_before_minutes, 0) * 60
                < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
              AND unixepoch(overlap_appointment.end_at) + COALESCE(overlap_window.buffer_after_minutes, 0) * 60
                > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
            )
        ) < CASE
          WHEN ? IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended')
            OR ? LIKE 'tattoo_special_%'
          THEN 1 ELSE aw.capacity
        END
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM appointments replacement_original
            WHERE replacement_original.id = ?
              AND replacement_original.status = 'confirmed'
              AND replacement_original.reschedule_count = 0
              AND replacement_original.replaced_by_appointment_id IS NULL
          )
        )
        AND (
          ? IS NULL OR NOT EXISTS (
            SELECT 1 FROM appointments token_hold
            WHERE token_hold.booking_token_id = ?
              AND token_hold.status IN ('pending_deposit','deposit_pending')
              AND token_hold.hold_state IN ('active','expiry_attention')
          )
        )
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM booking_tokens active_token
            JOIN submissions token_submission ON token_submission.id = active_token.submission_id
            WHERE active_token.id = ?
              AND active_token.submission_id = ?
              AND active_token.revoked_at IS NULL
              AND active_token.used_at IS NULL
              AND (active_token.expires_at IS NULL OR active_token.expires_at > ?)
              AND active_token.purpose = CASE
                WHEN ? = 'prerequisite_consultation' THEN 'consultation'
                ELSE 'tattoo'
              END
              AND EXISTS (
                SELECT 1 FROM json_each(active_token.allowed_booking_types_json)
                WHERE value = ?
              )
              AND (
                token_submission.status = 'approved'
                OR (
                  token_submission.type = 'tattoo_special'
                  AND token_submission.status = 'new'
                  AND token_submission.tattoo_stage = 'review'
                )
              )
              AND (
                (? = 'prerequisite_consultation' AND token_submission.tattoo_stage = 'consultation_required')
                OR (? = 'tattoo' AND token_submission.tattoo_stage IN ('review','ready_to_book'))
              )
          )
        )
        AND (
          ? IS NOT NULL OR ? IS NULL OR NOT EXISTS (
            SELECT 1 FROM appointments submission_hold
            WHERE submission_hold.submission_id = ?
              AND submission_hold.purpose = ?
              AND submission_hold.replacement_for_appointment_id IS NULL
              AND submission_hold.status IN ('pending_deposit','deposit_pending','confirmed')
              AND (
                submission_hold.status = 'confirmed'
                OR submission_hold.hold_state IN ('active','expiry_attention')
              )
          )
        )
        AND (
          ? IS NULL OR NOT EXISTS (
            SELECT 1 FROM appointments replacement_hold
            WHERE replacement_hold.replacement_for_appointment_id = ?
              AND replacement_hold.status IN ('pending_deposit','deposit_pending')
              AND replacement_hold.hold_state IN ('active','expiry_attention')
          )
        )
        AND (
          SELECT COUNT(*) FROM appointments existing
          WHERE existing.availability_window_id = aw.id
            AND existing.status IN ('pending_deposit','deposit_pending','confirmed')
        ) < aw.capacity`
    ).bind(
      values.id,
      values.submissionId || null,
      values.bookingTokenId || null,
      values.bookingTypeId,
      values.purpose,
      values.clientName,
      values.clientEmail,
      values.clientPhone || null,
      values.depositCents,
      values.tipCents || 0,
      values.sessionFeeCents || 0,
      values.extendedDayAcknowledgedAt || null,
      values.currency || "USD",
      values.holdExpiresAt,
      values.approvalState || "not_required",
      values.replacementForAppointmentId || null,
      values.rescheduleCount || 0,
      values.originalStartAt || null,
      values.originalEndAt || null,
      values.now,
      values.now,
      values.availabilityWindowId,
      values.bookingTypeId,
      values.now,
      dayGuard.startAt,
      dayGuard.endAt,
      values.replacementForAppointmentId || null,
      values.replacementForAppointmentId || null,
      dayGuard.maxBookingsPerDay,
      values.bookingTypeId,
      values.bookingTypeId,
      values.replacementForAppointmentId || null,
      values.replacementForAppointmentId || null,
      values.bookingTokenId || null,
      values.bookingTokenId || null,
      values.bookingTokenId || null,
      values.bookingTokenId || null,
      values.submissionId || null,
      values.now,
      values.purpose,
      values.bookingTypeId,
      values.purpose,
      values.purpose,
      values.replacementForAppointmentId || null,
      values.submissionId || null,
      values.submissionId || null,
      values.purpose,
      values.replacementForAppointmentId || null,
      values.replacementForAppointmentId || null,
    ),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, ?, 'system', ?, ?, ? FROM appointments WHERE id = ?`
    ).bind(
      crypto.randomUUID(),
      eventType,
      values.eventNote || null,
      JSON.stringify(values.eventMetadata || {}),
      values.now,
      values.id,
    ),
  ];
  const results = await db.batch(statements);
  return Number(results?.[0]?.meta?.changes || 0) > 0;
}

async function createPendingAppointment(db, tokenContext, bookingTypeId, windowId, tipCents = 0, extendedDayAcknowledged = false) {
  const now = new Date().toISOString();
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType) return { error: "Unknown booking type." };
  if (bookingType.id === EXTENDED_DAY_BOOKING_TYPE_ID && extendedDayAcknowledged !== true) {
    return { error: "Review and acknowledge the Extended Day pricing and billing policy before checkout." };
  }

  const purpose = tokenContext.purpose === "consultation" ? "prerequisite_consultation" : "tattoo";
  if (purposeForBookingType(bookingType.id, purpose === "prerequisite_consultation") !== purpose) {
    return { error: "That session type does not match this booking link's purpose." };
  }

  const allowed = new Set(tokenContext.allowedBookingTypes || []);
  if (allowed.size && !allowed.has(bookingType.id)) {
    return { error: "This booking link does not include that session type." };
  }

  const existingForSelection = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND booking_type_id = ?
         AND availability_window_id = ?
         AND status IN ('pending_deposit', 'deposit_pending')
         AND hold_state = 'active' AND hold_expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(tokenContext.token.id, bookingType.id, windowId, now)
    .first();
  if (existingForSelection) {
    const existingAppointment = normalizeAppointment(existingForSelection);
    existingAppointment.bookingTypeLabel ||= bookingType.label || "";
    await mirrorAppointmentToCrm(db, existingAppointment);
    return {
      appointment: existingAppointment,
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const existingForToken = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(tokenContext.token.id)
    .first();
  if (existingForToken) {
    return {
      error: "This booking link already has a pending appointment. Continue with the existing Square checkout link or reply to the studio if you need a different time.",
      code: "PENDING_HOLD_REQUIRES_RELEASE",
      appointment: normalizeAppointment(existingForToken),
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const id = crypto.randomUUID();
  const inserted = await insertPendingAppointment(db, {
    id,
    submissionId: tokenContext.token.submission_id,
    bookingTokenId: tokenContext.token.id,
    bookingTypeId: bookingType.id,
    availabilityWindowId: availability.window.id,
    purpose,
    clientName: tokenContext.token.contact_name,
    clientEmail: tokenContext.token.contact_email,
    clientPhone: tokenContext.token.contact_phone || null,
    depositCents: bookingType.deposit_cents,
    tipCents,
    sessionFeeCents: bookingType.session_fee_cents || 0,
    extendedDayAcknowledgedAt: bookingType.id === EXTENDED_DAY_BOOKING_TYPE_ID ? now : null,
    currency: bookingType.currency || "USD",
    holdExpiresAt: tokenContext.pendingSpecialApproval
      ? approvalHoldExpiry(tokenContext.token.expires_at)
      : holdExpiryFromNow(tokenContext.token.submission_type === "tattoo_special" ? tokenContext.token.expires_at : ""),
    approvalState: tokenContext.pendingSpecialApproval ? "pending" : "not_required",
    now,
    eventMetadata: { tokenPurpose: tokenContext.purpose },
  });
  if (!inserted) return { error: "That appointment time has already been claimed." };

  const appointment = await selectAppointmentWithMeeting(db, id);
  const normalizedAppointment = normalizeAppointment(appointment);
  await mirrorAppointmentToCrm(db, normalizedAppointment);
  return { appointment: normalizedAppointment, bookingType: normalizeBookingType(bookingType) };
}

async function publicConsultationBookingTypes(
  db,
  requestedTypeIds = PUBLIC_CONSULTATION_BOOKING_TYPE_IDS,
  allowedTypeIds = PUBLIC_CONSULTATION_BOOKING_TYPE_IDS
) {
  const ids = requestedTypeIds.filter((id) => allowedTypeIds.includes(id));
  const allowedIds = requestedTypeIds.length ? ids : allowedTypeIds;
  if (!allowedIds.length) return [];
  const placeholders = allowedIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE id IN (${placeholders}) AND active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .bind(...allowedIds)
    .all();
  return (result.results || []).map(normalizeBookingType);
}

async function listPublicWalkInWindows(db) {
  const result = await db
    .prepare(
      `SELECT * FROM walk_in_windows
       WHERE venture = ? AND active = 1 AND ends_at > ?
       ORDER BY starts_at ASC
       LIMIT 25`
    )
    .bind("tattooing", new Date().toISOString())
    .all();
  return (result.results || []).map(normalizeWalkInWindow);
}

async function handlePublicSessionContextForTypes(request, env, allowedTypeIds, label) {
  try {
    const db = requireBookingDb(env);
    const requestedTypes = new URL(request.url).searchParams.getAll("type");
    const bookingTypes = await publicConsultationBookingTypes(db, requestedTypes, allowedTypeIds);
    if (!bookingTypes.length) {
      return errorResponse(`Public ${label} booking is not configured.`, 503);
    }
    const windows = await listPublicWindows(db, bookingTypes);
    const walkInWindows = await listPublicWalkInWindows(db);
    return json({
      ok: true,
      bookingType: bookingTypes[0],
      bookingTypes,
      availabilityWindows: windows,
      walkInWindows,
    });
  } catch (error) {
    return errorResponse(`Unable to load ${label} availability.`, 500, {
      detail: error.message,
    });
  }
}

function directInviteNeedsClient(token) {
  return token?.source_path === "/studio/direct-booking-invite"
    && (!asString(token.contact_name) || !asString(token.contact_email) || !asString(token.contact_phone));
}

async function claimDirectInviteClient(db, context, body) {
  if (context?.token?.source_path !== "/studio/direct-booking-invite") {
    return { context };
  }
  if (!directInviteNeedsClient(context.token)) {
    return { context };
  }

  const clientName = asString(body.clientName);
  const clientEmail = asString(body.clientEmail).toLowerCase();
  const clientPhone = asString(body.clientPhone);
  if (!clientName || clientName.length > 160) {
    return { error: "Enter your full name.", status: 400 };
  }
  if (
    !clientEmail ||
    clientEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)
  ) {
    return { error: "Enter a valid email address.", status: 400 };
  }
  if (!clientPhone || clientPhone.length > 80) {
    return { error: "Enter your phone number.", status: 400 };
  }

  const now = new Date().toISOString();
  const update = await db.prepare(
    `UPDATE submissions
     SET contact_name = ?, contact_email = ?, contact_phone = ?, contact_json = ?, updated_at = ?
     WHERE id = ? AND source_path = '/studio/direct-booking-invite'
       AND contact_name = '' AND contact_email = ''`
  ).bind(
    clientName,
    clientEmail,
    clientPhone,
    JSON.stringify({ name: clientName, email: clientEmail, phone: clientPhone }),
    now,
    context.token.submission_id,
  ).run();

  if (Number(update?.meta?.changes || 0) < 1) {
    const existing = await db.prepare(
      "SELECT contact_name, contact_email, contact_phone FROM submissions WHERE id = ?"
    ).bind(context.token.submission_id).first();
    if (!existing || asString(existing.contact_email).toLowerCase() !== clientEmail) {
      return {
        error: "This private booking link has already been started by another client. Ask the studio for a new link.",
        status: 409,
      };
    }
    context.token.contact_name = existing.contact_name;
    context.token.contact_email = existing.contact_email;
    context.token.contact_phone = existing.contact_phone;
    return { context };
  }

  await db.prepare(
    `INSERT INTO submission_events (
      id, submission_id, event_type, actor, note, created_at
    ) VALUES (?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),
    context.token.submission_id,
    "direct_invite_client_identified",
    "client",
    clientEmail,
    now,
  ).run();
  context.token.contact_name = clientName;
  context.token.contact_email = clientEmail;
  context.token.contact_phone = clientPhone;
  return { context };
}

export function handlePublicConsultationContext(request, env) {
  return handlePublicSessionContextForTypes(request, env, PUBLIC_CONSULTATION_BOOKING_TYPE_IDS, "consultation");
}

export function handlePublicSessionContext(request, env) {
  return handlePublicSessionContextForTypes(request, env, PUBLIC_SESSION_BOOKING_TYPE_IDS, "session");
}

function publicClientFromBody(body) {
  const firstName = asString(body.firstName || body.first_name);
  const lastName = asString(body.lastName || body.last_name);
  const name = asString(body.name) || [firstName, lastName].filter(Boolean).join(" ").trim();
  return {
    name,
    email: asString(body.email).toLowerCase(),
    phone: asOptionalString(body.phone),
    preferredName: asOptionalString(body.preferredName || body.preferred_name),
    pronouns: asOptionalString(body.pronouns),
    instagram: asOptionalString(body.instagram),
    preferredContactMethod: asOptionalString(
      body.preferredContactMethod || body.preferred_contact_method
    ),
    referralSource: asOptionalString(body.referralSource || body.referral_source),
    direction: asOptionalString(body.direction),
    understand: asString(body.understand),
    dob: asString(body.dob),
    ageConfirmed: asString(body.age_confirmed),
  };
}

function publicClientIsAtLeastEighteen(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(dateValue));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  let age = parts.year - year;
  if (parts.month < month || (parts.month === month && parts.day < day)) age -= 1;
  return age >= 18;
}

function validatePublicConsultation(body, allowedTypeIds = PUBLIC_CONSULTATION_BOOKING_TYPE_IDS) {
  if (asString(body._gotcha)) return { spam: true };
  const client = publicClientFromBody(body);
  if (!client.name) return { error: "Name is required." };
  if (!client.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    return { error: "A valid email is required." };
  }
  if (!client.phone) return { error: "Phone number is required." };
  if (client.understand !== "yes") {
    return { error: "Consultation acknowledgement is required." };
  }
  if (client.ageConfirmed !== "yes") {
    return { error: "You must confirm that you are 18 or older." };
  }
  if (!publicClientIsAtLeastEighteen(client.dob)) {
    return { error: "Enter a valid date of birth confirming age 18 or older." };
  }
  if (!allowedTypeIds.includes(asString(body.bookingTypeId))) {
    return { error: "Please select an available public session type." };
  }
  if (!asString(body.availabilityWindowId)) {
    return { error: "Please select an available consultation time." };
  }
  return { client };
}

function submissionRequiresConsultation(submission) {
  const payload = parseJsonField(submission.payload_json, {});
  return payload.consult_required === "yes";
}

async function createPublicConsultationSubmission(db, body, client, bookingType) {
  const appointmentPurpose = purposeForBookingType(bookingType.id, false);
  const submissionType = appointmentPurpose === "build_session" ? "build_session" : "consultation";
  const idempotencyKey = asOptionalString(body._idempotencyKey || body.idempotencyKey || body.idempotency_key);
  if (idempotencyKey) {
    const existing = await db.prepare("SELECT * FROM submissions WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first();
    if (existing) {
      const existingPayload = parseJsonField(existing.payload_json, {});
      const sameIdentity = existing.type === submissionType
        && asString(existing.contact_email).toLowerCase() === client.email
        && asString(existingPayload.booking_type_id) === bookingType.id
        && asString(existingPayload.availability_window_id) === asString(body.availabilityWindowId);
      if (!sameIdentity) {
        return {
          error: "That idempotency key was already used for a different public session request.",
          code: "IDEMPOTENCY_IDENTITY_MISMATCH",
        };
      }
      return { id: existing.id, created: false, existingRow: existing };
    }
  }
  const id = crypto.randomUUID();
  const sourcePath = submissionType === "build_session"
    ? "/tattoos/build/in-person/"
    : "/tattoos/inquire/consultation/";
  const subject = submissionType === "build_session"
    ? "New In-Person Build Session"
    : "New Art.Pill Consultation Booking Request";
  const payload = {
    type: submissionType,
    source_path: sourcePath,
    subject,
    firstName: asString(body.firstName || body.first_name),
    lastName: asString(body.lastName || body.last_name),
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    preferred_name: client.preferredName || "",
    pronouns: client.pronouns || "",
    instagram: client.instagram || "",
    preferred_contact_method: client.preferredContactMethod || "",
    referral_source: client.referralSource || "",
    direction: client.direction || "",
    preferred_slots: asString(body.preferred_slots || body.preferredSlots),
    availability_window_id: asString(body.availabilityWindowId),
    booking_type_id: bookingType.id,
    booking_type_label: bookingType.label,
    deposit_label: formatMoney(bookingType.deposit_cents, bookingType.currency || "USD"),
    understand: client.understand,
    dob: client.dob,
    age_confirmed: client.ageConfirmed,
  };
  const contact = {
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    preferredName: client.preferredName || "",
    pronouns: client.pronouns || "",
    instagram: client.instagram || "",
    preferredContactMethod: client.preferredContactMethod || "",
    referralSource: client.referralSource || "",
  };

  return {
    id,
    created: true,
    record: {
      id,
      type: submissionType,
      sourcePath,
      subject,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone,
      contact,
      payload,
      internalNotes: client.direction || "",
      idempotencyKey,
    },
    eventNote: submissionType === "build_session"
      ? "Created from public in-person Build checkout."
      : "Created from public consultation checkout.",
  };
}

async function createPublicConsultationAppointment(
  db,
  body,
  allowedTypeIds = PUBLIC_CONSULTATION_BOOKING_TYPE_IDS
) {
  const bookingTypeId = asString(body.bookingTypeId);
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType || !allowedTypeIds.includes(bookingType.id)) {
    return { error: "Public session booking is not configured." };
  }

  const validation = validatePublicConsultation(body, allowedTypeIds);
  if (validation.spam) return { spam: true };
  if (validation.error) return validation;

  const windowId = asString(body.availabilityWindowId);
  const existingForClient = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_type_id = ?
         AND availability_window_id = ?
         AND lower(client_email) = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(bookingType.id, windowId, validation.client.email)
    .first();
  if (existingForClient) {
    const normalizedExisting = normalizeAppointment(existingForClient);
    const resumable = normalizedExisting.holdState === "active"
      && new Date(normalizedExisting.holdExpiresAt).getTime() > Date.now();
    if (!resumable) {
      return {
        error: "A prior checkout for this session must be safely released before choosing another time.",
        code: "PENDING_HOLD_REQUIRES_RELEASE",
        appointment: normalizedExisting,
      };
    }
    return {
      appointment: normalizedExisting,
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const submissionResult = await createPublicConsultationSubmission(
    db,
    body,
    validation.client,
    bookingType
  );
  if (submissionResult.error) return submissionResult;
  const purpose = purposeForBookingType(bookingType.id, false);
  if (!submissionResult.created) {
    const priorAppointment = await db.prepare(
      `SELECT * FROM appointments WHERE submission_id = ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(submissionResult.id).first();
    if (priorAppointment) {
      const normalizedPrior = normalizeAppointment(priorAppointment);
      if (normalizedPrior.status === "confirmed") {
        return {
          error: "This public session request is already confirmed.",
          code: "SESSION_ALREADY_CONFIRMED",
          appointment: normalizedPrior,
        };
      }
      if (!["pending_deposit", "deposit_pending"].includes(normalizedPrior.status)) {
        return {
          error: "That idempotency key belongs to a finalized public session request. Start a new request to book again.",
          code: "IDEMPOTENCY_REQUEST_FINALIZED",
          appointment: normalizedPrior,
        };
      }
      const resumable = normalizedPrior.holdState === "active"
        && new Date(normalizedPrior.holdExpiresAt).getTime() > Date.now();
      return resumable
        ? { appointment: normalizedPrior, bookingType: normalizeBookingType(bookingType), existing: true }
        : {
            error: "The existing checkout hold must be safely released before retrying.",
            code: "PENDING_HOLD_REQUIRES_RELEASE",
            appointment: normalizedPrior,
          };
    }
  }

  const appointmentValues = {
    id,
    submissionId: submissionResult.id,
    bookingTypeId: bookingType.id,
    availabilityWindowId: availability.window.id,
    purpose,
    clientName: validation.client.name,
    clientEmail: validation.client.email,
    clientPhone: validation.client.phone,
    depositCents: bookingType.deposit_cents,
    currency: bookingType.currency || "USD",
    holdExpiresAt: holdExpiryFromNow(),
    now,
    eventMetadata: { publicSession: true, purpose },
  };
  const inserted = submissionResult.created
    ? await insertDirectPublicSession(db, submissionResult.record, appointmentValues, submissionResult.eventNote)
    : await insertPendingAppointment(db, appointmentValues);
  if (!inserted) {
    if (submissionResult.record?.idempotencyKey) {
      const racedSubmission = await createPublicConsultationSubmission(db, body, validation.client, bookingType);
      if (racedSubmission.error) return racedSubmission;
      const racedAppointment = await db.prepare(
        `SELECT * FROM appointments WHERE submission_id = ?
         ORDER BY created_at DESC LIMIT 1`
      ).bind(racedSubmission.id).first();
      if (racedAppointment) {
        const normalizedRaced = normalizeAppointment(racedAppointment);
        const resumable = normalizedRaced.status !== "confirmed"
          && normalizedRaced.holdState === "active"
          && new Date(normalizedRaced.holdExpiresAt).getTime() > Date.now();
        if (resumable) {
          return { appointment: normalizedRaced, bookingType: normalizeBookingType(bookingType), existing: true };
        }
        if (!["pending_deposit", "deposit_pending", "confirmed"].includes(normalizedRaced.status)) {
          return {
            error: "That idempotency key belongs to a finalized public session request. Start a new request to book again.",
            code: "IDEMPOTENCY_REQUEST_FINALIZED",
            appointment: normalizedRaced,
          };
        }
        return {
          error: normalizedRaced.status === "confirmed"
            ? "This public session request is already confirmed."
            : "The existing checkout hold must be safely released before retrying.",
          code: normalizedRaced.status === "confirmed"
            ? "SESSION_ALREADY_CONFIRMED"
            : "PENDING_HOLD_REQUIRES_RELEASE",
          appointment: normalizedRaced,
        };
      }
    }
    return { error: "That appointment time has already been claimed." };
  }

  const appointment = await selectAppointmentWithMeeting(db, id);
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

async function handlePublicSessionCheckoutForTypes(request, env, allowedTypeIds, label) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  body._idempotencyKey = asOptionalString(
    request.headers.get("idempotency-key") || body.idempotencyKey || body.idempotency_key
  );

  try {
    const db = requireBookingDb(env);
    const result = await createPublicConsultationAppointment(db, body, allowedTypeIds);
    if (result.spam) return json({ ok: true, spam: true });
    if (result.error) return errorResponse(result.error, result.code ? 409 : 400, {
      ...(result.code ? { code: result.code } : {}),
      ...(result.appointment ? { appointment: result.appointment } : {}),
    });
    await mirrorAppointmentToCrm(db, result.appointment);
    await captureMarketingConsent(env, {
      email: result.appointment.clientEmail,
      phone: result.appointment.clientPhone,
      emailOptIn: body.newsletter_consent,
      source: "website_booking",
      sourceId: result.appointment.id,
      formPath: new URL(request.url).pathname,
      requestId: request.headers.get("cf-ray") || "",
    }).catch((error) => {
      console.error("Unable to record optional booking marketing consent.", error);
    });
    if (result.existing && result.appointment.squareCheckoutUrl) {
      return json({
        ok: true,
        checkoutUrl: result.appointment.squareCheckoutUrl,
        appointmentId: result.appointment.id,
        holdExpiresAt: result.appointment.holdExpiresAt,
        resumed: true,
      });
    }

    let paymentLink;
    try {
      paymentLink = await createSquarePaymentLink(request, env, result.appointment, result.bookingType);
    } catch (error) {
      await db
        .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
        .bind("deposit_pending", new Date().toISOString(), result.appointment.id)
        .run();
      return errorResponse("Deposit checkout is not configured yet.", 503, {
        detail: error.message,
        appointment: result.appointment,
      });
    }

    const paymentSaved = await savePendingPaymentLink(db, result.appointment, paymentLink);
    if (!paymentSaved) {
      await invalidateUnsavedPaymentLink(env, paymentLink);
      return errorResponse("This checkout hold expired before Square checkout was created. Choose the time again.", 409, {
        code: "HOLD_EXPIRED",
        appointmentId: result.appointment.id,
      });
    }

    return json({
      ok: true,
      checkoutUrl: paymentLink.url,
      appointmentId: result.appointment.id,
      holdExpiresAt: result.appointment.holdExpiresAt,
    });
  } catch (error) {
    return errorResponse(`Unable to start ${label} checkout.`, 500, {
      detail: error.message,
    });
  }
}

export function handlePublicConsultationCheckout(request, env) {
  return handlePublicSessionCheckoutForTypes(request, env, PUBLIC_CONSULTATION_BOOKING_TYPE_IDS, "consultation");
}

export function handlePublicSessionCheckout(request, env) {
  return handlePublicSessionCheckoutForTypes(request, env, PUBLIC_SESSION_BOOKING_TYPE_IDS, "session");
}

/* ------------------------------------------------------------------ */
/* Public studio booking (open visits / gatherings / external rentals) */
/* Mirrors the public consultation pipeline; deposits route to the      */
/* dedicated studio Square location via createSquarePaymentLink.         */
/* ------------------------------------------------------------------ */

async function studioBookingTypes(db, requestedTypeIds = STUDIO_BOOKING_TYPE_IDS) {
  const ids = (requestedTypeIds || []).filter((id) => STUDIO_BOOKING_TYPE_IDS.includes(id));
  const allowedIds = ids.length ? ids : STUDIO_BOOKING_TYPE_IDS;
  const placeholders = allowedIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE id IN (${placeholders}) AND active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .bind(...allowedIds)
    .all();
  return (result.results || []).map(normalizeBookingType);
}

function studioClientFromBody(body) {
  const firstName = asString(body.firstName || body.first_name);
  const lastName = asString(body.lastName || body.last_name);
  const name = asString(body.name) || [firstName, lastName].filter(Boolean).join(" ").trim();
  return {
    name,
    email: asString(body.email).toLowerCase(),
    phone: asOptionalString(body.phone),
    preferredName: asOptionalString(body.preferredName || body.preferred_name),
    pronouns: asOptionalString(body.pronouns),
    instagram: asOptionalString(body.instagram),
    preferredContactMethod: asOptionalString(
      body.preferredContactMethod || body.preferred_contact_method
    ),
    referralSource: asOptionalString(body.referralSource || body.referral_source),
    organization: asOptionalString(body.organization),
    details: asOptionalString(body.details || body.message),
    understand: asString(body.understand),
  };
}

function validatePublicStudio(body) {
  if (asString(body._gotcha)) return { spam: true };
  const client = studioClientFromBody(body);
  if (!client.name) return { error: "Name is required." };
  if (!client.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    return { error: "A valid email is required." };
  }
  if (!client.phone) return { error: "Phone number is required." };
  if (client.understand !== "yes") {
    return { error: "Please acknowledge the studio booking terms." };
  }
  if (!STUDIO_BOOKING_TYPE_IDS.includes(asString(body.bookingTypeId))) {
    return { error: "Please select a studio booking type." };
  }
  if (!asString(body.availabilityWindowId)) {
    return { error: "Please select an available time." };
  }
  return { client };
}

export async function handlePublicStudioContext(request, env) {
  try {
    const db = requireBookingDb(env);
    const requestedTypes = new URL(request.url).searchParams.getAll("type");
    const bookingTypes = await studioBookingTypes(db, requestedTypes);
    if (!bookingTypes.length) {
      return errorResponse("Studio booking is not configured.", 503);
    }
    const windows = await listPublicWindows(db, bookingTypes);
    return json({
      ok: true,
      bookingType: bookingTypes[0],
      bookingTypes,
      availabilityWindows: windows,
      walkInWindows: [],
    });
  } catch (error) {
    return errorResponse("Unable to load studio availability.", 500, {
      detail: error.message,
    });
  }
}

async function createPublicStudioSubmission(db, body, client, bookingType) {
  const idempotencyKey = asOptionalString(body._idempotencyKey || body.idempotencyKey || body.idempotency_key);
  if (idempotencyKey) {
    const existing = await db.prepare("SELECT * FROM submissions WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first();
    if (existing) {
      const existingPayload = parseJsonField(existing.payload_json, {});
      const sameIdentity = existing.type === "studio_booking"
        && asString(existing.contact_email).toLowerCase() === client.email
        && asString(existingPayload.booking_type_id) === bookingType.id
        && asString(existingPayload.availability_window_id) === asString(body.availabilityWindowId);
      if (!sameIdentity) {
        return {
          error: "That idempotency key was already used for a different studio booking request.",
          code: "IDEMPOTENCY_IDENTITY_MISMATCH",
        };
      }
      return { id: existing.id, created: false, existingRow: existing };
    }
  }
  const id = crypto.randomUUID();
  const sourcePath = "/booking/studio/";
  const subject = "New Studio Booking Request";
  const payload = {
    type: "studio_booking",
    source_path: sourcePath,
    subject,
    firstName: asString(body.firstName || body.first_name),
    lastName: asString(body.lastName || body.last_name),
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    preferred_name: client.preferredName || "",
    pronouns: client.pronouns || "",
    instagram: client.instagram || "",
    preferred_contact_method: client.preferredContactMethod || "",
    referral_source: client.referralSource || "",
    organization: client.organization || "",
    details: client.details || "",
    availability_window_id: asString(body.availabilityWindowId),
    booking_type_id: bookingType.id,
    booking_type_label: bookingType.label,
    deposit_label: formatMoney(bookingType.deposit_cents, bookingType.currency || "USD"),
    understand: client.understand,
  };
  const contact = {
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    preferredName: client.preferredName || "",
    pronouns: client.pronouns || "",
    instagram: client.instagram || "",
    preferredContactMethod: client.preferredContactMethod || "",
    referralSource: client.referralSource || "",
  };

  return {
    id,
    created: true,
    record: {
      id,
      type: "studio_booking",
      sourcePath,
      subject,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone,
      contact,
      payload,
      internalNotes: client.details || "",
      idempotencyKey,
    },
    eventNote: "Created from public studio booking checkout.",
  };
}

async function createPublicStudioAppointment(db, body) {
  const bookingTypeId = asString(body.bookingTypeId);
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType || !STUDIO_BOOKING_TYPE_IDS.includes(bookingType.id)) {
    return { error: "Studio booking is not configured." };
  }

  const validation = validatePublicStudio(body);
  if (validation.spam) return { spam: true };
  if (validation.error) return validation;

  const windowId = asString(body.availabilityWindowId);
  const existingForClient = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_type_id = ?
         AND availability_window_id = ?
         AND lower(client_email) = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(bookingType.id, windowId, validation.client.email)
    .first();
  if (existingForClient) {
    const normalizedExisting = normalizeAppointment(existingForClient);
    const resumable = normalizedExisting.holdState === "active"
      && new Date(normalizedExisting.holdExpiresAt).getTime() > Date.now();
    if (!resumable) {
      return {
        error: "A prior studio checkout must be safely released before choosing another time.",
        code: "PENDING_HOLD_REQUIRES_RELEASE",
        appointment: normalizedExisting,
      };
    }
    return {
      appointment: normalizedExisting,
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const submissionResult = await createPublicStudioSubmission(
    db,
    body,
    validation.client,
    bookingType
  );
  if (submissionResult.error) return submissionResult;
  if (!submissionResult.created) {
    const priorAppointment = await db.prepare(
      `SELECT * FROM appointments WHERE submission_id = ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(submissionResult.id).first();
    if (priorAppointment) {
      const normalizedPrior = normalizeAppointment(priorAppointment);
      if (normalizedPrior.status === "confirmed") {
        return {
          error: "This studio booking request is already confirmed.",
          code: "SESSION_ALREADY_CONFIRMED",
          appointment: normalizedPrior,
        };
      }
      if (!["pending_deposit", "deposit_pending"].includes(normalizedPrior.status)) {
        return {
          error: "That idempotency key belongs to a finalized studio booking request. Start a new request to book again.",
          code: "IDEMPOTENCY_REQUEST_FINALIZED",
          appointment: normalizedPrior,
        };
      }
      const resumable = normalizedPrior.holdState === "active"
        && new Date(normalizedPrior.holdExpiresAt).getTime() > Date.now();
      return resumable
        ? { appointment: normalizedPrior, bookingType: normalizeBookingType(bookingType), existing: true }
        : {
            error: "The existing studio checkout hold must be safely released before retrying.",
            code: "PENDING_HOLD_REQUIRES_RELEASE",
            appointment: normalizedPrior,
          };
    }
  }
  const appointmentValues = {
    id,
    submissionId: submissionResult.id,
    bookingTypeId: bookingType.id,
    availabilityWindowId: availability.window.id,
    purpose: "studio",
    clientName: validation.client.name,
    clientEmail: validation.client.email,
    clientPhone: validation.client.phone,
    depositCents: bookingType.deposit_cents,
    currency: bookingType.currency || "USD",
    holdExpiresAt: holdExpiryFromNow(),
    now,
    eventMetadata: { publicSession: true, purpose: "studio" },
  };
  const inserted = submissionResult.created
    ? await insertDirectPublicSession(db, submissionResult.record, appointmentValues, submissionResult.eventNote)
    : await insertPendingAppointment(db, appointmentValues);
  if (!inserted) {
    if (submissionResult.record?.idempotencyKey) {
      const racedSubmission = await createPublicStudioSubmission(db, body, validation.client, bookingType);
      if (racedSubmission.error) return racedSubmission;
      const racedAppointment = await db.prepare(
        `SELECT * FROM appointments WHERE submission_id = ?
         ORDER BY created_at DESC LIMIT 1`
      ).bind(racedSubmission.id).first();
      if (racedAppointment) {
        const normalizedRaced = normalizeAppointment(racedAppointment);
        const resumable = normalizedRaced.status !== "confirmed"
          && normalizedRaced.holdState === "active"
          && new Date(normalizedRaced.holdExpiresAt).getTime() > Date.now();
        if (resumable) {
          return { appointment: normalizedRaced, bookingType: normalizeBookingType(bookingType), existing: true };
        }
        if (!["pending_deposit", "deposit_pending", "confirmed"].includes(normalizedRaced.status)) {
          return {
            error: "That idempotency key belongs to a finalized studio booking request. Start a new request to book again.",
            code: "IDEMPOTENCY_REQUEST_FINALIZED",
            appointment: normalizedRaced,
          };
        }
        return {
          error: normalizedRaced.status === "confirmed"
            ? "This studio booking request is already confirmed."
            : "The existing studio checkout hold must be safely released before retrying.",
          code: normalizedRaced.status === "confirmed"
            ? "SESSION_ALREADY_CONFIRMED"
            : "PENDING_HOLD_REQUIRES_RELEASE",
          appointment: normalizedRaced,
        };
      }
    }
    return { error: "That appointment time has already been claimed." };
  }

  const appointment = await selectAppointmentWithMeeting(db, id);
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

export async function handlePublicStudioCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  body._idempotencyKey = asOptionalString(
    request.headers.get("idempotency-key") || body.idempotencyKey || body.idempotency_key
  );

  try {
    const db = requireBookingDb(env);
    const result = await createPublicStudioAppointment(db, body);
    if (result.spam) return json({ ok: true, spam: true });
    if (result.error) return errorResponse(result.error, result.code ? 409 : 400, {
      ...(result.code ? { code: result.code } : {}),
      ...(result.appointment ? { appointment: result.appointment } : {}),
    });
    await mirrorAppointmentToCrm(db, result.appointment);
    await captureMarketingConsent(env, {
      email: result.appointment.clientEmail,
      phone: result.appointment.clientPhone,
      emailOptIn: body.newsletter_consent,
      source: "website_booking",
      sourceId: result.appointment.id,
      formPath: new URL(request.url).pathname,
      requestId: request.headers.get("cf-ray") || "",
    }).catch((error) => {
      console.error("Unable to record optional studio-booking marketing consent.", error);
    });
    if (result.existing && result.appointment.squareCheckoutUrl) {
      return json({
        ok: true,
        checkoutUrl: result.appointment.squareCheckoutUrl,
        appointmentId: result.appointment.id,
        holdExpiresAt: result.appointment.holdExpiresAt,
        resumed: true,
      });
    }

    let paymentLink;
    try {
      paymentLink = await createSquarePaymentLink(request, env, result.appointment, result.bookingType);
    } catch (error) {
      await db
        .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
        .bind("deposit_pending", new Date().toISOString(), result.appointment.id)
        .run();
      return errorResponse("Deposit checkout is not configured yet.", 503, {
        detail: error.message,
        appointment: result.appointment,
      });
    }

    const paymentSaved = await savePendingPaymentLink(db, result.appointment, paymentLink);
    if (!paymentSaved) {
      await invalidateUnsavedPaymentLink(env, paymentLink);
      return errorResponse("This checkout hold expired before Square checkout was created. Choose the time again.", 409, {
        code: "HOLD_EXPIRED",
        appointmentId: result.appointment.id,
      });
    }

    return json({
      ok: true,
      checkoutUrl: paymentLink.url,
      appointmentId: result.appointment.id,
      holdExpiresAt: result.appointment.holdExpiresAt,
    });
  } catch (error) {
    return errorResponse("Unable to start studio booking checkout.", 500, {
      detail: error.message,
    });
  }
}

export async function handleCreateBookingHold(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    let context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);
    if (context.purpose === "tattoo") {
      const sessionPlanCheck = await ensureSessionPlanResponse(db, context);
      if (sessionPlanCheck.error) return errorResponse(sessionPlanCheck.error, 409);
    }
    const clientClaim = await claimDirectInviteClient(db, context, body);
    if (clientClaim.error) return errorResponse(clientClaim.error, clientClaim.status);
    context = clientClaim.context;

    const result = await createPendingAppointment(
      db,
      context,
      asString(body.bookingTypeId),
      asString(body.availabilityWindowId),
      0,
      body.extendedDayAcknowledged === true
    );
    if (result.error) return errorResponse(result.error, result.code ? 409 : 400, {
      ...(result.code ? { code: result.code } : {}),
      ...(result.appointment ? { appointment: result.appointment } : {}),
    });
    if (context.pendingSpecialApproval) {
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(
          `UPDATE submissions
           SET payload_json = json_set(payload_json,
                 '$.held_appointment_id', ?,
                 '$.held_start_at', ?,
                 '$.held_end_at', ?,
                 '$.approval_hold_expires_at', ?),
               updated_at = ?
           WHERE id = ? AND type = 'tattoo_special' AND status = 'new' AND tattoo_stage = 'review'`
        ).bind(
          result.appointment.id,
          result.appointment.startAt,
          result.appointment.endAt,
          result.appointment.holdExpiresAt,
          now,
          context.token.submission_id,
        ),
        db.prepare(
          `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
           SELECT ?, id, 'special_time_held', 'client', ?, ? FROM submissions
           WHERE id = ? AND NOT EXISTS (
             SELECT 1 FROM submission_events existing
             WHERE existing.submission_id = submissions.id AND existing.event_type = 'special_time_held'
           )`
        ).bind(
          crypto.randomUUID(),
          `${result.appointment.startAt} - ${result.appointment.endAt}`,
          now,
          context.token.submission_id,
        ),
      ]);
      const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?")
        .bind(context.token.submission_id)
        .first();
      await Promise.allSettled([
        notifySubmissionReceived(env, submission, {
          idempotencyKey: `submission_received:${context.token.submission_id}:${result.appointment.id}`,
        }),
        notifyAdminSubmissionReceived(env, submission, {
          idempotencyKey: `admin_submission_received:${context.token.submission_id}:${result.appointment.id}`,
        }),
      ]);
    }
    return json({
      ok: true,
      appointment: result.appointment,
      pendingApproval: Boolean(context.pendingSpecialApproval),
    });
  } catch (error) {
    return errorResponse("Unable to create booking hold.", 500, {
      detail: error.message,
    });
  }
}

function squareBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareConfigured(env) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

function isStudioBookingType(bookingTypeId) {
  return STUDIO_BOOKING_TYPE_IDS.includes(bookingTypeId);
}

// Studio bookings settle to a dedicated Square location (own bank/EIN) while
// sharing the same Square API token — the same isolation events use.
function squareLocationForBookingType(env, bookingTypeId) {
  return isStudioBookingType(bookingTypeId)
    ? asString(env.SQUARE_STUDIO_LOCATION_ID)
    : asString(env.SQUARE_LOCATION_ID);
}

function squareConfiguredForBookingType(env, bookingTypeId) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && squareLocationForBookingType(env, bookingTypeId));
}

function readinessItem(id, label, ready, message, details = {}) {
  return {
    id,
    label,
    ready: Boolean(ready),
    status: ready ? "ready" : "needs_attention",
    message,
    details,
  };
}

function requiredPositiveSetting(settings, key) {
  return Number(settings?.[key] || 0) > 0;
}

async function tableReady(db, tableName) {
  try {
    await db.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

function squareWebhookNotificationUrl(request, env) {
  return asString(env.SQUARE_WEBHOOK_NOTIFICATION_URL) || `${baseUrlFromRequest(request)}/api/square/webhook`;
}

function studioSquareWebhookNotificationUrl(request, env) {
  return asString(env.SQUARE_STUDIO_WEBHOOK_NOTIFICATION_URL) || `${baseUrlFromRequest(request)}/api/square-studio/webhook`;
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function squareWebhookSignature(rawBody, signatureKey, notificationUrl) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${notificationUrl}${rawBody}`)
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifySquareSignature(request, rawBody, signatureKey, notificationUrl) {
  if (!signatureKey) return { ok: false, status: 503, error: "Square webhook is not configured." };
  const squareSignature = request.headers.get("x-square-hmacsha256-signature") || "";
  const expected = await squareWebhookSignature(rawBody, signatureKey, notificationUrl);
  if (!timingSafeEqual(expected, squareSignature)) {
    return { ok: false, status: 403, error: "Invalid Square webhook signature." };
  }
  return { ok: true };
}

async function verifySquareWebhookRequest(request, env, rawBody) {
  return verifySquareSignature(
    request,
    rawBody,
    asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    squareWebhookNotificationUrl(request, env)
  );
}

async function verifyStudioSquareWebhookRequest(request, env, rawBody) {
  return verifySquareSignature(
    request,
    rawBody,
    asString(env.SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY),
    studioSquareWebhookNotificationUrl(request, env)
  );
}

function squareMoney(amount, currency) {
  return {
    amount,
    currency,
  };
}

function squareLineItem(name, amount, currency) {
  return {
    name,
    quantity: "1",
    base_price_money: squareMoney(amount, currency),
  };
}

async function createSquarePaymentLink(request, env, appointment, bookingType, options = {}) {
  if (!squareConfiguredForBookingType(env, bookingType.id)) {
    throw new Error("Square is not configured.");
  }

  const redirectUrl = new URL(confirmationPathForBookingType(bookingType.id), baseUrlFromRequest(request));
  redirectUrl.searchParams.set("appointment", appointment.id);

  const response = await fetch(`${squareBaseUrl(env)}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: asString(options.idempotencyKey) || appointment.id,
      order: {
        location_id: squareLocationForBookingType(env, bookingType.id),
        line_items: [
          squareLineItem(
            FULL_PAYMENT_BOOKING_TYPE_IDS.includes(bookingType.id)
              ? `${bookingType.label} Reservation Fee`
              : `${bookingType.label} Deposit`,
            appointment.depositCents,
            appointment.currency,
          ),
          ...(appointment.tipCents > 0
            ? [squareLineItem("Optional Artist Tip", appointment.tipCents, appointment.currency)]
            : []),
        ],
      },
      checkout_options: {
        redirect_url: redirectUrl.toString(),
        ask_for_shipping_address: false,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.detail || "Square checkout failed.");
  }
  return payload.payment_link;
}

async function savePendingPaymentLink(db, appointment, paymentLink) {
  const now = new Date().toISOString();
  const paymentId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `UPDATE appointments
       SET status = 'deposit_pending', square_order_id = ?, square_payment_link_id = ?,
           square_checkout_url = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending_deposit','deposit_pending')
         AND hold_state = 'active' AND hold_expires_at > ?`
    ).bind(
      paymentLink.order_id || null,
      paymentLink.id || null,
      paymentLink.url,
      now,
      appointment.id,
      now,
    ),
    db.prepare(
      `INSERT INTO deposit_payments (
        id, appointment_id, provider, provider_checkout_id, provider_order_id,
        amount_cents, tip_cents, currency, status, raw_json, created_at, updated_at
      )
      SELECT ?, id, 'square', ?, ?, ?, ?, ?, 'pending', ?, ?, ?
      FROM appointments
      WHERE id = ? AND hold_state = 'active' AND hold_expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM deposit_payments dp
          WHERE dp.appointment_id = appointments.id
            AND dp.provider_checkout_id = ?
        )`
    ).bind(
      paymentId,
      paymentLink.id || null,
      paymentLink.order_id || null,
      appointment.totalDueCents,
      appointment.tipCents || 0,
      appointment.currency,
      JSON.stringify(paymentLink),
      now,
      now,
      appointment.id,
      now,
      paymentLink.id || null,
    ),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'checkout_created', 'system', NULL, ?, ?
      FROM appointments
      WHERE id = ? AND hold_state = 'active' AND hold_expires_at > ?`
    ).bind(
      eventId,
      JSON.stringify({ squarePaymentLinkId: paymentLink.id || "" }),
      now,
      appointment.id,
      now,
    ),
  ]);
  const saved = Number(results?.[0]?.meta?.changes || 0) > 0;
  if (saved) {
    const updatedAppointment = await selectAppointmentWithMeeting(db, appointment.id);
    if (updatedAppointment) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(updatedAppointment), {
        includePayment: true,
      });
    }
  }
  return saved;
}

function normalizeTattooRenderingRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    appointmentId: row.appointment_id,
    requestNumber: Number(row.request_number || 0),
    amountCents: Number(row.amount_cents || TATTOO_RENDERING_FEE_CENTS),
    currency: row.currency || TATTOO_RENDERING_CURRENCY,
    status: row.status,
    squareOrderId: row.square_order_id || "",
    squarePaymentLinkId: row.square_payment_link_id || "",
    checkoutUrl: row.square_checkout_url || "",
    squarePaymentId: row.square_payment_id || "",
    expiresAt: row.expires_at || "",
    paidAt: row.paid_at || "",
    cancelledAt: row.cancelled_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectTattooRenderingRequest(db, requestId) {
  return db.prepare(
    `SELECT trr.*, a.client_name, a.client_email, a.start_at, a.end_at,
            a.status AS appointment_status, a.purpose AS appointment_purpose,
            s.type AS submission_type
     FROM tattoo_rendering_requests trr
     JOIN appointments a ON a.id = trr.appointment_id
     JOIN submissions s ON s.id = trr.submission_id
     WHERE trr.id = ?`
  ).bind(requestId).first();
}

async function createTattooRenderingSquarePaymentLink(request, env, renderingRequest) {
  if (!squareConfigured(env)) throw new Error("Square is not configured.");
  const redirectUrl = new URL("/booking/confirmed/", baseUrlFromRequest(request));
  redirectUrl.searchParams.set("appointment", renderingRequest.appointment_id);
  const response = await fetch(`${squareBaseUrl(env)}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: renderingRequest.id,
      order: {
        location_id: asString(env.SQUARE_LOCATION_ID),
        line_items: [
          squareLineItem(
            "Additional Tattoo Concept Sketch",
            TATTOO_RENDERING_FEE_CENTS,
            TATTOO_RENDERING_CURRENCY,
          ),
        ],
      },
      checkout_options: {
        redirect_url: redirectUrl.toString(),
        ask_for_shipping_address: false,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.errors?.[0]?.detail || "Square rendering-fee checkout failed.");
  return payload.payment_link;
}

async function updatePendingRenderingExpiry(db, appointmentId, expiresAt) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE tattoo_rendering_requests SET expires_at = ?, updated_at = ?
     WHERE appointment_id = ? AND status = 'pending'`
  ).bind(expiresAt, now, appointmentId).run();
}

async function invalidatePendingRenderingRequestsForAppointment(db, env, appointmentId, actor, reason) {
  const pending = (await db.prepare(
    `SELECT * FROM tattoo_rendering_requests
     WHERE appointment_id = ? AND status = 'pending' ORDER BY created_at`
  ).bind(appointmentId).all()).results || [];
  const summary = { cancelled: 0, attention: 0 };
  for (const row of pending) {
    const now = new Date().toISOString();
    let needsAttention = false;
    try {
      if (row.square_payment_link_id) await invalidateSquarePaymentLink(env, row.square_payment_link_id);
      const result = await db.prepare(
        `UPDATE tattoo_rendering_requests
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(now, now, row.id).run();
      if (Number(result?.meta?.changes || 0) > 0) summary.cancelled += 1;
    } catch (error) {
      needsAttention = true;
      const result = await db.prepare(
        `UPDATE tattoo_rendering_requests
         SET status = 'payment_attention', raw_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(JSON.stringify({ reason, error: error.message }), now, row.id).run();
      if (Number(result?.meta?.changes || 0) > 0) summary.attention += 1;
    }
    await db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      appointmentId,
      needsAttention ? "tattoo_rendering_payment_attention" : "tattoo_rendering_cancelled",
      actor,
      reason,
      JSON.stringify({ renderingRequestId: row.id }),
      now,
    ).run();
  }
  return summary;
}

async function selectAppointmentWithMeeting(db, appointmentId) {
  return db
    .prepare(
      `SELECT a.*, bt.label AS booking_type_label, s.type AS submission_type,
              tst.offer_title AS special_offer_title, tst.variant_label AS special_variant_label,
              tst.approved_price_cents AS special_approved_price_cents,
              tst.advertised_price_cents AS special_advertised_price_cents,
              tst.duration_minutes AS special_duration_minutes,
              CASE WHEN a.status IN ('pending_deposit','deposit_pending','cancelled','archived')
                AND NOT EXISTS (
                  SELECT 1 FROM deposit_payments protected_payment
                  WHERE protected_payment.appointment_id = a.id
                    AND (
                      lower(protected_payment.status) IN ('paid','completed','settled','payment_attention')
                      OR trim(COALESCE(protected_payment.provider_payment_id, '')) <> ''
                    )
                )
                AND NOT EXISTS (
                  SELECT 1 FROM tattoo_rendering_requests protected_rendering
                  WHERE protected_rendering.appointment_id = a.id
                    AND (
                      protected_rendering.status IN ('paid','payment_attention')
                      OR trim(COALESCE(protected_rendering.square_payment_id, '')) <> ''
                    )
                )
                AND NOT EXISTS (
                  SELECT 1 FROM archive_tattoo_session_refs archive_session
                  WHERE archive_session.appointment_id = a.id
                )
                THEN 1 ELSE 0 END AS can_permanently_delete,
              am.provider AS meeting_provider,
              am.provider_meeting_id,
              am.join_url AS meeting_join_url,
              am.password AS meeting_password,
              am.created_at AS meeting_created_at,
              am.updated_at AS meeting_updated_at
       FROM appointments a
       LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
       LEFT JOIN submissions s ON s.id = a.submission_id
       LEFT JOIN tattoo_special_submission_terms tst ON tst.submission_id = a.submission_id
       LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
       WHERE a.id = ?`
    )
    .bind(appointmentId)
    .first();
}

function zoomConfigured(env) {
  return Boolean(
    asString(env.ZOOM_ACCOUNT_ID) &&
    asString(env.ZOOM_CLIENT_ID) &&
    asString(env.ZOOM_CLIENT_SECRET) &&
    asString(env.ZOOM_HOST_USER_ID)
  );
}

function zoomBasicAuth(env) {
  return btoa(`${asString(env.ZOOM_CLIENT_ID)}:${asString(env.ZOOM_CLIENT_SECRET)}`);
}

async function createZoomAccessToken(env) {
  if (!zoomConfigured(env)) {
    throw new Error("Zoom is not configured.");
  }
  const body = new URLSearchParams();
  body.set("grant_type", "account_credentials");
  body.set("account_id", asString(env.ZOOM_ACCOUNT_ID));

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${zoomBasicAuth(env)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.reason || payload.error_description || payload.message || "Zoom OAuth failed.");
  }
  if (!payload.access_token) {
    throw new Error("Zoom OAuth did not return an access token.");
  }
  return payload.access_token;
}

function appointmentDurationMinutes(appointment, bookingType) {
  const configured = Number(bookingType.durationMinutes || bookingType.duration_minutes || 0);
  if (configured > 0) return configured;
  const diff = new Date(appointment.endAt || appointment.end_at).getTime() - new Date(appointment.startAt || appointment.start_at).getTime();
  return Math.max(1, Math.round(diff / 60000));
}

function zoomLocalStartTime(value, timezone = DEFAULT_CALENDAR_TIME_ZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Appointment start time is invalid.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}:${local.second}`;
}

async function createZoomMeeting(env, appointment, bookingType) {
  const token = await createZoomAccessToken(env);
  const host = encodeURIComponent(asString(env.ZOOM_HOST_USER_ID));
  const clientName = appointment.clientName || appointment.client_name || "Client";
  const label = bookingType.label || bookingType.booking_type_label || "Virtual Consultation";
  const timezone = DEFAULT_CALENDAR_TIME_ZONE;
  const response = await fetch(`https://api.zoom.us/v2/users/${host}/meetings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: `${label} - ${clientName}`,
      type: 2,
      start_time: zoomLocalStartTime(appointment.startAt || appointment.start_at, timezone),
      duration: appointmentDurationMinutes(appointment, bookingType),
      timezone,
      agenda: "Virtual consultation booked through The Six Well Construct.",
      password: "",
      settings: {
        waiting_room: true,
        join_before_host: false,
        approval_type: 2,
        registrants_email_notification: false,
        meeting_authentication: false,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.reason || "Zoom meeting creation failed.");
  }
  if (!payload.join_url) {
    throw new Error("Zoom meeting did not return a join URL.");
  }
  return payload;
}

async function saveAppointmentMeeting(db, appointmentId, meeting) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO appointment_meetings (
        id, appointment_id, provider, provider_meeting_id, join_url, password,
        raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appointment_id, provider) DO UPDATE SET
        provider_meeting_id = excluded.provider_meeting_id,
        join_url = excluded.join_url,
        password = excluded.password,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at`
    )
    .bind(
      crypto.randomUUID(),
      appointmentId,
      "zoom",
      asString(meeting.id || meeting.uuid),
      asString(meeting.join_url),
      asString(meeting.password),
      JSON.stringify(meeting),
      now,
      now
    )
    .run();
}

async function createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType) {
  if ((bookingType.id || bookingType.booking_type_id) !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) {
    return null;
  }
  const meeting = await createZoomMeeting(env, appointment, bookingType);
  await saveAppointmentMeeting(db, appointment.id, meeting);
  return meeting;
}

// Creates the Zoom meeting only after payment is confirmed, so a failed/abandoned
// checkout never leaves an orphaned meeting on the host's Zoom account.
async function maybeCreateVirtualMeeting(db, env, appointmentRow) {
  if (appointmentRow.booking_type_id !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) {
    return { created: false, skipped: true };
  }
  if (appointmentRow.meeting_provider) return { created: false, skipped: true };

  const bookingTypeRow = await db
    .prepare("SELECT label, duration_minutes, currency FROM booking_types WHERE id = ?")
    .bind(appointmentRow.booking_type_id)
    .first();
  const appointment = normalizeAppointment(appointmentRow);
  const bookingType = {
    id: appointmentRow.booking_type_id,
    label: bookingTypeRow?.label || "Virtual Consultation",
    durationMinutes: bookingTypeRow?.duration_minutes || 0,
    currency: bookingTypeRow?.currency || "USD",
  };

  try {
    const meeting = await createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType);
    return { created: true, meeting };
  } catch (error) {
    console.warn("Unable to create Zoom meeting for confirmed appointment.", appointment.id, error.message);
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      ) VALUES (?, ?, 'zoom_creation_attention', 'system', ?, '{}', ?)`
    ).bind(
      crypto.randomUUID(),
      appointment.id,
      asString(error.message).slice(0, 1000),
      now,
    ).run().catch((eventError) => {
      console.warn("Unable to record Zoom creation attention.", appointment.id, eventError.message);
    });
    return { created: false, error: error.message };
  }
}

async function deleteZoomMeeting(env, providerMeetingId) {
  if (!providerMeetingId) return { deleted: true, skipped: true };
  if (!zoomConfigured(env)) throw new Error("Zoom is not configured, so the remote meeting could not be deleted.");
  const token = await createZoomAccessToken(env);
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(providerMeetingId)}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Zoom meeting deletion failed (${response.status}).`);
  }
  return { deleted: true, alreadyMissing: response.status === 404 };
}

async function invalidateUnsavedPaymentLink(env, paymentLink) {
  const paymentLinkId = asString(paymentLink?.id);
  if (!paymentLinkId) return;
  try {
    await invalidateSquarePaymentLink(env, paymentLinkId);
  } catch (error) {
    console.warn("Unable to invalidate an unclaimed Square payment link.", paymentLinkId, error.message);
  }
}

export async function handleCreateBookingCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    let context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);
    if (context.pendingSpecialApproval) {
      return errorResponse("Studio approval is required before the Tattoo Special deposit can be paid.", 409, {
        code: "SPECIAL_APPROVAL_REQUIRED",
      });
    }
    if (context.purpose === "tattoo") {
      const sessionPlanCheck = await ensureSessionPlanResponse(db, context);
      if (sessionPlanCheck.error) return errorResponse(sessionPlanCheck.error, 409);
    }
    const clientClaim = await claimDirectInviteClient(db, context, body);
    if (clientClaim.error) return errorResponse(clientClaim.error, clientClaim.status);
    context = clientClaim.context;

    const tip = parseTipCents(body.tipCents);
    if (tip.error) return errorResponse(tip.error, 400);

    const result = await createPendingAppointment(
      db,
      context,
      asString(body.bookingTypeId),
      asString(body.availabilityWindowId),
      tip.tipCents,
      body.extendedDayAcknowledged === true
    );
    if (result.error) return errorResponse(result.error, result.code ? 409 : 400, {
      ...(result.code ? { code: result.code } : {}),
      ...(result.appointment ? { appointment: result.appointment } : {}),
    });
    if (result.existing && result.appointment.squareCheckoutUrl) {
      return json({
        ok: true,
        checkoutUrl: result.appointment.squareCheckoutUrl,
        appointmentId: result.appointment.id,
        holdExpiresAt: result.appointment.holdExpiresAt,
      });
    }

    let paymentLink;
    try {
      paymentLink = await createSquarePaymentLink(request, env, result.appointment, result.bookingType);
    } catch (error) {
      await db
        .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
        .bind("deposit_pending", new Date().toISOString(), result.appointment.id)
        .run();
      return errorResponse("Deposit checkout is not configured yet.", 503, {
        detail: error.message,
        appointment: result.appointment,
      });
    }

    const paymentSaved = await savePendingPaymentLink(db, result.appointment, paymentLink);
    if (!paymentSaved) {
      await invalidateUnsavedPaymentLink(env, paymentLink);
      return errorResponse("This checkout hold expired before Square checkout was created. Choose the time again.", 409, {
        code: "HOLD_EXPIRED",
        appointmentId: result.appointment.id,
      });
    }

    return json({
      ok: true,
      checkoutUrl: paymentLink.url,
      appointmentId: result.appointment.id,
      holdExpiresAt: result.appointment.holdExpiresAt,
    });
  } catch (error) {
    return errorResponse("Unable to start deposit checkout.", 500, {
      detail: error.message,
    });
  }
}

async function fetchSquareOrder(env, orderId) {
  if (!orderId || !squareConfigured(env)) return null;
  const response = await fetch(`${squareBaseUrl(env)}/v2/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.order || null;
}

export async function createApprovedTattooSpecialDepositCheckout(request, env, submissionId) {
  const db = requireBookingDb(env);
  const row = await db.prepare(
    `SELECT a.*, bt.label AS booking_type_label, s.type AS submission_type,
            t.sales_closes_at, t.offer_title AS special_offer_title,
            t.variant_label AS special_variant_label
     FROM appointments a
     JOIN submissions s ON s.id = a.submission_id
     JOIN tattoo_special_submission_terms t ON t.submission_id = s.id
     JOIN booking_types bt ON bt.id = a.booking_type_id
     WHERE a.submission_id = ? AND s.type = 'tattoo_special'
       AND s.status = 'approved' AND s.tattoo_stage = 'ready_to_book'
       AND a.status IN ('pending_deposit','deposit_pending')
       AND a.hold_state = 'active'
       AND a.approval_state IN ('pending','approved')
     ORDER BY a.created_at DESC LIMIT 1`
  ).bind(submissionId).first();
  if (!row) throw new Error("The client must select an available time before this Tattoo Special can be approved.");
  if (new Date(row.hold_expires_at).getTime() <= Date.now()) {
    throw new Error("The requested time is no longer held. Ask the client to select another time.");
  }
  if (row.square_checkout_url && row.square_payment_link_id) {
    return {
      appointment: normalizeAppointment(row),
      checkoutUrl: row.square_checkout_url,
      paymentDueAt: row.payment_due_at || row.hold_expires_at,
      existing: true,
    };
  }

  const salesCloseMs = new Date(row.sales_closes_at).getTime();
  const paymentDueMs = Math.min(Date.now() + 24 * 60 * 60 * 1000, salesCloseMs);
  if (!Number.isFinite(paymentDueMs) || paymentDueMs <= Date.now()) {
    throw new Error("The Tattoo Specials payment window has closed.");
  }
  const paymentDueAt = new Date(paymentDueMs).toISOString();
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE appointments
     SET approval_state = 'approved', approval_decided_at = COALESCE(approval_decided_at, ?),
         payment_due_at = ?, hold_expires_at = ?, updated_at = ?
     WHERE id = ? AND hold_state = 'active' AND approval_state IN ('pending','approved')`
  ).bind(now, paymentDueAt, paymentDueAt, now, row.id).run();

  const appointmentRow = await selectAppointmentWithMeeting(db, row.id);
  const appointment = normalizeAppointment(appointmentRow || row);
  const bookingType = await db.prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(appointment.bookingTypeId)
    .first();
  if (!bookingType) throw new Error("The Tattoo Special booking type is unavailable.");

  const paymentLink = await createSquarePaymentLink(request, env, appointment, bookingType);
  const saved = await savePendingPaymentLink(db, appointment, paymentLink);
  if (!saved) {
    await invalidateUnsavedPaymentLink(env, paymentLink);
    throw new Error("The approval hold expired before the deposit link could be created.");
  }
  const updated = await selectAppointmentWithMeeting(db, row.id);
  return {
    appointment: normalizeAppointment(updated || appointmentRow || row),
    checkoutUrl: paymentLink.url,
    paymentDueAt,
    existing: false,
  };
}

async function fetchSquareOrderForReconciliation(env, orderId) {
  if (!orderId || !env.SQUARE_ACCESS_TOKEN) {
    throw new Error("Square order reconciliation is not configured.");
  }
  const response = await fetch(`${squareBaseUrl(env)}/v2/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.order) {
    throw new Error(payload.errors?.[0]?.detail || `Square reconciliation failed (${response.status}).`);
  }
  return payload.order;
}

async function invalidateSquarePaymentLink(env, paymentLinkId) {
  if (!paymentLinkId || !env.SQUARE_ACCESS_TOKEN) {
    throw new Error("Square checkout invalidation is not configured.");
  }
  const response = await fetch(
    `${squareBaseUrl(env)}/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`,
    {
      method: "DELETE",
      headers: {
        "Square-Version": "2026-05-20",
        "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      },
    }
  );
  if (response.ok || response.status === 404) {
    return { invalidated: true, alreadyMissing: response.status === 404 };
  }
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.errors?.[0]?.detail || `Square checkout invalidation failed (${response.status}).`);
}

async function markHoldExpiryAttention(db, appointmentRow, message, now) {
  const results = await db.batch([
    db.prepare(
      `UPDATE appointments
       SET hold_state = 'expiry_attention', cancellation_reason = ?, updated_at = ?
       WHERE id = ? AND hold_state IN ('active','expiry_attention')
         AND status IN ('pending_deposit','deposit_pending')`
    ).bind(asString(message).slice(0, 1000), now, appointmentRow.id),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'hold_expiry_attention', 'reaper', ?, ?, ? FROM appointments
      WHERE id = ? AND hold_state = 'expiry_attention' AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      asString(message).slice(0, 1000),
      JSON.stringify({
        squareOrderId: appointmentRow.square_order_id || appointmentRow.payment_order_id || "",
        paymentLinkId: appointmentRow.payment_link_id || "",
      }),
      now,
      appointmentRow.id,
      now,
    ),
  ]);
  return Number(results?.[0]?.meta?.changes || 0) > 0;
}

async function insertDirectPublicSession(db, submission, appointment, submissionEventNote) {
  const dayGuard = await bookingDayGuardForWindow(db, appointment.availabilityWindowId);
  if (!dayGuard) return false;
  const capacityPredicate = `
    aw.id = ? AND aw.active = 1 AND aw.is_blackout = 0
    AND (aw.booking_type_id IS NULL OR aw.booking_type_id = ?)
    AND aw.start_at > ?
    AND (
      SELECT COUNT(*) FROM appointments day_appointment
      WHERE day_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
        AND day_appointment.start_at >= ? AND day_appointment.start_at < ?
    ) < ?
    AND NOT EXISTS (
      SELECT 1 FROM availability_windows blackout
      WHERE blackout.active = 1 AND blackout.is_blackout = 1
        AND unixepoch(blackout.start_at) - COALESCE(blackout.buffer_before_minutes, 0) * 60
          < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
        AND unixepoch(blackout.end_at) + COALESCE(blackout.buffer_after_minutes, 0) * 60
          > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
    )
    AND (
      SELECT COUNT(*) FROM appointments overlap_appointment
      LEFT JOIN availability_windows overlap_window
        ON overlap_window.id = overlap_appointment.availability_window_id
      WHERE overlap_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
        AND unixepoch(overlap_appointment.start_at) - COALESCE(overlap_window.buffer_before_minutes, 0) * 60
          < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
        AND unixepoch(overlap_appointment.end_at) + COALESCE(overlap_window.buffer_after_minutes, 0) * 60
          > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
    ) < ${isExclusiveTattooBookingType(appointment.bookingTypeId) ? "1" : "aw.capacity"}
    AND (
      SELECT COUNT(*) FROM appointments exact_appointment
      WHERE exact_appointment.availability_window_id = aw.id
        AND exact_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
    ) < aw.capacity`;
  const capacityBindings = [
    appointment.availabilityWindowId,
    appointment.bookingTypeId,
    appointment.now,
    dayGuard.startAt,
    dayGuard.endAt,
    dayGuard.maxBookingsPerDay,
  ];
  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO submissions (
        id, type, status, source_path, subject, contact_name, contact_email,
        contact_phone, contact_json, payload_json, request_meta_json,
        files_json, internal_notes, booking_url, tattoo_stage, idempotency_key,
        created_at, updated_at
      )
      SELECT ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '', NULL, ?, ?, ?
      FROM availability_windows aw WHERE ${capacityPredicate}`
    ).bind(
      submission.id,
      submission.type,
      submission.sourcePath,
      submission.subject,
      submission.clientName,
      submission.clientEmail,
      submission.clientPhone || null,
      JSON.stringify(submission.contact),
      JSON.stringify(submission.payload),
      JSON.stringify({ publicBooking: true }),
      submission.internalNotes || "",
      submission.idempotencyKey || null,
      appointment.now,
      appointment.now,
      ...capacityBindings,
    ),
    db.prepare(
      `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
       SELECT ?, id, 'created', 'system', ?, ? FROM submissions WHERE id = ?`
    ).bind(crypto.randomUUID(), submissionEventNote, appointment.now, submission.id),
    db.prepare(
      `INSERT OR IGNORE INTO appointments (
        id, submission_id, booking_type_id, availability_window_id, status, purpose,
        client_name, client_email, client_phone, start_at, end_at, deposit_cents,
        tip_cents, currency, hold_expires_at, hold_state, created_at, updated_at
      )
      SELECT ?, s.id, ?, aw.id, 'pending_deposit', ?, ?, ?, ?, aw.start_at, aw.end_at,
             ?, 0, ?, ?, 'active', ?, ?
      FROM availability_windows aw JOIN submissions s ON s.id = ?
      WHERE ${capacityPredicate}
        AND NOT EXISTS (
          SELECT 1 FROM appointments direct_hold
          WHERE direct_hold.submission_id = s.id AND direct_hold.purpose = ?
            AND direct_hold.replacement_for_appointment_id IS NULL
            AND direct_hold.status IN ('pending_deposit','deposit_pending','confirmed')
            AND (
              direct_hold.status = 'confirmed'
              OR direct_hold.hold_state IN ('active','expiry_attention')
            )
        )`
    ).bind(
      appointment.id,
      appointment.bookingTypeId,
      appointment.purpose,
      appointment.clientName,
      appointment.clientEmail,
      appointment.clientPhone || null,
      appointment.depositCents,
      appointment.currency || "USD",
      appointment.holdExpiresAt,
      appointment.now,
      appointment.now,
      submission.id,
      ...capacityBindings,
      appointment.purpose,
    ),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'hold_created', 'system', NULL, ?, ? FROM appointments WHERE id = ?`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({ publicSession: true, purpose: appointment.purpose }),
      appointment.now,
      appointment.id,
    ),
  ]);
  return Number(results?.[0]?.meta?.changes || 0) > 0
    && Number(results?.[2]?.meta?.changes || 0) > 0;
}

async function expireBookingHold(db, appointmentRow, now) {
  const purpose = appointmentRow.purpose || purposeForBookingType(
    appointmentRow.booking_type_id,
    Boolean(appointmentRow.booking_token_id),
  );
  const statements = [
    db.prepare(
      `UPDATE appointments
       SET status = 'cancelled', hold_state = 'expired', hold_reconciled_at = ?,
           cancelled_at = ?, cancellation_reason = 'Checkout hold expired unpaid', updated_at = ?
       WHERE id = ? AND hold_state = 'active' AND hold_expires_at <= ?
         AND status IN ('pending_deposit','deposit_pending')`
    ).bind(now, now, now, appointmentRow.id, now),
    db.prepare(
      `UPDATE deposit_payments SET status = 'cancelled', updated_at = ?
       WHERE appointment_id = ? AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM appointments a WHERE a.id = deposit_payments.appointment_id
             AND a.hold_state = 'expired' AND a.updated_at = ?
         )`
    ).bind(now, appointmentRow.id, now),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'hold_expired', 'reaper', 'Checkout hold expired unpaid', ?, ?
      FROM appointments WHERE id = ? AND hold_state = 'expired' AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({
        squareOrderId: appointmentRow.square_order_id || appointmentRow.payment_order_id || "",
        paymentLinkId: appointmentRow.payment_link_id || "",
      }),
      now,
      appointmentRow.id,
      now,
    ),
  ];
  if (
    appointmentRow.submission_id &&
    !appointmentRow.replacement_for_appointment_id &&
    ["standalone_consultation", "build_session", "studio"].includes(purpose)
  ) {
    statements.push(db.prepare(
      `UPDATE submissions SET status = 'cancelled', booking_url = '', updated_at = ?
       WHERE id = ? AND status = 'new'
         AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.hold_state = 'expired')`
    ).bind(now, appointmentRow.submission_id, appointmentRow.id));
  }
  const results = await db.batch(statements);
  const expired = Number(results?.[0]?.meta?.changes || 0) > 0;
  if (expired) {
    const updated = await selectAppointmentWithMeeting(db, appointmentRow.id);
    if (updated) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(updated), {
        includePayment: true,
      });
    }
  }
  return expired;
}

export async function reapExpiredBookingHolds(env) {
  const db = requireBookingDb(env);
  const now = new Date().toISOString();
  const result = await db.prepare(
    `SELECT a.*,
       (
         SELECT dp.provider_checkout_id FROM deposit_payments dp
         WHERE dp.appointment_id = a.id AND dp.status = 'pending'
         ORDER BY dp.created_at DESC LIMIT 1
       ) AS payment_link_id,
       (
         SELECT dp.provider_order_id FROM deposit_payments dp
         WHERE dp.appointment_id = a.id AND dp.status = 'pending'
         ORDER BY dp.created_at DESC LIMIT 1
       ) AS payment_order_id
     FROM appointments a
     WHERE a.hold_state = 'active' AND a.hold_expires_at <= ?
       AND a.status IN ('pending_deposit','deposit_pending')
     ORDER BY a.hold_expires_at ASC LIMIT 100`
  ).bind(now).all();
  const summary = { checked: 0, confirmed: 0, expired: 0, attention: 0 };
  for (const row of result.results || []) {
    summary.checked += 1;
    try {
      const orderId = row.square_order_id || row.payment_order_id;
      const hasCheckout = Boolean(row.square_checkout_url || row.payment_link_id || orderId);
      if (!hasCheckout) {
        if (await expireBookingHold(db, row, now)) summary.expired += 1;
        continue;
      }
      if (!orderId || !row.payment_link_id) {
        throw new Error("Pending checkout is missing the Square order or payment-link identifier.");
      }
      const order = await fetchSquareOrderForReconciliation(env, orderId);
      if (orderLooksPaid(order)) {
        const base = asString(env.PUBLIC_SITE_URL) || "https://thesixwellconstruct.com";
        const request = new Request(new URL(`/api/booking/confirm?appointment=${encodeURIComponent(row.id)}`, base));
        await confirmPaidAppointment(db, env, request, row, order);
        summary.confirmed += 1;
      } else {
        await invalidateSquarePaymentLink(env, row.payment_link_id);
        if (await expireBookingHold(db, row, now)) summary.expired += 1;
      }
    } catch (error) {
      if (await markHoldExpiryAttention(db, row, error.message, now)) summary.attention += 1;
    }
  }
  return summary;
}

function orderLooksPaid(order) {
  if (!order) return false;
  return order.state === "COMPLETED";
}

async function confirmPaidAppointment(db, env, request, appointmentRow, order, paymentId = "") {
  const appointment = normalizeAppointment(appointmentRow);
  const now = new Date().toISOString();
  const wasConfirmed = appointment.status === "confirmed";
  if (wasConfirmed || appointment.status === "completed") {
    if (appointment.replacementForAppointmentId) {
      await cleanupZoomMeetingForAppointment(db, env, appointment.replacementForAppointmentId);
      try {
        const originalAfterReplacement = await selectAppointmentWithMeeting(
          db,
          appointment.replacementForAppointmentId,
        );
        if (originalAfterReplacement) {
          await mirrorAppointmentToCrm(db, normalizeAppointment(originalAfterReplacement), {
            includePayment: true,
          });
        }
      } catch (error) {
        console.warn(JSON.stringify({
          event: "crm.live_mirror_failed",
          sourceType: "appointment",
          sourceId: String(appointment.replacementForAppointmentId),
          errorName: error?.name || "Error",
        }));
      }
    }
    const currentAppointment = normalizeAppointment(
      await selectAppointmentWithMeeting(db, appointment.id) || appointmentRow
    );
    await mirrorAppointmentToCrm(db, currentAppointment, { includePayment: true });
    return currentAppointment;
  }

  const statements = [
    db.prepare(
      `UPDATE appointments
       SET status = 'confirmed', hold_state = 'converted', hold_reconciled_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending_deposit','deposit_pending')
         AND (hold_state = 'active' OR hold_state = 'expiry_attention')
         AND (
           booking_token_id IS NULL
           OR EXISTS (
             SELECT 1 FROM booking_tokens active_token
             WHERE active_token.id = appointments.booking_token_id
               AND active_token.revoked_at IS NULL
           )
         )
         AND (
           replacement_for_appointment_id IS NULL
           OR EXISTS (
             SELECT 1 FROM appointments original
             WHERE original.id = appointments.replacement_for_appointment_id
               AND original.status = 'confirmed'
               AND original.reschedule_count = 0
               AND original.replaced_by_appointment_id IS NULL
           )
         )
         AND (
           purpose IN ('standalone_consultation','build_session','studio')
           OR (purpose = 'tattoo' AND EXISTS (
             SELECT 1 FROM submissions s
             WHERE s.id = appointments.submission_id
               AND s.status IN ('approved','booked')
               AND (
                 s.tattoo_stage = 'ready_to_book'
                 OR (appointments.replacement_for_appointment_id IS NOT NULL AND s.tattoo_stage = 'tattoo_scheduled')
               )
           ))
           OR (purpose = 'prerequisite_consultation' AND EXISTS (
             SELECT 1 FROM submissions s
             WHERE s.id = appointments.submission_id
               AND s.status = 'approved'
               AND (
                 s.tattoo_stage = 'consultation_required'
                 OR (appointments.replacement_for_appointment_id IS NOT NULL AND s.tattoo_stage = 'consultation_scheduled')
               )
           ))
         )`
    ).bind(now, now, appointment.id),
    db.prepare(
      `UPDATE deposit_payments
       SET status = 'paid', provider_payment_id = COALESCE(?, provider_payment_id),
           raw_json = ?, updated_at = ?
       WHERE appointment_id = ?
         AND EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.id = deposit_payments.appointment_id
             AND a.status = 'confirmed' AND a.updated_at = ?
         )`
    ).bind(paymentId || null, JSON.stringify(order || {}), now, appointment.id, now),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'payment_confirmed', 'system', NULL, ?, ?
      FROM appointments WHERE id = ? AND status = 'confirmed' AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({ paymentId: paymentId || "", squareOrderId: appointment.squareOrderId || "" }),
      now,
      appointment.id,
      now,
    ),
  ];
  if (appointment.bookingTokenId) {
    statements.push(
      db.prepare(
        `UPDATE booking_tokens SET used_at = COALESCE(used_at, ?), updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.id = ? AND a.status = 'confirmed' AND a.updated_at = ?
         )`
      ).bind(now, now, appointment.bookingTokenId, appointment.id, now)
    );
  }
  if (appointment.submissionId) {
    if (appointment.purpose === "tattoo") {
      statements.push(db.prepare(
        `UPDATE submissions
         SET status = 'booked', tattoo_stage = 'tattoo_scheduled', booking_url = ?, updated_at = ?
         WHERE id = ? AND status IN ('approved','booked')
           AND tattoo_stage IN ('ready_to_book','tattoo_scheduled')
           AND EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = ? AND a.status = 'confirmed' AND a.updated_at = ?
           )`
      ).bind(
        `${confirmationPathForBookingType(appointment.bookingTypeId)}?appointment=${appointment.id}`,
        now,
        appointment.submissionId,
        appointment.id,
        now,
      ));
    } else if (appointment.purpose === "prerequisite_consultation") {
      statements.push(db.prepare(
        `UPDATE submissions
         SET tattoo_stage = 'consultation_scheduled', booking_url = ?, updated_at = ?
         WHERE id = ? AND status = 'approved'
           AND tattoo_stage IN ('consultation_required','consultation_scheduled')
           AND EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = ? AND a.status = 'confirmed' AND a.updated_at = ?
           )`
      ).bind(
        `${confirmationPathForBookingType(appointment.bookingTypeId)}?appointment=${appointment.id}`,
        now,
        appointment.submissionId,
        appointment.id,
        now,
      ));
    } else {
      statements.push(db.prepare(
        `UPDATE submissions
         SET status = 'booked', booking_url = ?, updated_at = ?
         WHERE id = ? AND status IN ('new','approved','booked')
           AND EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = ? AND a.status = 'confirmed' AND a.updated_at = ?
           )`
      ).bind(
        `${confirmationPathForBookingType(appointment.bookingTypeId)}?appointment=${appointment.id}`,
        now,
        appointment.submissionId,
        appointment.id,
        now,
      ));
    }
    statements.push(db.prepare(
      `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
       SELECT ?, id, 'appointment_confirmed', 'system', ?, ? FROM submissions
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM appointments a
         WHERE a.id = ? AND a.status = 'confirmed' AND a.updated_at = ?
       )`
    ).bind(
      crypto.randomUUID(),
      `${appointment.purpose}:${appointment.id}`,
      now,
      appointment.submissionId,
      appointment.id,
      now,
    ));
  }
  if (appointment.replacementForAppointmentId) {
    statements.push(
      db.prepare(
        `UPDATE appointments
         SET status = 'cancelled', replaced_by_appointment_id = ?, reschedule_count = 1,
             cancelled_at = ?, cancellation_reason = 'Replaced after paid reschedule checkout',
             hold_state = CASE WHEN hold_state = 'active' THEN 'released' ELSE hold_state END,
             updated_at = ?
         WHERE id = ? AND status = 'confirmed'
           AND EXISTS (
             SELECT 1 FROM appointments replacement
             WHERE replacement.id = ? AND replacement.status = 'confirmed'
               AND replacement.updated_at = ?
               AND replacement.replacement_for_appointment_id = appointments.id
           )`
      ).bind(
        appointment.id,
        now,
        now,
        appointment.replacementForAppointmentId,
        appointment.id,
        now,
      ),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        )
        SELECT ?, id, 'replaced', 'system', ?, ?, ? FROM appointments
        WHERE id = ? AND replaced_by_appointment_id = ?
          AND EXISTS (
            SELECT 1 FROM appointments replacement
            WHERE replacement.id = ? AND replacement.status = 'confirmed'
              AND replacement.updated_at = ?
          )`
      ).bind(
        crypto.randomUUID(),
        `Replaced by ${appointment.id} after payment confirmation.`,
        JSON.stringify({ replacementAppointmentId: appointment.id }),
        now,
        appointment.replacementForAppointmentId,
        appointment.id,
        appointment.id,
        now,
      ),
      db.prepare(
        `UPDATE tattoo_rendering_requests
         SET appointment_id = ?, expires_at = ?, updated_at = ?
         WHERE appointment_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM appointments replacement
             WHERE replacement.id = ? AND replacement.status = 'confirmed'
               AND replacement.updated_at = ?
           )`
      ).bind(
        appointment.id,
        appointment.startAt,
        now,
        appointment.replacementForAppointmentId,
        appointment.id,
        now,
      )
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO notification_deliveries (
        id, channel, template_key, recipient, subject, related_type,
        related_id, idempotency_key, status, error, sent_at, created_at
      )
      SELECT ?, 'email', 'admin_appointment_confirmed', ?, NULL, 'appointment',
             id, ?, 'pending', NULL, NULL, ?
      FROM appointments
      WHERE id = ? AND status = 'confirmed' AND updated_at = ?
      ON CONFLICT(idempotency_key) DO NOTHING`
    ).bind(
      crypto.randomUUID(),
      env.ADMIN_NOTIFICATION_EMAIL || env.NOTIFICATION_REPLY_TO || DEFAULT_SUPPORT_EMAIL,
      `admin_appointment_confirmed:${appointment.id}`,
      now,
      appointment.id,
      now,
    )
  );

  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes || 0) < 1) {
    throw new Error("Appointment is no longer eligible for payment confirmation.");
  }

  if (appointment.replacementForAppointmentId) {
    await cleanupZoomMeetingForAppointment(db, env, appointment.replacementForAppointmentId);
    try {
      const originalAfterReplacement = await selectAppointmentWithMeeting(
        db,
        appointment.replacementForAppointmentId,
      );
      if (originalAfterReplacement) {
        await mirrorAppointmentToCrm(db, normalizeAppointment(originalAfterReplacement), {
          includePayment: true,
        });
      }
    } catch (error) {
      // The paid replacement remains authoritative even if its original
      // appointment cannot be mirrored to the owner-only CRM immediately.
      console.warn(JSON.stringify({
        event: "crm.live_mirror_failed",
        sourceType: "appointment",
        sourceId: String(appointment.replacementForAppointmentId),
        errorName: error?.name || "Error",
      }));
    }
  }
  const appointmentWithMeeting = await selectAppointmentWithMeeting(db, appointment.id);
  await maybeCreateVirtualMeeting(db, env, appointmentWithMeeting || appointmentRow);
  const appointmentWithType = await selectAppointmentWithMeeting(db, appointment.id);
  await mirrorAppointmentToCrm(
    db,
    normalizeAppointment(appointmentWithType || appointmentRow),
    { includePayment: true },
  );
  await Promise.all([
    notifyAppointmentConfirmed(env, request, appointmentWithType || appointmentRow),
    notifyAdminAppointmentConfirmed(env, request, appointmentWithType || appointmentRow),
  ]);

  const updated = await selectAppointmentWithMeeting(db, appointment.id);
  return normalizeAppointment(updated || appointmentRow);
}

export async function handleConfirmBooking(request, env) {
  try {
    const db = requireBookingDb(env);
    const appointmentId = new URL(request.url).searchParams.get("appointment") || "";
    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);

    let appointment = normalizeAppointment(appointmentRow);
    const paymentRow = await db.prepare(
      `SELECT status FROM deposit_payments
       WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(appointment.id).first();
    const canConfirm = ["pending_deposit", "deposit_pending"].includes(appointment.status);
    let squarePaid = false;
    if (canConfirm) {
      const order = await fetchSquareOrder(env, appointment.squareOrderId);
      squarePaid = orderLooksPaid(order);
      if (squarePaid) appointment = await confirmPaidAppointment(db, env, request, appointmentRow, order);
    }
    const depositStatus = squarePaid
      || paymentRow?.status === "paid"
      || ["confirmed", "completed"].includes(appointment.status)
      ? "paid"
      : (paymentRow?.status || (canConfirm ? "pending" : appointment.status));

    const hoursUntilStart = (new Date(appointment.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
    const tattooSettings = await db.prepare(
      "SELECT support_email FROM tattoo_settings WHERE id = 'default'"
    ).first();
    const sessionPlan = appointment.submissionId
      ? await loadTattooSessionPlan(db, appointment.submissionId)
      : null;

    return json({
      ok: true,
      appointment,
      pricingSummary: pricingSummaryForAppointment(sessionPlan, appointment),
      depositStatus,
      supportEmail: tattooSettings?.support_email || env.NOTIFICATION_REPLY_TO || DEFAULT_SUPPORT_EMAIL,
      hoursUntilStart,
      ...(depositStatus === "paid" && appointment.replacementForAppointmentId ? {
        replacedAppointmentCalendarUrl: appointmentCalendarUrl(env, request, {
          id: appointment.replacementForAppointmentId,
        }),
      } : {}),
    });
  } catch (error) {
    return errorResponse("Unable to confirm booking.", 500, {
      detail: error.message,
    });
  }
}

export async function handleBookingCalendar(request, env) {
  try {
    const db = requireBookingDb(env);
    const appointmentId = new URL(request.url).searchParams.get("appointment") || "";
    if (!appointmentId) return errorResponse("Appointment reference is required.", 400);

    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);

    const appointment = normalizeAppointment(appointmentRow);
    const isReplacementCancellation = appointment.status === "cancelled"
      && Boolean(appointment.replacedByAppointmentId);
    if (appointment.status !== "confirmed" && !isReplacementCancellation) {
      return errorResponse("Calendar is available after payment confirmation.", 403);
    }
    if (!isReplacementCancellation && isVirtualAppointment(appointment) && !appointment.meeting?.joinUrl) {
      return errorResponse("Calendar is available once the Zoom meeting is ready.", 409);
    }

    return new Response(
      isReplacementCancellation
        ? buildCancelledAppointmentIcs(appointment)
        : buildAppointmentIcs(env, request, appointment),
      {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": isReplacementCancellation
          ? 'attachment; filename="art-pill-cancelled-appointment.ics"'
          : 'attachment; filename="art-pill-appointment.ics"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("Unable to create calendar event.", 500, {
      detail: error.message,
    });
  }
}

export async function handleCancelAppointment(request, env, options = {}) {
  const body = options.body || await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const appointmentId = asString(options.appointmentId || body.appointmentId);
    const email = asString(body.email).toLowerCase();
    const actor = options.actor === "admin" ? "admin" : "client";
    if (!appointmentId || (actor !== "admin" && !email)) {
      return errorResponse("Appointment id and email are required.", 400);
    }

    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);
    if (actor !== "admin" && asString(appointmentRow.client_email).toLowerCase() !== email) {
      return errorResponse("That email does not match this booking.", 403);
    }
    if (["cancelled", "archived"].includes(appointmentRow.status)) {
      return errorResponse("This appointment has already been cancelled.", 400);
    }
    if (appointmentRow.status !== "confirmed") {
      return errorResponse("Pending checkouts must be released through the payment-safe hold release action.", 409, {
        code: "USE_PENDING_HOLD_RELEASE",
      });
    }
    if (actor !== "admin" && new Date(appointmentRow.start_at).getTime() <= Date.now()) {
      return errorResponse("This appointment has already passed and cannot be cancelled online.", 400);
    }

    if (!appointmentRow.replacement_for_appointment_id) {
      const pendingReplacement = await pendingReplacementForAppointment(db, appointmentId);
      if (pendingReplacement) {
        const release = await safelyReleasePendingHold(
          db,
          env,
          request,
          pendingReplacement,
          actor,
          "Replacement checkout released because the original appointment was cancelled",
        );
        if (release.paid) {
          return errorResponse("The replacement checkout was already paid; cancel the replacement appointment instead.", 409, {
            code: "REPLACEMENT_ALREADY_PAID",
            appointment: release.appointment,
          });
        }
        if (!release.released) {
          return errorResponse("The pending replacement could not be safely released. The original appointment remains confirmed.", 409, {
            code: "REPLACEMENT_RELEASE_ATTENTION",
            detail: release.error || "Studio review is required.",
          });
        }
      }
    }

    const renderingCancellation = await invalidatePendingRenderingRequestsForAppointment(
      db,
      env,
      appointmentId,
      actor,
      "Appointment cancelled; unpaid additional-rendering links were invalidated.",
    );
    const now = new Date().toISOString();
    const reason = asString(body.reason).slice(0, 500) || (actor === "admin" ? "Cancelled by Studio" : "Cancelled by client");
    const appointmentPurpose = appointmentRow.purpose || purposeForBookingType(appointmentRow.booking_type_id, Boolean(appointmentRow.booking_token_id));
    const statements = [
      db.prepare(
        `UPDATE appointments
         SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?,
             hold_state = CASE WHEN hold_state IN ('active','expiry_attention') THEN 'released' ELSE hold_state END,
             hold_reconciled_at = COALESCE(hold_reconciled_at, ?), updated_at = ?
         WHERE id = ? AND status NOT IN ('cancelled','archived','completed')`
      ).bind(now, reason, now, now, appointmentId),
      db.prepare(
        `UPDATE deposit_payments SET status = 'cancelled', updated_at = ?
         WHERE appointment_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = deposit_payments.appointment_id
               AND a.status = 'cancelled' AND a.updated_at = ?
           )`
      ).bind(now, appointmentId, now),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        )
        SELECT ?, id, 'cancelled', ?, ?, ?, ? FROM appointments
        WHERE id = ? AND status = 'cancelled' AND updated_at = ?`
      ).bind(
        crypto.randomUUID(),
        actor,
        reason,
        JSON.stringify({ previousStatus: appointmentRow.status }),
        now,
        appointmentId,
        now,
      ),
    ];
    const updatesParentLifecycle = !appointmentRow.replacement_for_appointment_id
      || appointmentRow.status === "confirmed";
    if (appointmentRow.submission_id && updatesParentLifecycle) {
      if (appointmentPurpose === "tattoo") {
        statements.push(db.prepare(
          `UPDATE submissions
           SET status = 'approved', tattoo_stage = 'ready_to_book', booking_url = '', updated_at = ?
           WHERE id = ? AND tattoo_stage = 'tattoo_scheduled'
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'cancelled' AND a.updated_at = ?
             )`
        ).bind(now, appointmentRow.submission_id, appointmentId, now));
      } else if (appointmentPurpose === "prerequisite_consultation") {
        statements.push(db.prepare(
          `UPDATE submissions
           SET tattoo_stage = 'consultation_required', booking_url = '', updated_at = ?
           WHERE id = ? AND tattoo_stage = 'consultation_scheduled'
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'cancelled' AND a.updated_at = ?
             )`
        ).bind(now, appointmentRow.submission_id, appointmentId, now));
      } else {
        statements.push(db.prepare(
          `UPDATE submissions SET status = 'cancelled', booking_url = '', updated_at = ?
           WHERE id = ? AND status IN ('new','approved','booked')
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'cancelled' AND a.updated_at = ?
             )`
        ).bind(now, appointmentRow.submission_id, appointmentId, now));
      }
      statements.push(db.prepare(
        `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
         SELECT ?, id, 'appointment_cancelled', ?, ?, ? FROM submissions
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.id = ? AND a.status = 'cancelled' AND a.updated_at = ?
         )`
      ).bind(
        crypto.randomUUID(),
        actor,
        `${appointmentPurpose}:${appointmentId}`,
        now,
        appointmentRow.submission_id,
        appointmentId,
        now,
      ));
    }
    const cancellationResults = await db.batch(statements);
    if (Number(cancellationResults?.[0]?.meta?.changes || 0) < 1) {
      return errorResponse("This appointment can no longer be cancelled.", 409);
    }

    const meetingCleanup = appointmentRow.meeting_provider === "zoom"
      ? await cleanupZoomMeetingForAppointment(db, env, appointmentId)
      : { cleaned: true, skipped: true };

    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    const appointment = normalizeAppointment(updated || appointmentRow);
    await mirrorAppointmentToCrm(db, appointment, { includePayment: true });
    await notifyAppointmentCancelled(env, request, updated || appointmentRow);

    const hoursUntilStart = (new Date(appointment.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
    const tattooSettings = await db.prepare(
      "SELECT support_email FROM tattoo_settings WHERE id = 'default'"
    ).first();
    return json({
      ok: true,
      appointment,
      hoursUntilStart,
      supportEmail: tattooSettings?.support_email || env.NOTIFICATION_REPLY_TO || DEFAULT_SUPPORT_EMAIL,
      meetingNeedsAttention: !meetingCleanup.cleaned,
      renderingCancellation,
    });
  } catch (error) {
    return errorResponse("Unable to cancel appointment.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCancelAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request) || {};
  return handleCancelAppointment(request, env, {
    actor: "admin",
    appointmentId,
    body,
  });
}

async function cleanupZoomMeetingForAppointment(db, env, appointmentId) {
  const row = await selectAppointmentWithMeeting(db, appointmentId);
  if (!row || row.meeting_provider !== "zoom") return { cleaned: true, skipped: true };
  try {
    if (row.provider_meeting_id) await deleteZoomMeeting(env, row.provider_meeting_id);
    await db.prepare("DELETE FROM appointment_meetings WHERE appointment_id = ? AND provider = 'zoom'")
      .bind(appointmentId)
      .run();
    return { cleaned: true };
  } catch (error) {
    console.warn("Unable to delete Zoom meeting.", row.provider_meeting_id || appointmentId, error.message);
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      ) VALUES (?, ?, 'zoom_cleanup_attention', 'system', ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      appointmentId,
      error.message,
      JSON.stringify({ providerMeetingId: row.provider_meeting_id || "" }),
      now,
    ).run().catch((eventError) => {
      console.warn("Unable to record Zoom cleanup attention.", appointmentId, eventError.message);
    });
    return { cleaned: false, error: error.message };
  }
}

async function clientOwnedAppointment(db, appointmentId, email) {
  const row = await selectAppointmentWithMeeting(db, appointmentId);
  if (!row) return { error: "Appointment not found.", status: 404 };
  if (asString(row.client_email).toLowerCase() !== asString(email).toLowerCase()) {
    return { error: "That email does not match this booking.", status: 403 };
  }
  return { row };
}

async function pendingCheckoutIdentifiers(db, appointmentId) {
  return db.prepare(
    `SELECT provider_checkout_id AS payment_link_id,
            provider_order_id AS payment_order_id
     FROM deposit_payments
     WHERE appointment_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(appointmentId).first();
}

async function releasePendingBookingHold(db, appointmentRow, actor, reason) {
  const now = new Date().toISOString();
  const purpose = appointmentRow.purpose || purposeForBookingType(
    appointmentRow.booking_type_id,
    Boolean(appointmentRow.booking_token_id),
  );
  const statements = [
    db.prepare(
      `UPDATE appointments
       SET status = 'cancelled', hold_state = 'released', hold_reconciled_at = ?,
           cancelled_at = ?, cancellation_reason = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending_deposit','deposit_pending')
         AND hold_state IN ('active','expiry_attention')`
    ).bind(now, now, reason, now, appointmentRow.id),
    db.prepare(
      `UPDATE deposit_payments SET status = 'cancelled', updated_at = ?
       WHERE appointment_id = ? AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM appointments a WHERE a.id = deposit_payments.appointment_id
             AND a.hold_state = 'released' AND a.updated_at = ?
         )`
    ).bind(now, appointmentRow.id, now),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'hold_released', ?, ?, ?, ? FROM appointments
      WHERE id = ? AND hold_state = 'released' AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      actor,
      reason,
      JSON.stringify({ purpose, squareOrderId: appointmentRow.square_order_id || appointmentRow.payment_order_id || "" }),
      now,
      appointmentRow.id,
      now,
    ),
  ];
  if (
    appointmentRow.submission_id
    && !appointmentRow.replacement_for_appointment_id
    && ["standalone_consultation", "build_session", "studio"].includes(purpose)
  ) {
    statements.push(db.prepare(
      `UPDATE submissions
       SET status = 'cancelled', booking_url = '', updated_at = ?
       WHERE id = ? AND status = 'new'
         AND EXISTS (
           SELECT 1 FROM appointments released
           WHERE released.id = ? AND released.submission_id = submissions.id
             AND released.hold_state = 'released' AND released.updated_at = ?
             AND released.replacement_for_appointment_id IS NULL
             AND released.purpose IN ('standalone_consultation','build_session','studio')
         )`
    ).bind(now, appointmentRow.submission_id, appointmentRow.id, now));
  }
  if (appointmentRow.submission_id) {
    statements.push(db.prepare(
      `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
       SELECT ?, id, 'checkout_hold_released', ?, ?, ? FROM submissions
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM appointments a WHERE a.id = ? AND a.hold_state = 'released'
       )`
    ).bind(
      crypto.randomUUID(),
      actor,
      `${purpose}:${appointmentRow.id}`,
      now,
      appointmentRow.submission_id,
      appointmentRow.id,
    ));
  }
  const results = await db.batch(statements);
  const released = Number(results?.[0]?.meta?.changes || 0) > 0;
  if (released) {
    const updated = await selectAppointmentWithMeeting(db, appointmentRow.id);
    if (updated) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(updated), {
        includePayment: true,
      });
    }
  }
  return released;
}

async function safelyReleasePendingHold(db, env, request, appointmentRow, actor, reason) {
  const payment = await pendingCheckoutIdentifiers(db, appointmentRow.id);
  const reconciliationRow = {
    ...appointmentRow,
    payment_link_id: payment?.payment_link_id || "",
    payment_order_id: payment?.payment_order_id || "",
  };
  const orderId = reconciliationRow.square_order_id || reconciliationRow.payment_order_id;
  const hasCheckout = Boolean(
    reconciliationRow.square_checkout_url || reconciliationRow.payment_link_id || orderId
  );
  try {
    if (hasCheckout) {
      if (!orderId || !reconciliationRow.payment_link_id) {
        throw new Error("Pending checkout is missing the Square order or payment-link identifier.");
      }
      const order = await fetchSquareOrderForReconciliation(env, orderId);
      if (orderLooksPaid(order)) {
        const appointment = await confirmPaidAppointment(db, env, request, appointmentRow, order);
        return { paid: true, appointment };
      }
      await invalidateSquarePaymentLink(env, reconciliationRow.payment_link_id);
    }
    const released = await releasePendingBookingHold(db, reconciliationRow, actor, reason);
    return { released, row: reconciliationRow };
  } catch (error) {
    await markHoldExpiryAttention(db, reconciliationRow, error.message, new Date().toISOString());
    return { attention: true, error: error.message, row: reconciliationRow };
  }
}

export async function handleGetPendingBookingHold(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const owned = await clientOwnedAppointment(db, asString(body.appointmentId), asString(body.email));
    if (owned.error) return errorResponse(owned.error, owned.status);
    const appointment = normalizeAppointment(owned.row);
    if (!["pending_deposit", "deposit_pending"].includes(appointment.status)) {
      return errorResponse("This booking no longer has a pending checkout hold.", 409);
    }
    const active = appointment.holdState === "active" && new Date(appointment.holdExpiresAt).getTime() > Date.now();
    const needsAttention = appointment.holdState === "expiry_attention";
    return json({
      ok: true,
      appointment,
      resumable: active && Boolean(appointment.squareCheckoutUrl),
      needsAttention,
      checkoutUrl: active ? appointment.squareCheckoutUrl : "",
      expiresAt: appointment.holdExpiresAt,
    });
  } catch (error) {
    return errorResponse("Unable to load the pending checkout hold.", 500, { detail: error.message });
  }
}

export async function handleReleasePendingBookingHold(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const owned = await clientOwnedAppointment(db, asString(body.appointmentId), asString(body.email));
    if (owned.error) return errorResponse(owned.error, owned.status);
    if (!["pending_deposit", "deposit_pending"].includes(owned.row.status)) {
      return errorResponse("This booking no longer has a pending checkout hold.", 409);
    }
    if (!["active", "expiry_attention"].includes(owned.row.hold_state)) {
      return errorResponse("This checkout hold has already been released.", 409);
    }

    const payment = await pendingCheckoutIdentifiers(db, owned.row.id);
    const reconciliationRow = {
      ...owned.row,
      payment_link_id: payment?.payment_link_id || "",
      payment_order_id: payment?.payment_order_id || "",
    };
    const orderId = reconciliationRow.square_order_id || reconciliationRow.payment_order_id;
    const hasCheckout = Boolean(
      reconciliationRow.square_checkout_url || reconciliationRow.payment_link_id || orderId
    );
    if (hasCheckout) {
      try {
        if (!orderId || !reconciliationRow.payment_link_id) {
          throw new Error("Pending checkout is missing the Square order or payment-link identifier.");
        }
        const order = await fetchSquareOrderForReconciliation(env, orderId);
        if (orderLooksPaid(order)) {
          const confirmed = await confirmPaidAppointment(db, env, request, owned.row, order);
          return errorResponse("This checkout has already been paid and cannot be released.", 409, {
            code: "CHECKOUT_ALREADY_PAID",
            appointment: confirmed,
          });
        }
        await invalidateSquarePaymentLink(env, reconciliationRow.payment_link_id);
      } catch (error) {
        await markHoldExpiryAttention(db, reconciliationRow, error.message, new Date().toISOString());
        return errorResponse("The checkout could not be safely released. The time remains held for Studio review.", 409, {
          code: "HOLD_RELEASE_ATTENTION",
          detail: error.message,
        });
      }
    }

    const reason = asString(body.reason).slice(0, 500) || "Client released pending checkout to choose another time";
    if (!await releasePendingBookingHold(db, reconciliationRow, "client", reason)) {
      return errorResponse("This checkout hold changed before it could be released.", 409);
    }
    const updated = normalizeAppointment(await selectAppointmentWithMeeting(db, owned.row.id));
    return json({ ok: true, released: true, appointment: updated });
  } catch (error) {
    return errorResponse("Unable to release the pending checkout hold.", 500, { detail: error.message });
  }
}

function rescheduleSummary(appointment) {
  return {
    id: appointment.id,
    bookingTypeId: appointment.bookingTypeId,
    bookingTypeLabel: appointment.bookingTypeLabel,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    purpose: appointment.purpose,
    rescheduleCount: appointment.rescheduleCount,
  };
}

function appointmentCanReschedule(appointment) {
  return appointment.status === "confirmed"
    && appointment.rescheduleCount < 1
    && !appointment.replacedByAppointmentId
    && new Date(appointment.startAt).getTime() > Date.now();
}

function appointmentCanChangeApprovedSpecialTime(appointment) {
  return appointment.isTattooSpecial
    && ["pending_deposit", "deposit_pending"].includes(appointment.status)
    && appointment.approvalState === "approved"
    && appointment.holdState === "active"
    && new Date(appointment.holdExpiresAt).getTime() > Date.now()
    && new Date(appointment.paymentDueAt || appointment.holdExpiresAt).getTime() > Date.now()
    && new Date(appointment.startAt).getTime() > Date.now();
}

async function pendingReplacementForAppointment(db, appointmentId) {
  return db.prepare(
    `SELECT a.*, bt.label AS booking_type_label
     FROM appointments a
     LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
     WHERE a.replacement_for_appointment_id = ?
       AND a.status IN ('pending_deposit','deposit_pending')
       AND a.hold_state IN ('active','expiry_attention')
     ORDER BY a.created_at DESC LIMIT 1`
  ).bind(appointmentId).first();
}

export async function handleRescheduleContext(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const owned = await clientOwnedAppointment(db, asString(body.appointmentId), asString(body.email));
    if (owned.error) return errorResponse(owned.error, owned.status);
    const appointment = normalizeAppointment(owned.row);
    const canChangeSpecialRequest = appointmentCanChangeApprovedSpecialTime(appointment);
    const canReschedule = appointmentCanReschedule(appointment) || canChangeSpecialRequest;
    const bookingTypeRow = await db.prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
      .bind(appointment.bookingTypeId)
      .first();
    if (!bookingTypeRow) return errorResponse("This appointment type is no longer available.", 409);
    const bookingType = normalizeBookingType(bookingTypeRow);
    const availabilityWindows = canReschedule ? await listPublicWindows(db, [bookingType]) : [];
    if (canChangeSpecialRequest && appointment.availabilityWindowId && !availabilityWindows.some((item) => item.id === appointment.availabilityWindowId)) {
      const currentWindow = await db.prepare(
        "SELECT * FROM availability_windows WHERE id = ? AND active = 1 AND is_blackout = 0",
      ).bind(appointment.availabilityWindowId).first();
      if (currentWindow && new Date(currentWindow.start_at).getTime() > Date.now()) {
        availabilityWindows.unshift(normalizeWindow(currentWindow));
      }
    }
    const hoursUntilStart = (new Date(appointment.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
    const pendingRow = await pendingReplacementForAppointment(db, appointment.id);
    const pending = pendingRow ? normalizeAppointment(pendingRow) : null;
    const pendingResumable = Boolean(
      pending
      && pending.holdState === "active"
      && new Date(pending.holdExpiresAt).getTime() > Date.now()
      && pending.squareCheckoutUrl
    );
    const tattooSettings = await db.prepare("SELECT support_email FROM tattoo_settings WHERE id = 'default'").first();
    return json({
      ok: true,
      mode: canChangeSpecialRequest ? "special_request_change" : "appointment_reschedule",
      appointment: rescheduleSummary(appointment),
      bookingType,
      availabilityWindows,
      noticeHours: RESCHEDULE_CUTOFF_HOURS,
      requiresReplacementPayment: canChangeSpecialRequest ? false : hoursUntilStart < RESCHEDULE_CUTOFF_HOURS,
      canReschedule,
      supportEmail: tattooSettings?.support_email || env.NOTIFICATION_REPLY_TO || DEFAULT_SUPPORT_EMAIL,
      pendingCheckout: pending ? {
        appointmentId: pending.id,
        checkoutUrl: pendingResumable ? pending.squareCheckoutUrl : "",
        holdExpiresAt: pending.holdExpiresAt,
        holdState: pending.holdState,
        resumable: pendingResumable,
      } : null,
    });
  } catch (error) {
    return errorResponse("Unable to load reschedule availability.", 500, { detail: error.message });
  }
}

async function createReplacementCheckout(request, env, db, appointmentRow, availabilityWindowId) {
  const original = normalizeAppointment(appointmentRow);
  const hoursUntilStart = (new Date(original.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
  if (original.status !== "confirmed" || hoursUntilStart <= 0) {
    return { error: "Only future confirmed appointments can be moved.", status: 409 };
  }
  if (hoursUntilStart >= RESCHEDULE_CUTOFF_HOURS) {
    return { error: "This appointment can be moved without a replacement payment. Use the standard reschedule action.", status: 409 };
  }
  const existingRow = await pendingReplacementForAppointment(db, original.id);
  if (existingRow) {
    const existing = normalizeAppointment(existingRow);
    const resumable = existing.holdState === "active"
      && new Date(existing.holdExpiresAt).getTime() > Date.now()
      && Boolean(existing.squareCheckoutUrl);
    if (!resumable) {
      return {
        error: "The existing replacement checkout must be safely released before another can be created.",
        status: 409,
        code: "PENDING_HOLD_REQUIRES_RELEASE",
        appointment: existing,
      };
    }
    return {
      existing: true,
      original,
      appointment: existing,
      checkoutUrl: existing.squareCheckoutUrl,
      hoursUntilStart,
    };
  }

  const bookingTypeRow = await db.prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(original.bookingTypeId)
    .first();
  if (!bookingTypeRow) return { error: "This appointment type is no longer available.", status: 409 };
  const availability = await ensureAvailable(db, availabilityWindowId, original.bookingTypeId);
  if (availability.error) return { error: availability.error, status: 409 };
  const now = new Date().toISOString();
  const appointmentId = crypto.randomUUID();
  const inserted = await insertPendingAppointment(db, {
    id: appointmentId,
    submissionId: original.submissionId,
    bookingTypeId: original.bookingTypeId,
    availabilityWindowId: availability.window.id,
    purpose: original.purpose,
    clientName: original.clientName,
    clientEmail: original.clientEmail,
    clientPhone: original.clientPhone,
    depositCents: bookingTypeRow.deposit_cents,
    tipCents: 0,
    sessionFeeCents: bookingTypeRow.session_fee_cents || 0,
    extendedDayAcknowledgedAt: original.extendedDayAcknowledgedAt || (original.bookingTypeId === EXTENDED_DAY_BOOKING_TYPE_ID ? now : null),
    currency: bookingTypeRow.currency || "USD",
    holdExpiresAt: holdExpiryFromNow(),
    replacementForAppointmentId: original.id,
    rescheduleCount: 1,
    originalStartAt: original.originalStartAt || original.startAt,
    originalEndAt: original.originalEndAt || original.endAt,
    now,
    eventType: "replacement_hold_created",
    eventNote: `Replacement checkout for ${original.id}`,
    eventMetadata: { originalAppointmentId: original.id },
  }, "replacement_hold_created");
  if (!inserted) return { error: "That appointment time has already been claimed.", status: 409 };

  const replacementRow = await selectAppointmentWithMeeting(db, appointmentId);
  const replacement = normalizeAppointment(replacementRow);
  const bookingType = normalizeBookingType(bookingTypeRow);
  let paymentLink;
  try {
    paymentLink = await createSquarePaymentLink(request, env, replacement, bookingType);
  } catch (error) {
    await db.batch([
      db.prepare("UPDATE appointments SET status = 'deposit_pending', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), replacement.id),
      db.prepare(
        `INSERT INTO appointment_events (id, appointment_id, event_type, actor, note, metadata_json, created_at)
         VALUES (?, ?, 'checkout_error', 'system', ?, '{}', ?)`
      ).bind(crypto.randomUUID(), replacement.id, error.message, new Date().toISOString()),
    ]);
    return { error: "Replacement checkout is not configured yet.", status: 503, detail: error.message };
  }
  if (!await savePendingPaymentLink(db, replacement, paymentLink)) {
    await invalidateUnsavedPaymentLink(env, paymentLink);
    return { error: "The replacement hold expired before checkout was created.", status: 409 };
  }
  return {
    original,
    appointment: normalizeAppointment(await selectAppointmentWithMeeting(db, replacement.id)),
    checkoutUrl: paymentLink.url,
    hoursUntilStart,
  };
}

async function moveConfirmedAppointment(
  request,
  env,
  db,
  appointmentRow,
  availabilityWindowId,
  actor,
  note = "",
  overridePolicy = false,
) {
  const original = normalizeAppointment(appointmentRow);
  const hoursUntilStart = (new Date(original.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
  if (!overridePolicy && hoursUntilStart < RESCHEDULE_CUTOFF_HOURS) {
    return { error: "This move requires a paid replacement checkout.", status: 409 };
  }
  if (!overridePolicy && original.rescheduleCount >= 1) {
    return { error: "This appointment has already used its reschedule.", status: 409 };
  }
  const availability = await ensureAvailable(
    db,
    availabilityWindowId,
    original.bookingTypeId,
    original.id,
  );
  if (availability.error) return { error: availability.error, status: 409 };
  const dayGuard = await bookingDayGuardForWindow(db, availability.window.id);
  if (!dayGuard) return { error: "That appointment time is unavailable.", status: 409 };

  const now = new Date().toISOString();
  const eventNote = asString(note).slice(0, 2000) || null;
  const results = await db.batch([
    db.prepare(
      `UPDATE appointments
       SET availability_window_id = ?, start_at = ?, end_at = ?,
           original_start_at = COALESCE(original_start_at, start_at),
           original_end_at = COALESCE(original_end_at, end_at),
           reschedule_count = reschedule_count + 1, rescheduled_at = ?, updated_at = ?
       WHERE id = ? AND status = 'confirmed' AND replaced_by_appointment_id IS NULL
         AND (? = 1 OR reschedule_count = 0)
         AND EXISTS (
           SELECT 1 FROM availability_windows aw
           WHERE aw.id = ? AND aw.active = 1 AND aw.is_blackout = 0
             AND (aw.booking_type_id IS NULL OR aw.booking_type_id = appointments.booking_type_id)
             AND aw.start_at > ?
             AND (
               SELECT COUNT(*) FROM appointments day_appointment
               WHERE day_appointment.id <> appointments.id
                 AND day_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
                 AND day_appointment.start_at >= ? AND day_appointment.start_at < ?
             ) < ?
             AND NOT EXISTS (
               SELECT 1 FROM availability_windows blackout
               WHERE blackout.active = 1 AND blackout.is_blackout = 1
                 AND unixepoch(blackout.start_at) - COALESCE(blackout.buffer_before_minutes, 0) * 60
                   < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
                 AND unixepoch(blackout.end_at) + COALESCE(blackout.buffer_after_minutes, 0) * 60
                   > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
             )
             AND (
               SELECT COUNT(*) FROM appointments overlap_appointment
               LEFT JOIN availability_windows overlap_window
                 ON overlap_window.id = overlap_appointment.availability_window_id
               WHERE overlap_appointment.id <> appointments.id
                 AND overlap_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
                 AND unixepoch(overlap_appointment.start_at) - COALESCE(overlap_window.buffer_before_minutes, 0) * 60
                   < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
                 AND unixepoch(overlap_appointment.end_at) + COALESCE(overlap_window.buffer_after_minutes, 0) * 60
                   > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
             ) < CASE
               WHEN appointments.booking_type_id IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended')
                 OR appointments.booking_type_id LIKE 'tattoo_special_%'
               THEN 1 ELSE aw.capacity
             END
             AND (
               SELECT COUNT(*) FROM appointments exact_appointment
               WHERE exact_appointment.id <> appointments.id
                 AND exact_appointment.availability_window_id = aw.id
                 AND exact_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
             ) < CASE
               WHEN appointments.booking_type_id IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended')
                 OR appointments.booking_type_id LIKE 'tattoo_special_%'
               THEN 1 ELSE aw.capacity
             END
         )`
    ).bind(
      availability.window.id,
      availability.window.start_at,
      availability.window.end_at,
      now,
      now,
      original.id,
      overridePolicy ? 1 : 0,
      availability.window.id,
      now,
      dayGuard.startAt,
      dayGuard.endAt,
      dayGuard.maxBookingsPerDay,
    ),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      )
      SELECT ?, id, 'rescheduled', ?, ?, ?, ? FROM appointments
      WHERE id = ? AND rescheduled_at = ? AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      actor,
      eventNote,
      JSON.stringify({
        fromStartAt: original.startAt,
        fromEndAt: original.endAt,
        toStartAt: availability.window.start_at,
        toEndAt: availability.window.end_at,
        paymentRequired: false,
        policyOverride: Boolean(overridePolicy),
      }),
      now,
      original.id,
      now,
      now,
    ),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) < 1) {
    return { error: "The new appointment time became unavailable before the move completed.", status: 409 };
  }
  await updatePendingRenderingExpiry(db, original.id, availability.window.start_at);

  let meetingNeedsAttention = false;
  let meetingError = "";
  if (appointmentRow.meeting_provider === "zoom") {
    const cleanup = await cleanupZoomMeetingForAppointment(db, env, original.id);
    meetingNeedsAttention = !cleanup.cleaned;
    meetingError = cleanup.error || "";
    if (cleanup.cleaned) {
      const recreation = await maybeCreateVirtualMeeting(
        db,
        env,
        await selectAppointmentWithMeeting(db, original.id),
      );
      if (recreation?.error) {
        meetingNeedsAttention = true;
        meetingError = recreation.error;
      }
    }
  }
  const updatedRow = await selectAppointmentWithMeeting(db, original.id);
  await mirrorAppointmentToCrm(db, normalizeAppointment(updatedRow), {
    includePayment: true,
  });
  const notificationKey = `${original.id}:${now}`;
  const [delivery, adminDelivery] = await Promise.all([
    notifyAppointmentRescheduled(env, request, updatedRow, {
      previousStartAt: original.startAt,
      previousEndAt: original.endAt,
      idempotencyKey: `appointment_rescheduled:${notificationKey}`,
    }),
    notifyAdminAppointmentRescheduled(env, request, updatedRow, {
      previousStartAt: original.startAt,
      previousEndAt: original.endAt,
      idempotencyKey: `admin_appointment_rescheduled:${notificationKey}`,
    }),
  ]);
  return {
    appointment: normalizeAppointment(updatedRow),
    hoursUntilStart,
    delivery,
    adminDelivery,
    overridePolicy: Boolean(overridePolicy),
    meetingNeedsAttention,
    meetingError,
  };
}

export async function handleCreateReplacementCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const owned = await clientOwnedAppointment(db, asString(body.appointmentId), asString(body.email));
    if (owned.error) return errorResponse(owned.error, owned.status);
    const original = normalizeAppointment(owned.row);
    if (!appointmentCanReschedule(original)) return errorResponse("This appointment is not eligible for rescheduling.", 409);
    const result = await createReplacementCheckout(request, env, db, owned.row, asString(body.availabilityWindowId));
    if (result.error) return errorResponse(result.error, result.status || 400, {
      detail: result.detail,
      ...(result.code ? { code: result.code } : {}),
      ...(result.appointment ? { appointment: result.appointment } : {}),
    });
    return json({
      ok: true,
      mode: "replacement_checkout",
      originalAppointmentId: result.original.id,
      appointmentId: result.appointment.id,
      checkoutUrl: result.checkoutUrl,
      holdExpiresAt: result.appointment.holdExpiresAt,
      hoursUntilStart: result.hoursUntilStart,
      resumed: Boolean(result.existing),
    });
  } catch (error) {
    return errorResponse("Unable to create replacement checkout.", 500, { detail: error.message });
  }
}

async function changeApprovedTattooSpecialRequestedTime(request, env, db, appointmentRow, availabilityWindowId) {
  const original = normalizeAppointment(appointmentRow);
  if (!appointmentCanChangeApprovedSpecialTime(original)) {
    return { error: "This Tattoo Special requested time can no longer be changed before payment.", status: 409 };
  }
  const availability = await ensureAvailable(db, availabilityWindowId, original.bookingTypeId, original.id);
  if (availability.error) return { error: availability.error, status: 409 };
  const dayGuard = await bookingDayGuardForWindow(db, availability.window.id);
  if (!dayGuard) return { error: "That appointment time is unavailable.", status: 409 };
  if (availability.window.id === original.availabilityWindowId && original.squareCheckoutUrl) {
    return {
      appointment: original,
      checkoutUrl: original.squareCheckoutUrl,
      unchanged: true,
    };
  }

  const payment = await pendingCheckoutIdentifiers(db, original.id);
  const reconciliationRow = {
    ...appointmentRow,
    payment_link_id: payment?.payment_link_id || original.squarePaymentLinkId || "",
    payment_order_id: payment?.payment_order_id || original.squareOrderId || "",
  };
  const paymentLinkId = reconciliationRow.payment_link_id || original.squarePaymentLinkId;
  const orderId = reconciliationRow.square_order_id || reconciliationRow.payment_order_id;
  const hasCheckout = Boolean(original.squareCheckoutUrl || paymentLinkId || orderId);
  if (hasCheckout) {
    try {
      if (!paymentLinkId || !orderId) throw new Error("The existing deposit checkout is missing its Square identifiers.");
      const order = await fetchSquareOrderForReconciliation(env, orderId);
      if (orderLooksPaid(order)) {
        const confirmed = await confirmPaidAppointment(db, env, request, appointmentRow, order);
        return {
          error: "This deposit has already been paid, so the appointment is booked and cannot be changed through the approval email.",
          status: 409,
          code: "CHECKOUT_ALREADY_PAID",
          appointment: confirmed,
        };
      }
      await invalidateSquarePaymentLink(env, paymentLinkId);
    } catch (error) {
      await markHoldExpiryAttention(db, reconciliationRow, error.message, new Date().toISOString());
      return {
        error: "The existing Square link could not be safely replaced. The requested time remains held for Studio attention.",
        status: 409,
        code: "SPECIAL_TIME_CHANGE_ATTENTION",
        detail: error.message,
      };
    }
  }

  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE appointments
       SET availability_window_id = ?, start_at = ?, end_at = ?,
           original_start_at = COALESCE(original_start_at, start_at),
           original_end_at = COALESCE(original_end_at, end_at),
           status = 'pending_deposit', square_order_id = NULL,
           square_payment_link_id = NULL, square_checkout_url = NULL, updated_at = ?
       WHERE id = ? AND status IN ('pending_deposit','deposit_pending')
         AND approval_state = 'approved' AND hold_state = 'active' AND hold_expires_at > ?
         AND EXISTS (
           SELECT 1 FROM availability_windows aw
           WHERE aw.id = ? AND aw.active = 1 AND aw.is_blackout = 0
             AND (aw.booking_type_id IS NULL OR aw.booking_type_id = appointments.booking_type_id)
             AND aw.start_at > ?
             AND (
               SELECT COUNT(*) FROM appointments day_appointment
               WHERE day_appointment.id <> appointments.id
                 AND day_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
                 AND day_appointment.start_at >= ? AND day_appointment.start_at < ?
             ) < ?
             AND NOT EXISTS (
               SELECT 1 FROM availability_windows blackout
               WHERE blackout.active = 1 AND blackout.is_blackout = 1
                 AND unixepoch(blackout.start_at) - COALESCE(blackout.buffer_before_minutes, 0) * 60
                   < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
                 AND unixepoch(blackout.end_at) + COALESCE(blackout.buffer_after_minutes, 0) * 60
                   > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
             )
             AND (
               SELECT COUNT(*) FROM appointments overlap_appointment
               LEFT JOIN availability_windows overlap_window
                 ON overlap_window.id = overlap_appointment.availability_window_id
               WHERE overlap_appointment.id <> appointments.id
                 AND overlap_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
                 AND unixepoch(overlap_appointment.start_at) - COALESCE(overlap_window.buffer_before_minutes, 0) * 60
                   < unixepoch(aw.end_at) + COALESCE(aw.buffer_after_minutes, 0) * 60
                 AND unixepoch(overlap_appointment.end_at) + COALESCE(overlap_window.buffer_after_minutes, 0) * 60
                   > unixepoch(aw.start_at) - COALESCE(aw.buffer_before_minutes, 0) * 60
             ) < CASE
               WHEN appointments.booking_type_id IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended')
                 OR appointments.booking_type_id LIKE 'tattoo_special_%'
               THEN 1 ELSE aw.capacity
             END
             AND (
               SELECT COUNT(*) FROM appointments exact_appointment
               WHERE exact_appointment.id <> appointments.id
                 AND exact_appointment.availability_window_id = aw.id
                 AND exact_appointment.status IN ('pending_deposit','deposit_pending','confirmed')
             ) < CASE
               WHEN appointments.booking_type_id IN ('tattoo_quarter','tattoo_half','tattoo_full','tattoo_extended')
                 OR appointments.booking_type_id LIKE 'tattoo_special_%'
               THEN 1 ELSE aw.capacity
             END
         )`
    ).bind(
      availability.window.id,
      availability.window.start_at,
      availability.window.end_at,
      now,
      original.id,
      now,
      availability.window.id,
      now,
      dayGuard.startAt,
      dayGuard.endAt,
      dayGuard.maxBookingsPerDay,
    ),
    db.prepare(
      `UPDATE deposit_payments SET status = 'cancelled', updated_at = ?
       WHERE appointment_id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.updated_at = ?)`
    ).bind(now, original.id, original.id, now),
    db.prepare(
      `UPDATE submissions
       SET payload_json = json_set(payload_json, '$.held_start_at', ?, '$.held_end_at', ?), updated_at = ?
       WHERE id = ? AND type = 'tattoo_special'
         AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.updated_at = ?)`
    ).bind(availability.window.start_at, availability.window.end_at, now, original.submissionId, original.id, now),
    db.prepare(
      `INSERT INTO appointment_events (id, appointment_id, event_type, actor, note, metadata_json, created_at)
       SELECT ?, id, 'special_requested_time_changed', 'client', ?, ?, ?
       FROM appointments WHERE id = ? AND updated_at = ?`
    ).bind(
      crypto.randomUUID(),
      `${original.startAt} - ${original.endAt} -> ${availability.window.start_at} - ${availability.window.end_at}`,
      JSON.stringify({
        fromStartAt: original.startAt,
        fromEndAt: original.endAt,
        toStartAt: availability.window.start_at,
        toEndAt: availability.window.end_at,
        beforeDeposit: true,
      }),
      now,
      original.id,
      now,
    ),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) < 1) {
    return { error: "The new requested time became unavailable before the change completed.", status: 409 };
  }

  const bookingTypeRow = await db.prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(original.bookingTypeId)
    .first();
  if (!bookingTypeRow) return { error: "This Tattoo Special appointment type is no longer available.", status: 409 };
  const movedRow = await selectAppointmentWithMeeting(db, original.id);
  const moved = normalizeAppointment(movedRow);
  let paymentLink;
  try {
    paymentLink = await createSquarePaymentLink(request, env, moved, normalizeBookingType(bookingTypeRow), {
      idempotencyKey: `${moved.id}:requested-time:${crypto.randomUUID()}`,
    });
  } catch (error) {
    await db.prepare("UPDATE appointments SET status = 'deposit_pending', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), moved.id)
      .run();
    return { error: "The requested time changed, but the replacement deposit link is not ready. Reopen the email link to try again.", status: 503, detail: error.message };
  }
  if (!await savePendingPaymentLink(db, moved, paymentLink)) {
    await invalidateUnsavedPaymentLink(env, paymentLink);
    return { error: "The replacement deposit hold expired before checkout was created.", status: 409 };
  }
  return {
    appointment: normalizeAppointment(await selectAppointmentWithMeeting(db, moved.id)),
    checkoutUrl: paymentLink.url,
    previousStartAt: original.startAt,
    previousEndAt: original.endAt,
  };
}

export async function handleRescheduleAppointment(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const db = requireBookingDb(env);
    const owned = await clientOwnedAppointment(db, asString(body.appointmentId), asString(body.email));
    if (owned.error) return errorResponse(owned.error, owned.status);
    const original = normalizeAppointment(owned.row);
    const availabilityWindowId = asString(body.availabilityWindowId);
    if (!availabilityWindowId) return errorResponse("Choose a new appointment time.", 400);
    if (appointmentCanChangeApprovedSpecialTime(original)) {
      const changed = await changeApprovedTattooSpecialRequestedTime(
        request,
        env,
        db,
        owned.row,
        availabilityWindowId,
      );
      if (changed.error) return errorResponse(changed.error, changed.status || 409, {
        ...(changed.code ? { code: changed.code } : {}),
        ...(changed.detail ? { detail: changed.detail } : {}),
        ...(changed.appointment ? { appointment: changed.appointment } : {}),
      });
      return json({
        ok: true,
        mode: "special_request_changed",
        appointment: changed.appointment,
        checkoutUrl: changed.checkoutUrl,
        previousStartAt: changed.previousStartAt || "",
        previousEndAt: changed.previousEndAt || "",
        unchanged: Boolean(changed.unchanged),
      });
    }
    if (!appointmentCanReschedule(original)) return errorResponse("This appointment is not eligible for rescheduling.", 409);
    const hoursUntilStart = (new Date(original.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntilStart < RESCHEDULE_CUTOFF_HOURS) {
      const result = await createReplacementCheckout(request, env, db, owned.row, availabilityWindowId);
      if (result.error) return errorResponse(result.error, result.status || 400, {
        detail: result.detail,
        ...(result.code ? { code: result.code } : {}),
        ...(result.appointment ? { appointment: result.appointment } : {}),
      });
      return json({
        ok: true,
        mode: "replacement_checkout",
        originalAppointmentId: result.original.id,
        appointmentId: result.appointment.id,
        checkoutUrl: result.checkoutUrl,
        holdExpiresAt: result.appointment.holdExpiresAt,
        hoursUntilStart,
        resumed: Boolean(result.existing),
      });
    }

    const moved = await moveConfirmedAppointment(
      request,
      env,
      db,
      owned.row,
      availabilityWindowId,
      "client",
      "",
      false,
    );
    if (moved.error) return errorResponse(moved.error, moved.status || 409);
    return json({
      ok: true,
      mode: "moved",
      appointment: moved.appointment,
      hoursUntilStart: moved.hoursUntilStart,
      delivery: moved.delivery,
      adminDelivery: moved.adminDelivery,
      meetingNeedsAttention: moved.meetingNeedsAttention,
      meetingError: moved.meetingError,
    });
  } catch (error) {
    return errorResponse("Unable to reschedule appointment.", 500, { detail: error.message });
  }
}

export async function handleAdminRescheduleAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  const availabilityWindowId = asString(body.availabilityWindowId);
  if (!availabilityWindowId) return errorResponse("availabilityWindowId is required.", 400);
  try {
    const db = requireBookingDb(env);
    const row = await selectAppointmentWithMeeting(db, appointmentId);
    if (!row) return errorResponse("Appointment not found.", 404);
    const moved = await moveConfirmedAppointment(
      request,
      env,
      db,
      row,
      availabilityWindowId,
      "admin",
      asString(body.note),
      body.overridePolicy === true,
    );
    if (moved.error) return errorResponse(moved.error, moved.status || 409);
    return json({
      ok: true,
      mode: "moved",
      appointment: moved.appointment,
      hoursUntilStart: moved.hoursUntilStart,
      policyOverride: moved.overridePolicy,
      delivery: moved.delivery,
      adminDelivery: moved.adminDelivery,
      meetingNeedsAttention: moved.meetingNeedsAttention,
      meetingError: moved.meetingError,
    });
  } catch (error) {
    return errorResponse("Unable to reschedule appointment.", 500, { detail: error.message });
  }
}

function webhookOrderId(payload) {
  const object = payload?.data?.object || {};
  return (
    asString(object.payment?.order_id) ||
    asString(object.payment?.orderId) ||
    asString(object.order?.id) ||
    asString(object.order_updated?.order_id) ||
    asString(object.order_updated?.orderId) ||
    asString(object.order_created?.order_id) ||
    asString(object.order_created?.orderId) ||
    asString(object.order_id) ||
    asString(object.orderId) ||
    asString(payload?.order_id)
  );
}

function webhookPaymentId(payload) {
  const object = payload?.data?.object || {};
  return asString(object.payment?.id) || asString(object.payment_id) || "";
}

function webhookLooksPaid(payload, order) {
  const payment = payload?.data?.object?.payment;
  if (orderLooksPaid(order)) return true;
  const netDue = Number(order?.net_amount_due_money?.amount);
  return payment?.status === "COMPLETED" && Number.isFinite(netDue) && netDue === 0;
}

async function processTattooRenderingSquareWebhook(request, env, db, renderingRow, payload, orderId) {
  const order = await fetchSquareOrderForReconciliation(env, orderId);
  const paymentId = webhookPaymentId(payload);
  const now = new Date().toISOString();
  if (!webhookLooksPaid(payload, order)) {
    await db.prepare(
      `UPDATE tattoo_rendering_requests
       SET square_payment_id = COALESCE(?, square_payment_id), raw_json = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    ).bind(paymentId || null, JSON.stringify(order || payload), now, renderingRow.id).run();
    return json({ ok: true, paid: false, renderingRequestId: renderingRow.id });
  }
  if (renderingRow.status === "paid") {
    return json({
      ok: true,
      paid: true,
      ignored: true,
      reason: "Rendering payment was already recorded.",
      renderingRequestId: renderingRow.id,
    });
  }
  if (
    renderingRow.status === "payment_attention"
    && paymentId
    && renderingRow.square_payment_id === paymentId
  ) {
    return json({
      ok: true,
      paid: true,
      attention: true,
      ignored: true,
      reason: "Rendering payment attention was already recorded.",
      renderingRequestId: renderingRow.id,
    });
  }

  const appointment = await db.prepare("SELECT status, start_at FROM appointments WHERE id = ?")
    .bind(renderingRow.appointment_id)
    .first();
  const late = renderingRow.status !== "pending"
    || renderingRow.expires_at <= now
    || appointment?.status !== "confirmed"
    || appointment?.start_at <= now;
  if (late) {
    await db.batch([
      db.prepare(
        `UPDATE tattoo_rendering_requests
         SET status = 'payment_attention', square_payment_id = COALESCE(?, square_payment_id),
             raw_json = ?, updated_at = ?
         WHERE id = ? AND status <> 'paid'`
      ).bind(paymentId || null, JSON.stringify(order || payload), now, renderingRow.id),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        ) VALUES (?, ?, 'tattoo_rendering_late_payment_attention', 'square_webhook', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        renderingRow.appointment_id,
        "Square reported an additional-rendering payment after the request became inactive.",
        JSON.stringify({ renderingRequestId: renderingRow.id, orderId, paymentId, previousStatus: renderingRow.status }),
        now,
      ),
    ]);
    return json({
      ok: true,
      paid: true,
      attention: true,
      reason: "Late rendering payment requires Studio review.",
      renderingRequestId: renderingRow.id,
    });
  }

  const results = await db.batch([
    db.prepare(
      `UPDATE tattoo_rendering_requests
       SET status = 'paid', square_payment_id = COALESCE(?, square_payment_id),
           paid_at = ?, raw_json = ?, updated_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`
    ).bind(paymentId || null, now, JSON.stringify(order || payload), now, renderingRow.id, now),
    db.prepare(
      `INSERT INTO appointment_events (
        id, appointment_id, event_type, actor, note, metadata_json, created_at
      ) SELECT ?, appointment_id, 'tattoo_rendering_paid', 'square_webhook',
               'Additional concept sketch is paid and ready to draw', ?, ?
        FROM tattoo_rendering_requests WHERE id = ? AND status = 'paid' AND paid_at = ?`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({ renderingRequestId: renderingRow.id, orderId, paymentId }),
      now,
      renderingRow.id,
      now,
    ),
  ]);
  const recorded = Number(results?.[0]?.meta?.changes || 0) > 0;
  if (recorded) {
    const saved = await selectTattooRenderingRequest(db, renderingRow.id);
    await notifyTattooRenderingPaymentConfirmed(env, request, saved);
  }
  return json({
    ok: true,
    paid: true,
    ignored: !recorded,
    renderingRequestId: renderingRow.id,
  });
}

async function processSquareWebhookPayload(request, env, rawBody) {
  const payload = JSON.parse(rawBody || "{}");
  const orderId = webhookOrderId(payload);
  if (!orderId) return json({ ok: true, ignored: true, reason: "No Square order id." });

  const db = requireBookingDb(env);
  const renderingRow = await db.prepare(
    "SELECT * FROM tattoo_rendering_requests WHERE square_order_id = ? LIMIT 1"
  ).bind(orderId).first();
  if (renderingRow) {
    return processTattooRenderingSquareWebhook(request, env, db, renderingRow, payload, orderId);
  }
  const appointmentRow = await db
    .prepare("SELECT * FROM appointments WHERE square_order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(orderId)
    .first();
  if (!appointmentRow) return json({ ok: true, ignored: true, reason: "No matching appointment." });

  // A signed payment-completed event is not sufficient by itself to settle the
  // appointment: Square's order is the source of truth for the final amount.
  // Throw on a transient/non-2xx lookup so Square retries the webhook instead
  // of acknowledging it as an unpaid success and stranding the appointment.
  const order = await fetchSquareOrderForReconciliation(env, orderId);
  if (!webhookLooksPaid(payload, order)) {
    await db
      .prepare(
        `UPDATE deposit_payments
         SET status = ?, provider_payment_id = COALESCE(?, provider_payment_id),
             raw_json = ?, updated_at = ?
         WHERE appointment_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = deposit_payments.appointment_id
               AND a.status IN ('pending_deposit','deposit_pending')
               AND a.hold_state IN ('active','expiry_attention')
           )`
      )
      .bind("pending", webhookPaymentId(payload) || null, JSON.stringify(order || payload), new Date().toISOString(), appointmentRow.id)
      .run();
    return json({ ok: true, paid: false, appointmentId: appointmentRow.id });
  }

  const paymentRow = await db.prepare(
    `SELECT * FROM deposit_payments
     WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(appointmentRow.id).first();
  const now = new Date().toISOString();
  if (["confirmed", "completed"].includes(appointmentRow.status)) {
    await db.prepare(
      `UPDATE deposit_payments
       SET status = 'paid', provider_payment_id = COALESCE(?, provider_payment_id),
           raw_json = ?, updated_at = ?
       WHERE appointment_id = ? AND status = 'pending'`
    ).bind(
      webhookPaymentId(payload) || null,
      JSON.stringify(order || payload),
      now,
      appointmentRow.id,
    ).run();
    const currentAppointment = await selectAppointmentWithMeeting(db, appointmentRow.id);
    if (currentAppointment) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(currentAppointment), {
        includePayment: true,
      });
    }
    return json({ ok: true, paid: true, ignored: true, reason: "Appointment is already confirmed.", appointmentId: appointmentRow.id });
  }
  const specialTerms = appointmentRow.submission_id
    ? await db.prepare(
      `SELECT offer_title, variant_label, sales_closes_at
       FROM tattoo_special_submission_terms WHERE submission_id = ?`
    ).bind(appointmentRow.submission_id).first()
    : null;
  if (specialTerms && specialTerms.sales_closes_at <= now) {
    await db.batch([
      db.prepare(
        `UPDATE appointments SET hold_state = 'expiry_attention', updated_at = ?
         WHERE id = ? AND status IN ('pending_deposit','deposit_pending','cancelled','archived')`
      ).bind(now, appointmentRow.id),
      db.prepare(
        `UPDATE deposit_payments
         SET status = 'payment_attention', provider_payment_id = COALESCE(?, provider_payment_id),
             raw_json = ?, updated_at = ?
         WHERE appointment_id = ? AND status <> 'paid'`
      ).bind(webhookPaymentId(payload) || null, JSON.stringify(order || payload), now, appointmentRow.id),
      db.prepare(
        `INSERT INTO appointment_events
         (id, appointment_id, event_type, actor, note, metadata_json, created_at)
         VALUES (?, ?, 'tattoo_special_late_payment_attention', 'square_webhook', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), appointmentRow.id,
        "Square reported a Tattoo Special payment after the sales cutoff. Manual refund review is required; no automatic refund was attempted.",
        JSON.stringify({ orderId, paymentId: webhookPaymentId(payload), salesClosesAt: specialTerms.sales_closes_at, offerTitle: specialTerms.offer_title }), now,
      ),
    ]);
    return json({ ok: true, paid: true, attention: true, reason: "Tattoo Special payment after sales close requires manual refund review.", appointmentId: appointmentRow.id });
  }
  if (["cancelled", "archived"].includes(appointmentRow.status)) {
    if (paymentRow?.status === "paid") {
      await mirrorAppointmentToCrm(db, normalizeAppointment(appointmentRow), {
        includePayment: true,
      });
      return json({ ok: true, paid: true, ignored: true, reason: "Payment was already recorded for a terminal appointment.", appointmentId: appointmentRow.id });
    }
    await db.batch([
      db.prepare(
        `UPDATE appointments SET hold_state = 'expiry_attention', updated_at = ?
         WHERE id = ? AND status IN ('cancelled','archived')`
      ).bind(now, appointmentRow.id),
      db.prepare(
        `UPDATE deposit_payments
         SET status = 'payment_attention', provider_payment_id = COALESCE(?, provider_payment_id),
             raw_json = ?, updated_at = ?
         WHERE appointment_id = ? AND status <> 'paid'`
      ).bind(
        webhookPaymentId(payload) || null,
        JSON.stringify(order || payload),
        now,
        appointmentRow.id,
      ),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        ) VALUES (?, ?, 'late_payment_attention', 'square_webhook', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        appointmentRow.id,
        "Square reported payment after the appointment hold became terminal.",
        JSON.stringify({ orderId, paymentId: webhookPaymentId(payload), previousStatus: appointmentRow.status }),
        now,
      ),
    ]);
    const terminalAppointment = await selectAppointmentWithMeeting(db, appointmentRow.id);
    if (terminalAppointment) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(terminalAppointment), {
        includePayment: true,
      });
    }
    return json({ ok: true, paid: true, attention: true, reason: "Late payment requires Studio review.", appointmentId: appointmentRow.id });
  }
  if (
    ["pending_deposit", "deposit_pending"].includes(appointmentRow.status)
    && appointmentRow.hold_expires_at
    && appointmentRow.hold_expires_at <= now
  ) {
    await db.batch([
      db.prepare(
        `UPDATE appointments SET hold_state = 'expiry_attention', updated_at = ?
         WHERE id = ? AND status IN ('pending_deposit','deposit_pending')`
      ).bind(now, appointmentRow.id),
      db.prepare(
        `UPDATE deposit_payments
         SET status = 'payment_attention', provider_payment_id = COALESCE(?, provider_payment_id),
             raw_json = ?, updated_at = ?
         WHERE appointment_id = ? AND status <> 'paid'`
      ).bind(
        webhookPaymentId(payload) || null,
        JSON.stringify(order || payload),
        now,
        appointmentRow.id,
      ),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        ) VALUES (?, ?, 'late_payment_attention', 'square_webhook', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        appointmentRow.id,
        "Square reported payment after the checkout hold expired.",
        JSON.stringify({ orderId, paymentId: webhookPaymentId(payload), holdExpiresAt: appointmentRow.hold_expires_at }),
        now,
      ),
    ]);
    const expiredAppointment = await selectAppointmentWithMeeting(db, appointmentRow.id);
    if (expiredAppointment) {
      await mirrorAppointmentToCrm(db, normalizeAppointment(expiredAppointment), {
        includePayment: true,
      });
    }
    return json({ ok: true, paid: true, attention: true, reason: "Payment after hold expiry requires Studio review.", appointmentId: appointmentRow.id });
  }
  if (
    !["pending_deposit", "deposit_pending"].includes(appointmentRow.status)
    || !["active", "expiry_attention"].includes(appointmentRow.hold_state)
  ) {
    return json({ ok: true, paid: true, ignored: true, reason: "Appointment is not eligible for payment confirmation.", appointmentId: appointmentRow.id });
  }

  const appointment = await confirmPaidAppointment(
    db,
    env,
    request,
    appointmentRow,
    order || payload,
    webhookPaymentId(payload)
  );
  return json({ ok: true, paid: true, appointmentId: appointment.id });
}

export async function handleSquareWebhook(request, env) {
  try {
    const rawBody = await request.text();
    const signature = await verifySquareWebhookRequest(request, env, rawBody);
    if (!signature.ok) return errorResponse(signature.error, signature.status);
    return await processSquareWebhookPayload(request, env, rawBody);
  } catch (error) {
    return errorResponse("Unable to process Square webhook.", 500, {
      detail: error.message,
    });
  }
}

export async function handleStudioSquareWebhook(request, env) {
  try {
    const rawBody = await request.text();
    const signature = await verifyStudioSquareWebhookRequest(request, env, rawBody);
    if (!signature.ok) return errorResponse(signature.error, signature.status);
    return await processSquareWebhookPayload(request, env, rawBody);
  } catch (error) {
    return errorResponse("Unable to process studio Square webhook.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminTattooSessionPlan(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = requireBookingDb(env);
    const submission = await db.prepare(
      "SELECT id,type,status,tattoo_stage,lifecycle_review_required FROM submissions WHERE id = ?"
    ).bind(submissionId).first();
    if (!submission) return errorResponse("Submission not found.", 404);
    if (!TATTOO_PROJECT_SUBMISSION_TYPES.has(submission.type)) return errorResponse("Session planning applies only to tattoo project submissions.", 409);
    if (request.method === "GET") {
      return json({ ok: true, sessionPlan: normalizeTattooSessionPlan(await loadTattooSessionPlan(db, submissionId)) });
    }
    const body = await readJsonBody(request);
    if (!body) return errorResponse("Expected JSON body.", 400);
    const splitPolicy = asString(body.splitPolicy) || "artist_review";
    if (!SPLIT_POLICIES.has(splitPolicy)) return errorResponse("Choose a valid split policy.", 400);
    const sessionCategory = splitPolicy === "not_available"
      ? "one_session"
      : ["required", "client_choice"].includes(splitPolicy)
        ? "multiple_sessions"
        : "artist_review";
    const integer = (value) => value === "" || value === null || value === undefined ? null : Math.round(Number(value));
    const existing = await loadTattooSessionPlan(db, submissionId);
    let sessionsMin = integer(body.estimatedSessionsMin);
    let sessionsMax = integer(body.estimatedSessionsMax);
    const minutesMin = integer(body.estimatedTotalMinutesMin);
    const minutesMax = integer(body.estimatedTotalMinutesMax);
    if (sessionCategory === "one_session") sessionsMin = sessionsMax = 1;
    if (splitPolicy === "required" && (!sessionsMin || sessionsMin < 2)) return errorResponse("Required splitting needs a minimum of at least two sessions.", 400);
    if (splitPolicy === "client_choice") {
      sessionsMin = sessionsMin && sessionsMin > 0 ? sessionsMin : 1;
      sessionsMax = sessionsMax && sessionsMax >= sessionsMin ? sessionsMax : Math.max(2, sessionsMin);
    }
    if (sessionCategory !== "artist_review" && (!sessionsMax || sessionsMax < sessionsMin)) return errorResponse("Enter a valid maximum session count.", 400);
    if ([sessionsMin,sessionsMax,minutesMin,minutesMax].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return errorResponse("Session estimates must be non-negative whole numbers.", 400);
    if (minutesMin !== null && minutesMax !== null && minutesMin > minutesMax) return errorResponse("Minimum total time cannot exceed maximum total time.", 400);
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const budgetMinCents = hasOwn("approvedBudgetMinCents")
      ? integer(body.approvedBudgetMinCents)
      : (existing?.approved_budget_min_cents ?? null);
    const budgetMaxCents = hasOwn("approvedBudgetMaxCents")
      ? integer(body.approvedBudgetMaxCents)
      : (existing?.approved_budget_max_cents ?? null);
    const budgetCurrency = asString(body.approvedBudgetCurrency || existing?.approved_budget_currency || "USD").toUpperCase();
    if (budgetCurrency !== "USD") return errorResponse("Approved project budgets must use USD.", 400);
    if ((budgetMinCents === null) !== (budgetMaxCents === null)) {
      return errorResponse("Enter both the minimum and maximum approved project budget.", 400, {
        code: "APPROVED_BUDGET_RANGE_REQUIRED",
      });
    }
    if (
      budgetMinCents !== null
      && (
        !Number.isSafeInteger(budgetMinCents)
        || !Number.isSafeInteger(budgetMaxCents)
        || budgetMinCents <= 0
        || budgetMaxCents <= 0
        || budgetMaxCents < budgetMinCents
      )
    ) {
      return errorResponse("Enter a valid approved project budget with a maximum greater than or equal to the minimum.", 400, {
        code: "INVALID_APPROVED_BUDGET",
      });
    }
    const artistNote = asString(body.artistNote).slice(0,5000);
    if (
      hasOwn("includeAdditionalSketchDisclaimer")
      && typeof body.includeAdditionalSketchDisclaimer !== "boolean"
    ) {
      return errorResponse("The additional-sketch disclaimer choice must be true or false.", 400);
    }
    const includeAdditionalSketchDisclaimer = hasOwn("includeAdditionalSketchDisclaimer")
      ? (body.includeAdditionalSketchDisclaimer ? 1 : 0)
      : Number(existing?.include_additional_sketch_disclaimer || 0);
    const bookingLinkPurpose = hasOwn("bookingLinkPurpose")
      ? asString(body.bookingLinkPurpose)
      : (existing?.booking_purpose || "");
    const allowedBookingTypes = hasOwn("allowedBookingTypes")
      ? [...new Set((Array.isArray(body.allowedBookingTypes) ? body.allowedBookingTypes : []).map(asString).filter(Boolean))]
      : parseJsonField(existing?.allowed_booking_types_json, []);
    const bookingLinkExpiresAt = hasOwn("bookingLinkExpiresAt")
      ? asString(body.bookingLinkExpiresAt)
      : (existing?.booking_link_expires_at || "");
    const bookingLinkRevokeExisting = hasOwn("bookingLinkRevokeExisting")
      ? (body.bookingLinkRevokeExisting ? 1 : 0)
      : (existing?.booking_link_revoke_existing ?? 1);
    if (bookingLinkPurpose && !BOOKING_TOKEN_PURPOSES.has(bookingLinkPurpose)) {
      return errorResponse("Choose a valid booking-link purpose.", 400);
    }
    if (bookingLinkPurpose && !bookingTypesMatchPurpose(bookingLinkPurpose, allowedBookingTypes)) {
      return errorResponse("Choose at least one appointment type compatible with the booking-link purpose.", 400);
    }
    if (bookingLinkExpiresAt && (!Number.isFinite(Date.parse(bookingLinkExpiresAt)) || Date.parse(bookingLinkExpiresAt) <= Date.now())) {
      return errorResponse("Booking-link expiration must be a future date and time.", 400);
    }
    const allowedBookingTypesChanged = JSON.stringify(allowedBookingTypes)
      !== JSON.stringify(parseJsonField(existing?.allowed_booking_types_json, []));
    const sketchDisclaimerChanged = includeAdditionalSketchDisclaimer
      !== Number(existing?.include_additional_sketch_disclaimer || 0);
    const planChanged = !existing
      || sessionCategory !== (existing.session_category || "artist_review")
      || splitPolicy !== (existing.split_policy || "artist_review")
      || sessionsMin !== (existing.estimated_sessions_min ?? null)
      || sessionsMax !== (existing.estimated_sessions_max ?? null)
      || minutesMin !== (existing.estimated_total_minutes_min ?? null)
      || minutesMax !== (existing.estimated_total_minutes_max ?? null)
      || artistNote !== (existing.artist_note || "")
      || sketchDisclaimerChanged
      || budgetMinCents !== (existing.approved_budget_min_cents ?? null)
      || budgetMaxCents !== (existing.approved_budget_max_cents ?? null)
      || budgetCurrency !== (existing.approved_budget_currency || "USD")
      || bookingLinkPurpose !== (existing.booking_purpose || "")
      || allowedBookingTypesChanged
      || bookingLinkExpiresAt !== (existing.booking_link_expires_at || "")
      || bookingLinkRevokeExisting !== (existing.booking_link_revoke_existing ?? 1);
    if (
      planChanged
      && ["approved", "declined"].includes(submission.status)
      && Number(submission.lifecycle_review_required || 0) !== 1
      && submission.tattoo_stage !== "consultation_complete"
    ) {
      return errorResponse("Reopen review before changing the reviewed session plan or approved budget.", 409, {
        code: "REOPEN_REVIEW_REQUIRED",
      });
    }
    if (!planChanged) {
      const bookingBlock = await db.prepare(
        `SELECT 1 AS blocked
         WHERE EXISTS (
           SELECT 1 FROM booking_tokens active_token
           WHERE active_token.submission_id = ? AND active_token.purpose = 'tattoo'
             AND active_token.revoked_at IS NULL AND active_token.used_at IS NULL
         ) OR EXISTS (
           SELECT 1 FROM appointments active_appointment
           WHERE active_appointment.submission_id = ? AND active_appointment.purpose = 'tattoo'
             AND (
               active_appointment.status = 'confirmed'
               OR (
                 active_appointment.status IN ('pending_deposit','deposit_pending')
                 AND active_appointment.hold_state IN ('active','expiry_attention')
               )
             )
         )`
      ).bind(submissionId, submissionId).first();
      if (bookingBlock) {
        return json({ ok: true, unchanged: true, sessionPlan: normalizeTattooSessionPlan(existing) });
      }
    }
    const budgetChanged = budgetMinCents !== (existing?.approved_budget_min_cents ?? null)
      || budgetMaxCents !== (existing?.approved_budget_max_cents ?? null)
      || budgetCurrency !== (existing?.approved_budget_currency || "USD");
    const budgetDisclosureChanged = budgetChanged || sketchDisclaimerChanged || allowedBookingTypesChanged;
    const now = new Date().toISOString();
    const budgetAcknowledged = budgetDisclosureChanged ? 0 : Number(existing?.budget_acknowledged || 0);
    const budgetAcknowledgedAt = budgetDisclosureChanged ? null : (existing?.budget_acknowledged_at || null);
    const planResult = await db.prepare(
      `INSERT INTO tattoo_session_plans (
        id,submission_id,estimated_sessions_min,estimated_sessions_max,
        estimated_total_minutes_min,estimated_total_minutes_max,split_policy,
        artist_note,include_additional_sketch_disclaimer,session_category,approved_budget_min_cents,
        approved_budget_max_cents,approved_budget_currency,budget_acknowledged,
        budget_acknowledged_at,booking_purpose,allowed_booking_types_json,
        booking_link_expires_at,booking_link_revoke_existing,
        client_preference,client_acknowledged,
        client_informed_at,client_selected_at,created_at,updated_at
      )
      SELECT ?,s.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,NULL,NULL,?,?
      FROM submissions s
      WHERE s.id = ? AND COALESCE(s.tattoo_stage, 'review') NOT IN ('tattoo_scheduled','closed')
        AND NOT EXISTS (
          SELECT 1 FROM booking_tokens active_token
          WHERE active_token.submission_id = s.id AND active_token.purpose = 'tattoo'
            AND active_token.revoked_at IS NULL AND active_token.used_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments active_appointment
          WHERE active_appointment.submission_id = s.id AND active_appointment.purpose = 'tattoo'
            AND (
              active_appointment.status = 'confirmed'
              OR (
                active_appointment.status IN ('pending_deposit','deposit_pending')
                AND active_appointment.hold_state IN ('active','expiry_attention')
              )
            )
        )
      ON CONFLICT(submission_id) DO UPDATE SET
        estimated_sessions_min=excluded.estimated_sessions_min,
        estimated_sessions_max=excluded.estimated_sessions_max,
        estimated_total_minutes_min=excluded.estimated_total_minutes_min,
        estimated_total_minutes_max=excluded.estimated_total_minutes_max,
        split_policy=excluded.split_policy,artist_note=excluded.artist_note,
        include_additional_sketch_disclaimer=excluded.include_additional_sketch_disclaimer,
        session_category=excluded.session_category,
        approved_budget_min_cents=excluded.approved_budget_min_cents,
        approved_budget_max_cents=excluded.approved_budget_max_cents,
        approved_budget_currency=excluded.approved_budget_currency,
        budget_acknowledged=excluded.budget_acknowledged,
        budget_acknowledged_at=excluded.budget_acknowledged_at,
        booking_purpose=excluded.booking_purpose,
        allowed_booking_types_json=excluded.allowed_booking_types_json,
        booking_link_expires_at=excluded.booking_link_expires_at,
        booking_link_revoke_existing=excluded.booking_link_revoke_existing,
        client_preference=NULL,
        client_acknowledged=0,client_informed_at=NULL,client_selected_at=NULL,
        updated_at=excluded.updated_at`
    ).bind(
      existing?.id || crypto.randomUUID(),
      sessionsMin,
      sessionsMax,
      minutesMin,
      minutesMax,
      splitPolicy,
      artistNote,
      includeAdditionalSketchDisclaimer,
      sessionCategory,
      budgetMinCents,
      budgetMaxCents,
      budgetCurrency,
      budgetAcknowledged,
      budgetAcknowledgedAt,
      bookingLinkPurpose || null,
      allowedBookingTypes.length ? JSON.stringify(allowedBookingTypes) : null,
      bookingLinkExpiresAt || null,
      bookingLinkRevokeExisting,
      existing?.created_at || now,
      now,
      submissionId,
    ).run();
    if (Number(planResult?.meta?.changes || 0) < 1) {
      return errorResponse("Session plans cannot change while tattoo booking access or an active tattoo appointment exists.", 409, {
        code: "ACTIVE_BOOKING_BLOCKS_SESSION_PLAN_EDIT",
      });
    }
    if (budgetChanged && budgetMinCents !== null && budgetMaxCents !== null) {
      const budgetLabel = budgetMinCents === budgetMaxCents
        ? formatMoney(budgetMinCents, budgetCurrency)
        : `${formatMoney(budgetMinCents, budgetCurrency)}–${formatMoney(budgetMaxCents, budgetCurrency)}`;
      const hadReviewedBudget = reviewedBudgetIsComplete(existing);
      await db.prepare(
        `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
         VALUES (?, ?, ?, 'admin', ?, ?)`
      ).bind(
        crypto.randomUUID(),
        submissionId,
        hadReviewedBudget ? "approved_budget_revised" : "approved_budget_set",
        budgetLabel,
        now,
      ).run();
    }
    if (submission.status === "new") {
      await db.batch([
        db.prepare(
          `UPDATE submissions
           SET status = 'reviewing', updated_at = ?
           WHERE id = ? AND status = 'new'`
        ).bind(now, submissionId),
        db.prepare(
          `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
           SELECT ?, id, 'review_started', 'admin', ?, ? FROM submissions
           WHERE id = ? AND status = 'reviewing' AND updated_at = ?`
        ).bind(
          crypto.randomUUID(),
          "First saved Studio session-plan work changed New to Reviewing.",
          now,
          submissionId,
          now,
        ),
      ]);
    }
    if (
      submission.status === "approved"
      && submission.tattoo_stage === "consultation_complete"
      && sessionCategory !== "artist_review"
      && splitPolicy !== "artist_review"
      && budgetMinCents !== null
      && budgetMaxCents !== null
    ) {
      await db.batch([
        db.prepare(
          `UPDATE submissions SET tattoo_stage='ready_to_book',updated_at=?
           WHERE id=? AND status='approved' AND tattoo_stage='consultation_complete'`
        ).bind(now, submissionId),
        db.prepare(
          `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
           SELECT ?,id,'tattoo_stage_changed','system','consultation_complete -> ready_to_book',?
           FROM submissions WHERE id=? AND tattoo_stage='ready_to_book' AND updated_at=?`
        ).bind(crypto.randomUUID(), now, submissionId, now),
      ]);
    }
    return json({ ok: true, sessionPlan: normalizeTattooSessionPlan(await loadTattooSessionPlan(db, submissionId)) });
  } catch (error) {
    return errorResponse("Unable to save the tattoo session plan.", 500, { detail: error.message });
  }
}

export async function handleAdminCreateTattooRenderingRequest(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  const submissionId = asString(body.submissionId);
  const requestedAppointmentId = asString(body.appointmentId);
  if (!submissionId) return errorResponse("submissionId is required.", 400);

  let db;
  let insertedId = "";
  try {
    db = requireBookingDb(env);
    const now = new Date().toISOString();
    const appointment = await db.prepare(
      `SELECT a.*, s.type AS submission_type
       FROM appointments a
       JOIN submissions s ON s.id = a.submission_id
       WHERE a.submission_id = ?
         AND (? = '' OR a.id = ?)
         AND a.status = 'confirmed'
         AND a.purpose = 'tattoo'
         AND a.start_at > ?
       ORDER BY a.start_at ASC LIMIT 1`
    ).bind(submissionId, requestedAppointmentId, requestedAppointmentId, now).first();
    if (!appointment) {
      return errorResponse("An upcoming confirmed tattoo appointment is required.", 409, {
        code: "RENDERING_APPOINTMENT_REQUIRED",
      });
    }
    if (!ORIGINAL_TATTOO_PROJECT_SUBMISSION_TYPES.has(appointment.submission_type)) {
      return errorResponse("Additional rendering requests apply only to original-design tattoo projects.", 409, {
        code: "RENDERING_PROJECT_INELIGIBLE",
      });
    }
    const existingPending = await db.prepare(
      "SELECT id FROM tattoo_rendering_requests WHERE submission_id = ? AND status = 'pending' LIMIT 1"
    ).bind(submissionId).first();
    if (existingPending) {
      return errorResponse("This project already has a pending rendering payment request.", 409, {
        code: "RENDERING_REQUEST_PENDING",
        renderingRequestId: existingPending.id,
      });
    }
    const numberRow = await db.prepare(
      "SELECT COALESCE(MAX(request_number), 0) + 1 AS next_number FROM tattoo_rendering_requests WHERE submission_id = ?"
    ).bind(submissionId).first();
    insertedId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO tattoo_rendering_requests (
        id, submission_id, appointment_id, request_number, amount_cents, currency,
        status, expires_at, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, '{}', ?, ?)`
    ).bind(
      insertedId,
      submissionId,
      appointment.id,
      Number(numberRow?.next_number || 1),
      TATTOO_RENDERING_FEE_CENTS,
      TATTOO_RENDERING_CURRENCY,
      appointment.start_at,
      now,
      now,
    ).run();

    const draft = await selectTattooRenderingRequest(db, insertedId);
    const paymentLink = await createTattooRenderingSquarePaymentLink(request, env, draft);
    const savedAt = new Date().toISOString();
    await db.batch([
      db.prepare(
        `UPDATE tattoo_rendering_requests
         SET square_order_id = ?, square_payment_link_id = ?, square_checkout_url = ?,
             raw_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(
        paymentLink.order_id || null,
        paymentLink.id || null,
        paymentLink.url,
        JSON.stringify(paymentLink),
        savedAt,
        insertedId,
      ),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        ) VALUES (?, ?, 'tattoo_rendering_requested', 'admin', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        appointment.id,
        `Additional concept sketch request ${Number(numberRow?.next_number || 1)}`,
        JSON.stringify({ renderingRequestId: insertedId, amountCents: TATTOO_RENDERING_FEE_CENTS }),
        savedAt,
      ),
    ]);
    const saved = await selectTattooRenderingRequest(db, insertedId);
    const delivery = await notifyTattooRenderingPaymentRequested(env, request, saved);
    return json({
      ok: true,
      renderingRequest: normalizeTattooRenderingRequest(saved),
      delivery,
    });
  } catch (error) {
    if (db && insertedId) {
      await db.prepare(
        `DELETE FROM tattoo_rendering_requests
         WHERE id = ? AND status = 'pending' AND square_order_id IS NULL`
      ).bind(insertedId).run().catch(() => {});
    }
    if (String(error.message || error).includes("UNIQUE constraint failed")) {
      return errorResponse("This project already has a pending rendering payment request.", 409, {
        code: "RENDERING_REQUEST_PENDING",
      });
    }
    return errorResponse("Unable to create the rendering payment request.", 500, { detail: error.message });
  }
}

export async function handleAdminResendTattooRenderingRequest(request, env, requestId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = requireBookingDb(env);
    const row = await selectTattooRenderingRequest(db, requestId);
    if (!row) return errorResponse("Rendering request not found.", 404);
    if (row.status !== "pending" || !row.square_checkout_url) {
      return errorResponse("Only pending rendering payment requests can be resent.", 409);
    }
    if (row.expires_at <= new Date().toISOString() || row.appointment_status !== "confirmed") {
      return errorResponse("This rendering payment link is no longer active.", 409);
    }
    const delivery = await notifyTattooRenderingPaymentRequested(env, request, row, {
      idempotencyKey: `tattoo_rendering_payment_requested:${row.id}:resend:${crypto.randomUUID()}`,
    });
    return json({ ok: true, renderingRequest: normalizeTattooRenderingRequest(row), delivery });
  } catch (error) {
    return errorResponse("Unable to resend the rendering payment request.", 500, { detail: error.message });
  }
}

export async function handleAdminCancelTattooRenderingRequest(request, env, requestId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = requireBookingDb(env);
    const row = await selectTattooRenderingRequest(db, requestId);
    if (!row) return errorResponse("Rendering request not found.", 404);
    if (row.status !== "pending") return errorResponse("Only pending rendering requests can be cancelled.", 409);
    if (row.square_order_id) {
      const order = await fetchSquareOrderForReconciliation(env, row.square_order_id);
      if (orderLooksPaid(order)) {
        return errorResponse("Square reports this request as paid. Wait for webhook reconciliation or review the payment in Studio.", 409, {
          code: "RENDERING_REQUEST_ALREADY_PAID",
        });
      }
    }
    if (row.square_payment_link_id) await invalidateSquarePaymentLink(env, row.square_payment_link_id);
    const now = new Date().toISOString();
    const result = await db.batch([
      db.prepare(
        `UPDATE tattoo_rendering_requests
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(now, now, requestId),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        ) SELECT ?, appointment_id, 'tattoo_rendering_cancelled', 'admin',
                 'Additional concept sketch payment request cancelled', ?, ?
          FROM tattoo_rendering_requests WHERE id = ? AND status = 'cancelled' AND updated_at = ?`
      ).bind(crypto.randomUUID(), JSON.stringify({ renderingRequestId: requestId }), now, requestId, now),
    ]);
    if (Number(result?.[0]?.meta?.changes || 0) < 1) {
      return errorResponse("The rendering request changed before it could be cancelled.", 409);
    }
    return json({
      ok: true,
      renderingRequest: normalizeTattooRenderingRequest(await selectTattooRenderingRequest(db, requestId)),
    });
  } catch (error) {
    return errorResponse("Unable to cancel the rendering payment request.", 500, { detail: error.message });
  }
}

export async function reapExpiredTattooRenderingRequests(env) {
  const db = requireBookingDb(env);
  const now = new Date().toISOString();
  const rows = (await db.prepare(
    `SELECT * FROM tattoo_rendering_requests
     WHERE status = 'pending' AND expires_at <= ?
     ORDER BY expires_at ASC LIMIT 100`
  ).bind(now).all()).results || [];
  const summary = { checked: 0, expired: 0, paidAttention: 0, attention: 0 };
  for (const row of rows) {
    summary.checked += 1;
    try {
      const order = row.square_order_id
        ? await fetchSquareOrderForReconciliation(env, row.square_order_id)
        : null;
      if (orderLooksPaid(order)) {
        const result = await db.prepare(
          `UPDATE tattoo_rendering_requests
           SET status = 'payment_attention', square_payment_id = COALESCE(square_payment_id, ''),
               raw_json = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(JSON.stringify(order), now, row.id).run();
        if (Number(result?.meta?.changes || 0) > 0) {
          summary.paidAttention += 1;
          await db.prepare(
            `INSERT INTO appointment_events (
              id, appointment_id, event_type, actor, note, metadata_json, created_at
            ) VALUES (?, ?, 'tattoo_rendering_late_payment_attention', 'reaper', ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            row.appointment_id,
            "Square reported payment at or after the appointment-start deadline.",
            JSON.stringify({ renderingRequestId: row.id, orderId: row.square_order_id }),
            now,
          ).run();
        }
        continue;
      }
      if (row.square_payment_link_id) await invalidateSquarePaymentLink(env, row.square_payment_link_id);
      const result = await db.prepare(
        `UPDATE tattoo_rendering_requests SET status = 'expired', updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(now, row.id).run();
      if (Number(result?.meta?.changes || 0) > 0) {
        summary.expired += 1;
        await db.prepare(
          `INSERT INTO appointment_events (
            id, appointment_id, event_type, actor, note, metadata_json, created_at
          ) VALUES (?, ?, 'tattoo_rendering_expired', 'reaper', ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          row.appointment_id,
          "Unpaid additional concept sketch payment link expired at appointment start.",
          JSON.stringify({ renderingRequestId: row.id }),
          now,
        ).run();
      }
    } catch (error) {
      const result = await db.prepare(
        `UPDATE tattoo_rendering_requests SET status = 'payment_attention', raw_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(JSON.stringify({ error: error.message, expiredAt: row.expires_at }), now, row.id).run();
      if (Number(result?.meta?.changes || 0) > 0) {
        summary.attention += 1;
        await db.prepare(
          `INSERT INTO appointment_events (
            id, appointment_id, event_type, actor, note, metadata_json, created_at
          ) VALUES (?, ?, 'tattoo_rendering_payment_attention', 'reaper', ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          row.appointment_id,
          error.message,
          JSON.stringify({ renderingRequestId: row.id }),
          now,
        ).run();
      }
    }
  }
  return summary;
}

export async function handleAdminResolveTattooLifecycleReview(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request) || {};

  try {
    const db = requireBookingDb(env);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?")
      .bind(submissionId)
      .first();
    if (!submission) return errorResponse("Submission not found.", 404);
    if (!TATTOO_PROJECT_SUBMISSION_TYPES.has(submission.type)) {
      return errorResponse("Historic lifecycle resolution applies only to tattoo project submissions.", 409);
    }
    if (Number(submission.lifecycle_review_required || 0) !== 1) {
      return errorResponse("This submission is not flagged for historic lifecycle review.", 409);
    }

    const requestedAppointmentId = asString(body.appointmentId);
    const prerequisiteAppointment = requestedAppointmentId
      ? await db.prepare("SELECT * FROM appointments WHERE id = ? AND submission_id = ?")
        .bind(requestedAppointmentId, submissionId)
        .first()
      : await db.prepare(
        `SELECT * FROM appointments
         WHERE submission_id = ? AND purpose = 'prerequisite_consultation'
           AND status IN ('confirmed','completed')
         ORDER BY start_at DESC, created_at DESC LIMIT 1`
        ).bind(submissionId).first();

    if (requestedAppointmentId && !prerequisiteAppointment) {
      return errorResponse("The selected appointment is not linked to this submission.", 409);
    }
    if (prerequisiteAppointment) {
      if (
        prerequisiteAppointment.purpose !== "prerequisite_consultation"
        || !["confirmed", "completed"].includes(prerequisiteAppointment.status)
      ) {
        return errorResponse("Historic appointment resolution requires a confirmed or completed prerequisite consultation.", 409);
      }
      const headers = new Headers({ "content-type": "application/json" });
      const authorization = request.headers.get("authorization");
      if (authorization) headers.set("authorization", authorization);
      const completionResponse = await handleAdminCompleteAppointment(
        new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            resolveHistorical: true,
            note: asString(body.note).slice(0, 5000)
              || "Historic prerequisite consultation reconciled in Studio.",
          }),
        }),
        env,
        prerequisiteAppointment.id,
      );
      const completionPayload = await completionResponse.json().catch(() => ({}));
      if (!completionResponse.ok) {
        return json(completionPayload, { status: completionResponse.status });
      }
      return json({
        ...completionPayload,
        resolution: "prerequisite_consultation",
      });
    }

    const plan = await loadTattooSessionPlan(db, submissionId);
    if (!finalTattooSessionPlanIsAppropriate(plan)) {
      return errorResponse("Save an appropriate final session plan before resolving this historic project record.", 409, {
        code: "FINAL_SESSION_PLAN_REQUIRED",
      });
    }
    if (
      tattooSubmissionRequiresPrerequisiteConsultation(submission)
      && submission.tattoo_stage !== "consultation_complete"
    ) {
      return errorResponse("This project still requires a completed prerequisite consultation before its historic review can be resolved.", 409, {
        code: "PREREQUISITE_CONSULTATION_REQUIRED",
      });
    }

    const now = new Date().toISOString();
    const note = asString(body.note).slice(0, 5000)
      || `Historic project lifecycle reconciled from ${submission.tattoo_stage || "review"} using final session plan ${plan.id}.`;
    const results = await db.batch([
      db.prepare(
        `UPDATE submissions
         SET status = 'approved', tattoo_stage = 'ready_to_book',
             lifecycle_review_required = 0, lifecycle_review_note = '',
             booking_url = '', updated_at = ?
         WHERE id = ? AND lifecycle_review_required = 1
           AND status IN ('approved','booked')
           AND tattoo_stage IN ('review','consultation_complete','ready_to_book')
           AND EXISTS (
             SELECT 1 FROM tattoo_session_plans final_plan
             WHERE final_plan.id = ? AND final_plan.submission_id = submissions.id
               AND final_plan.updated_at = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM booking_tokens active_token
             WHERE active_token.submission_id = submissions.id
               AND active_token.revoked_at IS NULL AND active_token.used_at IS NULL
               AND (active_token.expires_at IS NULL OR active_token.expires_at > ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM appointments active_appointment
             WHERE active_appointment.submission_id = submissions.id
               AND (
                 active_appointment.status = 'confirmed'
                 OR (
                   active_appointment.status IN ('pending_deposit','deposit_pending')
                   AND active_appointment.hold_state IN ('active','expiry_attention')
                 )
               )
           )`
      ).bind(now, submissionId, plan.id, plan.updated_at, now),
      db.prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        )
        SELECT ?, id, 'historical_lifecycle_resolved', 'admin', ?, ?
        FROM submissions
        WHERE id = ? AND lifecycle_review_required = 0
          AND tattoo_stage = 'ready_to_book' AND updated_at = ?`
      ).bind(crypto.randomUUID(), note, now, submissionId, now),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) < 1) {
      return errorResponse("Historic lifecycle resolution raced with booking access or another lifecycle change. Refresh and review the record.", 409, {
        code: "HISTORICAL_LIFECYCLE_RESOLUTION_RACED",
      });
    }

    const resolved = await db.prepare(
      `SELECT id, status, tattoo_stage, lifecycle_review_required, lifecycle_review_note
       FROM submissions WHERE id = ?`
    ).bind(submissionId).first();
    return json({
      ok: true,
      resolution: "final_session_plan",
      submission: {
        id: resolved.id,
        status: resolved.status,
        tattooStage: resolved.tattoo_stage || "",
        lifecycleReviewRequired: Boolean(resolved.lifecycle_review_required),
        lifecycleReviewNote: resolved.lifecycle_review_note || "",
      },
    });
  } catch (error) {
    return errorResponse("Unable to resolve historic lifecycle review.", 500, { detail: error.message });
  }
}

async function releaseTokenCheckoutRows(db, env, request, rows, reason) {
  for (const row of rows || []) {
    const release = await safelyReleasePendingHold(db, env, request, row, "admin", reason);
    if (release.paid) {
      return {
        error: "A checkout for the existing booking link was already paid and cannot be revoked.",
        code: "TOKEN_CHECKOUT_ALREADY_PAID",
        appointment: release.appointment,
      };
    }
    if (!release.released) {
      return {
        error: "An existing checkout could not be safely invalidated. It remains capacity-blocking for Studio review.",
        code: "TOKEN_CHECKOUT_RELEASE_ATTENTION",
        detail: release.error || "Square reconciliation is required.",
      };
    }
  }
  return { ok: true };
}

export async function handleAdminCreateBookingToken(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const submissionId = asString(body.submissionId);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first();
    if (!submission) return errorResponse("Submission not found.", 404);
    if (submission.status !== "approved") {
      return errorResponse("Only approved submissions can receive booking links.", 400);
    }
    if (!TATTOO_PROJECT_SUBMISSION_TYPES.has(submission.type)) {
      return errorResponse("Private tattoo booking links apply only to tattoo project submissions.", 409);
    }
    if (Number(submission.lifecycle_review_required || 0) === 1) {
      return errorResponse("Studio must resolve the historic lifecycle review flag before issuing new booking access.", 409, {
        code: "LIFECYCLE_REVIEW_REQUIRED",
        detail: submission.lifecycle_review_note || "Historic lifecycle review is required.",
      });
    }

    const inferredPurpose = submission.tattoo_stage === "consultation_required" ? "consultation" : "tattoo";
    const purpose = asString(body.purpose) || inferredPurpose;
    if (!BOOKING_TOKEN_PURPOSES.has(purpose)) {
      return errorResponse("Booking purpose must be consultation or tattoo.", 400);
    }
    if (purpose === "consultation" && submission.tattoo_stage !== "consultation_required") {
      return errorResponse("Prerequisite consultation access requires the consultation-required stage.", 409);
    }
    if (purpose === "tattoo" && submission.tattoo_stage !== "ready_to_book") {
      return errorResponse("Tattoo booking access requires the ready-to-book stage.", 409);
    }
    let reviewedSessionPlan = null;
    let specialTerms = null;
    if (purpose === "tattoo") {
      reviewedSessionPlan = await loadTattooSessionPlan(db, submissionId);
      if (!reviewedSessionPlan || reviewedSessionPlan.session_category === "artist_review" || reviewedSessionPlan.split_policy === "artist_review") {
        return errorResponse("Finish and save the client's session estimate before generating booking access.", 409);
      }
      if (
        submission.source_path !== "/studio/direct-booking-invite"
        && !reviewedBudgetIsComplete(reviewedSessionPlan)
      ) {
        return errorResponse("Set the approved project budget before generating tattoo booking access.", 409, {
          code: "APPROVED_BUDGET_REQUIRED",
        });
      }
      if (submission.type === "tattoo_special") {
        specialTerms = await db.prepare(
          `SELECT booking_type_id, sales_closes_at, approved_price_cents, offer_title, variant_label
           FROM tattoo_special_submission_terms WHERE submission_id = ?`
        ).bind(submissionId).first();
        if (!specialTerms) return errorResponse("Tattoo Special terms are missing.", 409);
        if (new Date(specialTerms.sales_closes_at).getTime() <= Date.now()) {
          return errorResponse("The Tattoo Special sales window has closed.", 409, { code: "SPECIALS_WINDOW_CLOSED" });
        }
      }
    }

    const pendingTokenHolds = await db.prepare(
      `SELECT a.* FROM appointments a
       JOIN booking_tokens bt ON bt.id = a.booking_token_id
       WHERE bt.submission_id = ? AND bt.purpose = ?
         AND a.status IN ('pending_deposit','deposit_pending')
         AND a.hold_state IN ('active','expiry_attention')
       ORDER BY a.created_at ASC`
    ).bind(submissionId, purpose).all();
    if ((pendingTokenHolds.results || []).length) {
      if (body.revokeExisting === false) {
        return errorResponse("This project already has a pending checkout. Release it before creating parallel booking access.", 409, {
          code: "ACTIVE_TOKEN_CHECKOUT",
          appointmentId: pendingTokenHolds.results[0].id,
        });
      }
      const release = await releaseTokenCheckoutRows(
        db,
        env,
        request,
        pendingTokenHolds.results || [],
        "Pending checkout released before replacing its booking link",
      );
      if (release.error) {
        return errorResponse(release.error, 409, {
          code: release.code,
          detail: release.detail,
          ...(release.appointment ? { appointment: release.appointment } : {}),
        });
      }
    }

    const rawToken = createRawToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date().toISOString();
    const requestedExpiry = asOptionalString(body.expiresAt);
    let expiresAtMs = requestedExpiry
      ? new Date(requestedExpiry).getTime()
      : Date.now() + 1000 * 60 * 60 * 24 * 30;
    if (specialTerms) expiresAtMs = Math.min(expiresAtMs, new Date(specialTerms.sales_closes_at).getTime());
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return errorResponse("Booking link expiration must be a valid future timestamp.", 400);
    }
    const expiresAt = new Date(expiresAtMs).toISOString();
    const hasSuppliedBookingTypes = body.allowedBookingTypes !== undefined;
    if (hasSuppliedBookingTypes && !Array.isArray(body.allowedBookingTypes)) {
      return errorResponse("Allowed booking types must be a non-empty list.", 400);
    }
    const allowed = specialTerms
      ? [specialTerms.booking_type_id]
      : hasSuppliedBookingTypes
        ? body.allowedBookingTypes.map(asString).filter(Boolean)
        : purpose === "consultation"
          ? ["consult_in_person"]
          : [...SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing];
    if (!allowed.length) {
      return errorResponse("Allowed booking types must be a non-empty list.", 400);
    }
    if (new Set(allowed).size !== allowed.length) {
      return errorResponse("Allowed booking types must not contain duplicates.", 400);
    }
    if (!bookingTypesMatchPurpose(purpose, allowed)) {
      return errorResponse("Allowed booking types do not match the link purpose.", 400);
    }

    const configuredTypes = await db.prepare(
      `SELECT id FROM booking_types WHERE active = 1 AND id IN (${allowed.map(() => "?").join(",")})`
    ).bind(...allowed).all();
    if ((configuredTypes.results || []).length !== new Set(allowed).size) {
      return errorResponse("One or more selected booking types are unavailable.", 409);
    }

    const id = crypto.randomUUID();
    const bookingUrl = new URL("/booking/", baseUrlFromRequest(request));
    bookingUrl.searchParams.set("token", rawToken);
    const statements = [];
    if (body.revokeExisting !== false) {
      statements.push(db.prepare(
          `UPDATE booking_tokens
           SET revoked_at = ?, updated_at = ?
           WHERE submission_id = ? AND purpose = ? AND revoked_at IS NULL AND used_at IS NULL
             AND EXISTS (
               SELECT 1 FROM submissions s WHERE s.id = booking_tokens.submission_id
                 AND s.status = 'approved' AND s.tattoo_stage = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM appointments active_hold
               WHERE active_hold.booking_token_id = booking_tokens.id
                 AND active_hold.status IN ('pending_deposit','deposit_pending')
                 AND active_hold.hold_state IN ('active','expiry_attention')
             )`
        ).bind(
          now,
          now,
          submissionId,
          purpose,
          purpose === "consultation" ? "consultation_required" : "ready_to_book",
        ));
    }

    statements.push(
      db.prepare(
        `INSERT INTO booking_tokens (
          id, token_hash, submission_id, allowed_booking_types_json, purpose,
          expires_at, created_at, updated_at
        )
        SELECT ?, ?, s.id, ?, ?, ?, ?, ? FROM submissions s
        WHERE s.id = ? AND s.status = 'approved' AND s.tattoo_stage = ?
          AND (
            ? = 0 OR NOT EXISTS (
              SELECT 1 FROM booking_tokens prior_token
              WHERE prior_token.submission_id = s.id AND prior_token.purpose = ?
                AND prior_token.revoked_at IS NULL AND prior_token.used_at IS NULL
            )
          )`
      ).bind(
        id,
        tokenHash,
        JSON.stringify(allowed),
        purpose,
        expiresAt,
        now,
        now,
        submissionId,
        purpose === "consultation" ? "consultation_required" : "ready_to_book",
        body.revokeExisting === false ? 0 : 1,
        purpose,
      ),
      db.prepare(
        `UPDATE submissions SET booking_url = ?, updated_at = ?
         WHERE id = ? AND status = 'approved' AND tattoo_stage = ?
           AND EXISTS (SELECT 1 FROM booking_tokens bt WHERE bt.id = ? AND bt.submission_id = submissions.id)`
      ).bind(
        bookingUrl.pathname + bookingUrl.search,
        now,
        submissionId,
        purpose === "consultation" ? "consultation_required" : "ready_to_book",
        id,
      ),
      db.prepare(
        `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
         SELECT ?, id, 'booking_link_created', 'admin', ?, ? FROM submissions
         WHERE id = ? AND booking_url = ?`
      ).bind(
        crypto.randomUUID(),
        `${purpose}:${id}`,
        now,
        submissionId,
        bookingUrl.pathname + bookingUrl.search,
      ),
    );
    const tokenResults = await db.batch(statements);
    const submissionUpdateIndex = statements.length - 2;
    if (Number(tokenResults?.[submissionUpdateIndex]?.meta?.changes || 0) < 1) {
      const racedHold = await db.prepare(
        `SELECT a.* FROM appointments a
         JOIN booking_tokens bt ON bt.id = a.booking_token_id
         WHERE bt.submission_id = ? AND bt.purpose = ?
           AND bt.revoked_at IS NULL AND bt.used_at IS NULL
           AND a.status IN ('pending_deposit','deposit_pending')
           AND a.hold_state IN ('active','expiry_attention')
         ORDER BY a.created_at DESC LIMIT 1`
      ).bind(submissionId, purpose).first();
      if (racedHold) {
        return errorResponse("A checkout started while booking access was being replaced. Release it safely and retry.", 409, {
          code: "TOKEN_CHECKOUT_RACED",
          appointment: normalizeAppointment(racedHold),
        });
      }
      return errorResponse("Submission lifecycle changed before booking access could be created.", 409);
    }

    const delivery = { ok: false, skipped: true, reason: "explicit_client_notification_required" };

    return json({
      ok: true,
      token: {
        id,
        bookingUrl: bookingUrl.toString(),
        path: bookingUrl.pathname + bookingUrl.search,
        expiresAt,
        allowedBookingTypes: allowed,
        purpose,
        approvedBudget: reviewedBudgetIsComplete(reviewedSessionPlan)
          ? {
              minimumCents: reviewedSessionPlan.approved_budget_min_cents,
              maximumCents: reviewedSessionPlan.approved_budget_max_cents,
              currency: reviewedSessionPlan.approved_budget_currency || "USD",
            }
          : null,
      },
      delivery,
    });
  } catch (error) {
    return errorResponse("Unable to create booking link.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCreateDirectBookingInvite(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const projectNote = asString(body.projectNote);
  const clientEstimateNote = asString(body.clientEstimateNote);
  const purpose = asString(body.purpose) || "tattoo";
  const bookingTypeId = asString(body.bookingTypeId);
  const allowed = bookingTypeId ? [bookingTypeId] : [];
  if (projectNote.length > 2000) {
    return errorResponse("Project note must be 2,000 characters or fewer.", 400);
  }
  if (clientEstimateNote.length > 5000) {
    return errorResponse("Session estimate wording must be 5,000 characters or fewer.", 400);
  }
  if (!BOOKING_TOKEN_PURPOSES.has(purpose)) {
    return errorResponse("Booking purpose must be consultation or tattoo.", 400);
  }
  if (!allowed.length || !bookingTypesMatchPurpose(purpose, allowed)) {
    return errorResponse("Choose a session type that matches the link purpose.", 400);
  }

  const requestedExpiry = asOptionalString(body.expiresAt);
  if (requestedExpiry) {
    const expiresAtMs = new Date(requestedExpiry).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return errorResponse("Booking link expiration must be a valid future timestamp.", 400);
    }
  }

  const submissionId = crypto.randomUUID();
  try {
    const db = requireBookingDb(env);
    const configuredTypes = await db.prepare(
      `SELECT id, duration_minutes FROM booking_types
       WHERE active = 1 AND id IN (${allowed.map(() => "?").join(",")})`
    ).bind(...allowed).all();
    const typeRows = configuredTypes.results || [];
    if (typeRows.length !== allowed.length) {
      return errorResponse("One or more selected booking types are unavailable.", 409);
    }
    const sessionEstimateCopy = purpose === "tattoo"
      ? await loadSessionEstimateCopy(db)
      : DEFAULT_SESSION_ESTIMATE_COPY;

    const now = new Date().toISOString();
    const payload = {
      project_type: "direct_booking_invite",
      direct_booking_invite: "yes",
      message: projectNote,
      allowed_booking_types: allowed,
      booking_purpose: purpose,
    };
    const statements = [
      db.prepare(
        `INSERT INTO submissions (
          id, type, status, source_path, subject,
          contact_name, contact_email, contact_phone, contact_json,
          payload_json, request_meta_json, files_json, internal_notes,
          booking_url, tattoo_stage, lifecycle_review_required,
          lifecycle_review_note, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        submissionId,
        "tattoo_inquiry",
        "approved",
        "/studio/direct-booking-invite",
        "Direct booking invite",
        "",
        "",
        null,
        "{}",
        JSON.stringify(payload),
        JSON.stringify({ created_via: "studio_direct_booking_invite" }),
        "[]",
        projectNote,
        "",
        purpose === "consultation" ? "consultation_required" : "ready_to_book",
        0,
        "",
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        ) VALUES (?,?,?,?,?,?)`
      ).bind(
        crypto.randomUUID(),
        submissionId,
        "direct_booking_invite_created",
        "admin",
        `${purpose}:${allowed.join(",")}`,
        now,
      ),
    ];

    if (purpose === "tattoo") {
      const durations = typeRows.map((row) => Number(row.duration_minutes || 0)).filter((value) => value > 0);
      const minimumMinutes = durations.length ? Math.min(...durations) : null;
      const maximumMinutes = durations.length ? Math.max(...durations) : null;
      statements.push(
        db.prepare(
          `INSERT INTO tattoo_session_plans (
            id, submission_id, estimated_sessions_min, estimated_sessions_max,
            estimated_total_minutes_min, estimated_total_minutes_max,
            split_policy, artist_note, session_category, client_acknowledged,
            created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          crypto.randomUUID(),
          submissionId,
          1,
          1,
          minimumMinutes,
          maximumMinutes,
          "not_available",
          clientEstimateNote || directInviteSessionNote(bookingTypeId),
          "one_session",
          0,
          now,
          now,
        ),
      );
    }

    await db.batch(statements);

    const tokenRequest = new Request(
      new URL("/api/admin/booking/tokens", request.url),
      {
        method: "POST",
        headers: {
          "authorization": request.headers.get("authorization") || "",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          submissionId,
          purpose,
          allowedBookingTypes: allowed,
          expiresAt: requestedExpiry || undefined,
          revokeExisting: true,
          sendEmail: false,
        }),
      },
    );
    const tokenResponse = await handleAdminCreateBookingToken(tokenRequest, env);
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      const tokenCount = await db.prepare(
        "SELECT count(*) AS count FROM booking_tokens WHERE submission_id = ?"
      ).bind(submissionId).first();
      if (!Number(tokenCount?.count || 0)) {
        await db.prepare(
          "DELETE FROM submissions WHERE id = ? AND source_path = '/studio/direct-booking-invite'"
        ).bind(submissionId).run();
      }
      return json(tokenPayload, { status: tokenResponse.status });
    }

    return json({
      ...tokenPayload,
      directInvite: {
        submissionId,
        purpose,
      },
    });
  } catch (error) {
    return errorResponse("Unable to create direct booking invite.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminRevokeSubmissionBookingTokens(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const submissionId = asString(body.submissionId);
    if (!submissionId) return errorResponse("Submission id is required.", 400);
    const pending = await db.prepare(
      `SELECT a.* FROM appointments a
       JOIN booking_tokens bt ON bt.id = a.booking_token_id
       WHERE bt.submission_id = ?
         AND a.status IN ('pending_deposit','deposit_pending')
         AND a.hold_state IN ('active','expiry_attention')
       ORDER BY a.created_at ASC`
    ).bind(submissionId).all();
    const release = await releaseTokenCheckoutRows(
      db,
      env,
      request,
      pending.results || [],
      "Pending checkout released before revoking submission booking links",
    );
    if (release.error) {
      return errorResponse(release.error, 409, {
        code: release.code,
        detail: release.detail,
        ...(release.appointment ? { appointment: release.appointment } : {}),
      });
    }
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE booking_tokens
         SET revoked_at = ?, updated_at = ?
         WHERE submission_id = ? AND revoked_at IS NULL AND used_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM appointments active_hold
             WHERE active_hold.booking_token_id = booking_tokens.id
               AND active_hold.status IN ('pending_deposit','deposit_pending')
               AND active_hold.hold_state IN ('active','expiry_attention')
           )`
      )
      .bind(now, now, submissionId)
      .run();
    await db.prepare("UPDATE submissions SET booking_url='',updated_at=? WHERE id=?")
      .bind(now, submissionId)
      .run();
    const racedHold = await db.prepare(
      `SELECT a.* FROM appointments a
       JOIN booking_tokens bt ON bt.id = a.booking_token_id
       WHERE bt.submission_id = ? AND bt.revoked_at IS NULL AND bt.used_at IS NULL
         AND a.status IN ('pending_deposit','deposit_pending')
         AND a.hold_state IN ('active','expiry_attention')
       ORDER BY a.created_at DESC LIMIT 1`
    ).bind(submissionId).first();
    if (racedHold) {
      return errorResponse("A checkout started while booking links were being revoked. Release it safely and retry.", 409, {
        code: "TOKEN_CHECKOUT_RACED",
        appointment: normalizeAppointment(racedHold),
      });
    }
    return json({ ok: true, revokedAt: now });
  } catch (error) {
    return errorResponse("Unable to revoke booking links.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminRevokeBookingToken(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const token = await db.prepare("SELECT * FROM booking_tokens WHERE id = ?").bind(id).first();
    if (!token) return errorResponse("Booking token not found.", 404);
    const pending = await db.prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND status IN ('pending_deposit','deposit_pending')
         AND hold_state IN ('active','expiry_attention')
       ORDER BY created_at ASC`
    ).bind(id).all();
    const release = await releaseTokenCheckoutRows(
      db,
      env,
      request,
      pending.results || [],
      "Pending checkout released before revoking its booking link",
    );
    if (release.error) {
      return errorResponse(release.error, 409, {
        code: release.code,
        detail: release.detail,
        ...(release.appointment ? { appointment: release.appointment } : {}),
      });
    }
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE booking_tokens SET revoked_at = ?, updated_at = ?
         WHERE id = ? AND revoked_at IS NULL AND used_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM appointments active_hold
             WHERE active_hold.booking_token_id = booking_tokens.id
               AND active_hold.status IN ('pending_deposit','deposit_pending')
               AND active_hold.hold_state IN ('active','expiry_attention')
           )`
      )
      .bind(now, now, id)
      .run();
    if (!result.meta?.changes) {
      const racedHold = await db.prepare(
        `SELECT * FROM appointments
         WHERE booking_token_id = ?
           AND status IN ('pending_deposit','deposit_pending')
           AND hold_state IN ('active','expiry_attention')
         ORDER BY created_at DESC LIMIT 1`
      ).bind(id).first();
      if (racedHold) {
        return errorResponse("A checkout started while this booking link was being revoked. Release it safely and retry.", 409, {
          code: "TOKEN_CHECKOUT_RACED",
          appointment: normalizeAppointment(racedHold),
        });
      }
      return errorResponse("Booking token could not be revoked.", 409);
    }
    return json({ ok: true, revokedAt: now });
  } catch (error) {
    return errorResponse("Unable to revoke booking link.", 500, {
      detail: error.message,
    });
  }
}

function normalizeTattooSettingsRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reviewTimeMessage: row.review_time_message || "",
    leadTimeDays: Number(row.lead_time_days || 0),
    walkInGuidance: row.walk_in_guidance || "",
    supportEmail: row.support_email || DEFAULT_SUPPORT_EMAIL,
    sessionEstimateCopy: normalizeSessionEstimateCopy(row.session_estimate_copy_json),
    updatedAt: row.updated_at,
  };
}

function normalizeTattooRateCard(row) {
  return {
    serviceKey: row.service_key,
    label: row.label,
    rateText: row.rate_text,
    sortOrder: Number(row.sort_order || 0),
    active: Boolean(row.active),
  };
}

function normalizeSpecialProjectCall(row) {
  const now = new Date().toISOString();
  const isOpen = row.status === "open"
    && (!row.opens_at || row.opens_at <= now)
    && (!row.closes_at || row.closes_at > now);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || "",
    status: row.status,
    isOpen,
    rateText: row.rate_text || "",
    sortOrder: Number(row.sort_order || 0),
    opensAt: row.opens_at || "",
    closesAt: row.closes_at || "",
    updatedAt: row.updated_at,
  };
}

async function tattooSettingsPayload(db, includeInactive = false) {
  const [settingsResult, ratesResult, callsResult, hoursResult, bookingTypesResult] = await db.batch([
    db.prepare("SELECT * FROM tattoo_settings WHERE id = 'default'"),
    db.prepare(
      `SELECT * FROM tattoo_rate_cards ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY sort_order ASC, label ASC`
    ),
    db.prepare("SELECT * FROM special_project_calls ORDER BY sort_order ASC, title ASC"),
    db.prepare(
      `SELECT day_of_week, start_time, end_time, note FROM availability_rules
       WHERE venture = 'tattooing' AND category = 'tattooing' AND active = 1
       ORDER BY day_of_week ASC`
    ),
    db.prepare(
      `SELECT * FROM booking_types
       WHERE venture = 'tattooing' ${includeInactive ? "" : "AND active = 1"}
       ORDER BY sort_order ASC, label ASC`
    ),
  ]);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const settingsRow = settingsResult.results?.[0] || null;
  return {
    settings: normalizeTattooSettingsRow(settingsRow),
    rateCards: (ratesResult.results || []).map(normalizeTattooRateCard),
    specialProjects: (callsResult.results || []).map(normalizeSpecialProjectCall),
    bookingTypes: (bookingTypesResult.results || []).map(normalizeBookingType),
    displayedHours: (hoursResult.results || []).map((row) => ({
      dayOfWeek: Number(row.day_of_week),
      day: dayNames[Number(row.day_of_week)] || "",
      dayLabel: dayNames[Number(row.day_of_week)] || "",
      startTime: row.start_time,
      endTime: row.end_time,
      hoursText: `${row.start_time} - ${row.end_time}`,
      note: row.note || "",
      closed: false,
    })),
  };
}

export async function handlePublicTattooSettings(request, env) {
  try {
    return json(await tattooSettingsPayload(requireBookingDb(env), false));
  } catch (error) {
    return errorResponse("Unable to load tattoo settings.", 500, { detail: error.message });
  }
}

export async function handleAdminTattooSettings(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = requireBookingDb(env);
    if (request.method === "GET") return json(await tattooSettingsPayload(db, true));
    const body = await readJsonBody(request);
    if (!body) return errorResponse("Expected JSON body.", 400);
    const statements = [];
    const now = new Date().toISOString();

    if (body.settings && typeof body.settings === "object") {
      const current = await db.prepare("SELECT * FROM tattoo_settings WHERE id = 'default'").first();
      const reviewTimeMessage = asString(body.settings.reviewTimeMessage ?? current?.review_time_message).slice(0, 500);
      const leadTimeDays = asPositiveInteger(body.settings.leadTimeDays, Number(current?.lead_time_days ?? 14));
      const walkInGuidance = asString(body.settings.walkInGuidance ?? current?.walk_in_guidance).slice(0, 2000);
      const supportEmail = asString(body.settings.supportEmail ?? current?.support_email).toLowerCase();
      const sessionEstimateCopy = normalizeSessionEstimateCopy(
        body.settings.sessionEstimateCopy ?? current?.session_estimate_copy_json
      );
      const sessionEstimateCopyJson = JSON.stringify(Object.fromEntries(
        Object.entries(sessionEstimateCopy).map(([key, value]) => [key, value.slice(0, 2000)])
      ));
      if (!supportEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
        return errorResponse("A valid tattoo support email is required.", 400);
      }
      statements.push(db.prepare(
        `INSERT INTO tattoo_settings (
          id, review_time_message, lead_time_days, walk_in_guidance, support_email,
          session_estimate_copy_json, updated_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          review_time_message = excluded.review_time_message,
          lead_time_days = excluded.lead_time_days,
          walk_in_guidance = excluded.walk_in_guidance,
          support_email = excluded.support_email,
          session_estimate_copy_json = excluded.session_estimate_copy_json,
          updated_at = excluded.updated_at`
      ).bind(
        reviewTimeMessage,
        leadTimeDays,
        walkInGuidance,
        supportEmail,
        sessionEstimateCopyJson,
        now,
      ));
    }

    if (Array.isArray(body.rateCards)) {
      for (const card of body.rateCards) {
        const serviceKey = asString(card.serviceKey || card.service_key);
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(serviceKey)) {
          return errorResponse("Each rate card requires a stable serviceKey.", 400);
        }
        if (card._delete === true) {
          statements.push(db.prepare("DELETE FROM tattoo_rate_cards WHERE service_key = ?").bind(serviceKey));
          continue;
        }
        const label = asString(card.label).slice(0, 200);
        const rateText = asString(card.rateText ?? card.rate_text).slice(0, 200);
        if (!label || !rateText) return errorResponse("Rate-card label and rateText are required.", 400);
        statements.push(db.prepare(
          `INSERT INTO tattoo_rate_cards (service_key, label, rate_text, sort_order, active)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(service_key) DO UPDATE SET label = excluded.label,
             rate_text = excluded.rate_text, sort_order = excluded.sort_order, active = excluded.active`
        ).bind(serviceKey, label, rateText, asPositiveInteger(card.sortOrder, 0), card.active === false ? 0 : 1));
      }
    }

    const specialProjects = Array.isArray(body.specialProjects) ? body.specialProjects : [];
    for (const call of specialProjects) {
      const id = asString(call.id || call.slug);
      const slug = asString(call.slug || call.id);
      if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(id) || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug)) {
        return errorResponse("Each Special Project requires stable lowercase id and slug values.", 400);
      }
      if (call._delete === true) {
        statements.push(db.prepare("DELETE FROM special_project_calls WHERE id = ?").bind(id));
        continue;
      }
      const status = asString(call.status) || "closed";
      if (!new Set(["open", "closed"]).has(status)) return errorResponse("Special Project status must be open or closed.", 400);
      const title = asString(call.title).slice(0, 200);
      if (!title) return errorResponse("Special Project title is required.", 400);
      statements.push(db.prepare(
        `INSERT INTO special_project_calls (
          id, slug, title, summary, status, rate_text, sort_order, opens_at, closes_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title,
          summary = excluded.summary, status = excluded.status, rate_text = excluded.rate_text,
          sort_order = excluded.sort_order, opens_at = excluded.opens_at,
          closes_at = excluded.closes_at, updated_at = excluded.updated_at`
      ).bind(
        id,
        slug,
        title,
        asString(call.summary).slice(0, 5000),
        status,
        asString(call.rateText ?? call.rate_text).slice(0, 200),
        asPositiveInteger(call.sortOrder, 0),
        asOptionalString(call.opensAt ?? call.opens_at),
        asOptionalString(call.closesAt ?? call.closes_at),
        now,
      ));
    }

    if (statements.length) await db.batch(statements);
    return json({ ok: true, ...(await tattooSettingsPayload(db, true)) });
  } catch (error) {
    return errorResponse("Unable to save tattoo settings.", 500, { detail: error.message });
  }
}

export async function handleAdminGetSchedule(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const settings = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const rules = await db
      .prepare(
        `SELECT * FROM availability_rules
         WHERE venture = ?
         ORDER BY category ASC, day_of_week ASC`
      )
      .bind("tattooing")
      .all();
    return json({
      settings: settings ? normalizeSettings(settings) : null,
      rules: (rules.results || []).map(normalizeRule),
    });
  } catch (error) {
    return errorResponse("Unable to load schedule.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminGetBookingReadiness(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const requestedScope = new URL(request.url).searchParams.get("scope");
    const scope = ["art", "studio"].includes(requestedScope) ? requestedScope : "tattoo";
    const usesStudioPayments = scope === "art" || scope === "studio";
    const settingsRow = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const settings = settingsRow ? normalizeSettings(settingsRow) : null;
    const rules = await db
      .prepare(
        `SELECT category, active FROM availability_rules
         WHERE venture = ?`
      )
      .bind("tattooing")
      .all();
    const bookingTypes = await db
      .prepare(
        `SELECT id, active, deposit_cents
         FROM booking_types
         WHERE venture = ?`
      )
      .bind("tattooing")
      .all();

    const activeRules = rules.results || [];
    const activeBookingTypes = bookingTypes.results || [];
    const activeArtVisitBookingTypes = activeBookingTypes.filter(
      (type) => ART_VISIT_BOOKING_TYPE_IDS.includes(type.id) && type.active
    );
    const activeStudioSpaceBookingTypes = activeBookingTypes.filter(
      (type) => STUDIO_SPACE_BOOKING_TYPE_IDS.includes(type.id) && type.active
    );
    const activePublicBookingTypes = activeBookingTypes.filter(
      (type) => PUBLIC_SESSION_BOOKING_TYPE_IDS.includes(type.id) && type.active
    );
    const hasConsultationRule = activeRules.some(
      (rule) => (rule.category || "tattooing") === "consultation" && rule.active
    );
    const hasArtVisitRule = activeRules.some(
      (rule) => (rule.category || "tattooing") === "art_visit" && rule.active
    );
    const hasStudioSpaceRule = activeRules.some(
      (rule) => (rule.category || "tattooing") === "studio_space" && rule.active
    );
    const appointmentMeetingsReady = await tableReady(db, "appointment_meetings");
    const squareWebhookUrl = usesStudioPayments
      ? studioSquareWebhookNotificationUrl(request, env)
      : squareWebhookNotificationUrl(request, env);
    const sharedSettingsReady = Boolean(
      settings &&
      asString(settings.timezone) &&
      requiredPositiveSetting(settings, "bookingHorizonDays") &&
      requiredPositiveSetting(settings, "slotIntervalMinutes") &&
      requiredPositiveSetting(settings, "maxBookingsPerDay") &&
      requiredPositiveSetting(settings, "defaultCapacity")
    );
    const tattooSettingsReady = Boolean(
      sharedSettingsReady &&
      activePublicBookingTypes.length > 0 &&
      hasConsultationRule
    );
    const artVisitSettingsReady = Boolean(
      sharedSettingsReady &&
      activeArtVisitBookingTypes.length > 0 &&
      hasArtVisitRule
    );
    const studioSpaceSettingsReady = Boolean(
      sharedSettingsReady &&
      activeStudioSpaceBookingTypes.length > 0 &&
      hasStudioSpaceRule
    );
    const scopedSettingsReady = scope === "art"
      ? artVisitSettingsReady
      : scope === "studio"
        ? studioSpaceSettingsReady
        : tattooSettingsReady;
    const squareCheckoutReady = usesStudioPayments
      ? squareConfiguredForBookingType(env, scope === "art" ? "studio_visit" : "studio_gathering")
      : squareConfigured(env);
    const squareSignatureReady = usesStudioPayments
      ? Boolean(asString(env.SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY))
      : Boolean(asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY));
    const squareLocationId = usesStudioPayments
      ? asString(env.SQUARE_STUDIO_LOCATION_ID)
      : asString(env.SQUARE_LOCATION_ID);
    const squareMissingMessage = usesStudioPayments
      ? "Missing SQUARE_ACCESS_TOKEN or SQUARE_STUDIO_LOCATION_ID."
      : "Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID.";
    const webhookMissingMessage = usesStudioPayments
      ? "Missing SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY, so paid studio bookings cannot be trusted from Square webhooks."
      : "Missing SQUARE_WEBHOOK_SIGNATURE_KEY, so paid appointments cannot be trusted from Square webhooks.";
    const scopeLabel = scope === "art" ? "Studio Visit" : scope === "studio" ? "Room booking" : "Booking";
    const scopedTypes = scope === "art"
      ? activeArtVisitBookingTypes
      : scope === "studio"
        ? activeStudioSpaceBookingTypes
        : activePublicBookingTypes;
    const scopedRuleCount = scope === "art"
      ? activeRules.filter((rule) => (rule.category || "tattooing") === "art_visit" && rule.active).length
      : scope === "studio"
        ? activeRules.filter((rule) => (rule.category || "tattooing") === "studio_space" && rule.active).length
        : activeRules.filter((rule) => (rule.category || "tattooing") === "consultation" && rule.active).length;

    const checks = [
      readinessItem(
        usesStudioPayments ? "studio_square_checkout" : "square_checkout",
        usesStudioPayments ? "Studio Square checkout" : "Square checkout",
        squareCheckoutReady,
        squareCheckoutReady
          ? `Checkout can create ${env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox"} Square payment links.`
          : squareMissingMessage,
        {
          environment: env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
          hasAccessToken: Boolean(asString(env.SQUARE_ACCESS_TOKEN)),
          hasLocationId: Boolean(squareLocationId),
          scope,
        }
      ),
      readinessItem(
        usesStudioPayments ? "studio_square_webhook_signing" : "square_webhook_signing",
        usesStudioPayments ? "Studio Square webhook signing" : "Square webhook signing",
        squareSignatureReady,
        squareSignatureReady
          ? "Webhook signature verification is configured."
          : webhookMissingMessage,
        {
          hasSignatureKey: squareSignatureReady,
          notificationUrl: squareWebhookUrl,
          scope,
        }
      ),
      ...(usesStudioPayments ? [] : [readinessItem(
        "zoom_credentials",
        "Zoom credentials",
        zoomConfigured(env) && appointmentMeetingsReady,
        zoomConfigured(env)
          ? appointmentMeetingsReady
            ? "Zoom Server-to-Server OAuth credentials and meeting storage are present."
            : "Zoom credentials are present, but the appointment_meetings migration is not available."
          : "Missing one or more Zoom Server-to-Server OAuth settings.",
        {
          hasAccountId: Boolean(asString(env.ZOOM_ACCOUNT_ID)),
          hasClientId: Boolean(asString(env.ZOOM_CLIENT_ID)),
          hasClientSecret: Boolean(asString(env.ZOOM_CLIENT_SECRET)),
          hasHostUserId: Boolean(asString(env.ZOOM_HOST_USER_ID)),
          appointmentMeetingsTable: appointmentMeetingsReady,
        }
      )]),
      readinessItem(
        "booking_settings",
        `${scopeLabel} settings`,
        scopedSettingsReady,
        usesStudioPayments
          ? scopedSettingsReady
            ? `${scopeLabel} settings, booking types, and hours are ready.`
            : `${scopeLabel} settings need a horizon, interval, daily limit, capacity, active booking type, and active hours.`
          : tattooSettingsReady
            ? "Booking settings, public consultation types, and consultation schedule are ready."
            : "Booking settings need a horizon, interval, daily limit, capacity, public consultation type, and active consultation hours.",
        {
          settings,
          scope,
          publicConsultationTypes: activePublicBookingTypes.map((type) => ({
            id: type.id,
            depositCents: type.deposit_cents,
          })),
          publicStudioTypes: scopedTypes.map((type) => ({
            id: type.id,
            depositCents: type.deposit_cents,
          })),
          activeConsultationRuleCount: activeRules.filter((rule) => (rule.category || "tattooing") === "consultation" && rule.active).length,
          activeStudioRuleCount: scopedRuleCount,
        }
      ),
    ];

    return json({
      ok: true,
      scope,
      ready: checks.every((check) => check.ready),
      checkedAt: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    return errorResponse("Unable to load booking readiness.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListBookingTypes(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db
      .prepare(
        `SELECT * FROM booking_types
         WHERE venture = ?
         ORDER BY sort_order ASC, label ASC`
      )
      .bind("tattooing")
      .all();
    return json({ bookingTypes: (result.results || []).map(normalizeBookingType) });
  } catch (error) {
    return errorResponse("Unable to load booking types.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateBookingType(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const deposit = parseDepositCents(body.depositCents);
  if (deposit.error) return errorResponse(deposit.error, 400);
  const sessionFee = parseDepositCents(body.sessionFeeCents ?? 0);
  if (sessionFee.error) return errorResponse(sessionFee.error.replace("Deposit", "Session fee"), 400);

  try {
    const db = requireBookingDb(env);
    const existing = await db
      .prepare("SELECT * FROM booking_types WHERE id = ? AND venture = ?")
      .bind(id, "tattooing")
      .first();
    if (!existing) return errorResponse("Booking type not found.", 404);

    await db
      .prepare("UPDATE booking_types SET deposit_cents = ?, session_fee_cents = ?, updated_at = ? WHERE id = ?")
      .bind(deposit.depositCents, sessionFee.depositCents, new Date().toISOString(), id)
      .run();

    const updated = await db
      .prepare("SELECT * FROM booking_types WHERE id = ?")
      .bind(id)
      .first();
    return json({ bookingType: normalizeBookingType(updated) });
  } catch (error) {
    return errorResponse("Unable to update booking type.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateSchedule(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const settings = body.settings || {};
    await db
      .prepare(
        `UPDATE booking_settings
         SET timezone = ?, booking_horizon_days = ?, minimum_notice_hours = ?,
             slot_interval_minutes = ?, max_bookings_per_day = ?,
             default_capacity = ?, default_buffer_before_minutes = ?,
             default_buffer_after_minutes = ?, updated_at = ?
         WHERE venture = ?`
      )
      .bind(
        asString(settings.timezone) || "America/New_York",
        Math.max(1, Math.min(asPositiveInteger(settings.bookingHorizonDays, 60), 180)),
        Math.max(0, asPositiveInteger(settings.minimumNoticeHours, 48)),
        Math.max(15, asPositiveInteger(settings.slotIntervalMinutes, 30)),
        Math.max(1, asPositiveInteger(settings.maxBookingsPerDay, 1)),
        Math.max(1, asPositiveInteger(settings.defaultCapacity, 1)),
        asPositiveInteger(settings.defaultBufferBeforeMinutes, 30),
        asPositiveInteger(settings.defaultBufferAfterMinutes, 30),
        now,
        "tattooing"
      )
      .run();

    for (const rule of Array.isArray(body.rules) ? body.rules : []) {
      const startTime = asString(rule.startTime) || "12:00";
      const endTime = asString(rule.endTime) || "18:00";
      if (!isValidTime(startTime) || !isValidTime(endTime)) {
        return errorResponse("Schedule start and end times must use HH:MM format.", 400);
      }
      if (minutesFromTime(endTime) <= minutesFromTime(startTime)) {
        return errorResponse("Schedule end time must be after start time.", 400);
      }

      await db
        .prepare(
          `UPDATE availability_rules
           SET start_time = ?, end_time = ?, active = ?, capacity = ?,
               buffer_before_minutes = ?, buffer_after_minutes = ?,
               note = ?, updated_at = ?
           WHERE id = ? AND venture = ?`
        )
        .bind(
          startTime,
          endTime,
          rule.active ? 1 : 0,
          Math.max(1, asPositiveInteger(rule.capacity, settings.defaultCapacity || 1)),
          asPositiveInteger(rule.bufferBeforeMinutes, settings.defaultBufferBeforeMinutes || 30),
          asPositiveInteger(rule.bufferAfterMinutes, settings.defaultBufferAfterMinutes || 30),
          asString(rule.note),
          now,
          asString(rule.id),
          "tattooing"
        )
        .run();
    }

    return handleAdminGetSchedule(request, env);
  } catch (error) {
    return errorResponse("Unable to update schedule.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListAvailability(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const scope = availabilityScopeFromRequest(request);
    const typeIds = scope.bookingTypeIds || [];
    const scopedTypeClause = typeIds.length
      ? ` AND (${scope.includeUnscoped ? "booking_type_id IS NULL OR " : ""}booking_type_id IN (${typeIds.map(() => "?").join(", ")}))`
      : "";
    const result = await db
      .prepare(
        `SELECT * FROM availability_windows
         WHERE venture = ? AND id NOT LIKE 'gen:%'
         ${scopedTypeClause}
         ORDER BY
           CASE WHEN end_at >= ? THEN 0 ELSE 1 END ASC,
           CASE WHEN end_at >= ? THEN start_at END ASC,
           CASE WHEN end_at < ? THEN start_at END DESC
         LIMIT 100`
      )
      .bind("tattooing", ...typeIds, now, now, now)
      .all();
    return json({ scope: scope.scope, availabilityWindows: (result.results || []).map(normalizeWindow) });
  } catch (error) {
    return errorResponse("Unable to load availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListWalkIns(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const scope = availabilityScopeFromRequest(request);
    if (scope.scope === "studio" || scope.scope === "art") {
      return json({ scope: scope.scope, walkInWindows: [] });
    }
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT * FROM walk_in_windows
         WHERE venture = ?
         ORDER BY
           CASE WHEN ends_at >= ? THEN 0 ELSE 1 END ASC,
           CASE WHEN ends_at >= ? THEN starts_at END ASC,
           CASE WHEN ends_at < ? THEN starts_at END DESC
         LIMIT 100`
      )
      .bind("tattooing", now, now, now)
      .all();
    return json({ scope: scope.scope, walkInWindows: (result.results || []).map(normalizeWalkInWindow) });
  } catch (error) {
    return errorResponse("Unable to load walk-in windows.", 500, {
      detail: error.message,
    });
  }
}

function validateWalkInWindowBody(body, current = null) {
  const startsAt = body.startsAt === undefined ? current?.starts_at : asString(body.startsAt);
  const endsAt = body.endsAt === undefined ? current?.ends_at : asString(body.endsAt);
  if (!startsAt || !endsAt || new Date(startsAt).toString() === "Invalid Date" || new Date(endsAt).toString() === "Invalid Date") {
    return { error: "Valid startsAt and endsAt are required." };
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: "endsAt must be after startsAt." };
  }
  return {
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    title: body.title === undefined ? current?.title || "Walk-in Window" : asString(body.title) || "Walk-in Window",
    note: body.note === undefined ? current?.note || "" : asString(body.note),
    active: body.active === undefined ? current?.active ?? 1 : body.active ? 1 : 0,
  };
}

export async function handleAdminCreateWalkIn(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const next = validateWalkInWindowBody(body);
  if (next.error) return errorResponse(next.error, 400);

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO walk_in_windows (
          id, venture, starts_at, ends_at, title, note, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, "tattooing", next.startsAt, next.endsAt, next.title, next.note, next.active, now, now)
      .run();
    const row = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    return json({ walkInWindow: normalizeWalkInWindow(row) });
  } catch (error) {
    return errorResponse("Unable to create walk-in window.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateWalkIn(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const current = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Walk-in window not found.", 404);
    const next = validateWalkInWindowBody(body, current);
    if (next.error) return errorResponse(next.error, 400);
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE walk_in_windows
         SET starts_at = ?, ends_at = ?, title = ?, note = ?, active = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(next.startsAt, next.endsAt, next.title, next.note, next.active, now, id)
      .run();
    const row = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    return json({ walkInWindow: normalizeWalkInWindow(row) });
  } catch (error) {
    return errorResponse("Unable to update walk-in window.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminDeleteWalkIn(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db.prepare("DELETE FROM walk_in_windows WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return errorResponse("Walk-in window not found.", 404);
    return json({ ok: true, deletedId: id });
  } catch (error) {
    return errorResponse("Unable to delete walk-in window.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCreateAvailability(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const startAt = asString(body.startAt);
  const endAt = asString(body.endAt);
  if (!startAt || !endAt || new Date(startAt).toString() === "Invalid Date" || new Date(endAt).toString() === "Invalid Date") {
    return errorResponse("Valid startAt and endAt are required.", 400);
  }
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    return errorResponse("endAt must be after startAt.", 400);
  }
  if (
    !body.isBlackout
    && asString(body.bookingTypeId) === EXTENDED_DAY_BOOKING_TYPE_ID
    && new Date(endAt).getTime() - new Date(startAt).getTime() !== 600 * 60 * 1000
  ) {
    return errorResponse("Extended Day availability must reserve exactly 10 hours.", 400);
  }

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const venture = asString(body.venture) || "tattooing";
    const candidate = {
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      buffer_before_minutes: asPositiveInteger(body.bufferBeforeMinutes, 0),
      buffer_after_minutes: asPositiveInteger(body.bufferAfterMinutes, 0),
    };
    if (!body.isBlackout) {
      const existing = await db
        .prepare(
          `SELECT * FROM availability_windows
           WHERE active = 1 AND is_blackout = 0 AND venture = ?`
        )
        .bind(venture)
        .all();
      const candidateInterval = intervalWithBuffer(candidate);
      const conflicts = (existing.results || []).some((row) =>
        intervalsOverlap(candidateInterval, intervalWithBuffer(row))
      );
      if (conflicts) {
        return errorResponse("That window overlaps an existing active window or buffer.", 400);
      }
    }
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO availability_windows (
          id, venture, booking_type_id, start_at, end_at, capacity,
          buffer_before_minutes, buffer_after_minutes, is_blackout,
          active, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        venture,
        asOptionalString(body.bookingTypeId),
        candidate.start_at,
        candidate.end_at,
        Math.max(1, asPositiveInteger(body.capacity, 1)),
        candidate.buffer_before_minutes,
        candidate.buffer_after_minutes,
        body.isBlackout ? 1 : 0,
        body.active === false ? 0 : 1,
        asString(body.note),
        now,
        now
      )
      .run();
    const row = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    return json({ availabilityWindow: normalizeWindow(row) });
  } catch (error) {
    return errorResponse("Unable to create availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminGetAvailabilityPreview(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const scope = availabilityScopeFromRequest(request);
    const settingsRow = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const settings = settingsRow ? normalizeSettings(settingsRow) : null;
    const bookingTypes = await listBookingTypes(db, scope.bookingTypeIds);
    const availabilityWindows = await listPublicWindows(db, bookingTypes);
    const bookedDays = settings
      ? bookedDaysFromMap(await loadBookingsByLocalDay(db, settings.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), scope.bookingTypeIds))
      : [];

    return json({
      scope: scope.scope,
      settings,
      bookingTypes,
      availabilityWindows,
      bookedDays,
    });
  } catch (error) {
    return errorResponse("Unable to load availability preview.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateAvailability(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const current = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Availability window not found.", 404);
    const now = new Date().toISOString();
    const startAt = body.startAt === undefined ? current.start_at : asString(body.startAt);
    const endAt = body.endAt === undefined ? current.end_at : asString(body.endAt);
    if (!startAt || !endAt || new Date(startAt).toString() === "Invalid Date" || new Date(endAt).toString() === "Invalid Date") {
      return errorResponse("Valid startAt and endAt are required.", 400);
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return errorResponse("endAt must be after startAt.", 400);
    }
    const next = {
      venture: current.venture || "tattooing",
      booking_type_id: body.bookingTypeId === undefined ? current.booking_type_id : asOptionalString(body.bookingTypeId),
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      capacity: Math.max(1, asPositiveInteger(body.capacity, current.capacity || 1)),
      buffer_before_minutes: body.bufferBeforeMinutes === undefined
        ? current.buffer_before_minutes
        : asPositiveInteger(body.bufferBeforeMinutes, 0),
      buffer_after_minutes: body.bufferAfterMinutes === undefined
        ? current.buffer_after_minutes
        : asPositiveInteger(body.bufferAfterMinutes, 0),
      is_blackout: body.isBlackout === undefined ? current.is_blackout : body.isBlackout ? 1 : 0,
      active: body.active === undefined ? current.active : body.active ? 1 : 0,
      note: body.note === undefined ? current.note : asString(body.note),
    };
    if (
      !next.is_blackout
      && next.booking_type_id === EXTENDED_DAY_BOOKING_TYPE_ID
      && new Date(next.end_at).getTime() - new Date(next.start_at).getTime() !== 600 * 60 * 1000
    ) {
      return errorResponse("Extended Day availability must reserve exactly 10 hours.", 400);
    }
    if (!next.is_blackout && next.active) {
      const existing = await db
        .prepare(
          `SELECT * FROM availability_windows
           WHERE active = 1 AND is_blackout = 0 AND venture = ? AND id != ?`
        )
        .bind(next.venture, id)
        .all();
      const candidateInterval = intervalWithBuffer(next);
      const conflicts = (existing.results || []).some((row) =>
        intervalsOverlap(candidateInterval, intervalWithBuffer(row))
      );
      if (conflicts) {
        return errorResponse("That window overlaps an existing active window or buffer.", 400);
      }
    }
    await db
      .prepare(
        `UPDATE availability_windows
         SET booking_type_id = ?, start_at = ?, end_at = ?, capacity = ?,
             buffer_before_minutes = ?, buffer_after_minutes = ?,
             active = ?, is_blackout = ?, note = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        next.booking_type_id,
        next.start_at,
        next.end_at,
        next.capacity,
        next.buffer_before_minutes,
        next.buffer_after_minutes,
        next.active,
        next.is_blackout,
        next.note,
        now,
        id
      )
      .run();
    const row = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    return json({ availabilityWindow: normalizeWindow(row) });
  } catch (error) {
    return errorResponse("Unable to update availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminDeleteAvailability(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db
      .prepare("DELETE FROM availability_windows WHERE id = ? AND id NOT LIKE 'gen:%'")
      .bind(id)
      .run();
    if (!result.meta?.changes) return errorResponse("Availability window not found.", 404);
    return json({ ok: true, deletedId: id });
  } catch (error) {
    return errorResponse("Unable to delete availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListAppointments(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db
      .prepare(
        `SELECT a.*, bt.label AS booking_type_label, s.type AS submission_type,
                tst.offer_title AS special_offer_title, tst.variant_label AS special_variant_label,
                CASE WHEN a.status IN ('pending_deposit','deposit_pending','cancelled','archived')
                  AND NOT EXISTS (
                    SELECT 1 FROM deposit_payments protected_payment
                    WHERE protected_payment.appointment_id = a.id
                      AND (
                        lower(protected_payment.status) IN ('paid','completed','settled','payment_attention')
                        OR trim(COALESCE(protected_payment.provider_payment_id, '')) <> ''
                      )
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM tattoo_rendering_requests protected_rendering
                    WHERE protected_rendering.appointment_id = a.id
                      AND (
                        protected_rendering.status IN ('paid','payment_attention')
                        OR trim(COALESCE(protected_rendering.square_payment_id, '')) <> ''
                      )
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM archive_tattoo_session_refs archive_session
                    WHERE archive_session.appointment_id = a.id
                  )
                  THEN 1 ELSE 0 END AS can_permanently_delete,
                am.provider AS meeting_provider,
                am.provider_meeting_id,
                am.join_url AS meeting_join_url,
                am.password AS meeting_password,
                am.created_at AS meeting_created_at,
                am.updated_at AS meeting_updated_at
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         LEFT JOIN submissions s ON s.id = a.submission_id
         LEFT JOIN tattoo_special_submission_terms tst ON tst.submission_id = a.submission_id
         LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
         ORDER BY a.start_at DESC
         LIMIT 100`
      )
      .all();
    return json({ appointments: (result.results || []).map(normalizeAppointment) });
  } catch (error) {
    return errorResponse("Unable to load appointments.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCompleteAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request) || {};
  try {
    const db = requireBookingDb(env);
    const row = await selectAppointmentWithMeeting(db, appointmentId);
    if (!row) return errorResponse("Appointment not found.", 404);
    const historicalResolution = body.resolveHistorical === true
      && ["confirmed", "completed"].includes(row.status);
    if (row.status !== "confirmed" && !historicalResolution) {
      return errorResponse("Only confirmed appointments can be completed. Historical completed records require resolveHistorical: true.", 409);
    }
    if (!row.start_at || new Date(row.start_at).getTime() > Date.now()) {
      return errorResponse("Appointments can only be completed after their scheduled start time.", 409);
    }
    const purpose = row.purpose || purposeForBookingType(row.booking_type_id, Boolean(row.booking_token_id));
    if (!APPOINTMENT_PURPOSES.has(purpose)) return errorResponse("Appointment purpose is invalid.", 409);
    if (historicalResolution) {
      if (purpose !== "prerequisite_consultation") {
        return errorResponse("Historic lifecycle resolution through completion applies only to prerequisite consultations.", 409);
      }
      const parent = row.submission_id
        ? await db.prepare(
          `SELECT lifecycle_review_required, status, tattoo_stage
           FROM submissions WHERE id = ?`
        ).bind(row.submission_id).first()
        : null;
      if (!parent || Number(parent.lifecycle_review_required || 0) !== 1) {
        return errorResponse("This historical completion is not flagged for lifecycle review.", 409);
      }
      if (
        !["approved", "booked"].includes(parent.status)
        || !["consultation_required", "consultation_scheduled"].includes(parent.tattoo_stage)
      ) {
        return errorResponse("The flagged parent is not in a prerequisite-consultation state that can be resolved.", 409);
      }
    }
    const note = asString(body.note || body.completionNote).slice(0, 5000);
    const now = new Date().toISOString();
    const statements = [
      db.prepare(
        `UPDATE appointments
         SET status = 'completed', completed_at = COALESCE(completed_at, ?), completion_note = ?, updated_at = ?
         WHERE id = ? AND (
           (status = 'confirmed' AND completed_at IS NULL)
           OR (? = 1 AND status = 'completed')
         )`
      ).bind(now, note, now, appointmentId, historicalResolution ? 1 : 0),
      db.prepare(
        `INSERT INTO appointment_events (
          id, appointment_id, event_type, actor, note, metadata_json, created_at
        )
        SELECT ?, id, ?, 'admin', ?, ?, ? FROM appointments
        WHERE id = ? AND status = 'completed' AND updated_at = ?`
      ).bind(
        crypto.randomUUID(),
        historicalResolution ? "historical_completion_resolved" : "completed",
        note || null,
        JSON.stringify({ purpose, historicalResolution }),
        now,
        appointmentId,
        now,
      ),
    ];
    if (row.submission_id && purpose === "prerequisite_consultation") {
      statements.push(
        db.prepare(
          `UPDATE submissions
           SET status = 'approved', tattoo_stage = 'consultation_complete', lifecycle_review_required = 0,
               lifecycle_review_note = '', updated_at = ?
           WHERE id = ? AND status IN ('approved','booked')
             AND (
               (? = 0 AND tattoo_stage = 'consultation_scheduled')
               OR (
                 ? = 1 AND lifecycle_review_required = 1
                 AND tattoo_stage IN ('consultation_required','consultation_scheduled')
               )
             )
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'completed'
                 AND a.updated_at = ?
                 AND a.submission_id = submissions.id
             )`
        ).bind(
          now,
          row.submission_id,
          historicalResolution ? 1 : 0,
          historicalResolution ? 1 : 0,
          appointmentId,
          now,
        ),
        db.prepare(
          `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
           SELECT ?, id, ?, 'admin', ?, ? FROM submissions
           WHERE id = ? AND tattoo_stage = 'consultation_complete' AND updated_at = ?
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'completed'
                 AND a.updated_at = ?
             )`
        ).bind(
          crypto.randomUUID(),
          historicalResolution ? "historical_lifecycle_resolved" : "consultation_completed",
          historicalResolution
            ? `Historic prerequisite consultation ${appointmentId} reconciled by Studio.`
            : appointmentId,
          now,
          row.submission_id,
          now,
          appointmentId,
          now,
        ),
      );
    } else if (row.submission_id && purpose === "tattoo") {
      statements.push(
        db.prepare(
          `UPDATE submissions
           SET tattoo_stage = 'closed', lifecycle_review_required = 0,
               lifecycle_review_note = '', updated_at = ?
           WHERE id = ? AND tattoo_stage = 'tattoo_scheduled'
             AND (? = 0 OR lifecycle_review_required = 1)
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'completed'
                 AND a.updated_at = ?
                 AND a.submission_id = submissions.id
             )`
        ).bind(now, row.submission_id, historicalResolution ? 1 : 0, appointmentId, now),
        db.prepare(
          `UPDATE flash_items
           SET state = 'placed', claimable = 0, updated_at = ?
           WHERE reserved_submission_id = ? AND state = 'reserved'
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'completed'
                 AND a.updated_at = ?
                 AND a.submission_id = flash_items.reserved_submission_id
           )`
        ).bind(now, row.submission_id, appointmentId, now),
        db.prepare(
          `UPDATE flash_sheet_designs
           SET state='placed',updated_at=?
           WHERE reserved_submission_id=? AND state='reserved'
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id=? AND a.status='completed'
                 AND a.updated_at=?
                 AND a.submission_id=flash_sheet_designs.reserved_submission_id
             )`
        ).bind(now, row.submission_id, appointmentId, now),
        db.prepare(
          `UPDATE submission_flash_designs
           SET outcome='placed',updated_at=?
           WHERE submission_id=? AND outcome='approved'
             AND EXISTS (
               SELECT 1 FROM flash_sheet_designs fsd
               WHERE fsd.id=submission_flash_designs.sheet_design_id
                 AND fsd.reserved_submission_id=?
                 AND fsd.state='placed'
             )`
        ).bind(now, row.submission_id, row.submission_id),
        db.prepare(
          `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
           SELECT ?, id, 'tattoo_completed', 'admin', ?, ? FROM submissions
           WHERE id = ? AND tattoo_stage = 'closed' AND updated_at = ?
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.id = ? AND a.status = 'completed'
                 AND a.updated_at = ?
             )`
        ).bind(crypto.randomUUID(), appointmentId, now, row.submission_id, now, appointmentId, now),
      );
    }
    const results = await db.batch(statements);
    if (Number(results?.[0]?.meta?.changes || 0) < 1) {
      return errorResponse("Appointment completion raced with another update.", 409);
    }
    if (
      historicalResolution
      && row.submission_id
      && ["prerequisite_consultation", "tattoo"].includes(purpose)
      && Number(results?.[2]?.meta?.changes || 0) < 1
    ) {
      return errorResponse("The historical appointment was recorded, but its parent lifecycle could not be resolved. Review the parent state and retry.", 409, {
        code: "HISTORICAL_PARENT_RESOLUTION_RACED",
      });
    }
    const updated = normalizeAppointment(await selectAppointmentWithMeeting(db, appointmentId));
    await mirrorAppointmentToCrm(db, updated, { includePayment: true });
    const submission = row.submission_id
      ? await db.prepare(
        `SELECT id, status, tattoo_stage, lifecycle_review_required, lifecycle_review_note
         FROM submissions WHERE id = ?`
        ).bind(row.submission_id).first()
      : null;
    return json({
      ok: true,
      appointment: updated,
      tattooStage: submission?.tattoo_stage || "",
      historicalResolved: historicalResolution,
      submission: submission ? {
        id: submission.id,
        status: submission.status,
        tattooStage: submission.tattoo_stage || "",
        lifecycleReviewRequired: Boolean(submission.lifecycle_review_required),
        lifecycleReviewNote: submission.lifecycle_review_note || "",
      } : null,
    });
  } catch (error) {
    return errorResponse("Unable to complete appointment.", 500, { detail: error.message });
  }
}

export async function handleAdminCreateAppointmentMeeting(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const row = await db
      .prepare(
        `SELECT a.*, bt.id AS booking_type_id, bt.label AS booking_type_label,
                bt.duration_minutes, bt.currency
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         WHERE a.id = ?`
      )
      .bind(appointmentId)
      .first();
    if (!row) return errorResponse("Appointment not found.", 404);
    if (row.booking_type_id !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) {
      return errorResponse("Only virtual consultation appointments can receive Zoom meetings.", 400);
    }
    const existing = await selectAppointmentWithMeeting(db, appointmentId);
    const replacing = existing?.meeting_provider === "zoom";
    if (replacing) {
      const cleanup = await cleanupZoomMeetingForAppointment(db, env, appointmentId);
      if (!cleanup.cleaned) {
        return errorResponse("The existing Zoom meeting could not be removed, so it was not replaced.", 409, {
          detail: cleanup.error || "Zoom cleanup needs attention.",
        });
      }
    }

    const appointment = normalizeAppointment(row);
    const bookingType = {
      id: row.booking_type_id,
      label: row.booking_type_label || "Virtual Consultation",
      durationMinutes: row.duration_minutes || 45,
      currency: row.currency || "USD",
    };
    await createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType);
    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    return json({ appointment: normalizeAppointment(updated), replaced: replacing });
  } catch (error) {
    return errorResponse("Unable to create Zoom meeting.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminDeleteAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    let row = await selectAppointmentWithMeeting(db, appointmentId);
    if (!row) return errorResponse("Appointment not found.", 404);
    if (!["pending_deposit", "deposit_pending", "cancelled", "archived"].includes(row.status)) {
      return errorResponse("Confirmed or completed appointments cannot be permanently deleted. Cancel the appointment instead.", 409, {
        code: "APPOINTMENT_DELETE_STATUS_PROTECTED",
      });
    }

    const paymentRows = (await db.prepare(
      `SELECT id, status, provider_checkout_id, provider_order_id, provider_payment_id
       FROM deposit_payments WHERE appointment_id = ? ORDER BY created_at`
    ).bind(appointmentId).all()).results || [];
    const protectedPayment = paymentRows.find((payment) => (
      ["paid", "completed", "settled", "payment_attention"].includes(asString(payment.status).toLowerCase())
      || Boolean(asString(payment.provider_payment_id))
    ));
    if (protectedPayment) {
      return errorResponse("Appointments with recorded payments cannot be permanently deleted.", 409, {
        code: "APPOINTMENT_DELETE_PAYMENT_PROTECTED",
      });
    }

    const renderingRows = (await db.prepare(
      `SELECT id, status, square_order_id, square_payment_link_id, square_payment_id
       FROM tattoo_rendering_requests WHERE appointment_id = ? ORDER BY created_at`
    ).bind(appointmentId).all()).results || [];
    const protectedRendering = renderingRows.find((rendering) => (
      ["paid", "payment_attention"].includes(asString(rendering.status).toLowerCase())
      || Boolean(asString(rendering.square_payment_id))
    ));
    if (protectedRendering) {
      return errorResponse("Appointments with recorded rendering payments cannot be permanently deleted.", 409, {
        code: "APPOINTMENT_DELETE_RENDERING_PROTECTED",
      });
    }

    const archiveReference = await db.prepare(
      "SELECT id FROM archive_tattoo_session_refs WHERE appointment_id = ? LIMIT 1"
    ).bind(appointmentId).first();
    if (archiveReference) {
      return errorResponse("This appointment is linked to an Archive tattoo session and cannot be permanently deleted.", 409, {
        code: "APPOINTMENT_DELETE_ARCHIVE_PROTECTED",
      });
    }

    const checkoutPairs = paymentRows.map((payment) => ({
      paymentId: payment.id,
      orderId: asString(payment.provider_order_id),
      linkId: asString(payment.provider_checkout_id),
    }));
    if (!checkoutPairs.length && (row.square_order_id || row.square_payment_link_id)) {
      checkoutPairs.push({
        paymentId: "",
        orderId: asString(row.square_order_id),
        linkId: asString(row.square_payment_link_id),
      });
    }
    for (const checkout of checkoutPairs) {
      if (!checkout.orderId && !checkout.linkId) continue;
      if (!checkout.orderId || !checkout.linkId) {
        return errorResponse("This appointment has an incomplete Square checkout record and cannot be safely deleted.", 409, {
          code: "APPOINTMENT_DELETE_CHECKOUT_ATTENTION",
        });
      }
      try {
        const order = await fetchSquareOrderForReconciliation(env, checkout.orderId);
        if (orderLooksPaid(order)) {
          await db.prepare(
            `UPDATE deposit_payments SET status = 'payment_attention', raw_json = ?, updated_at = ?
             WHERE appointment_id = ? AND status <> 'paid'`
          ).bind(JSON.stringify(order), new Date().toISOString(), appointmentId).run();
          return errorResponse("Square reports that this checkout was paid. The appointment was preserved for Studio review.", 409, {
            code: "APPOINTMENT_DELETE_SQUARE_PAID",
          });
        }
        await invalidateSquarePaymentLink(env, checkout.linkId);
      } catch (error) {
        return errorResponse("The Square checkout could not be safely invalidated, so the appointment was preserved.", 409, {
          code: "APPOINTMENT_DELETE_CHECKOUT_ATTENTION",
          detail: error.message,
        });
      }
    }

    for (const rendering of renderingRows) {
      const orderId = asString(rendering.square_order_id);
      const linkId = asString(rendering.square_payment_link_id);
      if (!orderId && !linkId) continue;
      if (!orderId || !linkId) {
        return errorResponse("An additional-rendering checkout is incomplete and prevents safe appointment deletion.", 409, {
          code: "APPOINTMENT_DELETE_RENDERING_ATTENTION",
        });
      }
      try {
        const order = await fetchSquareOrderForReconciliation(env, orderId);
        if (orderLooksPaid(order)) {
          await db.prepare(
            `UPDATE tattoo_rendering_requests
             SET status = 'payment_attention', raw_json = ?, updated_at = ?
             WHERE id = ? AND status <> 'paid'`
          ).bind(JSON.stringify(order), new Date().toISOString(), rendering.id).run();
          return errorResponse("Square reports that an additional-rendering checkout was paid. The appointment was preserved for Studio review.", 409, {
            code: "APPOINTMENT_DELETE_RENDERING_PAID",
          });
        }
        await invalidateSquarePaymentLink(env, linkId);
      } catch (error) {
        return errorResponse("An additional-rendering checkout could not be safely invalidated, so the appointment was preserved.", 409, {
          code: "APPOINTMENT_DELETE_RENDERING_ATTENTION",
          detail: error.message,
        });
      }
    }

    if (["pending_deposit", "deposit_pending"].includes(row.status)) {
      const released = await releasePendingBookingHold(
        db,
        row,
        "admin",
        "Appointment released for permanent deletion by Studio",
      );
      if (!released) {
        return errorResponse("The appointment changed before it could be deleted.", 409, {
          code: "APPOINTMENT_DELETE_CHANGED",
        });
      }
      row = await selectAppointmentWithMeeting(db, appointmentId) || row;
    }

    if (row.meeting_provider === "zoom") {
      const meetingCleanup = await cleanupZoomMeetingForAppointment(db, env, appointmentId);
      if (!meetingCleanup.cleaned) {
        return errorResponse("The Zoom meeting could not be removed, so the appointment was preserved.", 409, {
          code: "APPOINTMENT_DELETE_MEETING_ATTENTION",
          detail: meetingCleanup.error || "Zoom cleanup needs attention.",
        });
      }
    }

    const statements = [];
    if (row.submission_id) {
      statements.push(db.prepare(
        `UPDATE submissions
         SET payload_json = json_remove(
               payload_json,
               '$.held_appointment_id',
               '$.held_start_at',
               '$.held_end_at',
               '$.approval_hold_expires_at'
             ),
             updated_at = ?
         WHERE id = ? AND json_valid(payload_json)
           AND json_extract(payload_json, '$.held_appointment_id') = ?`
      ).bind(new Date().toISOString(), row.submission_id, appointmentId));
    }
    statements.push(
      db.prepare("DELETE FROM tattoo_rendering_requests WHERE appointment_id = ?")
        .bind(appointmentId),
    );
    const paymentIds = paymentRows.map((payment) => payment.id).filter(Boolean);
    if (paymentIds.length) {
      statements.push(db.prepare(
        `DELETE FROM crm_transactions
         WHERE source_provider = 'local' AND source_type = 'deposit_payment'
           AND source_id IN (${paymentIds.map(() => "?").join(",")})`
      ).bind(...paymentIds));
    }
    statements.push(
      db.prepare(
        `DELETE FROM crm_interactions
         WHERE source_provider = 'local' AND source_type = 'appointment' AND source_id = ?`
      ).bind(appointmentId),
    );
    const appointmentDeleteIndex = statements.length;
    statements.push(db.prepare(
      `DELETE FROM appointments
       WHERE id = ? AND status IN ('cancelled','archived')
         AND NOT EXISTS (
           SELECT 1 FROM deposit_payments protected_payment
           WHERE protected_payment.appointment_id = appointments.id
             AND (
               lower(protected_payment.status) IN ('paid','completed','settled','payment_attention')
               OR trim(COALESCE(protected_payment.provider_payment_id, '')) <> ''
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM archive_tattoo_session_refs archive_session
           WHERE archive_session.appointment_id = appointments.id
         )`
    ).bind(appointmentId));

    const results = await db.batch(statements);
    if (Number(results?.[appointmentDeleteIndex]?.meta?.changes || 0) < 1) {
      return errorResponse("The appointment changed or became protected before it could be deleted.", 409, {
        code: "APPOINTMENT_DELETE_CHANGED",
      });
    }
    return json({ ok: true, deletedId: appointmentId });
  } catch (error) {
    return errorResponse("Unable to permanently delete appointment.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminReleasePendingAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const row = await selectAppointmentWithMeeting(db, appointmentId);
    if (!row) return errorResponse("Appointment not found.", 404);
    if (!["pending_deposit", "deposit_pending"].includes(row.status)) {
      return errorResponse("Only pending checkout appointments can be released.", 400);
    }

    const payment = await pendingCheckoutIdentifiers(db, appointmentId);
    const reconciliationRow = {
      ...row,
      payment_link_id: payment?.payment_link_id || "",
      payment_order_id: payment?.payment_order_id || "",
    };
    const orderId = reconciliationRow.square_order_id || reconciliationRow.payment_order_id;
    const hasCheckout = Boolean(
      reconciliationRow.square_checkout_url || reconciliationRow.payment_link_id || orderId
    );
    if (hasCheckout) {
      try {
        if (!orderId || !reconciliationRow.payment_link_id) {
          throw new Error("Pending checkout is missing the Square order or payment-link identifier.");
        }
        const order = await fetchSquareOrderForReconciliation(env, orderId);
        if (orderLooksPaid(order)) {
          const confirmed = await confirmPaidAppointment(db, env, request, row, order);
          return errorResponse("This checkout has already been paid and cannot be released.", 409, {
            code: "CHECKOUT_ALREADY_PAID",
            appointment: confirmed,
          });
        }
        await invalidateSquarePaymentLink(env, reconciliationRow.payment_link_id);
      } catch (error) {
        await markHoldExpiryAttention(db, reconciliationRow, error.message, new Date().toISOString());
        return errorResponse("The checkout could not be safely released and remains capacity-blocking.", 409, {
          code: "HOLD_RELEASE_ATTENTION",
          detail: error.message,
        });
      }
    }

    if (!await releasePendingBookingHold(
      db,
      reconciliationRow,
      "admin",
      "Pending checkout released by Studio",
    )) {
      return errorResponse("Pending checkout could not be released because it changed.", 409);
    }

    if (row.meeting_provider === "zoom") await cleanupZoomMeetingForAppointment(db, env, appointmentId);

    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    return json({ ok: true, appointment: normalizeAppointment(updated || row) });
  } catch (error) {
    return errorResponse("Unable to release pending checkout.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListSubmissionTokens(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT id, purpose, allowed_booking_types_json, created_at, expires_at, revoked_at, used_at, updated_at
         FROM booking_tokens WHERE submission_id = ? ORDER BY created_at DESC`
      )
      .bind(submissionId)
      .all();

    const tokens = (result.results || []).map((t) => ({
      id: t.id,
      purpose: t.purpose || "tattoo",
      allowedBookingTypes: parseJsonField(t.allowed_booking_types_json, []),
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      revokedAt: t.revoked_at,
      usedAt: t.used_at,
      updatedAt: t.updated_at,
      state: t.used_at ? "used"
        : t.revoked_at ? "revoked"
        : (t.expires_at && t.expires_at < now) ? "expired"
        : "active",
    }));

    return json({ tokens });
  } catch (error) {
    return errorResponse("Unable to list submission tokens.", 500, { detail: error.message });
  }
}
