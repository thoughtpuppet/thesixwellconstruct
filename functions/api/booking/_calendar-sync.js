const PROVIDER = "icloud";
const CALDAV_ROOT = "https://caldav.icloud.com/";
const DESTINATION_CALENDAR_NAME = "art.pill Tattoo House";
const DEFAULT_TIME_ZONE = "America/New_York";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BUSY_INTERVALS = 2000;
const REQUEST_TIMEOUT_MS = 10000;
const LIVE_CHECK_FRESH_MS = 2 * 60 * 1000;
const STALE_WARNING_MS = 15 * 60 * 1000;
const SYNC_APPOINTMENT_PURPOSES = [
  "tattoo",
  "prerequisite_consultation",
  "standalone_consultation",
  "build_session",
];

function asString(value) {
  return value == null ? "" : String(value).trim();
}

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function errorResponse(error, status = 400, detail = {}) {
  return json({ error, ...detail }, { status });
}

function authTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return new URL(request.url).searchParams.get("token") || "";
}

function requireAdmin(request, env) {
  const expected = asString(env.SUBMISSIONS_ADMIN_TOKEN);
  if (!expected) return errorResponse("Admin booking is not configured.", 503);
  if (authTokenFromRequest(request) !== expected) return errorResponse("Unauthorized.", 401);
  return null;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function dbFor(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Booking database is not configured.");
  return env.SUBMISSIONS_DB;
}

function credentials(env) {
  return {
    username: asString(env.ICLOUD_CALDAV_USERNAME),
    password: asString(env.ICLOUD_CALDAV_APP_PASSWORD),
  };
}

function credentialsReady(env) {
  const value = credentials(env);
  return Boolean(value.username && value.password);
}

function isMissingSyncSchema(error) {
  return /no such table: (booking_calendar_sync_settings|booking_calendar_sync_runs|appointment_calendar_links|external_calendar_busy_sources)/i.test(error?.message || "");
}

function validIcloudHost(value) {
  const host = asString(value).toLowerCase().replace(/\.$/, "");
  return host === "caldav.icloud.com"
    || host.endsWith(".caldav.icloud.com")
    || host.endsWith("-caldav.icloud.com");
}

function safeIcloudUrl(value, base = CALDAV_ROOT) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || !validIcloudHost(url.hostname)) {
    throw new Error("iCloud returned an untrusted CalDAV location.");
  }
  url.hash = "";
  return url;
}

function basicAuthorization(env) {
  const value = credentials(env);
  if (!value.username || !value.password) throw new Error("iCloud CalDAV credentials are not configured.");
  return `Basic ${btoa(`${value.username}:${value.password}`)}`;
}

async function caldavFetch(env, input, init = {}, redirects = 0) {
  const url = safeIcloudUrl(input);
  const headers = new Headers(init.headers || {});
  headers.set("authorization", basicAuthorization(env));
  headers.set("user-agent", "SixWellConstruct-CalendarSync/1.0");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...init, headers, redirect: "manual", signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("iCloud CalDAV request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3) throw new Error("iCloud CalDAV redirected too many times.");
    const location = response.headers.get("location");
    if (!location) throw new Error("iCloud CalDAV returned a redirect without a location.");
    const redirected = safeIcloudUrl(location, url);
    return caldavFetch(env, redirected, init, redirects + 1);
  }
  return response;
}

