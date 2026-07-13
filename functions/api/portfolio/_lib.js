const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_UPLOADS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const ALLOWED_STYLES = new Set([
  "",
  "unclassified",
  "symbolic",
  "surreal",
  "mythic",
  "special-project",
]);
const EDITABLE_FIELDS = new Map([
  ["title", "title"],
  ["altText", "alt_text"],
  ["year", "year"],
  ["placement", "placement"],
  ["primaryStyle", "primary_style"],
  ["collection", "collection"],
  ["caption", "caption"],
]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function errorResponse(message, status = 400, detail = "") {
  return json({ error: message, ...(detail ? { detail } : {}) }, { status });
}

function requireDb(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Portfolio database is not configured.");
  return env.SUBMISSIONS_DB;
}

function adminError(request, env) {
  const expected = env.SUBMISSIONS_ADMIN_TOKEN || "";
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!expected) return errorResponse("Portfolio administration is not configured.", 503);
  if (supplied !== expected) return errorResponse("Unauthorized.", 401);
  return null;
}

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function itemFromRow(row, admin = false) {
  const item = {
    id: row.id,
    imageUrl: row.source_url || `/api/portfolio/media/${encodeURIComponent(row.id)}`,
    originalFilename: row.original_filename || "",
    title: row.title || "",
    altText: row.alt_text || "",
    year: row.year || "",
    placement: row.placement || "",
    primaryStyle: row.primary_style || "unclassified",
    collection: row.collection || "",
    caption: row.caption || "",
    state: row.state,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (admin) {
    item.sourceUrl = row.source_url || "";
    item.storageKey = row.storage_key || "";
    item.contentType = row.content_type || "";
    if (row.storage_key) item.imageUrl = `/api/admin/portfolio/media/${encodeURIComponent(row.id)}`;
  }
  return item;
}

async function nextSortOrder(db, state) {
  const row = await db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM portfolio_items WHERE state = ?")
    .bind(state)
    .first();
  return Number(row?.max_order || 0) + 1;
}

async function listPublic(env) {
  const db = requireDb(env);
  const result = await db.prepare(
    "SELECT * FROM portfolio_items WHERE state = 'published' ORDER BY sort_order ASC, created_at ASC"
  ).all();
  return json({ items: (result.results || []).map((row) => itemFromRow(row)) });
}

async function listAdmin(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const result = await requireDb(env).prepare(
    "SELECT * FROM portfolio_items ORDER BY CASE state WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, sort_order ASC, created_at ASC"
  ).all();
  return json({ items: (result.results || []).map((row) => itemFromRow(row, true)) });
}

async function mediaResponse(request, env, id, admin = false) {
  if (admin) {
    const authError = adminError(request, env);
    if (authError) return authError;
  }
  const db = requireDb(env);
  const row = await db.prepare(
    `SELECT storage_key, content_type, original_filename FROM portfolio_items WHERE id = ?${admin ? "" : " AND state = 'published'"}`
  ).bind(id).first();
  if (!row?.storage_key) return errorResponse("Portfolio image not found.", 404);
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);
  const object = await env.SUBMISSION_FILES.get(row.storage_key);
  if (!object) return errorResponse("Portfolio image not found in storage.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.content_type || headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${String(row.original_filename || "portfolio-image").replace(/["\\]/g, "")}"`);
  headers.set("cache-control", admin ? "private, no-store" : "public, max-age=31536000, immutable");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

async function createUpload(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return errorResponse("Choose an image to upload.");
  const extension = ALLOWED_UPLOADS.get(String(file.type || "").toLowerCase());
  if (!extension) return errorResponse("Use a JPEG, PNG, or WebP image.", 415);
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("Images must be 15 MB or smaller.", 413);

  const db = requireDb(env);
  const id = crypto.randomUUID();
  const key = `portfolio/${id}.${extension}`;
  const order = await nextSortOrder(db, "draft");
  const originalFilename = cleanText(file.name, 255) || `portfolio.${extension}`;
  const title = cleanText(form.get("title"), 160);
  const altText = cleanText(form.get("altText"), 300);

  await env.SUBMISSION_FILES.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: { itemId: id, originalFilename },
  });

  try {
    await db.prepare(`
      INSERT INTO portfolio_items (
        id, storage_key, original_filename, content_type, title, alt_text,
        state, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
    `).bind(id, key, originalFilename, file.type, title, altText, order).run();
  } catch (error) {
    await env.SUBMISSION_FILES.delete(key);
    throw error;
  }

  const row = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  return json({ item: itemFromRow(row, true) }, { status: 201 });
}

