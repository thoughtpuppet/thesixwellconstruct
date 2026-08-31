import {
  createCalendarCandidateFromPublicSubmission,
  createCalendarCorrectionRevision,
} from "../calendar/_lib.js";
import {
  notifyAdminCalendarSubmissionReceived,
  notifyCalendarSubmissionReceived,
} from "../notifications/_lib.js";

const MANAGE_DAYS = 90;
const CLOSED_RETENTION_DAYS = 90;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 45 * 1024 * 1024;
const MAX_FILES = 6;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ACTIVE_EDIT_STATUSES = new Set(["received", "needs_information"]);
const CLOSED_STATUSES = new Set(["duplicate", "declined", "withdrawn"]);
const SUBMISSION_STATUSES = new Set(["received", "needs_information", "converted", "duplicate", "declined", "withdrawn", "added"]);
const ADMISSION_TYPES = new Set(["free", "free_rsvp", "paid", "donation", "restricted"]);
const EVENT_STRUCTURES = new Set(["single", "series", "exhibition"]);
const DATE_KINDS = new Set(["timed", "all_day", "date_range"]);
const SUBJECTS = new Set(["art", "art-making", "film", "poetry-music", "technology", "ai", "creative-technology", "anthropology", "engineering", "philosophy"]);
const FORMATS = new Set(["exhibition", "screening", "performance", "experimental-event", "lecture-talk", "panel", "workshop", "conference"]);
const PERSON_ROLES = new Set(["artist", "participant", "organizer", "venue", "supporting"]);

function text(value, maximum = 10000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status:init.status || 200,
    headers:{ "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...(init.headers || {}) },
  });
}

function failure(message, status = 400, detail = "") {
  return json({ error:message, ...(detail ? { detail } : {}) }, { status });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value, 320));
}

function validUrl(value) {
  const candidate = text(value, 2000);
  if (!candidate) return true;
  try { return ["http:", "https:"].includes(new URL(candidate).protocol); }
  catch { return false; }
}

function uniqueAllowed(values, allowed, maximum = 20) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 80).toLowerCase()).filter((value) => allowed.has(value)))].slice(0, maximum);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFilename(value) {
  return text(value, 180).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "event-image";
}

function requestIp(request) {
  return text(request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown", 128);
}

function requestToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return diff === 0;
}

function requireAdmin(request, env) {
  if (!env.SUBMISSIONS_ADMIN_TOKEN) return failure("Calendar administration is not configured.", 503);
  if (!timingSafeEqual(requestToken(request), env.SUBMISSIONS_ADMIN_TOKEN)) return failure("Unauthorized.", 401);
  return null;
}

function parsePayload(form) {
  try {
    const parsed = JSON.parse(text(form.get("payload"), 200000));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function normalizePeople(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = text(item.name, 160);
    const url = text(item.url, 2000);
    const role = PERSON_ROLES.has(text(item.role, 40)) ? text(item.role, 40) : "participant";
    const creditRole = text(item.creditRole, 120);
    const key = `${name.toLowerCase()}|${url.toLowerCase()}|${creditRole.toLowerCase()}`;
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ name, url, role, creditRole }];
  });
}

function normalizeOccurrences(values, timezone) {
  return (Array.isArray(values) ? values : []).slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const title = text(item.title, 240);
    const startsAt = text(item.startsAt, 80);
    if (!title && !startsAt) return [];
    return [{
      title, occurrenceType:text(item.occurrenceType, 40) || "other", factualDescription:text(item.factualDescription, 3000),
      dateKind:DATE_KINDS.has(text(item.dateKind, 30)) ? text(item.dateKind, 30) : "timed",
      startsAt, endsAt:text(item.endsAt, 80), timezone:text(item.timezone, 80) || timezone,
      venueName:text(item.venueName, 240), venueAddress:text(item.venueAddress, 500),
      sourceUrl:text(item.sourceUrl, 2000), ticketUrl:text(item.ticketUrl, 2000),
      status:"scheduled", verificationState:"needs_verification", verificationNotes:"Submitted publicly; Studio verification required.",
    }];
  });
}