async function boundedText(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("iCloud CalDAV response exceeded the safe size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let total = 0;
  let output = "";
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      throw new Error("iCloud CalDAV response timed out.");
    }
    let timeout;
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("iCloud CalDAV response timed out.")), remaining);
      }),
    ]).finally(() => clearTimeout(timeout));
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("iCloud CalDAV response exceeded the safe size limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlTag(xml, localName) {
  const match = String(xml || "").match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${localName}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function xmlResponses(xml) {
  return [...String(xml || "").matchAll(/<(?:[A-Za-z0-9_-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi)]
    .map((match) => match[1]);
}

async function propfind(env, url, body, depth = "0") {
  const response = await caldavFetch(env, url, {
    method: "PROPFIND",
    headers: { depth, "content-type": "application/xml; charset=utf-8" },
    body,
  });
  const text = await boundedText(response);
  if (!response.ok && response.status !== 207) throw new Error(`iCloud CalDAV discovery failed (${response.status}).`);
  return { response, text };
}

function calendarName(row, index) {
  return xmlTag(row, "displayname") || `iCloud Calendar ${index + 1}`;
}

export async function discoverIcloudCalendars(env) {
  if (!credentialsReady(env)) throw new Error("iCloud CalDAV credentials are not configured.");
  const principalBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  const principalResult = await propfind(env, CALDAV_ROOT, principalBody);
  const principalHref = xmlTag(xmlTag(principalResult.text, "current-user-principal"), "href") || xmlTag(principalResult.text, "href");
  if (!principalHref) throw new Error("iCloud did not return a CalDAV principal.");
  const principalUrl = safeIcloudUrl(principalHref, principalResult.response.url || CALDAV_ROOT);

  const homeBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
  const homeResult = await propfind(env, principalUrl, homeBody);
  const homeHref = xmlTag(xmlTag(homeResult.text, "calendar-home-set"), "href") || xmlTag(homeResult.text, "href");
  if (!homeHref) throw new Error("iCloud did not return a calendar home.");
  const homeUrl = safeIcloudUrl(homeHref, homeResult.response.url || principalUrl);

  const calendarsBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><cs:getctag/></d:prop></d:propfind>`;
  const calendarsResult = await propfind(env, homeUrl, calendarsBody, "1");
  return xmlResponses(calendarsResult.text)
    .filter((row) => /<(?:[A-Za-z0-9_-]+:)?calendar(?:\s*\/|[\s>])/i.test(xmlTag(row, "resourcetype")))
    .filter((row) => !/<(?:[A-Za-z0-9_-]+:)?comp[^>]+name=["']VTODO["']/i.test(row) || /<(?:[A-Za-z0-9_-]+:)?comp[^>]+name=["']VEVENT["']/i.test(row))
    .map((row, index) => {
      const href = xmlTag(row, "href");
      const url = safeIcloudUrl(href, calendarsResult.response.url || homeUrl);
      return { href: url.toString(), name: calendarName(row, index) };
    })
    .filter((calendar, index, values) => values.findIndex((item) => item.href === calendar.href) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function utcIcs(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function zonedLocalToUtcIso(timeZone, year, month, day, hour, minute, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (timestamp) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - timestamp;
  };
  let offset = offsetAt(guess);
  offset = offsetAt(guess - offset);
  return new Date(guess - offset).toISOString();
}

function unfoldIcs(value) {
  return String(value || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function icsProperties(block) {
  const properties = new Map();
  unfoldIcs(block).forEach((line) => {
    const colon = line.indexOf(":");
    if (colon <= 0) return;
    const left = line.slice(0, colon);
    const name = left.split(";", 1)[0].toUpperCase();
    const params = Object.fromEntries(left.split(";").slice(1).map((part) => {
      const separator = part.indexOf("=");
      return separator < 0 ? [part.toUpperCase(), ""] : [part.slice(0, separator).toUpperCase(), part.slice(separator + 1).replace(/^"|"$/g, "")];
    }));
    if (!properties.has(name)) properties.set(name, []);
    properties.get(name).push({ value: line.slice(colon + 1), params });
  });
  return properties;
}

function parseIcsDate(property, fallbackZone = DEFAULT_TIME_ZONE) {
  if (!property?.value) return null;
  const raw = property.value.trim();
  const allDay = property.params.VALUE === "DATE" || /^\d{8}$/.test(raw);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!match) return null;
  const values = match.slice(1, 7).map((part) => Number(part || 0));
  let iso;
  if (match[7]) iso = new Date(Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5])).toISOString();
  else iso = zonedLocalToUtcIso(property.params.TZID || fallbackZone, values[0], values[1], values[2], values[3], values[4], values[5]);
  return { iso, allDay };
}

function parseCalendarData(calendarData, source) {
  const blocks = [...String(calendarData || "").matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/gi)];
  const intervals = [];
  for (const match of blocks) {
    const properties = icsProperties(match[1]);
    if (asString(properties.get("STATUS")?.[0]?.value).toUpperCase() === "CANCELLED") continue;
    const start = parseIcsDate(properties.get("DTSTART")?.[0]);
    if (!start) continue;
    let end = parseIcsDate(properties.get("DTEND")?.[0]);
    if (!end) end = { iso: new Date(new Date(start.iso).getTime() + (start.allDay ? 86400000 : 3600000)).toISOString(), allDay: start.allDay };
    if (new Date(end.iso).getTime() <= new Date(start.iso).getTime()) continue;
    intervals.push({
      startAt: start.iso,
      endAt: end.iso,
      allDay: start.allDay,
      uid: asString(properties.get("UID")?.[0]?.value) || source.href,
      recurrenceKey: asString(properties.get("RECURRENCE-ID")?.[0]?.value),
      etag: source.etag || "",
    });
  }
  return intervals;
}

async function calendarQuery(env, calendar, startAt, endAt) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${utcIcs(startAt)}" end="${utcIcs(endAt)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${utcIcs(startAt)}" end="${utcIcs(endAt)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const response = await caldavFetch(env, calendar.href, {
    method: "REPORT",
    headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
    body,
  });
  const text = await boundedText(response);
  if (!response.ok && response.status !== 207) throw new Error(`iCloud calendar query failed (${response.status}).`);
  return xmlResponses(text).flatMap((row) => {
    const href = xmlTag(row, "href");
    const etag = xmlTag(row, "getetag");
    const data = xmlTag(row, "calendar-data");
    return parseCalendarData(data, { href, etag });
  });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseBlockingCalendars(row) {
  try {
    const parsed = JSON.parse(row?.blocking_calendars_json || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.href && item?.name).map((item) => ({ href: String(item.href), name: String(item.name) })) : [];
  } catch {
    return [];
  }
}

async function settingsRow(db) {
  return db.prepare("SELECT * FROM booking_calendar_sync_settings WHERE id='icloud'").first();
}

function normalizedSettings(row) {
  const lastInbound = row?.last_inbound_succeeded_at || "";
  return {
    inboundEnabled: Boolean(row?.inbound_enabled),
    outboundEnabled: Boolean(row?.outbound_enabled),
    destinationCalendar: row?.destination_calendar_href ? { href: row.destination_calendar_href, name: row.destination_calendar_name || DESTINATION_CALENDAR_NAME } : null,
    blockingCalendars: parseBlockingCalendars(row),
    lastDiscoveredAt: row?.last_discovered_at || "",
    lastInboundStartedAt: row?.last_inbound_started_at || "",
    lastInboundSucceededAt: lastInbound,
    lastOutboundStartedAt: row?.last_outbound_started_at || "",
    lastOutboundSucceededAt: row?.last_outbound_succeeded_at || "",
    lastError: row?.last_error || "",
    stale: Boolean(row?.inbound_enabled) && (!lastInbound || Date.now() - new Date(lastInbound).getTime() > STALE_WARNING_MS),
  };
}

async function beginRun(db, direction, triggerKind) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO booking_calendar_sync_runs (id,provider,direction,trigger_kind,status,started_at) VALUES (?,'icloud',?,?, 'running',?)`)
    .bind(id, direction, triggerKind, now).run();
  return { id, startedAt: now };
}

async function finishRun(db, run, status, counts = {}, error = "") {
  const completedAt = new Date().toISOString();
  await db.prepare(`UPDATE booking_calendar_sync_runs SET status=?,counts_json=?,error=?,completed_at=? WHERE id=?`)
    .bind(status, JSON.stringify(counts), asString(error).slice(0, 1000), completedAt, run.id).run();
  return { id: run.id, status, counts, error: asString(error), startedAt: run.startedAt, completedAt };
}

async function acquireLock(db) {
  const owner = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const result = await db.prepare(`UPDATE booking_calendar_sync_settings SET lock_owner=?,lock_expires_at=?,updated_at=? WHERE id='icloud' AND (lock_expires_at IS NULL OR lock_expires_at < ? OR lock_owner='')`)
    .bind(owner, expiresAt, now, now).run();
  return Number(result.meta?.changes || 0) ? owner : "";
}

async function releaseLock(db, owner) {
  if (!owner) return;
  await db.prepare(`UPDATE booking_calendar_sync_settings SET lock_owner='',lock_expires_at=NULL,updated_at=? WHERE id='icloud' AND lock_owner=?`)
    .bind(new Date().toISOString(), owner).run();
}

async function syncInbound(db, env, row, run) {
  const blocking = parseBlockingCalendars(row);
  if (!blocking.length) throw new Error("Choose at least one iCloud calendar to block availability.");
  const bookingSettings = await db.prepare("SELECT booking_horizon_days FROM booking_settings WHERE venture='tattooing'").first();
  const horizon = Math.max(1, Math.min(180, Number(bookingSettings?.booking_horizon_days || 60)));
  const startAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + (horizon + 1) * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("UPDATE booking_calendar_sync_settings SET last_inbound_started_at=?,updated_at=? WHERE id='icloud'")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
  const grouped = [];
  for (const calendar of blocking) grouped.push({ calendar, intervals: await calendarQuery(env, calendar, startAt, endAt) });
  const flattened = grouped.flatMap(({ calendar, intervals }) => intervals.map((interval) => ({ calendar, ...interval })));
  if (flattened.length > MAX_BUSY_INTERVALS) throw new Error("iCloud returned more busy intervals than the safe sync limit.");
  const observedAt = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM external_calendar_busy_sources WHERE provider='icloud'"),
    db.prepare("DELETE FROM availability_windows WHERE id LIKE 'icloud:%' AND is_blackout=1"),
  ];
  const seen = new Set();
  for (const interval of flattened) {
    const identity = `${interval.calendar.href}|${interval.uid}|${interval.recurrenceKey}|${interval.startAt}|${interval.endAt}`;
    const digest = await sha256Hex(identity);
    const windowId = `icloud:${digest.slice(0, 48)}`;
    if (seen.has(windowId)) continue;
    seen.add(windowId);
    const calendarHash = await sha256Hex(interval.calendar.href);
    const uidHash = await sha256Hex(interval.uid);
    statements.push(
      db.prepare(`INSERT INTO availability_windows (id,venture,booking_type_id,start_at,end_at,capacity,buffer_before_minutes,buffer_after_minutes,is_blackout,active,note,created_at,updated_at,availability_scope) VALUES (?,'tattooing',NULL,?,?,1,0,0,1,1,?,?,?,'tattoo')`)
        .bind(windowId, interval.startAt, interval.endAt, "iCloud Busy", observedAt, observedAt),
      db.prepare(`INSERT INTO external_calendar_busy_sources (availability_window_id,provider,calendar_href_hash,calendar_name,event_uid_hash,recurrence_key,source_etag,sync_run_id,observed_at) VALUES (?,'icloud',?,?,?,?,?,?,?)`)
        .bind(windowId, calendarHash, interval.calendar.name.slice(0, 200), uidHash, interval.recurrenceKey.slice(0, 200), interval.etag.slice(0, 500), run.id, observedAt),
    );
  }
  statements.push(db.prepare("UPDATE booking_calendar_sync_settings SET last_inbound_succeeded_at=?,last_error='',updated_at=? WHERE id='icloud'").bind(observedAt, observedAt));
  await db.batch(statements);
  return { calendars: blocking.length, intervals: seen.size };
}

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line) {
  const chunks = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function icsProperty(name, value) {
  return foldLine(`${name}:${icsEscape(value)}`);
}

function appointmentIcs(env, appointment) {
  const origin = asString(env.PUBLIC_SITE_URL).replace(/\/+$/, "") || "https://thesixwellconstruct.com";
  const label = appointment.booking_type_label || "Tattoo appointment";
  const studioUrl = `${origin}/studio/submissions/?appointment=${encodeURIComponent(appointment.id)}`;
  const location = appointment.join_url || asString(env.STUDIO_ADDRESS) || "364 Nelson Street SW, Atlanta, GA 30313";
  const description = [
    `Client: ${appointment.client_name || ""}`,
    `Email: ${appointment.client_email || ""}`,
    `Phone: ${appointment.client_phone || ""}`,
    `Session: ${label}`,
    `Appointment ID: ${appointment.id}`,
    `Manage in Studio: ${studioUrl}`,
    appointment.join_url ? `Zoom: ${appointment.join_url}` : "",
  ].filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Six Well Construct//iCloud Appointment Sync//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    icsProperty("UID", `appointment-${appointment.id}@thesixwellconstruct.com`),
    `DTSTAMP:${utcIcs(appointment.created_at || appointment.updated_at)}`,
    `LAST-MODIFIED:${utcIcs(appointment.updated_at || new Date())}`,
    `SEQUENCE:${Math.max(0, Number(appointment.reschedule_count || 0))}`,
    `DTSTART:${utcIcs(appointment.start_at)}`, `DTEND:${utcIcs(appointment.end_at)}`,
    icsProperty("SUMMARY", `${appointment.client_name || "Client"} — ${label}`),
    icsProperty("LOCATION", location), icsProperty("DESCRIPTION", description), icsProperty("URL", studioUrl),
    "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

function calendarResourceHref(destinationHref, appointmentId) {
  const base = destinationHref.endsWith("/") ? destinationHref : `${destinationHref}/`;
  return safeIcloudUrl(`swc-appointment-${encodeURIComponent(appointmentId)}.ics`, base).toString();
}

async function saveLink(db, appointment, destination, resourceHref, etag, payloadHash, state = "synced", error = "") {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO appointment_calendar_links (appointment_id,provider,calendar_href,resource_href,event_uid,etag,payload_hash,state,last_attempt_at,last_synced_at,last_error,created_at,updated_at) VALUES (?,'icloud',?,?,?,?,?,?,?, ?,?,?,?) ON CONFLICT(appointment_id) DO UPDATE SET calendar_href=excluded.calendar_href,resource_href=excluded.resource_href,etag=excluded.etag,payload_hash=excluded.payload_hash,state=excluded.state,last_attempt_at=excluded.last_attempt_at,last_synced_at=excluded.last_synced_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .bind(appointment.id, destination.href, resourceHref, `appointment-${appointment.id}@thesixwellconstruct.com`, etag || "", payloadHash || "", state, now, state === "synced" ? now : null, asString(error).slice(0, 1000), now, now).run();
}

async function putAppointment(db, env, appointment, destination) {
  const payload = appointmentIcs(env, appointment);
  const payloadHash = await sha256Hex(payload);
  const resourceHref = appointment.resource_href || calendarResourceHref(destination.href, appointment.id);
  let drift = false;
  if (
    appointment.payload_hash === payloadHash
    && appointment.link_state === "synced"
    && appointment.calendar_href === destination.href
    && appointment.etag
  ) {
    const current = await caldavFetch(env, resourceHref, { method: "GET", headers: { "if-none-match": appointment.etag } });
    if (current.status === 304) return "unchanged";
    if (current.ok) await boundedText(current);
    if (![200, 404, 410].includes(current.status)) {
      throw new Error(`iCloud appointment verification failed (${current.status}).`);
    }
    drift = true;
  }
  const headers = { "content-type": "text/calendar; charset=utf-8" };
  if (appointment.etag) headers["if-match"] = appointment.etag;
  else headers["if-none-match"] = "*";
  let response = await caldavFetch(env, resourceHref, { method: "PUT", headers, body: payload });
  if ([404, 409, 412].includes(response.status)) {
    drift = true;
    response = await caldavFetch(env, resourceHref, { method: "PUT", headers: { "content-type": "text/calendar; charset=utf-8" }, body: payload });
  }
  if (!response.ok && response.status !== 201 && response.status !== 204) throw new Error(`iCloud appointment update failed (${response.status}).`);
  await saveLink(db, appointment, destination, resourceHref, response.headers.get("etag") || "", payloadHash);
  return drift ? "restored" : "updated";
}

async function deleteAppointmentLink(db, env, appointment) {
  if (appointment.link_state === "deleted") return "unchanged";
  if (!appointment.resource_href) return "unchanged";
  const headers = appointment.etag ? { "if-match": appointment.etag } : {};
  let response = await caldavFetch(env, appointment.resource_href, { method: "DELETE", headers });
  if (response.status === 412) response = await caldavFetch(env, appointment.resource_href, { method: "DELETE" });
  if (!response.ok && ![404, 410].includes(response.status)) throw new Error(`iCloud appointment delete failed (${response.status}).`);
  const now = new Date().toISOString();
  await db.prepare("UPDATE appointment_calendar_links SET state='deleted',etag='',last_error='',last_attempt_at=?,last_synced_at=?,updated_at=? WHERE appointment_id=?")
    .bind(now, now, now, appointment.id).run();
  return "deleted";
}

async function syncOutbound(db, env, row) {
  if (!row.destination_calendar_href) throw new Error("Choose the Art.Pill appointment calendar in Studio.");
  const destination = { href: row.destination_calendar_href, name: row.destination_calendar_name || DESTINATION_CALENDAR_NAME };
  await db.prepare("UPDATE booking_calendar_sync_settings SET last_outbound_started_at=?,updated_at=? WHERE id='icloud'")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
  const placeholders = SYNC_APPOINTMENT_PURPOSES.map(() => "?").join(",");
  let result;
  try {
    result = await db.prepare(`SELECT a.*,bt.label AS booking_type_label,m.calendar_href,m.resource_href,m.etag,m.payload_hash,m.state AS link_state,am.join_url FROM appointments a JOIN booking_types bt ON bt.id=a.booking_type_id LEFT JOIN appointment_calendar_links m ON m.appointment_id=a.id LEFT JOIN appointment_meetings am ON am.appointment_id=a.id AND am.provider='zoom' WHERE a.purpose IN (${placeholders}) AND ((a.status='confirmed' AND a.start_at>=?) OR m.appointment_id IS NOT NULL) ORDER BY a.start_at ASC`)
      .bind(...SYNC_APPOINTMENT_PURPOSES, new Date().toISOString()).all();
  } catch (error) {
    if (!/no such table: appointment_meetings/i.test(error?.message || "")) throw error;
    result = await db.prepare(`SELECT a.*,bt.label AS booking_type_label,m.calendar_href,m.resource_href,m.etag,m.payload_hash,m.state AS link_state,'' AS join_url FROM appointments a JOIN booking_types bt ON bt.id=a.booking_type_id LEFT JOIN appointment_calendar_links m ON m.appointment_id=a.id WHERE a.purpose IN (${placeholders}) AND ((a.status='confirmed' AND a.start_at>=?) OR m.appointment_id IS NOT NULL) ORDER BY a.start_at ASC`)
      .bind(...SYNC_APPOINTMENT_PURPOSES, new Date().toISOString()).all();
  }
  const counts = { updated: 0, unchanged: 0, restored: 0, deleted: 0, errors: 0 };
  for (const appointment of result.results || []) {
    try {
      let outcome = "unchanged";
      if (["cancelled", "archived"].includes(appointment.status)) outcome = await deleteAppointmentLink(db, env, appointment);
      else if (["confirmed", "completed", "no_show"].includes(appointment.status)) outcome = await putAppointment(db, env, appointment, destination);
      counts[outcome] = Number(counts[outcome] || 0) + 1;
    } catch (error) {
      counts.errors += 1;
      await saveLink(db, appointment, destination, appointment.resource_href || calendarResourceHref(destination.href, appointment.id), appointment.etag || "", appointment.payload_hash || "", "error", error.message);
    }
  }
  const now = new Date().toISOString();
  if (counts.errors) {
    await db.prepare("UPDATE booking_calendar_sync_settings SET last_error=?,updated_at=? WHERE id='icloud'")
      .bind(`${counts.errors} appointment event(s) failed and will retry.`, now).run();
  } else {
    await db.prepare("UPDATE booking_calendar_sync_settings SET last_outbound_succeeded_at=?,last_error='',updated_at=? WHERE id='icloud'")
      .bind(now, now).run();
  }
  return counts;
}

export async function runIcloudCalendarSync(env, triggerKind = "scheduled") {
  if (!env.SUBMISSIONS_DB || !credentialsReady(env)) return { status: "skipped", reason: "not_configured" };
  const db = dbFor(env);
  let row;
  try {
    row = await settingsRow(db);
  } catch (error) {
    if (isMissingSyncSchema(error)) return { status: "skipped", reason: "migration_missing" };
    throw error;
  }
  if (!row || (!row.inbound_enabled && !row.outbound_enabled)) return { status: "skipped", reason: "disabled" };
  const owner = await acquireLock(db);
  if (!owner) return { status: "skipped", reason: "already_running" };
  const run = await beginRun(db, "full", triggerKind);
  const counts = {};
  try {
    if (row.inbound_enabled) counts.inbound = await syncInbound(db, env, row, run);
    if (row.outbound_enabled) counts.outbound = await syncOutbound(db, env, row);
    return await finishRun(db, run, counts.outbound?.errors ? "failed" : "succeeded", counts, counts.outbound?.errors ? `${counts.outbound.errors} appointment event(s) failed.` : "");
  } catch (error) {
    const message = asString(error.message || error).slice(0, 1000);
    await db.prepare("UPDATE booking_calendar_sync_settings SET last_error=?,updated_at=? WHERE id='icloud'")
      .bind(message, new Date().toISOString()).run();
    return finishRun(db, run, "failed", counts, message);
  } finally {
    await releaseLock(db, owner);
  }
}

export async function checkIcloudCalendarConflict(env, db, windowRow) {
  if (!env || !credentialsReady(env) || !windowRow?.start_at || !windowRow?.end_at) return { conflict: false, checked: false };
  if (windowRow.availability_scope && windowRow.availability_scope !== "tattoo") return { conflict: false, checked: false };
  let row;
  try {
    row = await settingsRow(db);
  } catch (error) {
    if (isMissingSyncSchema(error)) return { conflict: false, checked: false };
    throw error;
  }
  if (!row?.inbound_enabled) return { conflict: false, checked: false };
  const lastSuccessMs = new Date(row.last_inbound_succeeded_at || 0).getTime();
  if (Number.isFinite(lastSuccessMs) && Date.now() - lastSuccessMs <= LIVE_CHECK_FRESH_MS) return { conflict: false, checked: false, freshCache: true };
  const calendars = parseBlockingCalendars(row);
  if (!calendars.length) return { conflict: false, checked: false };
  const startAt = new Date(new Date(windowRow.start_at).getTime() - Number(windowRow.buffer_before_minutes || 0) * 60000).toISOString();
  const endAt = new Date(new Date(windowRow.end_at).getTime() + Number(windowRow.buffer_after_minutes || 0) * 60000).toISOString();
  let timeout;
  try {
    const result = await Promise.race([
      (async () => {
        for (const calendar of calendars) {
          const intervals = await calendarQuery(env, calendar, startAt, endAt);
          if (intervals.some((item) => new Date(item.startAt) < new Date(endAt) && new Date(item.endAt) > new Date(startAt))) {
            return { conflict: true, checked: true };
          }
        }
        return { conflict: false, checked: true };
      })(),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ conflict: false, checked: false, usedCache: true }), 8000);
      }),
    ]);
    return result;
  } catch {
    return { conflict: false, checked: false, usedCache: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleAdminGetCalendarSync(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const db = dbFor(env);
    const row = await settingsRow(db);
    const [busy, links, runs] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM external_calendar_busy_sources WHERE provider='icloud'").first(),
      db.prepare("SELECT appointment_id,state,last_synced_at,last_error FROM appointment_calendar_links ORDER BY updated_at DESC LIMIT 250").all(),
      db.prepare("SELECT id,direction,trigger_kind,status,counts_json,error,started_at,completed_at FROM booking_calendar_sync_runs ORDER BY started_at DESC LIMIT 10").all(),
    ]);
    return json({
      configured: credentialsReady(env),
      credentials: { username: Boolean(credentials(env).username), appPassword: Boolean(credentials(env).password) },
      settings: normalizedSettings(row),
      busyIntervalCount: Number(busy?.count || 0),
      appointmentLinks: (links.results || []).map((item) => ({ appointmentId: item.appointment_id, state: item.state, lastSyncedAt: item.last_synced_at || "", error: item.last_error || "" })),
      recentRuns: (runs.results || []).map((item) => ({ id: item.id, direction: item.direction, trigger: item.trigger_kind, status: item.status, counts: JSON.parse(item.counts_json || "{}"), error: item.error || "", startedAt: item.started_at, completedAt: item.completed_at || "" })),
    });
  } catch (error) {
    if (isMissingSyncSchema(error)) return errorResponse("Calendar sync migration is not installed.", 503, { code: "CALENDAR_SYNC_MIGRATION_MISSING" });
    return errorResponse("Unable to load calendar sync.", 500, { detail: error.message });
  }
}

