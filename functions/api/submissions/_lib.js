import {
  notifyAdminSubmissionReceived,
  notifySubmissionReceived,
} from "../notifications/_lib.js";
import { ingestCrmSourceRecord } from "../crm/ingest.js";
import { captureMarketingConsent } from "../outreach/_lib.js";

const VALID_STATUSES = new Set([
  "new",
  "reviewing",
  "approved",
  "declined",
  "booked",
  "cancelled",
  "archived",
]);

const PUBLIC_TYPES = new Set([
  "tattoo_inquiry",
  "flash_claim",
  "special_project",
  "build_brief",
  "maze_design",
  "art_acquisition",
]);

const TATTOO_SUBMISSION_TYPES = new Set([
  "tattoo_inquiry",
  "flash_claim",
  "special_project",
  "build_brief",
  "maze_design",
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

const TATTOO_STAGE_TRANSITIONS = {
  review: new Set(["consultation_required", "ready_to_book", "closed"]),
  consultation_required: new Set(["consultation_scheduled", "closed"]),
  consultation_scheduled: new Set(["consultation_required", "consultation_complete", "closed"]),
  consultation_complete: new Set(["ready_to_book", "closed"]),
  ready_to_book: new Set(["consultation_required", "tattoo_scheduled", "closed"]),
  tattoo_scheduled: new Set(["ready_to_book", "closed"]),
  closed: new Set(["review"]),
};

const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const STUDIO_TIME_ZONE = "America/New_York";
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/json",
]);
const FILE_LIMITS_BY_TYPE = {
  tattoo_inquiry: 6,
  flash_claim: 6,
  special_project: 6,
  build_brief: 6,
  maze_design: 2,
  art_acquisition: 4,
};