function normalizeSubmissionPayload(raw) {
  const timezone = text(raw.timezone, 80) || "America/New_York";
  const admissionType = ADMISSION_TYPES.has(text(raw.admissionType, 40)) ? text(raw.admissionType, 40) : "";
  return {
    kind:text(raw.kind, 20) === "correction" ? "correction" : "new",
    targetUrl:text(raw.targetUrl, 2000), correctionSummary:text(raw.correctionSummary, 3000),
    title:text(raw.title, 240), factualDescription:text(raw.factualDescription, 6000),
    eventStructure:EVENT_STRUCTURES.has(text(raw.eventStructure, 30)) ? text(raw.eventStructure, 30) : "single",
    dateKind:DATE_KINDS.has(text(raw.dateKind, 30)) ? text(raw.dateKind, 30) : "timed",
    startsAt:text(raw.startsAt, 80), endsAt:text(raw.endsAt, 80), doorsAt:text(raw.doorsAt, 80), timezone,
    organizer:text(raw.organizer, 240), organizerUrl:text(raw.organizerUrl, 2000),
    venueName:text(raw.venueName, 240), venueAddress:text(raw.venueAddress, 500), venueUrl:text(raw.venueUrl, 2000),
    online:Boolean(raw.online), city:text(raw.city, 120) || "Atlanta", region:text(raw.region, 40) || "GA",
    atlantaMetroConfirmed:Boolean(raw.atlantaMetroConfirmed),
    sourceUrl:text(raw.sourceUrl, 2000), discoveryUrl:text(raw.discoveryUrl, 2000), ticketUrl:text(raw.ticketUrl, 2000),
    admissionType, admissionNotes:text(raw.admissionNotes, 1200), accessNotes:text(raw.accessNotes, 1200),
    ageNotes:text(raw.ageNotes, 500), accessibilityNotes:text(raw.accessibilityNotes, 1000),
    subjects:uniqueAllowed(raw.subjects, SUBJECTS), formats:uniqueAllowed(raw.formats, FORMATS), experimental:Boolean(raw.experimental),
    people:normalizePeople(raw.people), occurrences:normalizeOccurrences(raw.occurrences, timezone),
    submitterName:text(raw.submitterName, 160), submitterEmail:text(raw.submitterEmail, 320).toLowerCase(),
    submitterPhone:text(raw.submitterPhone, 80), submitterRelationship:text(raw.submitterRelationship, 240),
    rightsConfirmed:Boolean(raw.rightsConfirmed), editorialConfirmed:Boolean(raw.editorialConfirmed),
  };
}

function payloadErrors(payload, incomingFileCount = 0, existingFileCount = 0) {
  const errors = [];
  if (!payload.title) errors.push("Event title is required.");
  if (!payload.factualDescription) errors.push("A factual event description is required.");
  if (!payload.startsAt) errors.push("A start date is required.");
  if (!payload.organizer) errors.push("A primary organizer is required.");
  if (!payload.online && !payload.venueName) errors.push("A venue or online-event selection is required.");
  if (!payload.atlantaMetroConfirmed || payload.region.toUpperCase() !== "GA") errors.push("Confirm that the event is in the Atlanta metro area.");
  if (!payload.admissionType) errors.push("Choose the admission or registration type.");
  if (!payload.subjects.length && !payload.formats.length) errors.push("Choose at least one creative subject or format.");
  if (!payload.submitterName) errors.push("Your name is required.");
  if (!validEmail(payload.submitterEmail)) errors.push("Enter a valid contact email.");
  if (!payload.rightsConfirmed) errors.push("Confirm that you may provide the uploaded event materials.");
  if (!payload.editorialConfirmed) errors.push("Confirm that submission does not guarantee publication.");
  if (!payload.sourceUrl && !payload.ticketUrl && incomingFileCount + existingFileCount === 0) errors.push("Provide an official event link, registration link, or flyer.");
  if (payload.kind === "correction" && (!payload.targetUrl || !payload.correctionSummary)) errors.push("Corrections require the listed event URL and a summary of what changed.");
  for (const [label, url] of [["Official event",payload.sourceUrl],["Ticket or RSVP",payload.ticketUrl],["Organizer",payload.organizerUrl],["Venue",payload.venueUrl],["Correction target",payload.targetUrl],["Announcement",payload.discoveryUrl]]) {
    if (url && !validUrl(url)) errors.push(`${label} URL must use http or https.`);
  }
  for (const person of payload.people) if (person.url && !validUrl(person.url)) errors.push(`The link for ${person.name} must use http or https.`);
  for (const occurrence of payload.occurrences) {
    if (occurrence.sourceUrl && !validUrl(occurrence.sourceUrl)) errors.push(`The source link for ${occurrence.title || "a related date"} is invalid.`);
    if (occurrence.ticketUrl && !validUrl(occurrence.ticketUrl)) errors.push(`The ticket link for ${occurrence.title || "a related date"} is invalid.`);
  }
  return errors;
}

function imageSignature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.slice(0,6)))) return "image/gif";
  return "";
}

async function validatedFiles(form) {
  const files = form.getAll("flyers").filter((item) => item instanceof File && item.size > 0);
  if (files.length > MAX_FILES) throw new Error(`Upload no more than ${MAX_FILES} images.`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_FILE_BYTES) throw new Error("Event images may total no more than 45 MB.");
  const validated = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new Error("Each event image must be 15 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = imageSignature(bytes);
    if (!detected || !IMAGE_MIMES.has(file.type.toLowerCase()) || detected !== file.type.toLowerCase()) throw new Error("Use a valid JPEG, PNG, WebP, or GIF image.");
    validated.push({ file, bytes, mimeType:detected });
  }
  return validated;
}

