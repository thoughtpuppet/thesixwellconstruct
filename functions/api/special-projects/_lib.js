const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
  });
}

function errorResponse(message, status = 400, extras = {}) {
  return json({ error: message, ...extras }, { status });
}

function db(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return env.SUBMISSIONS_DB;
}

function requireAdmin(request, env) {
  const expected = env.SUBMISSIONS_ADMIN_TOKEN;
  if (!expected) return errorResponse("Admin submissions are not configured.", 503);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : new URL(request.url).searchParams.get("token") || "";
  return supplied === expected ? null : errorResponse("Unauthorized.", 401);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rawToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function publicBaseUrl(env, request) {
  if (env.PUBLIC_SITE_URL) return String(env.PUBLIC_SITE_URL).replace(/\/+$/g, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function safeFileName(value) {
  return String(value || "healed-photo")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "healed-photo";
}

async function followupForToken(database, token) {
  if (!token) return null;
  const hash = await sha256Hex(token);
  return database.prepare(
    `SELECT f.*,s.contact_name,s.contact_email,t.project_title
     FROM special_project_healed_followups f
     JOIN submissions s ON s.id=f.submission_id
     JOIN special_project_submission_terms t ON t.submission_id=f.submission_id
     WHERE f.token_hash=?`
  ).bind(hash).first();
}

function presentFollowup(row) {
  return {
    id: row.id,
    projectTitle: row.project_title,
    clientName: row.contact_name,
    method: row.method,
    status: row.status,
    dueAt: row.due_at,
    completedAt: row.completed_at || "",
  };
}

export async function handlePublicSpecialProjectHealed(request, env) {
  try {
    const database = db(env);
    const token = new URL(request.url).searchParams.get("token") || "";
    const followup = await followupForToken(database, token);
    if (!followup || followup.method !== "self_upload") return errorResponse("This healed-photo link is invalid.", 404);
    if (followup.token_expires_at && followup.token_expires_at <= new Date().toISOString()) {
      return errorResponse("This healed-photo link has expired. Contact the studio for a replacement.", 410);
    }
    if (request.method === "GET") return json({ ok: true, followup: presentFollowup(followup) });
    if (request.method !== "POST") return errorResponse("Method not allowed.", 405);
    if (followup.status !== "pending") return errorResponse("This healed-photo follow-up is already complete.", 409);
    if (!env.SUBMISSION_FILES) return errorResponse("Photo storage is temporarily unavailable.", 503);
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared && declared > MAX_TOTAL_BYTES) return errorResponse("Uploads cannot exceed 60 MB in total.", 413);
    const form = await request.formData();
    const files = form.getAll("healed_photos").filter((value) => typeof File !== "undefined" && value instanceof File && value.size > 0);
    if (files.length < 1 || files.length > 4) return errorResponse("Upload between 1 and 4 healed photographs.", 400);
    const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (total > MAX_TOTAL_BYTES) return errorResponse("Uploads cannot exceed 60 MB in total.", 413);
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) return errorResponse(`${file.name} exceeds the 15 MB limit.`, 413);
      if (!ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
        return errorResponse("Healed photographs must be JPG, PNG, or WEBP images.", 415);
      }
    }
    const now = new Date().toISOString();
    const stored = [];
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const key = `special-projects/healed/${followup.id}/${id}-${safeFileName(file.name)}`;
        await env.SUBMISSION_FILES.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: { followupId: followup.id, submissionId: followup.submission_id, privacy: "private" },
        });
        stored.push({ id, key, file });
      }
      await database.batch([
        ...stored.map(({ id, key, file }) => database.prepare(
          `INSERT INTO special_project_healed_photos
           (id,followup_id,storage_key,original_filename,mime_type,byte_size,created_at)
           VALUES(?,?,?,?,?,?,?)`
        ).bind(id, followup.id, key, safeFileName(file.name), file.type, file.size, now)),
        database.prepare(
          `UPDATE special_project_healed_followups
           SET status='received',completed_at=?,token_hash=NULL,token_expires_at=NULL,updated_at=?
           WHERE id=? AND status='pending'`
        ).bind(now, now, followup.id),
        database.prepare(
          `INSERT INTO submission_events(id,submission_id,event_type,actor,note,created_at)
           VALUES(?,?,'healed_photos_received','client',?,?)`
        ).bind(crypto.randomUUID(), followup.submission_id, `${stored.length} healed photo(s) received privately.`, now),
      ]);
    } catch (error) {
      await Promise.all(stored.map((item) => env.SUBMISSION_FILES.delete(item.key).catch(() => {})));
      throw error;
    }
    return json({ ok: true, received: stored.length, followup: { ...presentFollowup(followup), status: "received", completedAt: now } });
  } catch (error) {
    return errorResponse("Unable to save healed photographs.", 500, { detail: error.message });
  }
}

