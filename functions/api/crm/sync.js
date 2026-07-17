import { getCrmProviderStatus, syncCrmProvider } from "./providers.js";

const SYNC_PROVIDERS = new Set(["square", "shopify", "beehiiv", "substack"]);
const IDENTITY_KINDS = {
  square: "square_customer",
  shopify: "shopify_customer",
  beehiiv: "beehiiv_subscription",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function failure(message, status = 400, details = undefined) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

function text(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return text(value, 320).toLowerCase();
}

function normalizePhone(value) {
  const raw = text(value, 80);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return "";
}

function normalizeCurrency(value) {
  const currency = text(value, 12).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function nowIso() {
  return new Date().toISOString();
}

function recordId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function setSyncConflict(database, {
  provider,
  sourceType,
  sourceId,
  conflicts = [],
  personIds = [],
}) {
  const normalizedProvider = text(provider, 80) || "provider";
  const normalizedSourceType = text(sourceType, 120) || "record";
  const normalizedSourceId = text(sourceId, 300);
  if (!normalizedSourceId) return;
  const attentionSourceId = text(
    `crm-sync-conflict:${normalizedProvider}:${normalizedSourceType}:${normalizedSourceId}`,
    500,
  );
  const now = nowIso();
  const normalizedConflicts = [...new Set(conflicts.map((value) => text(value, 120)).filter(Boolean))];
  if (!normalizedConflicts.length) {
    await database.prepare(`
      UPDATE crm_interactions
      SET status='resolved',active=0,updated_at=?
      WHERE source_provider='system' AND source_type='crm_sync_conflict'
        AND source_id=?
    `).bind(now, attentionSourceId).run();
    return;
  }
  const metadataJson = JSON.stringify({
    conflicts: normalizedConflicts,
    source: {
      provider: normalizedProvider,
      type: normalizedSourceType,
      id: normalizedSourceId,
    },
    personIds: [...new Set(personIds.map((value) => text(value, 200)).filter(Boolean))],
  });
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO crm_interactions(
        id,person_id,node_id,channel,interaction_type,label,status,quantity,
        occurred_at,source_provider,source_type,source_id,metadata_json,
        active,created_at,updated_at
      ) VALUES(
        ?,NULL,NULL,'system','crm_sync_conflict',
        'Provider identity or payment conflict','needs_review',1,?,
        'system','crm_sync_conflict',?,?,1,?,?
      )
    `).bind(
      recordId("crm-interaction"),
      now,
      attentionSourceId,
      metadataJson,
      now,
      now,
    ),
    database.prepare(`
      UPDATE crm_interactions
      SET person_id=NULL,node_id=NULL,channel='system',
        interaction_type='crm_sync_conflict',
        label='Provider identity or payment conflict',
        status='needs_review',quantity=1,occurred_at=?,
        metadata_json=?,active=1,updated_at=?
      WHERE source_provider='system' AND source_type='crm_sync_conflict'
        AND source_id=?
    `).bind(now, metadataJson, now, attentionSourceId),
  ]);
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function tagSlug(value) {
  return text(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readObject(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

async function emailPersonMatch(database, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { personId: null, ambiguous: false, personIds: [] };
  const result = await database.prepare(`
    SELECT DISTINCT COALESCE(p.merged_into_id,p.id) person_id,i.is_shared
    FROM crm_identities i
    JOIN crm_people p ON p.id=i.person_id
    WHERE i.kind='email' AND i.normalized_value=? AND i.active=1
      AND p.anonymized_at IS NULL
  `).bind(normalized).all();
  const ids = [...new Set((result.results || []).map((row) => row.person_id).filter(Boolean))];
  const shared = (result.results || []).some((row) => Boolean(row.is_shared));
  return {
    personId: ids.length === 1 && !shared ? ids[0] : null,
    ambiguous: shared || ids.length > 1,
    personIds: ids,
  };
}

async function providerIdentityPerson(database, provider, externalId) {
  if (!externalId) return null;
  const row = await database.prepare(`
    SELECT COALESCE(p.merged_into_id,p.id) person_id
    FROM crm_identities i
    JOIN crm_people p ON p.id=i.person_id
    WHERE i.provider=? AND i.external_id=? AND i.active=1
    LIMIT 1
  `).bind(provider, externalId).first();
  return row?.person_id || null;
}

async function canonicalPersonId(database, value) {
  let personId = text(value, 200);
  const seen = new Set();
  while (personId && !seen.has(personId)) {
    seen.add(personId);
    const row = await database.prepare(
      "SELECT id,merged_into_id FROM crm_people WHERE id=? LIMIT 1"
    ).bind(personId).first();
    if (!row) return null;
    if (!row.merged_into_id) return row.id;
    personId = text(row.merged_into_id, 200);
  }
  return null;
}

async function emailClaimOwner(database, normalizedEmail) {
  if (!normalizedEmail) return null;
  const row = await database.prepare(`
    SELECT person_id FROM crm_identities
    WHERE provider='crm_email_claim' AND external_id=?
    LIMIT 1
  `).bind(normalizedEmail).first();
  return row?.person_id ? canonicalPersonId(database, row.person_id) : null;
}

async function addEmailClaim(database, personId, normalizedEmail, now) {
  if (!personId || !normalizedEmail) return;
  await database.prepare(`
    INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,'other',?,?,'crm_email_claim',?,'',0,0,0,
      'system','email_claim',NULL,0,?,?)
  `).bind(
    recordId("crm-identity"),
    personId,
    normalizedEmail,
    normalizedEmail,
    normalizedEmail,
    now,
    now,
  ).run();
}

async function convergeFreshProviderPerson(database, losingPersonId, winningPersonId) {
  const losing = await canonicalPersonId(database, losingPersonId);
  const winning = await canonicalPersonId(database, winningPersonId);
  if (!losing || !winning || losing === winning) return winning || losing || null;
  const now = nowIso();
  await database.batch([
    database.prepare(`
      UPDATE OR IGNORE crm_identities
      SET person_id=?,updated_at=?
      WHERE person_id=?
    `).bind(winning, now, losing),
    database.prepare(`
      INSERT OR IGNORE INTO crm_person_tags(person_id,tag_id,source,import_batch_id,created_at)
      SELECT ?,tag_id,source,import_batch_id,created_at
      FROM crm_person_tags WHERE person_id=?
    `).bind(winning, losing),
    database.prepare("DELETE FROM crm_people WHERE id=?").bind(losing),
  ]);
  return winning;
}

async function addIdentity(database, personId, {
  kind,
  value,
  normalizedValue,
  provider,
  externalId = null,
  primary = false,
  verified = false,
  sourceType,
  sourceId,
}) {
  const raw = text(value, 500);
  const normalized = text(normalizedValue, 500);
  if (!personId || !raw || !normalized) return;
  const now = nowIso();
  const existing = await database.prepare(`
    SELECT id FROM crm_identities
    WHERE person_id=? AND kind=? AND normalized_value=? AND active=1
    LIMIT 1
  `).bind(personId, kind, normalized).first();
  if (existing) {
    if (externalId) {
      await database.prepare(`
        UPDATE crm_identities
        SET provider=?,external_id=COALESCE(NULLIF(external_id,''),?),
          is_verified=MAX(is_verified,?),updated_at=?
        WHERE id=?
      `).bind(provider, externalId, verified ? 1 : 0, now, existing.id).run();
    }
    return;
  }
  await database.prepare(`
    INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'',?,?,0,?,?,?,1,?,?)
  `).bind(
    recordId("crm-identity"),
    personId,
    kind,
    raw,
    normalized,
    provider,
    externalId,
    primary ? 1 : 0,
    verified ? 1 : 0,
    provider,
    sourceType,
    sourceId,
    now,
    now,
  ).run();
}

async function addTags(database, personId, tags, provider) {
  const values = [...new Set((Array.isArray(tags) ? tags : [])
    .map((value) => text(value, 100))
    .filter(Boolean))]
    .slice(0, 50);
  for (const name of values) {
    const slug = tagSlug(name);
    if (!slug) continue;
    const now = nowIso();
    await database.prepare(`
      INSERT OR IGNORE INTO crm_tags(id,slug,name,created_at,updated_at)
      VALUES(?,?,?,?,?)
    `).bind(recordId("crm-tag"), slug, name, now, now).run();
    const tag = await database.prepare("SELECT id FROM crm_tags WHERE slug=?").bind(slug).first();
    if (!tag?.id) continue;
    await database.prepare(`
      INSERT OR IGNORE INTO crm_person_tags(person_id,tag_id,source,created_at)
      VALUES(?,?,?,?)
    `).bind(personId, tag.id, provider, now).run();
  }
}

async function enrichProviderPerson(database, personId, {
  provider,
  displayName,
  organization,
}) {
  if (!personId) return;
  const incomingDisplayName = text(displayName, 200);
  const incomingOrganization = text(organization, 200);
  await database.prepare(`
    UPDATE crm_people
    SET display_name=CASE
          WHEN ?!='' AND (
            TRIM(display_name)=''
            OR LOWER(display_name)='construct contact'
            OR LOWER(display_name)=LOWER(?)
            OR EXISTS(
              SELECT 1 FROM crm_identities i
              WHERE i.person_id=crm_people.id AND i.active=1
                AND i.kind IN ('email','phone')
                AND (
                  LOWER(i.value)=LOWER(crm_people.display_name)
                  OR LOWER(i.normalized_value)=LOWER(crm_people.display_name)
                )
            )
          ) THEN ?
          ELSE display_name
        END,
        organization=CASE
          WHEN TRIM(organization)='' AND ?!='' THEN ?
          ELSE organization
        END,
        preferred_contact_method=CASE
          WHEN preferred_contact_method='' AND EXISTS(
            SELECT 1 FROM crm_identities i
            WHERE i.person_id=crm_people.id AND i.kind='email' AND i.active=1
          ) THEN 'email'
          WHEN preferred_contact_method='' AND EXISTS(
            SELECT 1 FROM crm_identities i
            WHERE i.person_id=crm_people.id AND i.kind='phone' AND i.active=1
          ) THEN 'phone'
          ELSE preferred_contact_method
        END,
        updated_at=?
    WHERE id=?
  `).bind(
    incomingDisplayName,
    `${text(provider, 80).toLowerCase()} contact`,
    incomingDisplayName,
    incomingOrganization,
    incomingOrganization,
    nowIso(),
    personId,
  ).run();
}

async function ensureProviderPerson(database, {
  provider,
  externalId,
  displayName,
  organization,
  email,
  additionalEmails = [],
  phone,
  verifiedEmail = false,
  occurredAt,
  tags = [],
  preferredPersonId = null,
  conflictSourceType = "provider_contact",
  conflictSourceId = null,
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedAdditionalEmails = [...new Set(
    (Array.isArray(additionalEmails) ? additionalEmails : [])
      .map((value) => normalizeEmail(value))
      .filter((value) => value && value !== normalizedEmail)
  )].slice(0, 5);
  const normalizedPhone = normalizePhone(phone);
  const preferred = await canonicalPersonId(database, preferredPersonId);
  const providerPersonId = await providerIdentityPerson(database, provider, externalId);
  const emailMatch = await emailPersonMatch(database, normalizedEmail);
  const additionalEmailMatches = [];
  for (const value of normalizedAdditionalEmails) {
    additionalEmailMatches.push({
      value,
      match: await emailPersonMatch(database, value),
    });
  }
  const claimedEmailPersonId = emailMatch.ambiguous
    ? null
    : await emailClaimOwner(database, normalizedEmail);
  const exactAnchors = [...new Set([
    preferred,
    providerPersonId,
    claimedEmailPersonId,
    emailMatch.personId,
    ...additionalEmailMatches.map((entry) => entry.match.personId),
  ].filter(Boolean))];
  const profileAnchors = [...new Set([
    preferred,
    providerPersonId,
    emailMatch.personId,
  ].filter(Boolean))];
  const alternateEmailDisagreement = additionalEmailMatches.some((entry) =>
    !emailMatch.personId ||
    entry.match.ambiguous ||
    entry.match.personId !== emailMatch.personId
  );
  const alternateOwnerConflict = additionalEmailMatches.some((entry) =>
    entry.match.personId &&
    !profileAnchors.includes(entry.match.personId)
  );
  const phoneOnlyNeedsReview = !preferred
    && !providerPersonId
    && !claimedEmailPersonId
    && !emailMatch.personId
    && !externalId
    && !normalizedEmail
    && Boolean(normalizedPhone);
  const conflictRecordId = text(conflictSourceId || externalId, 300);
  if (conflictRecordId) {
    await setSyncConflict(database, {
      provider,
      sourceType: conflictSourceType,
      sourceId: conflictRecordId,
      conflicts: [
        ...(emailMatch.ambiguous ||
          additionalEmailMatches.some((entry) => entry.match.ambiguous)
          ? ["ambiguous_email"]
          : []),
        ...(phoneOnlyNeedsReview ? ["phone_only_identity"] : []),
        ...(alternateEmailDisagreement ? ["alternate_email_disagreement"] : []),
        ...(exactAnchors.length > 1 ? ["exact_identity_anchor_disagreement"] : []),
      ],
      personIds: [
        ...exactAnchors,
        ...(emailMatch.personIds || []),
        ...additionalEmailMatches.flatMap((entry) => entry.match.personIds || []),
      ],
    });
  }
  let personId =
    preferred ||
    providerPersonId ||
    emailMatch.personId ||
    claimedEmailPersonId;
  if (profileAnchors.length > 1 || alternateOwnerConflict) {
    return preferred || providerPersonId || null;
  }
  if (!personId && emailMatch.ambiguous && !externalId) return null;
  if (!personId && phoneOnlyNeedsReview) return null;
  if (!personId && !externalId && !normalizedEmail && !normalizedPhone) return null;

  const now = nowIso();
  let created = false;
  if (!personId) {
    personId = recordId("crm-person");
    created = true;
    await database.prepare(`
      INSERT INTO crm_people(
        id,display_name,organization,relationship_status,preferred_contact_method,
        created_at,updated_at
      ) VALUES(?,?,?,'active',?,?,?)
    `).bind(
      personId,
      text(displayName, 200) || normalizedEmail || normalizedPhone || `${provider} contact`,
      text(organization, 200),
      "",
      occurredAt || now,
      now,
    ).run();
  }
  const kind = IDENTITY_KINDS[provider];
  if (kind && externalId) {
    await addIdentity(database, personId, {
      kind,
      value: externalId,
      normalizedValue: text(externalId, 500).toLowerCase(),
      provider,
      externalId,
      sourceType: "provider_contact",
      sourceId: `${provider}:${externalId}`,
    });
  }
  const emailCandidates = [
    {
      value: normalizedEmail,
      match: emailMatch,
      primary: created,
      sourceType: "provider_email",
    },
    ...(!alternateEmailDisagreement
      ? additionalEmailMatches.map((entry) => ({
          value: entry.value,
          match: entry.match,
          primary: false,
          sourceType: "provider_payment_email",
        }))
      : []),
  ];
  let attachedEmail = false;
  for (const candidate of emailCandidates) {
    const emailMayAttach = candidate.value
      && !candidate.match.ambiguous
      && (!candidate.match.personId || candidate.match.personId === personId);
    if (!emailMayAttach) continue;
    await addEmailClaim(database, personId, candidate.value, now);
    await addIdentity(database, personId, {
      kind: "email",
      value: candidate.value,
      normalizedValue: candidate.value,
      provider,
      primary: candidate.primary,
      verified: verifiedEmail,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceType === "provider_email"
        ? `${provider}:${externalId || candidate.value}:email:${candidate.value}`
        : `${provider}:${externalId || candidate.value}:payment-email:${candidate.value}`,
    });
    attachedEmail = true;
  }
  if (normalizedPhone) {
    await addIdentity(database, personId, {
      kind: "phone",
      value: text(phone, 80),
      normalizedValue: normalizedPhone,
      provider,
      primary: created && !attachedEmail,
      sourceType: "provider_phone",
      sourceId: `${provider}:${externalId || normalizedPhone}:phone:${normalizedPhone}`,
    });
  }
  await addTags(database, personId, tags, provider);
  if (created) {
    const claimedPersonId = normalizedEmail && !emailMatch.ambiguous
      ? await emailClaimOwner(database, normalizedEmail)
      : null;
    const providerOwnerId = await providerIdentityPerson(database, provider, externalId);
    const winningPersonId = claimedPersonId || preferred || providerOwnerId
      || emailMatch.personId || personId;
    if (winningPersonId !== personId) {
      personId = await convergeFreshProviderPerson(database, personId, winningPersonId);
    }
  }
  await enrichProviderPerson(database, personId, {
    provider,
    displayName,
    organization,
  });
  return personId;
}

async function upsertInteraction(database, {
  personId,
  provider,
  sourceType,
  sourceId,
  nodeId = null,
  channel,
  interactionType,
  label = "",
  status = "",
  quantity = 1,
  occurredAt,
  metadata = {},
}) {
  if (!sourceId) return;
  const now = nowIso();
  await database.prepare(`
    INSERT OR IGNORE INTO crm_interactions(
      id,person_id,node_id,channel,interaction_type,label,status,quantity,
      occurred_at,source_provider,source_type,source_id,metadata_json,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).bind(
    recordId("crm-interaction"),
    personId || null,
    nodeId,
    channel || provider,
    interactionType,
    text(label, 500),
    text(status, 80),
    Math.max(1, safeInteger(quantity, 1)),
    occurredAt || now,
    provider,
    sourceType,
    sourceId,
    JSON.stringify(metadata),
    now,
    now,
  ).run();
  await database.prepare(`
    UPDATE crm_interactions
    SET person_id=COALESCE(?,person_id),node_id=COALESCE(?,node_id),
      channel=?,interaction_type=?,label=?,status=?,quantity=?,occurred_at=?,
      metadata_json=?,active=1,updated_at=?
    WHERE source_provider=? AND source_type=? AND source_id=?
  `).bind(
    personId || null,
    nodeId,
    channel || provider,
    interactionType,
    text(label, 500),
    text(status, 80),
    Math.max(1, safeInteger(quantity, 1)),
    occurredAt || now,
    JSON.stringify(metadata),
    now,
    provider,
    sourceType,
    sourceId,
  ).run();
}