async function validateTurnstile(request, env, form) {
  const hostname = new URL(request.url).hostname;
  const token = text(form.get("cf-turnstile-response"), 2048);
  if (env.CALENDAR_SUBMISSION_TURNSTILE_TEST_BYPASS === "true" && ["localhost","127.0.0.1","example.test"].includes(hostname)) return token === "test-pass";
  const secret = text(env.CALENDAR_SUBMISSION_TURNSTILE_SECRET, 4096);
  const expected = new Set(text(env.CALENDAR_SUBMISSION_TURNSTILE_HOSTNAMES, 2000).split(",").map((item) => item.trim()).filter(Boolean));
  if (!secret || !token || expected.size === 0) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method:"POST", headers:{ "content-type":"application/x-www-form-urlencoded" }, signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({ secret, response:token, remoteip:requestIp(request), idempotency_key:crypto.randomUUID() }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.action === "calendar_submit" && expected.has(result.hostname);
  } catch { return false; }
}

async function enforceRateLimit(db, request, env, email) {
  const salt = text(env.CALENDAR_SUBMISSION_RATE_LIMIT_SALT, 500);
  if (!salt) return false;
  const now = new Date();
  const windowStartedAt = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const identities = await Promise.all([sha256(`${salt}:ip:${requestIp(request)}`), sha256(`${salt}:email:${email}`)]);
  await db.prepare("DELETE FROM calendar_public_submission_rate_limits WHERE window_started_at<?").bind(new Date(now.getTime() - 86_400_000).toISOString()).run();
  for (const identity of identities) {
    await db.prepare(`INSERT INTO calendar_public_submission_rate_limits(identity_hash,window_started_at,request_count,updated_at)
      VALUES(?,?,1,?) ON CONFLICT(identity_hash,window_started_at) DO UPDATE SET request_count=request_count+1,updated_at=excluded.updated_at`)
      .bind(identity, windowStartedAt, now.toISOString()).run();
    const row = await db.prepare("SELECT request_count FROM calendar_public_submission_rate_limits WHERE identity_hash=? AND window_started_at=?").bind(identity, windowStartedAt).first();
    if (Number(row?.request_count) > 5) return false;
  }
  return true;
}

function referenceCode(now = new Date()) {
  const date = now.toISOString().slice(0,10).replace(/-/g, "");
  const bytes = new Uint8Array(5); crypto.getRandomValues(bytes);
  return `ATL-${date}-${base64Url(bytes).toUpperCase()}`;
}

async function duplicateFingerprint(payload) {
  return sha256([payload.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(), payload.startsAt.slice(0,10), payload.venueName.toLowerCase()].join("|"));
}

async function loadMedia(db, submissionId) {
  const result = await db.prepare(`SELECT sm.*,m.original_filename,m.mime_type,m.byte_size,m.storage_key,m.privacy,m.state
    FROM calendar_public_submission_media sm JOIN media_assets m ON m.id=sm.media_id
    WHERE sm.submission_id=? AND sm.removed_at IS NULL ORDER BY sm.sort_order,sm.id`).bind(submissionId).all();
  return (result.results || []).map((row) => ({ id:row.id, mediaId:row.media_id, role:row.media_role, altText:row.alt_text, caption:row.caption, sortOrder:Number(row.sort_order)||0, originalFilename:row.original_filename, mimeType:row.mime_type, byteSize:Number(row.byte_size)||0 }));
}

async function deriveStatus(db, row) {
  if (!row?.converted_candidate_id) return row?.status || "received";
  const candidate = await db.prepare("SELECT status FROM calendar_candidates WHERE id=?").bind(row.converted_candidate_id).first();
  if (candidate?.status === "published") return "added";
  if (candidate?.status === "rejected") return "declined";
  if (candidate?.status === "duplicate") return "duplicate";
  return row.status;
}

async function loadSubmission(db, id, includeHistory = false) {
  const row = await db.prepare("SELECT * FROM calendar_public_submissions WHERE id=?").bind(id).first();
  if (!row) return null;
  const revision = await db.prepare("SELECT * FROM calendar_public_submission_revisions WHERE id=?").bind(row.latest_revision_id).first();
  const media = await loadMedia(db, id);
  const status = await deriveStatus(db, row);
  const result = {
    id:row.id, reference:row.reference_code, kind:row.submission_kind, status,
    submitter:{ name:row.submitter_name, email:row.submitter_email, phone:row.submitter_phone, relationship:row.submitter_relationship },
    payload:revision ? JSON.parse(revision.payload_json) : {}, media,
    targetCandidateId:row.target_candidate_id || "", targetEntryId:row.target_entry_id || "", convertedCandidateId:row.converted_candidate_id || "", convertedRevisionId:row.converted_revision_id || "",
    studioNote:row.studio_note || "", editable:ACTIVE_EDIT_STATUSES.has(status), createdAt:row.created_at, updatedAt:row.updated_at,
  };
  if (includeHistory) {
    const revisions = await db.prepare("SELECT id,revision_number,payload_json,created_by,created_at FROM calendar_public_submission_revisions WHERE submission_id=? ORDER BY revision_number DESC").bind(id).all();
    result.revisions = (revisions.results || []).map((item) => ({ id:item.id, revisionNumber:Number(item.revision_number), payload:JSON.parse(item.payload_json), createdBy:item.created_by, createdAt:item.created_at }));
  }
  return result;
}

