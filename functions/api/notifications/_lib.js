const DEFAULT_FROM_ADDRESS = "saisolehman@artpilltattoohouse.com";
const DEFAULT_FROM_NAME = "art.pill TATTOO HOUSE";
const DEFAULT_REPLY_TO = "saisolehman@artpilltattoohouse.com";
const DEFAULT_ADMIN_FROM_ADDRESS = "notifications@artpilltattoohouse.com";
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_BOOKING_TYPES = {
  tattoo_quarter: {
    label: "Quarter Session",
    description: "Approx. 1.5 hours for small approved projects, flash, or focused work.",
    durationMinutes: 90,
    depositCents: 5000,
    currency: "USD",
  },
  tattoo_half: {
    label: "Half Session",
    description: "Approx. 3 hours for medium approved projects or developed symbolic work.",
    durationMinutes: 180,
    depositCents: 10000,
    currency: "USD",
  },
  tattoo_full: {
    label: "Full Session",
    description: "Up to 6 hours for large approved work, special projects, or deeper sessions.",
    durationMinutes: 360,
    depositCents: 20000,
    currency: "USD",
  },
};

function notificationDb(env) {
  return env.SUBMISSIONS_DB || null;
}

function fromAddress(env) {
  return env.NOTIFICATION_FROM_EMAIL || DEFAULT_FROM_ADDRESS;
}

function fromName(env) {
  return env.NOTIFICATION_FROM_NAME || DEFAULT_FROM_NAME;
}

function replyToAddress(env) {
  return env.NOTIFICATION_REPLY_TO || DEFAULT_REPLY_TO;
}

function adminNotificationAddress(env) {
  return env.ADMIN_NOTIFICATION_EMAIL || DEFAULT_REPLY_TO;
}

// Events are a separate brand (the six.well construct) from the tattoo house.
// They settle to their own Square account, so their email identity is distinct
// too. Falls back to the events Square reply address, then the studio default.
const DEFAULT_EVENTS_FROM_NAME = "the six.well construct";

function eventsEmailIdentity(env) {
  const fromEmail =
    env.EVENTS_FROM_EMAIL || env.NOTIFICATION_FROM_EMAIL || DEFAULT_FROM_ADDRESS;
  return {
    fromEmail,
    fromName: env.EVENTS_FROM_NAME || DEFAULT_EVENTS_FROM_NAME,
    replyTo: env.EVENTS_REPLY_TO || fromEmail,
  };
}

function publicBaseUrl(env, request) {
  if (env.PUBLIC_SITE_URL) return String(env.PUBLIC_SITE_URL).replace(/\/+$/g, "");
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return "https://thesixwellconstruct.com";
}

function publicUrl(env, request, path) {
  return `${publicBaseUrl(env, request)}${path}`;
}

function studioConsoleUrl(env, request) {
  return publicUrl(env, request, "/studio/submissions/");
}

const IN_PERSON_CONSULTATION_BOOKING_TYPE_ID = "consult_in_person";
const VIRTUAL_CONSULTATION_BOOKING_TYPE_ID = "consult_virtual";
const BUILD_SESSION_BOOKING_TYPE_ID = "build_in_person";
const CONSULTATION_BOOKING_TYPE_IDS = [
  IN_PERSON_CONSULTATION_BOOKING_TYPE_ID,
  VIRTUAL_CONSULTATION_BOOKING_TYPE_ID,
  BUILD_SESSION_BOOKING_TYPE_ID,
];
// Studio bookings are the construct's own product (not the tattoo house).
const STUDIO_BOOKING_TYPE_IDS = ["studio_visit", "studio_gathering", "studio_rental"];
const CONFIRMATION_PATHS = {
  [IN_PERSON_CONSULTATION_BOOKING_TYPE_ID]: "/booking/confirmed/consultation/",
  [VIRTUAL_CONSULTATION_BOOKING_TYPE_ID]: "/booking/confirmed/virtual-consultation/",
  [BUILD_SESSION_BOOKING_TYPE_ID]: "/booking/confirmed/build/",
  studio_visit: "/booking/confirmed/studio/",
  studio_gathering: "/booking/confirmed/studio/",
  studio_rental: "/booking/confirmed/studio/",
};

function appointmentConfirmationUrl(env, request, appointment) {
  const path = CONFIRMATION_PATHS[appointment.bookingTypeId] || "/booking/confirmed/";
  return `${publicBaseUrl(env, request)}${path}?appointment=${encodeURIComponent(appointment.id)}`;
}

function appointmentCalendarUrl(env, request, appointment) {
  return `${publicBaseUrl(env, request)}/api/booking/calendar?appointment=${encodeURIComponent(appointment.id)}`;
}

function clientResourceUrls(env, request) {
  return {
    bookingTermsUrl: publicUrl(env, request, "/tattoos/policies/"),
    dayOfInstructionsUrl: publicUrl(env, request, "/tattoos/day-of/"),
    locationParkingUrl: publicUrl(env, request, "/tattoos/location-parking/"),
  };
}

function asString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function formatDate(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(Number(cents || 0) / 100);
}

