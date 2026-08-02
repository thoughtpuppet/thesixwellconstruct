import {
  notifyAdminSubmissionReceived,
  notifyBookingLinkCreated,
  notifySubmissionReceived,
  sendCrmFollowupEmail,
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

function durationLabel(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hours`;
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

async function loadOffers(db, includeInactive = false) {
  const rows = (await db.prepare(
    `SELECT o.id, o.slug, o.title, o.active, o.archived_at, o.sort_order, o.current_version_id,
            o.created_at, o.updated_at,
            v.version_number, v.public_description, v.duration_minutes, v.booking_mode,
            v.reference_requirement, v.participant_count, v.deposit_cents, v.booking_type_id,
            v.created_at AS version_created_at
     FROM tattoo_special_offers o
     JOIN tattoo_special_offer_versions v ON v.id = o.current_version_id
     ${includeInactive ? "" : "WHERE o.active = 1 AND o.archived_at IS NULL"}
     ORDER BY o.sort_order, o.created_at`
  ).all()).results || [];
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
    depositCents: Number(row.deposit_cents),
    bookingTypeId: row.booking_type_id,
    variants: byVersion.get(row.current_version_id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function publicSettings(settings, state) {
  return {
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
      alt: settings.alt_text || "Tattoo Specials campaign artwork",
      filename: settings.original_filename || "",
    } : null,
    normalInquiryUrl: "/tattoos/inquiry/",
  };
}

export async function handlePublicTattooSpecials(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  try {
    const db = requireDb(env);
    const settings = await loadSettings(db);
    const state = windowState(settings);
    return json({
      ...publicSettings(settings, state),
      offers: state === "open" ? await loadOffers(db, false) : [],
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

function rawToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createBookingAccess(db, request, submissionId, terms, closesAt) {
  const token = rawToken();
  const tokenId = crypto.randomUUID();
  const now = new Date().toISOString();
  const bookingUrl = new URL("/booking/", new URL(request.url).origin);
  bookingUrl.searchParams.set("token", token);
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
       VALUES (?, ?, 'booking_link_created', 'system', ?, ?)`
    ).bind(crypto.randomUUID(), submissionId, `Tattoo Special · ${terms.offer_title} · expires at sales close`, now),
  ]);
  return { id: tokenId, rawToken: token, bookingUrl: bookingUrl.pathname + bookingUrl.search, purpose: "tattoo", expiresAt: closesAt, allowedBookingTypes: [terms.booking_type_id] };
}

async function selectedTerms(db, offerId, variantId) {
  return db.prepare(
    `SELECT o.id AS offer_id, o.title AS offer_title, o.current_version_id,
            v.id AS offer_version_id, v.duration_minutes, v.booking_mode,
            v.reference_requirement, v.participant_count, v.deposit_cents, v.booking_type_id,
            p.id AS variant_id, p.label AS variant_label, p.price_cents
     FROM tattoo_special_offers o
     JOIN tattoo_special_offer_versions v ON v.id = o.current_version_id
     JOIN tattoo_special_offer_variants p ON p.offer_version_id = v.id
     WHERE o.id = ? AND p.id = ? AND o.active = 1 AND o.archived_at IS NULL`
  ).bind(offerId, variantId).first();
}

