import {
  buildAppointmentCancelledEmail,
  buildAppointmentConfirmedEmail,
  buildAppointmentReminderEmail,
  buildAppointmentRescheduledEmail,
  buildBookingLinkEmail,
  buildEventOpenMicSlotEmail,
  buildEventReminderEmail,
  buildEventTicketCancelledEmail,
  buildEventTicketPaidEmail,
  buildAdminNotificationEmail,
  buildCommunicationPreferencesEmail,
  buildCrmFollowupEmail,
  buildSubmissionReceivedEmail,
  buildTattooBriefReadyEmail,
  buildTattooDraftResumeEmail,
  buildTattooRenderingPaymentConfirmedEmail,
  buildTattooRenderingPaymentRequestEmail,
  buildTattooSpecialDepositRequestEmail,
  buildTattooSpecialReviewEmail,
  clientEmailPreviewCatalog,
  renderClientEmailPreview,
  emailTemplateDefinition,
  renderEmailTemplateContent,
  TATTOO_APPOINTMENT_PAYMENT_AND_ARRIVAL_POLICY,
} from "./_email-templates.js";
import { renderEmailContent, validateEmailContent } from "./_email-content.js";
import { CLIENT_EMAIL_THEMES, renderClientEmail } from "./_email-renderer.js";
import { defaultEmailDesignProfile, validateEmailDesignProfile } from "./_email-design.js";
import { tattooPricingSummary } from "../booking/_pricing.js";
import {
  emailDesignHistory,
  emailDesignRevision,
  publishEmailDesignDraft,
  restoreEmailDesignRevision,
  saveEmailDesignDraft,
} from "./_email-design-store.js";
import {
  publishTemplateDraft,
  restoreTemplateRevision,
  saveTemplateDraft,
  templateHistory,
  templateRevision,
} from "./_email-template-store.js";

const DEFAULT_FROM_ADDRESS = "saisolehman@artpilltattoohouse.com";
const DEFAULT_FROM_NAME = "art.pill TATTOO HOUSE";
const DEFAULT_REPLY_TO = "saisolehman@artpilltattoohouse.com";
const DEFAULT_ADMIN_FROM_ADDRESS = "notifications@artpilltattoohouse.com";
const DEFAULT_TIMEZONE = "America/New_York";
const TATTOO_SUBJECT_PREFIX = "art.pill Tattoo House";
const TATTOO_FORM_NAMES = Object.freeze({
  tattoo_inquiry: "Custom Tattoo Inquiry",
  flash_claim: "Flash Claim",
  build_brief: "Build Your Own",
  maze_design: "Maze Studio Submission",
  special_project: "Special Projects Application",
  tattoo_special: "Tattoo Special",
  consultation: "Consultation",
  build_session: "In-Person Build Session",
});
const DEFAULT_REVIEW_TIME_MESSAGE = "Most project submissions are reviewed within 5–7 business days.";
const DEFAULT_BOOKING_TYPES = {
  tattoo_quarter: {
    label: "Quarter Day Session",
    description: "Approx. 1.5 hours for small approved projects, flash, or focused work.",
    durationMinutes: 90,
    depositCents: 5000,
    currency: "USD",
  },
  tattoo_half: {
    label: "Half Day Session",
    description: "Approx. 3 hours for medium approved projects or developed symbolic work.",
    durationMinutes: 180,
    depositCents: 10000,
    currency: "USD",
  },
  tattoo_full: {
    label: "Full Day Session",
    description: "Up to 6 hours for large approved work, special projects, or deeper sessions.",
    durationMinutes: 360,
    depositCents: 20000,
    currency: "USD",
  },
  tattoo_extended: {
    label: "Extended Day Session",
    description: "Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee.",
    durationMinutes: 600,
    depositCents: 35000,
    sessionFeeCents: 20000,
    currency: "USD",
  },
};
const TATTOO_DAY_SESSION_LABELS = Object.freeze({
  tattoo_quarter: "Quarter Day Session",
  tattoo_half: "Half Day Session",
  tattoo_full: "Full Day Session",
  tattoo_extended: "Extended Day Session",
});
const EXTENDED_DAY_BOOKING_TYPE_ID = "tattoo_extended";

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

function lifecycleLog(event, details = {}) {
  const allowed = {
    event,
    templateKey: details.templateKey || undefined,
    relatedType: details.relatedType || undefined,
    relatedId: details.relatedId || undefined,
    status: details.status || undefined,
    purpose: details.purpose || undefined,
  };
  console.info(JSON.stringify(Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined))));
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
const ART_BOOKING_TYPE_IDS = ["studio_visit"];
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

function tattooSubject(label) {
  return `${TATTOO_SUBJECT_PREFIX} ${label}`;
}

function tattooFormName(type) {
  return TATTOO_FORM_NAMES[normalizedSubmissionType(type)] || "";
}

function tattooBookingName(appointment) {
  if (appointment.submissionType === "tattoo_special" || String(appointment.bookingTypeId || "").startsWith("tattoo_special_")) {
    return "Tattoo Special";
  }
  if (appointment.bookingTypeId === IN_PERSON_CONSULTATION_BOOKING_TYPE_ID) return "In-Person Consultation";
  if (appointment.bookingTypeId === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) return "Virtual Consultation";
  if (appointment.bookingTypeId === BUILD_SESSION_BOOKING_TYPE_ID || appointment.purpose === "build_session") {
    return "In-Person Build Session";
  }
  if (["prerequisite_consultation", "standalone_consultation"].includes(appointment.purpose)) {
    return "Consultation";
  }
  return "Tattoo Booking";
}

function studioBookingName(appointment) {
  if (ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId)) return "Open Studio Visit";
  return appointment.bookingTypeLabel || appointment.bookingTypeId;
}

