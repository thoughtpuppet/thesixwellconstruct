import { bookingUrlForToken, createBookingRawToken } from "../booking-links.js";
import {
  notifyAdjustedOfferAccepted,
  notifyAdjustedOfferClosing,
  notifyAdjustedOfferSent,
  notifyAdminAdjustedOfferResponse,
} from "../notifications/_lib.js";

const RESPONSE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const REASONS = new Set(["cover_up", "rework", "complexity", "size", "other"]);
const PRICING_TYPES = new Set(["flat", "hourly"]);
const NORMAL_TATTOO_TYPES = new Set([
  "tattoo_quarter",
  "tattoo_half",
  "tattoo_three_quarter",
  "tattoo_full",
  "tattoo_extended",
]);
const RESPONSE_SOURCES = new Set(["client_web", "studio_verbal", "studio_message"]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...init.headers,
    },
  });
}

function failure(error, status = 400, extras = {}) {
  return json({ error, ...extras }, { status });
}

function text(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function dbFor(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return env.SUBMISSIONS_DB;
}

function adminToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : new URL(request.url).searchParams.get("token") || "";
}

function requireAdmin(request, env) {
  if (!env.SUBMISSIONS_ADMIN_TOKEN) return failure("Admin adjusted offers are not configured.", 503);
  return adminToken(request) === env.SUBMISSIONS_ADMIN_TOKEN ? null : failure("Unauthorized.", 401);
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function responseTokenForOffer(env, offerId) {
  const secret = text(env.ADJUSTED_OFFER_TOKEN_SECRET || env.SUBMISSIONS_ADMIN_TOKEN, 1000);
  if (!secret) throw new Error("Missing Adjusted Offer token secret.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`adjusted-offer:${offerId}`));
  return base64Url(new Uint8Array(signature).slice(0, 9));
}

function publicBaseUrl(env, request) {
  return String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
}

function responsePath(rawToken) {
  if (!RESPONSE_TOKEN_PATTERN.test(rawToken)) throw new TypeError("Invalid adjusted-offer response token.");
  return `/o/${rawToken}`;
}

function normalizedOffer(row) {
  if (!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    revision: Number(row.revision || 0),
    status: row.status,
    reasonCode: row.reason_code,
    reasonText: row.reason_text || "",
    pricingType: row.pricing_type,
    amountCents: Number(row.amount_cents || 0),
    currency: row.currency || "USD",
    clientNote: row.client_note || "",
    originalOffer: parseJson(row.original_offer_snapshot_json, {}),
    allowedBookingTypes: parseJson(row.allowed_booking_types_json, []),
    allowMultipleSessions: Boolean(row.allow_multiple_sessions),
    maxSessions: Number(row.max_sessions || 1),
    responseUrl: row.response_url || "",
    expiresAt: row.expires_at,
    bookingTokenId: row.booking_token_id || "",
    sentAt: row.sent_at,
    respondedAt: row.responded_at || "",
    responseSource: row.response_source || "",
    responseNote: row.response_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicOffer(offer) {
  return {
    status: offer.status,
    reasonCode: offer.reasonCode,
    reasonText: offer.reasonText,
    pricingType: offer.pricingType,
    amountCents: offer.amountCents,
    currency: offer.currency,
    clientNote: offer.clientNote,
    expiresAt: offer.expiresAt,
    copy: offer.reasonCode === "cover_up"
      ? "Your tattoo request has been approved, but this project does not qualify for the current special because it is a cover-up."
      : "Your tattoo request has been approved, but this project does not qualify for the current special.",
    priceLabel: offer.pricingType === "hourly"
      ? `Adjusted rate: $${(offer.amountCents / 100).toFixed(2)}/hour`
      : `Adjusted flat rate: $${(offer.amountCents / 100).toFixed(2)}`,
  };
}

function responseDeadline(value) {
  const fallback = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const parsed = value ? new Date(value).getTime() : fallback;
  return Number.isFinite(parsed) && parsed > Date.now() ? new Date(parsed).toISOString() : "";
}

async function loadSubmissionAndTerms(db, submissionId) {
  return db.prepare(
    `SELECT s.*,t.offer_id,t.offer_version_id,t.variant_id,t.offer_title,t.variant_label,
            t.advertised_price_cents,t.approved_price_cents,t.deposit_cents,t.duration_minutes,
            t.booking_mode,t.booking_type_id,t.sales_closes_at,t.participant_count,t.review_outcome
     FROM submissions s
     LEFT JOIN tattoo_special_submission_terms t ON t.submission_id=s.id
     WHERE s.id=?`
  ).bind(submissionId).first();
}

async function validateBookingTypes(db, values) {
  if (!Array.isArray(values)) return { error: "Eligible session types must be a non-empty list." };
  const allowed = values.map((value) => text(value, 80)).filter(Boolean);
  if (!allowed.length || new Set(allowed).size !== allowed.length || allowed.some((id) => !NORMAL_TATTOO_TYPES.has(id))) {
    return { error: "Choose one or more supported regular tattoo session types." };
  }
  const rows = await db.prepare(
    `SELECT id FROM booking_types WHERE active=1 AND id IN (${allowed.map(() => "?").join(",")})`
  ).bind(...allowed).all();
  return (rows.results || []).length === allowed.length
    ? { allowed }
    : { error: "One or more selected tattoo session types are unavailable." };
}

function originalSnapshot(row) {
  return {
    offerId: row.offer_id,
    offerVersionId: row.offer_version_id,
    variantId: row.variant_id,
    offerTitle: row.offer_title,
    variantLabel: row.variant_label,
    advertisedPriceCents: Number(row.advertised_price_cents || 0),
    approvedPriceCents: row.approved_price_cents == null ? null : Number(row.approved_price_cents),
    depositCents: Number(row.deposit_cents || 0),
    durationMinutes: Number(row.duration_minutes || 0),
    bookingMode: row.booking_mode,
    bookingTypeId: row.booking_type_id,
    salesClosesAt: row.sales_closes_at,
    participantCount: Number(row.participant_count || 1),
  };
}

async function writeOfferEvent(db, offer, eventType, actor, note = "") {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), offer.submissionId || offer.submission_id, eventType, actor, note || offer.id, now).run();
}

export async function handleAdminCreateAdjustedOffer(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readBody(request);
  if (!body) return failure("Expected JSON body.", 400);
  try {
    const db = dbFor(env);
    const submission = await loadSubmissionAndTerms(db, text(submissionId, 100));
    if (!submission) return failure("Submission not found.", 404);
    if (submission.type !== "tattoo_special" || submission.booking_mode !== "review") {
      return failure("Adjusted Offers are available only for Tattoo Special requests in Studio review.", 409);
    }
    if (!["new", "reviewing"].includes(submission.status)) {
      return failure("This request is no longer available for an adjusted offer.", 409);
    }
    const active = await db.prepare("SELECT id FROM tattoo_adjusted_offers WHERE submission_id=? AND status='pending'").bind(submission.id).first();
    if (active) return failure("Withdraw the active adjusted offer before issuing a replacement.", 409, { offerId: active.id });

    const reasonCode = text(body.reasonCode, 40);
    const reasonText = text(body.reasonText, 500);
    const pricingType = text(body.pricingType, 20);
    const amountCents = Number(body.amountCents);
    const expiresAt = responseDeadline(body.expiresAt);
    if (!REASONS.has(reasonCode)) return failure("Choose a supported adjusted-offer reason.", 400);
    if (reasonCode === "other" && !reasonText) return failure("Describe the reason for the adjusted offer.", 400);
    if (!PRICING_TYPES.has(pricingType)) return failure("Pricing type must be flat or hourly.", 400);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return failure("Adjusted amount must be a positive whole-cent value.", 400);
    if (!expiresAt) return failure("Response deadline must be a future date and time.", 400);
    const typeValidation = await validateBookingTypes(db, body.allowedBookingTypes);
    if (typeValidation.error) return failure(typeValidation.error, 400);
    if (body.allowMultipleSessions !== undefined && typeof body.allowMultipleSessions !== "boolean") {
      return failure("Allow multiple sessions must be true or false.", 400);
    }
    const allowMultipleSessions = body.allowMultipleSessions === true;
    const maxSessions = allowMultipleSessions ? Number(body.maxSessions) : 1;
    if (!Number.isSafeInteger(maxSessions) || maxSessions < (allowMultipleSessions ? 2 : 1) || maxSessions > 24) {
      return failure("Maximum sessions must be a whole number from 2 through 24 when multiple sessions are enabled.", 400);
    }

    const latest = await db.prepare("SELECT MAX(revision) revision FROM tattoo_adjusted_offers WHERE submission_id=?").bind(submission.id).first();
    const revision = Number(latest?.revision || 0) + 1;
    const id = crypto.randomUUID();
    const rawToken = await responseTokenForOffer(env, id);
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date().toISOString();
    const responseUrl = responsePath(rawToken);
    const clientNote = text(body.clientNote, 2000);
    const snapshot = originalSnapshot(submission);
    const eventNote = JSON.stringify({ offerId: id, revision, pricingType, amountCents, expiresAt });
    const results = await db.batch([
      db.prepare(
        `INSERT INTO tattoo_adjusted_offers (
          id,submission_id,revision,status,reason_code,reason_text,pricing_type,amount_cents,currency,
          client_note,original_offer_snapshot_json,allowed_booking_types_json,allow_multiple_sessions,max_sessions,
          token_hash,expires_at,sent_at,created_at,updated_at
        ) SELECT ?,s.id,?,'pending',?,?,?,?,'USD',?,?,?,?,?,?,?,?,?,?
          FROM submissions s
          WHERE s.id=? AND s.type='tattoo_special' AND s.status IN ('new','reviewing')
            AND NOT EXISTS (SELECT 1 FROM tattoo_adjusted_offers active WHERE active.submission_id=s.id AND active.status='pending')`
      ).bind(
        id, revision, reasonCode, reasonText, pricingType, amountCents, clientNote,
        JSON.stringify(snapshot), JSON.stringify(typeValidation.allowed), allowMultipleSessions ? 1 : 0, maxSessions,
        tokenHash, expiresAt, now, now, now, submission.id,
      ),
      db.prepare(
        `UPDATE submissions
         SET status='reviewing',tattoo_stage='review',booking_url='',
             payload_json=json_remove(payload_json,'$.requested_appointment_id','$.requested_start_at','$.requested_end_at'),
             updated_at=?
         WHERE id=? AND EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='pending')`
      ).bind(now, submission.id, id),
      db.prepare(
        `UPDATE appointments SET status='superseded',approval_state='declined',updated_at=?
         WHERE submission_id=? AND status='requested' AND hold_state IS NULL
           AND EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='pending')`
      ).bind(now, submission.id, id),
      db.prepare(
        `INSERT INTO appointment_events (id,appointment_id,event_type,actor,note,metadata_json,created_at)
         SELECT ?,a.id,'special_requested_time_superseded','admin',?,? ,?
         FROM appointments a
         WHERE a.submission_id=? AND a.status='superseded' AND a.hold_state IS NULL
         ORDER BY a.created_at DESC LIMIT 1`
      ).bind(crypto.randomUUID(), "Superseded by Adjusted Offer; the requested time was never reserved.", JSON.stringify({ adjustedOfferId: id }), now, submission.id),
      db.prepare(
        `INSERT INTO tattoo_session_plans (
          id,submission_id,session_category,split_policy,artist_note,
          approved_budget_min_cents,approved_budget_max_cents,approved_budget_currency,
          booking_purpose,allowed_booking_types_json,booking_allow_multiple_sessions,booking_max_sessions,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(submission_id) DO UPDATE SET
          booking_purpose=excluded.booking_purpose,
          allowed_booking_types_json=excluded.allowed_booking_types_json,
          booking_allow_multiple_sessions=excluded.booking_allow_multiple_sessions,
          booking_max_sessions=excluded.booking_max_sessions,
          approved_budget_min_cents=excluded.approved_budget_min_cents,
          approved_budget_max_cents=excluded.approved_budget_max_cents,
          approved_budget_currency='USD',updated_at=excluded.updated_at`
      ).bind(
        crypto.randomUUID(), submission.id,
        allowMultipleSessions ? "multiple_sessions" : "one_session",
        allowMultipleSessions ? "client_choice" : "not_available",
        clientNote,
        pricingType === "flat" ? amountCents : null,
        pricingType === "flat" ? amountCents : null,
        "USD", "tattoo", JSON.stringify(typeValidation.allowed), allowMultipleSessions ? 1 : 0, maxSessions, now, now,
      ),
      db.prepare(
        `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
         SELECT ?,?,'adjusted_offer_sent','admin',?,?
         WHERE EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='pending')`
      ).bind(crypto.randomUUID(), submission.id, eventNote, now, id),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) return failure("The request changed before the adjusted offer could be created.", 409);
    const offerRow = await db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=?").bind(id).first();
    const offer = { ...normalizedOffer(offerRow), responseUrl };
    const delivery = await notifyAdjustedOfferSent(env, request, submission, offer, { durable: true });
    await writeOfferEvent(db, offer, delivery.ok ? "adjusted_offer_notification_sent" : "adjusted_offer_notification_queued", "system", delivery.error || "client email");
    return json({ ok: true, offer, delivery });
  } catch (error) {
    return failure("Unable to create the adjusted offer.", 500, { detail: error.message });
  }
}

async function loadOwnedOffer(db, submissionId, offerId) {
  return db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=? AND submission_id=?").bind(offerId, submissionId).first();
}

export async function handleAdminResendAdjustedOffer(request, env, submissionId, offerId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = dbFor(env);
    const row = await loadOwnedOffer(db, submissionId, offerId);
    if (!row) return failure("Adjusted offer not found.", 404);
    if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now()) return failure("Only an active adjusted offer can be resent.", 409);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id=?").bind(submissionId).first();
    const offer = { ...normalizedOffer(row), responseUrl: responsePath(await responseTokenForOffer(env, row.id)) };
    const attempt = crypto.randomUUID();
    const delivery = await notifyAdjustedOfferSent(env, request, submission, offer, { durable: true, idempotencyKey: `adjusted_offer_resent:${offer.id}:${attempt}` });
    await writeOfferEvent(db, offer, "adjusted_offer_resent", "admin", delivery.ok ? "sent" : delivery.error || "queued");
    return json({ ok: true, offer, delivery });
  } catch (error) {
    return failure("Unable to resend the adjusted offer.", 500, { detail: error.message });
  }
}

export async function handleAdminGetAdjustedOfferLink(request, env, submissionId, offerId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = dbFor(env);
    const row = await loadOwnedOffer(db, submissionId, offerId);
    if (!row) return failure("Adjusted offer not found.", 404);
    if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now()) {
      return failure("Only an active adjusted-offer link is available.", 409);
    }
    return json({ ok: true, responseUrl: responsePath(await responseTokenForOffer(env, row.id)) });
  } catch (error) {
    return failure("Unable to load the adjusted-offer link.", 500, { detail: error.message });
  }
}

