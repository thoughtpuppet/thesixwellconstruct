import {
  notifyAppointmentCancelled,
  notifyAppointmentConfirmed,
  notifyBookingLinkCreated,
} from "../notifications/_lib.js";

const BOOKING_STATUSES = new Set([
  "pending_deposit",
  "deposit_pending",
  "confirmed",
  "cancelled",
  "archived",
]);

const PUBLIC_CONSULTATION_BOOKING_TYPE_IDS = ["consult_in_person", "build_in_person", "consult_virtual"];
const VIRTUAL_CONSULTATION_BOOKING_TYPE_ID = "consult_virtual";

// Studio bookings (open visits / private gatherings / external rentals) are
// deposit-based and route to a dedicated Square location, but otherwise reuse
// the tattoo deposit appointment pipeline.
const STUDIO_BOOKING_TYPE_IDS = ["studio_visit", "studio_gathering", "studio_rental"];

const SCHEDULE_CATEGORY_BOOKING_TYPE_IDS = {
  tattooing: ["tattoo_quarter", "tattoo_half", "tattoo_full"],
  consultation: ["consult_in_person", "consult_virtual", "build_in_person"],
  studio: STUDIO_BOOKING_TYPE_IDS,
};

// Consultation and build-session bookings charge their full fee up front, not a deposit toward a future session.
const FULL_PAYMENT_BOOKING_TYPE_IDS = ["consult_in_person", "consult_virtual", "build_in_person"];

const CONFIRMATION_PATHS = {
  consult_in_person: "/booking/confirmed/consultation/",
  consult_virtual: "/booking/confirmed/virtual-consultation/",
  build_in_person: "/booking/confirmed/build/",
  studio_visit: "/booking/confirmed/studio/",
  studio_gathering: "/booking/confirmed/studio/",
  studio_rental: "/booking/confirmed/studio/",
};

function confirmationPathForBookingType(bookingTypeId) {
  return CONFIRMATION_PATHS[bookingTypeId] || "/booking/confirmed/";
}

const DEFAULT_SUPPORT_EMAIL = "saisolehamn@artpilltattoohouse.com";
const DEFAULT_STUDIO_CALENDAR_LOCATION = "364 Nelson Street SW, Atlanta, GA 30313";
const DEFAULT_STUDIO_CONTACT_PHONE = "(770) 820-5800";
const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";

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

function parseTipCents(value) {
  if (value === undefined || value === null || value === "") return { tipCents: 0 };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { error: "Tip must be a whole dollar-and-cent amount." };
  }
  if (parsed < 0) return { error: "Tip cannot be negative." };
  if (parsed > 50000) return { error: "Tip cannot be more than $500." };
  return { tipCents: parsed };
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