async function accessByManageToken(db, request) {
  const raw = requestToken(request);
  if (!raw) return null;
  const hash = await sha256(raw);
  const row = await db.prepare(`SELECT t.id token_id,t.submission_id,t.expires_at,s.status
    FROM calendar_public_submission_tokens t JOIN calendar_public_submissions s ON s.id=t.submission_id
    WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`).bind(hash, new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE calendar_public_submission_tokens SET last_used_at=? WHERE id=?").bind(new Date().toISOString(),row.token_id).run();
  return row;
}

async function storeFiles(env, db, submissionId, reference, files, payload, startOrder = 0) {
  const stored = [];
  const now = new Date().toISOString();
  try {
    for (const [index, item] of files.entries()) {
      const mediaId = `media-calendar-submission-${crypto.randomUUID()}`;
      const linkId = `cal_submission_media_${crypto.randomUUID()}`;
      const key = `calendar-submissions/${submissionId}/${mediaId}-${safeFilename(item.file.name)}`;
      await env.SUBMISSION_FILES.put(key, item.bytes, { httpMetadata:{ contentType:item.mimeType } });
      stored.push({ mediaId, key });
      const altText = `${payload.title} event ${index === 0 && startOrder === 0 ? "flyer" : "image"}`;
      await db.prepare(`INSERT INTO media_assets
        (id,storage_key,original_filename,mime_type,byte_size,alt_text,rights_notes,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
        VALUES (?,?,?,?,?,?,?,'internal','active','calendar-public-submission',?,?, 'hidden',0)`)
        .bind(mediaId,key,safeFilename(item.file.name),item.mimeType,item.file.size,altText,`Submitted under event-material permission confirmation for ${reference}.`,now,now).run();
      await db.prepare(`INSERT INTO calendar_public_submission_media
        (id,submission_id,media_id,media_role,alt_text,caption,sort_order,created_at,updated_at)
        VALUES (?,?,?,'flyer',?,'',?,?,?)`).bind(linkId,submissionId,mediaId,altText,startOrder+index,now,now).run();
    }
    return stored;
  } catch (error) {
    for (const item of stored) {
      await env.SUBMISSION_FILES.delete(item.key).catch(() => {});
      await db.prepare("DELETE FROM calendar_public_submission_media WHERE media_id=?").bind(item.mediaId).run().catch(() => {});
      await db.prepare("DELETE FROM media_assets WHERE id=?").bind(item.mediaId).run().catch(() => {});
    }
    throw error;
  }
}

function manageUrl(request, token) {
  const url = new URL("/calendar/submit/manage/", request.url);
  return `${url.toString()}#token=${encodeURIComponent(token)}`;
}

async function createSubmission(request, env) {
  if (!env.SUBMISSIONS_DB || !env.SUBMISSION_FILES) return failure("Calendar submission storage is unavailable.", 503);
  let form;
  try { form = await request.formData(); } catch { return failure("Expected multipart form data.", 415); }
  if (text(form.get("website"), 500)) return failure("Unable to accept this submission.", 400);
  const rawPayload = parsePayload(form);
  if (!rawPayload) return failure("Submission details are missing or invalid.");
  const payload = normalizeSubmissionPayload(rawPayload);
  const idempotencyKey = text(request.headers.get("Idempotency-Key") || form.get("idempotencyKey"), 200);
  if (!idempotencyKey) return failure("An idempotency key is required.");
  const db = env.SUBMISSIONS_DB;
  const existing = await db.prepare("SELECT id,reference_code,status FROM calendar_public_submissions WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (existing) return json({ reference:existing.reference_code, status:await deriveStatus(db,existing), repeated:true });
  let files;
  try { files = await validatedFiles(form); } catch (error) { return failure(error.message, 413); }
  const errors = payloadErrors(payload, files.length, 0);
  if (errors.length) return json({ error:"Check the highlighted submission details.", errors }, { status:400 });
  if (!(await validateTurnstile(request, env, form))) return failure("Verification failed. Refresh the challenge and try again.", 403);
  if (!(await enforceRateLimit(db, request, env, payload.submitterEmail))) return failure("Too many submissions. Try again later.", 429);
  const now = new Date();
  const createdAt = now.toISOString();
  const id = `cal_submission_${crypto.randomUUID()}`;
  const revisionId = `cal_submission_revision_${crypto.randomUUID()}`;
  const tokenId = `cal_submission_token_${crypto.randomUUID()}`;
  const reference = referenceCode(now);
  const rawToken = randomToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(now.getTime() + MANAGE_DAYS * 86_400_000).toISOString();
  const fingerprint = await duplicateFingerprint(payload);
  try {
    await db.batch([
      db.prepare(`INSERT INTO calendar_public_submissions
        (id,reference_code,submission_kind,status,submitter_name,submitter_email,submitter_phone,submitter_relationship,latest_revision_id,idempotency_key,duplicate_fingerprint,created_at,updated_at)
        VALUES (?,?,?,'received',?,?,?,?,?,?,?,?,?)`).bind(id,reference,payload.kind,payload.submitterName,payload.submitterEmail,payload.submitterPhone,payload.submitterRelationship,revisionId,idempotencyKey,fingerprint,createdAt,createdAt),
      db.prepare(`INSERT INTO calendar_public_submission_revisions(id,submission_id,revision_number,payload_json,created_by,created_at)
        VALUES (?,?,1,?,'submitter',?)`).bind(revisionId,id,JSON.stringify(payload),createdAt),
      db.prepare(`INSERT INTO calendar_public_submission_tokens(id,submission_id,token_hash,expires_at,created_at)
        VALUES (?,?,?,?,?)`).bind(tokenId,id,tokenHash,expiresAt,createdAt),
    ]);
    await storeFiles(env, db, id, reference, files, payload);
  } catch (error) {
    const media = await loadMedia(db,id).catch(() => []);
    for (const item of media) {
      const asset = await db.prepare("SELECT storage_key FROM media_assets WHERE id=?").bind(item.mediaId).first().catch(() => null);
      if (asset?.storage_key) await env.SUBMISSION_FILES.delete(asset.storage_key).catch(() => {});
    }
    await db.prepare("DELETE FROM calendar_public_submissions WHERE id=?").bind(id).run().catch(() => {});
    const concurrent = await db.prepare("SELECT id,reference_code,status FROM calendar_public_submissions WHERE idempotency_key=?").bind(idempotencyKey).first().catch(() => null);
    if (concurrent && concurrent.id !== id) {
      return json({ reference:concurrent.reference_code, status:await deriveStatus(db,concurrent), repeated:true });
    }
    return failure("The submission could not be saved. Nothing was published.", 500);
  }
  const submission = await loadSubmission(db,id);
  const link = manageUrl(request,rawToken);
  const notificationResults = await Promise.allSettled([
    notifyCalendarSubmissionReceived(env,request,submission,link),
    notifyAdminCalendarSubmissionReceived(env,request,submission),
  ]);
  return json({ reference, status:"received", manageUrl:link, notificationQueued:notificationResults.some((result) => result.status === "fulfilled") }, { status:201 });
}

async function updateSubmission(request, env, access) {
  const db = env.SUBMISSIONS_DB;
  const current = await loadSubmission(db, access.submission_id);
  if (!current) return failure("Submission not found.",404);
  if (!ACTIVE_EDIT_STATUSES.has(current.status)) return failure("This submission is read-only because Studio review has advanced.",409);
  let form;
  try { form = await request.formData(); } catch { return failure("Expected multipart form data.",415); }
  const rawPayload = parsePayload(form);
  if (!rawPayload) return failure("Submission details are missing or invalid.");
  const payload = normalizeSubmissionPayload(rawPayload);
  let files;
  try { files = await validatedFiles(form); } catch (error) { return failure(error.message,413); }
  const retainedMediaIds = new Set((Array.isArray(rawPayload.media) ? rawPayload.media : []).map((item) => text(item.id,200)).filter(Boolean));
  const retained = current.media.filter((item) => retainedMediaIds.has(item.id));
  if (retained.length + files.length > MAX_FILES) return failure(`Keep no more than ${MAX_FILES} event images.`);
  const errors = payloadErrors(payload,files.length,retained.length);
  if (errors.length) return json({ error:"Check the highlighted submission details.",errors },{status:400});
  const latest = await db.prepare("SELECT COALESCE(MAX(revision_number),0) number FROM calendar_public_submission_revisions WHERE submission_id=?").bind(current.id).first();
  const originalRow = await db.prepare("SELECT * FROM calendar_public_submissions WHERE id=?").bind(current.id).first();
  const revisionId = `cal_submission_revision_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO calendar_public_submission_revisions(id,submission_id,revision_number,payload_json,created_by,created_at)
      VALUES (?,?,?,?, 'submitter',?)`).bind(revisionId,current.id,Number(latest?.number)+1,JSON.stringify(payload),now).run();
    await db.prepare(`UPDATE calendar_public_submissions SET submission_kind=?,submitter_name=?,submitter_email=?,submitter_phone=?,submitter_relationship=?,latest_revision_id=?,duplicate_fingerprint=?,updated_at=? WHERE id=?`)
      .bind(payload.kind,payload.submitterName,payload.submitterEmail,payload.submitterPhone,payload.submitterRelationship,revisionId,await duplicateFingerprint(payload),now,current.id).run();
    for (const item of current.media) {
      if (retainedMediaIds.has(item.id)) {
        const update = (rawPayload.media || []).find((entry) => text(entry.id,200) === item.id) || {};
        await db.prepare("UPDATE calendar_public_submission_media SET alt_text=?,caption=?,sort_order=?,removed_at=NULL,updated_at=? WHERE id=?")
          .bind(text(update.altText,1000)||item.altText,text(update.caption,3000),Number(update.sortOrder)||0,now,item.id).run();
      } else {
        await db.prepare("UPDATE calendar_public_submission_media SET removed_at=?,updated_at=? WHERE id=?").bind(now,now,item.id).run();
      }
    }
    await storeFiles(env,db,current.id,current.reference,files,payload,retained.length);
  } catch (error) {
    await db.prepare("DELETE FROM calendar_public_submission_revisions WHERE id=?").bind(revisionId).run().catch(() => {});
    await db.prepare(`UPDATE calendar_public_submissions SET submission_kind=?,submitter_name=?,submitter_email=?,submitter_phone=?,submitter_relationship=?,latest_revision_id=?,duplicate_fingerprint=?,updated_at=? WHERE id=?`)
      .bind(originalRow.submission_kind,originalRow.submitter_name,originalRow.submitter_email,originalRow.submitter_phone,originalRow.submitter_relationship,originalRow.latest_revision_id,originalRow.duplicate_fingerprint,originalRow.updated_at,current.id).run().catch(() => {});
    for (const item of current.media) {
      await db.prepare("UPDATE calendar_public_submission_media SET alt_text=?,caption=?,sort_order=?,removed_at=NULL,updated_at=? WHERE id=?")
        .bind(item.altText,item.caption,item.sortOrder,originalRow.updated_at,item.id).run().catch(() => {});
    }
    return failure("The changes could not be saved. The previous private revision is still current.",500);
  }
  return json({ submission:await loadSubmission(db,current.id) });
}

