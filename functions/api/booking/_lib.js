const BOOKING_STATUSES = new Set([
  "pending_deposit",
  "deposit_pending",
  "confirmed",
  "cancelled",
  "archived",
]);

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

function bookingDb(env) {
  return env.SUBMISSIONS_DB || null;
}

function requireBookingDb(env) {
  const db = bookingDb(env);
  if (!db) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
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

function asPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeBookingType(row) {
  return {
    id: row.id,
    venture: row.venture,
    label: row.label,
    description: row.description || "",
    durationMinutes: row.duration_minutes,
    depositCents: row.deposit_cents,
    depositLabel: formatMoney(row.deposit_cents, row.currency || "USD"),
    currency: row.currency || "USD",
    active: Boolean(row.active),
    sortOrder: row.sort_order || 0,
  };
}

function normalizeWindow(row) {
  return {
    id: row.id,
    venture: row.venture,
    bookingTypeId: row.booking_type_id || "",
    startAt: row.start_at,
    endAt: row.end_at,
    capacity: row.capacity,
    bufferBeforeMinutes: row.buffer_before_minutes || 0,
    bufferAfterMinutes: row.buffer_after_minutes || 0,
    isBlackout: Boolean(row.is_blackout),
    active: Boolean(row.active),
    note: row.note || "",
  };
}

function normalizeSettings(row) {
  return {
    venture: row.venture,
    timezone: row.timezone || "America/New_York",
    bookingHorizonDays: row.booking_horizon_days,
    minimumNoticeHours: row.minimum_notice_hours,
    slotIntervalMinutes: row.slot_interval_minutes,
    maxBookingsPerDay: row.max_bookings_per_day,
    defaultCapacity: row.default_capacity,
    defaultBufferBeforeMinutes: row.default_buffer_before_minutes,
    defaultBufferAfterMinutes: row.default_buffer_after_minutes,
  };
}

function normalizeRule(row) {
  return {
    id: row.id,
    venture: row.venture,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    active: Boolean(row.active),
    capacity: row.capacity,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    note: row.note || "",
  };
}

function normalizeAppointment(row) {
  return {
    id: row.id,
    submissionId: row.submission_id || "",
    bookingTokenId: row.booking_token_id || "",
    bookingTypeId: row.booking_type_id,
    availabilityWindowId: row.availability_window_id || "",
    status: row.status,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone || "",
    startAt: row.start_at,
    endAt: row.end_at,
    depositCents: row.deposit_cents,
    currency: row.currency || "USD",
    squareOrderId: row.square_order_id || "",
    squarePaymentLinkId: row.square_payment_link_id || "",
    squareCheckoutUrl: row.square_checkout_url || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function intervalWithBuffer(row) {
  const start = new Date(row.start_at).getTime() - Number(row.buffer_before_minutes || 0) * 60 * 1000;
  const end = new Date(row.end_at).getTime() + Number(row.buffer_after_minutes || 0) * 60 * 1000;
  return { start, end };
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isBlockedByBlackout(windowRow, blackoutRows) {
  const windowInterval = intervalWithBuffer(windowRow);
  return blackoutRows.some((blackout) => intervalsOverlap(windowInterval, intervalWithBuffer(blackout)));
}

function overlappingAppointmentCount(windowRow, appointmentRows) {
  const windowInterval = intervalWithBuffer(windowRow);
  return appointmentRows.filter((appointment) =>
    intervalsOverlap(windowInterval, intervalWithBuffer(appointment))
  ).length;
}

function hasSlotCapacity(windowRow, appointmentRows) {
  return overlappingAppointmentCount(windowRow, appointmentRows) < Number(windowRow.capacity || 1);
}

function datePartsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    dayOfWeek: dayMap[value.weekday],
  };
}

function parseTime(value) {
  const [hour = 0, minute = 0] = String(value || "00:00").split(":").map(Number);
  return { hour, minute };
}

function isValidTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function minutesFromTime(value) {
  const { hour, minute } = parseTime(value);
  return hour * 60 + minute;
}

function zonedLocalToUtcIso(timezone, year, month, day, hour, minute) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMinutes = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day),
    Number(local.hour),
    Number(local.minute)
  );
  const desiredMinutes = Date.UTC(year, month - 1, day, hour, minute);
  const offset = localMinutes - desiredMinutes;
  return new Date(utcGuess - offset).toISOString();
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

