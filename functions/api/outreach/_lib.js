import {
  db as requireDb,
  failure,
  id,
  json,
  parseJson,
  readJson,
  requireStudioAdmin,
  text,
} from "../_shared/construct.js";
import {
  sendCommunicationPreferencesLink,
  sendCrmFollowupEmail,
} from "../notifications/_lib.js";

export const NEWSLETTER_DISCLOSURE_VERSION = "newsletter-2026-07-18";
export const NEWSLETTER_DISCLOSURE =
  "Email me about new work, appointment openings, events, and releases. Unsubscribe anytime.";
const CHANNELS = new Set(["email"]);
const PURPOSE_BY_CHANNEL = Object.freeze({ email: "newsletter" });
const CONSENT_STATUSES = new Set(["pending", "granted", "revoked"]);
const CAMPAIGN_STATUSES = new Set(["draft", "reviewed", "prepared", "scheduled", "sending", "sent", "cancelled", "failed"]);
const MAX_AUDIENCE = 10_000;
const QUEUE_BATCH_SIZE = 25;

function nowIso() {
  return new Date().toISOString();
}

function asString(value, max = 5000) {
  return text(value, max);
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on", "granted", "subscribed"].includes(asString(value, 30).toLowerCase());
}

function featureEnabled(env, name) {
  return asString(env?.[name], 20).toLowerCase() === "true";
}

