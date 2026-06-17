// Public ticketed events (Sip & Paint, etc.).
//
// Mirrors the Square hosted-checkout + webhook pattern from
// functions/api/booking/_lib.js, but isolated:
//   - its own `events` / `event_tickets` D1 tables (migration 0012)
//   - same Square account/token (SQUARE_ACCESS_TOKEN), but a dedicated
//     Square location (SQUARE_EVENTS_LOCATION_ID) with its own bank account/EIN
//   - its own webhook subscription + signing key (SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY)
//     feeding the dedicated route /api/square-events/webhook
//
// Public endpoints (wired in _worker.js):
//   GET  /api/events/:slug/context   -> event info + seats remaining
//   POST /api/events/:slug/checkout  -> create ticket + Square payment link
//   POST /api/square-events/webhook  -> confirm paid ticket (separate signing key)

import {
  notifyEventTicketPaid,
  notifyEventTicketCancelled,
} from "../notifications/_lib.js";

const SQUARE_VERSION = "2026-05-20";

// Pending checkouts older than this are swept by the hourly reaper: if Square
// never recorded a payment, the held ticket + its mirror submission are cleared
// so the admin inbox and seat math stay clean.
const STALE_PENDING_MINUTES = 120;

/* ------------------------------------------------------------------ */
/* Shared helpers (kept local so events stays self-contained)          */
/* ------------------------------------------------------------------ */

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

function asString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function baseUrlFromRequest(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function requireEventsDb(env) {
  const db = env.SUBMISSIONS_DB || null;
  if (!db) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return db;
}

function adminTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token") || "";
}

// Reuses the studio submissions admin token so the events console shares one
// credential with the rest of /studio.
function requireEventsAdmin(request, env) {
  const expected = env.SUBMISSIONS_ADMIN_TOKEN;
  if (!expected) return errorResponse("Admin events are not configured.", 503);
  if (adminTokenFromRequest(request) !== expected) {
    return errorResponse("Unauthorized.", 401);
  }
  return null;
}

async function readJsonOrForm(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      return body && typeof body === "object" ? body : {};
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
      const payload = {};
      for (const [key, value] of formData.entries()) {
        if (typeof File !== "undefined" && value instanceof File) continue;
        payload[key] = value;
      }
      return payload;
    } catch {
      return null;
    }
  }
  return null;
}

function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}

/* ------------------------------------------------------------------ */
/* Events Square location                                              */
/*                                                                     */
/* Same Square account/API token as tattoo deposits, but a dedicated   */
/* LOCATION (SQUARE_EVENTS_LOCATION_ID) so events settle to their own   */
/* bank account / EIN. Isolation is at the location + webhook level:    */
/* a separate webhook subscription with its own signing key feeds       */
/* /api/square-events/webhook.                                          */
/* ------------------------------------------------------------------ */

function eventsSquareBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function eventsSquareConfigured(env) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_EVENTS_LOCATION_ID);
}

