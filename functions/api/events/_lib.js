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

import { notifyEventTicketPaid } from "../notifications/_lib.js";

const SQUARE_VERSION = "2026-05-20";

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
    currency: event.currency,
    capacity: event.capacity,
    maxSeatsPerOrder: event.maxSeatsPerOrder,
    seatsRemaining,
    soldOut: seatsRemaining <= 0,
    status: event.status,
    open: event.status === "open" && seatsRemaining > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Public handlers                                                     */
/* ------------------------------------------------------------------ */

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

    if (!eventsSquareConfigured(env)) {
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

    const amountCents = event.priceCents * seats;
    const ticketId = crypto.randomUUID();
    const now = new Date().toISOString();

    const ticket = {
      id: ticketId,
      seats,
      amountCents,
      currency: event.currency,
    };

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
/* Router (called from _worker.js)                                     */
/* ------------------------------------------------------------------ */

export async function handleEventsApi(request, env) {
  const url = new URL(request.url);
  const { method } = request;
  // /api/events/:slug/(context|checkout)  or  /api/events/tickets/:id
  const parts = url.pathname.split("/").filter(Boolean); // ["api","events",...]

  if (parts[2] === "tickets" && parts[3]) {
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