async function patchItem(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const current = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio item not found.", 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Send a JSON object.");
  const updates = [];
  const values = [];
  for (const [apiField, sqlField] of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, apiField)) continue;
    const max = apiField === "caption" ? 2000 : apiField === "altText" ? 300 : 160;
    const value = cleanText(body[apiField], max);
    if (apiField === "primaryStyle" && !ALLOWED_STYLES.has(value)) {
      return errorResponse("Choose a valid primary style.");
    }
    updates.push(`${sqlField} = ?`);
    values.push(value);
  }

  let nextState = current.state;
  if (Object.prototype.hasOwnProperty.call(body, "state")) {
    nextState = cleanText(body.state, 20);
    if (!["draft", "published", "archived"].includes(nextState)) return errorResponse("Choose a valid state.");
    const nextTitle = Object.prototype.hasOwnProperty.call(body, "title") ? cleanText(body.title, 160) : current.title;
    const nextAlt = Object.prototype.hasOwnProperty.call(body, "altText") ? cleanText(body.altText, 300) : current.alt_text;
    if (nextState === "published" && current.state !== "published" && (!nextTitle || !nextAlt)) {
      return errorResponse("Title and alt text are required before publishing.", 422);
    }
    if (nextState !== current.state) {
      updates.push("state = ?");
      values.push(nextState);
      updates.push("sort_order = ?");
      values.push(await nextSortOrder(db, nextState));
    }
  }

  if (!updates.length) return errorResponse("No portfolio changes were supplied.");
  updates.push("updated_at = datetime('now')");
  values.push(id);
  await db.prepare(`UPDATE portfolio_items SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  const row = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  return json({ item: itemFromRow(row, true) });
}

async function archiveItem(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const current = await db.prepare("SELECT id, state FROM portfolio_items WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio item not found.", 404);
  const order = current.state === "archived" ? null : await nextSortOrder(db, "archived");
  if (order !== null) {
    await db.prepare("UPDATE portfolio_items SET state = 'archived', sort_order = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(order, id).run();
  }
  return json({ ok: true, archivedId: id });
}

async function reorderItems(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const state = cleanText(body?.state, 20);
  const ids = Array.isArray(body?.ids) ? body.ids.map((id) => cleanText(id, 80)) : [];
  if (!["published", "draft"].includes(state)) return errorResponse("Only published or draft items can be reordered.");
  if (!ids.length || new Set(ids).size !== ids.length) return errorResponse("Send each item ID exactly once.");

  const db = requireDb(env);
  const result = await db.prepare("SELECT id FROM portfolio_items WHERE state = ? ORDER BY sort_order ASC").bind(state).all();
  const expected = (result.results || []).map((row) => row.id);
  if (expected.length !== ids.length || expected.some((id) => !ids.includes(id))) {
    return errorResponse("The portfolio changed. Refresh before reordering.", 409);
  }
  await db.batch(ids.map((id, index) => db.prepare(
    "UPDATE portfolio_items SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND state = ?"
  ).bind(index + 1, id, state)));
  return json({ ok: true, ids });
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", allow: allowed.join(", ") },
  });
}

export async function handlePortfolioApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path === "/api/portfolio") {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return listPublic(env);
    }
    if (path.startsWith("/api/portfolio/media/")) {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return mediaResponse(request, env, decodeURIComponent(path.slice("/api/portfolio/media/".length)));
    }
    if (path === "/api/admin/portfolio") {
      if (method === "GET") return listAdmin(request, env);
      if (method === "POST") return createUpload(request, env);
      return methodNotAllowed(["GET", "POST"]);
    }
    if (path === "/api/admin/portfolio/reorder") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return reorderItems(request, env);
    }
    if (path.startsWith("/api/admin/portfolio/media/")) {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return mediaResponse(request, env, decodeURIComponent(path.slice("/api/admin/portfolio/media/".length)), true);
    }
    if (path.startsWith("/api/admin/portfolio/")) {
      const id = decodeURIComponent(path.slice("/api/admin/portfolio/".length));
      if (method === "PATCH") return patchItem(request, env, id);
      if (method === "DELETE") return archiveItem(request, env, id);
      return methodNotAllowed(["PATCH", "DELETE"]);
    }
    return errorResponse("Unknown portfolio API route.", 404);
  } catch (error) {
    return errorResponse("Unable to process the portfolio request.", 500, error.message);
  }
}