function generatedWindowId(ruleId, bookingTypeId, startAt) {
  return `gen:${ruleId}:${bookingTypeId}:${new Date(startAt).getTime()}`;
}

function parseGeneratedWindowId(id) {
  const parts = String(id || "").split(":");
  if (parts.length !== 4 || parts[0] !== "gen") return null;
  return {
    ruleId: parts[1],
    bookingTypeId: parts[2],
    startMs: Number(parts[3]),
  };
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
  if (!expectedToken) return errorResponse("Admin booking is not configured.", 503);
  if (authTokenFromRequest(request) !== expectedToken) {
    return errorResponse("Unauthorized.", 401);
  }
  return null;
}

function baseUrlFromRequest(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createRawToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadTokenContext(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const token = await db
    .prepare(
      `SELECT bt.*, s.status AS submission_status, s.contact_name, s.contact_email,
        s.contact_phone, s.type AS submission_type
       FROM booking_tokens bt
       JOIN submissions s ON s.id = bt.submission_id
       WHERE bt.token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  if (!token) return null;
  const now = new Date().toISOString();
  if (token.revoked_at || token.used_at) return { invalid: "This booking link is no longer active." };
  if (token.expires_at && token.expires_at < now) return { invalid: "This booking link has expired." };
  if (token.submission_status !== "approved") {
    return { invalid: "This booking link is waiting on approval." };
  }

  return {
    token,
    allowedBookingTypes: parseJsonField(token.allowed_booking_types_json, []),
  };
}

async function listBookingTypes(db, allowedBookingTypes) {
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .all();
  const allowed = new Set(allowedBookingTypes || []);
  return (result.results || [])
    .filter((row) => !allowed.size || allowed.has(row.id))
    .map(normalizeBookingType);
}

async function listPublicWindows(db, bookingTypes) {
  const ids = bookingTypes.map((type) => type.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const manualResult = await db
    .prepare(
      `SELECT aw.*,
        (
          SELECT COUNT(*) FROM appointments a
          WHERE a.availability_window_id = aw.id
            AND a.status IN ('pending_deposit', 'deposit_pending', 'confirmed')
        ) AS appointment_count
       FROM availability_windows aw
       WHERE aw.active = 1
         AND aw.is_blackout = 0
         AND aw.id NOT LIKE 'gen:%'
         AND aw.start_at > ?
         AND (aw.booking_type_id IS NULL OR aw.booking_type_id IN (${placeholders}))
       ORDER BY aw.start_at ASC`
    )
    .bind(new Date().toISOString(), ...ids)
    .all();

  const blackoutResult = await db
    .prepare(
      `SELECT * FROM availability_windows
       WHERE active = 1 AND is_blackout = 1 AND end_at > ?`
    )
    .bind(new Date().toISOString())
    .all();
  const blackouts = blackoutResult.results || [];
  const activeAppointments = await loadActiveAppointments(db, new Date().toISOString());

  const manualWindows = (manualResult.results || [])
    .filter((row) => Number(row.appointment_count || 0) < Number(row.capacity || 1))
    .filter((row) => !isBlockedByBlackout(row, blackouts))
    .filter((row) => hasSlotCapacity(row, activeAppointments))
    .map(normalizeWindow);

  const generatedWindows = await listGeneratedWindows(db, bookingTypes, blackouts, activeAppointments);
  return [...manualWindows, ...generatedWindows]
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 120);
}

async function listGeneratedWindows(db, bookingTypes, blackouts, activeAppointments) {
  const settingsRow = await db
    .prepare("SELECT * FROM booking_settings WHERE venture = ?")
    .bind("tattooing")
    .first();
  if (!settingsRow) return [];
  const settings = normalizeSettings(settingsRow);
  const rulesResult = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE venture = ? AND active = 1
       ORDER BY day_of_week ASC`
    )
    .bind("tattooing")
    .all();
  const rules = rulesResult.results || [];
  if (!rules.length) return [];

  const now = new Date();
  const earliest = new Date(now.getTime() + settings.minimumNoticeHours * 60 * 60 * 1000);
  const days = Math.max(1, Math.min(settings.bookingHorizonDays || 60, 180));
  const generated = [];
  const bookingsByDay = await loadBookingsByLocalDay(db, settings.timezone, earliest.toISOString());
  const appointmentCounts = await loadAppointmentCounts(db);

  for (let offset = 0; offset <= days; offset += 1) {
    const cursor = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = datePartsInZone(cursor, settings.timezone);
    const localKey = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
    if (Number(bookingsByDay.get(localKey) || 0) >= settings.maxBookingsPerDay) continue;

    for (const rule of rules.filter((item) => Number(item.day_of_week) === local.dayOfWeek)) {
      const startParts = parseTime(rule.start_time);
      const endParts = parseTime(rule.end_time);
      const ruleStart = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, startParts.hour, startParts.minute);
      const ruleEnd = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, endParts.hour, endParts.minute);
      if (new Date(ruleEnd).getTime() <= new Date(ruleStart).getTime()) continue;

      for (const bookingType of bookingTypes) {
        let slotStart = ruleStart;
        while (new Date(addMinutes(slotStart, bookingType.durationMinutes)).getTime() <= new Date(ruleEnd).getTime()) {
          const slotEnd = addMinutes(slotStart, bookingType.durationMinutes);
          const row = {
            id: generatedWindowId(rule.id, bookingType.id, slotStart),
            venture: rule.venture,
            booking_type_id: bookingType.id,
            start_at: slotStart,
            end_at: slotEnd,
            capacity: rule.capacity || settings.defaultCapacity,
            buffer_before_minutes: rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
            buffer_after_minutes: rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
            is_blackout: 0,
            active: 1,
            note: rule.note || "Generated from weekly schedule",
          };
          if (
            new Date(slotStart).getTime() >= earliest.getTime() &&
            Number(appointmentCounts.get(row.id) || 0) < Number(row.capacity || 1) &&
            hasSlotCapacity(row, activeAppointments) &&
            !isBlockedByBlackout(row, blackouts)
          ) {
            generated.push(normalizeWindow(row));
          }
          slotStart = addMinutes(slotStart, settings.slotIntervalMinutes || 30);
        }
      }
    }
  }
  return generated;
}