async function serveManagedMedia(request, env, access, mediaId) {
  const row = await env.SUBMISSIONS_DB.prepare(`SELECT m.storage_key,m.mime_type,m.original_filename
    FROM calendar_public_submission_media sm JOIN media_assets m ON m.id=sm.media_id
    WHERE sm.id=? AND sm.submission_id=? AND sm.removed_at IS NULL AND m.privacy='internal' AND m.state='active'`)
    .bind(mediaId,access.submission_id).first();
  if (!row) return failure("Image not found.",404);
  const object = await env.SUBMISSION_FILES?.get(row.storage_key);
  if (!object?.body) return failure("Image unavailable.",404);
  return new Response(object.body,{headers:{
    "content-type":row.mime_type,
    "content-disposition":`inline; filename="${safeFilename(row.original_filename)}"`,
    "cache-control":"private, no-store",
    "x-content-type-options":"nosniff",
  }});
}

async function withdrawSubmission(env, access) {
  const now = new Date().toISOString();
  const result = await env.SUBMISSIONS_DB.prepare(`UPDATE calendar_public_submissions SET status='withdrawn',closed_at=?,updated_at=?
    WHERE id=? AND status IN ('received','needs_information')`).bind(now,now,access.submission_id).run();
  if (!Number(result?.meta?.changes)) return failure("This submission can no longer be withdrawn.",409);
  return json({ status:"withdrawn" });
}