function normalizeEmail(value) {
  const email = asString(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeContact(channel, value) {
  return channel === "email" ? normalizeEmail(value) : "";
}

function purposeForChannel(channel) {
  return PURPOSE_BY_CHANNEL[channel] || "";
}

function disclosureForChannel(channel) {
  return channel === "email"
    ? { version: NEWSLETTER_DISCLOSURE_VERSION, text: NEWSLETTER_DISCLOSURE }
    : { version: "legacy", text: "Legacy channel consent is read-only." };
}

function providerForChannel(channel) {
  return channel === "email" ? "beehiiv" : "legacy";
}

function canonicalSource(value) {
  return asString(value || "website", 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

function response405(...allowed) {
  return json({ error: "Method not allowed." }, {
    status: 405,
    headers: { allow: allowed.join(", ") },
  });
}


async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return parseJson(value, fallback);
}

async function readObject(request) {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: failure("Expected a JSON object.", 400) };
  }
  return { body };
}

async function findPersonByContact(database, channel, normalizedValue) {
  if (!normalizedValue) return null;
  const kind = channel === "sms" ? "phone" : "email";
  return database.prepare(`
    SELECT p.*
    FROM crm_people p
    JOIN crm_identities i ON i.person_id=p.id
    WHERE i.kind=? AND i.normalized_value=? AND i.active=1
      AND p.merged_into_id IS NULL AND p.relationship_status!='merged'
    ORDER BY i.is_primary DESC,p.updated_at DESC
    LIMIT 1
  `).bind(kind, normalizedValue).first();
}

async function latestConsent(database, channel, normalizedValue) {
  return database.prepare(`
    SELECT * FROM crm_consent_events
    WHERE channel=? AND purpose=? AND normalized_value=?
    ORDER BY occurred_at DESC,created_at DESC,id DESC
    LIMIT 1
  `).bind(channel, purposeForChannel(channel), normalizedValue).first();
}

async function activeSuppression(database, channel, normalizedValue) {
  const identityKind = channel === "sms" ? "phone" : "email";
  return database.prepare(`
    SELECT * FROM crm_suppressions
    WHERE identity_kind=? AND normalized_value=? AND active=1
    ORDER BY updated_at DESC LIMIT 1
  `).bind(identityKind, normalizedValue).first();
}

async function upsertSuppression(database, {
  personId = null,
  channel,
  normalizedValue,
  provider,
  sourceId = null,
  active,
  reason = "",
  occurredAt = nowIso(),
}) {
  const identityKind = channel === "sms" ? "phone" : "email";
  const existing = await database.prepare(`
    SELECT id FROM crm_suppressions
    WHERE identity_kind=? AND normalized_value=?
  `).bind(identityKind, normalizedValue).first();
  if (existing) {
    await database.prepare(`
      UPDATE crm_suppressions
      SET person_id=COALESCE(?,person_id),reason=?,provider=?,source_id=?,
          active=?,updated_at=?
      WHERE id=?
    `).bind(
      personId,
      reason || (active ? "Customer revoked marketing consent" : "Customer explicitly opted in again"),
      provider,
      sourceId,
      active ? 1 : 0,
      occurredAt,
      existing.id,
    ).run();
    return existing.id;
  }
  if (!active) return null;
  const suppressionId = id("crm-suppression");
  await database.prepare(`
    INSERT INTO crm_suppressions(
      id,person_id,identity_kind,normalized_value,reason,provider,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,1,?,?)
  `).bind(
    suppressionId,
    personId,
    identityKind,
    normalizedValue,
    reason || "Customer revoked marketing consent",
    provider,
    sourceId,
    occurredAt,
    occurredAt,
  ).run();
  return suppressionId;
}

async function recordConsentEvent(database, input) {
  const channel = asString(input.channel, 20).toLowerCase();
  const purpose = purposeForChannel(channel);
  const status = asString(input.status, 20).toLowerCase();
  const normalizedValue = normalizeContact(channel, input.value || input.normalizedValue);
  if (!CHANNELS.has(channel) || !purpose) throw new Error("Invalid consent channel.");
  if (!CONSENT_STATUSES.has(status)) throw new Error("Invalid consent status.");
  if (!normalizedValue) throw new Error(channel === "email" ? "A valid email is required." : "A valid phone number is required.");
  const occurredAt = asString(input.occurredAt, 80) || nowIso();
  const provider = asString(input.provider, 80).toLowerCase();
  const providerReference = asString(input.providerReference, 300) || null;
  if (provider && providerReference) {
    const existing = await database.prepare(`
      SELECT * FROM crm_consent_events
      WHERE provider=? AND provider_reference=? LIMIT 1
    `).bind(provider, providerReference).first();
    if (existing) return { event: existing, replayed: true };
  }
  const person = input.personId
    ? await database.prepare("SELECT * FROM crm_people WHERE id=? LIMIT 1").bind(input.personId).first()
    : await findPersonByContact(database, channel, normalizedValue);
  const disclosure = disclosureForChannel(channel);
  const eventId = id("crm-consent");
  const createdAt = nowIso();
  await database.prepare(`
    INSERT INTO crm_consent_events(
      id,person_id,channel,purpose,status,normalized_value,source,source_detail,
      disclosure_version,disclosure_text,form_path,provider,provider_reference,
      evidence_json,occurred_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    eventId,
    person?.id || null,
    channel,
    purpose,
    status,
    normalizedValue,
    canonicalSource(input.source),
    asString(input.sourceDetail, 300),
    asString(input.disclosureVersion, 120) || disclosure.version,
    asString(input.disclosureText, 2000) || disclosure.text,
    asString(input.formPath, 500),
    provider,
    providerReference,
    JSON.stringify(safeJson(input.evidence, {})),
    occurredAt,
    createdAt,
  ).run();
  if (status === "revoked") {
    await upsertSuppression(database, {
      personId: person?.id || null,
      channel,
      normalizedValue,
      provider: provider || canonicalSource(input.source),
      sourceId: providerReference,
      active: true,
      reason: "Customer revoked marketing consent",
      occurredAt,
    });
  } else if (status === "granted") {
    await upsertSuppression(database, {
      personId: person?.id || null,
      channel,
      normalizedValue,
      provider: provider || canonicalSource(input.source),
      sourceId: providerReference,
      active: false,
      occurredAt,
    });
  }
  const event = await database.prepare("SELECT * FROM crm_consent_events WHERE id=?").bind(eventId).first();
  return { event, replayed: false };
}

function beehiivPublicationId(env) {
  return asString(env.BEEHIIV_OUTREACH_PUBLICATION_ID || env.BEEHIIV_PUBLICATION_IDS, 500)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0] || "";
}

function beehiivConfigured(env) {
  return Boolean(asString(env.BEEHIIV_API_KEY, 1000) && beehiivPublicationId(env));
}

async function beehiivRequest(env, pathname, init = {}) {
  const apiKey = asString(env.BEEHIIV_API_KEY, 1000);
  if (!apiKey) throw new Error("Beehiiv API credentials are not configured.");
  const response = await fetch(new URL(pathname, asString(env.BEEHIIV_API_BASE_URL, 500) || "https://api.beehiiv.com"), {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = asString(payload?.errors?.[0]?.message || payload?.message || payload?.error, 1000);
    throw new Error(`Beehiiv request failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  return payload;
}

async function upsertBeehiivSubscriptionState(database, {
  personId = null,
  publicationId,
  externalId,
  email,
  status,
  occurredAt,
  metadata = {},
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const providerExternal = asString(externalId, 300) || `${publicationId}:${normalizedEmail}`;
  const now = occurredAt || nowIso();
  await database.prepare(`
    INSERT OR IGNORE INTO crm_marketing_subscriptions(
      id,person_id,provider,publication_id,external_id,email,status,tier,
      consent_source,subscribed_at,unsubscribed_at,last_synced_at,
      metadata_json,active,created_at,updated_at
    ) VALUES(?,?,'beehiiv',?,?,?,?,'','beehiiv outreach',?,?,?, ?,1,?,?)
  `).bind(
    id("crm-subscription"),
    personId,
    publicationId || "",
    providerExternal,
    normalizedEmail,
    status,
    status === "subscribed" ? now : null,
    status === "unsubscribed" ? now : null,
    now,
    JSON.stringify(metadata),
    now,
    now,
  ).run();
  await database.prepare(`
    UPDATE crm_marketing_subscriptions
    SET person_id=COALESCE(?,person_id),publication_id=?,email=?,status=?,
        consent_source='beehiiv outreach',
        subscribed_at=CASE WHEN ?='subscribed' THEN COALESCE(subscribed_at,?) ELSE subscribed_at END,
        unsubscribed_at=CASE WHEN ?='unsubscribed' THEN ? ELSE NULL END,
        last_synced_at=?,metadata_json=?,active=1,updated_at=?
    WHERE provider='beehiiv' AND external_id=?
  `).bind(
    personId,
    publicationId || "",
    normalizedEmail,
    status,
    status,
    now,
    status,
    now,
    now,
    JSON.stringify(metadata),
    now,
    providerExternal,
  ).run();
}

async function requestBeehiivDoubleOptIn(env, database, event) {
  if (!featureEnabled(env, "OUTREACH_CONSENT_SYNC_ENABLED") || !beehiivConfigured(env)) {
    return { ok: false, skipped: true, reason: "beehiiv_sync_disabled" };
  }
  const publicationId = beehiivPublicationId(env);
  const payload = await beehiivRequest(env, `/v2/publications/${encodeURIComponent(publicationId)}/subscriptions`, {
    method: "POST",
    body: JSON.stringify({
      email: event.normalized_value,
      reactivate_existing: true,
      send_welcome_email: false,
      double_opt_override: "on",
      utm_source: "sixwell-website",
      utm_medium: "crm-consent",
      referring_site: asString(env.PUBLIC_SITE_URL, 500) || "https://thesixwellconstruct.com",
      ...(asString(env.BEEHIIV_OUTREACH_LIST_ID, 300)
        ? { newsletter_list_ids: [asString(env.BEEHIIV_OUTREACH_LIST_ID, 300)] }
        : {}),
    }),
  });
  const subscription = payload?.data || {};
  await upsertBeehiivSubscriptionState(database, {
    personId: event.person_id,
    publicationId,
    externalId: subscription.id,
    email: event.normalized_value,
    status: subscription.status === "active" || subscription.status === "confirmed" ? "subscribed" : "unknown",
    occurredAt: nowIso(),
    metadata: { providerStatus: subscription.status || "pending", consentEventId: event.id },
  });
  if (subscription.status === "active" || subscription.status === "confirmed") {
    await recordConsentEvent(database, {
      personId: event.person_id,
      channel: "email",
      value: event.normalized_value,
      status: "granted",
      source: "beehiiv_confirmation",
      provider: "beehiiv",
      providerReference: `subscription:${subscription.id}:confirmed`,
      occurredAt: nowIso(),
      evidence: { subscriptionId: subscription.id, providerStatus: subscription.status },
    });
  }
  return { ok: true, subscriptionId: subscription.id || "" };
}

export async function captureMarketingConsent(env, input = {}) {
  const database = requireDb(env);
  const source = canonicalSource(input.source || input.sourceType || "website");
  const sourceId = asString(input.sourceId || input.referenceId, 300);
  const formPath = asString(input.formPath || input.sourcePath, 500);
  const occurredAt = asString(input.occurredAt, 80) || nowIso();
  const outcomes = {};
  if (bool(input.emailOptIn || input.newsletterConsent || input.newsletter_consent)) {
    const email = normalizeEmail(input.email);
    if (email) {
      const recorded = await recordConsentEvent(database, {
        personId: input.personId || null,
        channel: "email",
        value: email,
        status: "pending",
        source,
        sourceDetail: asString(input.sourceDetail || input.sourceLabel, 300),
        formPath,
        provider: "website",
        providerReference: sourceId ? `${source}:${sourceId}:newsletter` : null,
        occurredAt,
        evidence: {
          requestId: asString(input.requestId, 300),
          disclosureAccepted: true,
        },
      });
      outcomes.email = {
        recorded: true,
        replayed: recorded.replayed,
        sync: await requestBeehiivDoubleOptIn(env, database, recorded.event).catch((error) => ({
          ok: false,
          error: error.message,
        })),
      };
    }
  }
  return outcomes;
}

async function recordWebhookEvent(database, provider, providerEventId, eventType, rawPayload) {
  const eventId = asString(providerEventId, 300);
  if (!eventId) return { replayed: false };
  const now = nowIso();
  const result = await database.prepare(`
    INSERT OR IGNORE INTO crm_outreach_webhook_events(
      id,provider,provider_event_id,event_type,payload_hash,processed_at,created_at
    ) VALUES(?,?,?,?,?,?,?)
  `).bind(
    id("crm-outreach-webhook"),
    provider,
    eventId,
    asString(eventType, 120),
    await sha256(rawPayload),
    now,
    now,
  ).run();
  return { replayed: Number(result?.meta?.changes || 0) === 0 };
}

function latestConsentJoinSql(channelAlias = "i") {
  const channel = channelAlias === "i" ? "email" : "sms";
  const purpose = purposeForChannel(channel);
  return `(SELECT ce.id FROM crm_consent_events ce
    WHERE ce.channel='${channel}' AND ce.purpose='${purpose}'
      AND ce.normalized_value=${channelAlias}.normalized_value
    ORDER BY ce.occurred_at DESC,ce.created_at DESC,ce.id DESC LIMIT 1)`;
}

function audienceFilters(body = {}) {
  const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
    ? body.filters
    : body;
  const where = [
    "p.merged_into_id IS NULL",
    "p.relationship_status NOT IN ('merged','archived','suppressed')",
    "p.eligibility_at IS NOT NULL",
    "p.archived_at IS NULL",
  ];
  const values = [];
  const tier = Number(filters.tier);
  if ([1, 2, 3].includes(tier)) {
    where.push("p.tier=?");
    values.push(tier);
  }
  const tag = asString(filters.tag, 100).toLowerCase();
  if (tag) {
    where.push(`EXISTS(
      SELECT 1 FROM crm_person_tags pt JOIN crm_tags tg ON tg.id=pt.tag_id
      WHERE pt.person_id=p.id AND (LOWER(tg.slug)=? OR LOWER(tg.name)=?)
    )`);
    values.push(tag, tag);
  }
  const nodeId = asString(filters.nodeId || filters.node, 120);
  if (nodeId) {
    where.push(`(
      EXISTS(SELECT 1 FROM crm_interactions x WHERE x.person_id=p.id AND x.active=1 AND x.node_id=?)
      OR EXISTS(SELECT 1 FROM crm_transactions t WHERE t.person_id=p.id AND t.active=1 AND t.node_id=?)
      OR (?='node-events' AND EXISTS(SELECT 1 FROM crm_attendance a WHERE a.person_id=p.id AND a.active=1))
    )`);
    values.push(nodeId, nodeId, nodeId);
  }
  const interactionType = asString(filters.interactionType || filters.interaction, 120);
  if (interactionType) {
    where.push(`EXISTS(
      SELECT 1 FROM crm_interactions x
      WHERE x.person_id=p.id AND x.active=1 AND x.interaction_type=?
    )`);
    values.push(interactionType);
  }
  const eventId = asString(filters.eventId, 160);
  if (eventId) {
    where.push(`EXISTS(
      SELECT 1 FROM crm_attendance a
      WHERE a.person_id=p.id AND a.active=1 AND a.event_id=?
    )`);
    values.push(eventId);
  }
  const minSpendCents = Number(filters.minSpendCents);
  if (Number.isFinite(minSpendCents) && minSpendCents > 0) {
    where.push(`(
      SELECT COALESCE(SUM(CASE
        WHEN t.transaction_type='charge' AND t.status='settled' THEN t.amount_cents
        WHEN t.transaction_type='refund' AND t.status='settled' THEN -t.amount_cents
        WHEN t.transaction_type='adjustment' AND t.status='settled' THEN t.amount_cents
        ELSE 0 END),0)
      FROM crm_transactions t WHERE t.person_id=p.id AND t.active=1
    )>=?`);
    values.push(Math.floor(minSpendCents));
  }
  return {
    filters: {
      tier: [1, 2, 3].includes(tier) ? tier : null,
      tag,
      nodeId,
      interactionType,
      eventId,
      minSpendCents: Number.isFinite(minSpendCents) && minSpendCents > 0 ? Math.floor(minSpendCents) : 0,
    },
    where,
    values,
  };
}

function exclusionLabel(reason) {
  const labels = {
    missing_email: "Missing email",
    missing_phone: "Missing phone",
    no_consent: "No consent",
    pending_confirmation: "Pending confirmation",
    unsubscribed: "Unsubscribed",
    suppressed: "Suppressed",
  };
  return labels[reason] || "Excluded";
}

async function buildAudience(database, channel, body = {}) {
  if (!CHANNELS.has(channel)) throw new Error("Campaign channel is invalid.");
  const { filters, where, values } = audienceFilters(body);
  const kind = channel === "email" ? "email" : "phone";
  const candidates = await database.prepare(`
    SELECT p.id person_id,p.display_name,p.preferred_name,p.tier,
      p.preferred_contact_method,
      (SELECT i.normalized_value FROM crm_identities i
        WHERE i.person_id=p.id AND i.kind=? AND i.active=1
        ORDER BY i.is_primary DESC,i.is_verified DESC,i.created_at LIMIT 1) normalized_value
    FROM crm_people p
    WHERE ${where.join(" AND ")}
    ORDER BY p.display_name COLLATE NOCASE
    LIMIT ${MAX_AUDIENCE}
  `).bind(kind, ...values).all();
  const eligible = [];
  const excluded = [];
  for (const candidate of candidates.results || []) {
    const normalizedValue = normalizeContact(channel, candidate.normalized_value);
    let reason = "";
    let consent = null;
    if (!normalizedValue) {
      reason = channel === "email" ? "missing_email" : "missing_phone";
    } else {
      const [suppression, latest] = await Promise.all([
        activeSuppression(database, channel, normalizedValue),
        latestConsent(database, channel, normalizedValue),
      ]);
      consent = latest;
      if (suppression) {
        reason = "suppressed";
      } else if (latest?.status === "revoked") {
        reason = "unsubscribed";
      } else if (channel === "email") {
        const subscription = await database.prepare(`
          SELECT * FROM crm_marketing_subscriptions
          WHERE provider='beehiiv' AND email=? AND active=1
          ORDER BY updated_at DESC LIMIT 1
        `).bind(normalizedValue).first();
        if (subscription?.status === "unsubscribed") reason = "unsubscribed";
        else if (subscription?.status !== "subscribed") {
          reason = latest?.status === "pending" || latest?.status === "granted"
            ? "pending_confirmation"
            : "no_consent";
        }
      } else if (latest?.status !== "granted") {
        reason = latest?.status === "pending" ? "pending_confirmation" : "no_consent";
      }
    }
    const item = {
      personId: candidate.person_id,
      name: candidate.preferred_name || candidate.display_name || normalizedValue,
      normalizedValue,
      consentEventId: consent?.id || null,
      consentStatus: consent?.status || "unknown",
      ...(reason ? { reason, reasonLabel: exclusionLabel(reason) } : {}),
    };
    if (reason) excluded.push(item);
    else eligible.push(item);
  }
  const version = await sha256(JSON.stringify({
    channel,
    filters,
    recipients: eligible.map((item) => [item.personId, item.normalizedValue, item.consentEventId]),
  }));
  const exclusions = excluded.reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
  return {
    channel,
    filters,
    audienceVersion: version,
    eligible,
    excluded,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    exclusions,
  };
}

async function campaignById(database, campaignId) {
  const row = await database.prepare("SELECT * FROM crm_outreach_campaigns WHERE id=?").bind(campaignId).first();
  if (!row) return null;
  return { ...row, segment: safeJson(row.segment_json, {}) };
}

function campaignView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    purpose: row.purpose,
    subject: row.subject,
    bodyText: row.body_text,
    filters: safeJson(row.segment_json, {}),
    status: row.status,
    provider: row.provider,
    providerReference: row.provider_reference || "",
    audienceVersion: row.audience_version || "",
    recipientCount: Number(row.recipient_count || 0),
    excludedCount: Number(row.excluded_count || 0),
    scheduledAt: row.scheduled_at || null,
    preparedAt: row.prepared_at || null,
    completedAt: row.completed_at || null,
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function replaceCampaignRecipients(database, campaignId, audience, statusForEligible = "eligible") {
  const now = nowIso();
  const statements = [
    database.prepare("DELETE FROM crm_outreach_recipients WHERE campaign_id=?").bind(campaignId),
  ];
  for (const recipient of audience.eligible) {
    statements.push(database.prepare(`
      INSERT INTO crm_outreach_recipients(
        id,campaign_id,person_id,channel,normalized_value,consent_event_id,
        status,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?, ?,?)
    `).bind(
      id("crm-outreach-recipient"),
      campaignId,
      recipient.personId,
      audience.channel,
      recipient.normalizedValue,
      recipient.consentEventId,
      statusForEligible,
      now,
      now,
    ));
  }
  for (const recipient of audience.excluded) {
    statements.push(database.prepare(`
      INSERT INTO crm_outreach_recipients(
        id,campaign_id,person_id,channel,normalized_value,consent_event_id,
        status,exclusion_reason,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'excluded',?,?,?)
    `).bind(
      id("crm-outreach-recipient"),
      campaignId,
      recipient.personId,
      audience.channel,
      recipient.normalizedValue || "",
      recipient.consentEventId,
      recipient.reason,
      now,
      now,
    ));
  }
  await database.batch(statements);
}

async function handleOutreachStatus(env, database) {
  const counts = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM crm_consent_events) consent_events,
      (SELECT COUNT(*) FROM crm_outreach_campaigns) campaigns,
      (SELECT COUNT(*) FROM crm_communications) communications,
      (SELECT COUNT(*) FROM crm_outreach_recipients
        WHERE status IN ('queued','sending')) queued_messages
  `).first();
  return json({
    features: {
      consentSync: featureEnabled(env, "OUTREACH_CONSENT_SYNC_ENABLED"),
      individualEmail: featureEnabled(env, "OUTREACH_INDIVIDUAL_EMAIL_ENABLED"),
      emailCampaigns: featureEnabled(env, "OUTREACH_EMAIL_CAMPAIGNS_ENABLED"),
      publicPreferences: featureEnabled(env, "OUTREACH_PREFERENCES_ENABLED"),
    },
    providers: {
      beehiiv: {
        configured: beehiivConfigured(env),
        publicationId: beehiivPublicationId(env),
        doubleOptIn: true,
      },
    },
    counts: {
      consentEvents: Number(counts?.consent_events || 0),
      campaigns: Number(counts?.campaigns || 0),
      communications: Number(counts?.communications || 0),
      queuedMessages: Number(counts?.queued_messages || 0),
    },
  });
}

async function handleManualConsent(request, env, database, personId) {
  const person = await database.prepare(`
    SELECT * FROM crm_people
    WHERE id=? AND merged_into_id IS NULL AND relationship_status!='merged'
  `).bind(personId).first();
  if (!person) return failure("Person not found.", 404);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const channel = asString(body.channel, 20).toLowerCase();
  if (!CHANNELS.has(channel)) return failure("Only email newsletter consent can be recorded. Historical text-message consent is read-only.", 400);
  const sourceMethod = asString(body.sourceMethod || body.source, 40).toLowerCase();
  if (!["in_person", "phone", "paper", "provider"].includes(sourceMethod)) {
    return failure("Consent source must be in person, phone, paper, or provider.", 400);
  }
  if (!bool(body.confirmed)) {
    return failure("Confirm that the customer explicitly agreed to this channel.", 400);
  }
  const kind = "email";
  const contact = normalizeContact(channel, body.value) || (await database.prepare(`
    SELECT normalized_value FROM crm_identities
    WHERE person_id=? AND kind=? AND active=1
    ORDER BY is_primary DESC,is_verified DESC,created_at LIMIT 1
  `).bind(person.id, kind).first())?.normalized_value;
  if (!contact) return failure("This person needs a valid email.", 400);
  const occurredAt = asString(body.consentAt, 80);
  if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
    return failure("Consent date is required.", 400);
  }
  const recorded = await recordConsentEvent(database, {
    personId: person.id,
    channel,
    value: contact,
    status: channel === "email" ? "pending" : "granted",
    source: `studio_${sourceMethod}`,
    sourceDetail: sourceMethod.replace(/_/g, " "),
    provider: "studio",
    providerReference: asString(body.requestId, 300) || `studio:${crypto.randomUUID()}`,
    occurredAt: new Date(occurredAt).toISOString(),
    evidence: { confirmedByStudio: true, sourceMethod },
  });
  const sync = channel === "email"
    ? await requestBeehiivDoubleOptIn(env, database, recorded.event).catch((error) => ({ ok: false, error: error.message }))
    : { ok: true, skipped: true };
  return json({ consent: recorded.event, sync }, { status: 201 });
}

async function handleListPersonCommunications(database, personId) {
  const person = await database.prepare("SELECT id FROM crm_people WHERE id=?").bind(personId).first();
  if (!person) return failure("Person not found.", 404);
  const [consents, communications] = await Promise.all([
    database.prepare(`
      SELECT * FROM crm_consent_events
      WHERE person_id=? ORDER BY occurred_at DESC,created_at DESC LIMIT 250
    `).bind(personId).all(),
    database.prepare(`
      SELECT * FROM crm_communications
      WHERE person_id=? ORDER BY created_at DESC LIMIT 250
    `).bind(personId).all(),
  ]);
  return json({
    consents: consents.results || [],
    communications: communications.results || [],
  });
}

async function handleAudiencePreview(request, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const channel = asString(parsed.body.channel, 20).toLowerCase();
  try {
    return json(await buildAudience(database, channel, parsed.body));
  } catch (error) {
    return failure(error.message, 400);
  }
}

async function handleListCampaigns(database) {
  const result = await database.prepare(`
    SELECT * FROM crm_outreach_campaigns
    ORDER BY updated_at DESC LIMIT 250
  `).all();
  return json({ campaigns: (result.results || []).map(campaignView) });
}

async function handleCreateCampaign(request, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const channel = asString(body.channel, 20).toLowerCase();
  if (!CHANNELS.has(channel)) return failure("Only email campaigns are supported.", 400);
  const name = asString(body.name, 200);
  if (!name) return failure("Campaign name is required.", 400);
  const subject = asString(body.subject, 300);
  const bodyText = asString(body.bodyText || body.body, 5000);
  if (channel === "email" && !subject) return failure("Email subject is required.", 400);
  if (!bodyText) return failure("Campaign message is required.", 400);
  const { filters } = audienceFilters(body);
  const now = nowIso();
  const campaignId = id("crm-outreach-campaign");
  await database.prepare(`
    INSERT INTO crm_outreach_campaigns(
      id,name,channel,purpose,subject,body_text,segment_json,status,provider,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)
  `).bind(
    campaignId,
    name,
    channel,
    purposeForChannel(channel),
    subject,
    bodyText,
    JSON.stringify(filters),
    providerForChannel(channel),
    now,
    now,
  ).run();
  return json({ campaign: campaignView(await campaignById(database, campaignId)) }, { status: 201 });
}

async function handleGetCampaign(database, campaignId) {
  const campaign = await campaignById(database, campaignId);
  if (!campaign) return failure("Campaign not found.", 404);
  const recipients = await database.prepare(`
    SELECT r.*,p.display_name,p.preferred_name
    FROM crm_outreach_recipients r
    LEFT JOIN crm_people p ON p.id=r.person_id
    WHERE r.campaign_id=?
    ORDER BY CASE r.status WHEN 'excluded' THEN 1 ELSE 0 END,
      COALESCE(p.preferred_name,p.display_name,r.normalized_value)
    LIMIT 20000
  `).bind(campaignId).all();
  return json({
    campaign: campaignView(campaign),
    recipients: recipients.results || [],
  });
}

async function handleUpdateCampaign(request, database, campaignId) {
  const campaign = await campaignById(database, campaignId);
  if (!campaign) return failure("Campaign not found.", 404);
  if (!["draft", "reviewed"].includes(campaign.status)) {
    return failure("Only draft or reviewed campaigns can be edited.", 409);
  }
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const name = Object.prototype.hasOwnProperty.call(body, "name") ? asString(body.name, 200) : campaign.name;
  const subject = Object.prototype.hasOwnProperty.call(body, "subject") ? asString(body.subject, 300) : campaign.subject;
  const bodyText = Object.prototype.hasOwnProperty.call(body, "bodyText") || Object.prototype.hasOwnProperty.call(body, "body")
    ? asString(body.bodyText || body.body, 5000)
    : campaign.body_text;
  if (!name || !bodyText || (campaign.channel === "email" && !subject)) {
    return failure("Campaign name, message, and email subject when applicable are required.", 400);
  }
  const { filters } = audienceFilters(body.filters ? body : { filters: campaign.segment });
  const now = nowIso();
  await database.prepare(`
    UPDATE crm_outreach_campaigns
    SET name=?,subject=?,body_text=?,segment_json=?,status='draft',
        audience_version='',recipient_count=0,excluded_count=0,updated_at=?
    WHERE id=?
  `).bind(name, subject, bodyText, JSON.stringify(filters), now, campaignId).run();
  await database.prepare("DELETE FROM crm_outreach_recipients WHERE campaign_id=?").bind(campaignId).run();
  return json({ campaign: campaignView(await campaignById(database, campaignId)) });
}

async function handleReviewCampaign(database, campaignId) {
  const campaign = await campaignById(database, campaignId);
  if (!campaign) return failure("Campaign not found.", 404);
  if (!["draft", "reviewed"].includes(campaign.status)) {
    return failure("This campaign can no longer be reviewed.", 409);
  }
  const audience = await buildAudience(database, campaign.channel, { filters: campaign.segment });
  await replaceCampaignRecipients(database, campaignId, audience);
  const now = nowIso();
  await database.prepare(`
    UPDATE crm_outreach_campaigns
    SET status='reviewed',audience_version=?,recipient_count=?,excluded_count=?,
        error='',updated_at=?
    WHERE id=?
  `).bind(
    audience.audienceVersion,
    audience.eligibleCount,
    audience.excludedCount,
    now,
    campaignId,
  ).run();
  return json({
    campaign: campaignView(await campaignById(database, campaignId)),
    audience,
  });
}

async function currentReviewedAudience(database, campaign, suppliedVersion) {
  if (campaign.status !== "reviewed") {
    return { error: failure("Review the campaign audience immediately before continuing.", 409) };
  }
  if (!suppliedVersion || suppliedVersion !== campaign.audience_version) {
    return { error: failure("The reviewed audience version is missing or stale.", 409) };
  }
  const audience = await buildAudience(database, campaign.channel, { filters: campaign.segment });
  if (audience.audienceVersion !== campaign.audience_version) {
    return {
      error: failure("The audience changed after review. Review it again before continuing.", 409, {
        currentAudienceVersion: audience.audienceVersion,
      }),
    };
  }
  return { audience };
}

async function createBeehiivSegment(env, campaign, audience) {
  const publicationId = beehiivPublicationId(env);
  const payload = await beehiivRequest(env, `/v2/publications/${encodeURIComponent(publicationId)}/segments`, {
    method: "POST",
    body: JSON.stringify({
      name: `${campaign.name} · ${campaign.id.slice(-8)}`,
      input: {
        type: "emails",
        emails: audience.eligible.map((recipient) => recipient.normalizedValue),
      },
    }),
  });
  return payload?.data || {};
}

async function handlePrepareBeehiivCampaign(request, env, database, campaignId) {
  const campaign = await campaignById(database, campaignId);
  if (!campaign) return failure("Campaign not found.", 404);
  if (campaign.channel !== "email") return failure("Only email campaigns prepare a Beehiiv segment.", 400);
  if (!featureEnabled(env, "OUTREACH_EMAIL_CAMPAIGNS_ENABLED")) {
    return failure("Email campaign preparation is disabled until Beehiiv rollout is approved.", 503);
  }
  if (!beehiivConfigured(env)) return failure("Beehiiv is not configured.", 503);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const reviewed = await currentReviewedAudience(database, campaign, asString(parsed.body.audienceVersion, 200));
  if (reviewed.error) return reviewed.error;
  if (!reviewed.audience.eligibleCount) return failure("This campaign has no eligible recipients.", 409);
  try {
    const segment = await createBeehiivSegment(env, campaign, reviewed.audience);
    const now = nowIso();
    await database.prepare(`
      UPDATE crm_outreach_campaigns
      SET status='prepared',provider_reference=?,prepared_at=?,error='',updated_at=?
      WHERE id=?
    `).bind(asString(segment.id, 300), now, now, campaignId).run();
    return json({
      campaign: campaignView(await campaignById(database, campaignId)),
      beehiiv: {
        segmentId: asString(segment.id, 300),
        segmentName: asString(segment.name, 300),
        status: asString(segment.status, 80),
      },
    });
  } catch (error) {
    await database.prepare(`
      UPDATE crm_outreach_campaigns SET error=?,updated_at=? WHERE id=?
    `).bind(asString(error.message, 2000), nowIso(), campaignId).run();
    return failure("Unable to prepare the Beehiiv segment.", 502, { detail: error.message });
  }
}

async function followupEligibility(database, personId, channel) {
  if (!CHANNELS.has(channel)) return { eligible: false, reason: "invalid_channel" };
  const person = await database.prepare(`
    SELECT * FROM crm_people
    WHERE id=? AND merged_into_id IS NULL AND relationship_status NOT IN ('merged','archived','suppressed')
      AND eligibility_at IS NOT NULL AND archived_at IS NULL
  `).bind(personId).first();
  if (!person) return { eligible: false, reason: "person_not_eligible" };
  if (person.preferred_contact_method === "none") {
    return { eligible: false, reason: "do_not_contact", person };
  }
  const kind = "email";
  const identity = await database.prepare(`
    SELECT * FROM crm_identities
    WHERE person_id=? AND kind=? AND active=1
    ORDER BY is_primary DESC,is_verified DESC,created_at LIMIT 1
  `).bind(personId, kind).first();
  const destination = normalizeContact(channel, identity?.normalized_value || identity?.value);
  if (!destination) return { eligible: false, reason: "missing_email", person };
  const suppression = await activeSuppression(database, channel, destination);
  if (suppression) return { eligible: false, reason: "suppressed", person, destination };
  const interaction = await database.prepare(`
    SELECT id FROM crm_interactions
    WHERE person_id=? AND active=1
    ORDER BY occurred_at DESC,created_at DESC LIMIT 1
  `).bind(personId).first();
  if (!interaction) return { eligible: false, reason: "no_customer_interaction", person, destination };
  return { eligible: true, person, destination };
}

async function campaignRecipientEligibility(database, communication) {
  const person = await database.prepare(`
    SELECT * FROM crm_people
    WHERE id=? AND merged_into_id IS NULL
      AND relationship_status NOT IN ('merged','archived','suppressed')
      AND eligibility_at IS NOT NULL AND archived_at IS NULL
  `).bind(communication.person_id).first();
  if (!person) return { eligible: false, reason: "person_not_eligible" };
  const destination = normalizeContact(communication.channel, communication.normalized_destination);
  if (!destination) return { eligible: false, reason: "missing_contact" };
  if (await activeSuppression(database, communication.channel, destination)) {
    return { eligible: false, reason: "suppressed" };
  }
  return { eligible: true, person, destination };
}

async function handleFollowupPreview(request, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const personId = asString(parsed.body.personId, 200);
  const channel = asString(parsed.body.channel, 20).toLowerCase();
  if (!personId) return failure("Person is required.", 400);
  const eligibility = await followupEligibility(database, personId, channel);
  return json({
    eligible: eligibility.eligible,
    reason: eligibility.reason || "",
    person: eligibility.person ? {
      id: eligibility.person.id,
      name: eligibility.person.preferred_name || eligibility.person.display_name,
      preferredContactMethod: eligibility.person.preferred_contact_method || "",
    } : null,
    destination: eligibility.destination || "",
    channel,
  });
}

async function markFollowupDone(database, followupId) {
  if (!followupId) return;
  const now = nowIso();
  await database.prepare(`
    UPDATE crm_followups
    SET status='done',completed_at=COALESCE(completed_at,?),updated_at=?
    WHERE id=? AND status='open'
  `).bind(now, now, followupId).run();
}

async function updateCommunicationResult(database, communication, result) {
  const now = nowIso();
  const status = result.ok ? "accepted" : result.suppressed ? "suppressed" : "failed";
  await database.prepare(`
    UPDATE crm_communications
    SET status=?,provider_message_id=COALESCE(?,provider_message_id),error=?,
        accepted_at=CASE WHEN ?='accepted' THEN ? ELSE accepted_at END,
        updated_at=?
    WHERE id=?
  `).bind(
    status,
    asString(result.providerMessageId, 300) || null,
    asString(result.error, 2000),
    status,
    now,
    now,
    communication.id,
  ).run();
  if (communication.campaign_id) {
    await database.prepare(`
      UPDATE crm_outreach_recipients
      SET status=?,provider_message_id=COALESCE(?,provider_message_id),error=?,
          sent_at=CASE WHEN ?='accepted' THEN ? ELSE sent_at END,updated_at=?
      WHERE campaign_id=? AND normalized_value=?
    `).bind(
      status,
      asString(result.providerMessageId, 300) || null,
      asString(result.error, 2000),
      status,
      now,
      now,
      communication.campaign_id,
      communication.normalized_destination,
    ).run();
  }
  if (result.ok && communication.followup_id) await markFollowupDone(database, communication.followup_id);
  return { status, now };
}

async function sendCommunication(env, database, communication) {
  const recheck = communication.campaign_id
    ? await campaignRecipientEligibility(database, communication)
    : await followupEligibility(database, communication.person_id, communication.channel);
  if (!recheck.eligible || recheck.destination !== communication.normalized_destination) {
    const reason = recheck.reason || "audience_changed";
    await updateCommunicationResult(database, communication, {
      ok: false,
      suppressed: ["suppressed", "unsubscribed", "do_not_contact"].includes(reason),
      error: `Recipient excluded at send time: ${reason}.`,
    });
    return { ok: false, skipped: true, reason };
  }
  if (communication.channel !== "email") {
    return updateCommunicationResult(database, communication, {
      ok: false,
      error: "Automated text-message outreach has been removed. Historical records are read-only.",
    });
  }
  if (!featureEnabled(env, "OUTREACH_INDIVIDUAL_EMAIL_ENABLED")) {
    await updateCommunicationResult(database, communication, {
      ok: false,
      error: "Individual outreach email is disabled.",
    });
    return { ok: false, error: "Individual outreach email is disabled." };
  }
  const result = await sendCrmFollowupEmail(env, {
    to: communication.normalized_destination,
    subject: communication.subject,
    preheader: communication.preheader,
    emailTheme: communication.email_theme,
    text: communication.body_text,
    personId: communication.person_id,
    communicationId: communication.id,
    idempotencyKey: communication.idempotency_key,
  });
  await updateCommunicationResult(database, communication, {
    ok: Boolean(result?.ok),
    error: result?.error || "",
    providerMessageId: result?.response?.messageId || result?.response?.id || "",
  });
  return result;
}

async function handleSendFollowup(request, env, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const personId = asString(body.personId, 200);
  const channel = asString(body.channel, 20).toLowerCase();
  const subject = asString(body.subject, 300);
  const preheader = asString(body.preheader, 300);
  const emailTheme = asString(body.emailTheme, 40) === "tattoo" ? "tattoo" : "construct_studio";
  const message = asString(body.bodyText || body.body || body.message, 10_000);
  const followupId = asString(body.followupId, 200) || null;
  const requestId = asString(body.requestId, 300);
  if (!personId || !CHANNELS.has(channel) || !message || !requestId) {
    return failure("Person, channel, message, and request id are required.", 400);
  }
  if (channel === "email" && !subject) return failure("Email subject is required.", 400);
  const idempotencyKey = `followup:${personId}:${channel}:${requestId}`;
  const existing = await database.prepare(`
    SELECT * FROM crm_communications WHERE idempotency_key=?
  `).bind(idempotencyKey).first();
  if (existing) {
    const expectedBody = message;
    if (
      existing.subject !== subject
      || existing.body_text !== expectedBody
      || asString(existing.preheader) !== preheader
      || asString(existing.email_theme || "construct_studio") !== emailTheme
      || (existing.followup_id || null) !== followupId
    ) {
      return failure("That request id was already used for a different follow-up.", 409);
    }
    if (["accepted", "delivered"].includes(existing.status)) {
      return json({ communication: existing, replayed: true });
    }
    if (existing.status === "scheduled") {
      return json({ communication: existing, scheduled: true, replayed: true }, { status: 202 });
    }
  }
  const eligibility = await followupEligibility(database, personId, channel);
  if (!eligibility.eligible) {
    return failure(`This follow-up cannot be sent: ${eligibility.reason || "recipient is not eligible"}.`, 409);
  }
  if (followupId) {
    const followup = await database.prepare(`
      SELECT * FROM crm_followups WHERE id=? AND person_id=?
    `).bind(followupId, personId).first();
    if (!followup || followup.status !== "open") return failure("The selected follow-up is not open.", 409);
  }
  const scheduledValue = asString(body.scheduledAt, 80);
  const scheduledAt = scheduledValue ? new Date(scheduledValue).toISOString() : null;
  if (scheduledValue && Number.isNaN(new Date(scheduledAt).getTime())) return failure("Scheduled time is invalid.", 400);
  const now = nowIso();
  const communicationId = id("crm-communication");
  await database.prepare(`
    INSERT OR IGNORE INTO crm_communications(
      id,person_id,followup_id,channel,purpose,direction,provider,
      normalized_destination,subject,preheader,email_theme,body_text,status,idempotency_key,
      scheduled_at,created_at,updated_at
    ) VALUES(?,?,?,?,'relationship','outbound',?,?,?,?,?,?,?,?, ?,?,?)
  `).bind(
    communicationId,
    personId,
    followupId,
    channel,
    providerForChannel(channel),
    eligibility.destination,
    subject,
    preheader,
    emailTheme,
    message,
    scheduledAt && new Date(scheduledAt).getTime() > Date.now() ? "scheduled" : "queued",
    idempotencyKey,
    scheduledAt,
    now,
    now,
  ).run();
  const communication = await database.prepare(`
    SELECT * FROM crm_communications WHERE idempotency_key=?
  `).bind(idempotencyKey).first();
  if (!communication) return failure("Unable to create the follow-up delivery.", 500);
  if (communication.status === "accepted" || communication.status === "delivered") {
    return json({ communication, replayed: true });
  }
  if (communication.status === "scheduled") return json({ communication, scheduled: true }, { status: 202 });
  const result = await sendCommunication(env, database, communication);
  const updated = await database.prepare("SELECT * FROM crm_communications WHERE id=?").bind(communication.id).first();
  return json({ communication: updated, delivery: result }, { status: result?.ok ? 200 : 502 });
}

async function acquireOutreachLease(database, leaseKey, owner, ttlSeconds = 240) {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO crm_outreach_leases(lease_key,owner,expires_at,updated_at)
    VALUES(?,?,?,?)
  `).bind(leaseKey, owner, expiresAt, now).run();
  await database.prepare(`
    UPDATE crm_outreach_leases
    SET owner=?,expires_at=?,updated_at=?
    WHERE lease_key=? AND (owner=? OR expires_at<=?)
  `).bind(owner, expiresAt, now, leaseKey, owner, now).run();
  const row = await database.prepare(`
    SELECT owner FROM crm_outreach_leases WHERE lease_key=?
  `).bind(leaseKey).first();
  return row?.owner === owner;
}

async function releaseOutreachLease(database, leaseKey, owner) {
  await database.prepare(`
    UPDATE crm_outreach_leases SET expires_at=?,updated_at=?
    WHERE lease_key=? AND owner=?
  `).bind(nowIso(), nowIso(), leaseKey, owner).run();
}

export async function processDueOutreach(env) {
  const database = requireDb(env);
  const owner = crypto.randomUUID();
  if (!await acquireOutreachLease(database, "outreach-send", owner)) {
    return { ok: true, skipped: true, reason: "lease_active" };
  }
  let processed = 0;
  let accepted = 0;
  let failed = 0;
  try {
    const due = await database.prepare(`
      SELECT * FROM crm_communications
      WHERE status IN ('scheduled','queued')
        AND (scheduled_at IS NULL OR scheduled_at<=?)
      ORDER BY COALESCE(scheduled_at,created_at),created_at
      LIMIT ${QUEUE_BATCH_SIZE}
    `).bind(nowIso()).all();
    for (const communication of due.results || []) {
      const claimed = await database.prepare(`
        UPDATE crm_communications SET status='queued',updated_at=?
        WHERE id=? AND status IN ('scheduled','queued')
      `).bind(nowIso(), communication.id).run();
      if (Number(claimed?.meta?.changes || 0) !== 1) continue;
      const result = await sendCommunication(env, database, { ...communication, status: "queued" });
      processed += 1;
      if (result?.ok) accepted += 1;
      else failed += 1;
    }
    return { ok: true, processed, accepted, failed };
  } finally {
    await releaseOutreachLease(database, "outreach-send", owner);
  }
}

function maskContact(kind, value) {
  if (kind === "email") {
    const [local = "", domain = ""] = String(value).split("@");
    return `${local.slice(0, 2)}${local.length > 2 ? "•••" : ""}@${domain}`;
  }
  const digits = String(value).replace(/\D/g, "");
  return `••• ••• ${digits.slice(-4)}`;
}

async function preferenceTokenRecord(database, rawToken) {
  const tokenHash = await sha256(rawToken);
  return database.prepare(`
    SELECT * FROM crm_preference_tokens
    WHERE token_hash=? AND expires_at>? LIMIT 1
  `).bind(tokenHash, nowIso()).first();
}

async function handlePreferenceRequest(request, env, database) {
  if (!featureEnabled(env, "OUTREACH_PREFERENCES_ENABLED")) {
    return failure("Communication preferences are not enabled yet.", 503);
  }
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const email = normalizeEmail(parsed.body.email);
  if (!email) return failure("Provide one valid email address.", 400);
  const contactKind = "email";
  const normalizedValue = email;
  const rawToken = randomToken();
  const tokenId = id("crm-preference-token");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await database.prepare(`
    INSERT INTO crm_preference_tokens(
      id,contact_kind,normalized_value,token_hash,expires_at,created_at
    ) VALUES(?,?,?,?,?,?)
  `).bind(tokenId, contactKind, normalizedValue, await sha256(rawToken), expiresAt, now).run();
  const url = new URL("/preferences/", asString(env.PUBLIC_SITE_URL, 500) || request.url);
  url.searchParams.set("token", rawToken);
  const delivery = await sendCommunicationPreferencesLink(env, {
    to: normalizedValue,
    url: url.toString(),
    tokenId,
    idempotencyKey: `crm_communication_preferences:${tokenId}`,
  });
  if (!delivery?.ok) {
    await database.prepare("DELETE FROM crm_preference_tokens WHERE id=?").bind(tokenId).run();
    return failure("Unable to send the secure preferences link.", 503, { detail: delivery?.error || "" });
  }
  return json({
    ok: true,
    message: `A secure preferences link was sent to ${maskContact(contactKind, normalizedValue)}.`,
    expiresAt,
  });
}

async function preferenceState(database, token) {
  const channel = token.contact_kind === "email" ? "email" : "sms";
  const [consent, suppression, subscription] = await Promise.all([
    latestConsent(database, channel, token.normalized_value),
    activeSuppression(database, channel, token.normalized_value),
    channel === "email"
      ? database.prepare(`
          SELECT * FROM crm_marketing_subscriptions
          WHERE provider='beehiiv' AND email=? AND active=1
          ORDER BY updated_at DESC LIMIT 1
        `).bind(token.normalized_value).first()
      : Promise.resolve(null),
  ]);
  const status = suppression || consent?.status === "revoked" || subscription?.status === "unsubscribed"
    ? "revoked"
    : channel === "email" && subscription?.status === "subscribed"
      ? "granted"
      : consent?.status || "unknown";
  return {
    channel,
    contactKind: token.contact_kind,
    maskedContact: maskContact(token.contact_kind, token.normalized_value),
    status,
    expiresAt: token.expires_at,
    disclosure: disclosureForChannel(channel),
  };
}

async function handlePreferenceRead(request, database) {
  const rawToken = asString(new URL(request.url).searchParams.get("token"), 200);
  if (!rawToken) return failure("Preferences token is required.", 400);
  const token = await preferenceTokenRecord(database, rawToken);
  if (!token) return failure("This preferences link is invalid or expired.", 404);
  return json(await preferenceState(database, token));
}

async function handlePreferenceUpdate(request, env, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const rawToken = asString(parsed.body.token, 200);
  const token = await preferenceTokenRecord(database, rawToken);
  if (!token) return failure("This preferences link is invalid or expired.", 404);
  if (token.contact_kind !== "email") {
    return failure("Automated text-message preferences are retained as read-only legacy history.", 409);
  }
  const channel = "email";
  const optedIn = bool(parsed.body.optedIn);
  if (optedIn && !bool(parsed.body.confirmed)) {
    return failure("Confirm the communication disclosure to opt in.", 400);
  }
  const recorded = await recordConsentEvent(database, {
    channel,
    value: token.normalized_value,
    status: optedIn ? (channel === "email" ? "pending" : "granted") : "revoked",
    source: "preferences_page",
    formPath: "/preferences/",
    provider: "website",
    providerReference: `preferences:${token.id}:${optedIn ? "opt-in" : "opt-out"}:${crypto.randomUUID()}`,
    occurredAt: nowIso(),
    evidence: { tokenId: token.id, disclosureAccepted: optedIn },
  });
  let sync = { ok: true, skipped: true };
  if (channel === "email" && optedIn) {
    sync = await requestBeehiivDoubleOptIn(env, database, recorded.event)
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (channel === "email" && !optedIn && featureEnabled(env, "OUTREACH_CONSENT_SYNC_ENABLED") && beehiivConfigured(env)) {
    sync = await beehiivRequest(
      env,
      `/v2/publications/${encodeURIComponent(beehiivPublicationId(env))}/subscriptions/by_email/${encodeURIComponent(token.normalized_value)}`,
      { method: "PUT", body: JSON.stringify({ unsubscribe: true }) },
    ).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message }));
    const subscription = await database.prepare(`
      SELECT * FROM crm_marketing_subscriptions
      WHERE provider='beehiiv' AND email=? AND active=1
      ORDER BY updated_at DESC LIMIT 1
    `).bind(token.normalized_value).first();
    if (subscription) {
      await upsertBeehiivSubscriptionState(database, {
        personId: subscription.person_id,
        publicationId: subscription.publication_id,
        externalId: subscription.external_id,
        email: token.normalized_value,
        status: "unsubscribed",
        occurredAt: nowIso(),
        metadata: { localPreferenceRevocation: true },
      });
    }
  }
  await database.prepare(`
    UPDATE crm_preference_tokens SET used_at=COALESCE(used_at,?) WHERE id=?
  `).bind(nowIso(), token.id).run();
  return json({
    ok: true,
    state: await preferenceState(database, token),
    sync,
  });
}