const REQUIRED_FIELDS_BY_TYPE = {
  tattoo_inquiry: [
    ["project_type", "Project type is required."],
    ["dob", "Date of birth is required."],
    ["previous_client", "Previous client status is required."],
    ["placement", "Placement is required."],
    ["size", "Approximate size is required."],
    ["budget_range", "Budget range is required."],
    ["color_preference", "Color preference is required."],
    ["message", "Project notes are required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  flash_claim: [
    ["selected_flash", "Available flash selection is required."],
    ["placement", "Placement is required."],
    ["claim_bid", "Budget range is required."],
    ["flash_claim_acknowledged", "Flash claim acknowledgement is required.", "yes"],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  build_brief: [
    ["placement", "Placement is required."],
    ["design_intent", "Design intent is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  maze_design: [
    ["maze_explanation", "A short explanation of your maze is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  special_project: [
    ["project_title", "Project call or working title is required."],
    ["placement", "Placement is required."],
    ["budget_range", "Budget range is required."],
    ["message", "Concept direction is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  art_acquisition: [
    ["painting", "Painting title is required."],
    ["inquiry_type", "Inquiry type is required."],
  ],
};

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

function notificationOutcome(result) {
  return {
    ok: Boolean(result?.ok),
    skipped: Boolean(result?.skipped),
    error: asString(result?.error || result?.detail),
  };
}

function submissionDb(env) {
  return env.SUBMISSIONS_DB || null;
}

function requireSubmissionDb(env) {
  const db = submissionDb(env);
  if (!db) {
    throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  }
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

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function normalizeIdempotencyKey(request, payload) {
  const value = asString(
    request.headers.get("idempotency-key") || payload.idempotencyKey || payload.idempotency_key
  );
  if (!value) return { value: null };
  if (value.length > 128 || /[\r\n\0]/.test(value)) {
    return { error: "Idempotency key must be 128 characters or fewer." };
  }
  return { value };
}

function canonicalizeFingerprintValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !["idempotencyKey", "idempotency_key", "_gotcha"].includes(key))
        .sort()
        .map((key) => [key, canonicalizeFingerprintValue(value[key])])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

async function submissionIdempotencyFingerprint(submission, payload, files) {
  const source = JSON.stringify({
    type: submission.type,
    contactEmail: submission.contact.email,
    payload: canonicalizeFingerprintValue(payload),
    files: (files || []).map((file) => ({
      fieldName: file.fieldName,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
    })),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function idempotencyIdentityMatches(existing, submission, fingerprint) {
  if (
    existing.type !== submission.type
    || normalizeEmail(existing.contact_email) !== submission.contact.email
  ) return false;
  const metadata = parseJsonField(existing.request_meta_json, {});
  return !metadata.idempotencyFingerprint || metadata.idempotencyFingerprint === fingerprint;
}

function isTattooSubmissionType(type) {
  return TATTOO_SUBMISSION_TYPES.has(type);
}

function submissionNeedsPrerequisiteConsultation(rowOrPayload) {
  const payload = rowOrPayload?.payload_json
    ? parseJsonField(rowOrPayload.payload_json, {})
    : rowOrPayload || {};
  return payload.project_type === "large_cover_up" || payload.consult_required === "yes";
}

function canTransitionTattooStage(from, to) {
  if (!from || from === to) return true;
  return Boolean(TATTOO_STAGE_TRANSITIONS[from]?.has(to));
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getRequestIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

function getUserAgent(request) {
  return request.headers.get("user-agent") || null;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== "")
  );
}

function formDataToObject(formData) {
  const payload = {};
  const files = [];

  for (const [key, value] of formData.entries()) {
    if (typeof File !== "undefined" && value instanceof File) {
      if (value.size > 0) {
        files.push({
          fieldName: key,
          fileName: value.name,
          contentType: value.type || "application/octet-stream",
          size: value.size,
          file: value,
        });
      }
      continue;
    }

    if (payload[key] === undefined) {
      payload[key] = value;
    } else if (Array.isArray(payload[key])) {
      payload[key].push(value);
    } else {
      payload[key] = [payload[key], value];
    }
  }

  return { payload, files };
}

async function readSubmissionBody(request) {
  const contentType = request.headers.get("content-type") || "";
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SUBMISSION_BYTES) {
    return { error: "Submission payload cannot exceed 50 MB.", status: 413 };
  }

  const reader = request.body?.getReader();
  const chunks = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SUBMISSION_BYTES) {
        await reader.cancel("Submission payload exceeds limit.").catch(() => {});
        return { error: "Submission payload cannot exceed 50 MB.", status: 413 };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(new TextDecoder().decode(bytes));
      return {
        payload: body && typeof body === "object" ? body : {},
        files: [],
      };
    } catch {
      return null;
    }
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    try {
      const formData = await new Response(bytes, {
        headers: { "content-type": contentType },
      }).formData();
      const parsed = formDataToObject(formData);
      const totalFileBytes = parsed.files.reduce((total, file) => total + Number(file.size || 0), 0);
      if (totalFileBytes > MAX_SUBMISSION_BYTES) {
        return { error: "Submission uploads cannot exceed 50 MB in total.", status: 413 };
      }
      return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeSubmission(payload, request) {
  const sourcePath = asOptionalString(payload.source_path || payload.sourcePath);
  const type = asString(payload.type || payload.form_type || "tattoo_inquiry")
    .replace(/^standard_/, "")
    .replace(/^new_/, "");
  const normalizedType =
    type === "tattoo_inquiry" || type === "tattoo_inquiry_form"
      ? "tattoo_inquiry"
      : type;

  const firstName = asOptionalString(payload.firstName || payload.first_name);
  const lastName = asOptionalString(payload.lastName || payload.last_name);
  const name =
    asOptionalString(payload.name) ||
    [firstName, lastName].filter(Boolean).join(" ").trim();
  const email = normalizeEmail(payload.email || payload.from_email);
  const phone = asOptionalString(payload.phone);

  return {
    type: normalizedType,
    status: "new",
    sourcePath,
    subject: asOptionalString(payload.subject),
    contact: compactObject({
      name,
      firstName,
      lastName,
      email,
      phone,
      instagram: asOptionalString(payload.instagram),
      pronouns: asOptionalString(payload.pronouns),
      preferredName: asOptionalString(payload.preferredName || payload.preferred_name),
      preferredContactMethod: asOptionalString(
        payload.preferredContactMethod || payload.preferred_contact_method
      ),
      referralSource: asOptionalString(payload.referralSource || payload.referral_source),
    }),
    payload,
    requestMeta: compactObject({
      ip: getRequestIp(request),
      userAgent: getUserAgent(request),
      referer: request.headers.get("referer"),
    }),
  };
}

function validateSubmission(submission, payload) {
  if (asString(payload._gotcha)) {
    return { spam: true };
  }

  if (!PUBLIC_TYPES.has(submission.type)) {
    return {
      error: `Unsupported submission type: ${submission.type || "(blank)"}.`,
      status: 400,
    };
  }

  if (!submission.contact.name) {
    return { error: "Name is required.", status: 400 };
  }

  if (!submission.contact.email || !isLikelyEmail(submission.contact.email)) {
    return { error: "A valid email is required.", status: 400 };
  }

  if (TATTOO_SUBMISSION_TYPES.has(submission.type) && payload.age_confirmed !== "yes") {
    return { error: "You must confirm that you are 18 or older.", status: 400 };
  }

  if (submission.type === "tattoo_inquiry" && !isAtLeastEighteen(payload.dob)) {
    return { error: "Tattoo inquiries require a valid date of birth confirming age 18 or older.", status: 400 };
  }

  if (submission.type === "build_brief") {
    const symbols = parseStableSymbolIds(payload);
    if (symbols.error) return { error: symbols.error, status: 400 };
  }

  if (submission.type === "special_project" && /^(other|something new)$/i.test(asString(payload.project_title))) {
    return {
      error: "New concepts should use the Custom Tattoo inquiry instead of a Special Project call.",
      status: 409,
      code: "ROUTE_TO_CUSTOM",
      redirect: "/tattoos/inquire/custom/",
    };
  }

  const requiredFields = REQUIRED_FIELDS_BY_TYPE[submission.type] || [];
  for (const [field, message, exactValue] of requiredFields) {
    if (exactValue !== undefined) {
      if (payload[field] !== exactValue) {
        return { error: message, status: 400 };
      }
    } else if (!asString(payload[field])) {
      return { error: message, status: 400 };
    }
  }

  return null;
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
  if (!expectedToken) {
    return errorResponse("Admin submissions are not configured.", 503);
  }

  if (authTokenFromRequest(request) !== expectedToken) {
    return errorResponse("Unauthorized.", 401);
  }

  return null;
}

function createSubmissionId() {
  return crypto.randomUUID();
}

async function saveSubmissionFiles(env, submissionId, files) {
  const saved = [];
  const bucket = env.SUBMISSION_FILES || null;

  for (const file of files) {
    const fileId = crypto.randomUUID();
    const key = `submissions/${submissionId}/${fileId}-${file.fileName}`;
    let stored = false;

    if (bucket) {
      await bucket.put(key, file.file.stream(), {
        httpMetadata: { contentType: file.contentType },
        customMetadata: {
          submissionId,
          fieldName: file.fieldName,
          originalName: file.fileName,
        },
      });
      stored = true;
    }

    saved.push({
      id: fileId,
      fieldName: file.fieldName,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      storageKey: stored ? key : null,
      stored,
    });
  }

  return saved;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  const flashReservation = row.reserved_flash_id ? {
    flashId: row.reserved_flash_id,
    title: row.reserved_flash_title || "",
    state: row.reserved_flash_state || "",
    reservedSubmissionId: row.reserved_flash_submission_id || "",
    ownedBySubmission: row.reserved_flash_submission_id === row.id,
    conflictSubmissionId: row.reserved_flash_submission_id && row.reserved_flash_submission_id !== row.id
      ? row.reserved_flash_submission_id
      : "",
  } : null;
  const flashConflict = flashReservation?.conflictSubmissionId
    ? `Reserved by submission ${flashReservation.conflictSubmissionId}`
    : "";
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    tattooStage: row.tattoo_stage || "",
    lifecycleReviewRequired: Boolean(row.lifecycle_review_required),
    lifecycleReviewNote: row.lifecycle_review_note || "",
    idempotencyKey: row.idempotency_key || "",
    sourcePath: row.source_path,
    subject: row.subject,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contact: parseJsonField(row.contact_json, {}),
    payload: parseJsonField(row.payload_json, {}),
    requestMeta: parseJsonField(row.request_meta_json, {}),
    files: parseJsonField(row.files_json, []),
    internalNotes: row.internal_notes || "",
    bookingUrl: row.booking_url || "",
    flashReservation,
    flashConflict,
    flash_conflict: flashConflict,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function crmNodeForSubmission(type, payload = {}) {
  if (["tattoo_inquiry", "flash_claim", "special_project", "build_brief", "maze_design", "consultation", "build_session"].includes(type)) {
    return "node-tattoos";
  }
  if (type === "art_acquisition") return "node-art";
  if (type === "studio_booking") {
    return payload.booking_type_id === "studio_visit" ? "node-art" : "node-events";
  }
  if (/event|rsvp|waitlist|open_mic/.test(type)) return "node-events";
  if (/merch|shop|order/.test(type)) return "node-merch";
  return null;
}

async function mirrorSubmissionToCrm(database, row) {
  if (!row?.id) return { status: "skipped", reason: "source_required" };
  const contact = row.contact && typeof row.contact === "object"
    ? row.contact
    : parseJsonField(row.contact_json, {});
  const payload = row.payload && typeof row.payload === "object"
    ? row.payload
    : parseJsonField(row.payload_json, {});
  const type = row.type || "";
  try {
    return await ingestCrmSourceRecord(database, {
      contact: {
        displayName: row.contactName || row.contact_name || contact.name,
        email: row.contactEmail || row.contact_email || contact.email,
        phone: row.contactPhone || row.contact_phone || contact.phone,
        instagram: contact.instagram,
        organization: contact.organization || payload.organization,
        pronouns: contact.pronouns,
        preferredName: contact.preferredName || contact.preferred_name
          || payload.preferredName || payload.preferred_name,
        preferredContactMethod: contact.preferredContactMethod || contact.preferred_contact_method
          || payload.preferredContactMethod || payload.preferred_contact_method,
        referralSource: contact.referralSource || contact.referral_source
          || payload.referralSource || payload.referral_source,
      },
      interaction: {
        sourceProvider: "local",
        sourceType: "submission",
        sourceId: row.id,
        nodeId: crmNodeForSubmission(type, payload),
        channel: "website",
        interactionType: type || "submission",
        label: row.subject || type || "Website submission",
        status: row.status || "new",
        occurredAt: row.createdAt || row.created_at,
        metadata: {
          submissionId: row.id,
          sourcePath: row.sourcePath || row.source_path || "",
        },
      },
    });
  } catch (error) {
    // The source submission remains authoritative; the protected CRM backfill
    // can reconcile this record if live mirroring is temporarily unavailable.
    console.warn(JSON.stringify({
      event: "crm.live_mirror_failed",
      sourceType: "submission",
      sourceId: String(row.id),
      errorName: error?.name || "Error",
    }));
    return { status: "skipped", reason: "ingest_failed" };
  }
}

function validateSubmissionFiles(type, files, env) {
  const limit = FILE_LIMITS_BY_TYPE[type] ?? 4;
  if (files.length > limit) {
    return { error: `This form accepts at most ${limit} uploaded files.`, status: 413 };
  }
  if (files.length && !env.SUBMISSION_FILES) {
    return { error: "Submission file storage is unavailable. No files were accepted; please try again later.", status: 503 };
  }
  for (const file of files) {
    if (Number(file.size || 0) > MAX_FILE_BYTES) {
      return { error: `${file.fileName} exceeds the 15 MB per-file limit.`, status: 413 };
    }
    if (!ALLOWED_UPLOAD_TYPES.has(String(file.contentType || "").toLowerCase())) {
      return { error: `${file.fileName} uses an unsupported file type.`, status: 415 };
    }
  }
  return null;
}

function parseStableSymbolIds(payload) {
  const raw = payload.symbol_ids ?? payload.selected_symbol_ids ?? [];
  const ids = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map(asString)
    .filter(Boolean);
  if (ids.length < 1 || ids.length > 12) {
    return { error: "Choose between 1 and 12 managed Legend symbols." };
  }
  if (new Set(ids).size !== ids.length) {
    return { error: "Legend symbol selections cannot contain duplicates." };
  }
  return { ids };
}

function isAtLeastEighteen(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(dateValue));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) return false;
  const today = calendarDatePartsInZone(new Date(), STUDIO_TIME_ZONE);
  let age = today.year - year;
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  return age >= 18;
}

function calendarDatePartsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function addCalendarDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatCalendarDate(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

async function validateMazeArtifacts(files) {
  const png = files.find((file) => file.fieldName === "maze_image" && file.contentType === "image/png");
  const jsonFile = files.find((file) => file.fieldName === "maze_json_file" && file.contentType === "application/json");
  if (!png || !jsonFile) {
    return { error: "Maze submissions require both the generated PNG and JSON design artifacts." };
  }
  const signature = new Uint8Array(await png.file.slice(0, 8).arrayBuffer());
  const expected = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.length !== expected.length || expected.some((byte, index) => signature[index] !== byte)) {
    return { error: "The maze image artifact is not a valid PNG file." };
  }
  if (jsonFile.size > 2 * 1024 * 1024) {
    return { error: "The maze JSON artifact cannot exceed 2 MB." };
  }
  let design;
  try {
    design = JSON.parse(await jsonFile.file.text());
  } catch {
    return { error: "The maze JSON artifact is invalid." };
  }
  const walls = Array.isArray(design?.mazeWalls) ? design.mazeWalls : [];
  const shapes = Array.isArray(design?.mazeShapes) ? design.mazeShapes : [];
  if (!walls.length && !shapes.length) {
    return { error: "Draw at least one maze wall or shape before submitting." };
  }
  return { designSummary: { wallCount: walls.length, shapeCount: shapes.length } };
}

function normalizedLegacyPath(value) {
  const raw = asString(value);
  if (!raw) return "";
  try {
    return new URL(raw, "https://thesixwellconstruct.com").pathname;
  } catch {
    return raw;
  }
}

async function resolveFlashReference(db, payload) {
  const snapshot = payload?.flash_snapshot && typeof payload.flash_snapshot === "object"
    ? payload.flash_snapshot
    : {};
  const reference = asString(
    snapshot.id || payload?.flash_id || payload?.flashId || payload?.selected_flash
  );
  const path = normalizedLegacyPath(
    snapshot.legacyPath || payload?.flash_path || payload?.flashPath || reference
  );
  if (!reference && !path) return null;
  return db.prepare(
    `SELECT id, slug, title, state, claimable, legacy_path, reserved_submission_id,
            price_label, session_category, split_policy, estimated_sessions_min,
            estimated_sessions_max, estimated_total_minutes_min,
            estimated_total_minutes_max, session_plan_note, process_category
     FROM flash_items
     WHERE id = ? OR slug = ? OR legacy_path = ? OR legacy_path = ?
     ORDER BY CASE WHEN id = ? THEN 0 WHEN slug = ? THEN 1 ELSE 2 END
     LIMIT 1`
  ).bind(reference, reference, reference, path, reference, reference).first();
}

export async function handleCreateSubmission(request, env) {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const source = new URL(referer);
      const target = new URL(request.url);
      if (source.origin === target.origin && source.searchParams.get("preview") === "1") {
        return errorResponse("Preview mode cannot create submissions.", 403, {
          code: "PREVIEW_WRITE_BLOCKED",
        });
      }
    } catch {
      // Ignore malformed cross-site Referer values; normal validation still applies.
    }
  }
  const body = await readSubmissionBody(request);
  if (!body) return errorResponse("Expected JSON or form data.", 400);
  if (body.error) return errorResponse(body.error, body.status || 400);

  const submission = normalizeSubmission(body.payload, request);
  const validation = validateSubmission(submission, body.payload);
  if (validation?.spam) {
    return json({ ok: true, submissionId: null, spam: true });
  }

  if (validation?.error) {
    return errorResponse(validation.error, validation.status, {
      ...(validation.code ? { code: validation.code } : {}),
      ...(validation.redirect ? { redirect: validation.redirect } : {}),
    });
  }

  const fileValidation = validateSubmissionFiles(submission.type, body.files, env);
  if (fileValidation) return errorResponse(fileValidation.error, fileValidation.status);

  const idempotency = normalizeIdempotencyKey(request, body.payload);
  if (idempotency.error) return errorResponse(idempotency.error, 400);
  const idempotencyFingerprint = idempotency.value
    ? await submissionIdempotencyFingerprint(submission, body.payload, body.files)
    : "";
  if (idempotencyFingerprint) {
    submission.requestMeta.idempotencyFingerprint = idempotencyFingerprint;
  }

  let savedFiles = [];

  try {
    const db = requireSubmissionDb(env);
    if (idempotency.value) {
      const existing = await db.prepare("SELECT * FROM submissions WHERE idempotency_key = ?")
        .bind(idempotency.value)
        .first();
      if (existing) {
        if (!idempotencyIdentityMatches(existing, submission, idempotencyFingerprint)) {
          return errorResponse("That idempotency key was already used for a different submission request.", 409, {
            code: "IDEMPOTENCY_IDENTITY_MISMATCH",
          });
        }
        const normalized = normalizeRow(existing);
        await mirrorSubmissionToCrm(db, existing);
        return json({
          ok: true,
          submissionId: normalized.id,
          filesStored: normalized.files.filter((file) => file.stored).length,
          filesReceived: normalized.files.length,
          idempotent: true,
        });
      }
    }

    if (submission.type === "tattoo_inquiry" && asString(body.payload.requested_date)) {
      const settings = await db.prepare(
        "SELECT lead_time_days FROM tattoo_settings WHERE id = 'default'"
      ).first();
      const leadTimeDays = Math.max(0, Number(settings?.lead_time_days ?? 14));
      const requestedDate = asString(body.payload.requested_date);
      const requestedMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requestedDate);
      const requested = requestedMatch
        ? new Date(Date.UTC(Number(requestedMatch[1]), Number(requestedMatch[2]) - 1, Number(requestedMatch[3])))
        : new Date("invalid");
      const requestedIsValid = Boolean(
        requestedMatch
        && requested.getUTCFullYear() === Number(requestedMatch[1])
        && requested.getUTCMonth() === Number(requestedMatch[2]) - 1
        && requested.getUTCDate() === Number(requestedMatch[3])
      );
      const minimumParts = addCalendarDays(
        calendarDatePartsInZone(new Date(), STUDIO_TIME_ZONE),
        leadTimeDays,
      );
      const minimumDate = formatCalendarDate(minimumParts);
      if (!requestedIsValid || requestedDate < minimumDate) {
        return errorResponse(`Requested dates must be at least ${leadTimeDays} days from today.`, 400, {
          code: "REQUESTED_DATE_TOO_SOON",
          minimumRequestedDate: minimumDate,
        });
      }
    }

    if (submission.type === "special_project") {
      const selectedCall = asString(
        body.payload.special_project_slug || body.payload.project_slug || body.payload.project_title
      );
      const call = await db.prepare(
        `SELECT * FROM special_project_calls
         WHERE id = ? OR slug = ? OR lower(title) = lower(?)
         ORDER BY CASE WHEN id = ? THEN 0 WHEN slug = ? THEN 1 ELSE 2 END
         LIMIT 1`
      ).bind(selectedCall, selectedCall, selectedCall, selectedCall, selectedCall).first();
      const now = new Date().toISOString();
      const isOpen = call && call.status === "open"
        && (!call.opens_at || call.opens_at <= now)
        && (!call.closes_at || call.closes_at > now);
      if (!isOpen) {
        return errorResponse("That Special Project call is not currently open.", 409, {
          code: "SPECIAL_PROJECT_CLOSED",
          redirect: "/tattoos/special-projects/",
        });
      }
      body.payload.special_project_snapshot = {
        id: call.id,
        slug: call.slug,
        title: call.title,
        summary: call.summary || "",
        rateText: call.rate_text || "",
        status: call.status,
      };
      body.payload.project_title = call.title;
    }

    if (submission.type === "maze_design") {
      const maze = await validateMazeArtifacts(body.files);
      if (maze.error) {
        return errorResponse(maze.error, 400, { code: "INVALID_MAZE_ARTIFACTS" });
      }
      body.payload.maze_artifact_snapshot = maze.designSummary;
    }

    if (submission.type === "flash_claim") {
      const flash = await resolveFlashReference(db, body.payload);
      if (!flash || flash.state !== "available" || Number(flash.claimable) !== 1) {
        return errorResponse("That flash is no longer available. Refresh the flash catalog and choose another design.", 409, { code: "FLASH_UNAVAILABLE" });
      }
      body.payload.flash_snapshot = {
        id: flash.id,
        slug: flash.slug,
        legacyPath: flash.legacy_path || "",
        title: flash.title,
        state: flash.state,
        claimable: true,
        priceLabel: flash.price_label || "",
        sessionCategory: flash.session_category || "artist_review",
        splitPolicy: flash.split_policy || "artist_review",
        estimatedSessionsMin: flash.estimated_sessions_min ?? null,
        estimatedSessionsMax: flash.estimated_sessions_max ?? null,
        estimatedTotalMinutesMin: flash.estimated_total_minutes_min ?? null,
        estimatedTotalMinutesMax: flash.estimated_total_minutes_max ?? null,
        sessionPlanNote: flash.session_plan_note || "",
        processCategory: flash.process_category || "standard",
      };
      const managedPlanRequiresAcknowledgement =
        flash.session_category !== "artist_review" || flash.split_policy !== "artist_review";
      if (managedPlanRequiresAcknowledgement && asString(body.payload.session_plan_acknowledged) !== "yes") {
        return errorResponse("Acknowledge the managed flash session plan before submitting this claim.", 400, {
          code: "SESSION_PLAN_ACKNOWLEDGEMENT_REQUIRED",
        });
      }
    }

    if (submission.type === "build_brief") {
      const symbolSelection = parseStableSymbolIds(body.payload);
      if (symbolSelection.error) return errorResponse(symbolSelection.error, 400);
      const placeholders = symbolSelection.ids.map(() => "?").join(",");
      const result = await db.prepare(`SELECT v.id,v.name,v.meaning,v.svg_markup,v.themes_json,c.name category FROM visual_symbols v JOIN visual_symbol_categories c ON c.id=v.category_id WHERE v.id IN (${placeholders}) AND v.state='published'`).bind(...symbolSelection.ids).all();
      const symbolsById = new Map((result.results || []).map((symbol) => [symbol.id, symbol]));
      if (symbolsById.size !== symbolSelection.ids.length) {
        return errorResponse("One or more selected symbols are unavailable. Refresh and try again.", 409, { code: "SYMBOL_UNAVAILABLE" });
      }
      body.payload.symbol_ids = symbolSelection.ids;
      body.payload.symbol_snapshot = symbolSelection.ids.map((symbolId, index) => {
        const symbol = symbolsById.get(symbolId);
        return {
          id: symbol.id,
          order: index,
          name: symbol.name,
          meaning: symbol.meaning,
          category: symbol.category,
          themes: parseJsonField(symbol.themes_json, []),
          imagery: symbol.svg_markup,
        };
      });
    }
    submission.payload = body.payload;
    const id = createSubmissionId();
    savedFiles = await saveSubmissionFiles(env, id, body.files);
    const now = new Date().toISOString();
    const tattooStage = isTattooSubmissionType(submission.type) ? "review" : null;

    await db.batch([
      db.prepare(
        `INSERT INTO submissions (
          id, type, status, source_path, subject, contact_name, contact_email,
          contact_phone, contact_json, payload_json, request_meta_json,
          files_json, tattoo_stage, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        submission.type,
        submission.status,
        submission.sourcePath,
        submission.subject,
        submission.contact.name,
        submission.contact.email,
        submission.contact.phone || null,
        JSON.stringify(submission.contact),
        JSON.stringify(submission.payload),
        JSON.stringify(submission.requestMeta),
        JSON.stringify(savedFiles),
        tattooStage,
        idempotency.value,
        now,
        now
      ),
      db.prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), id, "created", "system", null, now),
    ]);

    await mirrorSubmissionToCrm(db, {
      id,
      type: submission.type,
      status: submission.status,
      sourcePath: submission.sourcePath,
      subject: submission.subject,
      contact: submission.contact,
      payload: submission.payload,
      createdAt: now,
    });

    await captureMarketingConsent(env, {
      email: submission.contact.email,
      phone: submission.contact.phone,
      emailOptIn: body.payload.newsletter_consent,
      smsOptIn: body.payload.sms_marketing_consent,
      source: "submission_form",
      sourceId: id,
      formPath: submission.sourcePath || request.url,
      occurredAt: now,
      requestId: request.headers.get("cf-ray") || "",
    }).catch((error) => {
      console.error("Unable to record optional submission marketing consent.", error);
    });

    const clientNotification = await notifySubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
    });
    const adminNotification = await notifyAdminSubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
    });

    return json({
      ok: true,
      submissionId: id,
      filesStored: savedFiles.filter((file) => file.stored).length,
      filesReceived: savedFiles.length,
      notifications: {
        client: notificationOutcome(clientNotification),
        admin: notificationOutcome(adminNotification),
      },
    });
  } catch (error) {
    if (idempotency.value && String(error.message || error).includes("UNIQUE constraint failed")) {
      try {
        const db = requireSubmissionDb(env);
        const existing = await db.prepare("SELECT * FROM submissions WHERE idempotency_key = ?")
          .bind(idempotency.value)
          .first();
        if (existing) {
          const bucket = env.SUBMISSION_FILES || null;
          if (bucket) {
            for (const file of savedFiles) {
              if (file.storageKey) await bucket.delete(file.storageKey);
            }
          }
          if (!idempotencyIdentityMatches(existing, submission, idempotencyFingerprint)) {
            return errorResponse("That idempotency key was already used for a different submission request.", 409, {
              code: "IDEMPOTENCY_IDENTITY_MISMATCH",
            });
          }
          const normalized = normalizeRow(existing);
          await mirrorSubmissionToCrm(db, existing);
          return json({
            ok: true,
            submissionId: normalized.id,
            filesStored: normalized.files.filter((file) => file.stored).length,
            filesReceived: normalized.files.length,
            idempotent: true,
          });
        }
      } catch {
        // Fall through to the original storage error below.
      }
    }
    return errorResponse("Unable to save submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleListSubmissions(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireSubmissionDb(env);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    const filters = [];
    const bindings = [];
    if (status) {
      filters.push("s.status = ?");
      bindings.push(status);
    }
    if (type) {
      filters.push("s.type = ?");
      bindings.push(type);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await db
      .prepare(
        `SELECT s.*,
                fi.id AS reserved_flash_id,
                fi.title AS reserved_flash_title,
                fi.state AS reserved_flash_state,
                fi.reserved_submission_id AS reserved_flash_submission_id
         FROM submissions s
         LEFT JOIN flash_items fi ON s.type = 'flash_claim' AND (
           fi.id = json_extract(s.payload_json, '$.flash_snapshot.id')
           OR fi.id = json_extract(s.payload_json, '$.flash_id')
           OR fi.slug = json_extract(s.payload_json, '$.selected_flash')
           OR fi.legacy_path = json_extract(s.payload_json, '$.flash_path')
         )
         ${where} ORDER BY s.created_at DESC LIMIT ?`
      )
      .bind(...bindings, limit)
      .all();

    return json({ submissions: (result.results || []).map(normalizeRow) });
  } catch (error) {
    return errorResponse("Unable to load submissions.", 500, {
      detail: error.message,
    });
  }
}

export async function handleGetSubmission(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireSubmissionDb(env);
    const row = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!row) return errorResponse("Submission not found.", 404);

    const events = await db
      .prepare(
        "SELECT * FROM submission_events WHERE submission_id = ? ORDER BY created_at ASC"
      )
      .bind(id)
      .all();

    const notifications = await db
      .prepare(
        `SELECT id, channel, template_key, recipient, subject, related_type, related_id,
                status, error, sent_at, created_at
         FROM notification_deliveries
         WHERE (related_type = 'submission' AND related_id = ?)
            OR (related_type = 'appointment' AND related_id IN (
              SELECT id FROM appointments WHERE submission_id = ?
            ))
         ORDER BY created_at DESC`
      )
      .bind(id, id)
      .all();

    const appointmentEvents = await db.prepare(
      `SELECT ae.* FROM appointment_events ae
       JOIN appointments a ON a.id = ae.appointment_id
       WHERE a.submission_id = ?
       ORDER BY ae.created_at ASC`
    ).bind(id).all();

    let flashReservation = null;
    if (row.type === "flash_claim") {
      const flash = await resolveFlashReference(db, parseJsonField(row.payload_json, {}));
      if (flash) {
        flashReservation = {
          flashId: flash.id,
          slug: flash.slug,
          title: flash.title,
          state: flash.state,
          claimable: Boolean(flash.claimable),
          reservedSubmissionId: flash.reserved_submission_id || "",
          ownedBySubmission: flash.reserved_submission_id === id,
          conflictSubmissionId: flash.reserved_submission_id && flash.reserved_submission_id !== id
            ? flash.reserved_submission_id
            : "",
        };
      }
    }

    const normalized = normalizeRow(row);
    const flashConflict = flashReservation?.conflictSubmissionId
      ? `Reserved by submission ${flashReservation.conflictSubmissionId}`
      : "";
    return json({
      submission: {
        ...normalized,
        flashReservation,
        flashConflict,
        flash_conflict: flashConflict,
      },
      events: events.results || [],
      appointmentEvents: appointmentEvents.results || [],
      notifications: notifications.results || [],
    });
  } catch (error) {
    return errorResponse("Unable to load submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleUpdateSubmission(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Expected JSON body.", 400);
  }

  const status = asOptionalString(body.status);
  const requestedTattooStage = asOptionalString(body.tattooStage || body.tattoo_stage);
  const systemOwnedTattooStages = new Set([
    "consultation_scheduled",
    "consultation_complete",
    "ready_to_book",
    "tattoo_scheduled",
  ]);

  if (status && !VALID_STATUSES.has(status)) {
    return errorResponse(`Unsupported status: ${status}.`, 400);
  }
  if (requestedTattooStage && !TATTOO_STAGES.has(requestedTattooStage)) {
    return errorResponse(`Unsupported tattoo stage: ${requestedTattooStage}.`, 400);
  }

  try {
    const db = requireSubmissionDb(env);
    const current = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Submission not found.", 404);

    if (status === "booked" && current.status !== "booked") {
      return errorResponse("Booked status is set only after payment confirmation.", 409, {
        code: "SYSTEM_OWNED_BOOKING_STATUS",
      });
    }
    if (requestedTattooStage && systemOwnedTattooStages.has(requestedTattooStage)) {
      return errorResponse("That tattoo stage is advanced only by its booking or completion workflow.", 409, {
        code: "SYSTEM_OWNED_TATTOO_STAGE",
      });
    }

    const changesLifecycle = (status && status !== current.status)
      || (requestedTattooStage && requestedTattooStage !== current.tattoo_stage);
    if (changesLifecycle) {
      const blockingAppointment = await db.prepare(
        `SELECT id, status, hold_state FROM appointments
         WHERE submission_id = ?
           AND (
             status = 'confirmed'
             OR (
               status IN ('pending_deposit','deposit_pending')
               AND hold_state IN ('active','expiry_attention')
             )
           )
         ORDER BY created_at DESC LIMIT 1`
      ).bind(id).first();
      if (blockingAppointment) {
        return errorResponse("Release the pending checkout or cancel the confirmed appointment before changing this submission lifecycle.", 409, {
          code: "ACTIVE_APPOINTMENT_BLOCKS_LIFECYCLE_EDIT",
          appointmentId: blockingAppointment.id,
          appointmentStatus: blockingAppointment.status,
          holdState: blockingAppointment.hold_state || "",
        });
      }
    }

    const isTattoo = isTattooSubmissionType(current.type);
    if (requestedTattooStage && !isTattoo) {
      return errorResponse("Tattoo stages apply only to tattoo project submissions.", 409);
    }

    const nextStatus = status || current.status;
    let nextTattooStage = current.tattoo_stage || (isTattoo ? "review" : null);
    if (isTattoo && nextStatus === "approved" && current.status !== "approved") {
      if (submissionNeedsPrerequisiteConsultation(current)) {
        nextTattooStage = "consultation_required";
      } else {
        const plan = await db.prepare(
          `SELECT session_category, split_policy FROM tattoo_session_plans WHERE submission_id = ?`
        ).bind(id).first();
        nextTattooStage = plan && plan.session_category !== "artist_review" && plan.split_policy !== "artist_review"
          ? "ready_to_book"
          : "review";
      }
    }
    if (requestedTattooStage) nextTattooStage = requestedTattooStage;
    if (isTattoo && ["declined", "cancelled", "archived"].includes(nextStatus)) {
      nextTattooStage = "closed";
    }
    if (isTattoo && !canTransitionTattooStage(current.tattoo_stage || "review", nextTattooStage)) {
      return errorResponse(
        `Tattoo stage cannot move from ${current.tattoo_stage || "review"} to ${nextTattooStage}.`,
        409,
        { code: "INVALID_TATTOO_STAGE_TRANSITION" }
      );
    }
    if (
      isTattoo &&
      submissionNeedsPrerequisiteConsultation(current) &&
      nextTattooStage === "ready_to_book" &&
      !["consultation_complete", "ready_to_book"].includes(current.tattoo_stage)
    ) {
      return errorResponse("Large cover-up projects require a completed prerequisite consultation before tattoo booking.", 409);
    }

    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const internalNotes = hasOwn("internalNotes") ? asString(body.internalNotes) : current.internal_notes;
    const bookingUrl = hasOwn("bookingUrl") ? asString(body.bookingUrl) : current.booking_url;
    const lifecycleReviewRequired = hasOwn("lifecycleReviewRequired")
      ? (body.lifecycleReviewRequired ? 1 : 0)
      : Number(current.lifecycle_review_required || 0);
    const lifecycleReviewNote = hasOwn("lifecycleReviewNote")
      ? asString(body.lifecycleReviewNote).slice(0, 2000)
      : (lifecycleReviewRequired ? current.lifecycle_review_note || "" : "");
    const now = new Date().toISOString();
    const statusChanged = nextStatus !== current.status;
    const stageChanged = nextTattooStage !== current.tattoo_stage;
    const eventType = statusChanged ? "status_changed" : stageChanged ? "tattoo_stage_changed" : "updated";
    const eventNote = [
      statusChanged ? `${current.status} -> ${nextStatus}` : "",
      stageChanged ? `${current.tattoo_stage || "(none)"} -> ${nextTattooStage}` : "",
    ].filter(Boolean).join("; ") || null;

    const updateStatement = db.prepare(
        `UPDATE submissions
         SET status = ?, tattoo_stage = ?, internal_notes = ?, booking_url = ?,
             lifecycle_review_required = ?, lifecycle_review_note = ?, updated_at = ?
         WHERE id = ? AND updated_at = ? AND status = ?
           AND COALESCE(tattoo_stage, '') = COALESCE(?, '')
           AND (
             ? = 0 OR NOT EXISTS (
               SELECT 1 FROM appointments active_appointment
               WHERE active_appointment.submission_id = submissions.id
                 AND (
                   active_appointment.status = 'confirmed'
                   OR (
                     active_appointment.status IN ('pending_deposit','deposit_pending')
                     AND active_appointment.hold_state IN ('active','expiry_attention')
                   )
                 )
             )
           )`
      ).bind(
        nextStatus,
        nextTattooStage,
        internalNotes,
        bookingUrl,
        lifecycleReviewRequired,
        lifecycleReviewNote,
        now,
        id,
        current.updated_at,
        current.status,
        current.tattoo_stage,
        changesLifecycle ? 1 : 0,
      );
    const eventStatement = db.prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        )
        SELECT ?, id, ?, 'admin', ?, ? FROM submissions WHERE id = ? AND updated_at = ?`
      ).bind(
        crypto.randomUUID(),
        eventType,
        eventNote,
        now,
        id,
        now,
      );

    let updateIndex = 0;
    let statements = [updateStatement, eventStatement];
    if (current.type === "flash_claim" && nextStatus === "approved" && current.status !== "approved") {
      const flash = await resolveFlashReference(db, parseJsonField(current.payload_json, {}));
      if (!flash) {
        return errorResponse("The flash attached to this claim could not be resolved.", 409, {
          code: "FLASH_NOT_FOUND",
        });
      }
      const reserveStatement = db.prepare(
        `UPDATE flash_items
         SET state = 'reserved', claimable = 0, reserved_submission_id = ?, updated_at = ?
         WHERE id = ? AND (
           (state = 'available' AND claimable = 1 AND reserved_submission_id IS NULL)
           OR reserved_submission_id = ?
         ) AND EXISTS (
           SELECT 1 FROM submissions s
           WHERE s.id = ? AND s.updated_at = ? AND s.status = ?
             AND COALESCE(s.tattoo_stage, '') = COALESCE(?, '')
             AND NOT EXISTS (
               SELECT 1 FROM appointments active_appointment
               WHERE active_appointment.submission_id = s.id
                 AND (
                   active_appointment.status = 'confirmed'
                   OR (
                     active_appointment.status IN ('pending_deposit','deposit_pending')
                     AND active_appointment.hold_state IN ('active','expiry_attention')
                   )
                 )
             )
         )`
      ).bind(
        id,
        now,
        flash.id,
        id,
        id,
        current.updated_at,
        current.status,
        current.tattoo_stage,
      );
      const guardedUpdate = db.prepare(
        `UPDATE submissions
         SET status = ?, tattoo_stage = ?, internal_notes = ?, booking_url = ?,
             lifecycle_review_required = ?, lifecycle_review_note = ?, updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM flash_items f WHERE f.id = ? AND f.reserved_submission_id = ?
         ) AND updated_at = ? AND status = ?
           AND COALESCE(tattoo_stage, '') = COALESCE(?, '')
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
      ).bind(
        nextStatus,
        nextTattooStage,
        internalNotes,
        bookingUrl,
        lifecycleReviewRequired,
        lifecycleReviewNote,
        now,
        id,
        flash.id,
        id,
        current.updated_at,
        current.status,
        current.tattoo_stage,
      );
      statements = [reserveStatement, guardedUpdate, eventStatement];
      updateIndex = 1;
    }

    if (current.type === "flash_claim" && ["declined", "cancelled", "archived"].includes(nextStatus)) {
      statements.push(db.prepare(
        `UPDATE flash_items
         SET state = 'available', claimable = 1, reserved_submission_id = NULL, updated_at = ?
         WHERE reserved_submission_id = ? AND state = 'reserved'
           AND EXISTS (
             SELECT 1 FROM submissions s
             WHERE s.id = ? AND s.updated_at = ? AND s.status = ?
               AND COALESCE(s.tattoo_stage, '') = COALESCE(?, '')
           )`
      ).bind(now, id, id, now, nextStatus, nextTattooStage));
    }

    const results = await db.batch(statements);
    if (Number(results?.[updateIndex]?.meta?.changes || 0) < 1) {
      if (current.type === "flash_claim" && nextStatus === "approved") {
        return errorResponse("That flash was reserved by another approved claim.", 409, {
          code: "FLASH_RESERVATION_CONFLICT",
        });
      }
      return errorResponse("Submission changed before the update could be saved.", 409);
    }

    const updated = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    await mirrorSubmissionToCrm(db, updated);
    return json({ submission: normalizeRow(updated) });
  } catch (error) {
    return errorResponse("Unable to update submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleDeleteSubmission(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const db = requireSubmissionDb(env);
    const current = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Submission not found.", 404);

    const appointmentCount = await db
      .prepare("SELECT COUNT(*) AS count FROM appointments WHERE submission_id = ?")
      .bind(id)
      .first();
    if (!force && Number(appointmentCount?.count || 0) > 0) {
      return errorResponse("Submission has appointment history. Archive it instead of deleting.", 409);
    }

    if (!force && ["booked", "paid", "cancelled", "archived"].includes(current.status)) {
      return errorResponse("Submission has protected lifecycle history. Archive it instead of deleting.", 409);
    }

    const reservation = await db
      .prepare("SELECT id FROM flash_items WHERE reserved_submission_id = ? LIMIT 1")
      .bind(id)
      .first();
    if (!force && reservation) {
      return errorResponse("Submission owns a Flash reservation. Archive or decline it through the lifecycle workflow instead.", 409);
    }

    const storedFiles = parseJsonField(current.files_json, []).filter((file) => file?.storageKey);
    if (!force && storedFiles.length) {
      return errorResponse("Submission has stored files. Archive it instead of deleting so file history is not orphaned.", 409);
    }
    if (force && storedFiles.length && !env.SUBMISSION_FILES) {
      return errorResponse("File storage is unavailable, so this entry cannot be permanently deleted without orphaning its stored files.", 503);
    }

    const statements = [];
    if (force) {
      statements.push(
        db.prepare(
          `UPDATE flash_items
           SET state = 'available', claimable = 1, reserved_submission_id = NULL, updated_at = ?
           WHERE reserved_submission_id = ? AND state = 'reserved'`
        ).bind(new Date().toISOString(), id),
        db.prepare(
          `UPDATE appointments
           SET submission_id = NULL, booking_token_id = NULL, updated_at = ?
           WHERE submission_id = ?`
        ).bind(new Date().toISOString(), id),
      );
    }
    statements.push(
      db.prepare("DELETE FROM booking_tokens WHERE submission_id = ?").bind(id),
      db.prepare("DELETE FROM submission_events WHERE submission_id = ?").bind(id),
      db.prepare("DELETE FROM submissions WHERE id = ?").bind(id),
    );
    await db.batch(statements);

    const cleanupWarnings = [];
    let deletedFileCount = 0;
    if (force) {
      try {
        await db.prepare(
          `UPDATE crm_interactions
           SET active = 0, status = 'deleted', updated_at = ?
           WHERE source_provider = 'local' AND source_type = 'submission' AND source_id = ?`
        ).bind(new Date().toISOString(), id).run();
      } catch {
        // CRM backfill is optional; the submission database remains authoritative.
        cleanupWarnings.push("CRM source history could not be deactivated.");
      }
      for (const file of storedFiles) {
        try {
          await env.SUBMISSION_FILES?.delete(file.storageKey);
          deletedFileCount += 1;
        } catch {
          cleanupWarnings.push(`Stored file cleanup failed for ${file.id || file.storageKey}.`);
        }
      }
    }

    return json({
      ok: true,
      deletedId: id,
      permanent: force,
      detachedAppointments: force ? Number(appointmentCount?.count || 0) : 0,
      deletedFiles: force ? deletedFileCount : 0,
      cleanupWarnings,
    });
  } catch (error) {
    return errorResponse("Unable to delete submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleGetSubmissionFile(request, env, submissionId, fileId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireSubmissionDb(env);
    const row = await db
      .prepare("SELECT files_json FROM submissions WHERE id = ?")
      .bind(submissionId)
      .first();
    if (!row) return errorResponse("Submission not found.", 404);

    const files = parseJsonField(row.files_json, []);
    const file = files.find((f) => f.id === fileId);
    if (!file) return errorResponse("File not found.", 404);
    if (!file.storageKey) return errorResponse("File was not stored in R2.", 404);

    const bucket = env.SUBMISSION_FILES;
    if (!bucket) return errorResponse("File storage not configured.", 503);

    const object = await bucket.get(file.storageKey);
    if (!object) return errorResponse("File not found in storage.", 404);

    return new Response(object.body, {
      headers: {
        "content-type": file.contentType || "application/octet-stream",
        "content-disposition": `attachment; filename="${String(file.fileName || "file").replace(/"/g, '\\"')}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("Unable to retrieve file.", 500, { detail: error.message });
  }
}
