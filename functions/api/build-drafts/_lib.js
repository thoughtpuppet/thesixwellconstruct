import { notifyTattooBuildDraftResume } from "../notifications/_lib.js";
import { normalizeCompositionSnapshot } from "../../../js/build-composition.js";

const VALID_KINDS = new Set(["build_brief", "maze_design"]);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TOMBSTONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const BUILD_MAX_BYTES = 64 * 1024;
const MAZE_MAX_BYTES = 2 * 1024 * 1024;
const NOTE_MAX_LENGTH = 300;

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

function failure(message, status = 400, extras = {}) {
  return json({ error: message, ...extras }, { status });
}

function db(env) {
  return env.SUBMISSIONS_DB || null;
}

function asString(value, max = 10000) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function normalizedEmail(value) {
  return asString(value, 320).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function expiresAt() {
  return new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
}

function requestIp(request) {
  return asString(
    request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]
      || "unknown",
    200,
  );
}

function rawTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBody(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function normalizeContact(payload = {}) {
  return {
    firstName: asString(payload.firstName, 120),
    lastName: asString(payload.lastName, 120),
    email: normalizedEmail(payload.email),
    phone: asString(payload.phone, 80),
  };
}

function normalizeSymbolSelections(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const selections = [];
  for (const entry of value.slice(0, 12)) {
    const id = asString(entry?.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    selections.push({
      id,
      order: selections.length,
      name: asString(entry?.name, 200),
      category: asString(entry?.category, 160),
      note: asString(entry?.note, NOTE_MAX_LENGTH),
    });
  }
  return selections;
}

function normalizeBuildPayload(payload = {}) {
  return {
    version: 1,
    clientDraftId: asString(payload.clientDraftId, 160),
    symbolSelections: normalizeSymbolSelections(payload.symbolSelections),
    compositionSnapshot: normalizeCompositionSnapshot(payload.compositionSnapshot),
    contact: normalizeContact(payload.contact),
    placement: asString(payload.placement, 300),
    scale: asString(payload.scale, 160),
    budgetRange: asString(payload.budgetRange || payload.budget_range, 160),
    budgetAmountDollars: asString(payload.budgetAmountDollars || payload.budget_amount_dollars, 20),
    timeline: asString(payload.timeline, 300),
    designIntent: asString(payload.designIntent, 5000),
    message: asString(payload.message, 5000),
    updatedAt: asString(payload.updatedAt, 80) || new Date().toISOString(),
  };
}

function normalizeMazePayload(payload = {}) {
  const canvasLayout = ["tall", "square", "wide"].includes(payload.canvasLayout)
    ? payload.canvasLayout
    : "wide";
  const canvasMode = payload.canvasMode === "negative-space" ? "negative-space" : "standard";
  const canvasTone = ["light", "light-medium", "medium", "golden-brown", "medium-deep", "deep", "rich-deep"].includes(payload.canvasTone)
    ? payload.canvasTone
    : "golden-brown";
  return {
    version: 1,
    clientDraftId: asString(payload.clientDraftId, 160),
    canvasLayout,
    canvasMode,
    canvasTone,
    mazeWalls: Array.isArray(payload.mazeWalls) ? payload.mazeWalls : [],
    mazeShapes: Array.isArray(payload.mazeShapes) ? payload.mazeShapes : [],
    contact: normalizeContact(payload.contact),
    placement: asString(payload.placement, 300),
    scale: asString(payload.scale, 160),
    budgetRange: asString(payload.budgetRange || payload.budget_range, 160),
    budgetAmountDollars: asString(payload.budgetAmountDollars || payload.budget_amount_dollars, 20),
    mazeMeaning: asString(payload.mazeMeaning || payload.mazeExplanation, 5000),
    mazeDescription: asString(payload.mazeDescription, 5000),
    updatedAt: asString(payload.updatedAt, 80) || new Date().toISOString(),
  };
}

function normalizePayload(kind, payload) {
  if (!VALID_KINDS.has(kind)) {
    return { error: "Draft kind must be build_brief or maze_design." };
  }
  const normalized = kind === "build_brief"
    ? normalizeBuildPayload(payload)
    : normalizeMazePayload(payload);
  const serialized = JSON.stringify(normalized);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  const maximum = kind === "build_brief" ? BUILD_MAX_BYTES : MAZE_MAX_BYTES;
  if (bytes > maximum) {
    return {
      error: kind === "build_brief"
        ? "This Build draft is too large to save."
        : "This Maze draft exceeds the 2 MB save limit.",
      status: 413,
    };
  }
  return { payload: normalized, serialized };
}

function hasDraftContent(kind, payload) {
  return kind === "build_brief"
    ? payload.symbolSelections.length > 0
    : payload.mazeWalls.length > 0 || payload.mazeShapes.length > 0;
}

async function rowForToken(database, rawToken) {
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await database.prepare(
    "SELECT * FROM tattoo_build_drafts WHERE token_hash = ? LIMIT 1"
  ).bind(tokenHash).first();
  return row ? { row, tokenHash } : null;
}

async function activeDraft(request, env) {
  const database = db(env);
  if (!database) return { response: failure("Draft storage is unavailable.", 503) };
  const resolved = await rowForToken(database, rawTokenFromRequest(request));
  if (!resolved) return { response: failure("This draft link is invalid.", 401, { code: "DRAFT_INVALID" }) };
  const { row } = resolved;
  const now = new Date().toISOString();
  if (row.status !== "active") {
    return {
      response: failure(
        row.status === "submitted"
          ? "This draft has already been submitted."
          : row.status === "expired"
            ? "This draft link has expired."
            : "This draft is no longer available.",
        410,
        { code: `DRAFT_${String(row.status).toUpperCase()}` },
      ),
    };
  }
  if (row.expires_at <= now) {
    await database.prepare(
      "UPDATE tattoo_build_drafts SET status='expired',payload_json='{}',updated_at=? WHERE id=?"
    ).bind(now, row.id).run();
    return { response: failure("This draft link has expired.", 410, { code: "DRAFT_EXPIRED" }) };
  }
  return { database, row, tokenHash: resolved.tokenHash, rawToken: rawTokenFromRequest(request) };
}

async function emailRateLimit(database, request, email) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [emailHash, ipHash] = await Promise.all([
    sha256Hex(email),
    sha256Hex(requestIp(request)),
  ]);
  const [emailCount, ipCount] = await Promise.all([
    database.prepare(
      "SELECT COUNT(*) count FROM tattoo_build_draft_email_attempts WHERE email_hash=? AND created_at>?"
    ).bind(emailHash, since).first(),
    database.prepare(
      "SELECT COUNT(*) count FROM tattoo_build_draft_email_attempts WHERE ip_hash=? AND created_at>?"
    ).bind(ipHash, since).first(),
  ]);
  if (Number(emailCount?.count || 0) >= 3 || Number(ipCount?.count || 0) >= 10) {
    return { response: failure("Too many resume emails were requested. Try again later.", 429), emailHash, ipHash };
  }
  return { emailHash, ipHash };
}

async function sendDraftEmail(database, request, env, row, rawToken) {
  const rate = await emailRateLimit(database, request, row.owner_email);
  if (rate.response) return { ok: false, response: rate.response };
  const result = await notifyTattooBuildDraftResume(env, request, row, rawToken, {
    idempotencyKey: `tattoo_build_draft_resume:${row.id}:${crypto.randomUUID()}`,
  });
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO tattoo_build_draft_email_attempts
       (id,draft_id,email_hash,ip_hash,delivered,created_at) VALUES(?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(),
      row.id,
      rate.emailHash,
      rate.ipHash,
      result?.ok ? 1 : 0,
      now,
    ),
    database.prepare(
      "UPDATE tattoo_build_drafts SET last_emailed_at=?,updated_at=? WHERE id=?"
    ).bind(result?.ok ? now : row.last_emailed_at, now, row.id),
  ]);
  return { ok: Boolean(result?.ok), delivery: result };
}