export async function handleCalendarSubmissionPublicApi(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/calendar/submissions" && request.method === "POST") return createSubmission(request,env);
    if (url.pathname === "/api/calendar/submissions/config" && request.method === "GET") {
      return json({ siteKey:text(env.CALENDAR_SUBMISSION_TURNSTILE_SITE_KEY,200), action:"calendar_submit", configured:Boolean(env.CALENDAR_SUBMISSION_TURNSTILE_SITE_KEY) });
    }
    if (url.pathname === "/api/calendar/submissions/manage") {
      if (!env.SUBMISSIONS_DB) return failure("Calendar submission storage is unavailable.",503);
      const access = await accessByManageToken(env.SUBMISSIONS_DB,request);
      if (!access) return failure("This private submission link is invalid or expired.",401);
      if (request.method === "GET") return json({ submission:await loadSubmission(env.SUBMISSIONS_DB,access.submission_id) });
      if (request.method === "PATCH") return updateSubmission(request,env,access);
      if (request.method === "DELETE") return withdrawSubmission(env,access);
      return failure("Method not allowed.",405);
    }
    const mediaMatch = url.pathname.match(/^\/api\/calendar\/submissions\/manage\/media\/([^/]+)$/);
    if (mediaMatch && request.method === "GET") {
      const access = await accessByManageToken(env.SUBMISSIONS_DB,request);
      return access ? serveManagedMedia(request,env,access,decodeURIComponent(mediaMatch[1])) : failure("Unauthorized.",401);
    }
    return failure("Unknown calendar submission route.",404);
  } catch (error) {
    console.error(JSON.stringify({ event:"calendar_public_submission_failed", error:text(error?.message,1000) }));
    return failure("Calendar submission is temporarily unavailable.",500);
  }
}

