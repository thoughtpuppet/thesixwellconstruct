const DEFAULT_FROM_ADDRESS = "saisolehamn@artpilltattoohouse.com";
const DEFAULT_FROM_NAME = "Art.Pill Tattoo House";
const DEFAULT_REPLY_TO = "saisolehamn@artpilltattoohouse.com";
const DEFAULT_TIMEZONE = "America/New_York";

function notificationDb(env) {
  return env.SUBMISSIONS_DB || null;
}

function fromAddress(env) {
  return env.NOTIFICATION_FROM_EMAIL || DEFAULT_FROM_ADDRESS;
}

function fromName(env) {
  return env.NOTIFICATION_FROM_NAME || DEFAULT_FROM_NAME;
}

function replyToAddress(env) {
  return env.NOTIFICATION_REPLY_TO || DEFAULT_REPLY_TO;
}

function publicBaseUrl(env, request) {
  if (env.PUBLIC_SITE_URL) return String(env.PUBLIC_SITE_URL).replace(/\/+$/g, "");
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return "https://thesixwellconstruct.com";
}

function asString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function formatDate(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(Number(cents || 0) / 100);
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

async function recordDelivery(db, delivery) {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO notification_deliveries (
          id, channel, template_key, recipient, subject, related_type,
          related_id, idempotency_key, status, error, sent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        delivery.channel,
        delivery.templateKey,
        delivery.recipient,
        delivery.subject || null,
        delivery.relatedType || null,
        delivery.relatedId || null,
        delivery.idempotencyKey,
        delivery.status,
        delivery.error || null,
        delivery.sentAt || null,
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.warn("Unable to record notification delivery.", error.message);
  }
}

async function deliveryExists(db, idempotencyKey) {
  if (!db || !idempotencyKey) return false;
  try {
    const row = await db
      .prepare("SELECT id FROM notification_deliveries WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function sendTransactionalEmail(env, message) {
  const db = notificationDb(env);
  if (await deliveryExists(db, message.idempotencyKey)) {
    return { ok: true, skipped: true };
  }

  if (!env.EMAIL?.send) {
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "skipped",
      error: "Missing EMAIL send_email binding.",
    });
    return { ok: false, skipped: true, error: "Missing EMAIL send_email binding." };
  }

  try {
    const response = await env.EMAIL.send({
      to: message.to,
      from: { email: fromAddress(env), name: fromName(env) },
      replyTo: replyToAddress(env),
      subject: message.subject,
      text: message.text,
      html: message.html || textToHtml(message.text),
    });
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    return { ok: true, response };
  } catch (error) {
    await recordDelivery(db, {
      ...message,
      channel: "email",
      status: "failed",
      error: error.message,
    });
    return { ok: false, error: error.message };
  }
}

function normalizeSubmission(rowOrSubmission) {
  const contact = rowOrSubmission.contact || parseJsonField(rowOrSubmission.contact_json, {});
  const payload = rowOrSubmission.payload || parseJsonField(rowOrSubmission.payload_json, {});
  return {
    id: rowOrSubmission.id,
    type: rowOrSubmission.type,
    contactName: rowOrSubmission.contactName || rowOrSubmission.contact_name || contact.name || "",
    contactEmail: rowOrSubmission.contactEmail || rowOrSubmission.contact_email || contact.email || "",
    contactPhone: rowOrSubmission.contactPhone || rowOrSubmission.contact_phone || contact.phone || "",
    payload,
  };
}

function normalizeAppointment(row) {
  return {
    id: row.id,
    bookingTypeLabel: row.booking_type_label || row.bookingTypeLabel || "Tattoo session",
    clientName: row.client_name || row.clientName || "",
    clientEmail: row.client_email || row.clientEmail || "",
    clientPhone: row.client_phone || row.clientPhone || "",
    startAt: row.start_at || row.startAt,
    endAt: row.end_at || row.endAt,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    currency: row.currency || "USD",
  };
}

export async function notifySubmissionReceived(env, submission) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail) return { ok: false, skipped: true };

  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your Art.Pill inquiry has been received.",
    "The studio will review the project notes, placement, scale, references, and timing before sending any booking access.",
    "",
    "If the project is approved, you will receive a private booking link for scheduling and deposit.",
    "",
    "Thank you,",
    "Art.Pill Tattoo House",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "Art.Pill inquiry received",
    text,
    templateKey: "submission_received",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: `submission_received:${normalized.id}`,
  });
}