function presentedDraft(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch {}
  return {
    id: row.id,
    kind: row.draft_kind,
    email: row.owner_email,
    payload,
    revision: Number(row.revision || 1),
    status: row.status,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

export async function handleCreateBuildDraft(request, env) {
  const body = await readBody(request);
  if (!body) return failure("Expected a JSON body.", 400);
  if (asString(body._gotcha)) return json({ ok: true, spam: true });
  const database = db(env);
  if (!database) return failure("Draft storage is unavailable.", 503);
  const kind = asString(body.kind, 40);
  const email = normalizedEmail(body.email || body.payload?.contact?.email);
  if (!isEmail(email)) return failure("A valid email is required.", 400);
  const normalized = normalizePayload(kind, body.payload || {});
  if (normalized.error) return failure(normalized.error, normalized.status || 400);
  if (!hasDraftContent(kind, normalized.payload)) {
    return failure(kind === "build_brief" ? "Select at least one symbol before emailing this draft." : "Add at least one Maze mark before emailing this draft.", 400);
  }
  const rate = await emailRateLimit(database, request, email);
  if (rate.response) return rate.response;

  const rawToken = createToken();
  const tokenHash = await sha256Hex(rawToken);
  const id = `tattoo-draft-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiry = expiresAt();
  await database.prepare(
    `INSERT INTO tattoo_build_drafts
     (id,draft_kind,owner_email,token_hash,payload_json,revision,status,expires_at,created_at,updated_at)
     VALUES(?,?,?,?,?,1,'active',?,?,?)`
  ).bind(id, kind, email, tokenHash, normalized.serialized, expiry, now, now).run();
  const row = await database.prepare("SELECT * FROM tattoo_build_drafts WHERE id=?").bind(id).first();
  const sent = await sendDraftEmail(database, request, env, row, rawToken);
  return json({
    ok: true,
    emailSent: sent.ok,
    deliveryError: sent.ok ? "" : asString(sent.delivery?.error || "The draft was saved, but the email could not be sent."),
    resumeToken: rawToken,
    draft: presentedDraft({ ...row, last_emailed_at: sent.ok ? now : null }),
  }, { status: 201 });
}

export async function handleGetBuildDraft(request, env) {
  const active = await activeDraft(request, env);
  if (active.response) return active.response;
  return json({ ok: true, draft: presentedDraft(active.row) });
}

export async function handleUpdateBuildDraft(request, env) {
  const active = await activeDraft(request, env);
  if (active.response) return active.response;
  const body = await readBody(request);
  if (!body) return failure("Expected a JSON body.", 400);
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 1) return failure("A valid draft revision is required.", 400);
  if (revision !== Number(active.row.revision)) {
    return failure("This draft was changed in another browser.", 409, {
      code: "DRAFT_CONFLICT",
      draft: presentedDraft(active.row),
    });
  }
  const normalized = normalizePayload(active.row.draft_kind, body.payload || {});
  if (normalized.error) return failure(normalized.error, normalized.status || 400);
  const now = new Date().toISOString();
  const nextRevision = revision + 1;
  const result = await active.database.prepare(
    `UPDATE tattoo_build_drafts
     SET payload_json=?,revision=?,expires_at=?,updated_at=?
     WHERE id=? AND status='active' AND revision=?`
  ).bind(normalized.serialized, nextRevision, expiresAt(), now, active.row.id, revision).run();
  if (Number(result?.meta?.changes || 0) !== 1) {
    const current = await active.database.prepare("SELECT * FROM tattoo_build_drafts WHERE id=?").bind(active.row.id).first();
    return failure("This draft was changed in another browser.", 409, {
      code: "DRAFT_CONFLICT",
      draft: current ? presentedDraft(current) : null,
    });
  }
  const updated = await active.database.prepare("SELECT * FROM tattoo_build_drafts WHERE id=?").bind(active.row.id).first();
  return json({ ok: true, draft: presentedDraft(updated) });
}

export async function handleEmailBuildDraft(request, env) {
  const active = await activeDraft(request, env);
  if (active.response) return active.response;
  const sent = await sendDraftEmail(active.database, request, env, active.row, active.rawToken);
  if (sent.response) return sent.response;
  return json({
    ok: true,
    emailSent: sent.ok,
    deliveryError: sent.ok ? "" : asString(sent.delivery?.error || "The email could not be sent."),
  });
}

export async function handleDeleteBuildDraft(request, env) {
  const active = await activeDraft(request, env);
  if (active.response) return active.response;
  const now = new Date().toISOString();
  await active.database.prepare(
    `UPDATE tattoo_build_drafts
     SET status='revoked',payload_json='{}',revoked_at=?,updated_at=?
     WHERE id=?`
  ).bind(now, now, active.row.id).run();
  return json({ ok: true });
}

export async function resolveSubmissionBuildDraft(request, database, kind, email) {
  const rawToken = asString(request.headers.get("x-build-draft-token"), 256);
  if (!rawToken) return null;
  const resolved = await rowForToken(database, rawToken);
  if (!resolved) return { error: "The attached draft link is invalid.", status: 401, code: "DRAFT_INVALID" };
  const row = resolved.row;
  const now = new Date().toISOString();
  if (row.status !== "active" || row.expires_at <= now) {
    return { error: "The attached draft is expired or no longer active.", status: 410, code: "DRAFT_INACTIVE" };
  }
  if (row.draft_kind !== kind) {
    return { error: "The attached draft does not match this submission.", status: 409, code: "DRAFT_KIND_MISMATCH" };
  }
  if (normalizedEmail(row.owner_email) !== normalizedEmail(email)) {
    return { error: "Submit this draft using the email address that owns its resume link.", status: 403, code: "DRAFT_EMAIL_MISMATCH" };
  }
  return { id: row.id };
}

export function finalizeSubmissionBuildDraft(database, draftId, submissionId, now) {
  return database.prepare(
    `UPDATE tattoo_build_drafts
     SET status='submitted',submission_id=?,payload_json='{}',submitted_at=?,updated_at=?
     WHERE id=? AND status='active'`
  ).bind(submissionId, now, now, draftId);
}

export async function reapExpiredTattooBuildDrafts(env) {
  const database = db(env);
  if (!database) return { expired: 0, deleted: 0 };
  const now = new Date().toISOString();
  const purgeBefore = new Date(Date.now() - TOMBSTONE_RETENTION_MS).toISOString();
  const attemptsBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const expired = await database.prepare(
    `UPDATE tattoo_build_drafts
     SET status='expired',payload_json='{}',updated_at=?
     WHERE status='active' AND expires_at<=?`
  ).bind(now, now).run();
  const deleted = await database.prepare(
    `DELETE FROM tattoo_build_drafts
     WHERE status IN ('expired','revoked','submitted') AND updated_at<?`
  ).bind(purgeBefore).run();
  await database.prepare(
    "DELETE FROM tattoo_build_draft_email_attempts WHERE created_at<?"
  ).bind(attemptsBefore).run();
  return {
    expired: Number(expired?.meta?.changes || 0),
    deleted: Number(deleted?.meta?.changes || 0),
  };
}