async function duplicateMatches(db, submission) {
  const payload = submission.payload;
  const date = payload.startsAt.slice(0,10);
  const candidates = await db.prepare(`SELECT id,title,starts_at,venue_name,status,public_entry_id FROM calendar_candidates
    WHERE substr(COALESCE(starts_at,''),1,10)=? OR lower(title)=lower(?) ORDER BY updated_at DESC LIMIT 12`).bind(date,payload.title).all();
  const entries = await db.prepare(`SELECT id,candidate_id,title,starts_at,venue_name,status FROM calendar_entries
    WHERE substr(starts_at,1,10)=? OR lower(title)=lower(?) ORDER BY last_modified_at DESC LIMIT 12`).bind(date,payload.title).all();
  const sixwell = await db.prepare(`SELECT 'sixwell:'||COALESCE(o.id,e.id) id,e.title,
      COALESCE(o.starts_at,e.starts_at) starts_at,COALESCE(o.location,e.location) venue_name,
      e.publication_state status
    FROM events e LEFT JOIN event_occurrences o ON o.event_id=e.id
    WHERE substr(COALESCE(o.starts_at,e.starts_at,''),1,10)=? OR lower(e.title)=lower(?)
    ORDER BY COALESCE(o.starts_at,e.starts_at) DESC LIMIT 12`).bind(date,payload.title).all();
  return { candidates:candidates.results || [], entries:entries.results || [], sixwellEvents:sixwell.results || [] };
}

function candidateBody(submission) {
  const payload = submission.payload;
  const people = payload.people || [];
  const ticketStatus = payload.admissionType === "free" ? "not_required"
    : payload.admissionType === "free_rsvp" ? "registration_open"
      : payload.admissionType === "paid" ? "on_sale"
        : payload.admissionType === "donation" ? (payload.ticketUrl ? "registration_open" : "not_required") : "not_required";
  const ticketNotes = [
    payload.admissionType === "free" ? "Free." : payload.admissionType === "free_rsvp" ? "Free; registration required." : payload.admissionType === "donation" ? "Donation-based admission." : payload.admissionType === "restricted" ? "Restricted or invitation-only attendance." : "",
    payload.admissionNotes, payload.ageNotes ? `Age: ${payload.ageNotes}` : "", payload.accessibilityNotes ? `Accessibility: ${payload.accessibilityNotes}` : "",
  ].filter(Boolean).join(" ");
  return {
    title:payload.title, factualDescription:payload.factualDescription, eventStructure:payload.eventStructure,
    dateKind:payload.dateKind, startsAt:payload.startsAt, endsAt:payload.endsAt, timezone:payload.timezone,
    organizer:payload.organizer, organizerUrl:payload.organizerUrl, venueName:payload.online ? "Online" : payload.venueName,
    venueAddress:payload.online ? "Online" : payload.venueAddress, venueUrl:payload.venueUrl,
    city:payload.city, region:payload.region, subjects:payload.subjects, formats:payload.formats, experimental:payload.experimental,
    sourceUrl:payload.sourceUrl || payload.ticketUrl, ticketUrl:payload.ticketUrl, ticketStatus, ticketNotes,
    sourceAuthority:"unresolved", sourceResolutionNotes:`Public submission ${submission.reference}; Studio must verify every fact and source before publication.`,
    accessStatus:payload.admissionType === "restricted" ? "restricted" : "public",
    accessNotes:[payload.accessNotes,payload.admissionType === "restricted" ? ticketNotes : ""].filter(Boolean).join(" "),
    audiences:payload.admissionType === "restricted" ? ["See attendance requirements"] : ["Public"],
    verificationState:"needs_verification", verificationNotes:`Received through public calendar submission ${submission.reference}.`,
    discoveryChannel:"public_submission", internalNotes:`Submitter contact remains in Community Submissions under ${submission.reference}.`,
    relatedLinks:people.filter((person) => person.url).map((person,index) => ({ label:person.name,url:person.url,role:person.role,creditRole:person.creditRole,includePublic:false,sortOrder:index })),
    occurrences:payload.occurrences,
    media:submission.media.map((item,index) => ({ mediaId:item.mediaId,role:index===0?"primary":"gallery",altText:item.altText,caption:item.caption,includePublic:false,sortOrder:index })),
  };
}

