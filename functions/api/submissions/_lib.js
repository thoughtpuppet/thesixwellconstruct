import {
  notifyBookingLinkCreated,
  notifyAdminSubmissionReceived,
  notifySubmissionDecision,
  notifySubmissionReceived,
  notifyTattooSpecialDepositRequested,
  notifyTattooSpecialReview,
} from "../notifications/_lib.js";
import { ingestCrmSourceRecord } from "../crm/ingest.js";
import { captureMarketingConsent } from "../outreach/_lib.js";
import {
  finalizeSubmissionBuildDraft,
  resolveSubmissionBuildDraft,
} from "../build-drafts/_lib.js";
import {
  buildCompositionSnapshot,
  normalizeCompositionSnapshot,
} from "../../../js/build-composition.js";
import {
  generateSubmissionBriefDocument,
  loadBriefDocument,
  presentBriefDocument,
} from "../brief-documents/_lib.js";
import { bookingTokenFromUrl } from "../booking-links.js";

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
  "tattoo_special",
]);
const TATTOO_INQUIRY_PROJECT_TYPES = new Set([
  "new_work",
  "cover_up",
  "large_cover_up",
  "rework",
  "space_filler",
]);
const REWORK_INTERVENTIONS = new Set([
  "refresh_color",
  "repair_linework",
  "redesign_part",
  "extend_new_work",
  "needs_assessment",
]);
const TATTOO_INQUIRY_FILE_ROLE_ALIASES = {
  placement_photo: "placement_photos",
  cover_up_photos: "existing_tattoo_photos",
};
const SPECIAL_PROJECT_PROFILES = new Set(["extended", "experimental"]);
const SPECIAL_PROJECT_MODES = new Set(["fresh", "cover_up", "blast_over"]);
const SPECIAL_PROJECT_AGREEMENT_VERSION = "special-project-experimental-v1";

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
  tattoo_inquiry: 12,
  flash_claim: 6,
  special_project: 6,
  build_brief: 6,
  maze_design: 4,
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
    ["message", "Project description is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  flash_claim: [
    ["selected_flash", "Available flash selection is required."],
    ["budget_range", "Budget range is required."],
    ["flash_claim_acknowledged", "Flash claim acknowledgement is required.", "yes"],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  build_brief: [
    ["placement", "Placement is required."],
    ["budget_range", "Budget range is required."],
    ["design_intent", "Design intent is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  maze_design: [
    ["maze_explanation", "A short explanation of your maze is required."],
    ["budget_range", "Budget range is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  special_project: [
    ["project_title", "Project call or working title is required."],
    ["placement", "Placement is required."],
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

function absoluteClientUrl(env, request, pathOrUrl) {
  const base = env.PUBLIC_SITE_URL || new URL(request.url).origin;
  return new URL(pathOrUrl, base).toString();
}

async function activeBookingAccessForUrl(db, submissionId, bookingUrl) {
  const token = bookingTokenFromUrl(bookingUrl);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return db.prepare(
    `SELECT * FROM booking_tokens
     WHERE submission_id=? AND token_hash=? AND revoked_at IS NULL AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at>?)
     LIMIT 1`
  ).bind(submissionId, tokenHash, new Date().toISOString()).first();
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function submissionNeedsPrerequisiteConsultation(rowOrPayload) {
  const payload = rowOrPayload?.payload_json
    ? parseJsonField(rowOrPayload.payload_json, {})
    : rowOrPayload || {};
  return payload.consult_required === "yes";
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

function normalizeTattooBudgetPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const rawType = asString(payload.type || payload.form_type || "tattoo_inquiry")
    .replace(/^standard_/, "")
    .replace(/^new_/, "");
  const type = rawType === "tattoo_inquiry_form" ? "tattoo_inquiry" : rawType;
  if (!TATTOO_SUBMISSION_TYPES.has(type)) return payload;
  const budget = asString(
    payload.budget_range
    || payload.budgetRange
    || (type === "flash_claim" ? payload.claim_bid : "")
  );
  if (budget) payload.budget_range = budget;
  return payload;
}

function normalizedStringArray(value) {
  const values = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ""
      ? []
      : [value];
  return [...new Set(values.map(asString).filter(Boolean))];
}

function normalizeTattooInquiryPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const rawType = asString(payload.type || payload.form_type || "tattoo_inquiry")
    .replace(/^standard_/, "")
    .replace(/^new_/, "");
  if (!["tattoo_inquiry", "tattoo_inquiry_form"].includes(rawType)) return payload;
  if (payload.rework_interventions !== undefined || payload.project_type === "rework") {
    payload.rework_interventions = normalizedStringArray(payload.rework_interventions);
  }
  return payload;
}

function normalizeTattooInquiryFileRoles(type, files) {
  if (type !== "tattoo_inquiry") return files;
  for (const file of files || []) {
    file.fieldName = TATTOO_INQUIRY_FILE_ROLE_ALIASES[file.fieldName] || file.fieldName;
  }
  return files;
}

function requireProjectField(payload, field, message) {
  return asString(payload[field]) ? null : { error: message, status: 400 };
}

function validateProjectChoice(payload, field, allowed, message) {
  const value = asString(payload[field]);
  if (!value) return null;
  return allowed.has(value) ? null : { error: message, status: 400 };
}

function validateTattooInquiryProject(payload) {
  const projectType = asString(payload.project_type);
  if (!TATTOO_INQUIRY_PROJECT_TYPES.has(projectType)) {
    return { error: "Choose a supported tattoo project type.", status: 400 };
  }

  if (["cover_up", "large_cover_up"].includes(projectType)) {
    const required = [
      ["cover_up_goal", "Cover-up goal is required."],
      ["size_placement_flexibility", "Size and placement flexibility is required."],
    ];
    for (const [field, message] of required) {
      const error = requireProjectField(payload, field, message);
      if (error) return error;
    }
    const coverGoalError = validateProjectChoice(
      payload,
      "cover_up_goal",
      new Set(["fully_hide", "transform", "incorporate", "unsure"]),
      "Choose a supported cover-up goal.",
    );
    if (coverGoalError) return coverGoalError;
    const flexibilityError = validateProjectChoice(
      payload,
      "size_placement_flexibility",
      new Set(["flexible", "size_only", "placement_only", "limited", "unsure"]),
      "Choose a supported size and placement flexibility option.",
    );
    if (flexibilityError) return flexibilityError;
  }

  if (projectType === "large_cover_up") {
    const required = [
      ["existing_tattoo_dimensions", "Existing tattoo dimensions are required for a large cover-up."],
      ["open_to_larger_footprint", "Larger-footprint flexibility is required for a large cover-up."],
      ["open_to_multiple_sessions", "Multiple-session flexibility is required for a large cover-up."],
    ];
    for (const [field, message] of required) {
      const error = requireProjectField(payload, field, message);
      if (error) return error;
    }
    for (const field of ["open_to_larger_footprint", "open_to_multiple_sessions"]) {
      const choiceError = validateProjectChoice(
        payload,
        field,
        new Set(["yes", "no", "discuss"]),
        "Choose Yes, No, or Needs discussion for the large cover-up planning questions.",
      );
      if (choiceError) return choiceError;
    }
  }

  if (projectType === "rework") {
    const interventions = normalizedStringArray(payload.rework_interventions);
    if (!interventions.length) {
      return { error: "Choose at least one kind of rework or select Needs assessment.", status: 400 };
    }
    if (interventions.some((value) => !REWORK_INTERVENTIONS.has(value))) {
      return { error: "Choose only supported rework options.", status: 400 };
    }
    const expansionError = requireProjectField(
      payload,
      "rework_expansion_flexibility",
      "Rework expansion flexibility is required.",
    );
    if (expansionError) return expansionError;
    const expansionChoiceError = validateProjectChoice(
      payload,
      "rework_expansion_flexibility",
      new Set(["yes", "no", "unsure"]),
      "Choose a supported rework expansion option.",
    );
    if (expansionChoiceError) return expansionChoiceError;
  }

  if (projectType === "space_filler") {
    const required = [
      ["gap_dimensions", "Gap dimensions are required for a space filler."],
      ["surrounding_work", "Describe the tattoos surrounding the space filler."],
      ["filler_relationship", "Choose how the filler should relate to the surrounding work."],
    ];
    for (const [field, message] of required) {
      const error = requireProjectField(payload, field, message);
      if (error) return error;
    }
    const relationshipError = validateProjectChoice(
      payload,
      "filler_relationship",
      new Set(["standalone", "connect_blend", "unsure"]),
      "Choose a supported space-filler relationship.",
    );
    if (relationshipError) return relationshipError;
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

  if (!submission.contact.phone) {
    return { error: "Phone number is required.", status: 400 };
  }

  if (TATTOO_SUBMISSION_TYPES.has(submission.type) && payload.age_confirmed !== "yes") {
    return { error: "You must confirm that you are 18 or older.", status: 400 };
  }

  if (TATTOO_SUBMISSION_TYPES.has(submission.type) && !isAtLeastEighteen(payload.dob)) {
    return { error: "Tattoo requests require a valid date of birth confirming age 18 or older.", status: 400 };
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

  if (submission.type === "tattoo_inquiry") {
    const projectValidation = validateTattooInquiryProject(payload);
    if (projectValidation) return projectValidation;
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

export const MAZE_ARCHIVE_CONSENT_VERSION = "maze-archive-v1";
export const MAZE_ARCHIVE_CONSENT_TEXT = "If selected after review, Art.Pill and the Six.Well Construct may display my maze image in the public Maze Archive under a limited, non-exclusive, revocable permission. Ownership is not transferred. Contact details and the editable Maze file remain private.";

function selected(value) {
  return ["1", "true", "yes", "on"].includes(asString(value).toLowerCase());
}

function normalizeMazeArchiveConsent(payload, contact = {}) {
  const granted = selected(payload.maze_archive_opt_in);
  const mode = asString(payload.maze_archive_attribution || "anonymous").toLowerCase();
  if (!new Set(["anonymous", "first_name", "display_name"]).has(mode)) {
    return { error: "Choose Anonymous, first name, or custom display name for Maze Archive attribution." };
  }
  const displayName = asString(payload.maze_archive_display_name).trim();
  if (granted && mode === "display_name" && (!displayName || displayName.length > 80)) {
    return { error: "Enter a custom Maze Archive display name of 80 characters or fewer." };
  }
  const firstName = asString(contact.firstName).trim();
  if (granted && mode === "first_name" && !firstName) {
    return { error: "A first name is required for first-name Maze Archive attribution." };
  }
  const credit = mode === "first_name" ? firstName : mode === "display_name" ? displayName : "Anonymous";
  return {
    status: granted ? "granted" : "not_granted",
    attributionMode: granted ? mode : "anonymous",
    publicCredit: granted ? credit : "Anonymous",
    includeExplanation: granted && selected(payload.maze_archive_include_explanation),
  };
}

async function loadMazeArchiveState(database, submissionId, payload = {}) {
  const row = await database.prepare(`SELECT c.status consent_status,c.attribution_mode,c.public_credit,c.include_explanation,
      c.consent_version,c.consented_at,c.withdrawn_at,e.curation_status,e.archive_entity_id,e.review_note,e.reviewed_at,
      ad.archive_slug,ar.title archive_title
    FROM maze_archive_consents c
    LEFT JOIN maze_archive_entries e ON e.submission_id=c.submission_id
    LEFT JOIN archive_dossiers ad ON ad.entity_id=e.archive_entity_id
    LEFT JOIN archive_records ar ON ar.id=e.archive_entity_id
    WHERE c.submission_id=?`).bind(submissionId).first();
  if (!row) return null;
  return {
    consentStatus: row.consent_status,
    attributionMode: row.attribution_mode,
    publicCredit: row.public_credit,
    includeExplanation: Boolean(row.include_explanation),
    consentVersion: row.consent_version,
    consentedAt: row.consented_at || "",
    withdrawnAt: row.withdrawn_at || "",
    curationStatus: row.curation_status || "not_candidate",
    archiveEntityId: row.archive_entity_id || "",
    archiveSlug: row.archive_slug || "",
    archiveTitle: row.archive_title || "",
    reviewNote: row.review_note || "",
    reviewedAt: row.reviewed_at || "",
    permittedExplanation: row.include_explanation ? asString(payload.maze_explanation) : "",
  };
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

const CLIENT_DECISION_NOTIFICATION_TEMPLATES = new Set([
  "booking_link_created",
  "tattoo_special_deposit_requested",
  "submission_approved",
  "submission_declined",
  "tattoo_special_review",
]);

const CLIENT_LINK_NOTIFICATION_TEMPLATES = new Set([
  "booking_link_created",
  "tattoo_special_deposit_requested",
]);

function emptySubmissionProgress() {
  return {
    clientNotificationStatus: "unsent",
    clientNotificationSentAt: "",
    clientLinkNotificationStatus: "unsent",
    clientLinkNotificationSentAt: "",
    depositPaymentStatus: "none",
    depositPaidAt: "",
    clientAccessStatus: "none",
    specialBookingPreparedAt: "",
    clientActivity: {
      bookingLinkOpenCount: 0,
      firstBookingLinkOpenedAt: "",
      latestBookingLinkOpenedAt: "",
      squareRedirectCount: 0,
      firstSquareRedirectAt: "",
      latestSquareRedirectAt: "",
    },
  };
}

async function loadSubmissionProgress(database, submissionRows = []) {
  const rows = submissionRows.filter((row) => row?.id);
  const progress = new Map(rows.map((row) => [row.id, emptySubmissionProgress()]));
  if (!rows.length) return progress;

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const revisions = new Map(rows.map((row) => [row.id, Number(row.decision_revision || 0)]));
  const notificationRows = (await database.prepare(
    `SELECT nd.template_key,nd.status,nd.sent_at,nd.created_at,nd.idempotency_key,
            CASE WHEN nd.related_type='submission' THEN nd.related_id ELSE a.submission_id END submission_id
     FROM notification_deliveries nd
     LEFT JOIN appointments a ON nd.related_type='appointment' AND a.id=nd.related_id
     WHERE nd.channel='email'
       AND ((nd.related_type='submission' AND nd.related_id IN (${placeholders}))
         OR (nd.related_type='appointment' AND a.submission_id IN (${placeholders})))
     ORDER BY nd.created_at DESC`
  ).bind(...ids, ...ids).all()).results || [];

  const accessCandidates = (await Promise.all(rows.map(async (row) => {
    const rawToken = bookingTokenFromUrl(row.booking_url || "");
    return rawToken ? { submissionId: row.id, tokenHash: await sha256Hex(rawToken) } : null;
  }))).filter(Boolean);
  const activeAccessBySubmission = new Map();
  if (accessCandidates.length) {
    const accessPlaceholders = accessCandidates.map(() => "(?, ?)").join(",");
    const accessBindings = accessCandidates.flatMap(({ submissionId, tokenHash }) => [submissionId, tokenHash]);
    const activeAccessRows = (await database.prepare(
      `SELECT id,submission_id,created_at
       FROM booking_tokens
       WHERE (submission_id,token_hash) IN (${accessPlaceholders})
         AND revoked_at IS NULL
         AND used_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`
    ).bind(...accessBindings, new Date().toISOString()).all()).results || [];
    for (const access of activeAccessRows) {
      activeAccessBySubmission.set(access.submission_id, access);
      progress.get(access.submission_id).clientAccessStatus = "active";
    }
  }

  const specialBookingPreparationRows = (await database.prepare(
    `SELECT submission_id,MAX(created_at) special_booking_prepared_at
     FROM submission_events
     WHERE submission_id IN (${placeholders})
       AND event_type='special_deposit_link_prepared'
     GROUP BY submission_id`
  ).bind(...ids).all()).results || [];
  for (const prepared of specialBookingPreparationRows) {
    const state = progress.get(prepared.submission_id);
    if (state) state.specialBookingPreparedAt = prepared.special_booking_prepared_at || "";
  }

  const clientActivityRows = (await database.prepare(
    `SELECT submission_id,
            SUM(CASE WHEN event_type='booking_link_opened' THEN 1 ELSE 0 END) booking_link_open_count,
            MIN(CASE WHEN event_type='booking_link_opened' THEN created_at END) first_booking_link_opened_at,
            MAX(CASE WHEN event_type='booking_link_opened' THEN created_at END) latest_booking_link_opened_at,
            SUM(CASE WHEN event_type='square_checkout_redirected' THEN 1 ELSE 0 END) square_redirect_count,
            MIN(CASE WHEN event_type='square_checkout_redirected' THEN created_at END) first_square_redirect_at,
            MAX(CASE WHEN event_type='square_checkout_redirected' THEN created_at END) latest_square_redirect_at
     FROM booking_client_events
     WHERE submission_id IN (${placeholders})
     GROUP BY submission_id`
  ).bind(...ids).all()).results || [];
  for (const activity of clientActivityRows) {
    const state = progress.get(activity.submission_id);
    if (!state) continue;
    state.clientActivity = {
      bookingLinkOpenCount: Number(activity.booking_link_open_count || 0),
      firstBookingLinkOpenedAt: activity.first_booking_link_opened_at || "",
      latestBookingLinkOpenedAt: activity.latest_booking_link_opened_at || "",
      squareRedirectCount: Number(activity.square_redirect_count || 0),
      firstSquareRedirectAt: activity.first_square_redirect_at || "",
      latestSquareRedirectAt: activity.latest_square_redirect_at || "",
    };
  }

  const currentNotificationSeen = new Set();
  const currentLinkNotificationSeen = new Set();
  const deliveryStatus = (status) => status === "sent"
    ? "sent"
    : ["failed", "skipped"].includes(status) ? "failed" : "pending";

  for (const delivery of notificationRows) {
    const submissionId = delivery.submission_id;
    const state = progress.get(submissionId);
    if (!state) continue;
    const revision = revisions.get(submissionId) || 0;
    const attemptPrefix = `decision_notification:${submissionId}:${revision}:`;
    const isCurrentDecision = CLIENT_DECISION_NOTIFICATION_TEMPLATES.has(delivery.template_key)
      && String(delivery.idempotency_key || "").startsWith(attemptPrefix);
    const activeAccess = activeAccessBySubmission.get(submissionId);
    const isCurrentLink = CLIENT_LINK_NOTIFICATION_TEMPLATES.has(delivery.template_key)
      && activeAccess
      && String(delivery.created_at || "") >= String(activeAccess.created_at || "");

    if (
      CLIENT_LINK_NOTIFICATION_TEMPLATES.has(delivery.template_key)
      && delivery.status === "sent"
      && !state.clientLinkNotificationSentAt
    ) {
      state.clientLinkNotificationSentAt = delivery.sent_at || delivery.created_at || "";
    }

    if ((isCurrentDecision || isCurrentLink) && !currentNotificationSeen.has(submissionId)) {
      state.clientNotificationStatus = deliveryStatus(delivery.status);
      if (delivery.status === "sent") state.clientNotificationSentAt = delivery.sent_at || delivery.created_at || "";
      currentNotificationSeen.add(submissionId);
    }
    if (isCurrentLink && !currentLinkNotificationSeen.has(submissionId)) {
      state.clientLinkNotificationStatus = deliveryStatus(delivery.status);
      currentLinkNotificationSeen.add(submissionId);
    }
  }

  const paymentRows = (await database.prepare(
    `SELECT a.submission_id,dp.status,dp.updated_at
     FROM deposit_payments dp
     JOIN appointments a ON a.id=dp.appointment_id
     WHERE a.submission_id IN (${placeholders})
     ORDER BY dp.updated_at DESC`
  ).bind(...ids).all()).results || [];
  for (const payment of paymentRows) {
    const state = progress.get(payment.submission_id);
    if (!state) continue;
    const status = String(payment.status || "").toLowerCase();
    const paid = ["paid", "completed", "settled"].includes(status);
    if (status === "payment_attention") {
      state.depositPaymentStatus = "paid_attention";
      if (!state.depositPaidAt) state.depositPaidAt = payment.updated_at || "";
    } else if (paid && state.depositPaymentStatus !== "paid_attention") {
      state.depositPaymentStatus = "paid";
      if (!state.depositPaidAt) state.depositPaidAt = payment.updated_at || "";
    } else if (status === "pending" && state.depositPaymentStatus === "none") {
      state.depositPaymentStatus = "pending";
    }
  }
  return progress;
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
    decisionRevision: Number(row.decision_revision || 0),
    decidedAt: row.decided_at || "",
    decisionClientMessage: row.decision_client_message || "",
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
    openedAt: row.opened_at || "",
    clientNotificationStatus: row.clientNotificationStatus || row.client_notification_status || "unsent",
    clientNotificationSentAt: row.clientNotificationSentAt || row.client_notification_sent_at || "",
    clientLinkNotificationStatus: row.clientLinkNotificationStatus || row.client_link_notification_status || "unsent",
    clientLinkNotificationSentAt: row.clientLinkNotificationSentAt || row.client_link_notification_sent_at || "",
    depositPaymentStatus: row.depositPaymentStatus || row.deposit_payment_status || "none",
    depositPaidAt: row.depositPaidAt || row.deposit_paid_at || "",
    clientAccessStatus: row.clientAccessStatus || row.client_access_status || "none",
    specialBookingPreparedAt: row.specialBookingPreparedAt || row.special_booking_prepared_at || "",
    clientActivity: row.clientActivity || row.client_activity || emptySubmissionProgress().clientActivity,
    flashReservation,
    flashConflict,
    flash_conflict: flashConflict,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function crmNodeForSubmission(type, payload = {}) {
  if (["tattoo_inquiry", "flash_claim", "special_project", "tattoo_special", "build_brief", "maze_design", "consultation", "build_session"].includes(type)) {
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

function validateTattooInquiryFiles(type, payload, files) {
  if (type !== "tattoo_inquiry") return null;
  const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const referenceTypes = new Set([...imageTypes, "application/pdf"]);
  const allowedRoles = new Set(["references", "placement_photos", "existing_tattoo_photos"]);

  for (const file of files) {
    if (!allowedRoles.has(file.fieldName)) {
      return { error: "This custom inquiry contains an unsupported upload field.", status: 400 };
    }
    const contentType = String(file.contentType || "").toLowerCase();
    const accepted = file.fieldName === "references" ? referenceTypes : imageTypes;
    if (!accepted.has(contentType)) {
      return {
        error: file.fieldName === "references"
          ? "Reference uploads must be PNG, JPG, WEBP, or PDF files."
          : "Placement and existing-tattoo photographs must be PNG, JPG, or WEBP images.",
        status: 415,
      };
    }
  }

  const existingCount = files.filter((file) => file.fieldName === "existing_tattoo_photos").length;
  const placementCount = files.filter((file) => file.fieldName === "placement_photos").length;
  const projectType = asString(payload?.project_type);
  const requiredExisting = projectType === "large_cover_up"
    ? 3
    : ["cover_up", "rework"].includes(projectType)
      ? 1
      : 0;
  const requiredPlacement = projectType === "space_filler" ? 2 : 0;

  if (existingCount < requiredExisting) {
    const label = projectType === "large_cover_up" ? "Large cover-up inquiries" : projectType === "rework" ? "Rework inquiries" : "Cover-up inquiries";
    return {
      error: projectType === "large_cover_up"
        ? "Large cover-up inquiries require at least 3 photographs of the existing tattoo from different angles."
        : `${label} require at least 1 existing-tattoo photograph.`,
      status: 400,
    };
  }
  if (placementCount < requiredPlacement) {
    return {
      error: "Space-filler inquiries require at least 2 area photographs: one wide view and one close view.",
      status: 400,
    };
  }
  return null;
}

function validateSpecialProjectFiles(profile, mode, files) {
  const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const allowedRoles = profile === "experimental"
    ? new Set(["body_area_photos"])
    : new Set(["body_area_photos", "references"]);
  for (const file of files || []) {
    if (!allowedRoles.has(file.fieldName)) {
      return { error: "This Special Project application contains an unsupported upload field.", status: 400 };
    }
    const contentType = String(file.contentType || "").toLowerCase();
    if (file.fieldName === "body_area_photos" && !imageTypes.has(contentType)) {
      return { error: "Body-area photographs must be PNG, JPG, or WEBP images.", status: 415 };
    }
    if (file.fieldName === "references" && !new Set([...imageTypes, "application/pdf"]).has(contentType)) {
      return { error: "Reference uploads must be PNG, JPG, WEBP, or PDF files.", status: 415 };
    }
  }
  const bodyPhotoCount = (files || []).filter((file) => file.fieldName === "body_area_photos").length;
  if (bodyPhotoCount > 6) {
    return { error: "Special Project applications accept no more than 6 body-area photographs.", status: 400 };
  }
  if (["cover_up", "blast_over"].includes(mode) && bodyPhotoCount < 1) {
    return { error: `${mode === "cover_up" ? "Cover-up" : "Blast-over"} applications require a clear photograph of the existing tattoo.`, status: 400 };
  }
  if (profile === "experimental" && bodyPhotoCount < 1) {
    return { error: "Experimental Project applications require at least 1 body-area photograph.", status: 400 };
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

function parseSymbolSelections(payload, ids) {
  let raw = payload.symbol_selections ?? payload.symbol_selections_json;
  if (!raw) return { selections: ids.map((id, order) => ({ id, order, note: "" })) };
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch {
      return { error: "Symbol descriptions must be valid JSON." };
    }
  }
  if (!Array.isArray(raw) || raw.length !== ids.length) {
    return { error: "Symbol descriptions must match the selected Legend symbols." };
  }
  const selections = raw.map((entry, order) => ({
    id: asString(entry?.id),
    order,
    note: asString(entry?.note),
  }));
  if (
    selections.some((entry, index) => entry.id !== ids[index])
    || new Set(selections.map((entry) => entry.id)).size !== ids.length
  ) {
    return { error: "Symbol description order must match the selected Legend symbols." };
  }
  if (selections.some((entry) => entry.note.length > 300)) {
    return { error: "Personal symbol descriptions must be 300 characters or fewer." };
  }
  return { selections };
}

function parseClientCompositionSnapshot(payload, ids) {
  const raw = payload.composition_snapshot ?? payload.composition_snapshot_json;
  if (!raw) return { snapshot: null };
  const snapshot = normalizeCompositionSnapshot(raw);
  if (!snapshot) return { error: "The composition reading snapshot must be valid JSON." };
  if (
    snapshot.selectedSymbolIds.length !== ids.length
    || snapshot.selectedSymbolIds.some((id, index) => id !== ids[index])
  ) {
    return { error: "The composition reading must match the selected Legend symbols." };
  }
  return { snapshot };
}

async function publishedCompositionRules(database) {
  const rows = (await database.prepare(
    `SELECT r.id,r.rule_type,r.interpretation,r.sort_order,
            m.symbol_id,m.member_order,s.state symbol_state
     FROM visual_symbol_composition_rules r
     JOIN visual_symbol_composition_rule_members m ON m.rule_id=r.id
     JOIN visual_symbols s ON s.id=m.symbol_id
     WHERE r.state='published'
     ORDER BY r.sort_order,r.id,m.member_order`
  ).all()).results || [];
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, type: row.rule_type, interpretation: row.interpretation, sortOrder: Number(row.sort_order) || 0, symbolIds: [], publishable: true });
    const rule = grouped.get(row.id);
    rule.symbolIds.push(row.symbol_id);
    if (row.symbol_state !== "published") rule.publishable = false;
  }
  return [...grouped.values()].filter((rule) => rule.publishable && rule.symbolIds.length >= 2);
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
  const supportedRoles = new Set([
    "maze_image",
    "maze_transparent_image",
    "maze_stencil_image",
    "maze_json_file",
  ]);
  const filesByRole = new Map();
  for (const file of files) {
    if (!supportedRoles.has(file.fieldName)) {
      return { error: "The Maze submission contains an unsupported artifact." };
    }
    if (filesByRole.has(file.fieldName)) {
      return { error: `The Maze submission contains more than one ${file.fieldName} artifact.` };
    }
    filesByRole.set(file.fieldName, file);
  }

  const jsonFile = filesByRole.get("maze_json_file");
  if (!jsonFile || jsonFile.contentType !== "application/json") {
    return { error: "Maze submissions require the editable JSON design artifact." };
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
  const canvasMode = design?.canvasMode === undefined ? "standard" : design.canvasMode;
  if (!new Set(["standard", "negative-space"]).has(canvasMode)) {
    return { error: "The Maze JSON contains an invalid canvas mode." };
  }

  const requiredPngRoles = canvasMode === "negative-space"
    ? ["maze_image", "maze_stencil_image"]
    : ["maze_image", "maze_transparent_image", "maze_stencil_image"];
  const expectedRoles = new Set([...requiredPngRoles, "maze_json_file"]);
  if (files.length !== expectedRoles.size || [...filesByRole.keys()].some((role) => !expectedRoles.has(role))) {
    return {
      error: canvasMode === "negative-space"
        ? "Negative Space Maze submissions require canvas and Studio stencil PNGs plus JSON; a separate transparent render is not accepted."
        : "Standard Maze submissions require canvas, transparent, and Studio stencil PNGs plus JSON.",
    };
  }

  const expectedSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (const role of requiredPngRoles) {
    const png = filesByRole.get(role);
    if (!png || png.contentType !== "image/png") {
      return { error: `The ${role} artifact must be a PNG file.` };
    }
    const signature = new Uint8Array(await png.file.slice(0, 8).arrayBuffer());
    if (signature.length !== expectedSignature.length || expectedSignature.some((byte, index) => signature[index] !== byte)) {
      return { error: `The ${role} artifact is not a valid PNG file.` };
    }
  }

  const walls = Array.isArray(design?.mazeWalls) ? design.mazeWalls : [];
  const shapes = Array.isArray(design?.mazeShapes) ? design.mazeShapes : [];
  if (!walls.length && !shapes.length) {
    return { error: "Draw at least one maze wall or shape before submitting." };
  }
  return {
    designSummary: {
      wallCount: walls.length,
      shapeCount: shapes.length,
      canvasMode,
      renderVariants: canvasMode === "negative-space"
        ? ["canvas", "stencil"]
        : ["canvas", "transparent", "stencil"],
    },
  };
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
    `SELECT id, slug, title, state, claimable, item_type, sheet_code, design_code,
            legacy_path, reserved_submission_id,
            price_label, session_category, split_policy, estimated_sessions_min,
            estimated_sessions_max, estimated_total_minutes_min,
            estimated_total_minutes_max, session_plan_note, process_category
     FROM flash_items
     WHERE id = ? OR slug = ? OR legacy_path = ? OR legacy_path = ?
     ORDER BY CASE WHEN id = ? THEN 0 WHEN slug = ? THEN 1 ELSE 2 END
     LIMIT 1`
  ).bind(reference, reference, reference, path, reference, reference).first();
}

function parseSheetDesignSelections(payload) {
  let selections = payload?.sheet_design_selections_json ?? payload?.sheetDesignSelections;
  if (typeof selections === "string") {
    try { selections = JSON.parse(selections); } catch { return { error: "Sheet design selections must be valid JSON." }; }
  }
  if (!Array.isArray(selections)) return { error: "Choose at least one design from this Flash sheet." };
  if (!selections.length || selections.length > 26) return { error: "Choose between one and 26 designs from this Flash sheet." };
  const normalized = [];
  const ids = new Set();
  for (const entry of selections) {
    const designId = asString(entry?.id);
    const placement = asString(entry?.placement).slice(0, 300);
    const scale = asString(entry?.scale).slice(0, 160);
    if (!designId) return { error: "Every selected sheet design needs a stable design ID." };
    if (ids.has(designId)) return { error: "The same sheet design cannot be selected twice." };
    if (!placement) return { error: "Enter a placement for every selected sheet design." };
    ids.add(designId);
    normalized.push({ id: designId, placement, scale });
  }
  return { selections: normalized };
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
  normalizeTattooBudgetPayload(body.payload);
  normalizeTattooInquiryPayload(body.payload);

  const submission = normalizeSubmission(body.payload, request);
  normalizeTattooInquiryFileRoles(submission.type, body.files);
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

  const mazeArchiveConsent = submission.type === "maze_design"
    ? normalizeMazeArchiveConsent(body.payload, submission.contact)
    : null;
  if (mazeArchiveConsent?.error) {
    return errorResponse(mazeArchiveConsent.error, 400, { code: "INVALID_MAZE_ARCHIVE_CONSENT" });
  }

  const fileValidation = validateSubmissionFiles(submission.type, body.files, env);
  if (fileValidation) return errorResponse(fileValidation.error, fileValidation.status);
  const tattooInquiryFileValidation = validateTattooInquiryFiles(submission.type, body.payload, body.files);
  if (tattooInquiryFileValidation) {
    return errorResponse(tattooInquiryFileValidation.error, tattooInquiryFileValidation.status);
  }

  const idempotency = normalizeIdempotencyKey(request, body.payload);
  if (idempotency.error) return errorResponse(idempotency.error, 400);
  const idempotencyFingerprint = idempotency.value
    ? await submissionIdempotencyFingerprint(submission, body.payload, body.files)
    : "";
  if (idempotencyFingerprint) {
    submission.requestMeta.idempotencyFingerprint = idempotencyFingerprint;
  }

  let savedFiles = [];
  let managedSheetSelections = [];
  let specialProjectTerms = null;

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
        const mazeArchive = existing.type === "maze_design"
          ? await loadMazeArchiveState(db, existing.id, normalized.payload)
          : null;
        await mirrorSubmissionToCrm(db, existing);
        return json({
          ok: true,
          submissionId: normalized.id,
          filesStored: normalized.files.filter((file) => file.stored).length,
          filesReceived: normalized.files.length,
          idempotent: true,
          mazeArchive,
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
        `SELECT spc.*,
                entity.visibility AS entity_visibility,
                series.id AS series_snapshot_id,
                series.name AS series_snapshot_name,
                series.slug AS series_snapshot_slug
         FROM special_project_calls spc
         JOIN content_entities entity ON entity.id = spc.id AND entity.entity_type = 'special_project'
         LEFT JOIN special_project_series series ON series.id = spc.series_id
         WHERE spc.id = ? OR spc.slug = ? OR lower(spc.title) = lower(?)
         ORDER BY CASE WHEN spc.id = ? THEN 0 WHEN spc.slug = ? THEN 1 ELSE 2 END
         LIMIT 1`
      ).bind(selectedCall, selectedCall, selectedCall, selectedCall, selectedCall).first();
      const now = new Date().toISOString();
      const isPublished = call && call.publication_state === "published" && call.entity_visibility === "public";
      const isOpen = isPublished && call.status === "open"
        && (!call.opens_at || call.opens_at <= now)
        && (!call.closes_at || call.closes_at > now);
      if (!isOpen) {
        return errorResponse("That Special Project call is not currently open.", 409, {
          code: "SPECIAL_PROJECT_CLOSED",
          redirect: "/tattoos/special-projects/",
        });
      }
      const profile = SPECIAL_PROJECT_PROFILES.has(call.profile) ? call.profile : "extended";
      const allowedModes = (() => {
        const parsed = parseJsonField(call.allowed_modes_json, ["fresh"]);
        return [...new Set((Array.isArray(parsed) ? parsed : []).map(asString).filter((mode) => SPECIAL_PROJECT_MODES.has(mode)))];
      })();
      const selectedMode = asString(body.payload.application_mode || body.payload.selected_mode);
      if (!selectedMode || !allowedModes.includes(selectedMode)) {
        return errorResponse("Choose one of the application modes allowed for this Special Project.", 400, {
          code: "SPECIAL_PROJECT_MODE_REQUIRED",
        });
      }
      if (!asString(body.payload.placement) || !asString(body.payload.scale)) {
        return errorResponse("Placement/body area and approximate scale are required.", 400, {
          code: "SPECIAL_PROJECT_PLACEMENT_REQUIRED",
        });
      }
      const profileFileValidation = validateSpecialProjectFiles(profile, selectedMode, body.files);
      if (profileFileValidation) return errorResponse(profileFileValidation.error, profileFileValidation.status);
      if (profile === "extended") {
        if (!asString(body.payload.budget_range)) return errorResponse("Budget range is required.", 400);
        if (!asString(body.payload.message)) return errorResponse("Concept direction is required.", 400);
      } else {
        const healedMethod = asString(body.payload.healed_photo_method);
        if (!new Set(["return", "self_upload"]).has(healedMethod)) {
          return errorResponse("Choose how you will provide the healed photograph.", 400, {
            code: "HEALED_PHOTO_METHOD_REQUIRED",
          });
        }
        if (asString(body.payload.experimental_terms_agreed) !== "yes") {
          return errorResponse("Agreement to the Experimental Project terms is required.", 400, {
            code: "EXPERIMENTAL_TERMS_REQUIRED",
          });
        }
        if (Number(call.refundable_deposit_cents || 0) <= 0 || !asString(call.participation_terms)) {
          return errorResponse("This Experimental Project is missing required booking terms. The application was not accepted.", 409, {
            code: "EXPERIMENTAL_PROJECT_NOT_READY",
          });
        }
      }
      body.payload.special_project_snapshot = {
        id: call.id,
        slug: call.slug,
        title: call.title,
        summary: call.summary || "",
        rateText: call.rate_text || "",
        status: call.status,
        profile,
        allowedModes,
        refundableDepositCents: Number(call.refundable_deposit_cents || 0),
        healedPhotoDueWeeks: Number(call.healed_photo_due_weeks || 6),
        applicationInstructions: call.application_instructions || "",
        participationTerms: call.participation_terms || "",
        series: call.series_snapshot_id ? {
          id: call.series_snapshot_id,
          name: call.series_snapshot_name || "",
          slug: call.series_snapshot_slug || "",
        } : null,
        agreementVersion: SPECIAL_PROJECT_AGREEMENT_VERSION,
      };
      body.payload.project_title = call.title;
      body.payload.project_profile = profile;
      body.payload.application_mode = selectedMode;
      specialProjectTerms = {
        projectId: call.id,
        profile,
        title: call.title,
        seriesId: call.series_snapshot_id || null,
        seriesName: call.series_snapshot_name || "",
        seriesSlug: call.series_snapshot_slug || "",
        selectedMode,
        refundableDepositCents: Number(call.refundable_deposit_cents || 0),
        healedPhotoMethod: profile === "experimental" ? asString(body.payload.healed_photo_method) : null,
        healedPhotoDueWeeks: Number(call.healed_photo_due_weeks || 6),
        participationTerms: call.participation_terms || "",
        agreementSnapshot: body.payload.special_project_snapshot,
        agreed: profile === "experimental",
      };
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
      if (!flash || flash.state !== "available") {
        return errorResponse("That flash is no longer available. Refresh the flash catalog and choose another design.", 409, { code: "FLASH_UNAVAILABLE" });
      }
      const managedSheetCount = flash.item_type === "sheet"
        ? await db.prepare("SELECT COUNT(*) count FROM flash_sheet_designs WHERE flash_item_id=?").bind(flash.id).first()
        : null;
      const managedSheet = Number(managedSheetCount?.count || 0) > 0;
      if (managedSheet) {
        const parsedSelections = parseSheetDesignSelections(body.payload);
        if (parsedSelections.error) return errorResponse(parsedSelections.error, 400, { code: "INVALID_SHEET_DESIGN_SELECTION" });
        const placeholders = parsedSelections.selections.map(() => "?").join(",");
        const rows = (await db.prepare(
          `SELECT id,flash_item_id,code,label,state,reserved_submission_id,sort_order
           FROM flash_sheet_designs
           WHERE flash_item_id=? AND id IN (${placeholders})
           ORDER BY sort_order,code`
        ).bind(flash.id, ...parsedSelections.selections.map((entry) => entry.id)).all()).results || [];
        const byId = new Map(rows.map((row) => [row.id, row]));
        if (rows.length !== parsedSelections.selections.length) {
          return errorResponse("Every selected design must belong to the same Flash sheet.", 409, { code: "SHEET_DESIGN_MISMATCH" });
        }
        const unavailable = parsedSelections.selections
          .map((selection) => byId.get(selection.id))
          .find((design) => !design || design.state !== "available" || design.reserved_submission_id);
        if (unavailable !== undefined) {
          return errorResponse(`${unavailable?.code || "A selected design"} is no longer available.`, 409, {
            code: "SHEET_DESIGN_UNAVAILABLE",
          });
        }
        managedSheetSelections = parsedSelections.selections.map((selection, index) => {
          const design = byId.get(selection.id);
          return {
            ...selection,
            flashItemId: flash.id,
            code: design.code,
            label: design.label,
            requestedOrder: index + 1,
          };
        });
        body.payload.sheet_design_selections = managedSheetSelections.map((entry) => ({
          id: entry.id,
          code: entry.code,
          label: entry.label,
          placement: entry.placement,
          scale: entry.scale,
        }));
        body.payload.placement = managedSheetSelections
          .map((entry) => `${entry.code}: ${entry.placement}${entry.scale ? ` (${entry.scale})` : ""}`)
          .join("; ");
      } else {
        if (Number(flash.claimable) !== 1 || flash.reserved_submission_id) {
          return errorResponse("That flash is no longer available. Refresh the flash catalog and choose another design.", 409, { code: "FLASH_UNAVAILABLE" });
        }
        if (!asString(body.payload.placement)) {
          return errorResponse("Placement is required.", 400, { code: "PLACEMENT_REQUIRED" });
        }
      }
      body.payload.flash_snapshot = {
        id: flash.id,
        slug: flash.slug,
        legacyPath: flash.legacy_path || "",
        title: flash.title,
        itemType: flash.item_type || "individual",
        managedSheet,
        sheetCode: flash.sheet_code || "",
        designCode: flash.design_code || "",
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

    let buildDraftContext = null;
    if (["build_brief", "maze_design"].includes(submission.type)) {
      buildDraftContext = await resolveSubmissionBuildDraft(
        request,
        db,
        submission.type,
        submission.contact.email,
      );
      if (buildDraftContext?.error) {
        return errorResponse(buildDraftContext.error, buildDraftContext.status, {
          code: buildDraftContext.code,
        });
      }
    }

    if (submission.type === "build_brief") {
      const symbolSelection = parseStableSymbolIds(body.payload);
      if (symbolSelection.error) return errorResponse(symbolSelection.error, 400);
      const describedSelection = parseSymbolSelections(body.payload, symbolSelection.ids);
      if (describedSelection.error) return errorResponse(describedSelection.error, 400);
      const clientComposition = parseClientCompositionSnapshot(body.payload, symbolSelection.ids);
      if (clientComposition.error) return errorResponse(clientComposition.error, 400);
      const placeholders = symbolSelection.ids.map(() => "?").join(",");
      const result = await db.prepare(`SELECT v.id,v.name,v.meaning,v.svg_markup,v.themes_json,c.name category FROM visual_symbols v JOIN visual_symbol_categories c ON c.id=v.category_id WHERE v.id IN (${placeholders}) AND v.state='published'`).bind(...symbolSelection.ids).all();
      const symbolsById = new Map((result.results || []).map((symbol) => [symbol.id, symbol]));
      if (symbolsById.size !== symbolSelection.ids.length) {
        return errorResponse("One or more selected symbols are unavailable. Refresh and try again.", 409, { code: "SYMBOL_UNAVAILABLE" });
      }
      body.payload.symbol_ids = symbolSelection.ids;
      body.payload.symbol_selections = describedSelection.selections;
      delete body.payload.symbol_selections_json;
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
          client_note: describedSelection.selections[index].note,
        };
      });
      const currentRules = await publishedCompositionRules(db);
      const currentComposition = buildCompositionSnapshot({
        symbols: body.payload.symbol_snapshot,
        rules: currentRules,
        selectedIds: symbolSelection.ids,
      });
      body.payload.client_composition_snapshot = clientComposition.snapshot || currentComposition;
      body.payload.composition_snapshot = currentComposition;
      body.payload.authored_composition_rules = currentComposition.appliedRules;
      body.payload.shared_composition_themes = currentComposition.sharedThemes;
      body.payload.composition_reading = currentComposition.reading;
      delete body.payload.composition_snapshot_json;
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
      ...managedSheetSelections.map((selection) =>
        db.prepare(
          `INSERT INTO submission_flash_designs
           (submission_id,sheet_design_id,flash_item_id,code_snapshot,label_snapshot,placement,scale,requested_order,outcome,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?, 'requested',?,?)`
        ).bind(
          id,
          selection.id,
          selection.flashItemId,
          selection.code,
          selection.label,
          selection.placement,
          selection.scale,
          selection.requestedOrder,
          now,
          now,
        )
      ),
      ...(buildDraftContext?.id
        ? [finalizeSubmissionBuildDraft(db, buildDraftContext.id, id, now)]
        : []),
      ...(mazeArchiveConsent
        ? [
            db.prepare(`INSERT INTO maze_archive_consents
              (submission_id,status,attribution_mode,public_credit,include_explanation,consent_version,consent_text,consented_at,withdrawn_at,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,CASE WHEN ?='granted' THEN ? ELSE NULL END,NULL,?,?)`)
              .bind(id,mazeArchiveConsent.status,mazeArchiveConsent.attributionMode,mazeArchiveConsent.publicCredit,mazeArchiveConsent.includeExplanation?1:0,MAZE_ARCHIVE_CONSENT_VERSION,MAZE_ARCHIVE_CONSENT_TEXT,mazeArchiveConsent.status,now,now,now),
            ...(mazeArchiveConsent.status === "granted"
              ? [db.prepare(`INSERT INTO maze_archive_entries
                  (submission_id,archive_entity_id,curation_status,review_note,reviewed_at,created_at,updated_at)
                  VALUES(?,NULL,'candidate','',NULL,?,?)`).bind(id,now,now)]
              : []),
          ]
        : []),
      ...(specialProjectTerms
        ? [
            db.prepare(
              `INSERT INTO special_project_submission_terms (
                submission_id,project_id,project_profile,project_title,
                series_id,series_name,series_slug,selected_mode,
                refundable_deposit_cents,healed_photo_method,healed_photo_due_weeks,
                participation_terms,agreement_version,agreement_snapshot_json,
                agreed_at,created_at,updated_at
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).bind(
              id,
              specialProjectTerms.projectId,
              specialProjectTerms.profile,
              specialProjectTerms.title,
              specialProjectTerms.seriesId,
              specialProjectTerms.seriesName,
              specialProjectTerms.seriesSlug,
              specialProjectTerms.selectedMode,
              specialProjectTerms.refundableDepositCents,
              specialProjectTerms.healedPhotoMethod,
              specialProjectTerms.healedPhotoDueWeeks,
              specialProjectTerms.participationTerms,
              SPECIAL_PROJECT_AGREEMENT_VERSION,
              JSON.stringify(specialProjectTerms.agreementSnapshot),
              specialProjectTerms.agreed ? now : null,
              now,
              now,
            ),
          ]
        : []),
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
      source: "submission_form",
      sourceId: id,
      formPath: submission.sourcePath || request.url,
      occurredAt: now,
      requestId: request.headers.get("cf-ray") || "",
    }).catch((error) => {
      console.error("Unable to record optional submission marketing consent.", error);
    });

    let briefResult = null;
    if (["build_brief", "maze_design"].includes(submission.type)) {
      briefResult = await generateSubmissionBriefDocument(env, request, {
        id,
        type: submission.type,
        contact: submission.contact,
        payload: submission.payload,
        files: savedFiles,
        createdAt: now,
      });
    }

    const clientNotification = await notifySubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
      briefUrl: briefResult?.ok ? briefResult.document?.clientUrl : "",
      briefLabel: "Download submitted brief",
    });
    const adminNotification = await notifyAdminSubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
      payload: {
        ...submission.payload,
        ...(["build_brief", "maze_design"].includes(submission.type)
          ? { brief_pdf_status: briefResult?.document?.status || "failed" }
          : {}),
      },
    });

    return json({
      ok: true,
      submissionId: id,
      filesStored: savedFiles.filter((file) => file.stored).length,
      filesReceived: savedFiles.length,
      briefDocument: briefResult?.document || null,
      mazeArchive: mazeArchiveConsent ? await loadMazeArchiveState(db, id, submission.payload) : null,
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

    const rows = result.results || [];
    const progressBySubmission = await loadSubmissionProgress(db, rows);
    const sheetDesignsBySubmission = new Map();
    if (rows.length) {
      const placeholders = rows.map(() => "?").join(",");
      const sheetRows = (await db.prepare(
        `SELECT sfd.submission_id,sfd.sheet_design_id,sfd.flash_item_id,
                sfd.code_snapshot,sfd.label_snapshot,sfd.placement,sfd.scale,
                sfd.requested_order,sfd.outcome,fsd.state current_state,
                fsd.reserved_submission_id
         FROM submission_flash_designs sfd
         JOIN flash_sheet_designs fsd ON fsd.id=sfd.sheet_design_id
         WHERE sfd.submission_id IN (${placeholders})
         ORDER BY sfd.submission_id,sfd.requested_order,fsd.sort_order`
      ).bind(...rows.map((row) => row.id)).all()).results || [];
      for (const row of sheetRows) {
        if (!sheetDesignsBySubmission.has(row.submission_id)) sheetDesignsBySubmission.set(row.submission_id, []);
        sheetDesignsBySubmission.get(row.submission_id).push({
          id: row.sheet_design_id,
          flashItemId: row.flash_item_id,
          code: row.code_snapshot,
          label: row.label_snapshot,
          placement: row.placement,
          scale: row.scale,
          requestedOrder: Number(row.requested_order) || 0,
          outcome: row.outcome,
          state: row.current_state,
          reservedSubmissionId: row.reserved_submission_id || "",
          ownedBySubmission: row.reserved_submission_id === row.submission_id,
        });
      }
    }
    const mazeArchiveBySubmission = new Map();
    const mazeRows = rows.filter((row) => row.type === "maze_design");
    if (mazeRows.length) {
      const placeholders = mazeRows.map(() => "?").join(",");
      const states = (await db.prepare(`SELECT c.submission_id,c.status consent_status,c.attribution_mode,c.public_credit,
          c.include_explanation,c.consent_version,c.consented_at,c.withdrawn_at,e.curation_status,e.archive_entity_id,
          e.review_note,e.reviewed_at,ad.archive_slug,ar.title archive_title
        FROM maze_archive_consents c
        LEFT JOIN maze_archive_entries e ON e.submission_id=c.submission_id
        LEFT JOIN archive_dossiers ad ON ad.entity_id=e.archive_entity_id
        LEFT JOIN archive_records ar ON ar.id=e.archive_entity_id
        WHERE c.submission_id IN (${placeholders})`).bind(...mazeRows.map((row) => row.id)).all()).results || [];
      for (const state of states) mazeArchiveBySubmission.set(state.submission_id, {
        consentStatus: state.consent_status,
        attributionMode: state.attribution_mode,
        publicCredit: state.public_credit,
        includeExplanation: Boolean(state.include_explanation),
        consentVersion: state.consent_version,
        consentedAt: state.consented_at || "",
        withdrawnAt: state.withdrawn_at || "",
        curationStatus: state.curation_status || "not_candidate",
        archiveEntityId: state.archive_entity_id || "",
        archiveSlug: state.archive_slug || "",
        archiveTitle: state.archive_title || "",
        reviewNote: state.review_note || "",
        reviewedAt: state.reviewed_at || "",
      });
    }
    return json({
      submissions: rows.map((row) => {
        const normalized = normalizeRow({ ...row, ...(progressBySubmission.get(row.id) || {}) });
        const sheetDesignSelections = sheetDesignsBySubmission.get(row.id) || [];
        return {
          ...normalized,
          mazeArchive: mazeArchiveBySubmission.get(row.id) || null,
          sheetDesignSelections,
          sheet_design_selections: sheetDesignSelections,
        };
      }),
    });
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
        `SELECT id, channel, template_key, template_variant, template_revision,
                recipient, subject, related_type, related_id,
                idempotency_key, status, error, sent_at, created_at
         FROM notification_deliveries
         WHERE (related_type = 'submission' AND related_id = ?)
            OR (related_type = 'appointment' AND related_id IN (
              SELECT id FROM appointments WHERE submission_id = ?
            ))
            OR (related_type = 'tattoo_rendering_request' AND related_id IN (
              SELECT id FROM tattoo_rendering_requests WHERE submission_id = ?
            ))
            OR (related_type = 'submission_brief_document' AND related_id IN (
              SELECT id FROM submission_brief_documents WHERE submission_id = ?
            ))
         ORDER BY created_at DESC`
      )
      .bind(id, id, id, id)
      .all();

    const appointmentEvents = await db.prepare(
      `SELECT ae.* FROM appointment_events ae
       JOIN appointments a ON a.id = ae.appointment_id
       WHERE a.submission_id = ?
       ORDER BY ae.created_at ASC`
    ).bind(id).all();

    const clientEventRows = await db.prepare(
      `SELECT id, booking_token_id, appointment_id, event_type, metadata_json, created_at
       FROM booking_client_events
       WHERE submission_id = ?
       ORDER BY created_at ASC`
    ).bind(id).all();
    const clientEvents = (clientEventRows.results || []).map((event) => ({
      id: event.id,
      bookingTokenId: event.booking_token_id || "",
      appointmentId: event.appointment_id || "",
      eventType: event.event_type,
      metadata: parseJsonField(event.metadata_json, {}),
      createdAt: event.created_at,
    }));

    const renderingRequestRows = await db.prepare(
      `SELECT id, submission_id, appointment_id, request_number, amount_cents, currency,
              status, square_order_id, square_payment_link_id, square_checkout_url,
              square_payment_id, expires_at, paid_at, cancelled_at, created_at, updated_at
       FROM tattoo_rendering_requests
       WHERE submission_id = ? ORDER BY created_at DESC`
    ).bind(id).all();
    const renderingRequests = (renderingRequestRows.results || []).map((requestRow) => ({
      id: requestRow.id,
      submissionId: requestRow.submission_id,
      appointmentId: requestRow.appointment_id,
      requestNumber: Number(requestRow.request_number || 0),
      amountCents: Number(requestRow.amount_cents || 5000),
      currency: requestRow.currency || "USD",
      status: requestRow.status,
      squareOrderId: requestRow.square_order_id || "",
      squarePaymentLinkId: requestRow.square_payment_link_id || "",
      checkoutUrl: requestRow.square_checkout_url || "",
      squarePaymentId: requestRow.square_payment_id || "",
      expiresAt: requestRow.expires_at || "",
      paidAt: requestRow.paid_at || "",
      cancelledAt: requestRow.cancelled_at || "",
      createdAt: requestRow.created_at,
      updatedAt: requestRow.updated_at,
    }));

    const sheetDesignRows = (await db.prepare(
      `SELECT sfd.sheet_design_id,sfd.flash_item_id,sfd.code_snapshot,sfd.label_snapshot,
              sfd.placement,sfd.scale,sfd.requested_order,sfd.outcome,
              fsd.state current_state,fsd.reserved_submission_id
       FROM submission_flash_designs sfd
       JOIN flash_sheet_designs fsd ON fsd.id=sfd.sheet_design_id
       WHERE sfd.submission_id=?
       ORDER BY sfd.requested_order,fsd.sort_order`
    ).bind(id).all()).results || [];
    const sheetDesignSelections = sheetDesignRows.map((row) => ({
      id: row.sheet_design_id,
      flashItemId: row.flash_item_id,
      code: row.code_snapshot,
      label: row.label_snapshot,
      placement: row.placement,
      scale: row.scale,
      requestedOrder: Number(row.requested_order) || 0,
      outcome: row.outcome,
      state: row.current_state,
      reservedSubmissionId: row.reserved_submission_id || "",
      ownedBySubmission: row.reserved_submission_id === id,
      conflictSubmissionId: row.reserved_submission_id && row.reserved_submission_id !== id
        ? row.reserved_submission_id
        : "",
    }));
    let flashReservation = null;
    if (row.type === "flash_claim") {
      const flash = await resolveFlashReference(db, parseJsonField(row.payload_json, {}));
      if (flash) {
        flashReservation = sheetDesignSelections.length
          ? {
              flashId: flash.id,
              slug: flash.slug,
              title: flash.title,
              state: flash.state,
              managedSheet: true,
              designs: sheetDesignSelections,
              ownedBySubmission: sheetDesignSelections.some((design) => design.ownedBySubmission),
              conflictSubmissionId: sheetDesignSelections.find((design) => design.conflictSubmissionId)?.conflictSubmissionId || "",
            }
          : {
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

    const progressBySubmission = await loadSubmissionProgress(db, [row]);
    const normalized = normalizeRow({ ...row, ...(progressBySubmission.get(row.id) || {}) });
    const specialProjectTermsRow = row.type === "special_project"
      ? await db.prepare("SELECT * FROM special_project_submission_terms WHERE submission_id = ?").bind(id).first()
      : null;
    const healedFollowupRow = specialProjectTermsRow?.project_profile === "experimental"
      ? await db.prepare(
          `SELECT * FROM special_project_healed_followups
           WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(id).first()
      : null;
    const healedPhotoRows = healedFollowupRow
      ? await db.prepare(
          `SELECT id,followup_id,original_filename,mime_type,byte_size,created_at
           FROM special_project_healed_photos WHERE followup_id = ? ORDER BY created_at,id`
        ).bind(healedFollowupRow.id).all()
      : { results: [] };
    const experimentalRefundRows = specialProjectTermsRow?.project_profile === "experimental"
      ? await db.prepare(
          `SELECT * FROM experimental_deposit_refunds
           WHERE submission_id = ? ORDER BY created_at DESC`
        ).bind(id).all()
      : { results: [] };
    const specialProjectTerms = specialProjectTermsRow ? {
      projectId: specialProjectTermsRow.project_id,
      profile: specialProjectTermsRow.project_profile,
      title: specialProjectTermsRow.project_title,
      seriesId: specialProjectTermsRow.series_id || "",
      seriesName: specialProjectTermsRow.series_name || "",
      seriesSlug: specialProjectTermsRow.series_slug || "",
      selectedMode: specialProjectTermsRow.selected_mode,
      refundableDepositCents: Number(specialProjectTermsRow.refundable_deposit_cents || 0),
      healedPhotoMethod: specialProjectTermsRow.healed_photo_method || "",
      healedPhotoDueWeeks: Number(specialProjectTermsRow.healed_photo_due_weeks || 6),
      participationTerms: specialProjectTermsRow.participation_terms || "",
      termsVersion: specialProjectTermsRow.agreement_version || "",
      agreementSnapshot: parseJsonField(specialProjectTermsRow.agreement_snapshot_json, {}),
      agreedAt: specialProjectTermsRow.agreed_at || "",
      createdAt: specialProjectTermsRow.created_at,
    } : null;
    const healedFollowup = healedFollowupRow ? {
      id: healedFollowupRow.id,
      appointmentId: healedFollowupRow.appointment_id,
      method: healedFollowupRow.method,
      status: healedFollowupRow.status,
      dueAt: healedFollowupRow.due_at,
      initialInstructionsSentAt: healedFollowupRow.instructions_sent_at || "",
      reminderSentAt: healedFollowupRow.reminder_sent_at || "",
      mediaAssetId: healedFollowupRow.media_asset_id || "",
      completedAt: healedFollowupRow.completed_at || "",
      privateNote: healedFollowupRow.completion_note || "",
      uploadTokenActive: Boolean(healedFollowupRow.token_hash),
      uploadTokenExpiresAt: healedFollowupRow.token_expires_at || "",
      photos: (healedPhotoRows.results || []).map((photo) => ({
        id: photo.id,
        fileName: photo.original_filename,
        contentType: photo.mime_type,
        sizeBytes: Number(photo.byte_size || 0),
        receivedAt: photo.created_at,
      })),
    } : null;
    const mazeArchive = row.type === "maze_design"
      ? await loadMazeArchiveState(db, id, normalized.payload)
      : null;
    const briefDocumentRow = await loadBriefDocument(db, id);
    const briefDocument = await presentBriefDocument(env, request, briefDocumentRow);
    const flashConflict = flashReservation?.conflictSubmissionId
      ? `Reserved by submission ${flashReservation.conflictSubmissionId}`
      : "";
    return json({
      submission: {
        ...normalized,
        flashReservation,
        sheetDesignSelections,
        sheet_design_selections: sheetDesignSelections,
        flashConflict,
        flash_conflict: flashConflict,
        renderingRequests,
        briefDocument,
        mazeArchive,
        specialProjectTerms,
        healedFollowup,
        experimentalRefunds: experimentalRefundRows.results || [],
      },
      events: events.results || [],
      appointmentEvents: appointmentEvents.results || [],
      clientEvents,
      notifications: notifications.results || [],
    });
  } catch (error) {
    return errorResponse("Unable to load submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleOpenSubmission(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireSubmissionDb(env);
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE submissions
       SET opened_at = COALESCE(opened_at, ?)
       WHERE id = ?`
    ).bind(now, id).run();
    const row = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!row) return errorResponse("Submission not found.", 404);
    const progressBySubmission = await loadSubmissionProgress(db, [row]);
    return json({
      submission: normalizeRow({ ...row, ...(progressBySubmission.get(row.id) || {}) }),
    });
  } catch (error) {
    return errorResponse("Unable to mark submission opened.", 500, {
      detail: error.message,
    });
  }
}

async function readAdminJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

export async function handlePromoteMazeArchiveSubmission(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readAdminJson(request);
  if (!body) return errorResponse("Send a JSON object.", 400);
  const title = asString(body.title).trim().slice(0, 200);
  const altText = asString(body.altText || body.alt_text).trim().slice(0, 500);
  const publicExplanation = asString(body.publicExplanation || body.public_explanation).trim().slice(0, 8000);
  if (!title || !altText) return errorResponse("A reviewed title and alt text are required.", 400);

  const database = requireSubmissionDb(env);
  const submission = await database.prepare("SELECT * FROM submissions WHERE id=?").bind(submissionId).first();
  if (!submission || submission.type !== "maze_design") return errorResponse("Maze submission not found.", 404);
  const payload = parseJsonField(submission.payload_json, {});
  const files = parseJsonField(submission.files_json, []);
  const consent = await database.prepare(`SELECT c.*,e.curation_status,e.archive_entity_id
    FROM maze_archive_consents c LEFT JOIN maze_archive_entries e ON e.submission_id=c.submission_id
    WHERE c.submission_id=?`).bind(submissionId).first();
  if (!consent || consent.status !== "granted") return errorResponse("Granted Maze Archive consent is required.", 409);
  if (consent.curation_status === "promoted" && consent.archive_entity_id) {
    return json({ ok: true, idempotent: true, mazeArchive: await loadMazeArchiveState(database, submissionId, payload) });
  }
  if (consent.curation_status !== "candidate") return errorResponse("Only an active candidate can be promoted.", 409);
  if (publicExplanation && !Number(consent.include_explanation)) {
    return errorResponse("This person did not permit their explanation to be considered for publication.", 409);
  }
  const sourceFile = files.find((file) => file.fieldName === "maze_image" && file.stored && file.storageKey && file.contentType === "image/png");
  if (!sourceFile) return errorResponse("A stored PNG is required before promotion.", 409);
  const bucket = env.SUBMISSION_FILES;
  if (!bucket) return errorResponse("Archive media storage is not configured.", 503);

  const entityId = `maze-archive-${submissionId}`;
  const mediaId = `maze-archive-media-${submissionId}`;
  const archiveSlug = `maze-${submissionId}`;
  const archiveKey = `archive/maze/${submissionId}/public.png`;
  const source = await bucket.get(sourceFile.storageKey);
  if (!source?.body) return errorResponse("The private submission PNG could not be found.", 409);

  await bucket.put(archiveKey, source.body, {
    httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { sourceSubmissionId: submissionId, derivativePurpose: "maze-archive-presentation" },
  });

  const now = new Date().toISOString();
  try {
    await database.batch([
      database.prepare(`INSERT INTO content_entities
        (id,entity_type,node_id,visibility,search_visibility,featured,public_at,archived_at,internal_notes,created_by,updated_by,created_at,updated_at)
        VALUES(?,'archive_record','tattoos','internal',0,0,NULL,NULL,?,'maze-archive','maze-archive',?,?)`)
        .bind(entityId,`Promoted from private submission ${submissionId}.`,now,now),
      database.prepare(`INSERT INTO archive_records
        (id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,body_html,record_status,state,why_it_matters,source_note,related_notes_json,related_routes_json,aggregate_attendance,sort_order,created_at,updated_at)
        VALUES(?,?,?,?, 'community-maze','Tattoos','','',?,?,?,'curated submission','draft','','','[]','[]',0,0,?,?)`)
        .bind(entityId,archiveSlug,title,consent.public_credit,"A curated Maze Pattern arrangement.",publicExplanation,"",now,now),
      database.prepare(`INSERT INTO search_documents
        (entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
        VALUES(?,'archive_record','tattoos',?,?,?,?,'draft','Built by Others','','','','',?,?)`)
        .bind(entityId,archiveSlug,title,"A curated Maze Pattern arrangement.",publicExplanation,`/archive/records/${archiveSlug}/`,now),
      database.prepare(`INSERT INTO archive_dossiers
        (entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,'','','No process materials are public for this community Maze.','community-maze','draft',0,0,0,NULL,'maze-archive','maze-archive',?,?)`)
        .bind(entityId,archiveSlug,publicExplanation,now,now),
      database.prepare(`INSERT INTO media_assets
        (id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,credit,rights_notes,privacy,consent_status,state,created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation)
        VALUES(?,'',?,'maze.png','image/png',?,NULL,NULL,NULL,?,'',?,'Maze Archive display permission recorded on the source submission.','public','granted','active','maze-archive',?,?,'','not-requested','',?,'','inline')`)
        .bind(mediaId,archiveKey,Number(sourceFile.size||source.size||0),altText,consent.public_credit,now,now,title),
      database.prepare(`INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
        VALUES(?,?,'primary',1,1,?,'',?)`).bind(entityId,mediaId,altText,now),
      database.prepare(`INSERT INTO archive_dossier_collections(dossier_entity_id,collection_id,sort_order,created_at)
        VALUES(?,'archive-maze-built-by-others',0,?)`).bind(entityId,now),
      database.prepare(`INSERT INTO archive_catalogue_entries
        (entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at)
        SELECT ?,'other','other-cultural-object','OBJ',COALESCE(MAX(catalogue_number),0)+1,
          'OBJ-'||printf('%03d',COALESCE(MAX(catalogue_number),0)+1),1,'I','',NULL,'maze-archive','maze-archive',?,?
        FROM archive_catalogue_entries WHERE catalogue_prefix='OBJ'`).bind(entityId,now,now),
      database.prepare(`INSERT INTO archive_object_versions
        (id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,1,'Version 1','',NULL,'undated','',1,'draft',0,'maze-archive','maze-archive',?,?)`)
        .bind(`archive-version-initial:${entityId}`,entityId,now,now),
      database.prepare(`INSERT INTO archive_object_states
        (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,'I',1,'Submitted arrangement','','',NULL,'undated','',1,'draft',0,NULL,'maze-archive','maze-archive',?,?)`)
        .bind(`archive-state-initial:${entityId}`,`archive-version-initial:${entityId}`,now,now),
      database.prepare("UPDATE archive_catalogue_entries SET current_state_id=?,updated_at=? WHERE entity_id=?")
        .bind(`archive-state-initial:${entityId}`,now,entityId),
      database.prepare("UPDATE maze_archive_entries SET archive_entity_id=?,curation_status='promoted',review_note=?,reviewed_at=?,updated_at=? WHERE submission_id=? AND curation_status='candidate'")
        .bind(entityId,asString(body.reviewNote||body.review_note).slice(0,2000),now,now,submissionId),
      database.prepare(`INSERT INTO submission_events(id,submission_id,event_type,actor,note,created_at)
        VALUES(?,?,'maze_archive_promoted','admin',?,?)`).bind(crypto.randomUUID(),submissionId,`Private Archive draft ${entityId} created.`,now),
    ]);
  } catch (error) {
    await bucket.delete(archiveKey).catch(() => {});
    return errorResponse("Unable to create the Maze Archive draft.", 500, { detail: error.message });
  }
  return json({ ok: true, mazeArchive: await loadMazeArchiveState(database, submissionId, payload) }, { status: 201 });
}

export async function handleUpdateMazeArchiveSubmission(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readAdminJson(request);
  if (!body) return errorResponse("Send a JSON object.", 400);
  const action = asString(body.action).toLowerCase();
  const database = requireSubmissionDb(env);
  const submission = await database.prepare("SELECT * FROM submissions WHERE id=? AND type='maze_design'").bind(submissionId).first();
  if (!submission) return errorResponse("Maze submission not found.", 404);
  const state = await loadMazeArchiveState(database, submissionId, parseJsonField(submission.payload_json, {}));
  if (!state) return errorResponse("This submission has no Maze Archive consent record.", 409);
  const note = asString(body.reviewNote || body.review_note).slice(0,2000);
  const now = new Date().toISOString();
  if (action === "reject" && state.curationStatus === "candidate") {
    await database.batch([
      database.prepare("UPDATE maze_archive_entries SET curation_status='rejected',review_note=?,reviewed_at=?,updated_at=? WHERE submission_id=?").bind(note,now,now,submissionId),
      database.prepare("INSERT INTO submission_events(id,submission_id,event_type,actor,note,created_at) VALUES(?,?,'maze_archive_rejected','admin',?,?)").bind(crypto.randomUUID(),submissionId,note||null,now),
    ]);
  } else if (action === "restore" && state.curationStatus === "rejected" && state.consentStatus === "granted") {
    await database.batch([
      database.prepare("UPDATE maze_archive_entries SET curation_status='candidate',review_note=?,reviewed_at=?,updated_at=? WHERE submission_id=?").bind(note,now,now,submissionId),
      database.prepare("INSERT INTO submission_events(id,submission_id,event_type,actor,note,created_at) VALUES(?,?,'maze_archive_restored','admin',?,?)").bind(crypto.randomUUID(),submissionId,note||null,now),
    ]);
  } else if (action === "withdraw" && state.curationStatus === "promoted" && state.archiveEntityId) {
    await database.batch([
      database.prepare("UPDATE maze_archive_consents SET status='withdrawn',withdrawn_at=?,updated_at=? WHERE submission_id=?").bind(now,now,submissionId),
      database.prepare("UPDATE maze_archive_entries SET curation_status='withdrawn',review_note=?,reviewed_at=?,updated_at=? WHERE submission_id=?").bind(note,now,now,submissionId),
      database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,public_at=NULL,archived_at=?,updated_by='maze-archive',updated_at=? WHERE id=?").bind(now,now,state.archiveEntityId),
      database.prepare("UPDATE archive_records SET state='archived',updated_at=? WHERE id=?").bind(now,state.archiveEntityId),
      database.prepare("UPDATE search_documents SET state='archived',updated_at=? WHERE entity_id=?").bind(now,state.archiveEntityId),
      database.prepare("UPDATE archive_dossiers SET state='archived',public_visible=0,updated_by='maze-archive',updated_at=? WHERE entity_id=?").bind(now,state.archiveEntityId),
      database.prepare("UPDATE entity_media SET public_visible=0 WHERE entity_id=?").bind(state.archiveEntityId),
      database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=? WHERE id IN (SELECT media_id FROM entity_media WHERE entity_id=?)").bind(now,state.archiveEntityId),
      database.prepare("INSERT INTO submission_events(id,submission_id,event_type,actor,note,created_at) VALUES(?,?,'maze_archive_withdrawn','admin',?,?)").bind(crypto.randomUUID(),submissionId,note||null,now),
    ]);
  } else {
    return errorResponse("That Maze Archive action is not available in the current state.", 409);
  }
  return json({ ok: true, mazeArchive: await loadMazeArchiveState(database, submissionId, parseJsonField(submission.payload_json, {})) });
}

export async function handleUpdateSubmission(request, env, id, options = {}) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Expected JSON body.", 400);
  }

  const decisionMode = options.mode === "decision";
  const requestedStatus = asOptionalString(body.status);
  const requestedTattooStageInput = asOptionalString(body.tattooStage || body.tattoo_stage);
  const administrativeLifecycleUpdate = !decisionMode
    && new Set(["archived", "cancelled"]).has(requestedStatus || "");
  if (!decisionMode && (requestedStatus || requestedTattooStageInput) && !administrativeLifecycleUpdate) {
    return errorResponse("Lifecycle decisions cannot be saved through the general submission update endpoint.", 409, {
      code: "DECISION_ENDPOINT_REQUIRED",
    });
  }
  if (!decisionMode) {
    const workingKeys = new Set([
      "internalNotes",
      "lifecycleReviewRequired",
      "lifecycleReviewNote",
      "decisionClientMessage",
      ...(administrativeLifecycleUpdate ? ["status", "tattooStage", "tattoo_stage"] : []),
    ]);
    const unsupported = Object.keys(body).filter((key) => !workingKeys.has(key));
    if (unsupported.length) {
      return errorResponse("The general update endpoint accepts saved Studio working fields only.", 400, {
        code: "WORKING_FIELDS_ONLY",
        fields: unsupported,
      });
    }
  }
  const action = decisionMode ? asString(body.action).toLowerCase() : "";
  if (decisionMode && !new Set(["approve", "decline", "reopen"]).has(action)) {
    return errorResponse("Decision action must be approve, decline, or reopen.", 400);
  }
  if (decisionMode && body.confirmed !== true) {
    return errorResponse("Confirm that this decision is recorded without notifying the client.", 400, {
      code: "DECISION_CONFIRMATION_REQUIRED",
    });
  }
  let status = requestedStatus;
  let requestedTattooStage = requestedTattooStageInput;
  const systemOwnedTattooStages = new Set([
    "consultation_scheduled",
    "consultation_complete",
    "ready_to_book",
    "tattoo_scheduled",
  ]);

  if (requestedStatus && !VALID_STATUSES.has(requestedStatus)) {
    return errorResponse(`Unsupported status: ${status}.`, 400);
  }
  if (requestedTattooStage && !TATTOO_STAGES.has(requestedTattooStage)) {
    return errorResponse(`Unsupported tattoo stage: ${requestedTattooStage}.`, 400);
  }

  try {
    const db = requireSubmissionDb(env);
    const current = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Submission not found.", 404);

    const reviewable = new Set([
      "tattoo_inquiry",
      "flash_claim",
      "special_project",
      "build_brief",
      "maze_design",
      "tattoo_special",
      "art_acquisition",
    ]).has(current.type);
    if (decisionMode && !reviewable) {
      return errorResponse("This entry uses a system-owned lifecycle and cannot be decided here.", 409, {
        code: "SYSTEM_OWNED_LIFECYCLE",
      });
    }
    if (decisionMode) {
      if (action === "approve" && !["new", "reviewing"].includes(current.status)) {
        return errorResponse("Only a New or Reviewing request can be approved.", 409);
      }
      if (action === "decline" && !["new", "reviewing"].includes(current.status)) {
        return errorResponse("Only a New or Reviewing request can be declined.", 409);
      }
      if (action === "reopen" && !["approved", "declined"].includes(current.status)) {
        return errorResponse("Only an Approved or Declined request can be reopened.", 409);
      }
      status = action === "approve" ? "approved" : action === "decline" ? "declined" : "reviewing";
      requestedTattooStage = null;
    } else {
      const workingFields = [
        "internalNotes",
        "lifecycleReviewRequired",
        "lifecycleReviewNote",
        "decisionClientMessage",
      ];
      const hasSavedWork = workingFields.some((key) => Object.prototype.hasOwnProperty.call(body, key));
      status = administrativeLifecycleUpdate
        ? requestedStatus
        : reviewable && current.status === "new" && hasSavedWork ? "reviewing" : null;
      requestedTattooStage = administrativeLifecycleUpdate && isTattooSubmissionType(current.type) ? "closed" : null;
      if (["approved", "declined"].includes(current.status)) {
        const lockedFields = ["lifecycleReviewRequired", "lifecycleReviewNote"]
          .filter((key) => Object.prototype.hasOwnProperty.call(body, key));
        if (lockedFields.length) {
          return errorResponse("Reopen the request before changing decision-defining review fields.", 409, {
            code: "REOPEN_REVIEW_REQUIRED",
          });
        }
      }
    }

    if (decisionMode && action === "reopen") {
      const blocker = await db.prepare(
        `SELECT 'booking_link' AS kind, id FROM booking_tokens
         WHERE submission_id = ? AND revoked_at IS NULL AND used_at IS NULL AND expires_at > ?
         UNION ALL
         SELECT CASE
           WHEN status = 'confirmed' THEN 'confirmed_appointment'
           ELSE 'pending_checkout'
         END AS kind, id FROM appointments
         WHERE submission_id = ? AND (
           status = 'confirmed'
           OR (status IN ('pending_deposit','deposit_pending') AND hold_state IN ('active','expiry_attention'))
         )
         LIMIT 1`
      ).bind(id, new Date().toISOString(), id).first();
      if (blocker) {
        const blockerMessage = blocker.kind === "booking_link"
          ? "Revoke the active booking link before reopening review."
          : blocker.kind === "pending_checkout"
            ? "Release the pending checkout and its held time before reopening review."
            : blocker.kind === "confirmed_appointment"
              ? "Cancel the confirmed appointment before reopening review."
              : "Clear the active booking commitment before reopening review.";
        return errorResponse(blockerMessage, 409, {
          code: "ACTIVE_ACCESS_BLOCKS_REOPEN",
          blockerType: blocker.kind,
          blockerId: blocker.id,
        });
      }
    }

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
    const guardActiveAppointments = changesLifecycle
      && !(decisionMode && ["approve", "decline"].includes(action) && current.type === "tattoo_special")
      && !(current.status === "new" && status === "reviewing");
    if (guardActiveAppointments) {
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
    const specialProjectTerms = current.type === "special_project"
      ? await db.prepare("SELECT project_profile, selected_mode FROM special_project_submission_terms WHERE submission_id = ?")
        .bind(id).first()
      : null;
    const experimentalSpecialProject = specialProjectTerms?.project_profile === "experimental";
    const requestedExperimentalConsultation = Boolean(
      decisionMode
      && action === "approve"
      && current.type === "special_project"
      && ["cover_up", "blast_over"].includes(specialProjectTerms?.selected_mode)
      && body.consultationRequired === true
    );
    const requiresPrerequisiteConsultation = submissionNeedsPrerequisiteConsultation(current)
      || requestedExperimentalConsultation;
    if (requestedTattooStage && !isTattoo) {
      return errorResponse("Tattoo stages apply only to tattoo project submissions.", 409);
    }

    let specialDecision = null;
    if (decisionMode && current.type === "tattoo_special") {
      const terms = await db.prepare(
        "SELECT * FROM tattoo_special_submission_terms WHERE submission_id = ?"
      ).bind(id).first();
      if (!terms) return errorResponse("Tattoo Special terms are missing.", 409);
      if (terms.booking_mode !== "review") {
        return errorResponse("This historical Tattoo Special uses a system-owned booking flow.", 409);
      }
      if (action === "approve") {
        if (new Date(terms.sales_closes_at).getTime() <= Date.now()) {
          return errorResponse("The Tattoo Specials sales window has closed.", 409);
        }
        const requestedAppointment = await db.prepare(
          `SELECT id FROM appointments
           WHERE submission_id = ? AND status = 'requested'
             AND hold_state IS NULL AND approval_state IN ('pending','approved')
           ORDER BY created_at DESC LIMIT 1`
        ).bind(id).first();
        const advertised = Number(terms.advertised_price_cents || 0);
        const approvedPrice = terms.offer_id === "special-anime"
          ? Number(body.approvedPriceCents || advertised)
          : advertised;
        if (!Number.isInteger(approvedPrice) || approvedPrice < advertised) {
          return errorResponse("The approved Tattoo Special price is invalid.", 400);
        }
        specialDecision = { terms, requestedAppointment: requestedAppointment || null, approvedPrice };
      } else {
        specialDecision = { terms };
      }
    }

    if (decisionMode && action === "approve" && isTattoo && current.type !== "tattoo_special") {
      if (!requiresPrerequisiteConsultation) {
        const reviewedPlan = await db.prepare(
          `SELECT session_category, split_policy, approved_budget_min_cents, approved_budget_max_cents
           FROM tattoo_session_plans WHERE submission_id = ?`
        ).bind(id).first();
        const completePlan = reviewedPlan
          && reviewedPlan.session_category !== "artist_review"
          && reviewedPlan.split_policy !== "artist_review";
        const completeBudget = Number(reviewedPlan?.approved_budget_min_cents || 0) > 0
          && Number(reviewedPlan?.approved_budget_max_cents || 0) >= Number(reviewedPlan?.approved_budget_min_cents || 0);
        if (!completePlan || (!experimentalSpecialProject && !completeBudget)) {
          return errorResponse(experimentalSpecialProject
            ? "Finish the reviewed session plan before approving this free Experimental Project."
            : "Finish the reviewed session plan and approved project budget before approval.", 409, {
            code: "REVIEWED_PLAN_AND_BUDGET_REQUIRED",
          });
        }
      }
    }

    const nextStatus = status || current.status;
    let nextTattooStage = current.tattoo_stage || (isTattoo ? "review" : null);
    if (isTattoo && nextStatus === "approved" && current.status !== "approved") {
      if (current.type === "tattoo_special") {
        nextTattooStage = "ready_to_book";
      } else if (requiresPrerequisiteConsultation) {
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
    if (isTattoo && decisionMode && action === "reopen") nextTattooStage = "review";
    if (isTattoo && ["declined", "cancelled", "archived"].includes(nextStatus)) {
      nextTattooStage = "closed";
    }
    if (isTattoo && !(decisionMode && action === "reopen") && !canTransitionTattooStage(current.tattoo_stage || "review", nextTattooStage)) {
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
      return errorResponse("This project requires a completed prerequisite consultation before tattoo booking.", 409);
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
    const decisionClientMessage = hasOwn("decisionClientMessage")
      ? asString(body.decisionClientMessage).slice(0, 3000)
      : current.decision_client_message || "";
    const now = new Date().toISOString();
    const statusChanged = nextStatus !== current.status;
    const stageChanged = nextTattooStage !== current.tattoo_stage;
    const eventType = decisionMode
      ? `decision_${action === "reopen" ? "reopened" : action === "approve" ? "approved" : "declined"}`
      : statusChanged ? "status_changed" : stageChanged ? "tattoo_stage_changed" : "updated";
    const eventNote = [
      statusChanged ? `${current.status} -> ${nextStatus}` : "",
      stageChanged ? `${current.tattoo_stage || "(none)"} -> ${nextTattooStage}` : "",
    ].filter(Boolean).join("; ") || null;

    const updateStatement = db.prepare(
         `UPDATE submissions
         SET status = ?, tattoo_stage = ?, internal_notes = ?, booking_url = ?, decision_client_message = ?,
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
        decisionClientMessage,
        lifecycleReviewRequired,
        lifecycleReviewNote,
        now,
        id,
        current.updated_at,
        current.status,
        current.tattoo_stage,
        guardActiveAppointments ? 1 : 0,
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
    if (requestedExperimentalConsultation) {
      statements.push(
        db.prepare(
          `UPDATE submissions
           SET payload_json=json_set(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.consult_required','yes')
           WHERE id=? AND updated_at=?`
        ).bind(id, now),
      );
    }
    if (current.type === "flash_claim" && nextStatus === "approved" && current.status !== "approved") {
      const flash = await resolveFlashReference(db, parseJsonField(current.payload_json, {}));
      if (!flash) {
        return errorResponse("The flash attached to this claim could not be resolved.", 409, {
          code: "FLASH_NOT_FOUND",
        });
      }
      const requestedSheetDesigns = (await db.prepare(
        `SELECT sfd.sheet_design_id,sfd.outcome,fsd.code,fsd.state,fsd.reserved_submission_id
         FROM submission_flash_designs sfd
         JOIN flash_sheet_designs fsd ON fsd.id=sfd.sheet_design_id
         WHERE sfd.submission_id=?
         ORDER BY sfd.requested_order`
      ).bind(id).all()).results || [];
      if (requestedSheetDesigns.length) {
        const approvedRaw = body.approved_sheet_design_ids ?? body.approvedSheetDesignIds;
        if (!Array.isArray(approvedRaw)) {
          return errorResponse("Choose the requested sheet designs to approve.", 400, {
            code: "SHEET_APPROVAL_SELECTION_REQUIRED",
          });
        }
        const approvedIds = [...new Set(approvedRaw.map(asString).filter(Boolean))];
        if (!approvedIds.length) {
          return errorResponse("Approve at least one requested sheet design.", 400, {
            code: "SHEET_APPROVAL_SELECTION_REQUIRED",
          });
        }
        const requestedById = new Map(requestedSheetDesigns.map((row) => [row.sheet_design_id, row]));
        if (approvedIds.some((designId) => !requestedById.has(designId))) {
          return errorResponse("Approved sheet designs must be a subset of the client's request.", 400, {
            code: "INVALID_SHEET_APPROVAL_SELECTION",
          });
        }
        const unavailable = approvedIds
          .map((designId) => requestedById.get(designId))
          .find((design) => design.state !== "available" && design.reserved_submission_id !== id);
        if (unavailable) {
          return errorResponse(`Design ${unavailable.code} was reserved by another approved claim.`, 409, {
            code: "FLASH_RESERVATION_CONFLICT",
          });
        }
        const placeholders = approvedIds.map(() => "?").join(",");
        const approvalPayload = parseJsonField(current.payload_json, {});
        const requestedSnapshots = Array.isArray(approvalPayload.sheet_design_selections)
          ? approvalPayload.sheet_design_selections
          : [];
        approvalPayload.approved_sheet_designs = approvedIds.map((designId) => {
          const snapshot = requestedSnapshots.find((entry) => entry.id === designId) || {};
          const currentDesign = requestedById.get(designId);
          return {
            id: designId,
            code: snapshot.code || currentDesign?.code || "",
            label: snapshot.label || "",
            placement: snapshot.placement || "",
            scale: snapshot.scale || "",
          };
        });
        const reserveStatement = db.prepare(
          `UPDATE flash_sheet_designs
           SET state='reserved',reserved_submission_id=?,updated_at=?
           WHERE id IN (${placeholders})
             AND ((state='available' AND reserved_submission_id IS NULL) OR reserved_submission_id=?)
             AND (
               SELECT COUNT(*) FROM flash_sheet_designs
               WHERE id IN (${placeholders})
                 AND ((state='available' AND reserved_submission_id IS NULL) OR reserved_submission_id=?)
             )=?
             AND EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.id=? AND s.updated_at=? AND s.status=?
                 AND COALESCE(s.tattoo_stage,'')=COALESCE(?,'')
                 AND NOT EXISTS (
                   SELECT 1 FROM appointments active_appointment
                   WHERE active_appointment.submission_id=s.id
                     AND (
                       active_appointment.status='confirmed'
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
          ...approvedIds,
          id,
          ...approvedIds,
          id,
          approvedIds.length,
          id,
          current.updated_at,
          current.status,
          current.tattoo_stage,
        );
        const outcomeStatement = db.prepare(
          `UPDATE submission_flash_designs
           SET outcome=CASE WHEN sheet_design_id IN (${placeholders}) THEN 'approved' ELSE 'not_approved' END,
               updated_at=?
           WHERE submission_id=? AND outcome='requested'
             AND (
               SELECT COUNT(*) FROM flash_sheet_designs
               WHERE id IN (${placeholders}) AND reserved_submission_id=? AND state='reserved'
             )=?`
        ).bind(
          ...approvedIds,
          now,
          id,
          ...approvedIds,
          id,
          approvedIds.length,
        );
        const guardedUpdate = db.prepare(
          `UPDATE submissions
           SET status=?,tattoo_stage=?,internal_notes=?,booking_url=?,decision_client_message=?,payload_json=?,
               lifecycle_review_required=?,lifecycle_review_note=?,updated_at=?
           WHERE id=? AND updated_at=? AND status=?
             AND COALESCE(tattoo_stage,'')=COALESCE(?,'')
             AND (
               SELECT COUNT(*) FROM flash_sheet_designs
               WHERE id IN (${placeholders}) AND reserved_submission_id=? AND state='reserved'
             )=?
             AND NOT EXISTS (
               SELECT 1 FROM appointments active_appointment
               WHERE active_appointment.submission_id=submissions.id
                 AND (
                   active_appointment.status='confirmed'
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
          decisionClientMessage,
          JSON.stringify(approvalPayload),
          lifecycleReviewRequired,
          lifecycleReviewNote,
          now,
          id,
          current.updated_at,
          current.status,
          current.tattoo_stage,
          ...approvedIds,
          id,
          approvedIds.length,
        );
        statements = [reserveStatement, outcomeStatement, guardedUpdate, eventStatement];
        updateIndex = 2;
      } else {
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
        ).bind(id,now,flash.id,id,id,current.updated_at,current.status,current.tattoo_stage);
        const guardedUpdate = db.prepare(
          `UPDATE submissions
           SET status = ?, tattoo_stage = ?, internal_notes = ?, booking_url = ?, decision_client_message = ?,
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
        ).bind(nextStatus,nextTattooStage,internalNotes,bookingUrl,decisionClientMessage,lifecycleReviewRequired,lifecycleReviewNote,now,id,flash.id,id,current.updated_at,current.status,current.tattoo_stage);
        statements = [reserveStatement, guardedUpdate, eventStatement];
        updateIndex = 1;
      }
    }

    if (current.type === "flash_claim" && ["declined", "cancelled", "archived"].includes(nextStatus)) {
      statements.push(
        db.prepare(
          `UPDATE flash_items
           SET state='available',claimable=1,reserved_submission_id=NULL,updated_at=?
           WHERE reserved_submission_id=? AND state='reserved'
             AND EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.id=? AND s.updated_at=? AND s.status=?
                 AND COALESCE(s.tattoo_stage,'')=COALESCE(?,'')
             )`
        ).bind(now,id,id,now,nextStatus,nextTattooStage),
        db.prepare(
          `UPDATE flash_sheet_designs
           SET state='available',reserved_submission_id=NULL,updated_at=?
           WHERE reserved_submission_id=? AND state='reserved'
             AND EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.id=? AND s.updated_at=? AND s.status=?
                 AND COALESCE(s.tattoo_stage,'')=COALESCE(?,'')
             )`
        ).bind(now,id,id,now,nextStatus,nextTattooStage),
        db.prepare(
          `UPDATE submission_flash_designs
           SET outcome='released',updated_at=?
           WHERE submission_id=? AND outcome='approved'
             AND EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.id=? AND s.updated_at=? AND s.status=?
                 AND COALESCE(s.tattoo_stage,'')=COALESCE(?,'')
             )`
        ).bind(now,id,id,now,nextStatus,nextTattooStage),
      );
    }

    if (specialDecision) {
      if (action === "approve") {
        statements.push(
          db.prepare(
            "UPDATE tattoo_special_submission_terms SET approved_price_cents = ?, review_outcome = 'approved', updated_at = ? WHERE submission_id = ?"
          ).bind(specialDecision.approvedPrice, now, id),
          db.prepare(
            "UPDATE tattoo_session_plans SET approved_budget_min_cents = ?, approved_budget_max_cents = ?, updated_at = ? WHERE submission_id = ?"
          ).bind(specialDecision.approvedPrice, specialDecision.approvedPrice, now, id),
          db.prepare(
            "UPDATE submissions SET payload_json=json_set(payload_json,'$.approved_price_cents',?) WHERE id=? AND updated_at=?"
          ).bind(specialDecision.approvedPrice, id, now),
        );
        if (specialDecision.requestedAppointment?.id) {
          statements.push(db.prepare(
            `UPDATE appointments SET approval_state = 'approved', approval_decided_at = COALESCE(approval_decided_at, ?), updated_at = ?
             WHERE id = ? AND status='requested' AND hold_state IS NULL AND approval_state IN ('pending','approved')`
          ).bind(now, now, specialDecision.requestedAppointment.id));
        }
      } else if (action === "decline") {
        statements.push(
          db.prepare("UPDATE tattoo_special_submission_terms SET review_outcome = 'declined', updated_at = ? WHERE submission_id = ?").bind(now, id),
          db.prepare(
            `UPDATE appointments SET status = 'cancelled', hold_state = 'released', approval_state = 'declined',
             approval_decided_at = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ?
             WHERE submission_id = ? AND (
               (status='requested' AND hold_state IS NULL)
               OR (status IN ('pending_deposit','deposit_pending') AND hold_state IN ('active','expiry_attention'))
             )`
          ).bind(now, now, decisionClientMessage || "Studio declined request", now, id),
          db.prepare("UPDATE booking_tokens SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE submission_id = ?")
            .bind(now, now, id),
        );
      } else if (action === "reopen") {
        statements.push(
          db.prepare("UPDATE tattoo_special_submission_terms SET review_outcome = 'pending', updated_at = ? WHERE submission_id = ?").bind(now, id),
        );
      }
    }

    if (decisionMode) {
      const storedDecisionMessage = action === "decline" ? decisionClientMessage : "";
      statements.push(
        db.prepare(
          `UPDATE submissions
           SET decision_revision = decision_revision + ?, decided_at = ?, decision_client_message = ?
           WHERE id = ? AND updated_at = ?`
        ).bind(action === "reopen" ? 0 : 1, action === "reopen" ? null : now, storedDecisionMessage, id, now),
      );
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
    const progressBySubmission = await loadSubmissionProgress(db, [updated]);
    return json({
      submission: normalizeRow({ ...updated, ...(progressBySubmission.get(updated.id) || {}) }),
    });
  } catch (error) {
    return errorResponse("Unable to update submission.", 500, {
      detail: error.message,
    });
  }
}

export async function handleSubmissionDecision(request, env, id) {
  return handleUpdateSubmission(request, env, id, { mode: "decision" });
}

export async function handleSubmissionDecisionNotification(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readAdminJson(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  if (body.resend === true && body.confirmed !== true) {
    return errorResponse("Confirm before resending a client notification.", 400, {
      code: "RESEND_CONFIRMATION_REQUIRED",
    });
  }

  try {
    const db = requireSubmissionDb(env);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!submission) return errorResponse("Submission not found.", 404);
    if (!submission.contact_email) return errorResponse("This submission has no client email.", 409, { code: "CLIENT_EMAIL_REQUIRED" });
    const revision = Number(submission.decision_revision || 0);
    const attemptKey = `decision_notification:${id}:${revision}:${crypto.randomUUID()}`;
    const kind = asString(body.kind).toLowerCase();
    let delivery;

    if (kind === "simplification") {
      if (submission.type !== "tattoo_special" || submission.status !== "reviewing") {
        return errorResponse("A simplification request is not available for this submission.", 409);
      }
      const terms = await db.prepare("SELECT * FROM tattoo_special_submission_terms WHERE submission_id = ?").bind(id).first();
      if (!terms || terms.review_outcome !== "simplification_requested") {
        return errorResponse("Save a simplification request before sending it.", 409);
      }
      const message = asString(submission.decision_client_message).slice(0, 3000);
      if (!message) return errorResponse("Add the reviewed client-facing simplification note before sending.", 409);
      delivery = await notifyTattooSpecialReview(env, {
        ...submission,
        ...terms,
        submissionId: id,
        outcome: "simplification_requested",
        note: message,
      }, { idempotencyKey: attemptKey });
    } else if (submission.status === "declined") {
      const reason = asString(submission.decision_client_message).slice(0, 3000);
      if (!reason) return errorResponse("Add and save a reviewed client-facing decline reason before sending.", 409, {
        code: "DECLINE_REASON_REQUIRED",
      });
      delivery = await notifySubmissionDecision(env, submission, {
        decision: "declined",
        decisionRevision: revision,
        message: reason,
        idempotencyKey: attemptKey,
      });
    } else if (submission.status === "approved" && submission.type === "tattoo_special") {
      const details = await db.prepare(
        `SELECT offer_title,variant_label,approved_price_cents,deposit_cents
         FROM tattoo_special_submission_terms WHERE submission_id=?`
      ).bind(id).first();
      if (!details) {
        return errorResponse("Prepare the Tattoo Special booking link before sending approval.", 409, {
          code: "DEPOSIT_LINK_REQUIRED",
        });
      }
      const clientAccess = submission.booking_url
        ? await activeBookingAccessForUrl(db, id, submission.booking_url)
        : null;
      if (!clientAccess) {
        return errorResponse("Prepare the Tattoo Special client booking access before sending approval.", 409, {
          code: "DEPOSIT_CLIENT_LINK_REQUIRED",
        });
      }
      delivery = await notifyTattooSpecialDepositRequested(env, request, {
        submissionId: id,
        clientName: submission.contact_name,
        clientEmail: submission.contact_email,
        offerTitle: details.offer_title,
        variantLabel: details.variant_label,
        approvedPriceCents: details.approved_price_cents,
        depositCents: details.deposit_cents,
        currency: "USD",
        expiresAt: clientAccess.expires_at,
        checkoutUrl: absoluteClientUrl(env, request, submission.booking_url),
      }, { idempotencyKey: attemptKey });
    } else if (submission.status === "approved" && isTattooSubmissionType(submission.type)) {
      const token = await db.prepare(
        `SELECT * FROM booking_tokens
         WHERE submission_id=? AND revoked_at IS NULL AND used_at IS NULL AND expires_at>?
         ORDER BY created_at DESC LIMIT 1`
      ).bind(id, new Date().toISOString()).first();
      if (!token || !submission.booking_url) {
        return errorResponse("Generate booking access before sending approval.", 409, {
          code: "BOOKING_LINK_REQUIRED",
        });
      }
      const plan = await db.prepare(
        "SELECT approved_budget_min_cents,approved_budget_max_cents,approved_budget_currency FROM tattoo_session_plans WHERE submission_id=?"
      ).bind(id).first();
      delivery = await notifyBookingLinkCreated(env, request, submission, {
        id: token.id,
        bookingUrl: submission.booking_url,
        expiresAt: token.expires_at,
        allowedBookingTypes: parseJsonField(token.allowed_booking_types_json, []),
        purpose: token.purpose,
        approvedBudget: plan ? {
          minimumCents: plan.approved_budget_min_cents,
          maximumCents: plan.approved_budget_max_cents,
          currency: plan.approved_budget_currency || "USD",
        } : null,
      }, { idempotencyKey: attemptKey });
    } else if (submission.status === "approved") {
      delivery = await notifySubmissionDecision(env, submission, {
        decision: "approved",
        decisionRevision: revision,
        message: asString(submission.decision_client_message).slice(0, 3000),
        idempotencyKey: attemptKey,
      });
    } else {
      return errorResponse("Record an approval or decline before sending a decision notification.", 409);
    }

    const httpStatus = delivery?.ok ? 200 : 502;
    return json({ ok: Boolean(delivery?.ok), delivery, decisionRevision: revision }, { status: httpStatus });
  } catch (error) {
    return errorResponse("Unable to send the decision notification.", 500, { detail: error.message });
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
    const briefDocument = await loadBriefDocument(db, id);

    const appointmentCount = await db
      .prepare("SELECT COUNT(*) AS count FROM appointments WHERE submission_id = ?")
      .bind(id)
      .first();
    if (Number(appointmentCount?.count || 0) > 0) {
      return errorResponse("Permanently delete each linked appointment before deleting this submission. Linked appointments are not detached or left on the calendar.", 409, {
        code: "SUBMISSION_APPOINTMENTS_REQUIRE_DELETE",
        appointmentCount: Number(appointmentCount?.count || 0),
      });
    }

    if (!force && ["booked", "paid", "cancelled", "archived"].includes(current.status)) {
      return errorResponse("Submission has protected lifecycle history. Archive it instead of deleting.", 409);
    }

    const reservation = await db
      .prepare(
        `SELECT id FROM flash_items WHERE reserved_submission_id=?
         UNION ALL
         SELECT id FROM flash_sheet_designs WHERE reserved_submission_id=?
         LIMIT 1`
      )
      .bind(id, id)
      .first();
    if (!force && reservation) {
      return errorResponse("Submission owns a Flash reservation. Archive or decline it through the lifecycle workflow instead.", 409);
    }

    const storedFiles = parseJsonField(current.files_json, []).filter((file) => file?.storageKey);
    if (!force && storedFiles.length) {
      return errorResponse("Submission has stored files. Archive it instead of deleting so file history is not orphaned.", 409);
    }
    if (!force && briefDocument) {
      return errorResponse("Submission has a client brief PDF record. Archive it instead of deleting.", 409);
    }
    if (force && (storedFiles.length || briefDocument?.storage_key) && !env.SUBMISSION_FILES) {
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
          `UPDATE flash_sheet_designs
           SET state='available',reserved_submission_id=NULL,updated_at=?
           WHERE reserved_submission_id=? AND state='reserved'`
        ).bind(new Date().toISOString(), id),
        db.prepare(
          `UPDATE submission_flash_designs
           SET outcome='released',updated_at=?
           WHERE submission_id=? AND outcome='approved'`
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
      if (briefDocument?.storage_key) {
        try {
          await env.SUBMISSION_FILES.delete(briefDocument.storage_key);
          deletedFileCount += 1;
        } catch {
          cleanupWarnings.push("Stored brief PDF cleanup failed.");
        }
      }
    }

    return json({
      ok: true,
      deletedId: id,
      permanent: force,
      detachedAppointments: 0,
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