async function upsertTransaction(database, {
  personId,
  provider,
  sourceType,
  sourceId,
  nodeId = null,
  transactionType,
  status = "settled",
  amountCents,
  tipCents = 0,
  currency = "USD",
  occurredAt,
  externalCustomerId = null,
  externalOrderId = null,
  note = "",
  metadata = {},
}) {
  if (!sourceId || !Number.isSafeInteger(Number(amountCents))) return false;
  const amount = Math.max(0, Number(amountCents));
  const tip = Math.max(0, safeInteger(tipCents, 0));
  const now = nowIso();
  await database.prepare(`
    INSERT OR IGNORE INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      external_customer_id,external_order_id,note,metadata_json,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).bind(
    recordId("crm-transaction"),
    personId || null,
    nodeId,
    transactionType,
    status,
    amount,
    tip,
    normalizeCurrency(currency),
    occurredAt || now,
    provider,
    sourceType,
    sourceId,
    externalCustomerId,
    externalOrderId,
    text(note, 2000),
    JSON.stringify(metadata),
    now,
    now,
  ).run();
  await database.prepare(`
    UPDATE crm_transactions
    SET person_id=COALESCE(?,person_id),node_id=COALESCE(?,node_id),
      transaction_type=?,status=?,amount_cents=?,tip_cents=?,currency=?,
      occurred_at=?,external_customer_id=?,external_order_id=?,note=?,
      metadata_json=?,active=1,updated_at=?
    WHERE source_provider=? AND source_type=? AND source_id=?
  `).bind(
    personId || null,
    nodeId,
    transactionType,
    status,
    amount,
    tip,
    normalizeCurrency(currency),
    occurredAt || now,
    externalCustomerId,
    externalOrderId,
    text(note, 2000),
    JSON.stringify(metadata),
    now,
    provider,
    sourceType,
    sourceId,
  ).run();
  return true;
}

async function upsertSuppression(database, {
  personId,
  kind,
  value,
  provider,
  sourceId,
  suppressed,
}) {
  const normalized = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
  if (!normalized) return;
  const existing = await database.prepare(`
    SELECT id,provider FROM crm_suppressions
    WHERE identity_kind=? AND normalized_value=?
  `).bind(kind, normalized).first();
  const now = nowIso();
  if (!existing) {
    if (!suppressed) return;
    await database.prepare(`
      INSERT INTO crm_suppressions(
        id,person_id,identity_kind,normalized_value,reason,provider,source_id,
        active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).bind(
      recordId("crm-suppression"),
      personId || null,
      kind,
      normalized,
      "Provider unsubscribe or marketing opt-out",
      provider,
      sourceId || null,
      1,
      now,
      now,
    ).run();
    return;
  }
  if (suppressed || existing.provider === provider) {
    await database.prepare(`
      UPDATE crm_suppressions
      SET person_id=COALESCE(?,person_id),reason=?,provider=?,source_id=?,
        active=?,updated_at=?
      WHERE id=?
    `).bind(
      personId || null,
      "Provider unsubscribe or marketing opt-out",
      provider,
      sourceId || null,
      suppressed ? 1 : 0,
      now,
      existing.id,
    ).run();
  }
}

