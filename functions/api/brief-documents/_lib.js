import { notifyTattooBriefReady } from "../notifications/_lib.js";
import {
  briefTemplateCatalog,
  briefTemplateDefault,
  briefTemplateSchema,
  buildBriefSample,
  renderBriefHtml,
  validateBriefTemplateContent,
} from "./_templates.js";
import {
  documentTemplateHistory,
  documentTemplateRevision,
  discardDocumentTemplateDraft,
  publishDocumentTemplateDraft,
  restoreDocumentTemplateRevision,
  saveDocumentTemplateDraft,
} from "./_template-store.js";

const ELIGIBLE_TYPES = new Map([["build_brief", "build"], ["maze_design", "maze"]]);
const TEMPLATE_BY_KIND = { build: "tattoo_build_brief_pdf", maze: "tattoo_maze_brief_pdf" };
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
  });
}

function failure(message, status = 400, extras = {}) {
  return json({ error: message, ...extras }, { status });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function requireAdmin(request, env) {
  const expected = String(env.SUBMISSIONS_ADMIN_TOKEN || "").trim();
  if (!expected) return failure("Admin API is not configured.", 503);
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  return provided === expected ? null : failure("Unauthorized.", 401);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function base64(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64Url(bytes) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSignature(secret, documentId, accessVersion) {
  if (!secret) return "";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(`brief:${documentId}:${accessVersion}`)));
}

async function timingSafeTextEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicBase(env, request) {
  return String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function clientBriefUrl(env, request, row) {
  if (!row || row.status !== "ready" || row.client_access_status !== "active" || !env.BRIEF_LINK_SECRET) return "";
  const version = Number(row.access_version || 1);
  const signature = await hmacSignature(env.BRIEF_LINK_SECRET, row.id, version);
  return `${publicBase(env, request)}/api/tattoo/briefs/${encodeURIComponent(row.id)}?v=${version}&sig=${encodeURIComponent(signature)}`;
}

function snapshotSubmission(row) {
  const contact = row.contact && typeof row.contact === "object" ? row.contact : parseJson(row.contact_json, {});
  return {
    id: row.id,
    type: row.type,
    contactName: row.contactName || row.contact_name || contact.name || "",
    contactEmail: row.contactEmail || row.contact_email || contact.email || "",
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    payload: row.payload && typeof row.payload === "object" ? row.payload : parseJson(row.payload_json, {}),
    files: Array.isArray(row.files) ? row.files : parseJson(row.files_json, []),
  };
}

function normalizeDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    kind: row.document_kind,
    status: row.status,
    templateKey: row.template_key,
    templateRevision: Number(row.template_revision || 0),
    fileName: row.file_name || "",
    mimeType: row.mime_type || "application/pdf",
    byteSize: Number(row.byte_size || 0),
    contentSha256: row.content_sha256 || "",
    clientAccessStatus: row.client_access_status || "disabled",
    accessVersion: Number(row.access_version || 1),
    failureMessage: row.failure_message || "",
    generatedAt: row.generated_at || "",
    revokedAt: row.revoked_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadBriefDocument(db, submissionId) {
  if (!db || !submissionId) return null;
  return db.prepare(
    "SELECT * FROM submission_brief_documents WHERE submission_id=? ORDER BY created_at DESC LIMIT 1"
  ).bind(submissionId).first();
}

export async function presentBriefDocument(env, request, row) {
  const normalized = normalizeDocument(row);
  if (!normalized) return null;
  normalized.clientUrl = await clientBriefUrl(env, request, row);
  normalized.internalDownloadUrl = `/api/admin/submissions/${encodeURIComponent(row.submission_id)}/brief-document/download`;
  return normalized;
}

async function selectedTemplate(db, templateKey) {
  const published = await documentTemplateRevision(db, templateKey, "published");
  const content = published?.content || briefTemplateDefault(templateKey);
  const validation = validateBriefTemplateContent(templateKey, content);
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  return { revision: Number(published?.revision || 0), content: validation.content };
}

async function mazeImageDataUrl(env, source) {
  const file = (source.files || []).find((entry) => entry?.fieldName === "maze_image" && entry?.storageKey);
  if (!file || !env.SUBMISSION_FILES) return "";
  const object = await env.SUBMISSION_FILES.get(file.storageKey);
  if (!object) return "";
  const bytes = await object.arrayBuffer();
  return `data:${file.contentType || "image/png"};base64,${base64(bytes)}`;
}

async function renderPdf(env, html) {
  if (!env.BROWSER?.quickAction) throw new Error("Browser PDF rendering is unavailable.");
  const response = await env.BROWSER.quickAction("pdf", {
    html,
    pdfOptions: {
      format: "letter",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;font:8px Arial;color:#6b5748;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "0.34in", right: "0", bottom: "0.32in", left: "0" },
    },
  });
  if (!(response instanceof Response) || !response.ok) throw new Error(`PDF renderer returned ${response?.status || "an invalid response"}.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 5 || bytes.byteLength > MAX_PDF_BYTES) throw new Error("Generated PDF size is invalid.");
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error("Renderer did not return a valid PDF.");
  return bytes;
}

async function generateExistingDocument(env, row) {
  const source = parseJson(row.source_snapshot_json, {});
  const template = parseJson(row.template_snapshot_json, null);
  if (!template) throw new Error("The frozen PDF template is unavailable.");
  const mazeImage = row.document_kind === "maze" ? await mazeImageDataUrl(env, source) : "";
  if (row.document_kind === "build" && !source.payload?.symbol_snapshot?.length) {
    throw new Error("This Build submission does not contain the frozen symbol data required for a client brief PDF.");
  }
  if (row.document_kind === "maze" && !mazeImage) {
    throw new Error("This Maze submission does not contain a stored Maze PNG required for a client brief PDF.");
  }
  const rendered = renderBriefHtml({ templateKey: row.template_key, content: template, source, mazeImageDataUrl: mazeImage });
  const bytes = await renderPdf(env, rendered.html);
  if (!env.SUBMISSION_FILES) throw new Error("Private PDF storage is unavailable.");
  const storageKey = `submission-briefs/${row.submission_id}/final.pdf`;
  await env.SUBMISSION_FILES.put(storageKey, bytes, {
    httpMetadata: { contentType: "application/pdf", contentDisposition: `attachment; filename="${rendered.filename}"` },
    customMetadata: { submissionId: row.submission_id, documentId: row.id, documentKind: row.document_kind },
  });
  const timestamp = new Date().toISOString();
  const hash = await sha256Hex(bytes);
  await env.SUBMISSIONS_DB.prepare(
    `UPDATE submission_brief_documents SET status='ready',storage_key=?,file_name=?,byte_size=?,content_sha256=?,
     failure_message=NULL,generated_at=?,updated_at=? WHERE id=?`
  ).bind(storageKey, rendered.filename, bytes.byteLength, hash, timestamp, timestamp, row.id).run();
  return env.SUBMISSIONS_DB.prepare("SELECT * FROM submission_brief_documents WHERE id=?").bind(row.id).first();
}

export async function generateSubmissionBriefDocument(env, request, submissionRow) {
  const kind = ELIGIBLE_TYPES.get(submissionRow?.type);
  if (!kind) return { ok: false, skipped: true, error: "This submission does not use a client brief PDF." };
  const db = env.SUBMISSIONS_DB;
  if (!db) return { ok: false, error: "Submission storage is unavailable." };
  let row = await loadBriefDocument(db, submissionRow.id);
  if (!row) {
    const templateKey = TEMPLATE_BY_KIND[kind];
    const template = await selectedTemplate(db, templateKey);
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const clientAccess = env.BRIEF_LINK_SECRET ? "active" : "disabled";
    await db.prepare(
      `INSERT OR IGNORE INTO submission_brief_documents
       (id,submission_id,document_kind,status,template_key,template_revision,template_snapshot_json,
        source_snapshot_json,client_access_status,access_version,created_at,updated_at)
       VALUES(?,?,?,'pending',?,?,?,?,?,1,?,?)`
    ).bind(
      id, submissionRow.id, kind, templateKey, template.revision, JSON.stringify(template.content),
      JSON.stringify(snapshotSubmission(submissionRow)), clientAccess, timestamp, timestamp,
    ).run();
    row = await loadBriefDocument(db, submissionRow.id);
  }
  if (row.status === "ready") {
    return { ok: true, document: await presentBriefDocument(env, request, row), row };
  }
  try {
    const ready = await generateExistingDocument(env, row);
    return { ok: true, document: await presentBriefDocument(env, request, ready), row: ready };
  } catch (error) {
    const timestamp = new Date().toISOString();
    await db.prepare(
      "UPDATE submission_brief_documents SET status='failed',failure_message=?,updated_at=? WHERE id=?"
    ).bind(String(error?.message || "PDF generation failed.").slice(0, 1000), timestamp, row.id).run();
    console.error(JSON.stringify({ event: "submission_brief_pdf.failed", submissionId: submissionRow.id, documentId: row.id, error: error?.message || "Unknown error" }));
    const failed = await db.prepare("SELECT * FROM submission_brief_documents WHERE id=?").bind(row.id).first();
    return { ok: false, error: error?.message || "PDF generation failed.", document: await presentBriefDocument(env, request, failed), row: failed };
  }
}

async function loadSubmission(db, submissionId) {
  return db.prepare("SELECT * FROM submissions WHERE id=?").bind(submissionId).first();
}

async function emailBriefIfRequested(env, request, submission, row, requested) {
  if (!requested || !row || row.status !== "ready") return null;
  const url = await clientBriefUrl(env, request, row);
  if (!url) return { ok: false, skipped: true, error: "Client PDF access is not configured." };
  return notifyTattooBriefReady(env, request, {
    submissionId: submission.id,
    kind: row.document_kind,
    clientName: submission.contact_name,
    clientEmail: submission.contact_email,
    briefUrl: url,
    documentId: row.id,
    accessVersion: row.access_version,
  }, { idempotencyKey: `tattoo_brief_ready:${row.id}:${row.access_version}:${crypto.randomUUID()}` });
}

export async function handleAdminSubmissionBriefDocument(request, env, submissionId, action = "") {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const db = env.SUBMISSIONS_DB;
  if (!db) return failure("Submission storage is unavailable.", 503);
  const submission = await loadSubmission(db, submissionId);
  if (!submission) return failure("Submission not found.", 404);
  if (!ELIGIBLE_TYPES.has(submission.type)) return failure("Brief PDFs apply only to final Build Your Own and Maze submissions.", 409);
  let row = await loadBriefDocument(db, submissionId);

  if (request.method === "GET" && action === "download") {
    if (!row || row.status !== "ready" || !row.storage_key) return failure("The brief PDF is not ready.", 409);
    const object = await env.SUBMISSION_FILES?.get(row.storage_key);
    if (!object) return failure("The stored brief PDF was not found.", 404);
    return new Response(object.body, {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${String(row.file_name || "art-pill-brief.pdf").replace(/"/g, "")}"`, "cache-control": "no-store" },
    });
  }
  if (request.method === "GET" && !action) {
    return json({ briefDocument: await presentBriefDocument(env, request, row) });
  }
  const body = await readJson(request) || {};
  if (request.method === "POST" && !action) {
    const generated = await generateSubmissionBriefDocument(env, request, submission);
    const delivery = await emailBriefIfRequested(env, request, submission, generated.row, body.emailClient === true);
    return json({ ok: generated.ok, briefDocument: generated.document, delivery, ...(generated.ok ? {} : { error: generated.error }) }, { status: generated.ok ? 200 : 502 });
  }
  if (!row) return failure("No brief document exists for this submission.", 404);
  if (request.method === "POST" && action === "revoke") {
    const timestamp = new Date().toISOString();
    await db.prepare(
      "UPDATE submission_brief_documents SET client_access_status='revoked',revoked_at=?,access_version=access_version+1,updated_at=? WHERE id=?"
    ).bind(timestamp, timestamp, row.id).run();
  } else if (request.method === "POST" && action === "reissue") {
    if (row.status !== "ready") return failure("The brief PDF must be ready before issuing a client link.", 409);
    if (!env.BRIEF_LINK_SECRET) return failure("Client PDF access is not configured.", 503);
    const timestamp = new Date().toISOString();
    await db.prepare(
      "UPDATE submission_brief_documents SET client_access_status='active',revoked_at=NULL,access_version=access_version+1,updated_at=? WHERE id=?"
    ).bind(timestamp, row.id).run();
  } else {
    return failure("Method not allowed.", 405);
  }
  row = await db.prepare("SELECT * FROM submission_brief_documents WHERE id=?").bind(row.id).first();
  const delivery = action === "reissue"
    ? await emailBriefIfRequested(env, request, submission, row, body.emailClient === true)
    : null;
  return json({ ok: true, briefDocument: await presentBriefDocument(env, request, row), delivery });
}