export async function handleAdminSpecialProjectHealed(request, env, followupId, action = "") {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const database = db(env);
    if (action === "file") {
      if (request.method !== "GET") return errorResponse("Method not allowed.", 405);
      const photoId = new URL(request.url).searchParams.get("photo") || "";
      const photo = await database.prepare(
        "SELECT * FROM special_project_healed_photos WHERE id=? AND followup_id=?"
      ).bind(photoId, followupId).first();
      if (!photo) return errorResponse("Healed photograph not found.", 404);
      const object = await env.SUBMISSION_FILES?.get(photo.storage_key);
      if (!object) return errorResponse("Stored healed photograph not found.", 404);
      return new Response(object.body, {
        headers: {
          "content-type": photo.mime_type,
          "content-disposition": `inline; filename="${safeFileName(photo.original_filename)}"`,
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow",
        },
      });
    }
    const followup = await database.prepare("SELECT * FROM special_project_healed_followups WHERE id=?").bind(followupId).first();
    if (!followup) return errorResponse("Healed-photo follow-up not found.", 404);
    if (request.method === "GET") {
      const photos = (await database.prepare(
        "SELECT id,original_filename,mime_type,byte_size,created_at FROM special_project_healed_photos WHERE followup_id=? ORDER BY created_at"
      ).bind(followupId).all()).results || [];
      return json({ ok: true, followup, photos });
    }
    if (request.method !== "POST") return errorResponse("Method not allowed.", 405);
    const body = await request.json().catch(() => ({}));
    const command = String(body.action || action || "").trim();
    const now = new Date().toISOString();
    if (command === "complete_return") {
      if (followup.method !== "return") return errorResponse("This follow-up uses client self-upload.", 409);
      await database.prepare(
        `UPDATE special_project_healed_followups SET status='return_completed',completed_at=?,completion_note=?,updated_at=?
         WHERE id=? AND status='pending'`
      ).bind(now, String(body.note || "").trim().slice(0, 5000), now, followupId).run();
    } else if (command === "waive") {
      const note = String(body.note || "").trim().slice(0, 5000);
      if (!note) return errorResponse("A private waiver reason is required.", 400);
      await database.prepare(
        `UPDATE special_project_healed_followups SET status='waived',completed_at=?,completion_note=?,token_hash=NULL,token_expires_at=NULL,updated_at=?
         WHERE id=? AND status='pending'`
      ).bind(now, note, now, followupId).run();
    } else if (command === "regenerate_token") {
      if (followup.method !== "self_upload" || followup.status !== "pending") return errorResponse("A new upload link is not available for this follow-up.", 409);
      const token = rawToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      await database.prepare(
        "UPDATE special_project_healed_followups SET token_hash=?,token_expires_at=?,updated_at=? WHERE id=?"
      ).bind(tokenHash, expiresAt, now, followupId).run();
      return json({ ok: true, uploadUrl: `${publicBaseUrl(env, request)}/tattoos/special-projects/healed/?token=${encodeURIComponent(token)}`, expiresAt });
    } else if (command === "link_media") {
      const mediaId = String(body.mediaId || "").trim();
      if (!mediaId) return errorResponse("Choose an existing Shared Media item.", 400);
      const media = await database.prepare("SELECT id FROM media_assets WHERE id=? AND state='active'").bind(mediaId).first();
      if (!media) return errorResponse("That Shared Media item is not available.", 404);
      await database.prepare(
        "UPDATE special_project_healed_followups SET media_asset_id=?,updated_at=? WHERE id=?"
      ).bind(mediaId, now, followupId).run();
    } else {
      return errorResponse("Choose complete_return, waive, regenerate_token, or link_media.", 400);
    }
    return json({ ok: true, followup: await database.prepare("SELECT * FROM special_project_healed_followups WHERE id=?").bind(followupId).first() });
  } catch (error) {
    return errorResponse("Unable to update the healed-photo follow-up.", 500, { detail: error.message });
  }
}
