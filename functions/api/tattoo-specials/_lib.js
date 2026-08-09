import { prepareApprovedTattooSpecialRequest } from "../booking/_lib.js";
import {
  bookingTokenFromUrl,
  bookingUrlForToken,
  createBookingRawToken,
} from "../booking-links.js";
import { ingestCrmSourceRecord } from "../crm/ingest.js";
import {
  notifyAdminSubmissionReceived,
  notifySubmissionReceived,
} from "../notifications/_lib.js";

const SPECIAL_TYPE = "tattoo_special";
const SPECIAL_BOOKING_PREFIX = "tattoo_special_";
const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
  });
}

function failure(error, status = 400, extras = {}) {
  return json({ error, ...extras }, { status });
}

function text(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function requireDb(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return env.SUBMISSIONS_DB;
}

async function mirrorTattooSpecialParticipantsToCrm(database, {
  submissionId,
  participants,
  status,
  subject,
  occurredAt,
}) {
  const people = Array.isArray(participants) ? participants : [];
  for (let index = 0; index < people.length; index += 1) {
    const participant = people[index] || {};
    const primary = index === 0;
    const sourceType = primary ? "submission" : "submission_participant";
    const sourceId = primary ? submissionId : `${submissionId}:${index + 1}`;
    try {
      await ingestCrmSourceRecord(database, {
        contact: {
          displayName: participant.name,
          email: participant.email,
          phone: participant.phone,
        },
        interaction: {
          sourceProvider: "local",
          sourceType,
          sourceId,
          nodeId: "node-tattoos",
          channel: "website",
          interactionType: primary ? "tattoo_special" : "tattoo_special_participant",
          label: primary ? subject : `${subject} participant`,
          status,
          occurredAt,
          metadata: { submissionId, participantIndex: index },
        },
      });
    } catch (error) {
      console.warn(JSON.stringify({
        event: "crm.live_mirror_failed",
        sourceType,
        sourceId,
        errorName: error?.name || "Error",
      }));
    }
  }
}

function adminError(request, env) {
  const expected = env.SUBMISSIONS_ADMIN_TOKEN;
  if (!expected) return failure("Admin submissions are not configured.", 503);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : new URL(request.url).searchParams.get("token") || "";
  return supplied === expected ? null : failure("Unauthorized.", 401);
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function windowState(settings, nowMs = Date.now()) {
  if (!settings || Number(settings.enabled) !== 1) return "closed";
  const opens = new Date(settings.sales_opens_at).getTime();
  const closes = new Date(settings.sales_closes_at).getTime();
  if (nowMs < opens) return "scheduled";
  if (nowMs >= closes) return "closed";
  return "open";
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function easternDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function durationLabel(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hours`;
}

function isAtLeastEighteen(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(dateValue, 10));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  let age = parts.year - year;
  if (parts.month < month || (parts.month === month && parts.day < day)) age -= 1;
  return age >= 18;
}

function mediaUrl(row) {
  if (!row) return "";
  return row.source_url || (row.storage_key ? `/api/construct/media/${encodeURIComponent(row.id)}` : "");
}

async function loadSettings(db) {
  return db.prepare(
    `SELECT s.*, m.source_url, m.storage_key, m.original_filename, m.mime_type, m.alt_text,
            m.state AS media_state, m.privacy AS media_privacy,
            m.consent_status AS media_consent_status, m.public_presentation AS media_presentation
     FROM tattoo_special_settings s
     LEFT JOIN media_assets m ON m.id = s.artwork_media_id
     WHERE s.id = 'default'`
  ).first();
}

async function loadCampaigns(db, includeArchived = true) {
  const rows = (await db.prepare(
    `SELECT c.*, m.source_url, m.storage_key, m.original_filename, m.mime_type, m.alt_text,
            m.state AS media_state, m.privacy AS media_privacy,
            m.consent_status AS media_consent_status, m.public_presentation AS media_presentation
     FROM tattoo_special_campaigns c
     LEFT JOIN media_assets m ON m.id = c.artwork_media_id
     ${includeArchived ? "" : "WHERE c.archived_at IS NULL"}
     ORDER BY c.is_public DESC, c.sort_order, c.sales_opens_at DESC, c.created_at DESC`
  ).all()).results || [];
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    state: windowState(row),
    enabled: Boolean(row.enabled),
    isPublic: Boolean(row.is_public),
    archivedAt: row.archived_at || "",
    timezone: row.timezone || "America/New_York",
    salesOpensAt: row.sales_opens_at || "",
    salesClosesAt: row.sales_closes_at || "",
    defaultDepositCents: Number(row.default_deposit_cents || 0),
    defaultDeposit: money(Number(row.default_deposit_cents || 0)),
    sortOrder: Number(row.sort_order || 0),
    artwork: row.artwork_media_id ? {
      mediaId: row.artwork_media_id,
      url: mediaUrl(row),
      alt: row.alt_text || "Tattoo Specials artwork",
      filename: row.original_filename || "",
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function loadPublishedCampaign(db) {
  return db.prepare(
    `SELECT c.*, m.source_url, m.storage_key, m.original_filename, m.mime_type, m.alt_text
     FROM tattoo_special_campaigns c
     LEFT JOIN media_assets m ON m.id = c.artwork_media_id
     WHERE c.is_public = 1 AND c.archived_at IS NULL
     LIMIT 1`
  ).first();
}

async function loadOffers(db, includeInactive = false, campaignId = "") {
  const where = includeInactive
    ? "WHERE 1 = 1"
    : "WHERE o.active = 1 AND o.archived_at IS NULL";
  const statement = db.prepare(
    `SELECT o.id, o.slug, o.title, o.active, o.archived_at, o.sort_order, o.current_version_id,
            o.campaign_id, o.created_at, o.updated_at,
            v.version_number, v.public_description, v.duration_minutes, v.booking_mode,
            v.reference_requirement, v.participant_count, v.deposit_cents, v.booking_type_id,
            v.max_word_count,
            v.created_at AS version_created_at
     FROM tattoo_special_offers o
     JOIN tattoo_special_offer_versions v ON v.id = o.current_version_id
     ${where}
     ${campaignId ? "AND o.campaign_id = ?" : ""}
     ORDER BY o.sort_order, o.created_at`
  );
  const rows = (await (campaignId ? statement.bind(campaignId) : statement).all()).results || [];
  if (!rows.length) return [];
  const versionIds = rows.map((row) => row.current_version_id);
  const variants = (await db.prepare(
    `SELECT * FROM tattoo_special_offer_variants
     WHERE offer_version_id IN (${versionIds.map(() => "?").join(",")})
     ORDER BY sort_order, created_at`
  ).bind(...versionIds).all()).results || [];
  const byVersion = new Map();
  for (const variant of variants) {
    if (!byVersion.has(variant.offer_version_id)) byVersion.set(variant.offer_version_id, []);
    byVersion.get(variant.offer_version_id).push({
      id: variant.id,
      label: variant.label,
      priceCents: Number(variant.price_cents),
      price: money(Number(variant.price_cents)),
      sortOrder: Number(variant.sort_order),
    });
  }
  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id || "",
    slug: row.slug,
    title: row.title,
    active: Boolean(row.active),
    archivedAt: row.archived_at || "",
    sortOrder: Number(row.sort_order),
    versionId: row.current_version_id,
    versionNumber: Number(row.version_number),
    description: row.public_description,
    durationMinutes: Number(row.duration_minutes),
    duration: durationLabel(Number(row.duration_minutes)),
    mode: row.booking_mode,
    referenceRequirement: row.reference_requirement,
    participantCount: Number(row.participant_count),
    maxWordCount: Number(row.max_word_count || 0),
    depositCents: Number(row.deposit_cents),
    bookingTypeId: row.booking_type_id,
    variants: byVersion.get(row.current_version_id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function loadOfferMetrics(db) {
  const rows = (await db.prepare(
    `WITH per_submission AS (
       SELECT t.offer_id,
              t.submission_id,
              MAX(CASE
                WHEN dp.status = 'paid' OR a.status IN ('confirmed','completed') THEN 1
                ELSE 0
              END) AS booked,
              MAX(CASE
                WHEN a.status IN ('pending_deposit','deposit_pending') AND a.hold_state = 'active' THEN 1
                WHEN s.status='approved' AND EXISTS (
                  SELECT 1 FROM booking_tokens bt
                  WHERE bt.submission_id=t.submission_id
                    AND bt.revoked_at IS NULL AND bt.used_at IS NULL
                    AND (bt.expires_at IS NULL OR bt.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ) THEN 1
                ELSE 0
              END) AS awaiting_deposit,
              MAX(CASE
                WHEN dp.status = 'paid'
                  AND a.cancelled_at IS NOT NULL
                  AND a.replaced_by_appointment_id IS NULL THEN 1
                ELSE 0
              END) AS cancelled
       FROM tattoo_special_submission_terms t
       JOIN submissions s ON s.id=t.submission_id
       LEFT JOIN appointments a ON a.submission_id = t.submission_id
       LEFT JOIN deposit_payments dp ON dp.appointment_id = a.id
       GROUP BY t.offer_id, t.submission_id
     )
     SELECT offer_id,
            COUNT(*) AS requests,
            SUM(CASE WHEN booked = 0 AND awaiting_deposit = 1 THEN 1 ELSE 0 END) AS awaiting_deposit,
            SUM(booked) AS booked,
            SUM(cancelled) AS cancelled
     FROM per_submission
     GROUP BY offer_id`
  ).all()).results || [];
  return new Map(rows.map((row) => {
    const requests = Number(row.requests || 0);
    const booked = Number(row.booked || 0);
    return [row.offer_id, {
      requests,
      awaitingDeposit: Number(row.awaiting_deposit || 0),
      booked,
      cancelled: Number(row.cancelled || 0),
      conversionPercent: requests ? Math.round((booked / requests) * 100) : 0,
    }];
  }));
}

function publicSettings(settings, state) {
  return {
    campaignId: settings?.id || "",
    campaignTitle: settings?.title || "",
    state,
    enabled: Boolean(settings?.enabled),
    timezone: settings?.timezone || "America/New_York",
    salesOpensAt: settings?.sales_opens_at || "",
    salesClosesAt: settings?.sales_closes_at || "",
    defaultDepositCents: Number(settings?.default_deposit_cents || 0),
    defaultDeposit: money(Number(settings?.default_deposit_cents || 0)),
    artwork: settings?.artwork_media_id ? {
      mediaId: settings.artwork_media_id,
      url: mediaUrl(settings),
      alt: settings.alt_text || "Tattoo Specials artwork",
      filename: settings.original_filename || "",
    } : null,
    normalInquiryUrl: "/tattoos/inquire/",
  };
}

export async function handlePublicTattooSpecials(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  try {
    const db = requireDb(env);
    const settings = await loadPublishedCampaign(db);
    const state = windowState(settings);
    return json({
      ...publicSettings(settings, state),
      offers: state === "open" ? await loadOffers(db, false, settings.id) : [],
    });
  } catch (error) {
    return failure("Unable to load Tattoo Specials.", 500, { detail: error.message });
  }
}

async function readMultipart(request) {
  let form;
  try { form = await request.formData(); } catch { return { error: "Expected multipart form data." }; }
  const fields = {};
  const files = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
    else files.push({ fieldName: key, file: value });
  }
  return { fields, files };
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value, 320));
}

function validateReferenceFiles(files) {
  for (const entry of files) {
    if (!String(entry.file.type || "").startsWith("image/")) return "Reference files must be images.";
    if (Number(entry.file.size || 0) > MAX_REFERENCE_BYTES) return "Each reference image must be 15 MB or smaller.";
  }
  return "";
}

async function saveFiles(env, submissionId, files) {
  const saved = [];
  for (const entry of files) {
    const id = crypto.randomUUID();
    const safeName = text(entry.file.name || "reference", 200).replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `submissions/${submissionId}/${id}-${safeName}`;
    let stored = false;
    if (env.SUBMISSION_FILES) {
      await env.SUBMISSION_FILES.put(key, entry.file.stream(), {
        httpMetadata: { contentType: entry.file.type || "application/octet-stream" },
        customMetadata: { submissionId, fieldName: entry.fieldName, originalName: entry.file.name || safeName },
      });
      stored = true;
    }
    saved.push({
      id,
      fieldName: entry.fieldName,
      fileName: entry.file.name || safeName,
      contentType: entry.file.type || "application/octet-stream",
      size: Number(entry.file.size || 0),
      storageKey: stored ? key : null,
      stored,
    });
  }
  return saved;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createBookingAccess(db, request, submissionId, terms, closesAt) {
  const token = createBookingRawToken();
  const tokenId = crypto.randomUUID();
  const now = new Date().toISOString();
  const bookingUrl = bookingUrlForToken(new URL(request.url).origin, token);
  await db.batch([
    db.prepare(
      `INSERT INTO booking_tokens
       (id, token_hash, submission_id, allowed_booking_types_json, purpose, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tattoo', ?, ?, ?)`
    ).bind(tokenId, await sha256(token), submissionId, JSON.stringify([terms.booking_type_id]), closesAt, now, now),
    db.prepare("UPDATE submissions SET booking_url = ?, updated_at = ? WHERE id = ?")
      .bind(bookingUrl.pathname + bookingUrl.search, now, submissionId),
    db.prepare(
      `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
       VALUES (?, ?, 'special_request_link_created', 'system', ?, ?)`
    ).bind(crypto.randomUUID(), submissionId, `Tattoo Special request-time selection · ${terms.offer_title} · expires at sales close`, now),
  ]);
  return { id: tokenId, rawToken: token, bookingUrl: bookingUrl.pathname + bookingUrl.search, purpose: "tattoo", expiresAt: closesAt, allowedBookingTypes: [terms.booking_type_id] };
}

function absoluteClientBookingUrl(request, env, pathOrUrl) {
  const base = env.PUBLIC_SITE_URL || new URL(request.url).origin;
  return new URL(pathOrUrl, base).toString();
}

async function activePreparedAccess(db, submissionId, bookingUrl) {
  let token = "";
  try {
    token = bookingTokenFromUrl(bookingUrl);
  } catch {
    return null;
  }
  if (!token) return null;
  return db.prepare(
    `SELECT bt.id,bt.expires_at FROM booking_tokens bt
     JOIN submissions s ON s.id = bt.submission_id
     WHERE bt.submission_id = ? AND bt.token_hash = ? AND s.status='approved'
       AND bt.revoked_at IS NULL AND bt.used_at IS NULL
       AND (bt.expires_at IS NULL OR bt.expires_at > ?)
     LIMIT 1`
  ).bind(submissionId, await sha256(token), new Date().toISOString()).first();
}

async function prepareTattooSpecialClientAccess(db, request, env, submission, preparedRequest) {
  const currentAccess = submission.booking_url
    ? await activePreparedAccess(db, submission.id, submission.booking_url)
    : null;
  if (currentAccess) {
    return {
      id: currentAccess.id,
      path: submission.booking_url,
      bookingUrl: absoluteClientBookingUrl(request, env, submission.booking_url),
      existing: true,
    };
  }

  const terms = await db.prepare(
    "SELECT booking_type_id,sales_closes_at FROM tattoo_special_submission_terms WHERE submission_id=?"
  ).bind(submission.id).first();
  if (!terms?.booking_type_id) throw new Error("Tattoo Special booking terms are missing.");
  const now = new Date().toISOString();
  const expiryMs = Math.min(
    new Date(preparedRequest.paymentDueAt).getTime(),
    new Date(terms.sales_closes_at).getTime(),
  );
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    throw new Error("The Tattoo Special deposit access window has closed.");
  }
  const expiresAt = new Date(expiryMs).toISOString();
  const token = createBookingRawToken();
  const tokenId = crypto.randomUUID();
  const bookingUrl = bookingUrlForToken(env.PUBLIC_SITE_URL || new URL(request.url).origin, token);
  const path = bookingUrl.pathname + bookingUrl.search;
  const statements = [
    db.prepare(
      `INSERT INTO booking_tokens
       (id,token_hash,submission_id,allowed_booking_types_json,purpose,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      tokenId,
      await sha256(token),
      submission.id,
      JSON.stringify([terms.booking_type_id]),
      "tattoo",
      expiresAt,
      now,
      now,
    ),
    db.prepare(
      `UPDATE booking_tokens SET revoked_at=COALESCE(revoked_at,?),updated_at=?
       WHERE submission_id=? AND id<>? AND used_at IS NULL`
    ).bind(now, now, submission.id, tokenId),
    db.prepare(
      `UPDATE submissions SET booking_url=?,updated_at=?
       WHERE id=? AND status='approved'
         AND EXISTS (SELECT 1 FROM booking_tokens WHERE id=? AND submission_id=?)`
    ).bind(path, now, submission.id, tokenId, submission.id),
    db.prepare(
      `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
       SELECT ?,?,'booking_link_created','admin',?,?
       WHERE EXISTS (SELECT 1 FROM booking_tokens WHERE id=? AND submission_id=?)`
    ).bind(crypto.randomUUID(), submission.id, `tattoo_special_deposit:${preparedRequest.appointment?.id || "approval-first"}:${tokenId}`, now, tokenId, submission.id),
  ];
  if (preparedRequest.appointment?.id) {
    statements.push(db.prepare(
      `UPDATE appointments SET booking_token_id=?,updated_at=?
       WHERE id=? AND submission_id=? AND status='requested'
         AND hold_state IS NULL AND approval_state='approved'
         AND EXISTS (SELECT 1 FROM booking_tokens WHERE id=?)`
    ).bind(tokenId, now, preparedRequest.appointment.id, submission.id, tokenId));
  }
  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes || 0) < 1 || Number(results?.[2]?.meta?.changes || 0) < 1) {
    throw new Error("The prepared deposit could not be attached to new client access.");
  }
  return {
    id: tokenId,
    path,
    bookingUrl: bookingUrl.toString(),
    existing: false,
  };
}

async function selectedTerms(db, offerId, variantId, campaignId) {
  return db.prepare(
    `SELECT o.id AS offer_id, o.title AS offer_title, o.current_version_id,
            c.id AS campaign_id, c.title AS campaign_title, c.sales_closes_at,
            v.id AS offer_version_id, v.duration_minutes, v.booking_mode,
            v.reference_requirement, v.participant_count, v.deposit_cents, v.booking_type_id,
            v.max_word_count,
            p.id AS variant_id, p.label AS variant_label, p.price_cents
     FROM tattoo_special_offers o
     JOIN tattoo_special_campaigns c ON c.id = o.campaign_id
     JOIN tattoo_special_offer_versions v ON v.id = o.current_version_id
     JOIN tattoo_special_offer_variants p ON p.offer_version_id = v.id
     WHERE o.id = ? AND p.id = ? AND o.campaign_id = ?
       AND c.is_public = 1 AND c.enabled = 1 AND c.archived_at IS NULL
       AND o.active = 1 AND o.archived_at IS NULL`
  ).bind(offerId, variantId, campaignId).first();
}

export async function handleCreateTattooSpecialSubmission(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readMultipart(request);
  if (body.error) return failure(body.error, 400);
  const fields = body.fields;
  try {
    const db = requireDb(env);
    const settings = await loadPublishedCampaign(db);
    if (windowState(settings) !== "open") return failure("Tattoo Specials are not currently accepting payments.", 409, { code: "SPECIALS_WINDOW_CLOSED" });
    const terms = await selectedTerms(db, text(fields.offerId, 200), text(fields.variantId, 200), settings.id);
    if (!terms) return failure("That Tattoo Special is unavailable. Refresh and choose again.", 409);

    const primary = {
      name: text(fields.name, 160), email: text(fields.email, 320).toLowerCase(), phone: text(fields.phone, 80), dob: text(fields.dob, 10),
    };
    if (!primary.name) return failure("Enter the primary purchaser's full name.", 400, { field: "name" });
    if (!primary.email) return failure("Enter the primary purchaser's email address.", 400, { field: "email" });
    if (!validEmail(primary.email)) return failure("Enter a complete email address for the primary purchaser, such as name@example.com.", 400, { field: "email" });
    if (!primary.phone) return failure("Enter the primary purchaser's phone number.", 400, { field: "phone" });
    if (!isAtLeastEighteen(primary.dob)) return failure("Enter a valid date of birth confirming the primary participant is at least 18.", 400, { field: "dob" });
    if (text(fields.ageConfirmed).toLowerCase() !== "yes") return failure("The primary participant must confirm they are at least 18.", 400);
    const placement = text(fields.placement, 500);
    const projectDetails = text(fields.projectDetails, 5000);
    if (!placement || !projectDetails) return failure("Placement and project details are required.", 400);
    const scriptText = text(fields.scriptText, 500);
    const maxWordCount = Number(terms.max_word_count || 0);
    if (maxWordCount > 0) {
      if (!scriptText) return failure("Enter the script text for this Tattoo Special.", 400, { field: "scriptText" });
      const wordCount = scriptText.split(/\s+/).filter(Boolean).length;
      if (wordCount > maxWordCount) {
        return failure(`Keep the script to ${maxWordCount} words or fewer.`, 400, { field: "scriptText", maxWordCount });
      }
    }
    const fileError = validateReferenceFiles(body.files);
    if (fileError) return failure(fileError, 400);
    const referenceLink = text(fields.referenceLink, 1000);
    const utm = text(fields.utm, 500);
    const foundVia = text(fields.foundVia, 120);
    if (terms.reference_requirement === "required" && !body.files.length && !referenceLink) {
      return failure("This Tattoo Special requires at least one reference image or reference link.", 400);
    }
    let secondary = null;
    if (Number(terms.participant_count) === 2) {
      const secondaryInput = {
        name: text(fields.participant2Name, 160),
        email: text(fields.participant2Email, 320).toLowerCase(),
        phone: text(fields.participant2Phone, 80),
        dob: text(fields.participant2Dob, 10),
        ageConfirmed: text(fields.participant2AgeConfirmed).toLowerCase() === "yes",
      };
      const secondaryStarted = Boolean(secondaryInput.name || secondaryInput.email || secondaryInput.phone || secondaryInput.dob || secondaryInput.ageConfirmed);
      if (secondaryStarted) {
        if (!secondaryInput.name) return failure("Enter the second adult participant's full name.", 400, { field: "participant2Name" });
        if (!secondaryInput.email) return failure("Enter the second adult participant's email address.", 400, { field: "participant2Email" });
        if (!validEmail(secondaryInput.email)) return failure("Enter a complete email address for the second adult participant, such as name@example.com.", 400, { field: "participant2Email" });
        if (!secondaryInput.phone) return failure("Enter the second adult participant's phone number.", 400, { field: "participant2Phone" });
        if (!isAtLeastEighteen(secondaryInput.dob)) return failure("Enter a valid date of birth confirming the second participant is at least 18.", 400, { field: "participant2Dob" });
        if (!secondaryInput.ageConfirmed) return failure("The second participant must confirm they are at least 18.", 400);
        secondary = { name: secondaryInput.name, email: secondaryInput.email, phone: secondaryInput.phone, dob: secondaryInput.dob };
      }
    }

    const idempotencyKey = text(request.headers.get("idempotency-key") || fields.idempotencyKey, 200);
    if (!idempotencyKey) return failure("An idempotency key is required.", 400);
    const existing = await db.prepare("SELECT id, booking_url, status, subject, payload_json, created_at FROM submissions WHERE idempotency_key = ?").bind(idempotencyKey).first();
    if (existing) {
      const existingPayload = JSON.parse(existing.payload_json || "{}");
      await mirrorTattooSpecialParticipantsToCrm(db, {
        submissionId: existing.id,
        participants: existingPayload.participants,
        status: existing.status,
        subject: existing.subject || "Tattoo Special",
        occurredAt: existing.created_at,
      });
      return json({
        ok: true,
        idempotent: true,
        submissionId: existing.id,
        bookingUrl: existing.booking_url || "",
        reviewRequired: existingPayload.booking_mode === "review",
        receipt: existingPayload.booking_mode === "review"
          ? "Thanks for sending this in. A follow-up will arrive soon."
          : "Your private booking link is ready.",
      });
    }

    const submissionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const direct = terms.booking_mode === "direct";
    const savedFiles = await saveFiles(env, submissionId, body.files);
    const participants = [primary, ...(secondary ? [secondary] : [])];
    const payload = {
      campaign: "Tattoo Special",
      special_campaign_id: terms.campaign_id,
      special_campaign_title: terms.campaign_title,
      special_offer_id: terms.offer_id,
      special_offer_version_id: terms.offer_version_id,
      special_offer_title: terms.offer_title,
      special_variant_id: terms.variant_id,
      special_variant_label: terms.variant_label,
      quoted_price_cents: Number(terms.price_cents),
      approved_price_cents: direct ? Number(terms.price_cents) : null,
      deposit_cents: Number(terms.deposit_cents),
      duration_minutes: Number(terms.duration_minutes),
      booking_mode: terms.booking_mode,
      booking_type_id: terms.booking_type_id,
      sales_closes_at: terms.sales_closes_at,
      placement,
      project_details: projectDetails,
      script_text: scriptText,
      max_word_count: maxWordCount || null,
      reference_link: referenceLink,
      utm: utm || null,
      found_via: foundVia || null,
      participants,
      primary_participant_index: 0,
      automated_messages_recipient: primary.email,
      dob: primary.dob,
      age_confirmed: "yes",
      policy_accepted: "yes",
      transactional_messages_accepted: "yes",
    };
    const contact = { name: primary.name, email: primary.email, phone: primary.phone, participants };
    await db.batch([
      db.prepare(
        `INSERT INTO submissions
         (id, type, status, source_path, subject, contact_name, contact_email, contact_phone,
          contact_json, payload_json, request_meta_json, files_json, tattoo_stage, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, '/tattoos/specials/', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        submissionId, SPECIAL_TYPE, direct ? "approved" : "new", `Tattoo Special · ${terms.offer_title}`,
        primary.name, primary.email, primary.phone, JSON.stringify(contact), JSON.stringify(payload),
        JSON.stringify({ campaign: "Tattoo Special", userAgent: request.headers.get("user-agent") || "" }),
        JSON.stringify(savedFiles), direct ? "ready_to_book" : "review", idempotencyKey, now, now,
      ),
      db.prepare(
        `INSERT INTO tattoo_special_submission_terms
         (submission_id, campaign_id, campaign_title, offer_id, offer_version_id, variant_id, offer_title, variant_label,
          advertised_price_cents, approved_price_cents, deposit_cents, duration_minutes,
          booking_mode, booking_type_id, sales_closes_at, participant_count, review_outcome,
          max_word_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        submissionId, terms.campaign_id, terms.campaign_title, terms.offer_id, terms.offer_version_id, terms.variant_id, terms.offer_title,
        terms.variant_label, terms.price_cents, direct ? terms.price_cents : null, terms.deposit_cents,
        terms.duration_minutes, terms.booking_mode, terms.booking_type_id, terms.sales_closes_at,
        terms.participant_count, direct ? "approved" : "pending", maxWordCount || null, now, now,
      ),
      db.prepare(
        `INSERT INTO tattoo_session_plans
         (id, submission_id, estimated_sessions_min, estimated_sessions_max,
          estimated_total_minutes_min, estimated_total_minutes_max, split_policy, session_category,
          artist_note, approved_budget_min_cents, approved_budget_max_cents, approved_budget_currency,
          created_at, updated_at)
         VALUES (?, ?, 1, 1, ?, ?, 'not_available', 'one_session', ?, ?, ?, 'USD', ?, ?)`
      ).bind(
        crypto.randomUUID(), submissionId, terms.duration_minutes, terms.duration_minutes,
        `${terms.offer_title} · ${terms.variant_label} · Tattoo Special`, terms.price_cents, terms.price_cents, now, now,
      ),
      db.prepare(
        `INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at)
         VALUES (?, ?, 'created', 'system', ?, ?)`
      ).bind(crypto.randomUUID(), submissionId, `Tattoo Special · ${terms.offer_title} · ${terms.variant_label}`, now),
    ]);

    await mirrorTattooSpecialParticipantsToCrm(db, {
      submissionId,
      participants,
      status: direct ? "approved" : "new",
      subject: `Tattoo Special · ${terms.offer_title}`,
      occurredAt: now,
    });

    const createdSubmission = await db.prepare("SELECT * FROM submissions WHERE id=?").bind(submissionId).first();
    await Promise.allSettled([
      notifySubmissionReceived(env, createdSubmission),
      notifyAdminSubmissionReceived(env, createdSubmission),
    ]);
    const token = direct
      ? await createBookingAccess(db, request, submissionId, terms, terms.sales_closes_at)
      : null;
    return json({
      ok: true,
      submissionId,
      reviewRequired: !direct,
      bookingUrl: token?.bookingUrl || "",
      receipt: direct ? "Your private booking link is ready." : "Thanks for sending this in. A follow-up will arrive soon.",
    }, { status: 201 });
  } catch (error) {
    if (String(error.message || error).includes("UNIQUE constraint failed: submissions.idempotency_key")) {
      return failure("This request was already submitted. Refresh before trying again.", 409);
    }
    return failure("Unable to create the Tattoo Special request.", 500, { detail: error.message });
  }
}

async function adminPayload(db) {
  const campaigns = await loadCampaigns(db, true);
  const publishedRow = await loadPublishedCampaign(db);
  const settings = publishedRow ? publicSettings(publishedRow, windowState(publishedRow)) : publicSettings(null, "closed");
  const offers = await loadOffers(db, true);
  const metricsByOffer = await loadOfferMetrics(db);
  const media = (await db.prepare(
    `SELECT id, source_url, storage_key, original_filename, mime_type, alt_text, public_title
     FROM media_assets
     WHERE state = 'active' AND privacy = 'public' AND public_presentation = 'inline'
       AND consent_status IN ('not-required','granted') AND mime_type LIKE 'image/%'
     ORDER BY created_at DESC LIMIT 250`
  ).all()).results || [];
  return {
    settings,
    campaigns,
    offers: offers.map((offer) => ({
      ...offer,
      metrics: metricsByOffer.get(offer.id) || {
        requests: 0,
        awaitingDeposit: 0,
        booked: 0,
        cancelled: 0,
        conversionPercent: 0,
      },
    })),
    media: media.map((row) => ({ id: row.id, url: mediaUrl(row), filename: row.original_filename, alt: row.alt_text, title: row.public_title })),
    readiness: {
      database: true,
      artwork: Boolean(publishedRow?.artwork_media_id && mediaUrl(publishedRow)),
      activeOffers: publishedRow ? (await loadOffers(db, false, publishedRow.id)).length : 0,
      salesWindowValid: Boolean(publishedRow && new Date(publishedRow.sales_opens_at).getTime() < new Date(publishedRow.sales_closes_at).getTime()),
    },
  };
}

export async function handleAdminTattooSpecials(request, env) {
  const auth = adminError(request, env);
  if (auth) return auth;
  try {
    const db = requireDb(env);
    if (request.method === "GET") return json(await adminPayload(db));
    if (request.method !== "PATCH") return failure("Method not allowed.", 405);
    const body = await readJson(request);
    if (!body) return failure("Expected JSON body.", 400);
    const current = await loadPublishedCampaign(db);
    if (!current) return failure("Publish a Tattoo Specials campaign before editing public settings.", 409);
    const opensAt = text(body.salesOpensAt || current.sales_opens_at, 80);
    const closesAt = text(body.salesClosesAt || current.sales_closes_at, 80);
    if (!Number.isFinite(new Date(opensAt).getTime()) || !Number.isFinite(new Date(closesAt).getTime()) || new Date(opensAt) >= new Date(closesAt)) {
      return failure("Enter a valid sales opening and closing time.", 400);
    }
    const deposit = body.defaultDepositCents === undefined ? Number(current.default_deposit_cents) : integer(body.defaultDepositCents, -1);
    if (deposit < 0) return failure("Default deposit must be zero or greater.", 400);
    const mediaId = body.artworkMediaId === undefined ? current.artwork_media_id : text(body.artworkMediaId, 200) || null;
    if (mediaId) {
      const eligible = await db.prepare(
        `SELECT id FROM media_assets WHERE id = ? AND state = 'active' AND privacy = 'public'
         AND public_presentation = 'inline' AND consent_status IN ('not-required','granted') AND mime_type LIKE 'image/%'`
      ).bind(mediaId).first();
      if (!eligible) return failure("Choose a public, active, inline image from Shared Media.", 409);
    }
    await db.prepare(
      `UPDATE tattoo_special_campaigns SET sales_opens_at = ?, sales_closes_at = ?,
       default_deposit_cents = ?, artwork_media_id = ?, enabled = ?, updated_at = ? WHERE id = ?`
    ).bind(opensAt, closesAt, deposit, mediaId, body.enabled === undefined ? Number(current.enabled) : (body.enabled ? 1 : 0), new Date().toISOString(), current.id).run();
    return json(await adminPayload(db));
  } catch (error) {
    return failure("Unable to update Tattoo Specials settings.", 500, { detail: error.message });
  }
}

function campaignSlug(value) {
  return text(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCampaignInput(body, current = {}) {
  const title = text(body.title === undefined ? current.title : body.title, 200);
  const slug = campaignSlug(body.slug === undefined ? (current.slug || title) : body.slug);
  const opensAt = text(body.salesOpensAt === undefined ? current.sales_opens_at : body.salesOpensAt, 80);
  const closesAt = text(body.salesClosesAt === undefined ? current.sales_closes_at : body.salesClosesAt, 80);
  const deposit = body.defaultDepositCents === undefined
    ? Number(current.default_deposit_cents ?? 5000)
    : integer(body.defaultDepositCents, -1);
  if (!title || !slug) return { error: "Campaign title and slug are required." };
  if (!Number.isFinite(new Date(opensAt).getTime()) || !Number.isFinite(new Date(closesAt).getTime()) || new Date(opensAt) >= new Date(closesAt)) {
    return { error: "Enter a valid campaign sales opening and closing time." };
  }
  if (deposit < 0) return { error: "Default deposit must be zero or greater." };
  return {
    title,
    slug,
    opensAt,
    closesAt,
    timezone: text(body.timezone === undefined ? (current.timezone || "America/New_York") : body.timezone, 80) || "America/New_York",
    deposit,
    artworkMediaId: body.artworkMediaId === undefined ? (current.artwork_media_id || null) : (text(body.artworkMediaId, 200) || null),
    enabled: body.enabled === undefined ? Boolean(current.enabled ?? true) : Boolean(body.enabled),
    isPublic: body.isPublic === undefined ? Boolean(current.is_public) : Boolean(body.isPublic),
    sortOrder: integer(body.sortOrder, Number(current.sort_order || 0)),
  };
}

async function validateCampaignArtwork(db, mediaId) {
  if (!mediaId) return true;
  return Boolean(await db.prepare(
    `SELECT id FROM media_assets WHERE id = ? AND state = 'active' AND privacy = 'public'
     AND public_presentation = 'inline' AND consent_status IN ('not-required','granted') AND mime_type LIKE 'image/%'`
  ).bind(mediaId).first());
}

export async function handleAdminTattooSpecialCampaign(request, env, campaignId = "") {
  const auth = adminError(request, env);
  if (auth) return auth;
  try {
    const db = requireDb(env);
    if (request.method === "POST" && !campaignId) {
      const body = await readJson(request);
      const input = normalizeCampaignInput(body || {});
      if (input.error) return failure(input.error, 400);
      if (!await validateCampaignArtwork(db, input.artworkMediaId)) return failure("Choose a public, active, inline image from Shared Media.", 409);
      const id = `campaign-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const statements = [];
      if (input.isPublic) statements.push(db.prepare("UPDATE tattoo_special_campaigns SET is_public = 0, updated_at = ? WHERE is_public = 1").bind(now));
      statements.push(db.prepare(
        `INSERT INTO tattoo_special_campaigns
         (id, slug, title, sales_opens_at, sales_closes_at, timezone, default_deposit_cents,
          artwork_media_id, enabled, is_public, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, input.slug, input.title, input.opensAt, input.closesAt, input.timezone, input.deposit,
        input.artworkMediaId, input.enabled ? 1 : 0, input.isPublic ? 1 : 0, input.sortOrder, now, now));
      await db.batch(statements);
      return json(await adminPayload(db), { status: 201 });
    }
    const current = campaignId
      ? await db.prepare("SELECT * FROM tattoo_special_campaigns WHERE id = ?").bind(campaignId).first()
      : null;
    if (!current) return failure("Tattoo Specials campaign not found.", 404);
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const input = normalizeCampaignInput(body || {}, current);
      if (input.error) return failure(input.error, 400);
      if (!await validateCampaignArtwork(db, input.artworkMediaId)) return failure("Choose a public, active, inline image from Shared Media.", 409);
      const now = new Date().toISOString();
      const statements = [];
      if (input.isPublic) statements.push(db.prepare("UPDATE tattoo_special_campaigns SET is_public = 0, updated_at = ? WHERE is_public = 1 AND id <> ?").bind(now, campaignId));
      statements.push(db.prepare(
        `UPDATE tattoo_special_campaigns SET slug = ?, title = ?, sales_opens_at = ?, sales_closes_at = ?,
         timezone = ?, default_deposit_cents = ?, artwork_media_id = ?, enabled = ?, is_public = ?,
         archived_at = NULL, sort_order = ?, updated_at = ? WHERE id = ?`
      ).bind(input.slug, input.title, input.opensAt, input.closesAt, input.timezone, input.deposit,
        input.artworkMediaId, input.enabled ? 1 : 0, input.isPublic ? 1 : 0, input.sortOrder, now, campaignId));
      await db.batch(statements);
      return json(await adminPayload(db));
    }
    if (request.method === "DELETE") {
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE tattoo_special_campaigns SET enabled = 0, is_public = 0, archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, campaignId),
        db.prepare("UPDATE tattoo_special_offers SET active = 0, archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE campaign_id = ?").bind(now, now, campaignId),
      ]);
      return json({ ...(await adminPayload(db)), archived: true });
    }
    return failure("Method not allowed.", 405);
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes("UNIQUE constraint failed: tattoo_special_campaigns.slug")) return failure("That campaign slug is already in use.", 409);
    return failure("Unable to save the Tattoo Specials campaign.", 500, { detail: error.message });
  }
}

function normalizeOfferInput(body, defaultDeposit, campaignId) {
  const title = text(body.title, 200);
  const slug = text(body.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 160);
  const duration = integer(body.durationMinutes, -1);
  const mode = "review";
  const reference = text(body.referenceRequirement || "optional", 20);
  const participants = integer(body.participantCount, 1);
  const maxWordCount = integer(body.maxWordCount, 0);
  const deposit = body.depositCents === undefined ? defaultDeposit : integer(body.depositCents, -1);
  const variants = Array.isArray(body.variants) ? body.variants.map((variant, index) => ({
    label: text(variant.label, 100), priceCents: integer(variant.priceCents, -1), sortOrder: integer(variant.sortOrder, (index + 1) * 10),
  })) : [];
  if (!campaignId) return { error: "Choose a campaign for this Tattoo Special." };
  if (!title || !slug) return { error: "A Tattoo Special title and slug are required." };
  if (duration <= 0 || duration % 30 !== 0) return { error: "Duration must use 30-minute increments." };
  if (!new Set(["optional", "required"]).has(reference)) return { error: "Reference requirement must be optional or required." };
  if (![1, 2].includes(participants)) return { error: "Participant count must be one or two." };
  if (maxWordCount < 0 || maxWordCount > 100) return { error: "Maximum word count must be between 1 and 100, or left blank." };
  if (deposit < 0) return { error: "Deposit must be zero or greater." };
  if (!variants.length || variants.some((variant) => !variant.label || variant.priceCents <= 0)) return { error: "Add at least one valid price variant." };
  return { campaignId, title, slug, description: text(body.description, 3000), duration, mode, reference, participants, maxWordCount, deposit, variants, active: body.active !== false, sortOrder: integer(body.sortOrder, 0) };
}

async function insertOfferVersion(db, offer, input, versionNumber, now) {
  const versionId = `${offer.id}-v${versionNumber}`;
  const bookingTypeId = `${SPECIAL_BOOKING_PREFIX}${input.slug.replace(/[^a-z0-9_]+/g, "_")}_v${versionNumber}`;
  const statements = [
    db.prepare(
      `INSERT INTO booking_types
       (id, venture, label, description, duration_minutes, deposit_cents, currency, active, sort_order, created_at, updated_at)
       VALUES (?, 'tattooing', ?, ?, ?, ?, 'USD', 1, ?, ?, ?)`
    ).bind(bookingTypeId, input.title, `Tattoo Special · immutable version ${versionNumber}`, input.duration, input.deposit, 900 + input.sortOrder, now, now),
    db.prepare(
      `INSERT INTO tattoo_special_offer_versions
       (id, offer_id, version_number, public_description, duration_minutes, booking_mode,
        reference_requirement, participant_count, deposit_cents, booking_type_id, created_at, max_word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(versionId, offer.id, versionNumber, input.description, input.duration, input.mode, input.reference, input.participants, input.deposit, bookingTypeId, now, input.maxWordCount || null),
    ...input.variants.map((variant, index) => db.prepare(
      `INSERT INTO tattoo_special_offer_variants
       (id, offer_version_id, label, price_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(`${versionId}-variant-${index + 1}`, versionId, variant.label, variant.priceCents, variant.sortOrder, now)),
    db.prepare("UPDATE tattoo_special_offers SET campaign_id = ?, current_version_id = ?, title = ?, slug = ?, active = ?, archived_at = NULL, sort_order = ?, updated_at = ? WHERE id = ?")
      .bind(input.campaignId, versionId, input.title, input.slug, input.active ? 1 : 0, input.sortOrder, now, offer.id),
  ];
  await db.batch(statements);
  return versionId;
}

export async function handleAdminTattooSpecialOffer(request, env, offerId = "") {
  const auth = adminError(request, env);
  if (auth) return auth;
  try {
    const db = requireDb(env);
    if (request.method === "POST" && !offerId) {
      const body = await readJson(request);
      const campaignId = text(body?.campaignId, 200);
      const campaign = campaignId ? await db.prepare("SELECT * FROM tattoo_special_campaigns WHERE id = ? AND archived_at IS NULL").bind(campaignId).first() : null;
      if (!campaign) return failure("Choose an active campaign for this Tattoo Special.", 409);
      const input = normalizeOfferInput(body || {}, Number(campaign.default_deposit_cents), campaignId);
      if (input.error) return failure(input.error, 400);
      const id = `special-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO tattoo_special_offers (id, campaign_id, slug, title, active, sort_order, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).bind(id, campaignId, input.slug, input.title, input.active ? 1 : 0, input.sortOrder, now, now).run();
      await insertOfferVersion(db, { id, slug: input.slug }, input, 1, now);
      return json(await adminPayload(db), { status: 201 });
    }
    const offer = offerId ? await db.prepare("SELECT * FROM tattoo_special_offers WHERE id = ?").bind(offerId).first() : null;
    if (!offer) return failure("Tattoo Special not found.", 404);
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const campaignId = text(body?.campaignId || offer.campaign_id, 200);
      const campaign = await db.prepare("SELECT * FROM tattoo_special_campaigns WHERE id = ? AND archived_at IS NULL").bind(campaignId).first();
      if (!campaign) return failure("Choose an active campaign for this Tattoo Special.", 409);
      const input = normalizeOfferInput(body || {}, Number(campaign.default_deposit_cents), campaignId);
      if (input.error) return failure(input.error, 400);
      const version = await db.prepare("SELECT COALESCE(MAX(version_number), 0) AS version FROM tattoo_special_offer_versions WHERE offer_id = ?").bind(offerId).first();
      await insertOfferVersion(db, offer, input, Number(version.version || 0) + 1, new Date().toISOString());
      return json(await adminPayload(db));
    }
    if (request.method === "DELETE") {
      const used = await db.prepare("SELECT COUNT(*) AS count FROM tattoo_special_submission_terms WHERE offer_id = ?").bind(offerId).first();
      const now = new Date().toISOString();
      if (Number(used?.count || 0) > 0) {
        await db.prepare("UPDATE tattoo_special_offers SET active = 0, archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, offerId).run();
        return json({ ...(await adminPayload(db)), archived: true });
      }
      const types = (await db.prepare("SELECT booking_type_id FROM tattoo_special_offer_versions WHERE offer_id = ?").bind(offerId).all()).results || [];
      await db.batch([
        db.prepare("DELETE FROM tattoo_special_offer_variants WHERE offer_version_id IN (SELECT id FROM tattoo_special_offer_versions WHERE offer_id = ?)").bind(offerId),
        db.prepare("DELETE FROM tattoo_special_offer_versions WHERE offer_id = ?").bind(offerId),
        db.prepare("DELETE FROM tattoo_special_offers WHERE id = ?").bind(offerId),
        ...types.map((row) => db.prepare("DELETE FROM booking_types WHERE id = ?").bind(row.booking_type_id)),
      ]);
      return json({ ...(await adminPayload(db)), deleted: true });
    }
    return failure("Method not allowed.", 405);
  } catch (error) {
    return failure("Unable to save the Tattoo Special.", 500, { detail: error.message });
  }
}

export async function handleAdminTattooSpecialReview(request, env, submissionId) {
  const auth = adminError(request, env);
  if (auth) return auth;
  if (request.method !== "PATCH") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Expected JSON body.", 400);
  try {
    const db = requireDb(env);
    const row = await db.prepare(
      `SELECT s.*, t.* FROM submissions s JOIN tattoo_special_submission_terms t ON t.submission_id = s.id
       WHERE s.id = ? AND s.type = 'tattoo_special'`
    ).bind(submissionId).first();
    if (!row) return failure("Tattoo Special request not found.", 404);
    if (row.booking_mode !== "review") return failure("This historical Tattoo Special did not require Studio approval.", 409);
    const outcome = text(body.outcome || body.action || "save", 40);
    if (["approved", "approve", "declined", "decline"].includes(outcome)) {
      return failure("Use the confirmed submission decision action to approve or decline. Saving review details never records a decision or sends a notification.", 409, {
        code: "DECISION_ENDPOINT_REQUIRED",
      });
    }
    if (!new Set(["save", "simplification_requested"]).has(outcome)) return failure("Choose save or simplification requested.", 400);
    if (outcome === "simplification_requested" && row.offer_id !== "special-anime") {
      return failure("Simplification requests are available only for the Anime/Cartoon Tattoo Special.", 409);
    }
    if (["approved", "declined"].includes(row.status)) {
      return failure("Reopen review before changing Tattoo Special decision details.", 409, {
        code: "REOPEN_REVIEW_REQUIRED",
      });
    }
    const now = new Date().toISOString();
    const note = text(body.note, 3000);
    const approvedPrice = row.offer_id === "special-anime"
      ? integer(body.approvedPriceCents, Number(row.approved_price_cents || row.advertised_price_cents))
      : Number(row.advertised_price_cents);
    if (approvedPrice < Number(row.advertised_price_cents)) {
      return failure("The reviewed Tattoo Special price cannot be lower than its advertised price.", 400);
    }
    await db.batch([
      db.prepare("UPDATE tattoo_special_submission_terms SET approved_price_cents = ?, review_outcome = ?, updated_at = ? WHERE submission_id = ?")
        .bind(approvedPrice, outcome === "simplification_requested" ? outcome : "pending", now, submissionId),
      db.prepare(
        `UPDATE tattoo_session_plans SET approved_budget_min_cents = ?, approved_budget_max_cents = ?, artist_note = ?, updated_at = ?
         WHERE submission_id = ?`
      ).bind(approvedPrice, approvedPrice, note, now, submissionId),
      db.prepare(
        `UPDATE submissions SET status = CASE WHEN status='new' THEN 'reviewing' ELSE status END,
         tattoo_stage='review', internal_notes=?, decision_client_message=?,
         payload_json=json_set(payload_json,'$.approved_price_cents',?), updated_at=? WHERE id=?`
      ).bind(note, outcome === "simplification_requested" ? note : row.decision_client_message || "", approvedPrice, now, submissionId),
      db.prepare("INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)")
        .bind(crypto.randomUUID(), submissionId, outcome === "simplification_requested" ? "special_simplification_recorded" : "special_review_saved", note || null, now),
    ]);
    return json({
      ok: true,
      outcome,
      approvedPriceCents: approvedPrice,
      communication: { status: "unsent" },
    });
  } catch (error) {
    return failure("Unable to update the Tattoo Special review.", 500, { detail: error.message });
  }
}

export async function handleAdminTattooSpecialDeposit(request, env, submissionId) {
  const auth = adminError(request, env);
  if (auth) return auth;
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  try {
    const db = requireDb(env);
    const submission = await db.prepare("SELECT id,status,type,booking_url FROM submissions WHERE id=?").bind(submissionId).first();
    if (!submission || submission.type !== "tattoo_special") return failure("Tattoo Special request not found.", 404);
    if (submission.status !== "approved") return failure("Approve the Tattoo Special before preparing its deposit link.", 409);
    const preparedRequest = await prepareApprovedTattooSpecialRequest(request, env, submissionId);
    const clientAccess = await prepareTattooSpecialClientAccess(db, request, env, submission, preparedRequest);
    await db.prepare(
      "INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at) VALUES (?,?,'special_deposit_link_prepared','admin',?,?)"
    ).bind(crypto.randomUUID(), submissionId, preparedRequest.appointment?.id || "approval-first", new Date().toISOString()).run();
    return json({
      ok: true,
      checkoutUrl: "",
      clientUrl: clientAccess.bookingUrl,
      appointmentId: preparedRequest.appointment?.id || "",
      paymentDueAt: preparedRequest.paymentDueAt,
      existing: preparedRequest.existing && clientAccess.existing,
      delivery: { ok: false, skipped: true, reason: "explicit_client_notification_required" },
    });
  } catch (error) {
    return failure("Unable to prepare the Tattoo Special deposit link.", 500, { detail: error.message });
  }
}