export async function handleAdminWithdrawAdjustedOffer(request, env, submissionId, offerId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readBody(request);
  if (!body) return failure("Expected JSON body.", 400);
  try {
    const db = dbFor(env);
    const now = new Date().toISOString();
    const result = await db.prepare(
      `UPDATE tattoo_adjusted_offers SET status='withdrawn',responded_at=?,response_source='studio_message',response_note=?,updated_at=?
       WHERE id=? AND submission_id=? AND status='pending'`
    ).bind(now, text(body.note, 1000), now, offerId, submissionId).run();
    if (Number(result.meta?.changes || 0) !== 1) return failure("Only an active adjusted offer can be withdrawn.", 409);
    const offer = normalizedOffer(await loadOwnedOffer(db, submissionId, offerId));
    await writeOfferEvent(db, offer, "adjusted_offer_withdrawn", "admin", offer.responseNote);
    return json({ ok: true, offer });
  } catch (error) {
    return failure("Unable to withdraw the adjusted offer.", 500, { detail: error.message });
  }
}

async function completeAcceptance(db, request, env, row, source, responseNote, sendClientEmail) {
  const offer = normalizedOffer(row);
  const submission = await db.prepare("SELECT * FROM submissions WHERE id=?").bind(offer.submissionId).first();
  const rawBookingToken = createBookingRawToken();
  const bookingTokenHash = await sha256Hex(rawBookingToken);
  const bookingTokenId = crypto.randomUUID();
  const bookingUrl = bookingUrlForToken(publicBaseUrl(env, request), rawBookingToken);
  const bookingPath = bookingUrl.pathname + bookingUrl.search;
  const now = new Date().toISOString();
  const bookingExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO booking_tokens (id,token_hash,submission_id,allowed_booking_types_json,purpose,expires_at,allow_multiple_sessions,max_sessions,created_at,updated_at)
       SELECT ?,?,?,?,'tattoo',?,?,?,?,? FROM tattoo_adjusted_offers
       WHERE id=? AND status='pending' AND expires_at>?`
    ).bind(
      bookingTokenId, bookingTokenHash, offer.submissionId, JSON.stringify(offer.allowedBookingTypes),
      bookingExpiresAt, offer.allowMultipleSessions ? 1 : 0, offer.maxSessions, now, now, offer.id, now,
    ),
    db.prepare(
      `UPDATE tattoo_adjusted_offers
       SET status='accepted',booking_token_id=?,responded_at=?,response_source=?,response_note=?,updated_at=?
       WHERE id=? AND status='pending' AND expires_at>?
         AND EXISTS (SELECT 1 FROM booking_tokens bt WHERE bt.id=?)`
    ).bind(bookingTokenId, now, source, responseNote, now, offer.id, now, bookingTokenId),
    db.prepare(
      `UPDATE submissions SET status='approved',tattoo_stage='ready_to_book',booking_url=?,decided_at=?,updated_at=?
       WHERE id=? AND EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='accepted' AND o.booking_token_id=?)`
    ).bind(bookingPath, now, now, offer.submissionId, offer.id, bookingTokenId),
    db.prepare(
      `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
       SELECT ?,?,'adjusted_offer_accepted',?,?,?
       WHERE EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='accepted' AND o.booking_token_id=?)`
    ).bind(crypto.randomUUID(), offer.submissionId, source === "client_web" ? "client" : "admin", JSON.stringify({ offerId: offer.id, source, responseNote, bookingTokenId }), now, offer.id, bookingTokenId),
  ]);
  if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
    const authoritative = await db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=?").bind(offer.id).first();
    return { raced: true, offer: normalizedOffer(authoritative) };
  }
  const accepted = normalizedOffer(await db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=?").bind(offer.id).first());
  const token = { id: bookingTokenId, bookingUrl: bookingUrl.toString(), path: bookingPath, expiresAt: bookingExpiresAt };
  const deliveries = [];
  if (sendClientEmail) deliveries.push(await notifyAdjustedOfferAccepted(env, request, submission, accepted, token, { durable: true }));
  deliveries.push(await notifyAdminAdjustedOfferResponse(env, request, submission, accepted, { durable: true }));
  for (const delivery of deliveries) {
    await writeOfferEvent(db, accepted, delivery.ok ? "adjusted_offer_notification_sent" : "adjusted_offer_notification_queued", "system", delivery.error || "response notification");
  }
  return { ok: true, offer: accepted, token, deliveries };
}

async function completeDecline(db, request, env, row, source, responseNote, sendClientEmail) {
  const offer = normalizedOffer(row);
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE tattoo_adjusted_offers
       SET status='declined',responded_at=?,response_source=?,response_note=?,updated_at=?
       WHERE id=? AND status='pending'`
    ).bind(now, source, responseNote, now, offer.id),
    db.prepare(
      `UPDATE submissions SET status='declined',tattoo_stage='closed',booking_url='',decided_at=?,updated_at=?
       WHERE id=? AND EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='declined')`
    ).bind(now, now, offer.submissionId, offer.id),
    db.prepare(
      `INSERT INTO submission_events (id,submission_id,event_type,actor,note,created_at)
       SELECT ?,?,'adjusted_offer_declined',?,?,?
       WHERE EXISTS (SELECT 1 FROM tattoo_adjusted_offers o WHERE o.id=? AND o.status='declined')`
    ).bind(crypto.randomUUID(), offer.submissionId, source === "client_web" ? "client" : "admin", JSON.stringify({ offerId: offer.id, source, responseNote }), now, offer.id),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    return { raced: true, offer: normalizedOffer(await db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=?").bind(offer.id).first()) };
  }
  const declined = normalizedOffer(await db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE id=?").bind(offer.id).first());
  const submission = await db.prepare("SELECT * FROM submissions WHERE id=?").bind(offer.submissionId).first();
  const deliveries = [await notifyAdminAdjustedOfferResponse(env, request, submission, declined, { durable: true })];
  if (sendClientEmail) deliveries.push(await notifyAdjustedOfferClosing(env, request, submission, declined, { durable: true }));
  for (const delivery of deliveries) {
    await writeOfferEvent(db, declined, delivery.ok ? "adjusted_offer_notification_sent" : "adjusted_offer_notification_queued", "system", delivery.error || "response notification");
  }
  return { ok: true, offer: declined, deliveries };
}

export async function handleAdminAcceptAdjustedOffer(request, env, submissionId, offerId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readBody(request);
  if (!body) return failure("Expected JSON body.", 400);
  try {
    const db = dbFor(env);
    const row = await loadOwnedOffer(db, submissionId, offerId);
    if (!row) return failure("Adjusted offer not found.", 404);
    const source = text(body.source, 40) || "studio_verbal";
    if (!RESPONSE_SOURCES.has(source) || source === "client_web") return failure("Manual acceptance source must be Studio verbal or Studio message.", 400);
    const result = await completeAcceptance(db, request, env, row, source, text(body.note, 1000), body.sendClientEmail !== false);
    if (result.raced) return failure("This adjusted offer has already been closed.", 409, { offer: result.offer });
    return json(result);
  } catch (error) {
    return failure("Unable to mark the adjusted offer accepted.", 500, { detail: error.message });
  }
}

export async function handleAdminDeclineAdjustedOffer(request, env, submissionId, offerId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readBody(request);
  if (!body) return failure("Expected JSON body.", 400);
  try {
    const db = dbFor(env);
    const row = await loadOwnedOffer(db, submissionId, offerId);
    if (!row) return failure("Adjusted offer not found.", 404);
    const source = text(body.source, 40) || "studio_message";
    if (!RESPONSE_SOURCES.has(source) || source === "client_web") return failure("Manual decline source must be Studio verbal or Studio message.", 400);
    const result = await completeDecline(db, request, env, row, source, text(body.note, 1000), body.sendClientEmail === true);
    if (result.raced) return failure("This adjusted offer has already been closed.", 409, { offer: result.offer });
    return json(result);
  } catch (error) {
    return failure("Unable to mark the adjusted offer declined.", 500, { detail: error.message });
  }
}

async function offerByRawToken(db, rawToken) {
  if (!RESPONSE_TOKEN_PATTERN.test(rawToken)) return null;
  return db.prepare("SELECT * FROM tattoo_adjusted_offers WHERE token_hash=?").bind(await sha256Hex(rawToken)).first();
}

export async function handlePublicAdjustedOfferContext(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const rawToken = text(new URL(request.url).searchParams.get("token"), 20);
  try {
    const db = dbFor(env);
    const row = await offerByRawToken(db, rawToken);
    if (!row) return failure("This adjusted-offer link is invalid or no longer available.", 404);
    if (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) {
      const now = new Date().toISOString();
      await db.prepare("UPDATE tattoo_adjusted_offers SET status='expired',responded_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now, now, row.id).run();
      await writeOfferEvent(db, { id: row.id, submissionId: row.submission_id }, "adjusted_offer_expired", "system", row.id);
      return failure("This adjusted-offer link has expired.", 410);
    }
    const offer = normalizedOffer(row);
    if (offer.status !== "pending") return json({ status: offer.status });
    return json({ ok: true, offer: publicOffer(offer) });
  } catch (error) {
    return failure("Unable to load the adjusted offer.", 500, { detail: error.message });
  }
}

export async function handlePublicAdjustedOfferResponse(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readBody(request);
  if (!body) return failure("Expected JSON body.", 400);
  const rawToken = text(body.token, 20);
  const action = text(body.action, 20);
  if (!RESPONSE_TOKEN_PATTERN.test(rawToken) || !["accept", "decline"].includes(action)) {
    return failure("The adjusted-offer response is invalid.", 400);
  }
  try {
    const db = dbFor(env);
    const row = await offerByRawToken(db, rawToken);
    if (!row) return failure("This adjusted-offer link is invalid or no longer available.", 404);
    if (row.status !== "pending") {
      const prior = normalizedOffer(row);
      const submission = row.status === "accepted"
        ? await db.prepare("SELECT booking_url FROM submissions WHERE id=?").bind(row.submission_id).first()
        : null;
      return json({ ok: true, replayed: true, status: prior.status, bookingUrl: submission?.booking_url || "" });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      const now = new Date().toISOString();
      await db.prepare("UPDATE tattoo_adjusted_offers SET status='expired',responded_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now, now, row.id).run();
      await writeOfferEvent(db, { id: row.id, submissionId: row.submission_id }, "adjusted_offer_expired", "system", row.id);
      return failure("This adjusted-offer link has expired.", 410);
    }
    const result = action === "accept"
      ? await completeAcceptance(db, request, env, row, "client_web", "", true)
      : await completeDecline(db, request, env, row, "client_web", "", false);
    if (result.raced) {
      const submission = result.offer?.status === "accepted"
        ? await db.prepare("SELECT booking_url FROM submissions WHERE id=?").bind(row.submission_id).first()
        : null;
      return json({ ok: true, replayed: true, status: result.offer?.status || "closed", bookingUrl: submission?.booking_url || "" });
    }
    return json({
      ok: true,
      status: result.offer.status,
      bookingUrl: result.token?.path || "",
      message: result.offer.status === "declined"
        ? "Thank you for your time. I wish you luck getting your project completed elsewhere."
        : "Your adjusted rate has been accepted. Continue to choose a date and time.",
    });
  } catch (error) {
    return failure("Unable to record the adjusted-offer response.", 500, { detail: error.message });
  }
}

export async function reapExpiredAdjustedOffers(env) {
  const db = env.SUBMISSIONS_DB;
  if (!db) return { expired: 0 };
  const now = new Date().toISOString();
  const due = await db.prepare("SELECT id,submission_id FROM tattoo_adjusted_offers WHERE status='pending' AND expires_at<=? LIMIT 100").bind(now).all();
  let expired = 0;
  for (const row of due.results || []) {
    const result = await db.prepare("UPDATE tattoo_adjusted_offers SET status='expired',responded_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now, now, row.id).run();
    if (Number(result.meta?.changes || 0) === 1) {
      expired += 1;
      await writeOfferEvent(db, { id: row.id, submissionId: row.submission_id }, "adjusted_offer_expired", "system", row.id);
    }
  }
  return { expired };
}