function tattooAdminBookingSubject(appointment, state) {
  return tattooSubject(`${tattooBookingName(appointment)} ${state}`);
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

function formatMoneyRange(minimumCents, maximumCents, currency = "USD") {
  const minimum = Number(minimumCents || 0);
  const maximum = Number(maximumCents || 0);
  return minimum === maximum
    ? formatMoney(minimum, currency)
    : `Estimated: ${formatMoney(minimum, currency)}–${formatMoney(maximum, currency)}`;
}

function reviewedBudgetLabel(budget) {
  const minimum = Number(budget?.minimumCents || 0);
  const maximum = Number(budget?.maximumCents || 0);
  if (!minimum || !maximum || maximum < minimum) return "";
  const currency = budget?.currency || "USD";
  return minimum === maximum
    ? formatMoney(minimum, currency)
    : `${formatMoney(minimum, currency)}–${formatMoney(maximum, currency)}`;
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
  const id = row.id;
  const durationMinutes = row.duration_minutes ?? row.durationMinutes ?? 0;
  return {
    id,
    label: TATTOO_DAY_SESSION_LABELS[id] || row.label,
    description: row.description || "",
    durationMinutes,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    sessionFeeCents: row.session_fee_cents ?? row.sessionFeeCents ?? 0,
    durationRangeLabel: id === EXTENDED_DAY_BOOKING_TYPE_ID ? "8-10 hours" : formatDuration(durationMinutes),
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
        `SELECT id, label, description, duration_minutes, deposit_cents,
                session_fee_cents, currency
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
    const duration = type.durationRangeLabel || formatDuration(type.durationMinutes);
    const deposit = formatMoney(type.depositCents, type.currency);
    const details = [duration, type.description].filter(Boolean).join(" - ");
    const extended = type.id === EXTENDED_DAY_BOOKING_TYPE_ID
      ? " Extended day sessions are always optional and are presented as an option for clients who want longer sessions. Quarter, Half, and Full Day sessions do not include the Extended Day fee, and your project may be split across shorter appointments if desired. If additional appointments are needed, I will coordinate the remaining dates with you."
      : "";
    return `- ${type.label}${details ? `: ${details}` : ""} Deposit: ${deposit}.${extended}`;
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
        `INSERT INTO notification_deliveries (
          id, channel, template_key, template_variant, template_revision, email_design_revision, email_theme,
          recipient, subject, related_type, related_id, idempotency_key, status, error, sent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          status = excluded.status,
          error = excluded.error,
          sent_at = excluded.sent_at,
          subject = excluded.subject,
          recipient = excluded.recipient,
          template_variant = excluded.template_variant,
          template_revision = excluded.template_revision,
          email_design_revision = excluded.email_design_revision,
          email_theme = excluded.email_theme,
          created_at = excluded.created_at`
      )
      .bind(
        crypto.randomUUID(),
        delivery.channel,
        delivery.templateKey,
        delivery.templateVariant || "default",
        Number(delivery.templateRevision || 0),
        Number(delivery.emailDesignRevision || 0),
        delivery.theme || delivery.emailTheme || "",
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
      .prepare("SELECT id FROM notification_deliveries WHERE idempotency_key = ? AND status = 'sent' LIMIT 1")
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
    lifecycleLog("notification.idempotent_skip", {
      templateKey: message.templateKey,
      relatedType: message.relatedType,
      relatedId: message.relatedId,
      status: "skipped",
    });
    return { ok: true, skipped: true };
  }

  let outgoing = { ...message };
  if (message.semantic && message.templateKey && !message.contentLocked) {
    let publishedDesign = null;
    try {
      publishedDesign = await emailDesignRevision(db, "published");
    } catch (error) {
      console.warn("Email design fallback to repository defaults.", error.message);
    }
    try {
      const definition = emailTemplateDefinition(message.templateKey, message.templateVariant || "default");
      const published = await templateRevision(db, message.templateKey, message.templateVariant || "default", "published");
      if (definition && published) {
        const validation = validateEmailContent(message.semantic, published.content, definition.options);
        if (!validation.ok) throw new Error(validation.errors.join(" "));
        outgoing = {
          ...message,
          ...renderEmailContent(message.semantic, published.content, definition.options, publishedDesign?.profile || defaultEmailDesignProfile()),
          templateRevision: published.revision,
          emailDesignRevision: publishedDesign?.revision || 0,
        };
      } else {
        outgoing = {
          ...message,
          ...renderClientEmail(message.semantic, publishedDesign?.profile || defaultEmailDesignProfile()),
          templateRevision: 0,
          emailDesignRevision: publishedDesign?.revision || 0,
        };
      }
    } catch (error) {
      outgoing = {
        ...message,
        ...renderClientEmail(message.semantic, publishedDesign?.profile || defaultEmailDesignProfile()),
        templateRevision: 0,
        emailDesignRevision: publishedDesign?.revision || 0,
      };
      console.warn(`Email template fallback for ${message.templateKey}/${message.templateVariant || "default"}.`, error.message);
    }
  }

  if (!env.EMAIL?.send) {
    await recordDelivery(db, {
      ...outgoing,
      channel: "email",
      status: "skipped",
      error: "Missing EMAIL send_email binding.",
    });
    lifecycleLog("notification.not_configured", {
      templateKey: message.templateKey,
      relatedType: message.relatedType,
      relatedId: message.relatedId,
      status: "skipped",
    });
    return { ok: false, skipped: true, error: "Missing EMAIL send_email binding." };
  }

  try {
    const response = await env.EMAIL.send({
      to: outgoing.to,
      from: {
        email: outgoing.fromEmail || fromAddress(env),
        name: outgoing.fromName || fromName(env),
      },
      replyTo: outgoing.replyTo || replyToAddress(env),
      subject: outgoing.subject,
      text: outgoing.text,
      html: outgoing.html || textToHtml(outgoing.text),
    });
    await recordDelivery(db, {
      ...outgoing,
      channel: "email",
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    lifecycleLog("notification.sent", {
      templateKey: message.templateKey,
      relatedType: message.relatedType,
      relatedId: message.relatedId,
      status: "sent",
    });
    return { ok: true, response };
  } catch (error) {
    const errorDetail = [error?.code, error?.message].filter(Boolean).join(": ") || "Unknown email delivery error.";
    await recordDelivery(db, {
      ...outgoing,
      channel: "email",
      status: "failed",
      error: errorDetail,
    });
    lifecycleLog("notification.failed", {
      templateKey: message.templateKey,
      relatedType: message.relatedType,
      relatedId: message.relatedId,
      status: "failed",
    });
    return { ok: false, error: errorDetail, code: error?.code || "" };
  }
}

export async function sendCrmFollowupEmail(env, message = {}) {
  const to = asString(message.to);
  const subject = asString(message.subject);
  const body = asString(message.text);
  if (!to || !subject || !body) {
    return { ok: false, skipped: true, error: "Recipient, subject, and message are required." };
  }
  const emailTheme = asString(message.emailTheme) === "tattoo" ? "tattoo" : "construct_studio";
  const rendered = buildCrmFollowupEmail({
    theme: emailTheme,
    subject,
    preheader: asString(message.preheader),
    body,
  });
  return sendTransactionalEmail(env, {
    to,
    ...(emailTheme === "construct_studio" ? eventsEmailIdentity(env) : {}),
    ...rendered,
    templateKey: "crm_relationship_followup",
    relatedType: "crm_person",
    relatedId: asString(message.personId) || null,
    idempotencyKey: asString(message.idempotencyKey)
      || `crm_relationship_followup:${asString(message.communicationId) || crypto.randomUUID()}`,
  });
}

export async function notifyTattooSpecialReview(env, review = {}, options = {}) {
  const outcome = asString(review.outcome);
  if (!new Set(["simplification_requested", "declined"]).has(outcome)) {
    return { ok: false, skipped: true, error: "Tattoo Special review outcome is not sendable." };
  }
  const to = asString(review.contact_email || review.contactEmail);
  if (!to) return { ok: false, skipped: true, error: "Tattoo Special review recipient is required." };
  const message = buildTattooSpecialReviewEmail({
    outcome,
    clientName: review.contact_name || review.contactName,
    offerTitle: review.offer_title || review.offerTitle,
    variantLabel: review.variant_label || review.variantLabel,
    advertisedTotal: formatMoney(review.advertised_price_cents ?? review.advertisedPriceCents ?? 0, review.currency || "USD"),
    depositText: formatMoney(review.deposit_cents ?? review.depositCents ?? 0, review.currency || "USD"),
    durationText: `${Number(review.duration_minutes ?? review.durationMinutes ?? 0)} minutes`,
    studioNote: review.note || review.studioNote || "",
  });
  return sendTransactionalEmail(env, {
    to,
    ...message,
    templateKey: "tattoo_special_review",
    relatedType: "submission",
    relatedId: asString(review.submission_id || review.submissionId) || null,
    idempotencyKey: options.idempotencyKey || `tattoo_special_review_${outcome}:${asString(review.submission_id || review.submissionId)}`,
  });
}

export async function sendCommunicationPreferencesLink(env, message = {}) {
  const to = asString(message.to);
  const url = asString(message.url);
  if (!to || !url) {
    return { ok: false, skipped: true, error: "Recipient and preferences URL are required." };
  }
  const rendered = buildCommunicationPreferencesEmail({ url });
  return sendTransactionalEmail(env, {
    to,
    ...rendered,
    templateKey: "crm_communication_preferences",
    relatedType: "communication_preferences",
    relatedId: asString(message.tokenId) || null,
    idempotencyKey: asString(message.idempotencyKey)
      || `crm_communication_preferences:${asString(message.tokenId) || crypto.randomUUID()}`,
  });
}

export async function notifyTattooBuildDraftResume(env, request, draft, rawToken, options = {}) {
  const kind = draft.draft_kind || draft.kind;
  const label = kind === "maze_design" ? "Maze Studio draft" : "Build Your Own draft";
  const route = kind === "maze_design" ? "/tattoos/build/maze/" : "/tattoos/build/";
  const resumeUrl = `${publicUrl(env, request, route)}#resume=${encodeURIComponent(rawToken)}`;
  const expiration = draft.expires_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: DEFAULT_TIMEZONE,
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(draft.expires_at))
    : "";
  const message = buildTattooDraftResumeEmail({
    variant: kind === "maze_design" ? "maze" : "build",
    subject: `Continue your art.pill ${label}`,
    label,
    resumeUrl,
    expiration,
  });
  return sendTransactionalEmail(env, {
    to: draft.owner_email || draft.email,
    ...message,
    templateKey: "tattoo_build_draft_resume",
    relatedType: "tattoo_build_draft",
    relatedId: draft.id,
    idempotencyKey: options.idempotencyKey || `tattoo_build_draft_resume:${draft.id}`,
  });
}

export async function notifyTattooBriefReady(env, request, data, options = {}) {
  if (!data?.clientEmail || !data?.briefUrl) return { ok: false, skipped: true };
  const message = buildTattooBriefReadyEmail({
    variant: data.kind === "maze" ? "maze" : "build",
    clientName: data.clientName,
    briefUrl: data.briefUrl,
  });
  return sendTransactionalEmail(env, {
    to: data.clientEmail,
    ...message,
    templateKey: "tattoo_brief_ready",
    relatedType: "submission_brief_document",
    relatedId: data.documentId,
    idempotencyKey: options.idempotencyKey || `tattoo_brief_ready:${data.documentId}:${data.accessVersion}`,
  });
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

function deliveryResponse(delivery) {
  const ok = Boolean(delivery?.ok);
  const status = ok ? 200 : delivery?.skipped ? 503 : 502;
  return json({ ok, delivery }, { status });
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
    status: rowOrSubmission.status || "new",
    tattooStage: rowOrSubmission.tattooStage || rowOrSubmission.tattoo_stage || "",
    briefUrl: rowOrSubmission.briefUrl || "",
    briefLabel: rowOrSubmission.briefLabel || "",
    payload,
  };
}

function normalizeAppointment(row) {
  const meetingJoinUrl = row.meeting_join_url || row.meetingJoinUrl || row.meeting?.joinUrl || "";
  const bookingTypeId = row.booking_type_id || row.bookingTypeId || "";
  const submissionType = row.submission_type || row.submissionType || (String(bookingTypeId).startsWith("tattoo_special_") ? "tattoo_special" : "");
  return {
    id: row.id,
    submissionId: row.submission_id || row.submissionId || "",
    bookingTypeId,
    bookingTypeLabel: TATTOO_DAY_SESSION_LABELS[bookingTypeId] || row.booking_type_label || row.bookingTypeLabel || "Tattoo session",
    clientName: row.client_name || row.clientName || "",
    clientEmail: row.client_email || row.clientEmail || "",
    clientPhone: row.client_phone || row.clientPhone || "",
    startAt: row.start_at || row.startAt,
    endAt: row.end_at || row.endAt,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    tipCents: row.tip_cents ?? row.tipCents ?? 0,
    totalDueCents: (row.deposit_cents ?? row.depositCents ?? 0) + (row.tip_cents ?? row.tipCents ?? 0),
    sessionFeeCents: row.session_fee_cents ?? row.sessionFeeCents ?? 0,
    currency: row.currency || "USD",
    purpose: row.purpose || "",
    status: row.status || "",
    rescheduleCount: Number(row.reschedule_count ?? row.rescheduleCount ?? 0),
    originalStartAt: row.original_start_at || row.originalStartAt || "",
    originalEndAt: row.original_end_at || row.originalEndAt || "",
    meeting: meetingJoinUrl ? { joinUrl: meetingJoinUrl } : null,
    submissionType,
    specialOfferTitle: row.special_offer_title || row.specialOfferTitle || "",
    specialVariantLabel: row.special_variant_label || row.specialVariantLabel || "",
    specialApprovedPriceCents: row.special_approved_price_cents ?? row.specialApprovedPriceCents ?? row.special_advertised_price_cents ?? 0,
    specialDurationMinutes: row.special_duration_minutes ?? row.specialDurationMinutes ?? 0,
  };
}

function isTattooSpecialAppointment(appointment) {
  return appointment.submissionType === "tattoo_special" || String(appointment.bookingTypeId || "").startsWith("tattoo_special_");
}

function tattooSpecialSessionLabel(appointment) {
  if (!isTattooSpecialAppointment(appointment)) return appointment.bookingTypeLabel;
  return `Tattoo Special · ${appointment.specialOfferTitle || appointment.bookingTypeLabel}${appointment.specialVariantLabel ? ` — ${appointment.specialVariantLabel}` : ""}`;
}

async function reviewedTattooPricing(env, appointment) {
  const db = notificationDb(env);
  if (!db || !appointment?.submissionId) return null;
  try {
    const plan = await db.prepare(
      `SELECT approved_budget_min_cents, approved_budget_max_cents, approved_budget_currency
       FROM tattoo_session_plans WHERE submission_id = ?`,
    ).bind(appointment.submissionId).first();
    return tattooPricingSummary(plan, appointment);
  } catch (error) {
    console.warn("Tattoo confirmation pricing fallback to general balance guidance.", error.message);
    return null;
  }
}

function ordinaryTattooPricingDetails(pricing, appointment) {
  if (!pricing) {
    return {
      pricingDetails: appointment?.bookingTypeId === EXTENDED_DAY_BOOKING_TYPE_ID
        && Number(appointment.sessionFeeCents || 0) > 0
        ? [{
            id: "extended_day_fee",
            label: "Extended Day fee",
            value: `+${formatMoney(appointment.sessionFeeCents, appointment.currency)}`,
          }]
        : [],
      balanceDetails: [],
    };
  }
  const range = pricing.laborMinimumCents !== pricing.laborMaximumCents;
  const pricingDetails = [
    {
      id: "approved_tattoo_work",
      label: "Approved tattoo work",
      value: formatMoneyRange(pricing.laborMinimumCents, pricing.laborMaximumCents, pricing.currency),
    },
  ];
  if (pricing.sessionFeeCents > 0) {
    pricingDetails.push({
      id: "extended_day_fee",
      label: "Extended Day fee",
      value: `+${formatMoney(pricing.sessionFeeCents, pricing.currency)}`,
    });
  }
  pricingDetails.push({
    id: "appointment_total",
    label: "Appointment total",
    value: formatMoneyRange(pricing.combinedMinimumCents, pricing.combinedMaximumCents, pricing.currency),
  });
  return {
    pricingDetails,
    balanceDetails: [{
      id: "remaining_balance",
      label: "Remaining balance",
      value: formatMoneyRange(pricing.remainingMinimumCents, pricing.remainingMaximumCents, pricing.currency),
    }],
  };
}

function extendedDayEmailFields(appointment) {
  if (appointment.bookingTypeId !== EXTENDED_DAY_BOOKING_TYPE_ID) {
    return { sessionFeeText: "", billingPolicyText: "" };
  }
  return {
    sessionFeeText: `${formatMoney(appointment.sessionFeeCents, appointment.currency)} due with the remaining studio balance at the start of your appointment, before tattooing begins`,
    billingPolicyText: "Optional 8-10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee. Extended day sessions are always optional and are presented as an option for clients who want longer sessions. Quarter, Half, and Full Day sessions do not include the Extended Day fee, and your project may be split across shorter appointments if desired. If additional appointments are needed, I will coordinate the remaining dates with you. The Extended Day fee is not charged again during a no-cost reschedule.",
  };
}

function normalizedSubmissionType(type) {
  const value = asString(type).toLowerCase();
  if (["custom", "tattoo_inquiry_form"].includes(value)) return "tattoo_inquiry";
  if (["flash", "flash-claim"].includes(value)) return "flash_claim";
  if (["build", "build_your_own", "byo"].includes(value)) return "build_brief";
  if (["maze", "maze_studio"].includes(value)) return "maze_design";
  if (["special", "special-project"].includes(value)) return "special_project";
  if (["in_person_consultation", "public_consultation"].includes(value)) return "consultation";
  if (["build_in_person", "public_build_session"].includes(value)) return "build_session";
  return value;
}

const SUBMISSION_RECEIPTS = {
  tattoo_inquiry: {
    label: "custom tattoo project",
    subject: "Custom tattoo project received",
    expectation: "The studio will review the concept, placement, scale, references, budget, and timing before deciding the next step.",
    next: "If the project is a fit, you will receive the appropriate next step or a private tattoo-booking link.",
  },
  flash_claim: {
    label: "flash claim",
    subject: "Flash claim received",
    expectation: "The studio will review placement, scale, budget, and the selected flash record. Multiple claims may be reviewed; the design is reserved only when the first compatible claim is approved.",
    next: "If your claim is approved while the design is still available, you will receive a private tattoo-booking link.",
  },
  build_brief: {
    label: "Build Your Own brief",
    subject: "Build Your Own brief received",
    expectation: "The studio will review your selected symbol snapshot, design intent, placement, and scale as one original composition.",
    next: "If the brief is approved, you will receive a private tattoo-booking link with the recommended session plan.",
  },
  maze_design: {
    label: "Maze Studio design",
    subject: "Maze Studio design received",
    expectation: "The studio will review the saved maze image, construction data, design explanation, placement, and scale.",
    next: "If the design is approved, you will receive a private tattoo-booking link with the recommended session plan.",
  },
  special_project: {
    label: "Special Project application",
    subject: "Special Project application received",
    expectation: "The studio will review the selected open call, concept direction, placement, scale, budget, and timing.",
    next: "If the application is selected, you will receive a private tattoo-booking link or a request for any missing planning details.",
  },
  tattoo_special: {
    label: "request",
    subject: "Tattoo Special request received",
    expectation: "Your selected Tattoo Special and requested appointment time have been recorded for Studio approval.",
    next: "No appointment is booked yet. If approved, you will receive an email and text with a Square link to pay the deposit for the held time.",
  },
  consultation: {
    label: "consultation reservation",
    subject: "Consultation reservation started",
    expectation: "Your requested consultation time is held only while checkout is active.",
    next: "The consultation becomes confirmed after Square reports a successful reservation-fee payment.",
  },
  build_session: {
    label: "in-person Build session",
    subject: "In-person Build reservation started",
    expectation: "Your requested 90-minute Build session is held only while checkout is active.",
    next: "The session becomes confirmed after Square reports a successful reservation-fee payment.",
  },
  art_acquisition: {
    label: "art acquisition inquiry",
    subject: "Art acquisition inquiry received",
    expectation: "The Art studio will review the work, availability, budget, and questions you shared.",
    next: "The studio will reply with availability, acquisition details, or the next step.",
  },
  studio_booking: {
    label: "studio booking request",
    subject: "Studio booking request received",
    expectation: "The studio will review the requested date, group size, and use of the space.",
    next: "The studio will reply with availability and the next step.",
  },
};

async function tattooReceiptSettings(env) {
  const fallback = {
    reviewTimeMessage: env.TATTOO_REVIEW_TIME_MESSAGE || DEFAULT_REVIEW_TIME_MESSAGE,
    supportEmail: env.NOTIFICATION_REPLY_TO || DEFAULT_REPLY_TO,
  };
  const db = notificationDb(env);
  if (!db) return fallback;
  try {
    const row = await db
      .prepare("SELECT review_time_message, support_email FROM tattoo_settings WHERE id = 'default' LIMIT 1")
      .first();
    return {
      reviewTimeMessage: asString(row?.review_time_message) || fallback.reviewTimeMessage,
      supportEmail: asString(row?.support_email) || fallback.supportEmail,
    };
  } catch {
    return fallback;
  }
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

function flashSheetDesignLines(payload, key, heading) {
  const designs = Array.isArray(payload?.[key]) ? payload[key] : [];
  if (!designs.length) return [];
  return [
    heading,
    ...designs.map((design) => {
      const identity = `${asString(design.code)} is ${asString(design.label)}`.trim();
      const placement = compactLine("placement", design.placement);
      const scale = compactLine("scale", design.scale);
      return `- ${[identity, placement, scale].filter(Boolean).join(" · ")}`;
    }),
  ];
}

function submissionDetailLines(submission) {
  const payload = { ...(submission.payload || {}) };
  if (!payload.budget_range && payload.claim_bid) payload.budget_range = payload.claim_bid;
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
      "budget_range",
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
    tattoo_special: [
      "campaign",
      "special_offer_title",
      "special_variant_label",
      "quoted_price_cents",
      "approved_price_cents",
      "deposit_cents",
      "duration_minutes",
      "booking_mode",
      "placement",
      "project_details",
      "reference_link",
      "participants",
    ],
    build_brief: [
      "selected_elements",
      "symbol_ids",
      "placement",
      "size",
      "scale",
      "budget_range",
      "design_intent",
      "timeline",
      "brief_pdf_status",
      "message",
      "instagram",
    ],
    maze_design: [
      "maze_explanation",
      "placement",
      "size",
      "scale",
      "budget_range",
      "timeline",
      "brief_pdf_status",
      "message",
      "instagram",
      "maze_artifact_snapshot",
    ],
    art_acquisition: ["artwork", "artwork_title", "budget_range", "message", "instagram"],
    consultation: ["consultation_type", "preferred_dates", "message", "instagram"],
    studio_booking: ["booking_type", "preferred_dates", "party_size", "message"],
  };
  const preferredFields = fieldsByType[submission.type] || Object.keys(payload);
  const lines = preferredFields
    .map((key) => compactLine(labelFromKey(key), payload[key]))
    .filter(Boolean);
  if (submission.type === "flash_claim") {
    lines.push(
      ...flashSheetDesignLines(payload, "sheet_design_selections", "Requested sheet designs"),
      ...flashSheetDesignLines(payload, "approved_sheet_designs", "Approved sheet designs"),
    );
  }
  if (submission.type === "build_brief" && Array.isArray(payload.symbol_snapshot)) {
    const personalNotes = payload.symbol_snapshot
      .filter((symbol) => asString(symbol?.client_note))
      .map((symbol, index) => `- ${asString(symbol.name) || asString(symbol.id) || `Symbol ${index + 1}`}: ${asString(symbol.client_note)}`);
    if (personalNotes.length) lines.push("Personal symbol descriptions", ...personalNotes);
    const composition = payload.composition_snapshot;
    if (composition?.reading) lines.push(compactLine("Composition reading", composition.reading));
    if (Array.isArray(composition?.appliedRules) && composition.appliedRules.length) {
      lines.push(
        "Authored Legend relationships",
        ...composition.appliedRules.map((rule) => `- ${asString(rule.type) || "reading"}: ${asString(rule.interpretation)}`),
      );
    }
    if (payload.client_composition_snapshot?.reading) {
      lines.push(compactLine("Exact reading shown to client", payload.client_composition_snapshot.reading));
    }
  }
  return lines;
}

async function sendAdminNotification(env, request, message) {
  const recipient = adminNotificationAddress(env);
  if (!recipient) return { ok: false, skipped: true };

  const key = asString(message.templateKey);
  const theme = message.theme
    || (key.includes("event") ? "construct_event" : key.includes("submission") || key.includes("appointment") ? "tattoo" : "construct_studio");
  const rendered = buildAdminNotificationEmail({
    templateKey: key,
    variant: message.templateVariant || theme,
    theme,
    subject: message.subject,
    preheader: message.preheader,
    classification: message.classification,
    headline: message.headline,
    sectionTitle: message.sectionTitle,
    lines: message.lines,
    studioUrl: studioConsoleUrl(env, request),
  });

  return sendTransactionalEmail(env, {
    to: recipient,
    fromEmail: env.ADMIN_NOTIFICATION_FROM_EMAIL || DEFAULT_ADMIN_FROM_ADDRESS,
    fromName: env.ADMIN_NOTIFICATION_FROM_NAME || "art.pill notifications",
    replyTo: replyToAddress(env),
    ...message,
    ...rendered,
  });
}

export async function notifySubmissionReceived(env, submission, options = {}) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail) return { ok: false, skipped: true };

  const type = normalizedSubmissionType(normalized.type);
  if (type === "tattoo_special" && asString(normalized.payload?.booking_mode) !== "review") {
    return { ok: false, skipped: true, reason: "direct_booking_confirmation_only" };
  }
  const studioVisit = type === "studio_booking"
    && (normalized.payload?.booking_type_id || normalized.payload?.bookingTypeId) === "studio_visit";
  const constructTheme = type === "art_acquisition" || studioVisit
    ? "construct_art"
    : type === "studio_booking"
      ? "construct_event"
      : "tattoo";
  const baseProfile = SUBMISSION_RECEIPTS[type] || {
    label: "project submission",
    subject: "Project submission received",
    expectation: "The studio will review the information you shared before deciding the next step.",
    next: "If more information or booking access is needed, the studio will contact you by email.",
  };
  const profile = studioVisit
    ? {
        label: "Open Studio Visit request",
        subject: "Open Studio Visit request received",
        expectation: "The Art studio will review the requested visit details and availability.",
        next: "The studio will reply with the next step or booking details.",
      }
    : baseProfile;
  const constructIdentity = constructTheme === "tattoo" ? null : eventsEmailIdentity(env);
  const settings = constructIdentity
    ? { reviewTimeMessage: DEFAULT_REVIEW_TIME_MESSAGE, supportEmail: constructIdentity.replyTo }
    : await tattooReceiptSettings(env);
  const reviewLine = type === "tattoo_special"
    ? "This is a request and a temporary hold, not a booked appointment. The appointment is confirmed only after Studio approval and successful deposit payment."
    : ["consultation", "build_session"].includes(type)
      ? "Complete checkout from the Square link you opened to keep the selected time."
      : settings.reviewTimeMessage;
  const requestedSheetDesigns = type === "flash_claim"
    ? flashSheetDesignLines(normalized.payload, "sheet_design_selections", "Requested sheet designs:")
    : [];
  const message = buildSubmissionReceivedEmail({
    variant: studioVisit
      ? "studio_visit"
      : ({ tattoo_inquiry: "custom", flash_claim: "flash", build_brief: "build", maze_design: "maze", special_project: "special", tattoo_special: "tattoo_special", consultation: "consultation", build_session: "build_session", art_acquisition: "art_acquisition", studio_booking: "studio_space" })[type] || "custom",
    theme: constructTheme,
    subject: constructIdentity
      ? `the six.well construct — ${profile.subject}`
      : `art.pill TATTOO HOUSE — ${profile.subject}`,
    clientName: normalized.contactName,
    label: profile.label,
    submissionId: normalized.id,
    heldWhen: normalized.payload?.held_start_at
      ? `${formatDate(normalized.payload.held_start_at)}${normalized.payload?.held_end_at ? ` - ${formatDate(normalized.payload.held_end_at)}` : ""}`
      : "",
    requestedSheetDesigns: requestedSheetDesigns.slice(1),
    expectation: profile.expectation,
    next: profile.next,
    reviewLine,
    supportEmail: settings.supportEmail,
    briefUrl: normalized.briefUrl,
    briefLabel: normalized.briefLabel,
  });

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    ...(constructIdentity || {}),
    ...message,
    templateKey: "submission_received",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: options.idempotencyKey || `submission_received:${normalized.id}`,
  });
}