async function loadBookingsByLocalDay(db, timezone, afterIso) {
  const result = await db
    .prepare(
      `SELECT start_at FROM appointments
       WHERE start_at > ? AND status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
    )
    .bind(afterIso)
    .all();
  const map = new Map();
  for (const row of result.results || []) {
    const parts = datePartsInZone(new Date(row.start_at), timezone);
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    map.set(key, Number(map.get(key) || 0) + 1);
  }
  return map;
}

function bookedDaysFromMap(map) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

async function loadActiveAppointments(db, afterIso) {
  const result = await db
    .prepare(
      `SELECT a.start_at, a.end_at,
              COALESCE(aw.buffer_before_minutes, 0) AS buffer_before_minutes,
              COALESCE(aw.buffer_after_minutes, 0) AS buffer_after_minutes
       FROM appointments a
       LEFT JOIN availability_windows aw ON aw.id = a.availability_window_id
       WHERE a.end_at > ?
         AND a.status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
    )
    .bind(afterIso)
    .all();
  return result.results || [];
}

async function loadAppointmentCounts(db) {
  const result = await db
    .prepare(
      `SELECT availability_window_id, COUNT(*) AS count FROM appointments
       WHERE status IN ('pending_deposit', 'deposit_pending', 'confirmed')
       GROUP BY availability_window_id`
    )
    .all();
  return new Map((result.results || []).map((row) => [row.availability_window_id, Number(row.count || 0)]));
}

export async function handleBookingContext(request, env) {
  try {
    const db = requireBookingDb(env);
    const rawToken = new URL(request.url).searchParams.get("token") || "";
    const context = await loadTokenContext(db, rawToken);
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);

    const bookingTypes = await listBookingTypes(db, context.allowedBookingTypes);
    const windows = await listPublicWindows(db, bookingTypes);

    return json({
      ok: true,
      client: {
        name: context.token.contact_name,
        email: context.token.contact_email,
        phone: context.token.contact_phone || "",
      },
      submission: {
        id: context.token.submission_id,
        type: context.token.submission_type,
      },
      bookingTypes,
      availabilityWindows: windows,
    });
  } catch (error) {
    return errorResponse("Unable to load booking context.", 500, {
      detail: error.message,
    });
  }
}

