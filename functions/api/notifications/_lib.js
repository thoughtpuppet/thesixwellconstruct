const DEFAULT_FROM_ADDRESS = "saisolehamn@artpilltattoohouse.com";
const DEFAULT_FROM_NAME = "art.pill TATTOO HOUSE";
const DEFAULT_REPLY_TO = "saisolehamn@artpilltattoohouse.com";
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_BOOKING_TYPES = {
  tattoo_quarter: {
    label: "Quarter Session",
    description: "Approx. 1.5 hours for small approved projects, flash, or focused work.",
    durationMinutes: 90,
    depositCents: 5000,
    currency: "USD",
  },
  tattoo_half: {
    label: "Half Session",
    description: "Approx. 3 hours for medium approved projects or developed symbolic work.",
    durationMinutes: 180,
    depositCents: 10000,
    currency: "USD",
  },
  tattoo_full: {
    label: "Full Session",
    description: "Up to 6 hours for large approved work, special projects, or deeper sessions.",
    durationMinutes: 360,
    depositCents: 20000,
    currency: "USD",
  },
};

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

function publicUrl(env, request, path) {
  return `${publicBaseUrl(env, request)}${path}`;
}

function clientResourceUrls(env, request) {
  return {
    bookingTermsUrl: publicUrl(env, request, "/tattoos/policies/"),
    dayOfInstructionsUrl: publicUrl(env, request, "/tattoos/day-of/"),
    locationParkingUrl: publicUrl(env, request, "/tattoos/location-parking/"),
  };
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

function formatDuration(minutes) {
  const total = Number(minutes || 0);
  if (!total) return "";
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (!hours) return `${remainingMinutes} minutes`;
  if (!remainingMinutes) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} minutes`;
}

function normalizeBookingType(row) {
  return {
    id: row.id,
    label: row.label,
    description: row.description || "",
    durationMinutes: row.duration_minutes ?? row.durationMinutes ?? 0,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    currency: row.currency || "USD",
  };
}

function fallbackBookingTypes(allowedIds) {
  return (allowedIds || [])
    .map((id) => DEFAULT_BOOKING_TYPES[id] ? normalizeBookingType({ id, ...DEFAULT_BOOKING_TYPES[id] }) : null)
    .filter(Boolean);
}

async function bookingTypesForToken(env, token) {
  const allowedIds = Array.isArray(token?.allowedBookingTypes)
    ? token.allowedBookingTypes.map(asString).filter(Boolean)
    : [];
  if (Array.isArray(token?.bookingTypes) && token.bookingTypes.length) {
    return token.bookingTypes.map(normalizeBookingType);
  }
  if (!allowedIds.length) return [];

  const db = notificationDb(env);
  if (!db) return fallbackBookingTypes(allowedIds);

  try {
    const placeholders = allowedIds.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT id, label, description, duration_minutes, deposit_cents, currency
         FROM booking_types
         WHERE active = 1 AND id IN (${placeholders})`
      )
      .bind(...allowedIds)
      .all();
    const byId = new Map((result.results || []).map((row) => [row.id, normalizeBookingType(row)]));
    const fallbackById = new Map(fallbackBookingTypes(allowedIds).map((type) => [type.id, type]));
    return allowedIds.map((id) => byId.get(id) || fallbackById.get(id)).filter(Boolean);
  } catch (error) {
    console.warn("Unable to load booking type details for notification.", error.message);
    return fallbackBookingTypes(allowedIds);
  }
}

function sessionOptionsText(bookingTypes) {
  if (!bookingTypes.length) {
    return "Available session options are shown on your private booking page.";
  }
  return bookingTypes.map((type) => {
    const duration = formatDuration(type.durationMinutes);
    const deposit = formatMoney(type.depositCents, type.currency);
    const details = [duration, type.description].filter(Boolean).join(" - ");
    return `- ${type.label}${details ? `: ${details}` : ""} Deposit: ${deposit}.`;
  }).join("\n");
}

function depositAmountText(bookingTypes) {
  const deposits = bookingTypes
    .filter((type) => Number(type.depositCents) > 0)
    .map((type) => `${type.depositCents}:${type.currency || "USD"}`);
  const uniqueDeposits = [...new Set(deposits)];
  if (!uniqueDeposits.length) return "Shown on the private booking page";
  if (uniqueDeposits.length === 1) {
    const [cents, currency] = uniqueDeposits[0].split(":");
    return formatMoney(Number(cents), currency);
  }
  const values = uniqueDeposits.map((entry) => {
    const [cents, currency] = entry.split(":");
    return { cents: Number(cents), currency };
  });
  const currency = values.every((value) => value.currency === values[0].currency) ? values[0].currency : "USD";
  const cents = values.map((value) => value.cents).sort((a, b) => a - b);
  return `${formatMoney(cents[0], currency)}-${formatMoney(cents[cents.length - 1], currency)}, depending on selected session`;
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
  const meetingJoinUrl = row.meeting_join_url || row.meetingJoinUrl || row.meeting?.joinUrl || "";
  return {
    id: row.id,
    bookingTypeId: row.booking_type_id || row.bookingTypeId || "",
    bookingTypeLabel: row.booking_type_label || row.bookingTypeLabel || "Tattoo session",
    clientName: row.client_name || row.clientName || "",
    clientEmail: row.client_email || row.clientEmail || "",
    clientPhone: row.client_phone || row.clientPhone || "",
    startAt: row.start_at || row.startAt,
    endAt: row.end_at || row.endAt,
    depositCents: row.deposit_cents ?? row.depositCents ?? 0,
    tipCents: row.tip_cents ?? row.tipCents ?? 0,
    totalDueCents: (row.deposit_cents ?? row.depositCents ?? 0) + (row.tip_cents ?? row.tipCents ?? 0),
    currency: row.currency || "USD",
    meeting: meetingJoinUrl ? { joinUrl: meetingJoinUrl } : null,
  };
}