function formatDuration(minutes) {
  const total = Number(minutes || 0);
  if (!total) return "";
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (!hours) return `${remainingMinutes} minutes`;
  if (!remainingMinutes) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} minutes`;
}

function normalizeBookingType(row) {
  return {
    id: row.id,
    label: row.label,
    description: row.description || "",
    durationMinutes: row.duration_minutes ?? row.durationMinutes ?? 0,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    currency: row.currency || "USD",
  };
}

function fallbackBookingTypes(allowedIds) {
  return (allowedIds || [])
    .map((id) => DEFAULT_BOOKING_TYPES[id] ? normalizeBookingType({ id, ...DEFAULT_BOOKING_TYPES[id] }) : null)
    .filter(Boolean);
}

async function bookingTypesForToken(env, token) {
  const allowedIds = Array.isArray(token?.allowedBookingTypes)
    ? token.allowedBookingTypes.map(asString).filter(Boolean)
    : [];
  if (Array.isArray(token?.bookingTypes) && token.bookingTypes.length) {
    return token.bookingTypes.map(normalizeBookingType);
  }
  if (!allowedIds.length) return [];

  const db = notificationDb(env);
  if (!db) return fallbackBookingTypes(allowedIds);

  try {
    const placeholders = allowedIds.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT id, label, description, duration_minutes, deposit_cents, currency
         FROM booking_types
         WHERE active = 1 AND id IN (${placeholders})`
      )
      .bind(...allowedIds)
      .all();
    const byId = new Map((result.results || []).map((row) => [row.id, normalizeBookingType(row)]));
    const fallbackById = new Map(fallbackBookingTypes(allowedIds).map((type) => [type.id, type]));
    return allowedIds.map((id) => byId.get(id) || fallbackById.get(id)).filter(Boolean);
  } catch (error) {
    console.warn("Unable to load booking type details for notification.", error.message);
    return fallbackBookingTypes(allowedIds);
  }
}

function sessionOptionsText(bookingTypes) {
  if (!bookingTypes.length) {
    return "Available session options are shown on your private booking page.";
  }
  return bookingTypes.map((type) => {
    const duration = formatDuration(type.durationMinutes);
    const deposit = formatMoney(type.depositCents, type.currency);
    const details = [duration, type.description].filter(Boolean).join(" - ");
    return `- ${type.label}${details ? `: ${details}` : ""} Deposit: ${deposit}.`;
  }).join("\n");
}

function depositAmountText(bookingTypes) {
  const deposits = bookingTypes
    .filter((type) => Number(type.depositCents) > 0)
    .map((type) => `${type.depositCents}:${type.currency || "USD"}`);
  const uniqueDeposits = [...new Set(deposits)];
  if (!uniqueDeposits.length) return "Shown on the private booking page";
  if (uniqueDeposits.length === 1) {
    const [cents, currency] = uniqueDeposits[0].split(":");
    return formatMoney(Number(cents), currency);
  }
  const values = uniqueDeposits.map((entry) => {
    const [cents, currency] = entry.split(":");
    return { cents: Number(cents), currency };
  });
  const currency = values.every((value) => value.currency === values[0].currency) ? values[0].currency : "USD";
  const cents = values.map((value) => value.cents).sort((a, b) => a - b);
  return `${formatMoney(cents[0], currency)}-${formatMoney(cents[cents.length - 1], currency)}, depending on selected session`;
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

async function recordDelivery(db, delivery) {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO notification_deliveries (
          id, channel, template_key, recipient, subject, related_type,
          related_id, idempotency_key, status, error, sent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        delivery.channel,
        delivery.templateKey,
        delivery.recipient || delivery.to,
        delivery.subject || null,
        delivery.relatedType || null,
        delivery.relatedId || null,
        delivery.idempotencyKey,
        delivery.status,
        delivery.error || null,
        delivery.sentAt || null,
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.warn("Unable to record notification delivery.", error.message);
  }
}

async function deliveryExists(db, idempotencyKey) {
  if (!db || !idempotencyKey) return false;
  try {
    const row = await db
      .prepare("SELECT id FROM notification_deliveries WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function sendTransactionalEmail(env, message) {
  const db = notificationDb(env);
  if (await deliveryExists(db, message.idempotencyKey)) {
    return { ok: true, skipped: true };
  }

  if (!env.EMAIL?.send) {
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "skipped",
      error: "Missing EMAIL send_email binding.",
    });
    return { ok: false, skipped: true, error: "Missing EMAIL send_email binding." };
  }

  try {
    const response = await env.EMAIL.send({
      to: message.to,
      from: {
        email: message.fromEmail || fromAddress(env),
        name: message.fromName || fromName(env),
      },
      replyTo: message.replyTo || replyToAddress(env),
      subject: message.subject,
      text: message.text,
      html: message.html || textToHtml(message.text),
    });
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    return { ok: true, response };
  } catch (error) {
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "failed",
      error: error.message,
    });
    return { ok: false, error: error.message };
  }
}

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

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
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
  if (!expectedToken) return errorResponse("Admin notifications are not configured.", 503);
  if (authTokenFromRequest(request) !== expectedToken) return errorResponse("Unauthorized.", 401);
  return null;
}

function resendKey(base) {
  return `${base}:resend:${crypto.randomUUID()}`;
}

function normalizeSubmission(rowOrSubmission) {
  const contact = rowOrSubmission.contact || parseJsonField(rowOrSubmission.contact_json, {});
  const payload = rowOrSubmission.payload || parseJsonField(rowOrSubmission.payload_json, {});
  return {
    id: rowOrSubmission.id,
    type: rowOrSubmission.type,
    sourcePath: rowOrSubmission.sourcePath || rowOrSubmission.source_path || payload.source_path || "",
    subject: rowOrSubmission.subject || payload.subject || "",
    contactName: rowOrSubmission.contactName || rowOrSubmission.contact_name || contact.name || "",
    contactEmail: rowOrSubmission.contactEmail || rowOrSubmission.contact_email || contact.email || "",
    contactPhone: rowOrSubmission.contactPhone || rowOrSubmission.contact_phone || contact.phone || "",
    payload,
  };
}