export async function notifyAdminSubmissionReceived(env, submission, options = {}) {
  const normalized = normalizeSubmission(submission);
  if (normalized.type === "tattoo_special" && asString(normalized.payload?.booking_mode) !== "review") {
    return { ok: false, skipped: true, reason: "direct_booking_confirmation_only" };
  }
  const formName = tattooFormName(normalized.type);
  const studioVisit = normalized.type === "studio_booking"
    && (normalized.payload?.booking_type_id || normalized.payload?.bookingTypeId) === "studio_visit";
  const submissionTypeLabel = studioVisit ? "Open Studio Visit" : labelFromKey(normalized.type);
  const theme = normalized.type === "art_acquisition" || studioVisit
    ? "construct_art"
    : normalized.type === "studio_booking"
      ? "construct_event"
      : "tattoo";
  const detailLines = submissionDetailLines(normalized);
  const lines = [
    "New form submission received.",
    "",
    compactLine("Type", submissionTypeLabel),
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
    theme,
    templateVariant: normalized.type === "tattoo_special" ? "tattoo_special" : theme,
    subject: formName
      ? tattooSubject(formName)
      : `New submission: ${submissionTypeLabel}`,
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
  const purpose = asString(token.purpose || token.bookingPurpose || token.booking_purpose) || "tattoo";
  const isConsultationPurpose = purpose === "consultation";
  const isTattooSpecial = normalized.type === "tattoo_special";
  const approvedBudget = isConsultationPurpose ? "" : reviewedBudgetLabel(token.approvedBudget);
  const expiresAt = token.expiresAt || token.expires_at || "";
  const approvedSheetDesigns = flashSheetDesignLines(
    normalized.payload,
    "approved_sheet_designs",
    "Approved sheet designs:",
  );
  const message = buildBookingLinkEmail({
    variant: isTattooSpecial ? "tattoo_special" : isConsultationPurpose ? "consultation" : "tattoo",
    subject: isConsultationPurpose
      ? "Your private prerequisite consultation link"
      : isTattooSpecial
        ? "Finish booking your Tattoo Special - deposit required"
        : "Your private art.pill TATTOO HOUSE tattoo booking link",
    consultation: isConsultationPurpose,
    clientName: normalized.contactName,
    approvedSheetDesigns: approvedSheetDesigns.slice(1),
    sessionOptions: sessionOptionsText(bookingTypes),
    approvedBudget,
    depositText: depositAmountText(bookingTypes),
    bookingUrl,
    expiresAt: expiresAt ? formatDate(expiresAt) : "",
    bookingTermsUrl: resources.bookingTermsUrl,
    dayOfInstructionsUrl: resources.dayOfInstructionsUrl,
    locationParkingUrl: resources.locationParkingUrl,
  });

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    ...message,
    templateKey: "booking_link_created",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: options.idempotencyKey || `booking_link_created:${token.id}`,
  });
}