export async function notifySubmissionReceived(env, submission) {
  const normalized = normalizeSubmission(submission);
  if (!normalized.contactEmail) return { ok: false, skipped: true };

  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your art.pill TATTOO HOUSE inquiry has been received.",
    "The studio will review the project notes, placement, scale, references, and timing before sending any booking access.",
    "",
    "If the project is approved, you will receive a private booking link for scheduling and deposit.",
    "",
    "Thank you,",
    "art.pill TATTOO HOUSE",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "art.pill TATTOO HOUSE inquiry received",
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

  const resources = clientResourceUrls(env, request);
  const bookingTypes = await bookingTypesForToken(env, token);
  const bookingUrl = token.bookingUrl.startsWith("http")
    ? token.bookingUrl
    : `${publicBaseUrl(env, request)}${token.bookingUrl}`;
  const text = [
    `Hi ${normalized.contactName || "there"},`,
    "",
    "Your tattoo project has been approved for booking.",
    "",
    "Approved session options:",
    "",
    sessionOptionsText(bookingTypes),
    "",
    `Deposit due to book: ${depositAmountText(bookingTypes)}`,
    "",
    "Before booking, please review:",
    "",
    `- Terms & Conditions: ${resources.bookingTermsUrl}`,
    `- Day-of / session prep: ${resources.dayOfInstructionsUrl}`,
    "",
    "Use the private link below to choose an available session and pay the deposit:",
    "",
    bookingUrl,
    "",
    "This link is private to your project. Deposits are non-refundable and go toward the final cost of your tattoo. If the available times do not work, reply to this email and the studio can help.",
    "",
    "Thank you,",
    "art.pill TATTOO HOUSE",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: normalized.contactEmail,
    subject: "Your private art.pill TATTOO HOUSE booking link",
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

  const resources = clientResourceUrls(env, request);
  const confirmationUrl = `${publicBaseUrl(env, request)}/booking/confirmed/?appointment=${encodeURIComponent(appointment.id)}`;
  const text = [
    `Hi ${appointment.clientName || "there"},`,
    "",
    "Your art.pill TATTOO HOUSE appointment is confirmed.",
    "",
    `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
    `Session: ${appointment.bookingTypeLabel}`,
    `Deposit: ${formatMoney(appointment.depositCents, appointment.currency)} received`,
    appointment.tipCents ? `Optional tip: ${formatMoney(appointment.tipCents, appointment.currency)}` : "",
    appointment.tipCents ? `Total paid today: ${formatMoney(appointment.totalDueCents, appointment.currency)}` : "",
    appointment.meeting?.joinUrl ? `Zoom link: ${appointment.meeting.joinUrl}` : "",
    "",
    `Confirmation page: ${confirmationUrl}`,
    `Day-of instructions: ${resources.dayOfInstructionsUrl}`,
    `Location & parking: ${resources.locationParkingUrl}`,
    "",
    "I may follow up directly with prep notes or adjustments before your appointment, if needed.",
    "",
    "Thank you,",
    "Saiel Solehman",
    "[art.pill TATTOO HOUSE]",
  ].join("\n");

  return sendTransactionalEmail(env, {
    to: appointment.clientEmail,
    subject: "Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed",
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
        `SELECT a.*, bt.label AS booking_type_label,
                am.join_url AS meeting_join_url,
                am.password AS meeting_password
         FROM appointments a
         LEFT JOIN booking_types bt ON bt.id = a.booking_type_id
         LEFT JOIN appointment_meetings am ON am.appointment_id = a.id AND am.provider = 'zoom'
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
      const resources = clientResourceUrls(env);
      const text = [
        `Hi ${appointment.clientName || "there"},`,
        "",
        "Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow.",
        "",
        `When: ${formatDate(appointment.startAt)} - ${formatDate(appointment.endAt)}`,
        `Session: ${appointment.bookingTypeLabel}`,
        appointment.meeting?.joinUrl ? `Zoom link: ${appointment.meeting.joinUrl}` : "",
        "",
        "Please review before arriving:",
        "",
        `- Day-of instructions: ${resources.dayOfInstructionsUrl}`,
        `- Location & parking: ${resources.locationParkingUrl}`,
        "",
        "Reply to this thread if you have any questions or concerns before your session.",
        "",
        "-Saiel Solehman",
        "[art.pill TATTOO HOUSE]",
      ].join("\n");
      const delivery = await sendTransactionalEmail(env, {
        to: appointment.clientEmail,
        subject: "Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow",
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
