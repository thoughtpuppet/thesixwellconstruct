function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return clean(value, 80).startsWith("+") ? clean(value, 80) : "";
}

function twilioConfigured(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID);
}

async function existingDelivery(db, idempotencyKey) {
  if (!db) return null;
  return db.prepare("SELECT * FROM notification_deliveries WHERE idempotency_key = ? LIMIT 1")
    .bind(idempotencyKey)
    .first();
}

async function recordDelivery(db, details) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO notification_deliveries
      (id, channel, template_key, template_variant, template_revision, email_theme,
       recipient, subject, related_type, related_id, idempotency_key, status, error, sent_at, created_at)
     VALUES (?, 'sms', ?, 'default', 0, 'tattoo', ?, NULL, 'appointment', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       status = excluded.status, error = excluded.error, sent_at = excluded.sent_at,
       recipient = excluded.recipient, created_at = excluded.created_at`
  ).bind(
    crypto.randomUUID(),
    details.templateKey,
    details.recipient,
    details.relatedId,
    details.idempotencyKey,
    details.status,
    details.error || null,
    details.sentAt || null,
    new Date().toISOString(),
  ).run();
}

export async function sendTattooSpecialDepositText(env, details = {}) {
  const db = env.SUBMISSIONS_DB || env.DB || null;
  const appointmentId = clean(details.appointmentId, 200);
  const idempotencyKey = `tattoo_special_deposit_requested_sms:${appointmentId}`;
  const prior = await existingDelivery(db, idempotencyKey);
  if (prior?.status === "sent") return { ok: true, skipped: true, status: "sent" };

  const to = normalizePhone(details.clientPhone || details.contactPhone);
  if (!to) {
    await recordDelivery(db, {
      templateKey: "tattoo_special_deposit_requested",
      recipient: clean(details.clientPhone || details.contactPhone, 80) || "missing",
      relatedId: appointmentId,
      idempotencyKey,
      status: "skipped",
      error: "A valid mobile number is required.",
    });
    return { ok: false, skipped: true, error: "A valid mobile number is required." };
  }
  if (!twilioConfigured(env)) {
    await recordDelivery(db, {
      templateKey: "tattoo_special_deposit_requested",
      recipient: to,
      relatedId: appointmentId,
      idempotencyKey,
      status: "skipped",
      error: "Twilio transactional messaging is not configured.",
    });
    return { ok: false, skipped: true, error: "Twilio transactional messaging is not configured." };
  }

  const accountSid = clean(env.TWILIO_ACCOUNT_SID, 200);
  const params = new URLSearchParams({
    To: to,
    MessagingServiceSid: clean(env.TWILIO_MESSAGING_SERVICE_SID, 200),
    Body: `art.pill TATTOO HOUSE: Your Tattoo Special request was approved. Pay the ${clean(details.depositText, 80)} deposit by ${clean(details.paymentDueText, 120)} to book the held time: ${clean(details.checkoutUrl, 1000)} Reply STOP to opt out.`,
  });
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${accountSid}:${env.TWILIO_AUTH_TOKEN}`)}`,
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          accept: "application/json",
        },
        body: params.toString(),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(payload.message || payload.error_message, 1000) || `Twilio request failed (${response.status}).`);
    const sentAt = new Date().toISOString();
    await recordDelivery(db, {
      templateKey: "tattoo_special_deposit_requested",
      recipient: to,
      relatedId: appointmentId,
      idempotencyKey,
      status: "sent",
      sentAt,
    });
    return { ok: true, status: "sent", providerMessageId: clean(payload.sid, 200) };
  } catch (error) {
    await recordDelivery(db, {
      templateKey: "tattoo_special_deposit_requested",
      recipient: to,
      relatedId: appointmentId,
      idempotencyKey,
      status: "failed",
      error: error.message,
    });
    return { ok: false, status: "failed", error: error.message };
  }
}