async function ensureAvailable(db, windowId, bookingTypeId) {
  let window = await db
    .prepare("SELECT * FROM availability_windows WHERE id = ? AND active = 1")
    .bind(windowId)
    .first();
  if (!window) {
    const materialized = await materializeGeneratedWindow(db, windowId, bookingTypeId);
    if (materialized.error) return materialized;
    window = materialized.window;
  }
  if (!window || window.is_blackout) return { error: "That appointment time is unavailable." };
  if (window.booking_type_id && window.booking_type_id !== bookingTypeId) {
    return { error: "That appointment time does not match the selected session." };
  }

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM appointments
       WHERE availability_window_id = ?
         AND status IN ('pending_deposit', 'deposit_pending', 'confirmed')`
    )
    .bind(windowId)
    .first();
  if (Number(countRow?.count || 0) >= Number(window.capacity || 1)) {
    return { error: "That appointment time has already been claimed." };
  }
  const blackoutResult = await db
    .prepare(
      `SELECT * FROM availability_windows
       WHERE active = 1 AND is_blackout = 1 AND end_at > ?`
    )
    .bind(new Date().toISOString())
    .all();
  if (isBlockedByBlackout(window, blackoutResult.results || [])) {
    return { error: "That appointment time is blocked out." };
  }
  const activeAppointments = await loadActiveAppointments(db, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (!hasSlotCapacity(window, activeAppointments)) {
    return { error: "That appointment time overlaps another booking." };
  }
  return { window };
}

async function materializeGeneratedWindow(db, windowId, bookingTypeId) {
  const parsed = parseGeneratedWindowId(windowId);
  if (!parsed || parsed.bookingTypeId !== bookingTypeId || !Number.isFinite(parsed.startMs)) {
    return { error: "That appointment time is unavailable." };
  }

  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType) return { error: "Unknown booking type." };

  const rule = await db
    .prepare("SELECT * FROM availability_rules WHERE id = ? AND active = 1")
    .bind(parsed.ruleId)
    .first();
  if (!rule) return { error: "That appointment time is no longer available." };

  const settingsRow = await db
    .prepare("SELECT * FROM booking_settings WHERE venture = ?")
    .bind(rule.venture)
    .first();
  if (!settingsRow) return { error: "Booking settings are not configured." };
  const settings = normalizeSettings(settingsRow);

  const startAt = new Date(parsed.startMs).toISOString();
  const endAt = addMinutes(startAt, bookingType.duration_minutes);
  const local = datePartsInZone(new Date(startAt), settings.timezone);
  if (local.dayOfWeek !== Number(rule.day_of_week)) {
    return { error: "That appointment time is outside the current weekly schedule." };
  }

  const startParts = parseTime(rule.start_time);
  const endParts = parseTime(rule.end_time);
  const ruleStart = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, startParts.hour, startParts.minute);
  const ruleEnd = zonedLocalToUtcIso(settings.timezone, local.year, local.month, local.day, endParts.hour, endParts.minute);
  const earliest = new Date(Date.now() + settings.minimumNoticeHours * 60 * 60 * 1000);
  if (
    new Date(startAt).getTime() < earliest.getTime() ||
    new Date(startAt).getTime() < new Date(ruleStart).getTime() ||
    new Date(endAt).getTime() > new Date(ruleEnd).getTime()
  ) {
    return { error: "That appointment time is no longer available." };
  }

  const dayBookings = await loadBookingsByLocalDay(db, settings.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const localKey = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  if (Number(dayBookings.get(localKey) || 0) >= settings.maxBookingsPerDay) {
    return { error: "That day has reached its booking limit." };
  }

  const candidateWindow = {
    start_at: startAt,
    end_at: endAt,
    buffer_before_minutes: rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
    buffer_after_minutes: rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
    capacity: rule.capacity || settings.defaultCapacity,
  };
  const activeAppointments = await loadActiveAppointments(db, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (!hasSlotCapacity(candidateWindow, activeAppointments)) {
    return { error: "That appointment time overlaps another booking." };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO availability_windows (
        id, venture, booking_type_id, start_at, end_at, capacity,
        buffer_before_minutes, buffer_after_minutes, is_blackout,
        active, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      windowId,
      rule.venture,
      bookingTypeId,
      startAt,
      endAt,
      rule.capacity || settings.defaultCapacity,
      rule.buffer_before_minutes ?? settings.defaultBufferBeforeMinutes,
      rule.buffer_after_minutes ?? settings.defaultBufferAfterMinutes,
      0,
      1,
      rule.note || "Generated from weekly schedule",
      now,
      now
    )
    .run();

  const window = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(windowId).first();
  return { window };
}

async function createPendingAppointment(db, tokenContext, bookingTypeId, windowId) {
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType) return { error: "Unknown booking type." };

  const allowed = new Set(tokenContext.allowedBookingTypes || []);
  if (allowed.size && !allowed.has(bookingType.id)) {
    return { error: "This booking link does not include that session type." };
  }

  const existing = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND booking_type_id = ?
         AND availability_window_id = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(tokenContext.token.id, bookingType.id, windowId)
    .first();
  if (existing) {
    return {
      appointment: normalizeAppointment(existing),
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO appointments (
        id, submission_id, booking_token_id, booking_type_id, availability_window_id,
        status, client_name, client_email, client_phone, start_at, end_at,
        deposit_cents, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      tokenContext.token.submission_id,
      tokenContext.token.id,
      bookingType.id,
      availability.window.id,
      "pending_deposit",
      tokenContext.token.contact_name,
      tokenContext.token.contact_email,
      tokenContext.token.contact_phone || null,
      availability.window.start_at,
      availability.window.end_at,
      bookingType.deposit_cents,
      bookingType.currency || "USD",
      now,
      now
    )
    .run();

  const appointment = await db.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first();
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

export async function handleCreateBookingHold(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);

    const result = await createPendingAppointment(
      db,
      context,
      asString(body.bookingTypeId),
      asString(body.availabilityWindowId)
    );
    if (result.error) return errorResponse(result.error, 400);
    return json({ ok: true, appointment: result.appointment });
  } catch (error) {
    return errorResponse("Unable to create booking hold.", 500, {
      detail: error.message,
    });
  }
}

function squareBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareConfigured(env) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

async function createSquarePaymentLink(request, env, appointment, bookingType) {
  if (!squareConfigured(env)) {
    throw new Error("Square is not configured.");
  }

  const redirectUrl = new URL("/booking/confirmed/", baseUrlFromRequest(request));
  redirectUrl.searchParams.set("appointment", appointment.id);

  const response = await fetch(`${squareBaseUrl(env)}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: appointment.id,
      quick_pay: {
        name: `${bookingType.label} Deposit`,
        price_money: {
          amount: appointment.depositCents,
          currency: appointment.currency,
        },
        location_id: env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url: redirectUrl.toString(),
        ask_for_shipping_address: false,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.detail || "Square checkout failed.");
  }
  return payload.payment_link;
}