async function sendTattooAppointmentConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const isSpecial = isTattooSpecialAppointment(appointment);
  const specialSession = tattooSpecialSessionLabel(appointment);
  const specialRemaining = Math.max(0, Number(appointment.specialApprovedPriceCents || 0) - Number(appointment.depositCents || 0));
  const hasExtendedDayFee = appointment.bookingTypeId === EXTENDED_DAY_BOOKING_TYPE_ID
    && Number(appointment.sessionFeeCents || 0) > 0;
  const ordinaryPricing = isSpecial ? null : await reviewedTattooPricing(env, appointment);
  const ordinaryDetails = ordinaryTattooPricingDetails(ordinaryPricing, appointment);
  const pricingDetails = isSpecial
    ? [{
        id: "tattoo_special_total",
        label: "Tattoo Special total",
        value: formatMoney(appointment.specialApprovedPriceCents, appointment.currency),
      }]
    : ordinaryDetails.pricingDetails;
  const balanceDetails = isSpecial
    ? [
        {
          id: "remaining_balance",
          label: "Remaining balance",
          value: formatMoney(specialRemaining, appointment.currency),
        },
        {
          id: "tattoo_special_duration",
          label: "Duration",
          value: `${appointment.specialDurationMinutes} minutes`,
        },
      ]
    : ordinaryDetails.balanceDetails;
  const variant = isSpecial
    ? (appointment.tipCents ? "tattoo_special_tip" : "tattoo_special")
    : hasExtendedDayFee
      ? ordinaryPricing
        ? (appointment.tipCents ? "tattoo_extended_tip" : "tattoo_extended")
        : (appointment.tipCents ? "tattoo_extended_legacy_tip" : "tattoo_extended_legacy")
      : ordinaryPricing
        ? undefined
        : (appointment.tipCents ? "tattoo_legacy_tip" : "tattoo_legacy");
  const message = buildAppointmentConfirmedEmail({
    kind: isSpecial ? "tattoo_special" : "tattoo",
    variant,
    subject: isSpecial
      ? "Your Tattoo Special appointment at art.pill TATTOO HOUSE has been confirmed"
      : "Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed",
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: specialSession,
    pricingDetails,
    feeText: `${formatMoney(appointment.depositCents, appointment.currency)} received`,
    balanceDetails,
    billingPolicyText: appointment.bookingTypeId === EXTENDED_DAY_BOOKING_TYPE_ID
      ? "Extended day sessions are always optional and are presented as an option for clients who want longer sessions. Quarter, Half, and Full Day sessions do not include the Extended Day fee, and your project may be split across shorter appointments if desired. If additional appointments are needed, I will coordinate the remaining dates with you."
      : "",
    renderingPolicyText: "Your paid tattoo deposit includes one developed design direction. Artist-approved additional concept sketches are separate, non-refundable $50 fees that are not credited toward the tattoo total and must be paid before drawing begins.",
    paymentPolicyText: TATTOO_APPOINTMENT_PAYMENT_AND_ARRIVAL_POLICY,
    tipText: appointment.tipCents ? formatMoney(appointment.tipCents, appointment.currency) : "",
    totalPaidText: appointment.tipCents ? formatMoney(appointment.totalDueCents, appointment.currency) : "",
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    resources: [
      { label: "Tattoo policies", href: resources.bookingTermsUrl },
      { label: "Day-of instructions", href: resources.dayOfInstructionsUrl },
      { label: "Location & parking", href: resources.locationParkingUrl },
    ],
  });

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...message,
    templateKey: "appointment_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendInPersonConsultationConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const message = buildAppointmentConfirmedEmail({
    kind: "consultation_in_person",
    subject: "Your consultation at art.pill TATTOO HOUSE has been confirmed",
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: appointment.bookingTypeLabel,
    feeText: `${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for your consultation, not a deposit toward future work.`,
    tipText: appointment.tipCents ? formatMoney(appointment.tipCents, appointment.currency) : "",
    totalPaidText: appointment.tipCents ? formatMoney(appointment.totalDueCents, appointment.currency) : "",
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    resources: [
      { label: "Location & parking", href: resources.locationParkingUrl },
    ],
  });

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...message,
    templateKey: "consultation_confirmed_in_person",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendVirtualConsultationConfirmed(env, request, appointment, options = {}) {
  const message = buildAppointmentConfirmedEmail({
    kind: "consultation_virtual",
    subject: "Your virtual consultation with art.pill TATTOO HOUSE has been confirmed",
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: appointment.bookingTypeLabel,
    feeText: `${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for your consultation, not a deposit toward future work.`,
    tipText: appointment.tipCents ? formatMoney(appointment.tipCents, appointment.currency) : "",
    totalPaidText: appointment.tipCents ? formatMoney(appointment.totalDueCents, appointment.currency) : "",
    zoomUrl: appointment.meeting?.joinUrl || "",
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    resources: [],
  });

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...message,
    templateKey: "consultation_confirmed_virtual",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendBuildSessionConfirmed(env, request, appointment, options = {}) {
  const resources = clientResourceUrls(env, request);
  const message = buildAppointmentConfirmedEmail({
    kind: "build_session",
    subject: "Your build session at art.pill TATTOO HOUSE has been confirmed",
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: appointment.bookingTypeLabel,
    feeText: `${formatMoney(appointment.depositCents, appointment.currency)} received - this is the full price for the build session, not a deposit toward a future tattoo.`,
    tipText: appointment.tipCents ? formatMoney(appointment.tipCents, appointment.currency) : "",
    totalPaidText: appointment.tipCents ? formatMoney(appointment.totalDueCents, appointment.currency) : "",
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    resources: [
      { label: "Location & parking", href: resources.locationParkingUrl },
    ],
  });

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...message,
    templateKey: "build_session_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_confirmed:${appointment.id}`,
  });
}