async function handleBeehiivWebhook(request, env, database) {
  const expected = asString(env.BEEHIIV_WEBHOOK_TOKEN, 500);
  const supplied = asString(new URL(request.url).searchParams.get("token"), 500);
  if (!expected || !(await constantSecretEqual(expected, supplied))) {
    return failure("Unauthorized.", 401);
  }
  const raw = await request.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return failure("Invalid Beehiiv webhook payload.", 400);
  }
  const eventType = asString(payload.event_type, 160);
  const providerEventId = asString(payload.uid, 300) || await sha256(raw);
  const replay = await recordWebhookEvent(database, "beehiiv", providerEventId, eventType, raw);
  if (replay.replayed) return json({ ok: true, replayed: true });
  const data = safeJson(payload.data, {});
  const email = normalizeEmail(data.email);
  if (!email) return json({ ok: true, ignored: true });
  const externalId = asString(data.subscription_id || data.id, 300);
  const occurredAt = Number(payload.event_timestamp)
    ? new Date(Number(payload.event_timestamp) * 1000).toISOString()
    : nowIso();
  const unsubscribed = eventType.includes("unsubscribed") || ["inactive", "unsubscribed"].includes(asString(data.status, 40).toLowerCase());
  const confirmed = eventType.includes("confirmed") || eventType.includes("subscribed");
  if (!unsubscribed && !confirmed) return json({ ok: true, ignored: true });
  const person = await findPersonByContact(database, "email", email);
  await upsertBeehiivSubscriptionState(database, {
    personId: person?.id || null,
    publicationId: beehiivPublicationId(env),
    externalId,
    email,
    status: unsubscribed ? "unsubscribed" : "subscribed",
    occurredAt,
    metadata: { eventType, providerStatus: data.status || "" },
  });
  await recordConsentEvent(database, {
    personId: person?.id || null,
    channel: "email",
    value: email,
    status: unsubscribed ? "revoked" : "granted",
    source: unsubscribed ? "beehiiv_unsubscribe" : "beehiiv_confirmation",
    provider: "beehiiv",
    providerReference: providerEventId,
    occurredAt,
    evidence: { eventType, subscriptionId: externalId },
  });
  return json({ ok: true });
}