export async function handleCreateTattooSpecialSubmission(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readMultipart(request);
  if (body.error) return failure(body.error, 400);
  const fields = body.fields;
  try {
    const db = requireDb(env);
    const settings = await loadSettings(db);
    if (windowState(settings) !== "open") return failure("Tattoo Specials are not currently accepting payments.", 409, { code: "SPECIALS_WINDOW_CLOSED" });
    const terms = await selectedTerms(db, text(fields.offerId, 200), text(fields.variantId, 200));
    if (!terms) return failure("That Tattoo Special is unavailable. Refresh and choose again.", 409);

    const primary = {
      name: text(fields.name, 160), email: text(fields.email, 320).toLowerCase(), phone: text(fields.phone, 80),
    };
    if (!primary.name) return failure("Enter the primary purchaser's full name.", 400, { field: "name" });
    if (!primary.email) return failure("Enter the primary purchaser's email address.", 400, { field: "email" });
    if (!validEmail(primary.email)) return failure("Enter a complete email address for the primary purchaser, such as name@example.com.", 400, { field: "email" });
    if (!primary.phone) return failure("Enter the primary purchaser's phone number.", 400, { field: "phone" });
    if (text(fields.ageConfirmed).toLowerCase() !== "yes") return failure("The primary participant must confirm they are at least 18.", 400);
    if (text(fields.policyAccepted).toLowerCase() !== "yes") return failure("Accept the Tattoo Special deposit and booking policies to continue.", 400);
    const placement = text(fields.placement, 500);
    const projectDetails = text(fields.projectDetails, 5000);
    if (!placement || !projectDetails) return failure("Placement and project details are required.", 400);
    const fileError = validateReferenceFiles(body.files);
    if (fileError) return failure(fileError, 400);
    const referenceLink = text(fields.referenceLink, 1000);
    if (terms.reference_requirement === "required" && !body.files.length && !referenceLink) {
      return failure("This Tattoo Special requires at least one reference image or reference link.", 400);
    }
    let secondary = null;
    if (Number(terms.participant_count) === 2) {
      secondary = {
        name: text(fields.participant2Name, 160),
        email: text(fields.participant2Email, 320).toLowerCase(),
        phone: text(fields.participant2Phone, 80),
      };
      if (!secondary.name) return failure("Enter the second adult participant's full name.", 400, { field: "participant2Name" });
      if (!secondary.email) return failure("Enter the second adult participant's email address.", 400, { field: "participant2Email" });
      if (!validEmail(secondary.email)) return failure("Enter a complete email address for the second adult participant, such as name@example.com.", 400, { field: "participant2Email" });
      if (!secondary.phone) return failure("Enter the second adult participant's phone number.", 400, { field: "participant2Phone" });
      if (text(fields.participant2AgeConfirmed).toLowerCase() !== "yes") return failure("The second participant must confirm they are at least 18.", 400);
    }

    const idempotencyKey = text(request.headers.get("idempotency-key") || fields.idempotencyKey, 200);
    if (!idempotencyKey) return failure("An idempotency key is required.", 400);
    const existing = await db.prepare("SELECT id, booking_url, status FROM submissions WHERE idempotency_key = ?").bind(idempotencyKey).first();
    if (existing) return json({ ok: true, idempotent: true, submissionId: existing.id, bookingUrl: existing.booking_url || "", reviewRequired: !existing.booking_url });

    const submissionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const direct = terms.booking_mode === "direct";
    const savedFiles = await saveFiles(env, submissionId, body.files);
    const participants = [primary, ...(secondary ? [secondary] : [])];
    const payload = {
      campaign: "Tattoo Special",
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
      sales_closes_at: settings.sales_closes_at,
      placement,
      project_details: projectDetails,
      reference_link: referenceLink,
      participants,
      primary_participant_index: 0,
      automated_messages_recipient: primary.email,
      age_confirmed: "yes",
      policy_accepted: "yes",
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
         (submission_id, offer_id, offer_version_id, variant_id, offer_title, variant_label,
          advertised_price_cents, approved_price_cents, deposit_cents, duration_minutes,
          booking_mode, booking_type_id, sales_closes_at, participant_count, review_outcome, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        submissionId, terms.offer_id, terms.offer_version_id, terms.variant_id, terms.offer_title,
        terms.variant_label, terms.price_cents, direct ? terms.price_cents : null, terms.deposit_cents,
        terms.duration_minutes, terms.booking_mode, terms.booking_type_id, settings.sales_closes_at,
        terms.participant_count, direct ? "approved" : "pending", now, now,
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

    let token = null;
    if (direct) token = await createBookingAccess(db, request, submissionId, terms, settings.sales_closes_at);
    const normalized = { id: submissionId, type: SPECIAL_TYPE, status: direct ? "approved" : "new", sourcePath: "/tattoos/specials/", subject: `Tattoo Special · ${terms.offer_title}`, contact, payload, files: savedFiles };
    await Promise.allSettled([
      notifySubmissionReceived(env, normalized),
      notifyAdminSubmissionReceived(env, normalized),
      ...(token ? [notifyBookingLinkCreated(env, request, normalized, { ...token, approvedBudget: { minCents: Number(terms.price_cents), maxCents: Number(terms.price_cents), currency: "USD" } })] : []),
    ]);
    return json({
      ok: true,
      submissionId,
      reviewRequired: !direct,
      bookingUrl: token?.bookingUrl || "",
      receipt: direct ? "Your private booking link is ready." : "Your references were sent to Studio for complexity review.",
    }, { status: 201 });
  } catch (error) {
    if (String(error.message || error).includes("UNIQUE constraint failed: submissions.idempotency_key")) {
      return failure("This request was already submitted. Refresh before trying again.", 409);
    }
    return failure("Unable to create the Tattoo Special request.", 500, { detail: error.message });
  }
}

async function adminPayload(db) {
  const settings = await loadSettings(db);
  const media = (await db.prepare(
    `SELECT id, source_url, storage_key, original_filename, mime_type, alt_text, public_title
     FROM media_assets
     WHERE state = 'active' AND privacy = 'public' AND public_presentation = 'inline'
       AND consent_status IN ('not-required','granted') AND mime_type LIKE 'image/%'
     ORDER BY created_at DESC LIMIT 250`
  ).all()).results || [];
  return {
    settings: publicSettings(settings, windowState(settings)),
    offers: await loadOffers(db, true),
    media: media.map((row) => ({ id: row.id, url: mediaUrl(row), filename: row.original_filename, alt: row.alt_text, title: row.public_title })),
    readiness: {
      database: true,
      artwork: Boolean(settings?.artwork_media_id && mediaUrl(settings)),
      activeOffers: (await loadOffers(db, false)).length,
      salesWindowValid: new Date(settings?.sales_opens_at).getTime() < new Date(settings?.sales_closes_at).getTime(),
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
    const current = await loadSettings(db);
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
      `UPDATE tattoo_special_settings SET sales_opens_at = ?, sales_closes_at = ?,
       default_deposit_cents = ?, artwork_media_id = ?, enabled = ?, updated_at = ? WHERE id = 'default'`
    ).bind(opensAt, closesAt, deposit, mediaId, body.enabled === undefined ? Number(current.enabled) : (body.enabled ? 1 : 0), new Date().toISOString()).run();
    return json(await adminPayload(db));
  } catch (error) {
    return failure("Unable to update Tattoo Specials settings.", 500, { detail: error.message });
  }
}

function normalizeOfferInput(body, defaultDeposit) {
  const title = text(body.title, 200);
  const slug = text(body.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 160);
  const duration = integer(body.durationMinutes, -1);
  const mode = text(body.mode || body.bookingMode, 20);
  const reference = text(body.referenceRequirement || "optional", 20);
  const participants = integer(body.participantCount, 1);
  const deposit = body.depositCents === undefined ? defaultDeposit : integer(body.depositCents, -1);
  const variants = Array.isArray(body.variants) ? body.variants.map((variant, index) => ({
    label: text(variant.label, 100), priceCents: integer(variant.priceCents, -1), sortOrder: integer(variant.sortOrder, (index + 1) * 10),
  })) : [];
  if (!title || !slug) return { error: "A Tattoo Special title and slug are required." };
  if (duration <= 0 || duration % 30 !== 0) return { error: "Duration must use 30-minute increments." };
  if (!new Set(["direct", "review"]).has(mode)) return { error: "Mode must be direct or review." };
  if (!new Set(["optional", "required"]).has(reference)) return { error: "Reference requirement must be optional or required." };
  if (![1, 2].includes(participants)) return { error: "Participant count must be one or two." };
  if (deposit < 0) return { error: "Deposit must be zero or greater." };
  if (!variants.length || variants.some((variant) => !variant.label || variant.priceCents <= 0)) return { error: "Add at least one valid price variant." };
  return { title, slug, description: text(body.description, 3000), duration, mode, reference, participants, deposit, variants, active: body.active !== false, sortOrder: integer(body.sortOrder, 0) };
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
        reference_requirement, participant_count, deposit_cents, booking_type_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(versionId, offer.id, versionNumber, input.description, input.duration, input.mode, input.reference, input.participants, input.deposit, bookingTypeId, now),
    ...input.variants.map((variant, index) => db.prepare(
      `INSERT INTO tattoo_special_offer_variants
       (id, offer_version_id, label, price_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(`${versionId}-variant-${index + 1}`, versionId, variant.label, variant.priceCents, variant.sortOrder, now)),
    db.prepare("UPDATE tattoo_special_offers SET current_version_id = ?, title = ?, slug = ?, active = ?, archived_at = NULL, sort_order = ?, updated_at = ? WHERE id = ?")
      .bind(versionId, input.title, input.slug, input.active ? 1 : 0, input.sortOrder, now, offer.id),
  ];
  await db.batch(statements);
  return versionId;
}

export async function handleAdminTattooSpecialOffer(request, env, offerId = "") {
  const auth = adminError(request, env);
  if (auth) return auth;
  try {
    const db = requireDb(env);
    const settings = await loadSettings(db);
    if (request.method === "POST" && !offerId) {
      const body = await readJson(request);
      const input = normalizeOfferInput(body || {}, Number(settings.default_deposit_cents));
      if (input.error) return failure(input.error, 400);
      const id = `special-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO tattoo_special_offers (id, slug, title, active, sort_order, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      ).bind(id, input.slug, input.title, input.active ? 1 : 0, input.sortOrder, now, now).run();
      await insertOfferVersion(db, { id, slug: input.slug }, input, 1, now);
      return json(await adminPayload(db), { status: 201 });
    }
    const offer = offerId ? await db.prepare("SELECT * FROM tattoo_special_offers WHERE id = ?").bind(offerId).first() : null;
    if (!offer) return failure("Tattoo Special not found.", 404);
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const input = normalizeOfferInput(body || {}, Number(settings.default_deposit_cents));
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
    if (row.booking_mode !== "review") return failure("This Tattoo Special does not require complexity review.", 409);
    const outcome = text(body.outcome, 40);
    if (!new Set(["approved", "simplification_requested", "declined"]).has(outcome)) return failure("Choose approved, simplification requested, or declined.", 400);
    const now = new Date().toISOString();
    const note = text(body.note, 3000);
    let approvedPrice = null;
    let token = null;
    if (outcome === "approved") {
      if (new Date(row.sales_closes_at).getTime() <= Date.now()) {
        return failure("The Tattoo Specials sales window has closed. No new booking link can be issued.", 409);
      }
      approvedPrice = integer(body.approvedPriceCents, Number(row.advertised_price_cents));
      if (approvedPrice < Number(row.advertised_price_cents)) return failure("The approved Anime price cannot be lower than its advertised base price.", 400);
      await db.batch([
        db.prepare("UPDATE tattoo_special_submission_terms SET approved_price_cents = ?, review_outcome = 'approved', updated_at = ? WHERE submission_id = ?").bind(approvedPrice, now, submissionId),
        db.prepare("UPDATE tattoo_session_plans SET approved_budget_min_cents = ?, approved_budget_max_cents = ?, artist_note = ?, updated_at = ? WHERE submission_id = ?").bind(approvedPrice, approvedPrice, note || `${row.offer_title} approved after complexity review.`, now, submissionId),
        db.prepare("UPDATE submissions SET status = 'approved', tattoo_stage = 'ready_to_book', internal_notes = ?, payload_json = json_set(payload_json, '$.approved_price_cents', ?), updated_at = ? WHERE id = ?").bind(note, approvedPrice, now, submissionId),
        db.prepare("INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at) VALUES (?, ?, 'special_review_approved', 'admin', ?, ?)").bind(crypto.randomUUID(), submissionId, `${row.offer_title} · ${money(approvedPrice)}${note ? ` · ${note}` : ""}`, now),
      ]);
      token = await createBookingAccess(db, request, submissionId, row, row.sales_closes_at);
      const normalized = { id: submissionId, type: SPECIAL_TYPE, contactName: row.contact_name, contactEmail: row.contact_email, contactPhone: row.contact_phone, contact: JSON.parse(row.contact_json || "{}"), payload: JSON.parse(row.payload_json || "{}") };
      await notifyBookingLinkCreated(env, request, normalized, { ...token, approvedBudget: { minCents: approvedPrice, maxCents: approvedPrice, currency: "USD" } });
    } else {
      const status = outcome === "declined" ? "declined" : "reviewing";
      await db.batch([
        db.prepare("UPDATE tattoo_special_submission_terms SET review_outcome = ?, updated_at = ? WHERE submission_id = ?").bind(outcome, now, submissionId),
        db.prepare("UPDATE submissions SET status = ?, tattoo_stage = 'review', internal_notes = ?, updated_at = ? WHERE id = ?").bind(status, note, now, submissionId),
        db.prepare("INSERT INTO submission_events (id, submission_id, event_type, actor, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)").bind(crypto.randomUUID(), submissionId, `special_review_${outcome}`, note, now),
      ]);
      const variant = row.variant_label ? ` - ${row.variant_label}` : "";
      const decisionCopy = outcome === "declined"
        ? "The Studio is not able to approve this project as a Tattoo Special. You can still use the normal tattoo inquiry path if you would like to discuss another direction."
        : "The Studio needs the design simplified before it can approve the advertised Tattoo Special price. Reply to the Studio note below with an adjusted direction or reference.";
      await sendCrmFollowupEmail(env, {
        to: row.contact_email,
        subject: outcome === "declined" ? "Your Tattoo Special review" : "Your Tattoo Special needs simplification",
        preheader: `${row.offer_title}${variant} review update`,
        emailTheme: "tattoo",
        text: [
          `Hi ${row.contact_name || "there"},`,
          "",
          `Tattoo Special: ${row.offer_title}${variant}`,
          `Advertised total: ${money(row.advertised_price_cents)}`,
          `Deposit at booking: ${money(row.deposit_cents)}`,
          `Appointment duration: ${Number(row.duration_minutes)} minutes`,
          "",
          decisionCopy,
          ...(note ? ["", `Studio note: ${note}`] : []),
        ].join("\n"),
        personId: row.crm_person_id || "",
        idempotencyKey: `tattoo_special_review_${outcome}:${submissionId}`,
      });
    }
    return json({ ok: true, outcome, approvedPriceCents: approvedPrice, bookingUrl: token?.bookingUrl || "" });
  } catch (error) {
    return failure("Unable to update the Tattoo Special review.", 500, { detail: error.message });
  }
}