export async function handleCreateBookingCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);

    const result = await createPendingAppointment(
      db,
      context,
      asString(body.bookingTypeId),
      asString(body.availabilityWindowId)
    );
    if (result.error) return errorResponse(result.error, 400);
    if (result.existing && result.appointment.squareCheckoutUrl) {
      return json({
        ok: true,
        checkoutUrl: result.appointment.squareCheckoutUrl,
        appointmentId: result.appointment.id,
      });
    }

    let paymentLink;
    try {
      paymentLink = await createSquarePaymentLink(request, env, result.appointment, result.bookingType);
    } catch (error) {
      await db
        .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
        .bind("deposit_pending", new Date().toISOString(), result.appointment.id)
        .run();
      return errorResponse("Deposit checkout is not configured yet.", 503, {
        detail: error.message,
        appointment: result.appointment,
      });
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE appointments
         SET status = ?, square_order_id = ?, square_payment_link_id = ?,
             square_checkout_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        "deposit_pending",
        paymentLink.order_id || null,
        paymentLink.id || null,
        paymentLink.url,
        now,
        result.appointment.id
      )
      .run();

    await db
      .prepare(
        `INSERT INTO deposit_payments (
          id, appointment_id, provider, provider_checkout_id, provider_order_id,
          amount_cents, currency, status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        result.appointment.id,
        "square",
        paymentLink.id || null,
        paymentLink.order_id || null,
        result.appointment.depositCents,
        result.appointment.currency,
        "pending",
        JSON.stringify(paymentLink),
        now,
        now
      )
      .run();

    return json({
      ok: true,
      checkoutUrl: paymentLink.url,
      appointmentId: result.appointment.id,
    });
  } catch (error) {
    return errorResponse("Unable to start deposit checkout.", 500, {
      detail: error.message,
    });
  }
}

async function fetchSquareOrder(env, orderId) {
  if (!orderId || !squareConfigured(env)) return null;
  const response = await fetch(`${squareBaseUrl(env)}/v2/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      "Square-Version": "2026-05-20",
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.order || null;
}