function normalizeAppointment(row) {
  const meetingJoinUrl = row.meeting_join_url || row.meetingJoinUrl || row.meeting?.joinUrl || "";
  return {
    id: row.id,
    submissionId: row.submission_id || row.submissionId || "",
    bookingTypeId: row.booking_type_id || row.bookingTypeId || "",
    bookingTypeLabel: row.booking_type_label || row.bookingTypeLabel || "Tattoo session",
    clientName: row.client_name || row.clientName || "",
    clientEmail: row.client_email || row.clientEmail || "",
    clientPhone: row.client_phone || row.clientPhone || "",
    startAt: row.start_at || row.startAt,
    endAt: row.end_at || row.endAt,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    tipCents: row.tip_cents ?? row.tipCents ?? 0,
    totalDueCents: (row.deposit_cents ?? row.depositCents ?? 0) + (row.tip_cents ?? row.tipCents ?? 0),
    currency: row.currency || "USD",
    meeting: meetingJoinUrl ? { joinUrl: meetingJoinUrl } : null,
  };
}

function labelFromKey(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function valueSummary(value) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map(valueSummary).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function compactLine(label, value) {
  const summary = valueSummary(value);
  return summary ? `${label}: ${summary}` : "";
}

function submissionDetailLines(submission) {
  const payload = submission.payload || {};
  const fieldsByType = {
    tattoo_inquiry: [
      "placement",
      "size",
      "budget_range",
      "timeline",
      "message",
      "instagram",
    ],
    flash_claim: [
      "selected_flash",
      "placement",
      "claim_bid",
      "size",
      "timeline",
      "message",
      "instagram",
    ],
    special_project: [
      "project_title",
      "placement",
      "budget_range",
      "timeline",
      "message",
      "instagram",
    ],
    build_brief: [
      "selected_elements",
      "placement",
      "size",
      "timeline",
      "message",
      "instagram",
    ],
    maze_design: [
      "maze_explanation",
      "placement",
      "size",
      "timeline",
      "message",
      "instagram",
    ],
    art_acquisition: ["artwork", "artwork_title", "budget_range", "message", "instagram"],
    consultation: ["consultation_type", "preferred_dates", "message", "instagram"],
    studio_booking: ["booking_type", "preferred_dates", "party_size", "message"],
  };
  const preferredFields = fieldsByType[submission.type] || Object.keys(payload);
  return preferredFields
    .map((key) => compactLine(labelFromKey(key), payload[key]))
    .filter(Boolean);
}

async function sendAdminNotification(env, request, message) {
  const recipient = adminNotificationAddress(env);
  if (!recipient) return { ok: false, skipped: true };

  return sendTransactionalEmail(env, {
    to: recipient,
    fromEmail: env.ADMIN_NOTIFICATION_FROM_EMAIL || DEFAULT_ADMIN_FROM_ADDRESS,
    fromName: env.ADMIN_NOTIFICATION_FROM_NAME || "art.pill notifications",
    replyTo: replyToAddress(env),
    ...message,
    text: [...message.lines, "", compactLine("Studio console", studioConsoleUrl(env, request))]
      .filter((line) => line !== "")
      .join("\n"),
  });
}

export async function notifySubmissionReceived(env, submission, options = {}) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail) return { ok: false, skipped: true };

  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your art.pill TATTOO HOUSE inquiry has been received.",
    "The studio will review the project notes, placement, scale, references, and timing before sending any booking access.",
    "",
    "If the project is approved, you will receive a private booking link for scheduling and deposit.",
    "",
    "Thank you,",
    "art.pill TATTOO HOUSE",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "art.pill TATTOO HOUSE inquiry received",
    text,
    templateKey: "submission_received",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: options.idempotencyKey || `submission_received:${normalized.id}`,
  });
}

export async function notifyAdminSubmissionReceived(env, submission, options = {}) {
  const normalized = normalizeSubmission(submission);
  const detailLines = submissionDetailLines(normalized);
  const lines = [
    "New form submission received.",
    "",
    compactLine("Type", labelFromKey(normalized.type)),
    compactLine("Submission ID", normalized.id),
    compactLine("Source", normalized.sourcePath),
    compactLine("Subject", normalized.subject),
    "",
    "Client",
    compactLine("Name", normalized.contactName),
    compactLine("Email", normalized.contactEmail),
    compactLine("Phone", normalized.contactPhone),
    "",
    detailLines.length ? "Project notes" : "",
    ...detailLines,
  ];

  return sendAdminNotification(env, null, {
    subject: `New submission: ${labelFromKey(normalized.type)}`,
    lines,
    templateKey: "admin_submission_received",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: options.idempotencyKey || `admin_submission_received:${normalized.id}`,
  });
}