async function constantSecretEqual(expected, supplied) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(expected))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(supplied))),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function handlePublicOutreachApi(request, env) {
  let database;
  try {
    database = requireDb(env);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (url.pathname === "/api/outreach/preferences/request") {
      if (method !== "POST") return response405("POST");
      return handlePreferenceRequest(request, env, database);
    }
    if (url.pathname === "/api/outreach/preferences") {
      if (method === "GET") return handlePreferenceRead(request, database);
      if (method === "POST") return handlePreferenceUpdate(request, env, database);
      return response405("GET", "POST");
    }
    if (url.pathname === "/api/outreach/webhooks/beehiiv") {
      if (method !== "POST") return response405("POST");
      return handleBeehiivWebhook(request, env, database);
    }
    return failure("Unknown outreach route.", 404);
  } catch (error) {
    console.error(JSON.stringify({ event: "outreach.public_error", error: error.message }));
    return failure("Unable to process the outreach request.", 500);
  }
}

export async function handleAdminOutreachApi(request, env) {
  const authError = requireStudioAdmin(request, env);
  if (authError) return authError;
  try {
    const database = requireDb(env);
    const url = new URL(request.url);
    const route = url.pathname.split("/").filter(Boolean).slice(4);
    const method = request.method.toUpperCase();
    if (!route.length || route[0] === "status") {
      if (method !== "GET") return response405("GET");
      return handleOutreachStatus(env, database);
    }
    if (route[0] === "audience" && route[1] === "preview") {
      if (method !== "POST") return response405("POST");
      return handleAudiencePreview(request, database);
    }
    if (route[0] === "people" && route[1] && route[2] === "consents") {
      if (method !== "POST") return response405("POST");
      return handleManualConsent(request, env, database, route[1]);
    }
    if (route[0] === "people" && route[1] && route[2] === "communications") {
      if (method !== "GET") return response405("GET");
      return handleListPersonCommunications(database, route[1]);
    }
    if (route[0] === "followups" && route[1] === "preview") {
      if (method !== "POST") return response405("POST");
      return handleFollowupPreview(request, database);
    }
    if (route[0] === "followups" && route[1] === "send") {
      if (method !== "POST") return response405("POST");
      return handleSendFollowup(request, env, database);
    }
    if (route[0] === "campaigns" && !route[1]) {
      if (method === "GET") return handleListCampaigns(database);
      if (method === "POST") return handleCreateCampaign(request, database);
      return response405("GET", "POST");
    }
    if (route[0] === "campaigns" && route[1]) {
      const campaignId = route[1];
      if (!route[2]) {
        if (method === "GET") return handleGetCampaign(database, campaignId);
        if (method === "PATCH") return handleUpdateCampaign(request, database, campaignId);
        return response405("GET", "PATCH");
      }
      if (route[2] === "review") {
        if (method !== "POST") return response405("POST");
        return handleReviewCampaign(database, campaignId);
      }
      if (route[2] === "prepare") {
        if (method !== "POST") return response405("POST");
        return handlePrepareBeehiivCampaign(request, env, database, campaignId);
      }
    }
    return failure("Unknown outreach route.", 404);
  } catch (error) {
    console.error(JSON.stringify({ event: "outreach.admin_error", error: error.message }));
    return failure("Unable to process the outreach request.", 500, { detail: error.message });
  }
}