function orderLooksPaid(order) {
  if (!order) return false;
  const netDue = Number(order.net_amount_due_money?.amount ?? 1);
  return order.state === "COMPLETED" || netDue <= 0 || Boolean(order.tenders?.length);
}

export async function handleConfirmBooking(request, env) {
  try {
    const db = requireBookingDb(env);
    const appointmentId = new URL(request.url).searchParams.get("appointment") || "";
    const appointmentRow = await db
      .prepare("SELECT * FROM appointments WHERE id = ?")
      .bind(appointmentId)
      .first();
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);

    let appointment = normalizeAppointment(appointmentRow);
    const order = await fetchSquareOrder(env, appointment.squareOrderId);
    const now = new Date().toISOString();
    const paid = orderLooksPaid(order);

    if (paid && appointment.status !== "confirmed") {
      await db
        .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
        .bind("confirmed", now, appointment.id)
        .run();
      await db
        .prepare(
          `UPDATE deposit_payments
           SET status = ?, raw_json = ?, updated_at = ?
           WHERE appointment_id = ?`
        )
        .bind("paid", JSON.stringify(order), now, appointment.id)
        .run();
      await db
        .prepare("UPDATE booking_tokens SET used_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, appointment.bookingTokenId)
        .run();
      await db
        .prepare(
          `UPDATE submissions
           SET status = ?, booking_url = ?, updated_at = ?
           WHERE id = ? AND status = ?`
        )
        .bind("booked", `/booking/confirmed/?appointment=${appointment.id}`, now, appointment.submissionId, "approved")
        .run();
      const updated = await db.prepare("SELECT * FROM appointments WHERE id = ?").bind(appointment.id).first();
      appointment = normalizeAppointment(updated);
    }

    return json({ ok: true, appointment, depositStatus: paid ? "paid" : "pending" });
  } catch (error) {
    return errorResponse("Unable to confirm booking.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCreateBookingToken(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const submissionId = asString(body.submissionId);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first();
    if (!submission) return errorResponse("Submission not found.", 404);
    if (submission.status !== "approved") {
      return errorResponse("Only approved submissions can receive booking links.", 400);
    }

    const rawToken = createRawToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date().toISOString();
    const expiresAt = asOptionalString(body.expiresAt) || new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const allowed = Array.isArray(body.allowedBookingTypes) && body.allowedBookingTypes.length
      ? body.allowedBookingTypes.map(asString).filter(Boolean)
      : ["tattoo_quarter", "tattoo_half", "tattoo_full"];

    const id = crypto.randomUUID();
    if (body.revokeExisting !== false) {
      await db
        .prepare(
          `UPDATE booking_tokens
           SET revoked_at = ?, updated_at = ?
           WHERE submission_id = ? AND revoked_at IS NULL AND used_at IS NULL`
        )
        .bind(now, now, submissionId)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO booking_tokens (
          id, token_hash, submission_id, allowed_booking_types_json,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, tokenHash, submissionId, JSON.stringify(allowed), expiresAt, now, now)
      .run();

    const bookingUrl = new URL("/booking/", baseUrlFromRequest(request));
    bookingUrl.searchParams.set("token", rawToken);
    await db
      .prepare("UPDATE submissions SET booking_url = ?, updated_at = ? WHERE id = ?")
      .bind(bookingUrl.pathname + bookingUrl.search, now, submissionId)
      .run();

    return json({
      ok: true,
      token: {
        id,
        bookingUrl: bookingUrl.toString(),
        path: bookingUrl.pathname + bookingUrl.search,
        expiresAt,
        allowedBookingTypes: allowed,
      },
    });
  } catch (error) {
    return errorResponse("Unable to create booking link.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminRevokeSubmissionBookingTokens(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE booking_tokens
         SET revoked_at = ?, updated_at = ?
         WHERE submission_id = ? AND revoked_at IS NULL AND used_at IS NULL`
      )
      .bind(now, now, asString(body.submissionId))
      .run();
    return json({ ok: true, revokedAt: now });
  } catch (error) {
    return errorResponse("Unable to revoke booking links.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminRevokeBookingToken(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare("UPDATE booking_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, id)
      .run();
    if (!result.meta?.changes) return errorResponse("Booking token not found.", 404);
    return json({ ok: true, revokedAt: now });
  } catch (error) {
    return errorResponse("Unable to revoke booking link.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminGetSchedule(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const settings = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const rules = await db
      .prepare(
        `SELECT * FROM availability_rules
         WHERE venture = ?
         ORDER BY day_of_week ASC`
      )
      .bind("tattooing")
      .all();
    return json({
      settings: settings ? normalizeSettings(settings) : null,
      rules: (rules.results || []).map(normalizeRule),
    });
  } catch (error) {
    return errorResponse("Unable to load schedule.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateSchedule(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const settings = body.settings || {};
    await db
      .prepare(
        `UPDATE booking_settings
         SET timezone = ?, booking_horizon_days = ?, minimum_notice_hours = ?,
             slot_interval_minutes = ?, max_bookings_per_day = ?,
             default_capacity = ?, default_buffer_before_minutes = ?,
             default_buffer_after_minutes = ?, updated_at = ?
         WHERE venture = ?`
      )
      .bind(
        asString(settings.timezone) || "America/New_York",
        Math.max(1, Math.min(asPositiveInteger(settings.bookingHorizonDays, 60), 180)),
        Math.max(0, asPositiveInteger(settings.minimumNoticeHours, 48)),
        Math.max(15, asPositiveInteger(settings.slotIntervalMinutes, 30)),
        Math.max(1, asPositiveInteger(settings.maxBookingsPerDay, 1)),
        Math.max(1, asPositiveInteger(settings.defaultCapacity, 1)),
        asPositiveInteger(settings.defaultBufferBeforeMinutes, 30),
        asPositiveInteger(settings.defaultBufferAfterMinutes, 30),
        now,
        "tattooing"
      )
      .run();

    for (const rule of Array.isArray(body.rules) ? body.rules : []) {
      const startTime = asString(rule.startTime) || "12:00";
      const endTime = asString(rule.endTime) || "18:00";
      if (!isValidTime(startTime) || !isValidTime(endTime)) {
        return errorResponse("Schedule start and end times must use HH:MM format.", 400);
      }
      if (minutesFromTime(endTime) <= minutesFromTime(startTime)) {
        return errorResponse("Schedule end time must be after start time.", 400);
      }

      await db
        .prepare(
          `UPDATE availability_rules
           SET start_time = ?, end_time = ?, active = ?, capacity = ?,
               buffer_before_minutes = ?, buffer_after_minutes = ?,
               note = ?, updated_at = ?
           WHERE id = ? AND venture = ?`
        )
        .bind(
          startTime,
          endTime,
          rule.active ? 1 : 0,
          Math.max(1, asPositiveInteger(rule.capacity, settings.defaultCapacity || 1)),
          asPositiveInteger(rule.bufferBeforeMinutes, settings.defaultBufferBeforeMinutes || 30),
          asPositiveInteger(rule.bufferAfterMinutes, settings.defaultBufferAfterMinutes || 30),
          asString(rule.note),
          now,
          asString(rule.id),
          "tattooing"
        )
        .run();
    }

    return handleAdminGetSchedule(request, env);
  } catch (error) {
    return errorResponse("Unable to update schedule.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListAvailability(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT * FROM availability_windows
         WHERE venture = ? AND id NOT LIKE 'gen:%'
         ORDER BY
           CASE WHEN end_at >= ? THEN 0 ELSE 1 END ASC,
           CASE WHEN end_at >= ? THEN start_at END ASC,
           CASE WHEN end_at < ? THEN start_at END DESC
         LIMIT 100`
      )
      .bind("tattooing", now, now, now)
      .all();
    return json({ availabilityWindows: (result.results || []).map(normalizeWindow) });
  } catch (error) {
    return errorResponse("Unable to load availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCreateAvailability(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const startAt = asString(body.startAt);
  const endAt = asString(body.endAt);
  if (!startAt || !endAt || new Date(startAt).toString() === "Invalid Date" || new Date(endAt).toString() === "Invalid Date") {
    return errorResponse("Valid startAt and endAt are required.", 400);
  }
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    return errorResponse("endAt must be after startAt.", 400);
  }

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const venture = asString(body.venture) || "tattooing";
    const candidate = {
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      buffer_before_minutes: asPositiveInteger(body.bufferBeforeMinutes, 0),
      buffer_after_minutes: asPositiveInteger(body.bufferAfterMinutes, 0),
    };
    if (!body.isBlackout) {
      const existing = await db
        .prepare(
          `SELECT * FROM availability_windows
           WHERE active = 1 AND is_blackout = 0 AND venture = ?`
        )
        .bind(venture)
        .all();
      const candidateInterval = intervalWithBuffer(candidate);
      const conflicts = (existing.results || []).some((row) =>
        intervalsOverlap(candidateInterval, intervalWithBuffer(row))
      );
      if (conflicts) {
        return errorResponse("That window overlaps an existing active window or buffer.", 400);
      }
    }
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO availability_windows (
          id, venture, booking_type_id, start_at, end_at, capacity,
          buffer_before_minutes, buffer_after_minutes, is_blackout,
          active, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        venture,
        asOptionalString(body.bookingTypeId),
        candidate.start_at,
        candidate.end_at,
        Math.max(1, asPositiveInteger(body.capacity, 1)),
        candidate.buffer_before_minutes,
        candidate.buffer_after_minutes,
        body.isBlackout ? 1 : 0,
        body.active === false ? 0 : 1,
        asString(body.note),
        now,
        now
      )
      .run();
    const row = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    return json({ availabilityWindow: normalizeWindow(row) });
  } catch (error) {
    return errorResponse("Unable to create availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminGetAvailabilityPreview(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const settingsRow = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const settings = settingsRow ? normalizeSettings(settingsRow) : null;
    const bookingTypes = await listBookingTypes(db, []);
    const availabilityWindows = await listPublicWindows(db, bookingTypes);
    const bookedDays = settings
      ? bookedDaysFromMap(await loadBookingsByLocalDay(db, settings.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()))
      : [];

    return json({
      settings,
      bookingTypes,
      availabilityWindows,
      bookedDays,
    });
  } catch (error) {
    return errorResponse("Unable to load availability preview.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateAvailability(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const current = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Availability window not found.", 404);
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE availability_windows
         SET active = ?, is_blackout = ?, note = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        body.active === undefined ? current.active : body.active ? 1 : 0,
        body.isBlackout === undefined ? current.is_blackout : body.isBlackout ? 1 : 0,
        body.note === undefined ? current.note : asString(body.note),
        now,
        id
      )
      .run();
    const row = await db.prepare("SELECT * FROM availability_windows WHERE id = ?").bind(id).first();
    return json({ availabilityWindow: normalizeWindow(row) });
  } catch (error) {
    return errorResponse("Unable to update availability.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListAppointments(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db
      .prepare("SELECT * FROM appointments ORDER BY start_at DESC LIMIT 100")
      .all();
    return json({ appointments: (result.results || []).map(normalizeAppointment) });
  } catch (error) {
    return errorResponse("Unable to load appointments.", 500, {
      detail: error.message,
    });
  }
}