export async function notifyBookingLinkCreated(env, request, submission, token, options = {}) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail || !token?.bookingUrl) return { ok: false, skipped: true };

  const resources = clientResourceUrls(env, request);
  const bookingTypes = await bookingTypesForToken(env, token);
  const bookingUrl = token.bookingUrl.startsWith("http")
    ? token.bookingUrl
    : `${publicBaseUrl(env, request)}${token.bookingUrl}`;
  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your tattoo project has been approved for booking.",
    "",
    "Approved session options:",
    "",
    sessionOptionsText(bookingTypes),
    "",
    `Deposit due to book: ${depositAmountText(bookingTypes)}`,
    "",
    "Before booking, please review:",
    "",
    `- Terms & Conditions: ${resources.bookingTermsUrl}`,
    `- Day-of / session prep: ${resources.dayOfInstructionsUrl}`,
    "",
    "Use the private link below to choose an available session and pay the deposit:",
    "",
    bookingUrl,
    "",
    "This link is private to your project. Deposits are non-refundable and go toward the final cost of your tattoo. If the available times do not work, reply to this email and the studio can help.",
    "",
    "Thank you,",
    "art.pill TATTOO HOUSE",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "Your private art.pill TATTOO HOUSE booking link",
    text,
    templateKey: "booking_link_created",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: options.idempotencyKey || `booking_link_created:${token.id}`,
  });
}