export async function notifyBookingLinkCreated(env, request, submission, token) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail || !token?.bookingUrl) return { ok: false, skipped: true };

  const bookingUrl = token.bookingUrl.startsWith("http")
    ? token.bookingUrl
    : `${publicBaseUrl(env, request)}${token.bookingUrl}`;
  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your Art.Pill project has been approved for booking.",
    "Use the private link below to choose an available session and complete the deposit:",
    "",
    bookingUrl,
    "",
    "This link is private to your project. If the available times do not work, reply to this email and the studio can help.",
    "",
    "Thank you,",
    "Art.Pill Tattoo House",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "Your private Art.Pill booking link",
    text,
    templateKey: "booking_link_created",
    relatedType: "submission",
    relatedId: normalized.id,
    idempotencyKey: `booking_link_created:${token.id}`,
  });
}

export async function notifyAppointmentConfirmed(env, request, appointmentRow) {
  const appointment = normalizeAppointment(appointmentRow);
  if (!appointment.clientEmail) return { ok: false, skipped: true };

  const confirmationUrl = `${publicBaseUrl(env, request)}/booking/confirmed/?appointment=${encodeURIComponent(appointment.id)}`;
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your Art.Pill appointment is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Deposit: ${formatMoney(appointment.depositCents, appointment.currency)} received`,
    "",
    `Confirmation page: ${confirmationUrl}`,
    "",
    "The studio may follow up directly with prep notes or adjustments before your appointment.",
    "",
    "Thank you,",
    "Art.Pill Tattoo House",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your Art.Pill appointment is confirmed",
    text,
    templateKey: "appointment_confirmed",
    relatedType: "appointment",
    relatedId: appointment.id,
    idempotencyKey: `appointment_confirmed:${appointment.id}`,
  });
}

export async function sendDueAppointmentReminders(env) {
  const db = notificationDb(env);
  if (!db) return { sent: 0, skipped: 0, failed: 0 };

  const now = new Date();
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db
      .prepare(
        `SELECT a.*, bt.label AS booking_type_label
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         WHERE a.status = 'confirmed'
           AND a.start_at >= ?
           AND a.start_at < ?
         ORDER BY a.start_at ASC
         LIMIT 50`
      )
      .bind(from, to)
      .all();

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of result.results || []) {
      const appointment = normalizeAppointment(row);
      const text = [
        `Hi ${appointment.clientName || "there"},`,
        "",
        "Reminder: your Art.Pill appointment is tomorrow.",
        "",
        `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
        `Session: ${appointment.bookingTypeLabel}`,
        "",
        "Reply to the studio email thread if anything needs attention before your session.",
        "",
        "Art.Pill Tattoo House",
      ].join("\n");
      const delivery = await sendTransactionalEmail(env, {
        to: appointment.clientEmail,
        subject: "Reminder: your Art.Pill appointment is tomorrow",
        text,
        templateKey: "appointment_reminder_24h",
        relatedType: "appointment",
        relatedId: appointment.id,
        idempotencyKey: `appointment_reminder_24h:${appointment.id}`,
      });
      if (delivery.skipped) skipped += 1;
      else if (delivery.ok) sent += 1;
      else failed += 1;
    }
    return { sent, skipped, failed };
  } catch (error) {
    console.warn("Unable to send due appointment reminders.", error.message);
    return { sent: 0, skipped: 0, failed: 1, error: error.message };
  }
}