async function sendStudioBookingConfirmed(env, request, appointment, options = {}) {
  const identity = eventsEmailIdentity(env);
  const studioVisit = ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const message = buildAppointmentConfirmedEmail({
    kind: studioVisit ? "studio_visit" : "studio_space",
    variant: studioVisit ? "studio_visit" : "studio_space",
    subject: studioVisit
      ? "Your Open Studio Visit at the six.well construct is confirmed"
      : "Your studio booking at the six.well construct is confirmed",
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: studioBookingName(appointment),
    feeText: `${formatMoney(appointment.depositCents, appointment.currency)} received - this holds your date; any balance is settled with the studio.`,
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    resources: [],
  });

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    fromEmail: identity.fromEmail,
    fromName: identity.fromName,
    replyTo: identity.replyTo,
    ...message,
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
  const studio = STUDIO_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId) || appointment.purpose === "studio";
  const art = ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const bookingTypeLabel = studio ? studioBookingName(appointment) : appointment.bookingTypeLabel || appointment.bookingTypeId;
  const when = [formatDate(appointment.startAt), formatDate(appointment.endAt)]
    .filter(Boolean)
    .join(" - ");
  const lines = [
    "Booking payment confirmed.",
    "",
    compactLine("Booking type", bookingTypeLabel),
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
    appointment.sessionFeeCents ? compactLine("Extended Day fee", `${formatMoney(appointment.sessionFeeCents, appointment.currency)} due with remaining studio balance at the start of the appointment, before tattooing begins`) : "",
    appointment.tipCents ? compactLine("Optional tip", formatMoney(appointment.tipCents, appointment.currency)) : "",
    compactLine("Total paid", formatMoney(appointment.totalDueCents, appointment.currency)),
    "",
    compactLine("Confirmation page", appointmentConfirmationUrl(env, request, appointment)),
    compactLine("Calendar", appointmentCalendarUrl(env, request, appointment)),
  ];

  return sendAdminNotification(env, request, {
    theme: art ? "construct_art" : studio ? "construct_event" : "tattoo",
    templateVariant: art ? "construct_art" : studio ? "construct_event" : isTattooSpecialAppointment(appointment) ? "tattoo_special" : "tattoo",
    subject: studio
      ? `Booking confirmed: ${bookingTypeLabel}`
      : tattooAdminBookingSubject(appointment, "Confirmed"),
    lines,
    templateKey: "admin_appointment_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `admin_appointment_confirmed:${appointment.id}`,
  });
}

export async function notifyTattooRenderingPaymentRequested(env, request, renderingRow, options = {}) {
  if (!renderingRow?.client_email) return { ok: false, skipped: true };
  const message = buildTattooRenderingPaymentRequestEmail({
    clientName: renderingRow.client_name,
    requestNumber: renderingRow.request_number,
    amountText: formatMoney(renderingRow.amount_cents || 5000, renderingRow.currency || "USD"),
    appointmentWhen: renderingRow.start_at
      ? `${formatDate(renderingRow.start_at)} - ${formatDate(renderingRow.end_at)}`
      : "",
    expiresAt: renderingRow.expires_at ? formatDate(renderingRow.expires_at) : "",
    checkoutUrl: renderingRow.square_checkout_url,
  });
  return sendTransactionalEmail(env, {
    to: renderingRow.client_email,
    ...message,
    templateKey: "tattoo_rendering_payment_requested",
    templateVariant: "default",
    relatedType: "tattoo_rendering_request",
    relatedId: renderingRow.id,
    idempotencyKey: options.idempotencyKey || `tattoo_rendering_payment_requested:${renderingRow.id}`,
  });
}

export async function notifyTattooRenderingPaymentConfirmed(env, request, renderingRow, options = {}) {
  if (!renderingRow?.client_email) return { ok: false, skipped: true };
  const message = buildTattooRenderingPaymentConfirmedEmail({
    clientName: renderingRow.client_name,
    requestNumber: renderingRow.request_number,
    amountText: formatMoney(renderingRow.amount_cents || 5000, renderingRow.currency || "USD"),
    appointmentWhen: renderingRow.start_at
      ? `${formatDate(renderingRow.start_at)} - ${formatDate(renderingRow.end_at)}`
      : "",
  });
  return sendTransactionalEmail(env, {
    to: renderingRow.client_email,
    ...message,
    templateKey: "tattoo_rendering_payment_confirmed",
    templateVariant: "default",
    relatedType: "tattoo_rendering_request",
    relatedId: renderingRow.id,
    idempotencyKey: options.idempotencyKey || `tattoo_rendering_payment_confirmed:${renderingRow.id}`,
  });
}

function rescheduledAppointmentProfile(appointment) {
  const virtual = appointment.bookingTypeId === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID;
  const build = appointment.bookingTypeId === BUILD_SESSION_BOOKING_TYPE_ID || appointment.purpose === "build_session";
  const consultation = [IN_PERSON_CONSULTATION_BOOKING_TYPE_ID, VIRTUAL_CONSULTATION_BOOKING_TYPE_ID].includes(appointment.bookingTypeId)
    || ["prerequisite_consultation", "standalone_consultation"].includes(appointment.purpose);
  const studio = STUDIO_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId) || appointment.purpose === "studio";
  const art = ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const tattooSpecial = isTattooSpecialAppointment(appointment);
  return {
    studio,
    art,
    virtual,
    tattooSpecial,
    label: art ? "Open Studio Visit" : studio ? "studio booking" : build ? "Build session" : consultation ? "consultation" : tattooSpecial ? "Tattoo Special appointment" : "tattoo appointment",
  };
}

export async function notifyTattooSpecialDepositRequested(env, request, details = {}, options = {}) {
  const to = asString(details.clientEmail || details.contactEmail);
  if (!to) return { ok: false, skipped: true, error: "Tattoo Special deposit recipient is required." };
  const message = buildTattooSpecialDepositRequestEmail({
    subject: "Your Tattoo Special was approved — deposit required",
    clientName: details.clientName || details.contactName,
    when: `${formatDate(details.startAt)}${details.endAt ? ` - ${formatDate(details.endAt)}` : ""}`,
    selection: [details.offerTitle, details.variantLabel].filter(Boolean).join(" — "),
    approvedTotal: formatMoney(details.approvedPriceCents || 0, details.currency || "USD"),
    depositText: formatMoney(details.depositCents || 0, details.currency || "USD"),
    paymentDue: formatDate(details.paymentDueAt),
    checkoutUrl: details.checkoutUrl,
    changeTimeUrl: `${publicBaseUrl(env, request)}/booking/reschedule/?appointment=${encodeURIComponent(details.appointmentId)}&flow=special-request`,
  });
  return sendTransactionalEmail(env, {
    to,
    ...message,
    templateKey: "tattoo_special_deposit_requested",
    templateVariant: "default",
    relatedType: "appointment",
    relatedId: details.appointmentId,
    idempotencyKey: options.idempotencyKey || `tattoo_special_deposit_requested:${details.appointmentId}`,
  });
}