async function sendTattooAppointmentConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your art.pill TATTOO HOUSE appointment is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Deposit: ${formatMoney(appointment.depositCents, appointment.currency)} received`,
    appointment.tipCents ? `Optional tip: ${formatMoney(appointment.tipCents, appointment.currency)}` : "",
    appointment.tipCents ? `Total paid today: ${formatMoney(appointment.totalDueCents, appointment.currency)}` : "",
    "",
    `Confirmation page: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    `Day-of instructions: ${resources.dayOfInstructionsUrl}`,
    `Location & parking: ${resources.locationParkingUrl}`,
    "",
    "I may follow up directly with prep notes or adjustments before your appointment, if needed.",
    "",
    "Thank you,",
    "Saiel Solehman",
    "[art.pill TATTOO HOUSE]",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed",
    text,
    templateKey: "appointment_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendInPersonConsultationConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your in-person consultation at art.pill TATTOO HOUSE is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Reservation fee: ${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for your consultation, not a deposit toward future work.`,
    appointment.tipCents ? `Optional tip: ${formatMoney(appointment.tipCents, appointment.currency)}` : "",
    appointment.tipCents ? `Total paid today: ${formatMoney(appointment.totalDueCents, appointment.currency)}` : "",
    "",
    `Confirmation page: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    `Location & parking: ${resources.locationParkingUrl}`,
    "",
    "We'll talk through your project, placement, scale, and timeline in person. No prep is required ahead of time - just bring any reference images or ideas you'd like to share.",
    "",
    "Thank you,",
    "Saiel Solehman",
    "[art.pill TATTOO HOUSE]",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your consultation at art.pill TATTOO HOUSE has been confirmed",
    text,
    templateKey: "consultation_confirmed_in_person",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendVirtualConsultationConfirmed(env, request, appointment, options = {}) {
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your virtual consultation with art.pill TATTOO HOUSE is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Reservation fee: ${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for your consultation, not a deposit toward future work.`,
    appointment.tipCents ? `Optional tip: ${formatMoney(appointment.tipCents, appointment.currency)}` : "",
    appointment.tipCents ? `Total paid today: ${formatMoney(appointment.totalDueCents, appointment.currency)}` : "",
    appointment.meeting?.joinUrl ? `Zoom link: ${appointment.meeting.joinUrl}` : "",
    "",
    `Confirmation page: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    "",
    "We'll talk through your project, placement, scale, and timeline over video. No prep is required ahead of time - just bring any reference images or ideas you'd like to share, and a quiet spot with a stable connection.",
    "",
    "Thank you,",
    "Saiel Solehman",
    "[art.pill TATTOO HOUSE]",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your virtual consultation with art.pill TATTOO HOUSE has been confirmed",
    text,
    templateKey: "consultation_confirmed_virtual",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendBuildSessionConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your in-person build session at art.pill TATTOO HOUSE is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Reservation fee: ${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for the build session, not a deposit toward a future tattoo.`,
    appointment.tipCents ? `Optional tip: ${formatMoney(appointment.tipCents, appointment.currency)}` : "",
    appointment.tipCents ? `Total paid today: ${formatMoney(appointment.totalDueCents, appointment.currency)}` : "",
    "",
    `Confirmation page: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    `Location & parking: ${resources.locationParkingUrl}`,
    "",
    "This session is dedicated to building out your design together - placement, scale, and final artwork. Bring any reference images, sizing notes, or ideas you'd like to work from.",
    "",
    "Thank you,",
    "Saiel Solehman",
    "[art.pill TATTOO HOUSE]",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your build session at art.pill TATTOO HOUSE has been confirmed",
    text,
    templateKey: "build_session_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendStudioBookingConfirmed(env, request, appointment, options = {}) {
  const identity = eventsEmailIdentity(env);
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your studio booking at the six.well construct is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Booking: ${appointment.bookingTypeLabel}`,
    `Deposit: ${formatMoney(appointment.depositCents, appointment.currency)} received - this holds your date; any balance is settled with the studio.`,
    "",
    `Confirmation page: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    "",
    "We'll reach out with anything you need ahead of your time in the space. Reply to this email with questions.",
    "",
    "Thank you,",
    "the six.well construct",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    fromEmail: identity.fromEmail,
    fromName: identity.fromName,
    replyTo: identity.replyTo,
    subject: "Your studio booking at the six.well construct is confirmed",
    text,
    templateKey: "studio_booking_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

export async function notifyAppointmentConfirmed(env, request, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };

  if (STUDIO_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId)) {
    return sendStudioBookingConfirmed(env, request, appointment, options);
  }

  switch (appointment.bookingTypeId) {
    case IN_PERSON_CONSULTATION_BOOKING_TYPE_ID:
      return sendInPersonConsultationConfirmed(env, request, appointment, options);
    case VIRTUAL_CONSULTATION_BOOKING_TYPE_ID:
      return sendVirtualConsultationConfirmed(env, request, appointment, options);
    case BUILD_SESSION_BOOKING_TYPE_ID:
      return sendBuildSessionConfirmed(env, request, appointment, options);
    default:
      return sendTattooAppointmentConfirmed(env, request, appointment, options);
  }
}

export async function notifyAdminAppointmentConfirmed(env, request, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  const when = [formatDate(appointment.startAt), formatDate(appointment.endAt)]
    .filter(Boolean)
    .join(" - ");
  const lines = [
    "Booking payment confirmed.",
    "",
    compactLine("Booking type", appointment.bookingTypeLabel || appointment.bookingTypeId),
    compactLine("Appointment ID", appointment.id),
    compactLine("Submission ID", appointment.submissionId),
    compactLine("When", when),
    "",
    "Client",
    compactLine("Name", appointment.clientName),
    compactLine("Email", appointment.clientEmail),
    compactLine("Phone", appointment.clientPhone),
    "",
    "Payment",
    compactLine("Deposit / fee", `${formatMoney(appointment.depositCents, appointment.currency)} received`),
    appointment.tipCents ? compactLine("Optional tip", formatMoney(appointment.tipCents, appointment.currency)) : "",
    compactLine("Total paid", formatMoney(appointment.totalDueCents, appointment.currency)),
    "",
    compactLine("Confirmation page", appointmentConfirmationUrl(env, request, appointment)),
    compactLine("Calendar", appointmentCalendarUrl(env, request, appointment)),
  ];

  return sendAdminNotification(env, request, {
    subject: `Booking confirmed: ${appointment.bookingTypeLabel || appointment.bookingTypeId}`,
    lines,
    templateKey: "admin_appointment_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `admin_appointment_confirmed:${appointment.id}`,
  });
}

export async function notifyAdminEventWaitlistReceived(env, request, entry, event, options = {}) {
  return sendAdminNotification(env, request, {
    subject: `New event waitlist request: ${event.title || event.slug}`,
    lines: [
      "New event waitlist request received.",
      "",
      compactLine("Event", event.title || event.slug),
      compactLine("Waitlist ID", entry.id),
      compactLine("Seats requested", entry.seats),
      "",
      "Contact",
      compactLine("Name", entry.name),
      compactLine("Email", entry.email),
      compactLine("Phone", entry.phone),
      compactLine("Note", entry.note),
    ],
    templateKey: "admin_event_waitlist_received",
    relatedType: "event_waitlist",
    relatedId: entry.id,
    idempotencyKey: options.idempotencyKey || `admin_event_waitlist_received:${entry.id}`,
  });
}

export async function notifyAdminEventOpenMicReceived(env, request, signup, event, options = {}) {
  return sendAdminNotification(env, request, {
    subject: `New open mic request: ${event.title || event.slug}`,
    lines: [
      "New open mic request received.",
      "",
      compactLine("Event", event.title || event.slug),
      compactLine("Signup ID", signup.id),
      compactLine("Performer", signup.performerName),
      compactLine("Email", signup.performerEmail),
      compactLine("Phone", signup.performerPhone),
      compactLine("Act type", signup.actType),
      compactLine("Piece title", signup.pieceTitle),
      compactLine("Requested slot", signup.requestedSlot),
      compactLine("Notes", signup.notes),
    ],
    templateKey: "admin_event_open_mic_received",
    relatedType: "event_open_mic_signup",
    relatedId: signup.id,
    idempotencyKey: options.idempotencyKey || `admin_event_open_mic_received:${signup.id}`,
  });
}

export async function notifyAdminEventTicketPaid(env, request, ticketRow, options = {}) {
  const db = notificationDb(env);
  const event = db
    ? await db.prepare("SELECT title, slug, starts_at, location FROM events WHERE id = ?")
        .bind(ticketRow.event_id || ticketRow.eventId)
        .first()
        .catch(() => null)
    : null;
  const title = event?.title || ticketRow.event_title || "Event";

  return sendAdminNotification(env, request, {
    subject: `Event ticket paid: ${title}`,
    lines: [
      "Event ticket payment confirmed.",
      "",
      compactLine("Event", title),
      compactLine("Ticket ID", ticketRow.id),
      compactLine("Seats", ticketRow.seats || 1),
      compactLine("When", event?.starts_at ? formatDate(event.starts_at) : ""),
      "",
      "Guest",
      compactLine("Name", ticketRow.contact_name || ticketRow.contactName),
      compactLine("Email", ticketRow.contact_email || ticketRow.contactEmail),
      compactLine("Phone", ticketRow.contact_phone || ticketRow.contactPhone),
    ],
    templateKey: "admin_event_ticket_paid",
    relatedType: "event_ticket",
    relatedId: ticketRow.id,
    idempotencyKey: options.idempotencyKey || `admin_event_ticket_paid:${ticketRow.id}`,
  });
}

async function selectSubmission(db, submissionId) {
  return db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first();
}

async function selectAppointmentWithMeeting(db, appointmentId) {
  return db
    .prepare(
      `SELECT a.*, bt.label AS booking_type_label,
              am.provider AS meeting_provider,
              am.provider_meeting_id,
              am.join_url AS meeting_join_url,
              am.password AS meeting_password,
              am.created_at AS meeting_created_at,
              am.updated_at AS meeting_updated_at
       FROM appointments a
       LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
       LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
       WHERE a.id = ?`
    )
    .bind(appointmentId)
    .first();
}

async function latestActiveToken(db, submissionId) {
  return db
    .prepare(
      `SELECT * FROM booking_tokens
       WHERE submission_id = ? AND revoked_at IS NULL AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(submissionId)
    .first();
}