async function upsertSubscription(database, {
  personId,
  provider,
  publicationId = "",
  externalId,
  email,
  status,
  tier = "",
  subscribedAt = null,
  updatedAt = null,
  metadata = {},
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedStatus = ["subscribed", "unsubscribed", "paused"].includes(status)
    ? status
    : "unknown";
  const now = nowIso();
  const sourceId = externalId || `${publicationId}:${normalizedEmail}`;
  if (!sourceId || !normalizedEmail) return;
  await database.prepare(`
    INSERT OR IGNORE INTO crm_marketing_subscriptions(
      id,person_id,provider,publication_id,external_id,email,status,tier,
      consent_source,subscribed_at,unsubscribed_at,last_synced_at,
      metadata_json,active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).bind(
    recordId("crm-subscription"),
    personId || null,
    provider,
    publicationId,
    sourceId,
    normalizedEmail,
    normalizedStatus,
    text(tier, 100),
    `${provider} provider sync`,
    subscribedAt,
    normalizedStatus === "unsubscribed" ? (updatedAt || now) : null,
    updatedAt || now,
    JSON.stringify(metadata),
    now,
    now,
  ).run();
  await database.prepare(`
    UPDATE crm_marketing_subscriptions
    SET person_id=COALESCE(?,person_id),publication_id=?,email=?,status=?,tier=?,
      consent_source=?,subscribed_at=COALESCE(?,subscribed_at),
      unsubscribed_at=?,last_synced_at=?,metadata_json=?,active=1,updated_at=?
    WHERE provider=? AND external_id=?
  `).bind(
    personId || null,
    publicationId,
    normalizedEmail,
    normalizedStatus,
    text(tier, 100),
    `${provider} provider sync`,
    subscribedAt,
    normalizedStatus === "unsubscribed" ? (updatedAt || now) : null,
    updatedAt || now,
    JSON.stringify(metadata),
    now,
    provider,
    sourceId,
  ).run();
  await upsertSuppression(database, {
    personId,
    kind: "email",
    value: normalizedEmail,
    provider,
    sourceId,
    suppressed: normalizedStatus === "unsubscribed",
  });
}

async function persistSquare(database, records, counts) {
  for (const payment of records.payments || []) {
    const customer =
      payment.customer &&
      typeof payment.customer === "object" &&
      !Array.isArray(payment.customer)
        ? payment.customer
        : {};
    const customerExternalId =
      text(customer.externalId, 300) ||
      text(payment.customerExternalId, 300) ||
      null;
    const profileEmail = normalizeEmail(customer.email) || null;
    const buyerEmail = normalizeEmail(payment.email) || null;
    const customerEmail = profileEmail || buyerEmail;
    const additionalEmails =
      profileEmail && buyerEmail && profileEmail !== buyerEmail
        ? [buyerEmail]
        : [];
    const customerPhone = normalizePhone(customer.phone) || null;
    const customerDisplayName =
      text(customer.displayName, 200) ||
      customerEmail ||
      customerPhone ||
      "";
    const paymentAmountCents = Number.isSafeInteger(Number(payment.amount?.amountMinor))
      ? Number(payment.amount.amountMinor)
      : null;
    const paymentTipCents = Number.isSafeInteger(Number(payment.tip?.amountMinor))
      ? Number(payment.tip.amountMinor)
      : null;
    const paymentCurrency = payment.amount?.currency
      ? normalizeCurrency(payment.amount.currency)
      : null;
    const mirrored = await database.prepare(`
      SELECT id,person_id FROM crm_transactions
      WHERE source_provider='local' AND transaction_type='charge' AND active=1
        AND (
          json_extract(metadata_json,'$.providerPaymentId')=?
          OR (
            COALESCE(?,'')!=''
            AND ? IS NOT NULL
            AND external_order_id=?
            AND amount_cents=?
          )
        )
      LIMIT 1
    `).bind(
      payment.externalId,
      payment.orderExternalId,
      paymentAmountCents,
      payment.orderExternalId,
      paymentAmountCents,
    ).first();
    let personId = await ensureProviderPerson(database, {
      provider: "square",
      externalId: customerExternalId,
      displayName: customerDisplayName,
      organization: customer.organization,
      email: customerEmail,
      additionalEmails,
      phone: customerPhone,
      occurredAt: customer.createdAt || payment.occurredAt,
      preferredPersonId: mirrored?.person_id || null,
      conflictSourceType: "payment",
      conflictSourceId: payment.externalId,
    });
    if (mirrored) {
      personId = mirrored.person_id || personId || null;
      await database.prepare(`
        UPDATE crm_transactions
        SET person_id=COALESCE(person_id,?),node_id=COALESCE(?,node_id),
          status='settled',
          amount_cents=COALESCE(?,amount_cents),
          tip_cents=COALESCE(?,tip_cents),
          currency=COALESCE(?,currency),
          occurred_at=COALESCE(?,occurred_at),
          external_customer_id=COALESCE(?,external_customer_id),
          external_order_id=COALESCE(?,external_order_id),
          metadata_json=json_set(
            CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
            '$.providerPaymentId',?,
            '$.squareLocationId',?
          ),
          active=1,updated_at=?
        WHERE id=?
      `).bind(
        personId,
        payment.nodeId,
        paymentAmountCents,
        paymentTipCents,
        paymentCurrency,
        payment.occurredAt || null,
        customerExternalId,
        payment.orderExternalId || null,
        payment.externalId,
        payment.locationId || null,
        nowIso(),
        mirrored.id,
      ).run();
      counts.overlapsSkipped += 1;
    } else if (paymentAmountCents !== null) {
      const inserted = await upsertTransaction(database, {
        personId,
        provider: "square",
        sourceType: "payment",
        sourceId: payment.externalId,
        nodeId: payment.nodeId,
        transactionType: "charge",
        status: "settled",
        amountCents: paymentAmountCents,
        tipCents: paymentTipCents || 0,
        currency: payment.amount.currency,
        occurredAt: payment.occurredAt,
        externalCustomerId: customerExternalId,
        externalOrderId: payment.orderExternalId,
        note: payment.referenceId || "Square payment",
        metadata: {
          locationId: payment.locationId,
          locationKey: payment.locationKey,
          receiptUrl: payment.receiptUrl,
          sourceType: payment.sourceTypeLabel,
          customerProfileUpdatedAt: customer.updatedAt || null,
        },
      });
      if (inserted) counts.transactions += 1;
    }
    await upsertInteraction(database, {
      personId,
      provider: "square",
      sourceType: "payment",
      sourceId: payment.externalId,
      nodeId: payment.nodeId,
      channel: "square",
      interactionType: "payment",
      label: payment.referenceId || "Square payment",
      status: "settled",
      occurredAt: payment.occurredAt,
      metadata: {
        locationId: payment.locationId,
        locationKey: payment.locationKey,
        orderExternalId: payment.orderExternalId,
      },
    });
    counts.interactions += 1;
    if (!personId) counts.unmatched += 1;
  }
  for (const refund of records.refunds || []) {
    const refundAmountCents = Number.isSafeInteger(Number(refund.amount?.amountMinor))
      ? Number(refund.amount.amountMinor)
      : null;
    const refundCurrency = refund.amount?.currency
      ? normalizeCurrency(refund.amount.currency)
      : null;
    const payment = refund.paymentExternalId
      ? await database.prepare(`
          SELECT person_id FROM crm_transactions
          WHERE (
            (source_provider='square' AND source_type='payment' AND source_id=?)
            OR (
              source_provider='local' AND transaction_type='charge'
              AND json_extract(metadata_json,'$.providerPaymentId')=?
            )
          ) AND active=1 LIMIT 1
        `).bind(refund.paymentExternalId, refund.paymentExternalId).first()
      : null;
    const mirroredRefund = await database.prepare(`
      SELECT id,person_id FROM crm_transactions
      WHERE source_provider='local' AND transaction_type='refund' AND active=1
        AND (
          source_id=?
          OR json_extract(metadata_json,'$.providerRefundId')=?
        )
      LIMIT 1
    `).bind(refund.externalId, refund.externalId).first();
    const refundPersonIds = [...new Set([
      payment?.person_id,
      mirroredRefund?.person_id,
    ].filter(Boolean))];
    await setSyncConflict(database, {
      provider: "square",
      sourceType: "refund",
      sourceId: refund.externalId,
      conflicts: refundPersonIds.length > 1 ? ["payment_refund_person_disagreement"] : [],
      personIds: refundPersonIds,
    });
    const personId = payment?.person_id || mirroredRefund?.person_id || null;
    if (mirroredRefund) {
      await database.prepare(`
        UPDATE crm_transactions
        SET person_id=COALESCE(person_id,?),node_id=COALESCE(?,node_id),
          status='settled',
          amount_cents=COALESCE(?,amount_cents),
          currency=COALESCE(?,currency),
          occurred_at=COALESCE(?,occurred_at),
          external_order_id=COALESCE(?,external_order_id),
          metadata_json=json_set(
            CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
            '$.providerRefundId',?,
            '$.providerPaymentId',?,
            '$.squareLocationId',?
          ),
          active=1,updated_at=?
        WHERE id=?
      `).bind(
        personId,
        refund.nodeId,
        refundAmountCents,
        refundCurrency,
        refund.occurredAt || null,
        refund.orderExternalId || null,
        refund.externalId,
        refund.paymentExternalId || "",
        refund.locationId || null,
        nowIso(),
        mirroredRefund.id,
      ).run();
      counts.overlapsSkipped += 1;
    } else if (refundAmountCents !== null) {
      const inserted = await upsertTransaction(database, {
        personId,
        provider: "square",
        sourceType: "refund",
        sourceId: refund.externalId,
        nodeId: refund.nodeId,
        transactionType: "refund",
        status: "settled",
        amountCents: refundAmountCents,
        currency: refund.amount?.currency,
        occurredAt: refund.occurredAt,
        externalOrderId: refund.orderExternalId,
        note: refund.reason || "Square refund",
        metadata: {
          paymentExternalId: refund.paymentExternalId,
          locationId: refund.locationId,
          locationKey: refund.locationKey,
        },
      });
      if (inserted) counts.transactions += 1;
    }
    if (!personId) counts.unmatched += 1;
  }
}

async function persistShopifyMarketing(database, personId, contact) {
  if (contact?.email) {
    await upsertSubscription(database, {
      personId,
      provider: "shopify",
      publicationId: "email-marketing",
      externalId: contact.externalId ? `${contact.externalId}:email` : `email:${contact.email}`,
      email: contact.email,
      status: contact.emailMarketingStatus,
      updatedAt: contact.emailMarketingUpdatedAt,
      metadata: { providerStatus: contact.emailMarketingProviderStatus },
    });
  }
  if (contact?.phone && contact.smsMarketingStatus === "unsubscribed") {
    await upsertSuppression(database, {
      personId,
      kind: "phone",
      value: contact.phone,
      provider: "shopify",
      sourceId: contact.externalId ? `${contact.externalId}:sms` : null,
      suppressed: true,
    });
  }
}

async function persistShopify(database, records, counts) {
  for (const customer of records.customers || []) {
    const personId = await ensureProviderPerson(database, {
      provider: "shopify",
      externalId: customer.externalId,
      displayName: customer.displayName,
      email: customer.email,
      phone: customer.phone,
      verifiedEmail: customer.verifiedEmail,
      occurredAt: customer.createdAt,
      tags: customer.tags,
      conflictSourceType: "customer",
      conflictSourceId: customer.externalId,
    });
    await persistShopifyMarketing(database, personId, customer);
    if (!personId) counts.unmatched += 1;
  }

  for (const order of records.orders || []) {
    const contact = order.contact || {};
    const personId = await ensureProviderPerson(database, {
      provider: "shopify",
      externalId: contact.externalId,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      verifiedEmail: contact.verifiedEmail,
      occurredAt: order.occurredAt,
      tags: order.tags,
      conflictSourceType: "order",
      conflictSourceId: order.externalId,
    });
    await persistShopifyMarketing(database, personId, contact);
    await upsertInteraction(database, {
      personId,
      provider: "shopify",
      sourceType: "order",
      sourceId: order.externalId,
      nodeId: "node-merch",
      channel: "shopify",
      interactionType: "merch_order",
      label: order.name || "Shopify order",
      status: order.cancelledAt ? "cancelled" : order.financialStatus || "",
      quantity: (order.lineItems || []).reduce((sum, item) => sum + safeInteger(item.quantity, 0), 0) || 1,
      occurredAt: order.occurredAt,
      metadata: {
        orderExternalId: order.externalId,
        sourceName: order.sourceName,
        lineItems: (order.lineItems || []).map((item) => ({
          externalId: item.externalId,
          name: item.name,
          quantity: item.quantity,
          productHandle: item.productHandle,
        })),
        lineItemsTruncated: order.lineItemsTruncated,
      },
    });
    counts.interactions += 1;

    const payments = order.settledPaymentTransactions || [];
    for (let index = 0; index < payments.length; index += 1) {
      const payment = payments[index];
      const inserted = await upsertTransaction(database, {
        personId,
        provider: "shopify",
        sourceType: "order_transaction",
        sourceId: payment.externalId,
        nodeId: "node-merch",
        transactionType: "charge",
        status: "settled",
        amountCents: safeInteger(payment.amount?.amountMinor, 0),
        tipCents: index === 0 ? safeInteger(order.totalTip?.amountMinor, 0) : 0,
        currency: payment.amount?.currency,
        occurredAt: payment.occurredAt || order.occurredAt,
        externalCustomerId: contact.externalId,
        externalOrderId: order.externalId,
        note: order.name || "Shopify order",
        metadata: { gateway: payment.gateway, orderName: order.name },
      });
      if (inserted) counts.transactions += 1;
    }
    for (const refund of order.refunds || []) {
      for (const transaction of refund.settledTransactions || []) {
        const inserted = await upsertTransaction(database, {
          personId,
          provider: "shopify",
          sourceType: "refund_transaction",
          sourceId: transaction.externalId,
          nodeId: "node-merch",
          transactionType: "refund",
          status: "settled",
          amountCents: safeInteger(transaction.amount?.amountMinor, 0),
          currency: transaction.amount?.currency,
          occurredAt: transaction.occurredAt || refund.occurredAt,
          externalCustomerId: contact.externalId,
          externalOrderId: order.externalId,
          note: `${order.name || "Shopify order"} refund`,
          metadata: { refundExternalId: refund.externalId, gateway: transaction.gateway },
        });
        if (inserted) counts.transactions += 1;
      }
    }
    if (!personId) counts.unmatched += 1;
  }
}

async function persistBeehiiv(database, records, counts) {
  for (const subscription of records.subscriptions || []) {
    const personId = await ensureProviderPerson(database, {
      provider: "beehiiv",
      externalId: subscription.externalId,
      displayName: subscription.email,
      email: subscription.email,
      occurredAt: subscription.subscribedAt,
      conflictSourceType: "subscription",
      conflictSourceId: subscription.externalId,
    });
    await upsertSubscription(database, {
      personId,
      provider: "beehiiv",
      publicationId: subscription.publicationId,
      externalId: subscription.externalId,
      email: subscription.email,
      status: subscription.status,
      tier: subscription.tier,
      subscribedAt: subscription.subscribedAt,
      updatedAt: subscription.updatedAt,
      metadata: {
        providerStatus: subscription.providerStatus,
        premiumTierNames: subscription.premiumTierNames,
        newsletterListIds: subscription.newsletterListIds,
        referralCode: subscription.referralCode,
      },
    });
    await upsertInteraction(database, {
      personId,
      provider: "beehiiv",
      sourceType: "subscription_state",
      sourceId: subscription.externalId,
      nodeId: null,
      channel: "newsletter",
      interactionType: subscription.status === "unsubscribed"
        ? "newsletter_unsubscribe"
        : "newsletter_subscription",
      label: "beehiiv newsletter",
      status: subscription.status,
      occurredAt: subscription.updatedAt || subscription.subscribedAt,
      metadata: { publicationId: subscription.publicationId, tier: subscription.tier },
    });
    counts.interactions += 1;
    if (!personId) counts.unmatched += 1;
  }
}

async function persistProviderPage(database, provider, records, counts) {
  if (provider === "square") await persistSquare(database, records, counts);
  else if (provider === "shopify") await persistShopify(database, records, counts);
  else if (provider === "beehiiv") await persistBeehiiv(database, records, counts);
}

async function latestJobs(database) {
  const result = await database.prepare(`
    SELECT j.* FROM crm_sync_jobs j
    WHERE j.id IN (
      SELECT j2.id FROM crm_sync_jobs j2
      WHERE j2.provider=j.provider
      ORDER BY j2.created_at DESC LIMIT 1
    )
    ORDER BY j.provider
  `).all();
  return result.results || [];
}

async function localCounts(database) {
  const row = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM crm_people WHERE merged_into_id IS NULL) people_count,
      (SELECT COUNT(*) FROM crm_interactions WHERE active=1) interaction_count,
      (SELECT COUNT(*) FROM crm_transactions WHERE active=1) transaction_count,
      (SELECT COUNT(*) FROM crm_import_batches) import_count,
      (SELECT COUNT(*) FROM crm_import_rows
        WHERE decision='review' OR apply_state='error') attention_count
  `).first();
  return {
    peopleCount: Number(row?.people_count || 0),
    interactionCount: Number(row?.interaction_count || 0),
    transactionCount: Number(row?.transaction_count || 0),
    importCount: Number(row?.import_count || 0),
    attentionCount: Number(row?.attention_count || 0),
  };
}

export async function handleCrmProviderStatus(database, env) {
  const readiness = getCrmProviderStatus(env);
  const jobs = await latestJobs(database);
  const byProvider = new Map(jobs.map((job) => [job.provider, job]));
  return json({
    ...readiness,
    providers: readiness.providers.map((provider) => {
      const job = byProvider.get(provider.id);
      return {
        ...provider,
        lastSync: job ? {
          id: job.id,
          status: job.status,
          checkpoint: parseJson(job.checkpoint_json, {}),
          stats: parseJson(job.stats_json, {}),
          warnings: parseJson(job.warnings_json, []),
          error: job.error || "",
          startedAt: job.started_at || null,
          completedAt: job.completed_at || null,
          updatedAt: job.updated_at,
        } : null,
      };
    }),
    local: await localCounts(database),
  });
}

async function selectResumeCheckpoint(database, provider, mode) {
  const latest = await database.prepare(`
    SELECT * FROM crm_sync_jobs WHERE provider=?
    ORDER BY created_at DESC LIMIT 1
  `).bind(provider).first();
  if (!latest) return { job: null, checkpoint: null, busy: false };
  const checkpoint = parseJson(latest.checkpoint_json, null);
  if (latest.status === "running") {
    const updatedAtMs = new Date(latest.updated_at || latest.started_at || 0).getTime();
    const stale = !Number.isFinite(updatedAtMs)
      || Date.now() - updatedAtMs > 15 * 60 * 1000;
    if (!stale) {
      return { job: null, checkpoint: null, busy: true };
    }
    return {
      job: latest,
      checkpoint: checkpoint?.mode === mode
        ? checkpoint
        : { mode, complete: false },
      busy: false,
    };
  }
  if (!checkpoint) return { job: null, checkpoint: null, busy: false };
  if (
    checkpoint.complete === false
    && checkpoint.mode === mode
    && ["pending", "failed"].includes(latest.status)
  ) {
    return { job: latest, checkpoint, busy: false };
  }
  if (checkpoint.complete === true) return { job: null, checkpoint, busy: false };
  const completed = await database.prepare(`
    SELECT * FROM crm_sync_jobs
    WHERE provider=? AND status='complete'
    ORDER BY completed_at DESC,created_at DESC LIMIT 1
  `).bind(provider).first();
  return {
    job: null,
    checkpoint: completed ? parseJson(completed.checkpoint_json, null) : null,
    busy: false,
  };
}

function isProviderSyncLeaseConflict(error) {
  const message = String(error?.message || error || "");
  return /unique constraint failed:\s*crm_sync_jobs\.provider/i.test(message)
    || /idx_crm_sync_jobs_one_running_provider/i.test(message);
}

function mergePersistenceCounts(previous, current) {
  const merged = {};
  for (const key of [
    "interactions",
    "transactions",
    "unmatched",
    "overlapsSkipped",
  ]) {
    merged[key] =
      safeInteger(previous?.[key], 0) +
      safeInteger(current?.[key], 0);
  }
  return merged;
}

function mergeSyncStats(previous, current, persistence) {
  const merged = { ...(previous || {}) };
  for (const [key, value] of Object.entries(current || {})) {
    if (key === "persistence") continue;
    if (key === "hasMore") {
      merged.hasMore = Boolean(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      merged[key] = Number(merged[key] || 0) + value;
    } else {
      merged[key] = value;
    }
  }
  merged.persistence = mergePersistenceCounts(
    previous?.persistence,
    persistence,
  );
  return merged;
}

function mergeSyncWarnings(previous, current) {
  return [...new Set([
    ...(Array.isArray(previous) ? previous : []),
    ...(Array.isArray(current) ? current : []),
  ].map((value) => text(value, 1000)).filter(Boolean))].slice(0, 100);
}

export async function handleCrmProviderSync(request, database, env, providerValue) {
  const provider = text(providerValue, 80).toLowerCase();
  if (!SYNC_PROVIDERS.has(provider)) return failure("Unknown CRM provider.", 404);
  if (provider === "substack") {
    return failure("Substack is imported from a reviewed CSV export.", 409);
  }
  const body = await readObject(request);
  const mode = body.mode === "full" ? "full" : "incremental";
  const maxPages = Math.max(1, Math.min(4, safeInteger(body.maxPages, 1)));
  const resume = await selectResumeCheckpoint(database, provider, mode);
  if (resume.busy) {
    return failure("A sync for this provider is already running.", 409, {
      code: "SYNC_ALREADY_RUNNING",
    });
  }
  const storedCheckpoint = parseJson(resume.job?.checkpoint_json, null);
  const continuingJob = Boolean(
    resume.job &&
    storedCheckpoint?.mode === mode &&
    resume.checkpoint?.mode === mode
  );
  const previousStats = continuingJob
    ? parseJson(resume.job?.stats_json, {})
    : {};
  const previousWarnings = continuingJob
    ? parseJson(resume.job?.warnings_json, [])
    : [];
  const jobId = resume.job?.id || recordId("crm-sync");
  const leaseToken = recordId("crm-sync-lease");
  const startedAt = nowIso();
  if (resume.job) {
    let claimed;
    try {
      claimed = await database.prepare(`
        UPDATE crm_sync_jobs
        SET status='running',error='',lease_token=?,
          started_at=COALESCE(started_at,?),updated_at=?
        WHERE id=? AND status=? AND updated_at=?
      `).bind(
        leaseToken,
        startedAt,
        startedAt,
        jobId,
        resume.job.status,
        resume.job.updated_at,
      ).run();
    } catch (error) {
      if (!isProviderSyncLeaseConflict(error)) throw error;
      return failure("A sync for this provider is already running.", 409, {
        code: "SYNC_ALREADY_RUNNING",
      });
    }
    if (Number(claimed?.meta?.changes || 0) < 1) {
      return failure("A sync for this provider is already running.", 409, {
        code: "SYNC_ALREADY_RUNNING",
      });
    }
  } else {
    const initialCheckpoint = {
      ...(resume.checkpoint || {}),
      mode,
      complete: false,
    };
    try {
      await database.prepare(`
        INSERT INTO crm_sync_jobs(
          id,provider,status,checkpoint_json,stats_json,warnings_json,error,
          lease_token,started_at,created_at,updated_at
        ) VALUES(?,?,'running',?,'{}','[]','',?,?,?,?)
      `).bind(
        jobId,
        provider,
        JSON.stringify(initialCheckpoint),
        leaseToken,
        startedAt,
        startedAt,
        startedAt,
      ).run();
    } catch (error) {
      if (!isProviderSyncLeaseConflict(error)) throw error;
      return failure("A sync for this provider is already running.", 409, {
        code: "SYNC_ALREADY_RUNNING",
      });
    }
  }

  const persisted = {
    interactions: 0,
    transactions: 0,
    unmatched: 0,
    overlapsSkipped: 0,
  };
  const result = await syncCrmProvider(provider, env, {
    database,
    mode,
    maxPages,
    checkpoint: resume.checkpoint,
    collectRecords: false,
    onBatch: async ({ records, checkpoint }) => {
      const fence = await database.prepare(`
        UPDATE crm_sync_jobs SET updated_at=?
        WHERE id=? AND status='running' AND lease_token=?
      `).bind(nowIso(), jobId, leaseToken).run();
      if (Number(fence?.meta?.changes || 0) < 1) {
        throw new Error("CRM provider sync lease was lost.");
      }
      await persistProviderPage(database, provider, records, persisted);
      const heartbeat = await database.prepare(`
        UPDATE crm_sync_jobs
        SET checkpoint_json=?,stats_json=?,updated_at=?
        WHERE id=? AND status='running' AND lease_token=?
      `).bind(
        JSON.stringify(checkpoint || {}),
        JSON.stringify({
          ...previousStats,
          persistence: mergePersistenceCounts(
            previousStats.persistence,
            persisted,
          ),
        }),
        nowIso(),
        jobId,
        leaseToken,
      ).run();
      if (Number(heartbeat?.meta?.changes || 0) < 1) {
        throw new Error("CRM provider sync lease was lost.");
      }
    },
  });

  const completedAt = nowIso();
  const status = result.ok
    ? (result.checkpoint?.complete ? "complete" : "pending")
    : "failed";
  const stats = mergeSyncStats(previousStats, result.stats, persisted);
  const warnings = mergeSyncWarnings(previousWarnings, result.warnings);
  const completion = await database.prepare(`
    UPDATE crm_sync_jobs
    SET status=?,checkpoint_json=?,stats_json=?,warnings_json=?,error=?,
      completed_at=?,lease_token=NULL,updated_at=?
    WHERE id=? AND status='running' AND lease_token=?
  `).bind(
    status,
    JSON.stringify(result.checkpoint || resume.checkpoint || {}),
    JSON.stringify(stats),
    JSON.stringify(warnings),
    text(result.error?.message || "", 1000),
    status === "complete" || status === "failed" ? completedAt : null,
    completedAt,
    jobId,
    leaseToken,
  ).run();
  if (Number(completion?.meta?.changes || 0) < 1) {
    return failure("This sync lost its provider lease.", 409, {
      code: "SYNC_LEASE_LOST",
    });
  }

  return json({
    ok: result.ok,
    jobId,
    provider,
    status,
    hasMore: Boolean(result.stats?.hasMore),
    stats,
    warnings,
    error: result.error || null,
  }, result.ok ? 200 : 502);
}