export async function notifyAppointmentRescheduled(env, request, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };
  const profile = rescheduledAppointmentProfile(appointment);
  const resources = clientResourceUrls(env, request);
  const previousStartAt = options.previousStartAt || appointment.originalStartAt || "";
  const previousEndAt = options.previousEndAt || appointment.originalEndAt || "";
  const message = buildAppointmentRescheduledEmail({
    kind: profile.art ? "studio_visit" : profile.studio ? "studio_space" : profile.tattooSpecial ? "tattoo_special" : "tattoo",
    variant: profile.art ? "studio_visit" : profile.studio ? "studio_space" : profile.tattooSpecial ? "tattoo_special" : "tattoo",
    subject: `Your ${profile.label} has been rescheduled`,
    label: profile.label,
    clientName: appointment.clientName,
    previousTime: previousStartAt
      ? `${formatDate(previousStartAt)}${previousEndAt ? ` - ${formatDate(previousEndAt)}` : ""}`
      : "",
    newTime: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: profile.studio ? studioBookingName(appointment) : tattooSpecialSessionLabel(appointment),
    ...extendedDayEmailFields(appointment),
    zoomUrl: profile.virtual ? appointment.meeting?.joinUrl || "" : "",
    zoomStatus: profile.virtual && !appointment.meeting?.joinUrl
      ? "Zoom details will be sent separately if the link is not ready yet."
      : "",
    confirmationUrl: appointmentConfirmationUrl(env, request, appointment),
    calendarUrl: appointmentCalendarUrl(env, request, appointment),
    locationUrl: profile.studio || profile.virtual ? "" : resources.locationParkingUrl,
  });
  const identity = profile.studio ? eventsEmailIdentity(env) : {};
  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...identity,
    ...message,
    templateKey: "appointment_rescheduled",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_rescheduled:${appointment.id}:${appointment.startAt}`,
  });
}

export async function notifyAdminAppointmentRescheduled(env, request, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  const profile = rescheduledAppointmentProfile(appointment);
  const bookingTypeLabel = profile.studio ? studioBookingName(appointment) : appointment.bookingTypeLabel || appointment.bookingTypeId;
  const previousStartAt = options.previousStartAt || appointment.originalStartAt || "";
  const previousEndAt = options.previousEndAt || appointment.originalEndAt || "";
  return sendAdminNotification(env, request, {
    theme: profile.art ? "construct_art" : profile.studio ? "construct_event" : "tattoo",
    templateVariant: profile.art ? "construct_art" : profile.studio ? "construct_event" : profile.tattooSpecial ? "tattoo_special" : "tattoo",
    subject: profile.studio
      ? `Booking rescheduled: ${bookingTypeLabel}`
      : tattooAdminBookingSubject(appointment, "Rescheduled"),
    lines: [
      "A paid booking was moved without a new charge.",
      "",
      compactLine("Booking type", bookingTypeLabel),
      compactLine("Purpose", appointment.purpose || profile.label),
      compactLine("Appointment ID", appointment.id),
      compactLine("Submission ID", appointment.submissionId),
      previousStartAt ? compactLine("Previous time", `${formatDate(previousStartAt)}${previousEndAt ? ` - ${formatDate(previousEndAt)}` : ""}`) : "",
      compactLine("New time", `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`),
      appointment.sessionFeeCents ? compactLine("Extended Day fee", `${formatMoney(appointment.sessionFeeCents, appointment.currency)} due with remaining studio balance at the start of the appointment, before tattooing begins`) : "",
      compactLine("Reschedules used", appointment.rescheduleCount),
      "",
      compactLine("Client", appointment.clientName),
      compactLine("Email", appointment.clientEmail),
      compactLine("Updated confirmation", appointmentConfirmationUrl(env, request, appointment)),
      compactLine("Updated calendar", appointmentCalendarUrl(env, request, appointment)),
    ],
    templateKey: "admin_appointment_rescheduled",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `admin_appointment_rescheduled:${appointment.id}:${appointment.startAt}`,
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

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function activeTokenForBookingUrl(db, submissionId, bookingUrl) {
  let rawToken = "";
  try {
    rawToken = new URL(bookingUrl, "https://booking.invalid").searchParams.get("token") || "";
  } catch {
    return null;
  }
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  return db
    .prepare(
      `SELECT * FROM booking_tokens
       WHERE submission_id = ? AND token_hash = ?
         AND revoked_at IS NULL
         AND used_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`
    )
    .bind(submissionId, tokenHash, new Date().toISOString())
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

function selectedEmailTemplate(templateKey, requestedVariant) {
  const catalog = clientEmailPreviewCatalog();
  const matches = catalog.filter((entry) => entry.templateKey === templateKey);
  if (!matches.length) return { error: "Unsupported email template." };
  const selected = requestedVariant
    ? matches.find((entry) => entry.variant === requestedVariant)
    : matches[0];
  return selected ? { selected } : { error: "Unsupported email template variant." };
}

export async function handleAdminPreviewNotification(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  if (!["GET", "POST"].includes(request.method)) {
    return errorResponse("Method not allowed.", 405);
  }

  const url = new URL(request.url);
  const body = request.method === "POST" ? await readJsonBody(request) : null;
  if (request.method === "POST" && !body) return errorResponse("Expected JSON body.", 400);
  const templateKey = asString(body?.templateKey || url.searchParams.get("templateKey"));
  const requestedVariant = asString(body?.variant || url.searchParams.get("variant"));
  const catalog = clientEmailPreviewCatalog();
  if (!templateKey) {
    const templates = await Promise.all(catalog.map(async (entry) => {
      const definition = emailTemplateDefinition(entry.templateKey, entry.variant);
      const draft = await templateRevision(notificationDb(env), entry.templateKey, entry.variant, "draft");
      const published = await templateRevision(notificationDb(env), entry.templateKey, entry.variant, "published");
      return {
        ...entry,
        status: draft ? "draft" : published ? "published" : "default",
        draftRevision: draft?.revision || null,
        publishedRevision: published?.revision || 0,
        schema: definition?.schema,
      };
    }));
    return json({ templates });
  }

  const selection = selectedEmailTemplate(templateKey, requestedVariant);
  if (selection.error) return errorResponse(selection.error, 404);
  const selected = selection.selected;
  const publishedDesign = await emailDesignRevision(notificationDb(env), "published");
  const publishedDesignProfile = publishedDesign?.profile || defaultEmailDesignProfile();
  if (request.method === "POST" && selected.templateKey === "crm_relationship_followup" && body?.compose) {
    const compose = body.compose && typeof body.compose === "object" && !Array.isArray(body.compose) ? body.compose : {};
    const subject = asString(compose.subject).slice(0, 300);
    const preheader = asString(compose.preheader).slice(0, 300);
    const messageBody = asString(compose.body).slice(0, 10_000);
    if (!subject || !messageBody) return errorResponse("Subject and message are required for CRM preview.", 422);
    const base = buildCrmFollowupEmail({
      theme: selected.variant === "tattoo" ? "tattoo" : "construct_studio",
      subject,
      preheader,
      body: messageBody,
    });
    const wrapperDefinition = emailTemplateDefinition(selected.templateKey, selected.variant);
    const published = await templateRevision(notificationDb(env), selected.templateKey, selected.variant, "published");
    const composed = published
      ? renderEmailContent(base.semantic, published.content, wrapperDefinition.options, publishedDesignProfile)
      : renderClientEmail(base.semantic, publishedDesignProfile);
    return json({
      ...selected,
      ...composed,
      revision: published?.revision || 0,
      designRevision: publishedDesign?.revision || 0,
      source: "composer",
    });
  }
  const definition = emailTemplateDefinition(selected.templateKey, selected.variant);
  let content = body?.content || null;
  let revision = 0;
  let source = "default";
  if (!content && asString(url.searchParams.get("source")) !== "default") {
    const draft = asString(url.searchParams.get("source")) === "draft"
      ? await templateRevision(notificationDb(env), selected.templateKey, selected.variant, "draft")
      : null;
    const published = draft || await templateRevision(notificationDb(env), selected.templateKey, selected.variant, "published");
    if (published) {
      content = published.content;
      revision = published.revision;
      source = published.status;
    }
  }
  const result = content
    ? renderEmailTemplateContent(selected.templateKey, selected.variant, content, publishedDesignProfile)
    : null;
  if (result && !result.validation.ok) return errorResponse("Template copy is invalid.", 422, { errors: result.validation.errors });
  const rendered = result?.rendered || renderClientEmailPreview(selected.templateKey, selected.variant, publishedDesignProfile);
  if (!rendered) {
    return errorResponse("Unable to render email preview.", 500);
  }
  return json({
    ...selected,
    ...rendered,
    content: content || definition.defaultContent,
    schema: definition.schema,
    revision,
    designRevision: publishedDesign?.revision || 0,
    source,
  });
}

const EMAIL_DESIGN_REPRESENTATIVES = Object.freeze({
  tattoo: Object.freeze({ node: "tattoo", label: "Tattoo", templateKey: "booking_link_created", variant: "tattoo" }),
  art: Object.freeze({ node: "art", label: "Art", templateKey: "appointment_rescheduled", variant: "studio_visit" }),
  events: Object.freeze({ node: "events", label: "Events", templateKey: "appointment_rescheduled", variant: "studio_space" }),
  studio: Object.freeze({ node: "studio", label: "Studio", templateKey: "admin_test", variant: "construct_studio" }),
});

function emailDesignScopes(scope) {
  const value = asString(scope || "global");
  if (value === "global") return Object.values(EMAIL_DESIGN_REPRESENTATIVES);
  return EMAIL_DESIGN_REPRESENTATIVES[value] ? [EMAIL_DESIGN_REPRESENTATIVES[value]] : null;
}

async function renderEmailDesignRepresentative(db, representative, profile) {
  const publishedCopy = await templateRevision(db, representative.templateKey, representative.variant, "published");
  const result = publishedCopy
    ? renderEmailTemplateContent(representative.templateKey, representative.variant, publishedCopy.content, profile)
    : null;
  if (result && !result.validation.ok) throw new Error(`Published copy is invalid for ${representative.node}.`);
  const rendered = result?.rendered || renderClientEmailPreview(representative.templateKey, representative.variant, profile);
  if (!rendered) throw new Error(`Unable to render the ${representative.node} design preview.`);
  return {
    ...representative,
    ...rendered,
    templateRevision: publishedCopy?.revision || 0,
    copySource: publishedCopy ? "published" : "default",
  };
}

export async function handleAdminEmailDesign(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  const prefix = "/api/admin/notifications/design";
  const action = asString(url.pathname.slice(prefix.length).split("/").filter(Boolean)[0]);
  const db = notificationDb(env);
  if (!db) return errorResponse("Missing D1 binding SUBMISSIONS_DB.", 503);

  try {
    if (request.method === "GET" && (!action || action === "history")) {
      const [draft, published, history] = await Promise.all([
        emailDesignRevision(db, "draft"),
        emailDesignRevision(db, "published"),
        action === "history" ? emailDesignHistory(db) : Promise.resolve(undefined),
      ]);
      return json({
        version: 1,
        roles: ["canvas", "panel", "title", "supporting", "descriptor", "signatureMark"],
        nodes: Object.values(EMAIL_DESIGN_REPRESENTATIVES).map(({ node, label }) => ({
          node,
          label,
          accent: node === "tattoo"
            ? CLIENT_EMAIL_THEMES.tattoo.accentBright
            : node === "art"
              ? CLIENT_EMAIL_THEMES.construct_art.accentBright
              : node === "events"
                ? CLIENT_EMAIL_THEMES.construct_event.accentBright
                : CLIENT_EMAIL_THEMES.construct_studio.accentBright,
        })),
        defaultProfile: defaultEmailDesignProfile(),
        draft,
        published,
        history,
      });
    }

    const body = await readJsonBody(request);
    if (!body) return errorResponse("Expected JSON body.", 400);

    if (request.method === "POST" && action === "preview") {
      const validation = validateEmailDesignProfile(body.profile);
      if (!validation.ok) return errorResponse("Email design profile is invalid.", 422, { errors: validation.errors });
      const scopes = emailDesignScopes(body.scope);
      if (!scopes) return errorResponse("Design scope must be global, tattoo, art, events, or studio.", 422);
      const previews = await Promise.all(scopes.map((entry) => renderEmailDesignRepresentative(db, entry, validation.profile)));
      return json({ previews });
    }

    if (request.method === "PUT" && action === "draft") {
      const validation = validateEmailDesignProfile(body.profile);
      if (!validation.ok) return errorResponse("Email design profile is invalid.", 422, { errors: validation.errors });
      const draft = await saveEmailDesignDraft(db, {
        profile: validation.profile,
        baseRevision: body.baseRevision,
      });
      if (draft?.conflict) return errorResponse("Email design draft is stale.", 409, draft);
      return json({ draft });
    }

    if (request.method === "POST" && action === "publish") {
      const draft = await emailDesignRevision(db, "draft");
      if (!draft) return errorResponse("No saved design draft is available to publish.", 409);
      const published = await publishEmailDesignDraft(db, { revision: body.revision });
      if (published?.conflict) return errorResponse("Email design draft is stale.", 409, published);
      return json({ published });
    }

    if (request.method === "POST" && action === "restore") {
      const draft = await restoreEmailDesignRevision(db, {
        revision: body.revision,
        baseRevision: body.baseRevision,
      });
      if (draft?.conflict) return errorResponse("Email design draft is stale.", 409, draft);
      if (!draft) return errorResponse("Email design revision was not found.", 404);
      return json({ draft });
    }

    if (request.method === "POST" && action === "test") {
      const draft = await emailDesignRevision(db, "draft");
      if (!draft || draft.revision !== Number(body.revision)) {
        return errorResponse("Save the current design draft before sending a test.", 409);
      }
      const scopes = emailDesignScopes(body.scope);
      if (!scopes) return errorResponse("Design scope must be global, tattoo, art, events, or studio.", 422);
      const recipient = adminNotificationAddress(env);
      const deliveries = [];
      for (const entry of scopes) {
        const rendered = await renderEmailDesignRepresentative(db, entry, draft.profile);
        deliveries.push(await sendTransactionalEmail(env, {
          to: recipient,
          fromEmail: env.ADMIN_NOTIFICATION_FROM_EMAIL || DEFAULT_ADMIN_FROM_ADDRESS,
          fromName: env.ADMIN_NOTIFICATION_FROM_NAME || "Studio email tests",
          replyTo: replyToAddress(env),
          ...rendered,
          subject: `[DESIGN TEST][${entry.label.toUpperCase()}] ${rendered.subject}`,
          templateKey: entry.templateKey,
          templateVariant: entry.variant,
          templateRevision: rendered.templateRevision,
          emailDesignRevision: draft.revision,
          contentLocked: true,
          relatedType: "email_design_test",
          relatedId: `${entry.node}:${draft.revision}`,
          idempotencyKey: `email_design_test:${entry.node}:${draft.revision}:${crypto.randomUUID()}`,
        }));
      }
      const ok = deliveries.every((delivery) => delivery.ok);
      return json({ ok, recipient, deliveries }, { status: ok ? 200 : 502 });
    }
  } catch (error) {
    return errorResponse(error.message || "Email design operation failed.", 500);
  }
  return errorResponse("Method not allowed.", 405);
}

export async function handleAdminEmailTemplates(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  const prefix = "/api/admin/notifications/templates";
  const parts = url.pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length && request.method === "GET") {
    const previewUrl = new URL("/api/admin/notifications/preview", url);
    return handleAdminPreviewNotification(new Request(previewUrl, request), env);
  }
  const templateKey = asString(parts[0]);
  const action = asString(parts[1]);
  const variant = asString(url.searchParams.get("variant"));
  const selection = selectedEmailTemplate(templateKey, variant);
  if (selection.error) return errorResponse(selection.error, 404);
  const selected = selection.selected;
  const definition = emailTemplateDefinition(selected.templateKey, selected.variant);
  const db = notificationDb(env);
  if (!db) return errorResponse("Missing D1 binding SUBMISSIONS_DB.", 503);

  if (request.method === "GET" && (!action || action === "history")) {
    const draft = await templateRevision(db, selected.templateKey, selected.variant, "draft");
    const published = await templateRevision(db, selected.templateKey, selected.variant, "published");
    const history = action === "history" ? await templateHistory(db, selected.templateKey, selected.variant) : undefined;
    return json({
      ...selected,
      schema: definition.schema,
      defaultContent: definition.defaultContent,
      draft,
      published,
      history,
    });
  }

  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    if (request.method === "PUT" && action === "draft") {
      const validation = validateEmailContent(definition.rendered.semantic, body.content, definition.options);
      if (!validation.ok) return errorResponse("Template copy is invalid.", 422, { errors: validation.errors });
      const saved = await saveTemplateDraft(db, {
        templateKey: selected.templateKey,
        variant: selected.variant,
        content: validation.content,
        baseRevision: body.baseRevision,
      });
      if (saved?.conflict) return errorResponse("Template draft is stale.", 409, saved);
      return json({ draft: saved });
    }
    if (request.method === "POST" && action === "publish") {
      const draft = await templateRevision(db, selected.templateKey, selected.variant, "draft");
      if (!draft) return errorResponse("No saved draft is available to publish.", 409);
      const validation = validateEmailContent(definition.rendered.semantic, draft.content, definition.options);
      if (!validation.ok) return errorResponse("Saved draft is invalid.", 422, { errors: validation.errors });
      const published = await publishTemplateDraft(db, { templateKey: selected.templateKey, variant: selected.variant, revision: body.revision });
      if (published?.conflict) return errorResponse("Template draft is stale.", 409, published);
      return json({ published });
    }
    if (request.method === "POST" && action === "restore") {
      const draft = await restoreTemplateRevision(db, {
        templateKey: selected.templateKey,
        variant: selected.variant,
        revision: body.revision,
        baseRevision: body.baseRevision,
      });
      if (draft?.conflict) return errorResponse("Template draft is stale.", 409, draft);
      if (!draft) return errorResponse("Template revision was not found.", 404);
      return json({ draft });
    }
    if (request.method === "POST" && action === "test") {
      const draft = await templateRevision(db, selected.templateKey, selected.variant, "draft");
      if (!draft || draft.revision !== Number(body.revision)) return errorResponse("Save the current draft before sending a test.", 409);
      const publishedDesign = await emailDesignRevision(db, "published");
      const result = renderEmailTemplateContent(
        selected.templateKey,
        selected.variant,
        draft.content,
        publishedDesign?.profile || defaultEmailDesignProfile(),
      );
      if (!result?.validation.ok) return errorResponse("Saved draft is invalid.", 422, { errors: result?.validation?.errors || [] });
      const rendered = { ...result.rendered, subject: `[TEST] ${result.rendered.subject}` };
      const recipient = adminNotificationAddress(env);
      const delivery = await sendTransactionalEmail(env, {
        to: recipient,
        fromEmail: env.ADMIN_NOTIFICATION_FROM_EMAIL || DEFAULT_ADMIN_FROM_ADDRESS,
        fromName: env.ADMIN_NOTIFICATION_FROM_NAME || "Studio email tests",
        replyTo: replyToAddress(env),
        ...rendered,
        templateKey: selected.templateKey,
        templateVariant: selected.variant,
        templateRevision: draft.revision,
        emailDesignRevision: publishedDesign?.revision || 0,
        contentLocked: true,
        relatedType: "email_template_test",
        relatedId: `${selected.templateKey}:${selected.variant}:${draft.revision}`,
        idempotencyKey: `email_template_test:${selected.templateKey}:${selected.variant}:${draft.revision}:${crypto.randomUUID()}`,
      });
      return deliveryResponse({ ...delivery, recipient });
    }
  } catch (error) {
    return errorResponse(error.message || "Email template operation failed.", 500);
  }
  return errorResponse("Method not allowed.", 405);
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
        subject: tattooSubject("Notification Test"),
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
      return deliveryResponse(delivery);
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
      return deliveryResponse(delivery);
    }

    if (templateKey === "submission_received") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      const delivery = await notifySubmissionReceived(env, submission, {
        idempotencyKey: resendKey(`submission_received:${submission.id}`),
      });
      return deliveryResponse(delivery);
    }

    if (templateKey === "admin_submission_received") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      const delivery = await notifyAdminSubmissionReceived(env, submission, {
        idempotencyKey: resendKey(`admin_submission_received:${submission.id}`),
      });
      return deliveryResponse(delivery);
    }

    if (templateKey === "booking_link_created") {
      const submission = await selectSubmission(db, submissionId);
      if (!submission) return errorResponse("Submission not found.", 404);
      if (!submission.booking_url) return errorResponse("This submission does not have a booking URL.", 400);

      const token = await activeTokenForBookingUrl(db, submission.id, submission.booking_url);
      if (!token) {
        return errorResponse("This booking link is expired, used, or revoked. Generate a new compatible link instead of resending it.", 409);
      }
      const tokenId = token.id;
      const sessionPlan = (token.purpose || "tattoo") === "tattoo"
        ? await db.prepare(
          `SELECT approved_budget_min_cents, approved_budget_max_cents, approved_budget_currency
           FROM tattoo_session_plans WHERE submission_id = ?`
        ).bind(submission.id).first()
        : null;
      const delivery = await notifyBookingLinkCreated(env, request, submission, {
        id: tokenId,
        bookingUrl: submission.booking_url.startsWith("http")
          ? submission.booking_url
          : `${publicBaseUrl(env, request)}${submission.booking_url}`,
        allowedBookingTypes: parseJsonField(token?.allowed_booking_types_json, []),
        purpose: token.purpose || "tattoo",
        expiresAt: token.expires_at || "",
        approvedBudget: sessionPlan?.approved_budget_min_cents && sessionPlan?.approved_budget_max_cents
          ? {
              minimumCents: sessionPlan.approved_budget_min_cents,
              maximumCents: sessionPlan.approved_budget_max_cents,
              currency: sessionPlan.approved_budget_currency || "USD",
            }
          : null,
      }, {
        idempotencyKey: resendKey(`booking_link_created:${tokenId}`),
      });
      return deliveryResponse(delivery);
    }

    if (templateKey === "tattoo_special_deposit_requested") {
      if (!appointmentId) return errorResponse("Missing Tattoo Special appointment id.", 400);
      const specialAppointment = await db.prepare(
        `SELECT a.*, s.type AS submission_type,
                s.contact_name AS submission_contact_name,
                s.contact_email AS submission_contact_email,
                t.offer_title, t.variant_label, t.advertised_price_cents,
                t.approved_price_cents, t.deposit_cents AS special_deposit_cents,
                t.sales_closes_at
         FROM appointments a
         JOIN submissions s ON s.id = a.submission_id
         JOIN tattoo_special_submission_terms t ON t.submission_id = s.id
         WHERE a.id = ? AND s.type = 'tattoo_special'`
      ).bind(appointmentId).first();
      if (!specialAppointment) return errorResponse("Tattoo Special appointment not found.", 404);
      const now = new Date().toISOString();
      if (
        specialAppointment.approval_state !== "approved"
        || !["pending_deposit", "deposit_pending"].includes(specialAppointment.status)
        || specialAppointment.hold_state !== "active"
      ) {
        return errorResponse("Only an approved Tattoo Special awaiting its deposit can receive this email.", 409);
      }
      if (
        !specialAppointment.square_checkout_url
        || specialAppointment.hold_expires_at <= now
        || (specialAppointment.payment_due_at && specialAppointment.payment_due_at <= now)
        || specialAppointment.sales_closes_at <= now
      ) {
        return errorResponse("This Tattoo Special deposit link is no longer active. Review the held time before sending a new link.", 409);
      }
      const delivery = await notifyTattooSpecialDepositRequested(env, request, {
        appointmentId: specialAppointment.id,
        clientName: specialAppointment.client_name || specialAppointment.submission_contact_name,
        clientEmail: specialAppointment.client_email || specialAppointment.submission_contact_email,
        startAt: specialAppointment.start_at,
        endAt: specialAppointment.end_at,
        offerTitle: specialAppointment.offer_title,
        variantLabel: specialAppointment.variant_label,
        approvedPriceCents: specialAppointment.approved_price_cents || specialAppointment.advertised_price_cents,
        depositCents: specialAppointment.special_deposit_cents || specialAppointment.deposit_cents,
        currency: specialAppointment.currency || "USD",
        paymentDueAt: specialAppointment.payment_due_at || specialAppointment.hold_expires_at,
        checkoutUrl: specialAppointment.square_checkout_url,
      }, {
        idempotencyKey: resendKey(`tattoo_special_deposit_requested:${specialAppointment.id}`),
      });
      return deliveryResponse(delivery);
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
      return deliveryResponse(delivery);
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
      return deliveryResponse(delivery);
    }

    if (templateKey === "appointment_rescheduled" || templateKey === "admin_appointment_rescheduled") {
      const appointment = await selectAppointmentWithMeeting(db, appointmentId);
      if (!appointment) return errorResponse("Appointment not found.", 404);
      if (appointment.status !== "confirmed" || Number(appointment.reschedule_count || 0) < 1) {
        return errorResponse("Only confirmed, rescheduled appointments can receive this notification.", 400);
      }
      const resendOptions = {
        previousStartAt: appointment.original_start_at || "",
        previousEndAt: appointment.original_end_at || "",
        idempotencyKey: resendKey(`${templateKey}:${appointment.id}`),
      };
      const delivery = templateKey === "admin_appointment_rescheduled"
        ? await notifyAdminAppointmentRescheduled(env, request, appointment, resendOptions)
        : await notifyAppointmentRescheduled(env, request, appointment, resendOptions);
      return deliveryResponse(delivery);
    }

    if (templateKey === "appointment_cancelled") {
      const appointment = await selectAppointmentWithMeeting(db, appointmentId);
      if (!appointment) return errorResponse("Appointment not found.", 404);
      if (appointment.status !== "cancelled") {
        return errorResponse("Only cancelled appointments can receive cancellation resends.", 400);
      }
      const delivery = await notifyAppointmentCancelled(env, request, appointment, {
        idempotencyKey: resendKey(`appointment_cancelled:${appointment.id}`),
      });
      return deliveryResponse(delivery);
    }

    if (templateKey === "appointment_reminder_24h") {
      const appointment = await selectAppointmentWithMeeting(db, appointmentId);
      if (!appointment) return errorResponse("Appointment not found.", 404);
      if (appointment.status !== "confirmed") {
        return errorResponse("Only confirmed appointments can receive reminder resends.", 400);
      }
      const delivery = await sendAppointmentReminder(env, appointment, {
        idempotencyKey: resendKey(`appointment_reminder_24h:${appointment.id}`),
      });
      return deliveryResponse(delivery);
    }

    return errorResponse(`Unsupported notification template: ${templateKey || "(blank)"}.`, 400);
  } catch (error) {
    return errorResponse("Unable to resend notification.", 500, { detail: error.message });
  }
}

export async function notifyAppointmentCancelled(env, request, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };

  const isStudio = STUDIO_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId) || appointment.purpose === "studio";
  const isArt = ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const isBuild = appointment.bookingTypeId === BUILD_SESSION_BOOKING_TYPE_ID || appointment.purpose === "build_session";
  const isPrerequisiteConsultation = appointment.purpose === "prerequisite_consultation";
  const isConsultation = [IN_PERSON_CONSULTATION_BOOKING_TYPE_ID, VIRTUAL_CONSULTATION_BOOKING_TYPE_ID].includes(appointment.bookingTypeId)
    || ["prerequisite_consultation", "standalone_consultation"].includes(appointment.purpose);
  const isTattooSpecial = isTattooSpecialAppointment(appointment);
  const occasion = isArt ? "Open Studio Visit" : isStudio ? "studio booking" : isBuild ? "Build session" : isPrerequisiteConsultation ? "project consultation" : isConsultation ? "consultation" : isTattooSpecial ? "Tattoo Special appointment" : "appointment";
  const rebookUrl = isBuild
    ? `${publicBaseUrl(env, request)}/tattoos/build/in-person/?rebook=1`
    : isConsultation && !isPrerequisiteConsultation
      ? `${publicBaseUrl(env, request)}/tattoos/inquire/consultation/?rebook=1&type=${encodeURIComponent(appointment.bookingTypeId || IN_PERSON_CONSULTATION_BOOKING_TYPE_ID)}`
      : "";
  const policyText = isConsultation || isBuild
    ? "Per studio policy, reservation fees are non-refundable. One reschedule is allowed with at least 48 hours notice; a new reservation fee is required for reschedules made within 48 hours."
    : "Per studio policy, deposits and payments are non-refundable. Cancellation is separate from the one-time reschedule option.";
  const nextText = isStudio
    ? "Reply to this email if you would like help planning another date."
    : isPrerequisiteConsultation
      ? "This consultation belongs to your reviewed tattoo project. Contact the studio to continue that project; do not start a separate public consultation."
      : "A cancelled tattoo appointment does not convert into a consultation. Contact the studio if you want to discuss a future project or appointment.";
  const message = buildAppointmentCancelledEmail({
    variant: isArt ? "studio_visit" : isStudio ? "studio_space" : isBuild ? "build" : isPrerequisiteConsultation ? "prerequisite" : isConsultation ? "consultation" : isTattooSpecial ? "tattoo_special" : "tattoo",
    kind: isArt ? "studio_visit" : isStudio ? "studio_space" : isTattooSpecial ? "tattoo_special" : "tattoo",
    subject: `Your ${isArt ? occasion : occasion.toLowerCase()} has been cancelled`,
    clientName: appointment.clientName,
    occasion,
    scheduled: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: isStudio ? studioBookingName(appointment) : tattooSpecialSessionLabel(appointment),
    ...extendedDayEmailFields(appointment),
    policyText,
    rebookUrl,
    nextText,
    supportEmail: isStudio
      ? eventsEmailIdentity(env).replyTo
      : env.NOTIFICATION_REPLY_TO || DEFAULT_REPLY_TO,
  });
  const identity = isStudio ? eventsEmailIdentity(env) : {};

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...identity,
    ...message,
    templateKey: "appointment_cancelled",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_cancelled:${appointment.id}`,
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
  const message = buildEventTicketPaidEmail({
    subject: `You're booked — ${title}`,
    title,
    clientName: ticketRow.contact_name,
    seats: String(seats),
    when: whenLine ? whenLine.replace(/^When:\s*/, "") : "",
    where: whereLine ? whereLine.replace(/^Where:\s*/, "") : "",
    ticketUrl: confirmationUrl,
    calendarUrl: event?.starts_at ? calendarUrl : "",
  });

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    ...message,
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
  const message = buildEventTicketCancelledEmail({
    variant: options.refunded ? "refunded" : "no_refund",
    subject: `Your ticket for ${title} was cancelled`,
    title,
    clientName: ticketRow.contact_name,
    when: whenLine ? whenLine.replace(/^Was scheduled:\s*/, "") : "",
    refundText: refundLine,
  });

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    ...message,
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
  const message = buildEventOpenMicSlotEmail({
    subject: `${title} open mic slot`,
    title,
    performerName,
    eventWhen: eventWhen ? formatDate(eventWhen) : "",
    slot: assignedSlot ? formatDate(assignedSlot) : "",
    duration,
    where: eventLocation,
    eventUrl: showUrl,
  });

  return sendTransactionalEmail(env, {
    to: email,
    ...eventsEmailIdentity(env),
    ...message,
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
      const message = buildEventReminderEmail({
        subject: `Reminder: ${title} is tomorrow`,
        title,
        clientName: row.contact_name,
        when: formatDate(row.event_starts_at),
        where: row.event_location || "",
        seats: String(seats),
        calendarUrl,
      });
      const delivery = await sendTransactionalEmail(env, {
        to: row.contact_email,
        ...eventsEmailIdentity(env),
        ...message,
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

async function sendAppointmentReminder(env, appointmentRow, options = {}) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };
  const resources = clientResourceUrls(env);
  const isVirtual = appointment.bookingTypeId === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID;
  const isBuild = appointment.bookingTypeId === BUILD_SESSION_BOOKING_TYPE_ID || appointment.purpose === "build_session";
  const isConsultation = [IN_PERSON_CONSULTATION_BOOKING_TYPE_ID, VIRTUAL_CONSULTATION_BOOKING_TYPE_ID].includes(appointment.bookingTypeId)
    || ["prerequisite_consultation", "standalone_consultation"].includes(appointment.purpose);
  const isStudio = STUDIO_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId) || appointment.purpose === "studio";
  const isArt = ART_BOOKING_TYPE_IDS.includes(appointment.bookingTypeId);
  const isTattooSpecial = isTattooSpecialAppointment(appointment);
  const occasion = isArt ? "Open Studio Visit" : isStudio ? "studio booking" : isBuild ? "Build session" : isConsultation ? "consultation" : isTattooSpecial ? "Tattoo Special appointment" : "tattoo appointment";
  const brand = isStudio ? "the six.well construct" : "art.pill TATTOO HOUSE";
  const resourceActions = isVirtual || isStudio
    ? []
    : isConsultation || isBuild
      ? [{ label: "Location & parking", href: resources.locationParkingUrl }]
      : [
          { label: "Day-of instructions", href: resources.dayOfInstructionsUrl },
          { label: "Location & parking", href: resources.locationParkingUrl },
        ];
  const message = buildAppointmentReminderEmail({
    kind: isArt ? "studio_visit" : isStudio ? "studio_space" : isVirtual ? "consultation_virtual" : isTattooSpecial ? "tattoo_special" : "tattoo",
    variant: isArt ? "studio_visit" : isStudio ? "studio_space" : isBuild ? "build" : isVirtual ? "virtual" : isConsultation ? "consultation" : isTattooSpecial ? "tattoo_special" : "tattoo",
    subject: `Reminder: Your ${occasion} with ${brand} is tomorrow`,
    occasion,
    brand,
    clientName: appointment.clientName,
    when: `${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    session: isStudio ? studioBookingName(appointment) : tattooSpecialSessionLabel(appointment),
    ...extendedDayEmailFields(appointment),
    zoomUrl: isVirtual ? appointment.meeting?.joinUrl || "" : "",
    zoomStatus: isVirtual && !appointment.meeting?.joinUrl
      ? "Contact the studio if your link has not arrived."
      : "",
    calendarUrl: appointmentCalendarUrl(env, null, appointment),
    resources: resourceActions,
    notice: !isStudio && !isVirtual && !isConsultation && !isBuild
      ? "Your deposit goes toward the final tattoo cost. At the start of your appointment, after the final design, placement, and session price are confirmed, the remaining balance must be paid before tattooing begins. Personalized aftercare instructions will be provided at your appointment."
      : "",
  });
  const identity = isStudio ? eventsEmailIdentity(env) : {};
  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    ...identity,
    ...message,
    templateKey: "appointment_reminder_24h",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: options.idempotencyKey || `appointment_reminder_24h:${appointment.id}`,
  });
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
      const delivery = await sendAppointmentReminder(env, row);
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

export async function retryPendingAdminAppointmentNotifications(env) {
  const db = notificationDb(env);
  if (!db) return { sent: 0, skipped: 0, failed: 0 };

  const retryBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  try {
    const result = await db
      .prepare(
        `SELECT a.*, bt.label AS booking_type_label,
                am.provider AS meeting_provider,
                am.provider_meeting_id,
                am.join_url AS meeting_join_url,
                am.password AS meeting_password,
                am.created_at AS meeting_created_at,
                am.updated_at AS meeting_updated_at,
                nd.idempotency_key AS notification_idempotency_key
         FROM notification_deliveries nd
         JOIN appointments a ON a.id = nd.related_id
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
         WHERE nd.template_key = 'admin_appointment_confirmed'
           AND nd.status IN ('pending', 'failed')
           AND nd.created_at <= ?
           AND a.status = 'confirmed'
         ORDER BY nd.created_at ASC
         LIMIT 25`
      )
      .bind(retryBefore)
      .all();

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of result.results || []) {
      const delivery = await notifyAdminAppointmentConfirmed(env, null, row, {
        idempotencyKey: row.notification_idempotency_key,
      });
      if (delivery.skipped) skipped += 1;
      else if (delivery.ok) sent += 1;
      else failed += 1;
    }
    return { sent, skipped, failed };
  } catch (error) {
    console.warn("Unable to retry pending admin appointment notifications.", error.message);
    return { sent: 0, skipped: 0, failed: 1, error: error.message };
  }
}