async function deliveryById(db, notificationId) {
  if (!notificationId) return null;
  return db
    .prepare(
      `SELECT id, template_key, related_type, related_id
       FROM notification_deliveries WHERE id = ?`
    )
    .bind(notificationId)
    .first();
}

export async function handleAdminResendNotification(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = notificationDb(env);
    if (!db) return errorResponse("Missing D1 binding SUBMISSIONS_DB.", 503);

    if (asString(body.templateKey) === "admin_test") {
      const delivery = await sendAdminNotification(env, request, {
        subject: "TEST - form submission notifications",
        lines: [
          "This is a test of the admin form-submission notification system.",
          "",
          compactLine("Sent at", new Date().toISOString()),
          compactLine("Recipient", adminNotificationAddress(env)),
          "No customer record was created or changed.",
        ],
        templateKey: "admin_test",
        relatedType: "system",
        relatedId: "admin_notifications",
        idempotencyKey: resendKey("admin_test"),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    const sourceDelivery = await deliveryById(db, asString(body.notificationId));
    const templateKey = asString(body.templateKey || sourceDelivery?.template_key);
    const submissionId = asString(
      body.submissionId || (sourceDelivery?.related_type === "submission" ? sourceDelivery.related_id : "")
    );
    const appointmentId = asString(
      body.appointmentId || (sourceDelivery?.related_type === "appointment" ? sourceDelivery.related_id : "")
    );
    const eventTicketId = asString(
      body.eventTicketId || (sourceDelivery?.related_type === "event_ticket" ? sourceDelivery.related_id : "")
    );

    if (templateKey === "event_ticket_paid") {
      if (!eventTicketId) return errorResponse("Missing event ticket id.", 400);
      const ticketRow = await db
        .prepare("SELECT * FROM event_tickets WHERE id = ?")
        .bind(eventTicketId)
        .first();
      if (!ticketRow) return errorResponse("Event ticket not found.", 404);
      if (ticketRow.status !== "paid") {
        return errorResponse("Only paid tickets can receive a confirmation resend.", 400);
      }
      const delivery = await notifyEventTicketPaid(env, request, ticketRow, {
        idempotencyKey: resendKey(`event_ticket_paid:${ticketRow.id}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    if (templateKey === "submission_received") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      const delivery = await notifySubmissionReceived(env, submission, {
        idempotencyKey: resendKey(`submission_received:${submission.id}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    if (templateKey === "admin_submission_received") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      const delivery = await notifyAdminSubmissionReceived(env, submission, {
        idempotencyKey: resendKey(`admin_submission_received:${submission.id}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    if (templateKey === "booking_link_created") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      if (!submission.booking_url) return errorResponse("This submission does not have a booking URL.", 400);

      const token = await latestActiveToken(db, submission.id);
      const tokenId = token?.id || submission.id;
      const delivery = await notifyBookingLinkCreated(env, request, submission, {
        id: tokenId,
        bookingUrl: submission.booking_url.startsWith("http")
          ? submission.booking_url
          : `${publicBaseUrl(env, request)}${submission.booking_url}`,
        allowedBookingTypes: parseJsonField(token?.allowed_booking_types_json, []),
      }, {
        idempotencyKey: resendKey(`booking_link_created:${tokenId}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    if (templateKey === "admin_appointment_confirmed") {
      const appointment = await selectAppointmentWithMeeting(db, appointmentId);
      if (!appointment) return errorResponse("Appointment not found.", 404);
      if (appointment.status !== "confirmed") {
        return errorResponse("Only confirmed appointments can receive admin confirmation resends.", 400);
      }
      const delivery = await notifyAdminAppointmentConfirmed(env, request, appointment, {
        idempotencyKey: resendKey(`admin_appointment_confirmed:${appointment.id}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    if ([
      "appointment_confirmed",
      "consultation_confirmed_in_person",
      "consultation_confirmed_virtual",
      "build_session_confirmed",
    ].includes(templateKey)) {
      const appointment = await selectAppointmentWithMeeting(db, appointmentId);
      if (!appointment) return errorResponse("Appointment not found.", 404);
      if (appointment.status !== "confirmed") {
        return errorResponse("Only confirmed appointments can receive confirmation resends.", 400);
      }
      const delivery = await notifyAppointmentConfirmed(env, request, appointment, {
        idempotencyKey: resendKey(`appointment_confirmed:${appointment.id}`),
      });
      return json({ ok: Boolean(delivery.ok), delivery });
    }

    return errorResponse(`Unsupported notification template: ${templateKey || "(blank)"}.`, 400);
  } catch (error) {
    return errorResponse("Unable to resend notification.", 500, { detail: error.message });
  }
}

export async function notifyAppointmentCancelled(env, request, appointmentRow) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };

  const isConsultation = CONSULTATION_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const rebookPath = appointment.bookingTypeId === BUILD_SESSION_BOOKING_TYPE_ID
    ? "/tattoos/build/in-person/"
    : "/tattoos/inquire/consultation/";
  const rebookUrl = `${publicBaseUrl(env, request)}${rebookPath}?rebook=1`;
  const policyText = isConsultation
    ? "Per studio policy, reservation fees are non-refundable. One reschedule is allowed with at least 48 hours notice; a new reservation fee is required for reschedules made within 48 hours."
    : "Per studio policy, deposits and payments are non-refundable. One reschedule is allowed with at least 48 hours notice; a new deposit is required for reschedules made within 48 hours.";
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    `Your art.pill TATTOO HOUSE ${isConsultation ? "consultation" : "appointment"} has been cancelled.`,
    "",
    `Was scheduled: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    "",
    policyText,
    "",
    `Pick a new time: ${rebookUrl}`,
    "",
    `Questions? Email ${env.NOTIFICATION_REPLY_TO || DEFAULT_REPLY_TO}.`,
    "",
    "Thank you,",
    "art.pill TATTOO HOUSE",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your appointment has been cancelled",
    text,
    templateKey: "appointment_cancelled",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: `appointment_cancelled:${appointment.id}`,
  });
}

export async function notifyEventTicketPaid(env, request, ticketRow, options = {}) {
  const email = ticketRow.contact_email || ticketRow.contactEmail || "";
  if (!email) return { ok: false, skipped: true };

  const db = notificationDb(env);
  let event = null;
  if (db) {
    event = await db
      .prepare("SELECT title, slug, starts_at, location FROM events WHERE id = ?")
      .bind(ticketRow.event_id)
      .first()
      .catch(() => null);
  }

  const seats = Number(ticketRow.seats) || 1;
  const title = event?.title || "the event";
  const whenLine = event?.starts_at ? `When: ${formatDate(event.starts_at)}` : null;
  const whereLine = event?.location ? `Where: ${event.location}` : null;
  const confirmationPath =
    `/events/confirmed/?ticket=${encodeURIComponent(ticketRow.id)}` +
    (event?.slug ? `&event=${encodeURIComponent(event.slug)}` : "");
  const confirmationUrl = publicUrl(env, request, confirmationPath);
  const calendarUrl = publicUrl(
    env,
    request,
    `/api/events/tickets/${encodeURIComponent(ticketRow.id)}/calendar`
  );

  const text = [
    `Hi ${ticketRow.contact_name || "there"},`,
    "",
    `You're booked for ${title}.`,
    "",
    `Seats reserved: ${seats}`,
    whenLine,
    whereLine,
    "",
    `Your ticket: ${confirmationUrl}`,
    event?.starts_at ? `Add to calendar: ${calendarUrl}` : null,
    "",
    "Your spot is confirmed and paid. Reply to this email if anything changes or you have questions before the night.",
    "",
    "See you there,",
    "the six.well construct",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    subject: `You're booked — ${title}`,
    text,
    templateKey: "event_ticket_paid",
    relatedType: "event_ticket",
    relatedId: ticketRow.id,
    idempotencyKey: options.idempotencyKey || `event_ticket_paid:${ticketRow.id}`,
  });
}

export async function notifyEventTicketCancelled(env, request, ticketRow, options = {}) {
  const email = ticketRow.contact_email || ticketRow.contactEmail || "";
  if (!email) return { ok: false, skipped: true };

  const db = notificationDb(env);
  let event = null;
  if (db) {
    event = await db
      .prepare("SELECT title, starts_at, location FROM events WHERE id = ?")
      .bind(ticketRow.event_id)
      .first()
      .catch(() => null);
  }

  const title = event?.title || ticketRow.event_title || "the event";
  const whenLine = event?.starts_at ? `Was scheduled: ${formatDate(event.starts_at)}` : null;
  const refundLine = options.refunded
    ? "A full refund has been issued to your original payment method. It may take a few business days to appear."
    : "If you were charged, a refund will be handled separately — reply to this email if you have any questions.";

  const text = [
    `Hi ${ticketRow.contact_name || "there"},`,
    "",
    `Your ticket for ${title} has been cancelled.`,
    "",
    whenLine,
    "",
    refundLine,
    "",
    "Sorry to miss you this time — reply to this email if you'd like help getting into a future gathering.",
    "",
    "the six.well construct",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    subject: `Your ticket for ${title} was cancelled`,
    text,
    templateKey: "event_ticket_cancelled",
    relatedType: "event_ticket",
    relatedId: ticketRow.id,
    idempotencyKey: `event_ticket_cancelled:${ticketRow.id}`,
  });
}

export async function notifyEventOpenMicSlotAssigned(env, request, signupRow, eventRow, options = {}) {
  const email = signupRow.performer_email || signupRow.performerEmail || "";
  if (!email) return { ok: false, skipped: true };

  const event = eventRow || {};
  const title = event.title || event.event_title || "Cult & Shift";
  const eventWhen = event.starts_at || event.startsAt || "";
  const eventLocation = event.location || "";
  const assignedSlot = signupRow.assigned_slot || signupRow.assignedSlot || "";
  const duration = Number(signupRow.slot_duration_minutes || signupRow.slotDurationMinutes || 5);
  const performerName = signupRow.performer_name || signupRow.performerName || "there";
  const showUrl = publicUrl(env, request, `/events/${encodeURIComponent(event.slug || "cultandshift")}/`);

  const text = [
    `Hi ${performerName},`,
    "",
    `Your open-mic slot for ${title} is scheduled.`,
    "",
    eventWhen ? `Event: ${formatDate(eventWhen)}` : null,
    assignedSlot ? `Your slot: ${formatDate(assignedSlot)}` : "Your slot: assigned by the host",
    duration ? `Planned slot length: ${duration} minutes` : null,
    eventLocation ? `Where: ${eventLocation}` : null,
    "",
    "Please arrive early enough to check in before your slot. Bring anything you need for your piece, and reply to this email if your setup changes.",
    "",
    `Event page: ${showUrl}`,
    "",
    "See you there,",
    "the six.well construct",
  ].filter((line) => line !== null).join("\n");

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    subject: `${title} open mic slot`,
    text,
    templateKey: "event_open_mic_slot",
    relatedType: "event_open_mic_signup",
    relatedId: signupRow.id,
    idempotencyKey: options.idempotencyKey || `event_open_mic_slot:${signupRow.id}:${assignedSlot || "unscheduled"}`,
  });
}

export async function sendDueEventTicketReminders(env) {
  const db = notificationDb(env);
  if (!db) return { sent: 0, skipped: 0, failed: 0 };

  const now = new Date();
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db
      .prepare(
        `SELECT t.*, e.title AS event_title, e.starts_at AS event_starts_at,
                e.location AS event_location
         FROM event_tickets t
         JOIN events e ON e.id = t.event_id
         WHERE t.status = 'paid'
           AND t.reminder_sent_at IS NULL
           AND e.starts_at >= ?
           AND e.starts_at < ?
         ORDER BY e.starts_at ASC
         LIMIT 100`
      )
      .bind(from, to)
      .all();

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of result.results || []) {
      if (!row.contact_email) { skipped += 1; continue; }
      const seats = Number(row.seats) || 1;
      const title = row.event_title || "your event";
      const calendarUrl = publicUrl(
        env,
        null,
        `/api/events/tickets/${encodeURIComponent(row.id)}/calendar`
      );
      const text = [
        `Hi ${row.contact_name || "there"},`,
        "",
        `Reminder: ${title} is tomorrow.`,
        "",
        `When: ${formatDate(row.event_starts_at)}`,
        row.event_location ? `Where: ${row.event_location}` : null,
        `Seats reserved: ${seats}`,
        "",
        `Add to calendar: ${calendarUrl}`,
        "",
        "Looking forward to seeing you. Reply to this email if anything has changed.",
        "",
        "the six.well construct",
      ]
        .filter((line) => line !== null)
        .join("\n");
      const delivery = await sendTransactionalEmail(env, {
        to: row.contact_email,
        ...eventsEmailIdentity(env),
        subject: `Reminder: ${title} is tomorrow`,
        text,
        templateKey: "event_ticket_reminder_24h",
        relatedType: "event_ticket",
        relatedId: row.id,
        idempotencyKey: `event_ticket_reminder_24h:${row.id}`,
      });
      if (delivery.skipped) skipped += 1;
      else if (delivery.ok) {
        sent += 1;
        await db
          .prepare("UPDATE event_tickets SET reminder_sent_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), row.id)
          .run()
          .catch(() => {});
      } else failed += 1;
    }
    return { sent, skipped, failed };
  } catch (error) {
    console.warn("Unable to send due event reminders.", error.message);
    return { sent: 0, skipped: 0, failed: 1, error: error.message };
  }
}

export async function sendDueAppointmentReminders(env) {
  const db = notificationDb(env);
  if (!db) return { sent: 0, skipped: 0, failed: 0 };

  const now = new Date();
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db
      .prepare(
        `SELECT a.*, bt.label AS booking_type_label,
                am.join_url AS meeting_join_url,
                am.password AS meeting_password
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
         WHERE a.status = 'confirmed'
           AND a.start_at >= ?
           AND a.start_at < ?
         ORDER BY a.start_at ASC
         LIMIT 50`
      )
      .bind(from, to)
      .all();

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of result.results || []) {
      const appointment = normalizeAppointment(row);
      const resources = clientResourceUrls(env);
      const isConsultation = CONSULTATION_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
      const isVirtual = appointment.bookingTypeId === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID;
      const occasion = isConsultation ? "consultation" : "tattoo appointment";
      const text = [
        `Hi ${appointment.clientName || "there"},`,
        "",
        `Reminder: Your ${occasion} with art.pill TATTOO HOUSE is tomorrow.`,
        "",
        `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
        `Session: ${appointment.bookingTypeLabel}`,
        appointment.meeting?.joinUrl ? `Zoom link: ${appointment.meeting.joinUrl}` : "",
        `Add to calendar: ${appointmentCalendarUrl(env, null, appointment)}`,
        "",
        isVirtual ? "" : "Please review before arriving:",
        isVirtual ? "" : "",
        isConsultation ? "" : `- Day-of instructions: ${resources.dayOfInstructionsUrl}`,
        isVirtual ? "" : `- Location & parking: ${resources.locationParkingUrl}`,
        "",
        "Reply to this thread if you have any questions or concerns before your session.",
        "",
        "-Saiel Solehman",
        "[art.pill TATTOO HOUSE]",
      ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");
      const delivery = await sendTransactionalEmail(env, {
        to: appointment.clientEmail,
        subject: `Reminder: Your ${occasion} with art.pill TATTOO HOUSE is tomorrow`,
        text,
        templateKey: "appointment_reminder_24h",
        relatedType: "appointment",
        relatedId: appointment.id,
        idempotencyKey: `appointment_reminder_24h:${appointment.id}`,
      });
      if (delivery.skipped) skipped += 1;
      else if (delivery.ok) sent += 1;
      else failed += 1;
    }
    return { sent, skipped, failed };
  } catch (error) {
    console.warn("Unable to send due appointment reminders.", error.message);
    return { sent: 0, skipped: 0, failed: 1, error: error.message };
  }
}