async function handleAdminAction(request, env, submission, action) {
  const db = env.SUBMISSIONS_DB;
  const body = request.headers.get("content-type")?.includes("application/json") ? await request.json().catch(() => ({})) : {};
  const now = new Date().toISOString();
  if (["needs-information","duplicate","decline","withdraw"].includes(action)) {
    const next = action === "needs-information" ? "needs_information" : action === "decline" ? "declined" : action === "withdraw" ? "withdrawn" : "duplicate";
    await db.prepare("UPDATE calendar_public_submissions SET status=?,studio_note=?,closed_at=?,updated_at=? WHERE id=?")
      .bind(next,text(body.note,3000),CLOSED_STATUSES.has(next)?now:null,now,submission.id).run();
    return json({ submission:await loadSubmission(db,submission.id,true) });
  }
  if (action !== "convert") return failure("Unknown submission action.",404);
  if (!ACTIVE_EDIT_STATUSES.has(submission.status)) return failure("Only an open submission can be converted.",409);
  let candidateId = text(body.candidateId,200);
  let revisionId = "";
  let targetEntryId = "";
  if (submission.kind === "new") {
    const result = await createCalendarCandidateFromPublicSubmission(env,candidateBody(submission),{
      submissionId:submission.id, reference:submission.reference, sourceUrl:submission.payload.sourceUrl || submission.payload.targetUrl,
    });
    candidateId = result.candidate.id;
  } else {
    if (!candidateId) return failure("Choose the existing candidate this correction belongs to.",409);
    const revision = await createCalendarCorrectionRevision(env,candidateId,candidateBody(submission),{
      submissionId:submission.id, reference:submission.reference, targetUrl:submission.payload.targetUrl,
    });
    if (revision.error) return failure(revision.error,revision.status || 400);
    revisionId = revision.revisionId;
    const target = await db.prepare("SELECT public_entry_id FROM calendar_candidates WHERE id=?").bind(candidateId).first();
    targetEntryId = target?.public_entry_id || "";
  }
  await db.prepare(`UPDATE calendar_public_submissions SET status='converted',converted_candidate_id=?,converted_revision_id=?,target_candidate_id=COALESCE(target_candidate_id,?),target_entry_id=CASE WHEN ?<>'' THEN ? ELSE target_entry_id END,closed_at=?,updated_at=? WHERE id=?`)
    .bind(candidateId,revisionId,candidateId,targetEntryId,targetEntryId,now,now,submission.id).run();
  return json({ submission:await loadSubmission(db,submission.id,true), candidateId, revisionId });
}

export async function handleCalendarSubmissionAdminApi(request, env) {
  const authError = requireAdmin(request,env);
  if (authError) return authError;
  try {
    const db = env.SUBMISSIONS_DB;
    if (!db) return failure("Calendar submission storage is unavailable.",503);
    const parts = new URL(request.url).pathname.replace(/^\/api\/admin\/calendar\/submissions\/?/,"").split("/").filter(Boolean);
    if (!parts.length) {
      if (request.method !== "GET") return failure("Method not allowed.",405);
      const rows = await db.prepare("SELECT id FROM calendar_public_submissions ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'needs_information' THEN 1 ELSE 2 END,created_at DESC LIMIT 250").all();
      const submissions = [];
      for (const row of rows.results || []) submissions.push(await loadSubmission(db,row.id));
      return json({ submissions });
    }
    const id = decodeURIComponent(parts[0]);
    const submission = await loadSubmission(db,id,true);
    if (!submission) return failure("Submission not found.",404);
    if (parts[1] === "media" && parts[2] && request.method === "GET") {
      return serveManagedMedia(request,env,{ submission_id:id },decodeURIComponent(parts[2]));
    }
    if (!parts[1]) {
      if (request.method !== "GET") return failure("Method not allowed.",405);
      return json({ submission, matches:await duplicateMatches(db,submission) });
    }
    if (request.method !== "POST") return failure("Method not allowed.",405);
    return handleAdminAction(request,env,submission,parts[1]);
  } catch (error) {
    console.error(JSON.stringify({ event:"calendar_submission_admin_failed", error:text(error?.message,1000) }));
    return failure("Calendar submission administration failed.",500,text(error?.message,1000));
  }
}

export async function purgeClosedCalendarSubmissions(env, now = new Date()) {
  if (!env.SUBMISSIONS_DB || !env.SUBMISSION_FILES) return { purged:0 };
  const cutoff = new Date(now.getTime() - CLOSED_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await env.SUBMISSIONS_DB.prepare(`SELECT id FROM calendar_public_submissions
    WHERE status IN ('duplicate','declined','withdrawn') AND closed_at<? AND personal_data_purged_at IS NULL LIMIT 50`).bind(cutoff).all();
  let purged = 0;
  for (const row of rows.results || []) {
    const media = await env.SUBMISSIONS_DB.prepare(`SELECT sm.media_id,m.storage_key FROM calendar_public_submission_media sm JOIN media_assets m ON m.id=sm.media_id WHERE sm.submission_id=?`).bind(row.id).all();
    for (const item of media.results || []) {
      if (item.storage_key) await env.SUBMISSION_FILES.delete(item.storage_key).catch(() => {});
      await env.SUBMISSIONS_DB.prepare("DELETE FROM calendar_public_submission_media WHERE submission_id=? AND media_id=?").bind(row.id,item.media_id).run();
      await env.SUBMISSIONS_DB.prepare("DELETE FROM media_assets WHERE id=?").bind(item.media_id).run();
    }
    await env.SUBMISSIONS_DB.prepare("DELETE FROM calendar_public_submission_tokens WHERE submission_id=?").bind(row.id).run();
    await env.SUBMISSIONS_DB.prepare("UPDATE calendar_public_submissions SET submitter_name='',submitter_email='',submitter_phone='',submitter_relationship='',personal_data_purged_at=?,updated_at=? WHERE id=?")
      .bind(now.toISOString(),now.toISOString(),row.id).run();
    purged += 1;
  }
  return { purged };
}