export async function handleAdminDiscoverCalendars(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  try {
    const calendars = await discoverIcloudCalendars(env);
    const db = dbFor(env);
    const now = new Date().toISOString();
    await db.prepare("UPDATE booking_calendar_sync_settings SET last_discovered_at=?,last_error='',updated_at=? WHERE id='icloud'").bind(now, now).run();
    return json({ calendars, discoveredAt: now });
  } catch (error) {
    return errorResponse("Unable to discover iCloud calendars.", 502, { detail: error.message });
  }
}

export async function handleAdminUpdateCalendarSync(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const body = await readJsonBody(request);
  if (!body) return errorResponse("Expected JSON body.", 400);
  try {
    const calendars = await discoverIcloudCalendars(env);
    const byHref = new Map(calendars.map((calendar) => [calendar.href, calendar]));
    const destinationHref = asString(body.destinationCalendarHref);
    const destination = destinationHref ? byHref.get(destinationHref) : null;
    const requestedBlocking = Array.isArray(body.blockingCalendarHrefs) ? [...new Set(body.blockingCalendarHrefs.map(asString).filter(Boolean))] : [];
    if ((body.outboundEnabled || body.inboundEnabled) && !destination) return errorResponse("Choose a discovered destination calendar.", 400);
    if (body.outboundEnabled && destination?.name !== DESTINATION_CALENDAR_NAME) {
      return errorResponse(`Choose the iCloud calendar named ${DESTINATION_CALENDAR_NAME} as the destination.`, 400);
    }
    if (requestedBlocking.includes(destinationHref)) return errorResponse("The appointment destination calendar cannot also block availability.", 400);
    const blocking = requestedBlocking.map((href) => byHref.get(href)).filter(Boolean);
    if (blocking.length !== requestedBlocking.length) return errorResponse("One or more blocking calendars are no longer available.", 409);
    if (body.inboundEnabled && !blocking.length) return errorResponse("Choose at least one calendar to block availability.", 400);
    const db = dbFor(env);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE booking_calendar_sync_settings SET inbound_enabled=?,outbound_enabled=?,destination_calendar_href=?,destination_calendar_name=?,blocking_calendars_json=?,last_error='',updated_at=? WHERE id='icloud'`)
      .bind(body.inboundEnabled ? 1 : 0, body.outboundEnabled ? 1 : 0, destination?.href || "", destination?.name || "", JSON.stringify(blocking), now).run();
    return handleAdminGetCalendarSync(request, env);
  } catch (error) {
    return errorResponse("Unable to save calendar sync settings.", 502, { detail: error.message });
  }
}

export async function handleAdminRunCalendarSync(request, env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const result = await runIcloudCalendarSync(env, "manual");
  return json(result, { status: result.status === "failed" ? 502 : 200 });
}

export const calendarSyncTestHelpers = Object.freeze({
  appointmentIcs,
  boundedText,
  parseCalendarData,
  safeIcloudUrl,
});
