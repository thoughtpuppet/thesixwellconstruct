import {
  notifyAdminSubmissionReceived,
  notifySubmissionReceived,
} from "../notifications/_lib.js";

const VALID_STATUSES = new Set([
  "new",
  "reviewing",
  "approved",
  "declined",
  "booked",
  "archived",
]);

const PUBLIC_TYPES = new Set([
  "tattoo_inquiry",
  "flash_claim",
  "special_project",
  "build_brief",
  "maze_design",
  "art_acquisition",
  "consultation",
  "studio_booking",
]);

const REQUIRED_FIELDS_BY_TYPE = {
  tattoo_inquiry: [
    ["placement", "Placement is required."],
    ["message", "Project notes are required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  flash_claim: [
    ["selected_flash", "Available flash selection is required."],
    ["placement", "Placement is required."],
    ["claim_bid", "Bid / budget is required."],
    ["review_consent", "Review consent is required.", "yes"],
  ],
  build_brief: [
    ["selected_elements", "Select at least one Legend symbol."],
    ["placement", "Placement is required."],
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

  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
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
      const formData = await request.formData();
      return formDataToObject(formData);
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
  return {
    id: row.id,
    type: row.type,
    status: row.status,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function handleCreateSubmission(request, env) {
  const body = await readSubmissionBody(request);
  if (!body) return errorResponse("Expected JSON or form data.", 400);

  const submission = normalizeSubmission(body.payload, request);
  const validation = validateSubmission(submission, body.payload);
  if (validation?.spam) {
    return json({ ok: true, submissionId: null, spam: true });
  }

  if (validation?.error) {
    return errorResponse(validation.error, validation.status);
  }

  try {
    const db = requireSubmissionDb(env);
    if (submission.type === "flash_claim") {
      const flashId = asString(body.payload.flash_id || body.payload.selected_flash);
      const flash = await db.prepare("SELECT id,title,state,claimable FROM flash_items WHERE id=? OR slug=?").bind(flashId, flashId).first();
      if (!flash || flash.state !== "available" || Number(flash.claimable) !== 1) {
        return errorResponse("That flash is no longer available. Refresh the flash catalog and choose another design.", 409, { code: "FLASH_UNAVAILABLE" });
      }
      body.payload.flash_snapshot = { id: flash.id, title: flash.title, state: flash.state, claimable: true };
    }

    if (submission.type === "build_brief") {
      const rawIds = body.payload.symbol_ids || body.payload.selected_symbol_ids || [];
      const symbolIds = (Array.isArray(rawIds) ? rawIds : String(rawIds).split(",")).map(asString).filter(Boolean);
      if (symbolIds.length) {
        const placeholders = symbolIds.map(() => "?").join(",");
        const result = await db.prepare(`SELECT v.id,v.name,v.meaning,v.svg_markup,v.themes_json,c.name category FROM visual_symbols v JOIN visual_symbol_categories c ON c.id=v.category_id WHERE v.id IN (${placeholders}) AND v.state='published'`).bind(...symbolIds).all();
        const symbols = result.results || [];
        if (symbols.length !== new Set(symbolIds).size) return errorResponse("One or more selected symbols are unavailable. Refresh and try again.", 409, { code: "SYMBOL_UNAVAILABLE" });
        body.payload.symbol_snapshot = symbols.map((symbol) => ({ id: symbol.id, name: symbol.name, meaning: symbol.meaning, category: symbol.category, themes: parseJsonField(symbol.themes_json, []), imagery: symbol.svg_markup }));
      }
    }
    submission.payload = body.payload;
    const id = createSubmissionId();
    const savedFiles = await saveSubmissionFiles(env, id, body.files);
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO submissions (
          id, type, status, source_path, subject, contact_name, contact_email,
          contact_phone, contact_json, payload_json, request_meta_json,
          files_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
        now,
        now
      )
      .run();

    await db
      .prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, "created", "system", null, now)
      .run();

    await notifySubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
    });
    await notifyAdminSubmissionReceived(env, {
      id,
      ...submission,
      files: savedFiles,
    });

    return json({
      ok: true,
      submissionId: id,
      filesStored: savedFiles.filter((file) => file.stored).length,
      filesReceived: savedFiles.length,
    });
  } catch (error) {
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
      filters.push("status = ?");
      bindings.push(status);
    }
    if (type) {
      filters.push("type = ?");
      bindings.push(type);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await db
      .prepare(
        `SELECT * FROM submissions ${where} ORDER BY created_at DESC LIMIT ?`
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

    return json({
      submission: normalizeRow(row),
      events: events.results || [],
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
  const internalNotes = asString(body.internalNotes);
  const bookingUrl = asString(body.bookingUrl);

  if (status && !VALID_STATUSES.has(status)) {
    return errorResponse(`Unsupported status: ${status}.`, 400);
  }

  try {
    const db = requireSubmissionDb(env);
    const current = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Submission not found.", 404);

    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE submissions
         SET status = ?, internal_notes = ?, booking_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(status || current.status, internalNotes, bookingUrl, now, id)
      .run();

    await db
      .prepare(
        `INSERT INTO submission_events (
          id, submission_id, event_type, actor, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        id,
        status && status !== current.status ? "status_changed" : "updated",
        "admin",
        status && status !== current.status
          ? `${current.status} -> ${status}`
          : null,
        now
      )
      .run();

    const updated = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
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

  try {
    const db = requireSubmissionDb(env);
    const current = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Submission not found.", 404);

    const appointmentCount = await db
      .prepare("SELECT COUNT(*) AS count FROM appointments WHERE submission_id = ?")
      .bind(id)
      .first();
    if (Number(appointmentCount?.count || 0) > 0) {
      return errorResponse("Submission has appointment history. Archive it instead of deleting.", 409);
    }

    await db.prepare("DELETE FROM booking_tokens WHERE submission_id = ?").bind(id).run();
    await db.prepare("DELETE FROM submission_events WHERE submission_id = ?").bind(id).run();
    await db.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();

    return json({ ok: true, deletedId: id });
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