function normalizeWalkInWindow(row) {
  return {
    id: row.id,
    venture: row.venture || "tattooing",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    title: row.title || "Walk-in Window",
    note: row.note || "",
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMeeting(row) {
  if (!row || !row.meeting_provider) return null;
  return {
    provider: row.meeting_provider,
    providerMeetingId: row.provider_meeting_id || "",
    joinUrl: row.meeting_join_url || "",
    password: row.meeting_password || "",
    createdAt: row.meeting_created_at || "",
    updatedAt: row.meeting_updated_at || "",
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
    category: row.category || "tattooing",
  };
}

function normalizeAppointment(row) {
  return {
    id: row.id,
    submissionId: row.submission_id || "",
    bookingTokenId: row.booking_token_id || "",
    bookingTypeId: row.booking_type_id,
    bookingTypeLabel: row.booking_type_label || row.bookingTypeLabel || "",
    availabilityWindowId: row.availability_window_id || "",
    status: row.status,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone || "",
    startAt: row.start_at,
    endAt: row.end_at,
    depositCents: row.deposit_cents,
    tipCents: row.tip_cents || 0,
    totalDueCents: row.deposit_cents + (row.tip_cents || 0),
    currency: row.currency || "USD",
    squareOrderId: row.square_order_id || "",
    squarePaymentLinkId: row.square_payment_link_id || "",
    squareCheckoutUrl: row.square_checkout_url || "",
    meeting: normalizeMeeting(row),
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

function publicBaseUrl(env, request) {
  if (env.PUBLIC_SITE_URL) return String(env.PUBLIC_SITE_URL).replace(/\/+$/g, "");
  return baseUrlFromRequest(request);
}

function publicUrl(env, request, path) {
  return `${publicBaseUrl(env, request)}${path}`;
}

function studioCalendarLocation(env) {
  return asString(env.STUDIO_CALENDAR_LOCATION) || DEFAULT_STUDIO_CALENDAR_LOCATION;
}

function studioContactPhone(env) {
  return asString(env.STUDIO_CONTACT_PHONE) || DEFAULT_STUDIO_CONTACT_PHONE;
}

function studioContactEmail(env) {
  return asString(env.NOTIFICATION_REPLY_TO) || DEFAULT_SUPPORT_EMAIL;
}

function appointmentConfirmationUrl(env, request, appointment) {
  const path = confirmationPathForBookingType(appointment.bookingTypeId || appointment.booking_type_id);
  return `${publicBaseUrl(env, request)}${path}?appointment=${encodeURIComponent(appointment.id)}`;
}

function appointmentCalendarUrl(env, request, appointment) {
  return `${publicBaseUrl(env, request)}/api/booking/calendar?appointment=${encodeURIComponent(appointment.id)}`;
}

function isVirtualAppointment(appointment) {
  return (appointment.bookingTypeId || appointment.booking_type_id) === VIRTUAL_CONSULTATION_BOOKING_TYPE_ID;
}

function icsDate(value) {
  const date = new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsLocalDate(value, timeZone = DEFAULT_CALENDAR_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}T${map.hour}${map.minute}${map.second}`;
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line) {
  const parts = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function icsProperty(name, value) {
  return foldIcsLine(`${name}:${icsEscape(value)}`);
}

function appointmentResourceUrls(env, request) {
  return {
    bookingTermsUrl: publicUrl(env, request, "/tattoos/policies/"),
    dayOfInstructionsUrl: publicUrl(env, request, "/tattoos/day-of/"),
    locationParkingUrl: publicUrl(env, request, "/tattoos/location-parking/"),
  };
}

function appointmentCalendarDescription(env, request, appointment) {
  const resources = appointmentResourceUrls(env, request);
  const virtual = isVirtualAppointment(appointment);
  const lines = [
    "Point of contact: art.pill TATTOO HOUSE",
    `Email: ${studioContactEmail(env)}`,
    `Phone: ${studioContactPhone(env)}`,
    "",
    `Manage / cancel / reschedule: ${appointmentConfirmationUrl(env, request, appointment)}`,
    `Add to calendar: ${appointmentCalendarUrl(env, request, appointment)}`,
    `Booking policies: ${resources.bookingTermsUrl}`,
  ];

  if (virtual) {
    lines.push(`Zoom link: ${appointment.meeting?.joinUrl || ""}`);
  } else {
    lines.push(`Studio address: ${studioCalendarLocation(env)}`);
    lines.push(`Day-of prep: ${resources.dayOfInstructionsUrl}`);
    lines.push(`Location & parking: ${resources.locationParkingUrl}`);
  }

  return lines.join("\n");
}

function appointmentCalendarLocation(env, appointment) {
  if (isVirtualAppointment(appointment) && appointment.meeting?.joinUrl) {
    return appointment.meeting.joinUrl;
  }
  return studioCalendarLocation(env);
}

function buildAppointmentIcs(env, request, appointment) {
  const label = appointment.bookingTypeLabel || "Tattoo session";
  const summary = `art.pill TATTOO HOUSE - ${label}`;
  const confirmationUrl = appointmentConfirmationUrl(env, request, appointment);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Six Well Construct//Art.Pill Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    icsProperty("X-WR-TIMEZONE", DEFAULT_CALENDAR_TIME_ZONE),
    "BEGIN:VEVENT",
    icsProperty("UID", `${appointment.id}@thesixwellconstruct.com`),
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    foldIcsLine(`DTSTART;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.startAt)}`),
    foldIcsLine(`DTEND;TZID=${DEFAULT_CALENDAR_TIME_ZONE}:${icsLocalDate(appointment.endAt)}`),
    icsProperty("SUMMARY", summary),
    icsProperty("LOCATION", appointmentCalendarLocation(env, appointment)),
    icsProperty("DESCRIPTION", appointmentCalendarDescription(env, request, appointment)),
    icsProperty("URL", confirmationUrl),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.join("\r\n");
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
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
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

      const allowedTypeIds = SCHEDULE_CATEGORY_BOOKING_TYPE_IDS[rule.category] || SCHEDULE_CATEGORY_BOOKING_TYPE_IDS.tattooing;
      for (const bookingType of bookingTypes.filter((type) => allowedTypeIds.includes(type.id))) {
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

async function createPendingAppointment(db, tokenContext, bookingTypeId, windowId, tipCents = 0) {
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType) return { error: "Unknown booking type." };

  const allowed = new Set(tokenContext.allowedBookingTypes || []);
  if (allowed.size && !allowed.has(bookingType.id)) {
    return { error: "This booking link does not include that session type." };
  }

  const existingForSelection = await db
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
  if (existingForSelection) {
    return {
      appointment: normalizeAppointment(existingForSelection),
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const existingForToken = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_token_id = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(tokenContext.token.id)
    .first();
  if (existingForToken) {
    return {
      error: "This booking link already has a pending appointment. Continue with the existing Square checkout link or reply to the studio if you need a different time.",
      appointment: normalizeAppointment(existingForToken),
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
        deposit_cents, tip_cents, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      tipCents,
      bookingType.currency || "USD",
      now,
      now
    )
    .run();

  const appointment = await selectAppointmentWithMeeting(db, id);
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

async function publicConsultationBookingTypes(db, requestedTypeIds = PUBLIC_CONSULTATION_BOOKING_TYPE_IDS) {
  const ids = requestedTypeIds.filter((id) => PUBLIC_CONSULTATION_BOOKING_TYPE_IDS.includes(id));
  const allowedIds = ids.length ? ids : PUBLIC_CONSULTATION_BOOKING_TYPE_IDS;
  const placeholders = allowedIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE id IN (${placeholders}) AND active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .bind(...allowedIds)
    .all();
  return (result.results || []).map(normalizeBookingType);
}

async function listPublicWalkInWindows(db) {
  const result = await db
    .prepare(
      `SELECT * FROM walk_in_windows
       WHERE venture = ? AND active = 1 AND ends_at > ?
       ORDER BY starts_at ASC
       LIMIT 25`
    )
    .bind("tattooing", new Date().toISOString())
    .all();
  return (result.results || []).map(normalizeWalkInWindow);
}

export async function handlePublicConsultationContext(request, env) {
  try {
    const db = requireBookingDb(env);
    const requestedTypes = new URL(request.url).searchParams.getAll("type");
    const bookingTypes = await publicConsultationBookingTypes(db, requestedTypes);
    if (!bookingTypes.length) {
      return errorResponse("Public consultation booking is not configured.", 503);
    }
    const windows = await listPublicWindows(db, bookingTypes);
    const walkInWindows = await listPublicWalkInWindows(db);
    return json({
      ok: true,
      bookingType: bookingTypes[0],
      bookingTypes,
      availabilityWindows: windows,
      walkInWindows,
    });
  } catch (error) {
    return errorResponse("Unable to load consultation availability.", 500, {
      detail: error.message,
    });
  }
}

function publicClientFromBody(body) {
  const firstName = asString(body.firstName || body.first_name);
  const lastName = asString(body.lastName || body.last_name);
  const name = asString(body.name) || [firstName, lastName].filter(Boolean).join(" ").trim();
  return {
    name,
    email: asString(body.email).toLowerCase(),
    phone: asOptionalString(body.phone),
    direction: asOptionalString(body.direction),
    understand: asString(body.understand),
  };
}

function validatePublicConsultation(body) {
  if (asString(body._gotcha)) return { spam: true };
  const client = publicClientFromBody(body);
  if (!client.name) return { error: "Name is required." };
  if (!client.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    return { error: "A valid email is required." };
  }
  if (client.understand !== "yes") {
    return { error: "Consultation acknowledgement is required." };
  }
  if (!PUBLIC_CONSULTATION_BOOKING_TYPE_IDS.includes(asString(body.bookingTypeId))) {
    return { error: "Please select a public consultation session type." };
  }
  if (!asString(body.availabilityWindowId)) {
    return { error: "Please select an available consultation time." };
  }
  return { client };
}

function submissionRequiresConsultation(submission) {
  const payload = parseJsonField(submission.payload_json, {});
  return payload.project_type === "large_cover_up" || payload.consult_required === "yes";
}

async function createPublicConsultationSubmission(db, body, client, bookingType) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const payload = {
    type: "consultation",
    source_path: "/tattoos/inquire/consultation/",
    subject: "New Art.Pill Consultation Booking Request",
    firstName: asString(body.firstName || body.first_name),
    lastName: asString(body.lastName || body.last_name),
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    direction: client.direction || "",
    preferred_slots: asString(body.preferred_slots || body.preferredSlots),
    availability_window_id: asString(body.availabilityWindowId),
    booking_type_id: bookingType.id,
    booking_type_label: bookingType.label,
    deposit_label: formatMoney(bookingType.deposit_cents, bookingType.currency || "USD"),
    understand: client.understand,
  };
  const contact = {
    name: client.name,
    email: client.email,
    phone: client.phone || "",
  };

  await db
    .prepare(
      `INSERT INTO submissions (
        id, type, status, source_path, subject, contact_name, contact_email,
        contact_phone, contact_json, payload_json, request_meta_json,
        files_json, internal_notes, booking_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      "consultation",
      "approved",
      "/tattoos/inquire/consultation/",
      payload.subject,
      client.name,
      client.email,
      client.phone || null,
      JSON.stringify(contact),
      JSON.stringify(payload),
      JSON.stringify({ publicBooking: true }),
      "[]",
      client.direction || "",
      "",
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
    .bind(
      crypto.randomUUID(),
      id,
      "created",
      "system",
      "Created from public consultation checkout.",
      now
    )
    .run();

  return id;
}

async function createPublicConsultationAppointment(db, body) {
  const bookingTypeId = asString(body.bookingTypeId);
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType || !PUBLIC_CONSULTATION_BOOKING_TYPE_IDS.includes(bookingType.id)) {
    return { error: "Public consultation booking is not configured." };
  }

  const validation = validatePublicConsultation(body);
  if (validation.spam) return { spam: true };
  if (validation.error) return validation;

  const windowId = asString(body.availabilityWindowId);
  const existingForClient = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_type_id = ?
         AND availability_window_id = ?
         AND lower(client_email) = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(bookingType.id, windowId, validation.client.email)
    .first();
  if (existingForClient) {
    return {
      appointment: normalizeAppointment(existingForClient),
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const submissionId = await createPublicConsultationSubmission(
    db,
    body,
    validation.client,
    bookingType
  );
  await db
    .prepare(
      `INSERT INTO appointments (
        id, submission_id, booking_token_id, booking_type_id, availability_window_id,
        status, client_name, client_email, client_phone, start_at, end_at,
        deposit_cents, tip_cents, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      submissionId,
      null,
      bookingType.id,
      availability.window.id,
      "pending_deposit",
      validation.client.name,
      validation.client.email,
      validation.client.phone,
      availability.window.start_at,
      availability.window.end_at,
      bookingType.deposit_cents,
      0,
      bookingType.currency || "USD",
      now,
      now
    )
    .run();

  const appointment = await selectAppointmentWithMeeting(db, id);
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

export async function handlePublicConsultationCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const result = await createPublicConsultationAppointment(db, body);
    if (result.spam) return json({ ok: true, spam: true });
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
          amount_cents, tip_cents, currency, status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        result.appointment.id,
        "square",
        paymentLink.id || null,
        paymentLink.order_id || null,
        result.appointment.depositCents,
        0,
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
    return errorResponse("Unable to start consultation checkout.", 500, {
      detail: error.message,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Public studio booking (open visits / gatherings / external rentals) */
/* Mirrors the public consultation pipeline; deposits route to the      */
/* dedicated studio Square location via createSquarePaymentLink.         */
/* ------------------------------------------------------------------ */

async function studioBookingTypes(db, requestedTypeIds = STUDIO_BOOKING_TYPE_IDS) {
  const ids = (requestedTypeIds || []).filter((id) => STUDIO_BOOKING_TYPE_IDS.includes(id));
  const allowedIds = ids.length ? ids : STUDIO_BOOKING_TYPE_IDS;
  const placeholders = allowedIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM booking_types
       WHERE id IN (${placeholders}) AND active = 1
       ORDER BY sort_order ASC, label ASC`
    )
    .bind(...allowedIds)
    .all();
  return (result.results || []).map(normalizeBookingType);
}

function studioClientFromBody(body) {
  const firstName = asString(body.firstName || body.first_name);
  const lastName = asString(body.lastName || body.last_name);
  const name = asString(body.name) || [firstName, lastName].filter(Boolean).join(" ").trim();
  return {
    name,
    email: asString(body.email).toLowerCase(),
    phone: asOptionalString(body.phone),
    organization: asOptionalString(body.organization),
    details: asOptionalString(body.details || body.message),
    understand: asString(body.understand),
  };
}

function validatePublicStudio(body) {
  if (asString(body._gotcha)) return { spam: true };
  const client = studioClientFromBody(body);
  if (!client.name) return { error: "Name is required." };
  if (!client.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    return { error: "A valid email is required." };
  }
  if (client.understand !== "yes") {
    return { error: "Please acknowledge the studio booking terms." };
  }
  if (!STUDIO_BOOKING_TYPE_IDS.includes(asString(body.bookingTypeId))) {
    return { error: "Please select a studio booking type." };
  }
  if (!asString(body.availabilityWindowId)) {
    return { error: "Please select an available time." };
  }
  return { client };
}

export async function handlePublicStudioContext(request, env) {
  try {
    const db = requireBookingDb(env);
    const requestedTypes = new URL(request.url).searchParams.getAll("type");
    const bookingTypes = await studioBookingTypes(db, requestedTypes);
    if (!bookingTypes.length) {
      return errorResponse("Studio booking is not configured.", 503);
    }
    const windows = await listPublicWindows(db, bookingTypes);
    return json({
      ok: true,
      bookingType: bookingTypes[0],
      bookingTypes,
      availabilityWindows: windows,
      walkInWindows: [],
    });
  } catch (error) {
    return errorResponse("Unable to load studio availability.", 500, {
      detail: error.message,
    });
  }
}

async function createPublicStudioSubmission(db, body, client, bookingType) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const payload = {
    type: "studio_booking",
    source_path: "/booking/studio/",
    subject: "New Studio Booking Request",
    firstName: asString(body.firstName || body.first_name),
    lastName: asString(body.lastName || body.last_name),
    name: client.name,
    email: client.email,
    phone: client.phone || "",
    organization: client.organization || "",
    details: client.details || "",
    availability_window_id: asString(body.availabilityWindowId),
    booking_type_id: bookingType.id,
    booking_type_label: bookingType.label,
    deposit_label: formatMoney(bookingType.deposit_cents, bookingType.currency || "USD"),
    understand: client.understand,
  };
  const contact = {
    name: client.name,
    email: client.email,
    phone: client.phone || "",
  };

  await db
    .prepare(
      `INSERT INTO submissions (
        id, type, status, source_path, subject, contact_name, contact_email,
        contact_phone, contact_json, payload_json, request_meta_json,
        files_json, internal_notes, booking_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      "studio_booking",
      "approved",
      "/booking/studio/",
      payload.subject,
      client.name,
      client.email,
      client.phone || null,
      JSON.stringify(contact),
      JSON.stringify(payload),
      JSON.stringify({ publicBooking: true }),
      "[]",
      client.details || "",
      "",
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
    .bind(
      crypto.randomUUID(),
      id,
      "created",
      "system",
      "Created from public studio booking checkout.",
      now
    )
    .run();

  return id;
}

async function createPublicStudioAppointment(db, body) {
  const bookingTypeId = asString(body.bookingTypeId);
  const bookingType = await db
    .prepare("SELECT * FROM booking_types WHERE id = ? AND active = 1")
    .bind(bookingTypeId)
    .first();
  if (!bookingType || !STUDIO_BOOKING_TYPE_IDS.includes(bookingType.id)) {
    return { error: "Studio booking is not configured." };
  }

  const validation = validatePublicStudio(body);
  if (validation.spam) return { spam: true };
  if (validation.error) return validation;

  const windowId = asString(body.availabilityWindowId);
  const existingForClient = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE booking_type_id = ?
         AND availability_window_id = ?
         AND lower(client_email) = ?
         AND status IN ('pending_deposit', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(bookingType.id, windowId, validation.client.email)
    .first();
  if (existingForClient) {
    return {
      appointment: normalizeAppointment(existingForClient),
      bookingType: normalizeBookingType(bookingType),
      existing: true,
    };
  }

  const availability = await ensureAvailable(db, windowId, bookingType.id);
  if (availability.error) return availability;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const submissionId = await createPublicStudioSubmission(
    db,
    body,
    validation.client,
    bookingType
  );
  await db
    .prepare(
      `INSERT INTO appointments (
        id, submission_id, booking_token_id, booking_type_id, availability_window_id,
        status, client_name, client_email, client_phone, start_at, end_at,
        deposit_cents, tip_cents, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      submissionId,
      null,
      bookingType.id,
      availability.window.id,
      "pending_deposit",
      validation.client.name,
      validation.client.email,
      validation.client.phone,
      availability.window.start_at,
      availability.window.end_at,
      bookingType.deposit_cents,
      0,
      bookingType.currency || "USD",
      now,
      now
    )
    .run();

  const appointment = await selectAppointmentWithMeeting(db, id);
  return { appointment: normalizeAppointment(appointment), bookingType: normalizeBookingType(bookingType) };
}

export async function handlePublicStudioCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const result = await createPublicStudioAppointment(db, body);
    if (result.spam) return json({ ok: true, spam: true });
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
          amount_cents, tip_cents, currency, status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        result.appointment.id,
        "square",
        paymentLink.id || null,
        paymentLink.order_id || null,
        result.appointment.depositCents,
        0,
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
    return errorResponse("Unable to start studio booking checkout.", 500, {
      detail: error.message,
    });
  }
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

function isStudioBookingType(bookingTypeId) {
  return STUDIO_BOOKING_TYPE_IDS.includes(bookingTypeId);
}

// Studio bookings settle to a dedicated Square location (own bank/EIN) while
// sharing the same Square API token — the same isolation events use.
function squareLocationForBookingType(env, bookingTypeId) {
  return isStudioBookingType(bookingTypeId)
    ? asString(env.SQUARE_STUDIO_LOCATION_ID)
    : asString(env.SQUARE_LOCATION_ID);
}

function squareConfiguredForBookingType(env, bookingTypeId) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && squareLocationForBookingType(env, bookingTypeId));
}

function readinessItem(id, label, ready, message, details = {}) {
  return {
    id,
    label,
    ready: Boolean(ready),
    status: ready ? "ready" : "needs_attention",
    message,
    details,
  };
}

function requiredPositiveSetting(settings, key) {
  return Number(settings?.[key] || 0) > 0;
}

async function tableReady(db, tableName) {
  try {
    await db.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

function squareWebhookNotificationUrl(request, env) {
  return asString(env.SQUARE_WEBHOOK_NOTIFICATION_URL) || `${baseUrlFromRequest(request)}/api/square/webhook`;
}

function studioSquareWebhookNotificationUrl(request, env) {
  return asString(env.SQUARE_STUDIO_WEBHOOK_NOTIFICATION_URL) || `${baseUrlFromRequest(request)}/api/square-studio/webhook`;
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function squareWebhookSignature(rawBody, signatureKey, notificationUrl) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${notificationUrl}${rawBody}`)
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifySquareSignature(request, rawBody, signatureKey, notificationUrl) {
  if (!signatureKey) return { ok: false, status: 503, error: "Square webhook is not configured." };
  const squareSignature = request.headers.get("x-square-hmacsha256-signature") || "";
  const expected = await squareWebhookSignature(rawBody, signatureKey, notificationUrl);
  if (!timingSafeEqual(expected, squareSignature)) {
    return { ok: false, status: 403, error: "Invalid Square webhook signature." };
  }
  return { ok: true };
}

async function verifySquareWebhookRequest(request, env, rawBody) {
  return verifySquareSignature(
    request,
    rawBody,
    asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    squareWebhookNotificationUrl(request, env)
  );
}

async function verifyStudioSquareWebhookRequest(request, env, rawBody) {
  return verifySquareSignature(
    request,
    rawBody,
    asString(env.SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY),
    studioSquareWebhookNotificationUrl(request, env)
  );
}

function squareMoney(amount, currency) {
  return {
    amount,
    currency,
  };
}

function squareLineItem(name, amount, currency) {
  return {
    name,
    quantity: "1",
    base_price_money: squareMoney(amount, currency),
  };
}

async function createSquarePaymentLink(request, env, appointment, bookingType) {
  if (!squareConfiguredForBookingType(env, bookingType.id)) {
    throw new Error("Square is not configured.");
  }

  const redirectUrl = new URL(confirmationPathForBookingType(bookingType.id), baseUrlFromRequest(request));
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
      order: {
        location_id: squareLocationForBookingType(env, bookingType.id),
        line_items: [
          squareLineItem(
            FULL_PAYMENT_BOOKING_TYPE_IDS.includes(bookingType.id)
              ? `${bookingType.label} Reservation Fee`
              : `${bookingType.label} Deposit`,
            appointment.depositCents,
            appointment.currency,
          ),
          ...(appointment.tipCents > 0
            ? [squareLineItem("Optional Artist Tip", appointment.tipCents, appointment.currency)]
            : []),
        ],
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

async function selectAppointmentWithMeeting(db, appointmentId) {
  return db
    .prepare(
      `SELECT a.*, bt.label AS booking_type_label,
              am.provider AS meeting_provider,
              am.provider_meeting_id,
              am.join_url AS meeting_join_url,
              am.password AS meeting_password,
              am.created_at AS meeting_created_at,
              am.updated_at AS meeting_updated_at
       FROM appointments a
       LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
       LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
       WHERE a.id = ?`
    )
    .bind(appointmentId)
    .first();
}

function zoomConfigured(env) {
  return Boolean(
    asString(env.ZOOM_ACCOUNT_ID) &&
    asString(env.ZOOM_CLIENT_ID) &&
    asString(env.ZOOM_CLIENT_SECRET) &&
    asString(env.ZOOM_HOST_USER_ID)
  );
}

function zoomBasicAuth(env) {
  return btoa(`${asString(env.ZOOM_CLIENT_ID)}:${asString(env.ZOOM_CLIENT_SECRET)}`);
}

async function createZoomAccessToken(env) {
  if (!zoomConfigured(env)) {
    throw new Error("Zoom is not configured.");
  }
  const body = new URLSearchParams();
  body.set("grant_type", "account_credentials");
  body.set("account_id", asString(env.ZOOM_ACCOUNT_ID));

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${zoomBasicAuth(env)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.reason || payload.error_description || payload.message || "Zoom OAuth failed.");
  }
  if (!payload.access_token) {
    throw new Error("Zoom OAuth did not return an access token.");
  }
  return payload.access_token;
}

function appointmentDurationMinutes(appointment, bookingType) {
  const configured = Number(bookingType.durationMinutes || bookingType.duration_minutes || 0);
  if (configured > 0) return configured;
  const diff = new Date(appointment.endAt || appointment.end_at).getTime() - new Date(appointment.startAt || appointment.start_at).getTime();
  return Math.max(1, Math.round(diff / 60000));
}

async function createZoomMeeting(env, appointment, bookingType) {
  const token = await createZoomAccessToken(env);
  const host = encodeURIComponent(asString(env.ZOOM_HOST_USER_ID));
  const clientName = appointment.clientName || appointment.client_name || "Client";
  const label = bookingType.label || bookingType.booking_type_label || "Virtual Consultation";
  const response = await fetch(`https://api.zoom.us/v2/users/${host}/meetings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: `${label} - ${clientName}`,
      type: 2,
      start_time: appointment.startAt || appointment.start_at,
      duration: appointmentDurationMinutes(appointment, bookingType),
      timezone: "America/New_York",
      agenda: "Virtual consultation booked through The Six Well Construct.",
      password: "",
      settings: {
        waiting_room: true,
        join_before_host: false,
        approval_type: 2,
        registrants_email_notification: false,
        meeting_authentication: false,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.reason || "Zoom meeting creation failed.");
  }
  if (!payload.join_url) {
    throw new Error("Zoom meeting did not return a join URL.");
  }
  return payload;
}

async function saveAppointmentMeeting(db, appointmentId, meeting) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO appointment_meetings (
        id, appointment_id, provider, provider_meeting_id, join_url, password,
        raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appointment_id, provider) DO UPDATE SET
        provider_meeting_id = excluded.provider_meeting_id,
        join_url = excluded.join_url,
        password = excluded.password,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at`
    )
    .bind(
      crypto.randomUUID(),
      appointmentId,
      "zoom",
      asString(meeting.id || meeting.uuid),
      asString(meeting.join_url),
      asString(meeting.password),
      JSON.stringify(meeting),
      now,
      now
    )
    .run();
}

async function createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType) {
  if ((bookingType.id || bookingType.booking_type_id) !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) {
    return null;
  }
  const meeting = await createZoomMeeting(env, appointment, bookingType);
  await saveAppointmentMeeting(db, appointment.id, meeting);
  return meeting;
}

// Creates the Zoom meeting only after payment is confirmed, so a failed/abandoned
// checkout never leaves an orphaned meeting on the host's Zoom account.
async function maybeCreateVirtualMeeting(db, env, appointmentRow) {
  if (appointmentRow.booking_type_id !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) return;
  if (appointmentRow.meeting_provider) return;

  const bookingTypeRow = await db
    .prepare("SELECT label, duration_minutes, currency FROM booking_types WHERE id = ?")
    .bind(appointmentRow.booking_type_id)
    .first();
  const appointment = normalizeAppointment(appointmentRow);
  const bookingType = {
    id: appointmentRow.booking_type_id,
    label: bookingTypeRow?.label || "Virtual Consultation",
    durationMinutes: bookingTypeRow?.duration_minutes || 0,
    currency: bookingTypeRow?.currency || "USD",
  };

  try {
    await createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType);
  } catch (error) {
    console.warn("Unable to create Zoom meeting for confirmed appointment.", appointment.id, error.message);
  }
}

async function deleteZoomMeeting(env, providerMeetingId) {
  if (!providerMeetingId || !zoomConfigured(env)) return;
  try {
    const token = await createZoomAccessToken(env);
    await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(providerMeetingId)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch (error) {
    console.warn("Unable to delete Zoom meeting.", providerMeetingId, error.message);
  }
}

export async function handleCreateBookingCheckout(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const context = await loadTokenContext(db, asString(body.token));
    if (!context) return errorResponse("A private booking link is required.", 401);
    if (context.invalid) return errorResponse(context.invalid, 403);

    const tip = parseTipCents(body.tipCents);
    if (tip.error) return errorResponse(tip.error, 400);

    const result = await createPendingAppointment(
      db,
      context,
      asString(body.bookingTypeId),
      asString(body.availabilityWindowId),
      tip.tipCents
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
          amount_cents, tip_cents, currency, status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        result.appointment.id,
        "square",
        paymentLink.id || null,
        paymentLink.order_id || null,
        result.appointment.depositCents + result.appointment.tipCents,
        result.appointment.tipCents,
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

async function confirmPaidAppointment(db, env, request, appointmentRow, order, paymentId = "") {
  let appointment = normalizeAppointment(appointmentRow);
  const now = new Date().toISOString();
  const wasConfirmed = appointment.status === "confirmed";

  await db
    .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
    .bind("confirmed", now, appointment.id)
    .run();
  await db
    .prepare(
      `UPDATE deposit_payments
       SET status = ?, provider_payment_id = COALESCE(?, provider_payment_id),
           raw_json = ?, updated_at = ?
       WHERE appointment_id = ?`
    )
    .bind("paid", paymentId || null, JSON.stringify(order || {}), now, appointment.id)
    .run();
  if (appointment.bookingTokenId) {
    await db
      .prepare("UPDATE booking_tokens SET used_at = COALESCE(used_at, ?), updated_at = ? WHERE id = ?")
      .bind(now, now, appointment.bookingTokenId)
      .run();
  }
  if (appointment.submissionId) {
    await db
      .prepare(
        `UPDATE submissions
         SET status = ?, booking_url = ?, updated_at = ?
         WHERE id = ? AND status IN ('approved', 'booked')`
      )
      .bind("booked", `${confirmationPathForBookingType(appointment.bookingTypeId)}?appointment=${appointment.id}`, now, appointment.submissionId)
      .run();
  }

  if (!wasConfirmed) {
    const appointmentWithMeeting = await selectAppointmentWithMeeting(db, appointment.id);
    await maybeCreateVirtualMeeting(db, env, appointmentWithMeeting || appointmentRow);
    const appointmentWithType = await selectAppointmentWithMeeting(db, appointment.id);
    await notifyAppointmentConfirmed(env, request, appointmentWithType || appointmentRow);
  }

  const updated = await selectAppointmentWithMeeting(db, appointment.id);
  return normalizeAppointment(updated || appointmentRow);
}

export async function handleConfirmBooking(request, env) {
  try {
    const db = requireBookingDb(env);
    const appointmentId = new URL(request.url).searchParams.get("appointment") || "";
    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);

    let appointment = normalizeAppointment(appointmentRow);
    const order = await fetchSquareOrder(env, appointment.squareOrderId);
    const paid = orderLooksPaid(order);

    if (paid) appointment = await confirmPaidAppointment(db, env, request, appointmentRow, order);

    const hoursUntilStart = (new Date(appointment.startAt).getTime() - Date.now()) / (60 * 60 * 1000);

    return json({
      ok: true,
      appointment,
      depositStatus: paid ? "paid" : "pending",
      supportEmail: env.NOTIFICATION_REPLY_TO || DEFAULT_SUPPORT_EMAIL,
      hoursUntilStart,
    });
  } catch (error) {
    return errorResponse("Unable to confirm booking.", 500, {
      detail: error.message,
    });
  }
}

export async function handleBookingCalendar(request, env) {
  try {
    const db = requireBookingDb(env);
    const appointmentId = new URL(request.url).searchParams.get("appointment") || "";
    if (!appointmentId) return errorResponse("Appointment reference is required.", 400);

    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);

    const appointment = normalizeAppointment(appointmentRow);
    if (appointment.status !== "confirmed") {
      return errorResponse("Calendar is available after payment confirmation.", 403);
    }
    if (isVirtualAppointment(appointment) && !appointment.meeting?.joinUrl) {
      return errorResponse("Calendar is available once the Zoom meeting is ready.", 409);
    }

    return new Response(buildAppointmentIcs(env, request, appointment), {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="art-pill-appointment.ics"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("Unable to create calendar event.", 500, {
      detail: error.message,
    });
  }
}

export async function handleCancelAppointment(request, env) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const appointmentId = asString(body.appointmentId);
    const email = asString(body.email).toLowerCase();
    if (!appointmentId || !email) {
      return errorResponse("Appointment id and email are required.", 400);
    }

    const appointmentRow = await selectAppointmentWithMeeting(db, appointmentId);
    if (!appointmentRow) return errorResponse("Appointment not found.", 404);
    if (asString(appointmentRow.client_email).toLowerCase() !== email) {
      return errorResponse("That email does not match this booking.", 403);
    }
    if (["cancelled", "archived"].includes(appointmentRow.status)) {
      return errorResponse("This appointment has already been cancelled.", 400);
    }
    if (new Date(appointmentRow.start_at).getTime() <= Date.now()) {
      return errorResponse("This appointment has already passed and cannot be cancelled online.", 400);
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
      .bind("cancelled", now, appointmentId)
      .run();

    if (appointmentRow.meeting_provider === "zoom" && appointmentRow.provider_meeting_id) {
      await deleteZoomMeeting(env, appointmentRow.provider_meeting_id);
      await db
        .prepare("DELETE FROM appointment_meetings WHERE appointment_id = ? AND provider = 'zoom'")
        .bind(appointmentId)
        .run();
    }

    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    const appointment = normalizeAppointment(updated || appointmentRow);
    await notifyAppointmentCancelled(env, request, updated || appointmentRow);

    const hoursUntilStart = (new Date(appointment.startAt).getTime() - Date.now()) / (60 * 60 * 1000);
    return json({ ok: true, appointment, hoursUntilStart });
  } catch (error) {
    return errorResponse("Unable to cancel appointment.", 500, {
      detail: error.message,
    });
  }
}

function webhookOrderId(payload) {
  const object = payload?.data?.object || {};
  return (
    asString(object.payment?.order_id) ||
    asString(object.payment?.orderId) ||
    asString(object.order?.id) ||
    asString(object.order_updated?.order_id) ||
    asString(object.order_updated?.orderId) ||
    asString(object.order_created?.order_id) ||
    asString(object.order_created?.orderId) ||
    asString(object.order_id) ||
    asString(object.orderId) ||
    asString(payload?.order_id)
  );
}

function webhookPaymentId(payload) {
  const object = payload?.data?.object || {};
  return asString(object.payment?.id) || asString(object.payment_id) || "";
}

function webhookLooksPaid(payload, order) {
  const payment = payload?.data?.object?.payment;
  return orderLooksPaid(order) || payment?.status === "COMPLETED";
}

async function processSquareWebhookPayload(request, env, rawBody) {
  const payload = JSON.parse(rawBody || "{}");
  const orderId = webhookOrderId(payload);
  if (!orderId) return json({ ok: true, ignored: true, reason: "No Square order id." });

  const db = requireBookingDb(env);
  const appointmentRow = await db
    .prepare("SELECT * FROM appointments WHERE square_order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(orderId)
    .first();
  if (!appointmentRow) return json({ ok: true, ignored: true, reason: "No matching appointment." });

  const order = await fetchSquareOrder(env, orderId);
  if (!webhookLooksPaid(payload, order)) {
    await db
      .prepare(
        `UPDATE deposit_payments
         SET status = ?, provider_payment_id = COALESCE(?, provider_payment_id),
             raw_json = ?, updated_at = ?
         WHERE appointment_id = ?`
      )
      .bind("pending", webhookPaymentId(payload) || null, JSON.stringify(order || payload), new Date().toISOString(), appointmentRow.id)
      .run();
    return json({ ok: true, paid: false, appointmentId: appointmentRow.id });
  }

  const appointment = await confirmPaidAppointment(
    db,
    env,
    request,
    appointmentRow,
    order || payload,
    webhookPaymentId(payload)
  );
  return json({ ok: true, paid: true, appointmentId: appointment.id });
}

export async function handleSquareWebhook(request, env) {
  try {
    const rawBody = await request.text();
    const signature = await verifySquareWebhookRequest(request, env, rawBody);
    if (!signature.ok) return errorResponse(signature.error, signature.status);
    return await processSquareWebhookPayload(request, env, rawBody);
  } catch (error) {
    return errorResponse("Unable to process Square webhook.", 500, {
      detail: error.message,
    });
  }
}

export async function handleStudioSquareWebhook(request, env) {
  try {
    const rawBody = await request.text();
    const signature = await verifyStudioSquareWebhookRequest(request, env, rawBody);
    if (!signature.ok) return errorResponse(signature.error, signature.status);
    return await processSquareWebhookPayload(request, env, rawBody);
  } catch (error) {
    return errorResponse("Unable to process studio Square webhook.", 500, {
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
      : submissionRequiresConsultation(submission)
        ? ["consult_in_person"]
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

    await notifyBookingLinkCreated(env, request, submission, {
      id,
      bookingUrl: bookingUrl.toString(),
      path: bookingUrl.pathname + bookingUrl.search,
      expiresAt,
      allowedBookingTypes: allowed,
    });

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
         ORDER BY category ASC, day_of_week ASC`
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

export async function handleAdminGetBookingReadiness(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const settingsRow = await db
      .prepare("SELECT * FROM booking_settings WHERE venture = ?")
      .bind("tattooing")
      .first();
    const settings = settingsRow ? normalizeSettings(settingsRow) : null;
    const rules = await db
      .prepare(
        `SELECT category, active FROM availability_rules
         WHERE venture = ?`
      )
      .bind("tattooing")
      .all();
    const bookingTypes = await db
      .prepare(
        `SELECT id, active, deposit_cents
         FROM booking_types
         WHERE venture = ?`
      )
      .bind("tattooing")
      .all();

    const activeRules = rules.results || [];
    const activeBookingTypes = bookingTypes.results || [];
    const activePublicBookingTypes = activeBookingTypes.filter(
      (type) => PUBLIC_CONSULTATION_BOOKING_TYPE_IDS.includes(type.id) && type.active
    );
    const hasConsultationRule = activeRules.some(
      (rule) => (rule.category || "tattooing") === "consultation" && rule.active
    );
    const appointmentMeetingsReady = await tableReady(db, "appointment_meetings");
    const squareWebhookUrl = squareWebhookNotificationUrl(request, env);
    const requiredSettingsReady = Boolean(
      settings &&
      asString(settings.timezone) &&
      requiredPositiveSetting(settings, "bookingHorizonDays") &&
      requiredPositiveSetting(settings, "slotIntervalMinutes") &&
      requiredPositiveSetting(settings, "maxBookingsPerDay") &&
      requiredPositiveSetting(settings, "defaultCapacity") &&
      activePublicBookingTypes.length > 0 &&
      hasConsultationRule
    );

    const checks = [
      readinessItem(
        "square_checkout",
        "Square checkout",
        squareConfigured(env),
        squareConfigured(env)
          ? `Checkout can create ${env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox"} Square payment links.`
          : "Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID.",
        {
          environment: env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
          hasAccessToken: Boolean(asString(env.SQUARE_ACCESS_TOKEN)),
          hasLocationId: Boolean(asString(env.SQUARE_LOCATION_ID)),
        }
      ),
      readinessItem(
        "square_webhook_signing",
        "Square webhook signing",
        Boolean(asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY)),
        asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY)
          ? "Webhook signature verification is configured."
          : "Missing SQUARE_WEBHOOK_SIGNATURE_KEY, so paid appointments cannot be trusted from Square webhooks.",
        {
          hasSignatureKey: Boolean(asString(env.SQUARE_WEBHOOK_SIGNATURE_KEY)),
          notificationUrl: squareWebhookUrl,
        }
      ),
      readinessItem(
        "zoom_credentials",
        "Zoom credentials",
        zoomConfigured(env) && appointmentMeetingsReady,
        zoomConfigured(env)
          ? appointmentMeetingsReady
            ? "Zoom Server-to-Server OAuth credentials and meeting storage are present."
            : "Zoom credentials are present, but the appointment_meetings migration is not available."
          : "Missing one or more Zoom Server-to-Server OAuth settings.",
        {
          hasAccountId: Boolean(asString(env.ZOOM_ACCOUNT_ID)),
          hasClientId: Boolean(asString(env.ZOOM_CLIENT_ID)),
          hasClientSecret: Boolean(asString(env.ZOOM_CLIENT_SECRET)),
          hasHostUserId: Boolean(asString(env.ZOOM_HOST_USER_ID)),
          appointmentMeetingsTable: appointmentMeetingsReady,
        }
      ),
      readinessItem(
        "booking_settings",
        "Booking settings",
        requiredSettingsReady,
        requiredSettingsReady
          ? "Booking settings, public consultation types, and consultation schedule are ready."
          : "Booking settings need a horizon, interval, daily limit, capacity, public consultation type, and active consultation hours.",
        {
          settings,
          publicConsultationTypes: activePublicBookingTypes.map((type) => ({
            id: type.id,
            depositCents: type.deposit_cents,
          })),
          activeConsultationRuleCount: activeRules.filter((rule) => (rule.category || "tattooing") === "consultation" && rule.active).length,
        }
      ),
    ];

    return json({
      ok: true,
      ready: checks.every((check) => check.ready),
      checkedAt: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    return errorResponse("Unable to load booking readiness.", 500, {
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

export async function handleAdminListWalkIns(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT * FROM walk_in_windows
         WHERE venture = ?
         ORDER BY
           CASE WHEN ends_at >= ? THEN 0 ELSE 1 END ASC,
           CASE WHEN ends_at >= ? THEN starts_at END ASC,
           CASE WHEN ends_at < ? THEN starts_at END DESC
         LIMIT 100`
      )
      .bind("tattooing", now, now, now)
      .all();
    return json({ walkInWindows: (result.results || []).map(normalizeWalkInWindow) });
  } catch (error) {
    return errorResponse("Unable to load walk-in windows.", 500, {
      detail: error.message,
    });
  }
}

function validateWalkInWindowBody(body, current = null) {
  const startsAt = body.startsAt === undefined ? current?.starts_at : asString(body.startsAt);
  const endsAt = body.endsAt === undefined ? current?.ends_at : asString(body.endsAt);
  if (!startsAt || !endsAt || new Date(startsAt).toString() === "Invalid Date" || new Date(endsAt).toString() === "Invalid Date") {
    return { error: "Valid startsAt and endsAt are required." };
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: "endsAt must be after startsAt." };
  }
  return {
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    title: body.title === undefined ? current?.title || "Walk-in Window" : asString(body.title) || "Walk-in Window",
    note: body.note === undefined ? current?.note || "" : asString(body.note),
    active: body.active === undefined ? current?.active ?? 1 : body.active ? 1 : 0,
  };
}

export async function handleAdminCreateWalkIn(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  const next = validateWalkInWindowBody(body);
  if (next.error) return errorResponse(next.error, 400);

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO walk_in_windows (
          id, venture, starts_at, ends_at, title, note, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, "tattooing", next.startsAt, next.endsAt, next.title, next.note, next.active, now, now)
      .run();
    const row = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    return json({ walkInWindow: normalizeWalkInWindow(row) });
  } catch (error) {
    return errorResponse("Unable to create walk-in window.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminUpdateWalkIn(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);

  try {
    const db = requireBookingDb(env);
    const current = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    if (!current) return errorResponse("Walk-in window not found.", 404);
    const next = validateWalkInWindowBody(body, current);
    if (next.error) return errorResponse(next.error, 400);
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE walk_in_windows
         SET starts_at = ?, ends_at = ?, title = ?, note = ?, active = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(next.startsAt, next.endsAt, next.title, next.note, next.active, now, id)
      .run();
    const row = await db.prepare("SELECT * FROM walk_in_windows WHERE id = ?").bind(id).first();
    return json({ walkInWindow: normalizeWalkInWindow(row) });
  } catch (error) {
    return errorResponse("Unable to update walk-in window.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminDeleteWalkIn(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db.prepare("DELETE FROM walk_in_windows WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return errorResponse("Walk-in window not found.", 404);
    return json({ ok: true, deletedId: id });
  } catch (error) {
    return errorResponse("Unable to delete walk-in window.", 500, {
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
    const startAt = body.startAt === undefined ? current.start_at : asString(body.startAt);
    const endAt = body.endAt === undefined ? current.end_at : asString(body.endAt);
    if (!startAt || !endAt || new Date(startAt).toString() === "Invalid Date" || new Date(endAt).toString() === "Invalid Date") {
      return errorResponse("Valid startAt and endAt are required.", 400);
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return errorResponse("endAt must be after startAt.", 400);
    }
    const next = {
      venture: current.venture || "tattooing",
      booking_type_id: body.bookingTypeId === undefined ? current.booking_type_id : asOptionalString(body.bookingTypeId),
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      capacity: Math.max(1, asPositiveInteger(body.capacity, current.capacity || 1)),
      buffer_before_minutes: body.bufferBeforeMinutes === undefined
        ? current.buffer_before_minutes
        : asPositiveInteger(body.bufferBeforeMinutes, 0),
      buffer_after_minutes: body.bufferAfterMinutes === undefined
        ? current.buffer_after_minutes
        : asPositiveInteger(body.bufferAfterMinutes, 0),
      is_blackout: body.isBlackout === undefined ? current.is_blackout : body.isBlackout ? 1 : 0,
      active: body.active === undefined ? current.active : body.active ? 1 : 0,
      note: body.note === undefined ? current.note : asString(body.note),
    };
    if (!next.is_blackout && next.active) {
      const existing = await db
        .prepare(
          `SELECT * FROM availability_windows
           WHERE active = 1 AND is_blackout = 0 AND venture = ? AND id != ?`
        )
        .bind(next.venture, id)
        .all();
      const candidateInterval = intervalWithBuffer(next);
      const conflicts = (existing.results || []).some((row) =>
        intervalsOverlap(candidateInterval, intervalWithBuffer(row))
      );
      if (conflicts) {
        return errorResponse("That window overlaps an existing active window or buffer.", 400);
      }
    }
    await db
      .prepare(
        `UPDATE availability_windows
         SET booking_type_id = ?, start_at = ?, end_at = ?, capacity = ?,
             buffer_before_minutes = ?, buffer_after_minutes = ?,
             active = ?, is_blackout = ?, note = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        next.booking_type_id,
        next.start_at,
        next.end_at,
        next.capacity,
        next.buffer_before_minutes,
        next.buffer_after_minutes,
        next.active,
        next.is_blackout,
        next.note,
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

export async function handleAdminDeleteAvailability(request, env, id) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const result = await db
      .prepare("DELETE FROM availability_windows WHERE id = ? AND id NOT LIKE 'gen:%'")
      .bind(id)
      .run();
    if (!result.meta?.changes) return errorResponse("Availability window not found.", 404);
    return json({ ok: true, deletedId: id });
  } catch (error) {
    return errorResponse("Unable to delete availability.", 500, {
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
      .prepare(
        `SELECT a.*, bt.label AS booking_type_label,
                am.provider AS meeting_provider,
                am.provider_meeting_id,
                am.join_url AS meeting_join_url,
                am.password AS meeting_password,
                am.created_at AS meeting_created_at,
                am.updated_at AS meeting_updated_at
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
         ORDER BY a.start_at DESC
         LIMIT 100`
      )
      .all();
    return json({ appointments: (result.results || []).map(normalizeAppointment) });
  } catch (error) {
    return errorResponse("Unable to load appointments.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminCreateAppointmentMeeting(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const row = await db
      .prepare(
        `SELECT a.*, bt.id AS booking_type_id, bt.label AS booking_type_label,
                bt.duration_minutes, bt.currency
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         WHERE a.id = ?`
      )
      .bind(appointmentId)
      .first();
    if (!row) return errorResponse("Appointment not found.", 404);
    if (row.booking_type_id !== VIRTUAL_CONSULTATION_BOOKING_TYPE_ID) {
      return errorResponse("Only virtual consultation appointments can receive Zoom meetings.", 400);
    }

    const appointment = normalizeAppointment(row);
    const bookingType = {
      id: row.booking_type_id,
      label: row.booking_type_label || "Virtual Consultation",
      durationMinutes: row.duration_minutes || 45,
      currency: row.currency || "USD",
    };
    await createOrReplaceZoomMeetingForAppointment(db, env, appointment, bookingType);
    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    return json({ appointment: normalizeAppointment(updated) });
  } catch (error) {
    return errorResponse("Unable to create Zoom meeting.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminReleasePendingAppointment(request, env, appointmentId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const row = await selectAppointmentWithMeeting(db, appointmentId);
    if (!row) return errorResponse("Appointment not found.", 404);
    if (!["pending_deposit", "deposit_pending"].includes(row.status)) {
      return errorResponse("Only pending checkout appointments can be released.", 400);
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?")
      .bind("cancelled", now, appointmentId)
      .run();
    await db
      .prepare("UPDATE deposit_payments SET status = ?, updated_at = ? WHERE appointment_id = ? AND status = ?")
      .bind("cancelled", now, appointmentId, "pending")
      .run();

    if (row.meeting_provider === "zoom" && row.provider_meeting_id) {
      await deleteZoomMeeting(env, row.provider_meeting_id);
      await db
        .prepare("DELETE FROM appointment_meetings WHERE appointment_id = ? AND provider = 'zoom'")
        .bind(appointmentId)
        .run();
    }

    const updated = await selectAppointmentWithMeeting(db, appointmentId);
    return json({ ok: true, appointment: normalizeAppointment(updated || row) });
  } catch (error) {
    return errorResponse("Unable to release pending checkout.", 500, {
      detail: error.message,
    });
  }
}

export async function handleAdminListSubmissionTokens(request, env, submissionId) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  try {
    const db = requireBookingDb(env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT id, created_at, expires_at, revoked_at, used_at, updated_at
         FROM booking_tokens WHERE submission_id = ? ORDER BY created_at DESC`
      )
      .bind(submissionId)
      .all();

    const tokens = (result.results || []).map((t) => ({
      id: t.id,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      revokedAt: t.revoked_at,
      usedAt: t.used_at,
      updatedAt: t.updated_at,
      state: t.used_at ? "used"
        : t.revoked_at ? "revoked"
        : (t.expires_at && t.expires_at < now) ? "expired"
        : "active",
    }));

    return json({ tokens });
  } catch (error) {
    return errorResponse("Unable to list submission tokens.", 500, { detail: error.message });
  }
}