export async function handlePublicBriefDownload(request, env, documentId) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  if (!env.SUBMISSIONS_DB || !env.SUBMISSION_FILES || !env.BRIEF_LINK_SECRET) return failure("Brief access is unavailable.", 503);
  const row = await env.SUBMISSIONS_DB.prepare("SELECT * FROM submission_brief_documents WHERE id=?").bind(documentId).first();
  if (!row || row.status !== "ready" || row.client_access_status !== "active" || !row.storage_key) return failure("This brief link is unavailable.", 404);
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v") || 0);
  const provided = url.searchParams.get("sig") || "";
  const expected = await hmacSignature(env.BRIEF_LINK_SECRET, row.id, row.access_version);
  if (version !== Number(row.access_version) || !(await timingSafeTextEqual(provided, expected))) return failure("This brief link is invalid or has been replaced.", 403);
  const object = await env.SUBMISSION_FILES.get(row.storage_key);
  if (!object) return failure("The brief PDF was not found.", 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${String(row.file_name || "art-pill-brief.pdf").replace(/"/g, "")}"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function selectedCatalogEntry(templateKey) {
  return briefTemplateCatalog().find((entry) => entry.templateKey === templateKey) || null;
}

async function templateDefinition(db, templateKey) {
  const entry = selectedCatalogEntry(templateKey);
  if (!entry) return null;
  const [draft, published] = await Promise.all([
    documentTemplateRevision(db, templateKey, "draft"),
    documentTemplateRevision(db, templateKey, "published"),
  ]);
  return { ...entry, schema: briefTemplateSchema(templateKey), defaultContent: briefTemplateDefault(templateKey), draft, published };
}

export async function handleAdminBriefTemplates(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const db = env.SUBMISSIONS_DB;
  if (!db) return failure("Template storage is unavailable.", 503);
  const url = new URL(request.url);
  const prefix = "/api/admin/brief-templates";
  const parts = url.pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length && request.method === "GET") {
    const templates = await Promise.all(briefTemplateCatalog().map(async (entry) => {
      const definition = await templateDefinition(db, entry.templateKey);
      return { ...entry, status: definition.draft ? "draft" : definition.published ? "published" : "default", draftRevision: definition.draft?.revision || null, publishedRevision: definition.published?.revision || 0 };
    }));
    return json({ templates });
  }
  if (parts[0] === "preview" && request.method === "POST") {
    const body = await readJson(request);
    if (!body) return failure("Expected a JSON body.", 400);
    const entry = selectedCatalogEntry(String(body.templateKey || ""));
    if (!entry) return failure("Unsupported PDF template.", 404);
    let content = body.content;
    if (!content) {
      const revision = body.source === "published" ? await documentTemplateRevision(db, entry.templateKey, "published") : await documentTemplateRevision(db, entry.templateKey, "draft");
      content = revision?.content || briefTemplateDefault(entry.templateKey);
    }
    const validation = validateBriefTemplateContent(entry.templateKey, content);
    if (!validation.ok) return failure("Template content is invalid.", 422, { errors: validation.errors });
    const source = buildBriefSample(entry.kind);
    const rendered = renderBriefHtml({ templateKey: entry.templateKey, content: validation.content, source, mazeImageDataUrl: source.mazeImageDataUrl || "" });
    try {
      const bytes = await renderPdf(env, rendered.html);
      return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${rendered.filename}"`, "cache-control": "no-store" } });
    } catch (error) {
      return failure(error.message || "PDF preview failed.", 502);
    }
  }
  const templateKey = parts[0];
  const action = parts[1] || "";
  const definition = await templateDefinition(db, templateKey);
  if (!definition) return failure("Unsupported PDF template.", 404);
  if (request.method === "GET" && (!action || action === "history")) {
    return json({ ...definition, ...(action === "history" ? { history: await documentTemplateHistory(db, templateKey) } : {}) });
  }
  const body = await readJson(request);
  if (!body) return failure("Expected a JSON body.", 400);
  if (request.method === "PUT" && action === "draft") {
    const validation = validateBriefTemplateContent(templateKey, body.content);
    if (!validation.ok) return failure("Template content is invalid.", 422, { errors: validation.errors });
    const draft = await saveDocumentTemplateDraft(db, { templateKey, content: validation.content, baseRevision: body.baseRevision });
    if (draft?.conflict) return failure("Template draft is stale.", 409, draft);
    return json({ draft });
  }
  if (request.method === "POST" && action === "publish") {
    const draft = await documentTemplateRevision(db, templateKey, "draft");
    if (!draft) return failure("No saved draft is available to publish.", 409);
    const validation = validateBriefTemplateContent(templateKey, draft.content);
    if (!validation.ok) return failure("Saved draft is invalid.", 422, { errors: validation.errors });
    const published = await publishDocumentTemplateDraft(db, { templateKey, revision: body.revision });
    if (published?.conflict) return failure("Template draft is stale.", 409, published);
    return json({ published });
  }
  if (request.method === "POST" && action === "discard") {
    const discarded = await discardDocumentTemplateDraft(db, { templateKey, revision: body.revision });
    if (discarded?.conflict) return failure("Template draft is stale.", 409, discarded);
    return json(discarded);
  }
  if (request.method === "POST" && action === "restore") {
    const draft = await restoreDocumentTemplateRevision(db, { templateKey, revision: body.revision, baseRevision: body.baseRevision });
    if (draft?.conflict) return failure("Template draft is stale.", 409, draft);
    if (!draft) return failure("Template revision was not found.", 404);
    return json({ draft });
  }
  return failure("Method not allowed.", 405);
}

export async function deleteBriefDocumentObject(env, submissionId) {
  const row = await loadBriefDocument(env.SUBMISSIONS_DB, submissionId);
  if (!row?.storage_key) return 0;
  await env.SUBMISSION_FILES?.delete(row.storage_key);
  return 1;
}
