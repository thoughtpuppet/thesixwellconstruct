const TOKEN_BYTES = 32;
const ACTION_TOKEN_HOURS = 14 * 24;
const BOOKING_TOKEN_DAYS = 30;
const ACUITY_BASE = "https://acuityscheduling.com/api/v1";

const FORM_TYPES = {
  standard: {
    label: "Tattoo Inquiry",
    appointmentTypeEnv: "ACUITY_STANDARD_APPOINTMENT_TYPE_ID",
  },
  flash: {
    label: "Flash Claim",
    appointmentTypeEnv: "ACUITY_FLASH_APPOINTMENT_TYPE_ID",
  },
  special_project: {
    label: "Special Projects Application",
    appointmentTypeEnv: "ACUITY_SPECIAL_PROJECT_APPOINTMENT_TYPE_ID",
  },
};

const REQUIRED_FIELDS = ["formType", "firstName", "lastName", "email", "message"];

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

function badRequest(message, extras = {}) {
  return json({ error: message, ...extras }, { status: 400 });
}

function configError(message) {
  return json({ error: message }, { status: 500 });
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function clean(value, max = 2000) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanText(value, max = 5000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeEmail(value) {
  return clean(value, 320).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function baseUrl(request, env) {
  return env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function statusLabel(status) {
  return status.replace(/_/g, " ");
}

function requireDb(env) {
  if (!env.DB) {
    throw new Error("Missing D1 binding DB.");
  }
}

function requireSecret(env, name) {
  if (!env[name]) {
    throw new Error(`Missing required secret or variable ${name}.`);
  }
  return env[name];
}

function appointmentTypeId(env, formType) {
  const key = FORM_TYPES[formType]?.appointmentTypeEnv;
  return key ? env[key] || "" : "";
}

function privateAcuityLink(env, formType) {
  const configured = env.ACUITY_PRIVATE_BOOKING_URL || env.ACUITY_BOOKING_URL || "https://artpill.acuityscheduling.com/";
  const typeId = appointmentTypeId(env, formType);
  if (!typeId) return configured;

  const url = new URL(configured);
  url.searchParams.set("appointmentType", typeId);
  return url.toString();
}

function normalizeSubmission(body, request) {
  const sourcePath = clean(body.sourcePath || new URL(request.url).pathname, 500);
  const formType = clean(body.formType, 40);
  const data = {
    formType,
    firstName: clean(body.firstName, 120),
    lastName: clean(body.lastName, 120),
    email: normalizeEmail(body.email),
    phone: clean(body.phone, 80),
    pronouns: clean(body.pronouns, 80),
    instagram: clean(body.instagram, 120),
    placement: clean(body.placement, 240),
    size: clean(body.size, 160),
    budgetRange: clean(body.budgetRange, 160),
    timeline: clean(body.timeline, 160),
    projectTitle: clean(body.projectTitle || body.flashTitle || body.specialProject, 240),
    referenceUrls: cleanText(body.referenceUrls, 2500),
    message: cleanText(body.message, 5000),
    sourcePath,
    website: clean(body.website, 240),
    consent: Boolean(body.consent),
  };

  const missing = REQUIRED_FIELDS.filter((field) => !data[field]);
  if (!FORM_TYPES[data.formType]) {
    missing.push("valid formType");
  }
  if (data.email && !isEmail(data.email)) {
    missing.push("valid email");
  }
  if (!data.consent) {
    missing.push("consent");
  }

  return { data, missing };
}

async function createActionToken(env, submissionId, action, now = new Date()) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = addHours(now, ACTION_TOKEN_HOURS);

  await env.DB.prepare(
    `INSERT INTO tattoo_action_tokens
      (id, submission_id, action, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), submissionId, action, tokenHash, expiresAt, now.toISOString())
    .run();

  return token;
}

async function createBookingToken(env, submission, now = new Date()) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = addDays(now, BOOKING_TOKEN_DAYS);
  const acuityUrl = privateAcuityLink(env, submission.form_type);

  await env.DB.prepare(
    `INSERT INTO tattoo_booking_tokens
      (id, submission_id, token_hash, status, appointment_type_id, acuity_url, expires_at, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      submission.id,
      tokenHash,
      appointmentTypeId(env, submission.form_type),
      acuityUrl,
      expiresAt,
      now.toISOString()
    )
    .run();

  return { token, expiresAt, acuityUrl };
}

async function insertAudit(env, submissionId, eventType, payload = {}) {
  await env.DB.prepare(
    `INSERT INTO tattoo_audit_events
      (id, submission_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), submissionId, eventType, JSON.stringify(payload), nowIso())
    .run();
}

function textRows(submission) {
  return [
    ["Form", FORM_TYPES[submission.form_type]?.label || submission.form_type],
    ["Name", `${submission.first_name} ${submission.last_name}`.trim()],
    ["Email", submission.email],
    ["Phone", submission.phone],
    ["Instagram", submission.instagram],
    ["Project / flash", submission.project_title],
    ["Placement", submission.placement],
    ["Size", submission.size],
    ["Budget", submission.budget_range],
    ["Timeline", submission.timeline],
    ["References", submission.reference_urls],
    ["Message", submission.message],
  ].filter(([, value]) => value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function adminEmailHtml(submission, approveUrl, rejectUrl) {
  const rows = textRows(submission)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 14px 8px 0;color:#8F231D;font-weight:700;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#20140d;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:Georgia,serif;color:#20140d;line-height:1.55;">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8F231D;">Art.Pill Tattoo House</p>
      <h1 style="font-family:Arial,sans-serif;font-size:28px;line-height:1;margin:0 0 18px;">New ${escapeHtml(FORM_TYPES[submission.form_type]?.label || "Tattoo Submission")}</h1>
      <table style="border-collapse:collapse;width:100%;max-width:680px;">${rows}</table>
      <p style="margin:28px 0 10px;">Review before releasing booking access.</p>
      <p>
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 18px;border:1px solid #8F231D;color:#8F231D;text-decoration:none;text-transform:uppercase;font-size:12px;letter-spacing:.12em;">Review approval</a>
        <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 18px;border:1px solid #6D3D15;color:#6D3D15;text-decoration:none;text-transform:uppercase;font-size:12px;letter-spacing:.12em;">Review rejection</a>
      </p>
    </div>
  `;
}

function clientReceivedHtml(submission) {
  return `
    <div style="font-family:Georgia,serif;color:#20140d;line-height:1.65;">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8F231D;">Art.Pill Tattoo House</p>
      <h1 style="font-family:Arial,sans-serif;font-size:28px;line-height:1;margin:0 0 18px;">Inquiry received.</h1>
      <p>Thank you for sending your ${escapeHtml(FORM_TYPES[submission.form_type]?.label || "tattoo submission").toLowerCase()}.</p>
      <p>This is not a booking confirmation. Submissions are reviewed before scheduling. If approved, you will receive a private booking link and next steps.</p>
    </div>
  `;
}

function clientApprovedHtml(submission, bookingUrl) {
  return `
    <div style="font-family:Georgia,serif;color:#20140d;line-height:1.65;">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8F231D;">Art.Pill Tattoo House</p>
      <h1 style="font-family:Arial,sans-serif;font-size:28px;line-height:1;margin:0 0 18px;">Your project has been approved.</h1>
      <p>Your submission has been reviewed and approved for the next booking step.</p>
      <p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:12px 18px;border:1px solid #8F231D;color:#8F231D;text-decoration:none;text-transform:uppercase;font-size:12px;letter-spacing:.12em;">Open private booking access</a></p>
      <p>This private link expires after ${BOOKING_TOKEN_DAYS} days. Final scheduling and deposit are completed through Acuity.</p>
    </div>
  `;
}

async function sendEmail(env, message, idempotencyKey) {
  requireSecret(env, "RESEND_API_KEY");
  const from = env.RESEND_FROM_EMAIL || "Art.Pill Tattoo House <tattoo@thesixwellconstruct.com>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, ...message }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Resend request failed with ${response.status}.`);
  }
  return payload;
}

async function notifySubmission(env, request, submission) {
  const notifyEmail = requireSecret(env, "TATTOO_NOTIFY_EMAIL");
  const origin = baseUrl(request, env);
  const approveToken = await createActionToken(env, submission.id, "approve");
  const rejectToken = await createActionToken(env, submission.id, "reject");
  const approveUrl = `${origin}/tattoos/review/?token=${encodeURIComponent(approveToken)}&action=approve`;
  const rejectUrl = `${origin}/tattoos/review/?token=${encodeURIComponent(rejectToken)}&action=reject`;

  await sendEmail(
    env,
    {
      to: notifyEmail,
      reply_to: submission.email,
      subject: `New ${FORM_TYPES[submission.form_type].label}: ${submission.first_name} ${submission.last_name}`,
      html: adminEmailHtml(submission, approveUrl, rejectUrl),
      text: textRows(submission)
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n"),
    },
    `tattoo-admin-${submission.id}`
  );

  await sendEmail(
    env,
    {
      to: submission.email,
      reply_to: notifyEmail,
      subject: "Art.Pill Tattoo House inquiry received",
      html: clientReceivedHtml(submission),
      text: "Your inquiry was received. This is not a booking confirmation. If approved, you will receive a private booking link and next steps.",
    },
    `tattoo-client-${submission.id}`
  );

  await insertAudit(env, submission.id, "notified", { approveUrl, rejectUrl });
}

export async function handleCreateSubmission(request, env) {
  try {
    requireDb(env);
  } catch (error) {
    return configError(error.message);
  }

  const body = await readJsonBody(request);
  if (!body) return badRequest("Expected a JSON request body.");

  const { data, missing } = normalizeSubmission(body, request);
  if (data.website) {
    return json({ ok: true, submissionId: null, status: "received" });
  }
  if (missing.length) {
    return badRequest("Missing or invalid required fields.", { fields: missing });
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const payload = {
    referenceUrls: data.referenceUrls,
    pronouns: data.pronouns,
    consent: data.consent,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO tattoo_submissions
        (id, form_type, status, first_name, last_name, email, phone, pronouns, instagram,
         placement, size, budget_range, timeline, project_title, reference_urls, message,
         source_path, payload_json, created_at, updated_at)
        VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        data.formType,
        data.firstName,
        data.lastName,
        data.email,
        data.phone,
        data.pronouns,
        data.instagram,
        data.placement,
        data.size,
        data.budgetRange,
        data.timeline,
        data.projectTitle,
        data.referenceUrls,
        data.message,
        data.sourcePath,
        JSON.stringify(payload),
        createdAt,
        createdAt
      )
      .run();

    const submission = await env.DB.prepare("SELECT * FROM tattoo_submissions WHERE id = ?")
      .bind(id)
      .first();

    await insertAudit(env, id, "created", { sourcePath: data.sourcePath });
    await notifySubmission(env, request, submission);

    return json({ ok: true, submissionId: id, status: "received" }, { status: 201 });
  } catch (error) {
    await insertAudit(env, id, "notification_or_insert_failed", { message: error.message }).catch(() => {});
    return json(
      { error: "Unable to receive tattoo submission.", detail: error.message },
      { status: 500 }
    );
  }
}

export async function handleGetAction(request, env) {
  try {
    requireDb(env);
  } catch (error) {
    return configError(error.message);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const action = url.searchParams.get("action") || "";
  if (!token || !["approve", "reject"].includes(action)) {
    return badRequest("Missing review token or action.");
  }

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.submission_id, t.action, t.expires_at, t.used_at,
      s.first_name, s.last_name, s.email, s.form_type, s.project_title, s.status
     FROM tattoo_action_tokens t
     JOIN tattoo_submissions s ON s.id = t.submission_id
     WHERE t.token_hash = ? AND t.action = ?`
  )
    .bind(tokenHash, action)
    .first();

  if (!row) return json({ valid: false, error: "Review token was not found." }, { status: 404 });
  if (row.used_at) return json({ valid: false, error: "Review token has already been used." }, { status: 410 });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ valid: false, error: "Review token has expired." }, { status: 410 });
  }

  return json({
    valid: true,
    action,
    submission: {
      id: row.submission_id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      email: row.email,
      formType: row.form_type,
      formLabel: FORM_TYPES[row.form_type]?.label || row.form_type,
      projectTitle: row.project_title,
      status: row.status,
    },
  });
}

export async function handlePostAction(request, env) {
  try {
    requireDb(env);
  } catch (error) {
    return configError(error.message);
  }

  const body = await readJsonBody(request);
  if (!body?.token || !["approve", "reject"].includes(body.action)) {
    return badRequest("Expected token and review action.");
  }

  const tokenHash = await sha256(body.token);
  const row = await env.DB.prepare(
    `SELECT
       t.id AS token_id, t.submission_id, t.action, t.expires_at, t.used_at,
       s.id AS submission_row_id, s.form_type, s.status, s.first_name, s.last_name,
       s.email, s.phone, s.pronouns, s.instagram, s.placement, s.size,
       s.budget_range, s.timeline, s.project_title, s.reference_urls, s.message,
       s.source_path, s.payload_json, s.created_at, s.updated_at
     FROM tattoo_action_tokens t
     JOIN tattoo_submissions s ON s.id = t.submission_id
     WHERE t.token_hash = ? AND t.action = ?`
  )
    .bind(tokenHash, body.action)
    .first();

  if (!row) return json({ error: "Review token was not found." }, { status: 404 });
  if (row.used_at) return json({ error: "Review token has already been used." }, { status: 410 });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "Review token has expired." }, { status: 410 });
  }

  const updatedAt = nowIso();
  await env.DB.prepare("UPDATE tattoo_action_tokens SET used_at = ? WHERE id = ?")
    .bind(updatedAt, row.token_id)
    .run();

  if (body.action === "reject") {
    await env.DB.prepare("UPDATE tattoo_submissions SET status = 'rejected', updated_at = ? WHERE id = ?")
      .bind(updatedAt, row.submission_id)
      .run();
    await insertAudit(env, row.submission_id, "rejected");
    return json({ ok: true, status: "rejected" });
  }

  await env.DB.prepare("UPDATE tattoo_submissions SET status = 'approved', updated_at = ? WHERE id = ?")
    .bind(updatedAt, row.submission_id)
    .run();

  const submission = await env.DB.prepare("SELECT * FROM tattoo_submissions WHERE id = ?")
    .bind(row.submission_id)
    .first();
  const booking = await createBookingToken(env, submission);
  const bookingUrl = `${baseUrl(request, env)}/tattoos/booking/?token=${encodeURIComponent(booking.token)}`;
  await insertAudit(env, row.submission_id, "approved", { bookingUrl });

  await sendEmail(
    env,
    {
      to: submission.email,
      reply_to: env.TATTOO_NOTIFY_EMAIL,
      subject: "Art.Pill Tattoo House private booking access",
      html: clientApprovedHtml(submission, bookingUrl),
      text: `Your project has been approved. Open private booking access: ${bookingUrl}`,
    },
    `tattoo-approved-${submission.id}-${updatedAt}`
  );
  await insertAudit(env, row.submission_id, "booking_link_sent");

  return json({ ok: true, status: "approved", bookingUrl });
}

export async function handleGetBooking(request, env) {
  try {
    requireDb(env);
  } catch (error) {
    return configError(error.message);
  }

  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) return badRequest("Missing private booking token.");

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT b.*, s.first_name, s.last_name, s.email, s.form_type, s.project_title, s.status
     FROM tattoo_booking_tokens b
     JOIN tattoo_submissions s ON s.id = b.submission_id
     WHERE b.token_hash = ?`
  )
    .bind(tokenHash)
    .first();

  if (!row) return json({ valid: false, error: "Booking token was not found." }, { status: 404 });
  if (row.status !== "active") return json({ valid: false, error: `Booking token is ${statusLabel(row.status)}.` }, { status: 410 });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ valid: false, error: "Booking token has expired." }, { status: 410 });
  }

  return json({
    valid: true,
    booking: {
      name: `${row.first_name} ${row.last_name}`.trim(),
      email: row.email,
      formType: row.form_type,
      formLabel: FORM_TYPES[row.form_type]?.label || row.form_type,
      projectTitle: row.project_title,
      acuityUrl: row.acuity_url,
      appointmentTypeId: row.appointment_type_id,
      expiresAt: row.expires_at,
    },
  });
}

function acuityHeaders(env) {
  requireSecret(env, "ACUITY_USER_ID");
  requireSecret(env, "ACUITY_API_KEY");
  return {
    authorization: `Basic ${btoa(`${env.ACUITY_USER_ID}:${env.ACUITY_API_KEY}`)}`,
    accept: "application/json",
  };
}

export async function handleAvailability(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const month = url.searchParams.get("month") || "";
  const date = url.searchParams.get("date") || "";
  const bookingResponse = await handleGetBooking(request, env);
  const bookingPayload = await bookingResponse.json();
  if (!bookingPayload.valid) {
    return json(bookingPayload, { status: bookingResponse.status });
  }

  const appointmentTypeId = bookingPayload.booking.appointmentTypeId;
  if (!appointmentTypeId) {
    return json({ error: "No Acuity appointment type is configured for this booking." }, { status: 500 });
  }

  try {
    const endpoint = date ? "/availability/times" : "/availability/dates";
    const acuityUrl = new URL(`${ACUITY_BASE}${endpoint}`);
    acuityUrl.searchParams.set("appointmentTypeID", appointmentTypeId);
    acuityUrl.searchParams.set("timezone", "America/New_York");
    if (date) acuityUrl.searchParams.set("date", date);
    if (!date && month) acuityUrl.searchParams.set("month", month);
    if (!date && !month) {
      acuityUrl.searchParams.set("month", new Date().toISOString().slice(0, 7));
    }
    const response = await fetch(acuityUrl, { headers: acuityHeaders(env) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return json({ error: "Unable to load Acuity availability.", detail: payload }, { status: response.status });
    }
    return json({ token, availability: payload });
  } catch (error) {
    return json({ error: "Unable to load Acuity availability.", detail: error.message }, { status: 500 });
  }
}

export { json, badRequest };