function eventsWebhookNotificationUrl(request, env) {
  return (
    asString(env.SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL) ||
    `${baseUrlFromRequest(request)}/api/square-events/webhook`
  );
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

async function eventsWebhookSignature(rawBody, signatureKey, notificationUrl) {
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

async function verifyEventsWebhookRequest(request, env, rawBody) {
  const signatureKey = asString(env.SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY);
  if (!signatureKey) {
    return { ok: false, status: 503, error: "Events Square webhook is not configured." };
  }
  const squareSignature = request.headers.get("x-square-hmacsha256-signature") || "";
  const expected = await eventsWebhookSignature(
    rawBody,
    signatureKey,
    eventsWebhookNotificationUrl(request, env)
  );
  if (!timingSafeEqual(expected, squareSignature)) {
    return { ok: false, status: 403, error: "Invalid Square webhook signature." };
  }
  return { ok: true };
}

async function createEventSquarePaymentLink(request, env, ticket, event) {
  if (!eventsSquareConfigured(env)) {
    throw new Error("Events Square is not configured.");
  }

  const redirectUrl = new URL("/events/confirmed/", baseUrlFromRequest(request));
  redirectUrl.searchParams.set("ticket", ticket.id);
  redirectUrl.searchParams.set("event", event.slug);

  const seatLabel = ticket.seats === 1 ? "seat" : "seats";
  const response = await fetch(
    `${eventsSquareBaseUrl(env)}/v2/online-checkout/payment-links`,
    {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: ticket.id,
        order: {
          location_id: env.SQUARE_EVENTS_LOCATION_ID,
          line_items: [
            {
              name: `${event.title} — ${ticket.seats} ${seatLabel}`,
              quantity: "1",
              base_price_money: {
                amount: ticket.amountCents,
                currency: ticket.currency,
              },
            },
          ],
        },
        checkout_options: {
          redirect_url: redirectUrl.toString(),
          ask_for_shipping_address: false,
        },
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.detail || "Square checkout failed.");
  }
  return payload.payment_link;
}

async function fetchEventsSquareOrder(env, orderId) {
  if (!orderId || !eventsSquareConfigured(env)) return null;
  const response = await fetch(
    `${eventsSquareBaseUrl(env)}/v2/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      },
    }
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.order || null;
}

async function refundEventSquarePayment(env, ticketRow) {
  // Best-effort full refund of a paid ticket. Returns { ok, refundId, error }.
  const paymentId = asString(ticketRow.square_payment_id);
  if (!eventsSquareConfigured(env)) {
    return { ok: false, error: "Events Square is not configured." };
  }
  if (!paymentId) {
    return { ok: false, error: "No Square payment id on file; refund manually." };
  }
  try {
    const response = await fetch(`${eventsSquareBaseUrl(env)}/v2/refunds`, {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: `refund:${ticketRow.id}`,
        payment_id: paymentId,
        amount_money: {
          amount: Number(ticketRow.amount_cents) || 0,
          currency: ticketRow.currency || "USD",
        },
        reason: "Event ticket cancelled by studio.",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: payload.errors?.[0]?.detail || "Square refund failed." };
    }
    return { ok: true, refundId: payload.refund?.id || null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function orderLooksPaid(order) {
  if (!order) return false;
  const netDue = Number(order.net_amount_due_money?.amount ?? 1);
  return order.state === "COMPLETED" || netDue <= 0 || Boolean(order.tenders?.length);
}

function webhookOrderId(payload) {
  const object = payload?.data?.object || {};
  return (
    asString(object.payment?.order_id) ||
    asString(object.payment?.orderId) ||
    asString(object.order?.id) ||
    asString(object.order_updated?.order_id) ||
    asString(object.order_created?.order_id) ||
    asString(object.order_id) ||
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

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

function normalizeEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description || "",
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    location: row.location || "",
    priceCents: Number(row.price_cents) || 0,
    currency: row.currency || "USD",
    capacity: Number(row.capacity) || 0,
    maxSeatsPerOrder: Number(row.max_seats_per_order) || 4,
    status: row.status || "draft",
  };
}

async function getEventBySlug(db, slug) {
  const row = await db
    .prepare("SELECT * FROM events WHERE slug = ?")
    .bind(slug)
    .first();
  return normalizeEvent(row);
}

async function seatsTaken(db, eventId) {
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(seats), 0) AS taken FROM event_tickets WHERE event_id = ? AND status = 'paid'"
    )
    .bind(eventId)
    .first();
  return Number(row?.taken) || 0;
}

function publicEventView(event, taken) {
  const seatsRemaining = Math.max(0, event.capacity - taken);
  return {
    slug: event.slug,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    priceCents: event.priceCents,
    priceFormatted: formatMoney(event.priceCents, event.currency),
    free: event.priceCents <= 0,
    currency: event.currency,
    capacity: event.capacity,
    maxSeatsPerOrder: event.maxSeatsPerOrder,
    seatsRemaining,
    soldOut: seatsRemaining <= 0,
    status: event.status,
    open: event.status === "open" && seatsRemaining > 0,
  };
}

function icsDate(value, fallbackDate) {
  const date = value ? new Date(value) : fallbackDate;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value) {
  return String(value ?? "").replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

// Minimal single-event VCALENDAR for the "add to calendar" link.
function buildEventIcs(ticketRow) {
  const start = new Date(ticketRow.event_starts_at || ticketRow.eventStartsAt || Date.now());
  const end = ticketRow.event_ends_at
    ? new Date(ticketRow.event_ends_at)
    : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const dtStart = icsDate(start.toISOString());
  const dtEnd = icsDate(end.toISOString());
  const stamp = icsDate(new Date().toISOString());
  const title = ticketRow.event_title || ticketRow.eventTitle || "Event";
  const location = ticketRow.event_location || ticketRow.eventLocation || "";
  const seats = Number(ticketRow.seats) || 1;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//the six.well construct//events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ticketRow.id}@thesixwellconstruct.com`,
    `DTSTAMP:${stamp}`,
    dtStart ? `DTSTART:${dtStart}` : "",
    dtEnd ? `DTEND:${dtEnd}` : "",
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : "",
    `DESCRIPTION:${icsEscape(`${seats} seat${seats === 1 ? "" : "s"} reserved with the six.well construct.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

/* ------------------------------------------------------------------ */
/* Public handlers                                                     */
/* ------------------------------------------------------------------ */

// GET /api/events -> all bookable (non-draft) events, soonest first.
export async function handleEventsList(request, env) {
  try {
    const db = requireEventsDb(env);
    const result = await db
      .prepare(
        `SELECT * FROM events WHERE status != 'draft'
         ORDER BY (starts_at IS NULL), starts_at ASC`
      )
      .all();
    const rows = result.results || [];
    const events = [];
    for (const row of rows) {
      const event = normalizeEvent(row);
      const taken = await seatsTaken(db, event.id);
      events.push(publicEventView(event, taken));
    }
    return json({ events });
  } catch (error) {
    return errorResponse("Unable to load events.", 500, { detail: error.message });
  }
}

export async function handleEventTicketCalendar(request, env, ticketId) {
  try {
    const db = requireEventsDb(env);
    const row = await db
      .prepare(
        `SELECT t.id, t.seats, t.status,
                e.title AS event_title, e.starts_at AS event_starts_at,
                e.ends_at AS event_ends_at, e.location AS event_location
         FROM event_tickets t
         JOIN events e ON e.id = t.event_id
         WHERE t.id = ?`
      )
      .bind(ticketId)
      .first();
    if (!row) return errorResponse("Ticket not found.", 404);
    if (row.status !== "paid") {
      return errorResponse("Calendar file is available once payment clears.", 409);
    }
    return new Response(buildEventIcs(row), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="event-${row.id}.ics"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("Unable to build calendar file.", 500, { detail: error.message });
  }
}

export async function handleEventContext(request, env, slug) {
  try {
    const db = requireEventsDb(env);
    const event = await getEventBySlug(db, slug);
    if (!event || event.status === "draft") {
      return errorResponse("Event not found.", 404);
    }
    const taken = await seatsTaken(db, event.id);
    return json({ event: publicEventView(event, taken) });
  } catch (error) {
    return errorResponse("Unable to load event.", 500, { detail: error.message });
  }
}

export async function handleEventCheckout(request, env, slug) {
  const body = await readJsonOrForm(request);
  if (!body) return errorResponse("Expected JSON or form data.", 400);

  // Honeypot — pretend success so bots don't learn anything.
  if (asString(body._gotcha)) {
    return json({ ok: true, checkoutUrl: null, spam: true });
  }

  const name = asString(body.name || body.fullName);
  const email = normalizeEmail(body.email);
  const phone = asString(body.phone) || null;
  const seats = Math.floor(Number(body.seats) || 1);

  if (!name) return errorResponse("Name is required.", 400);
  if (!email || !isLikelyEmail(email)) {
    return errorResponse("A valid email is required.", 400);
  }
  if (!Number.isFinite(seats) || seats < 1) {
    return errorResponse("Select at least one seat.", 400);
  }

  try {
    const db = requireEventsDb(env);
    const event = await getEventBySlug(db, slug);
    if (!event || event.status === "draft") {
      return errorResponse("Event not found.", 404);
    }
    if (event.status !== "open") {
      return errorResponse("This event is not open for booking.", 409);
    }
    if (seats > event.maxSeatsPerOrder) {
      return errorResponse(
        `You can reserve at most ${event.maxSeatsPerOrder} seats per order.`,
        400
      );
    }

    const isFree = event.priceCents <= 0;

    if (!isFree && !eventsSquareConfigured(env)) {
      return errorResponse("Ticket checkout is not configured yet.", 503);
    }

    // Capacity guard against paid tickets. Concurrent pending checkouts can
    // still oversell slightly under heavy contention; the webhook is the final
    // source of truth and a sold-out paid count blocks new orders.
    const taken = await seatsTaken(db, event.id);
    const seatsRemaining = Math.max(0, event.capacity - taken);
    if (seatsRemaining <= 0) {
      return errorResponse("This event is sold out.", 409, { soldOut: true });
    }
    if (seats > seatsRemaining) {
      return errorResponse(
        `Only ${seatsRemaining} ${seatsRemaining === 1 ? "seat" : "seats"} remain.`,
        409,
        { seatsRemaining }
      );
    }

    const amountCents = isFree ? 0 : event.priceCents * seats;
    const ticketId = crypto.randomUUID();
    const now = new Date().toISOString();

    const ticket = {
      id: ticketId,
      seats,
      amountCents,
      currency: event.currency,
    };

    // Free events skip Square entirely: register the seat, mark it paid, and
    // send the confirmation. No payment link, no "continue to payment".
    if (isFree) {
      await db
        .prepare(
          `INSERT INTO event_tickets (
            id, event_id, contact_name, contact_email, contact_phone, seats,
            amount_cents, currency, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .bind(ticketId, event.id, name, email, phone, seats, amountCents, event.currency, now, now)
        .run();

      // Mirror into the studio submissions console before marking paid so the
      // mirror gets moved to booked.
      await recordEventSubmission(db, env, request, { event, ticket, name, email, phone });

      const ticketRow = await db
        .prepare("SELECT * FROM event_tickets WHERE id = ?")
        .bind(ticketId)
        .first();
      await markTicketPaid(db, env, request, ticketRow, { free: true }, null);

      return json({ ok: true, ticketId, registered: true, checkoutUrl: null });
    }

    let paymentLink;
    try {
      paymentLink = await createEventSquarePaymentLink(request, env, ticket, event);
    } catch (error) {
      return errorResponse("Unable to start ticket checkout.", 502, {
        detail: error.message,
      });
    }

    await db
      .prepare(
        `INSERT INTO event_tickets (
          id, event_id, contact_name, contact_email, contact_phone, seats,
          amount_cents, currency, status, square_order_id,
          square_payment_link_id, square_checkout_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .bind(
        ticketId,
        event.id,
        name,
        email,
        phone,
        seats,
        amountCents,
        event.currency,
        paymentLink.order_id || null,
        paymentLink.id || null,
        paymentLink.url || null,
        now,
        now
      )
      .run();

    // Mirror into the studio submissions console for visibility.
    await recordEventSubmission(db, env, request, { event, ticket, name, email, phone });

    return json({
      ok: true,
      ticketId,
      checkoutUrl: paymentLink.url,
    });
  } catch (error) {
    return errorResponse("Unable to create ticket.", 500, { detail: error.message });
  }
}

async function recordEventSubmission(db, env, request, { event, ticket, name, email, phone }) {
  try {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const contact = { name, email, phone: phone || undefined };
    const payload = {
      type: "event_rsvp",
      event_slug: event.slug,
      event_title: event.title,
      seats: ticket.seats,
      amount_cents: ticket.amountCents,
      currency: ticket.currency,
      ticket_id: ticket.id,
    };
    await db
      .prepare(
        `INSERT INTO submissions (
          id, type, status, source_path, subject, contact_name, contact_email,
          contact_phone, contact_json, payload_json, request_meta_json,
          files_json, created_at, updated_at
        ) VALUES (?, 'event_rsvp', 'new', ?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?)`
      )
      .bind(
        id,
        `/events/${event.slug}/`,
        `${event.title} ticket — ${ticket.seats} seat(s)`,
        name,
        email,
        phone,
        JSON.stringify(contact),
        JSON.stringify(payload),
        now,
        now
      )
      .run();
  } catch (error) {
    // Non-fatal: the ticket + payment are the source of truth.
    console.warn("Unable to record event submission.", error.message);
  }
}

export async function handleEventTicketStatus(request, env, ticketId) {
  try {
    const db = requireEventsDb(env);
    const row = await db
      .prepare(
        `SELECT t.*, e.title AS event_title, e.slug AS event_slug,
                e.starts_at AS event_starts_at, e.location AS event_location
         FROM event_tickets t
         JOIN events e ON e.id = t.event_id
         WHERE t.id = ?`
      )
      .bind(ticketId)
      .first();
    if (!row) return errorResponse("Ticket not found.", 404);

    // Fallback verification in case the webhook has not landed yet.
    if (row.status === "pending" && row.square_order_id) {
      const order = await fetchEventsSquareOrder(env, row.square_order_id);
      if (orderLooksPaid(order)) {
        await markTicketPaid(db, env, request, row, order, "");
        row.status = "paid";
      }
    }

    return json({
      ticket: {
        id: row.id,
        status: row.status,
        seats: Number(row.seats) || 0,
        amountFormatted: formatMoney(row.amount_cents, row.currency),
        eventTitle: row.event_title,
        eventSlug: row.event_slug,
        eventStartsAt: row.event_starts_at,
        eventLocation: row.event_location,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
      },
    });
  } catch (error) {
    return errorResponse("Unable to load ticket.", 500, { detail: error.message });
  }
}

async function markTicketPaid(db, env, request, ticketRow, order, paymentId) {
  const now = new Date().toISOString();
  const alreadyPaid = ticketRow.status === "paid";

  await db
    .prepare(
      `UPDATE event_tickets
       SET status = 'paid',
           square_payment_id = COALESCE(?, square_payment_id),
           raw_json = ?, paid_at = COALESCE(paid_at, ?), updated_at = ?
       WHERE id = ?`
    )
    .bind(paymentId || null, JSON.stringify(order || {}), now, now, ticketRow.id)
    .run();

  // Move the mirrored submission to booked.
  try {
    await db
      .prepare(
        `UPDATE submissions SET status = 'booked', updated_at = ?
         WHERE type = 'event_rsvp'
           AND json_extract(payload_json, '$.ticket_id') = ?`
      )
      .bind(now, ticketRow.id)
      .run();
  } catch {
    /* submissions mirror is best-effort */
  }

  if (!alreadyPaid) {
    await notifyEventTicketPaid(env, request, ticketRow).catch((error) => {
      console.warn("Event confirmation email failed.", error.message);
    });
  }
}

export async function handleEventsSquareWebhook(request, env) {
  let rawBody = "";
  try {
    rawBody = await request.text();
    const signature = await verifyEventsWebhookRequest(request, env, rawBody);
    if (!signature.ok) return errorResponse(signature.error, signature.status);

    const payload = JSON.parse(rawBody || "{}");
    const orderId = webhookOrderId(payload);
    if (!orderId) return json({ ok: true, ignored: true, reason: "No Square order id." });

    const db = requireEventsDb(env);
    const ticketRow = await db
      .prepare(
        "SELECT * FROM event_tickets WHERE square_order_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .bind(orderId)
      .first();
    if (!ticketRow) {
      return json({ ok: true, ignored: true, reason: "No matching ticket." });
    }

    const order = await fetchEventsSquareOrder(env, orderId);
    if (!webhookLooksPaid(payload, order)) {
      return json({ ok: true, paid: false, ticketId: ticketRow.id });
    }

    await markTicketPaid(db, env, request, ticketRow, order || payload, webhookPaymentId(payload));
    return json({ ok: true, paid: true, ticketId: ticketRow.id });
  } catch (error) {
    return errorResponse("Unable to process Square webhook.", 500, {
      detail: error.message,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Maintenance (called from the scheduled handler)                     */
/* ------------------------------------------------------------------ */

// Sweep stale 'pending' tickets: if Square never recorded a payment, clear the
// held ticket and its mirror submission so the inbox and seat math stay clean.
// Paid-but-missed checkouts (webhook lost) are reconciled to 'paid' instead.
export async function reapStalePendingTickets(env) {
  const db = env.SUBMISSIONS_DB || null;
  if (!db) return { reaped: 0, recovered: 0, failed: 0 };

  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000).toISOString();
  let reaped = 0;
  let recovered = 0;
  let failed = 0;

  try {
    const result = await db
      .prepare(
        `SELECT * FROM event_tickets
         WHERE status = 'pending' AND created_at < ?
         ORDER BY created_at ASC LIMIT 100`
      )
      .bind(cutoff)
      .all();

    for (const row of result.results || []) {
      try {
        // Last-chance reconciliation in case the webhook never landed.
        if (row.square_order_id) {
          const order = await fetchEventsSquareOrder(env, row.square_order_id);
          if (orderLooksPaid(order)) {
            await markTicketPaid(db, env, null, row, order, "");
            recovered += 1;
            continue;
          }
        }
        const now = new Date().toISOString();
        await db
          .prepare(
            `UPDATE event_tickets
             SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?), updated_at = ?
             WHERE id = ?`
          )
          .bind(now, now, row.id)
          .run();
        // Remove the mirror submission unless it already converted.
        await db
          .prepare(
            `DELETE FROM submissions
             WHERE type = 'event_rsvp'
               AND status NOT IN ('booked', 'paid')
               AND json_extract(payload_json, '$.ticket_id') = ?`
          )
          .bind(row.id)
          .run();
        reaped += 1;
      } catch (error) {
        failed += 1;
        console.warn("Unable to reap pending event ticket.", row.id, error.message);
      }
    }
  } catch (error) {
    console.warn("Unable to query stale pending event tickets.", error.message);
    return { reaped, recovered, failed: failed + 1, error: error.message };
  }
  return { reaped, recovered, failed };
}

/* ------------------------------------------------------------------ */
/* Admin handlers                                                      */
/* ------------------------------------------------------------------ */

const ADMIN_EVENT_STATUSES = new Set(["draft", "open", "closed"]);

async function eventStats(db, eventId) {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN seats ELSE 0 END), 0) AS paid_seats,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_orders,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_orders
       FROM event_tickets WHERE event_id = ?`
    )
    .bind(eventId)
    .first();
  return {
    paidSeats: Number(row?.paid_seats) || 0,
    paidOrders: Number(row?.paid_orders) || 0,
    pendingOrders: Number(row?.pending_orders) || 0,
  };
}

export async function handleAdminEventsList(request, env) {
  const authError = requireEventsAdmin(request, env);
  if (authError) return authError;
  try {
    const db = requireEventsDb(env);
    const result = await db
      .prepare("SELECT * FROM events ORDER BY (starts_at IS NULL), starts_at ASC")
      .all();
    const events = [];
    for (const row of result.results || []) {
      const event = normalizeEvent(row);
      const stats = await eventStats(db, event.id);
      events.push({
        ...event,
        priceFormatted: formatMoney(event.priceCents, event.currency),
        ...stats,
        seatsRemaining: Math.max(0, event.capacity - stats.paidSeats),
      });
    }
    return json({ events });
  } catch (error) {
    return errorResponse("Unable to load events.", 500, { detail: error.message });
  }
}

function slugify(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function handleAdminEventCreate(request, env) {
  const authError = requireEventsAdmin(request, env);
  if (authError) return authError;

  const body = await readJsonOrForm(request);
  if (!body) return errorResponse("Expected JSON or form data.", 400);

  const title = asString(body.title);
  if (!title) return errorResponse("Title is required.", 400);

  const slug = slugify(body.slug || title);
  if (!slug) return errorResponse("A valid slug or title is required.", 400);

  if (body.status !== undefined && !ADMIN_EVENT_STATUSES.has(asString(body.status))) {
    return errorResponse("Status must be draft, open, or closed.", 400);
  }

  try {
    const db = requireEventsDb(env);
    const existing = await getEventBySlug(db, slug);
    if (existing) {
      return errorResponse(`An event with slug "${slug}" already exists.`, 409);
    }

    const id = `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO events (
          id, slug, title, description, starts_at, ends_at, location,
          price_cents, currency, capacity, max_seats_per_order, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        slug,
        title,
        asString(body.description),
        asString(body.startsAt) || null,
        asString(body.endsAt) || null,
        asString(body.location),
        Math.max(0, Math.floor(Number(body.priceCents) || 0)),
        asString(body.currency).toUpperCase() || "USD",
        Math.max(0, Math.floor(Number(body.capacity) || 0)),
        Math.max(1, Math.floor(Number(body.maxSeatsPerOrder) || 4)),
        ADMIN_EVENT_STATUSES.has(asString(body.status)) ? asString(body.status) : "draft",
        now,
        now
      )
      .run();

    const created = await getEventBySlug(db, slug);
    const stats = await eventStats(db, created.id);
    return json({
      event: {
        ...created,
        priceFormatted: formatMoney(created.priceCents, created.currency),
        ...stats,
        seatsRemaining: Math.max(0, created.capacity - stats.paidSeats),
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse("Unable to create event.", 500, { detail: error.message });
  }
}

export async function handleAdminEventUpdate(request, env, slug) {
  const authError = requireEventsAdmin(request, env);
  if (authError) return authError;

  const body = await readJsonOrForm(request);
  if (!body) return errorResponse("Expected JSON or form data.", 400);

  if (body.status !== undefined && !ADMIN_EVENT_STATUSES.has(asString(body.status))) {
    return errorResponse("Status must be draft, open, or closed.", 400);
  }

  try {
    const db = requireEventsDb(env);
    const event = await getEventBySlug(db, slug);
    if (!event) return errorResponse("Event not found.", 404);

    // Only update the fields actually provided.
    const fields = [];
    const values = [];
    const setField = (column, value) => { fields.push(`${column} = ?`); values.push(value); };

    if (body.title !== undefined) setField("title", asString(body.title) || event.title);
    if (body.description !== undefined) setField("description", asString(body.description));
    if (body.location !== undefined) setField("location", asString(body.location));
    if (body.startsAt !== undefined) setField("starts_at", asString(body.startsAt) || null);
    if (body.endsAt !== undefined) setField("ends_at", asString(body.endsAt) || null);
    if (body.priceCents !== undefined) setField("price_cents", Math.max(0, Math.floor(Number(body.priceCents) || 0)));
    if (body.currency !== undefined) setField("currency", asString(body.currency).toUpperCase() || "USD");
    if (body.capacity !== undefined) setField("capacity", Math.max(0, Math.floor(Number(body.capacity) || 0)));
    if (body.maxSeatsPerOrder !== undefined) {
      setField("max_seats_per_order", Math.max(1, Math.floor(Number(body.maxSeatsPerOrder) || 1)));
    }
    if (body.status !== undefined) setField("status", asString(body.status));

    if (!fields.length) return errorResponse("No fields to update.", 400);

    setField("updated_at", new Date().toISOString());
    values.push(event.id);
    await db
      .prepare(`UPDATE events SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const updated = await getEventBySlug(db, slug);
    const stats = await eventStats(db, updated.id);
    return json({
      event: {
        ...updated,
        priceFormatted: formatMoney(updated.priceCents, updated.currency),
        ...stats,
        seatsRemaining: Math.max(0, updated.capacity - stats.paidSeats),
      },
    });
  } catch (error) {
    return errorResponse("Unable to update event.", 500, { detail: error.message });
  }
}

export async function handleAdminEventTicketCancel(request, env, ticketId) {
  const authError = requireEventsAdmin(request, env);
  if (authError) return authError;

  const body = (await readJsonOrForm(request)) || {};
  const shouldRefund = body.refund === undefined ? true : Boolean(body.refund);

  try {
    const db = requireEventsDb(env);
    const row = await db
      .prepare(
        `SELECT t.*, e.title AS event_title, e.starts_at AS event_starts_at,
                e.location AS event_location
         FROM event_tickets t
         JOIN events e ON e.id = t.event_id
         WHERE t.id = ?`
      )
      .bind(ticketId)
      .first();
    if (!row) return errorResponse("Ticket not found.", 404);
    if (row.status === "cancelled") {
      return json({ ok: true, alreadyCancelled: true });
    }

    const wasPaid = row.status === "paid";
    let refund = { ok: false, skipped: true };
    if (wasPaid && shouldRefund) {
      refund = await refundEventSquarePayment(env, row);
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE event_tickets
         SET status = 'cancelled', cancelled_at = ?,
             refund_id = COALESCE(?, refund_id), updated_at = ?
         WHERE id = ?`
      )
      .bind(now, refund.refundId || null, now, row.id)
      .run();

    // Archive the mirror submission so it leaves the active queue.
    await db
      .prepare(
        `UPDATE submissions SET status = 'archived', updated_at = ?
         WHERE type = 'event_rsvp'
           AND json_extract(payload_json, '$.ticket_id') = ?`
      )
      .bind(now, row.id)
      .run()
      .catch(() => {});

    if (wasPaid) {
      await notifyEventTicketCancelled(env, request, row, { refunded: refund.ok }).catch(
        (error) => console.warn("Event cancellation email failed.", error.message)
      );
    }

    return json({
      ok: true,
      cancelled: true,
      wasPaid,
      refund: shouldRefund
        ? { attempted: wasPaid, ok: refund.ok, refundId: refund.refundId || null, error: refund.error || null }
        : { attempted: false },
    });
  } catch (error) {
    return errorResponse("Unable to cancel ticket.", 500, { detail: error.message });
  }
}

/* ------------------------------------------------------------------ */
/* Router (called from _worker.js)                                     */
/* ------------------------------------------------------------------ */

export async function handleEventsApi(request, env) {
  const url = new URL(request.url);
  const { method } = request;
  // /api/events                              -> list bookable events
  // /api/events/:slug/(context|checkout)     -> single event
  // /api/events/tickets/:id                  -> ticket status
  // /api/events/tickets/:id/calendar         -> .ics download
  const parts = url.pathname.split("/").filter(Boolean); // ["api","events",...]

  if (!parts[2]) {
    if (method !== "GET") return errorResponse("Method not allowed.", 405);
    return handleEventsList(request, env);
  }

  if (parts[2] === "tickets" && parts[3]) {
    if (parts[4] === "calendar") {
      if (method !== "GET") return errorResponse("Method not allowed.", 405);
      return handleEventTicketCalendar(request, env, parts[3]);
    }
    if (method !== "GET") return errorResponse("Method not allowed.", 405);
    return handleEventTicketStatus(request, env, parts[3]);
  }

  const slug = parts[2];
  const action = parts[3];
  if (!slug || !action) return errorResponse("Unknown events API route.", 404);

  if (action === "context") {
    if (method !== "GET") return errorResponse("Method not allowed.", 405);
    return handleEventContext(request, env, slug);
  }
  if (action === "checkout") {
    if (method !== "POST") return errorResponse("Method not allowed.", 405);
    return handleEventCheckout(request, env, slug);
  }

  return errorResponse("Unknown events API route.", 404);
}

// Admin surface: /api/admin/events , /api/admin/events/:slug ,
// /api/admin/events/tickets/:id/cancel
export async function handleAdminEventsApi(request, env) {
  const url = new URL(request.url);
  const { method } = request;
  const parts = url.pathname.split("/").filter(Boolean); // ["api","admin","events",...]

  if (!parts[3]) {
    if (method === "GET") return handleAdminEventsList(request, env);
    if (method === "POST") return handleAdminEventCreate(request, env);
    return errorResponse("Method not allowed.", 405);
  }

  if (parts[3] === "tickets" && parts[4] && parts[5] === "cancel") {
    if (method !== "POST") return errorResponse("Method not allowed.", 405);
    return handleAdminEventTicketCancel(request, env, parts[4]);
  }

  const slug = parts[3];
  if (method !== "PATCH") return errorResponse("Method not allowed.", 405);
  return handleAdminEventUpdate(request, env, slug);
}
