import {
  db as requireCrmDb,
  failure,
  id,
  json,
  parseJson,
  readJson,
  requireStudioAdmin,
  text,
} from "../_shared/construct.js";
import { handleCrmProviderStatus, handleCrmProviderSync } from "./sync.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_BYTES + 512 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_COLUMNS = 100;
const MAX_PAGE_SIZE = 100;
const MAX_BACKFILL_PAGE_SIZE = 500;
const IMPORT_APPLY_LIMIT = 200;
const STAGING_RETENTION_DAYS = 30;
const TIERS = new Set([1, 2, 3]);
const RELATIONSHIP_STATUSES = new Set(["active", "inactive", "archived", "suppressed"]);
const CONTACT_METHODS = new Set(["", "email", "phone", "instagram", "none"]);
const CONTACT_IDENTITY_KINDS = new Set(["email", "phone", "instagram"]);
const TRANSACTION_TYPES = new Set(["charge", "refund", "adjustment"]);
const TRANSACTION_STATUSES = new Set(["pending", "settled", "void", "failed"]);
const SUBSCRIPTION_STATUSES = new Set(["subscribed", "unsubscribed", "paused", "unknown"]);
const NOTE_CATEGORIES = new Set([
  "relationship",
  "preference",
  "project",
  "follow_up",
  "accessibility",
  "legacy_import",
]);
const PERSONAL_CONTEXT_CATEGORY = "personal_context";
const PERSONAL_CONTEXT_PROVENANCE = "shared_by_client";
const IMPORT_CLASSIFICATIONS = new Set([
  "new_person",
  "exact_match",
  "possible_match",
  "duplicate_in_file",
  "already_imported",
  "money_conflict",
  "invalid",
]);
const IMPORT_DECISIONS = new Set(["create", "link", "skip", "review"]);
const IMPORT_FIELDS = new Set([
  "name", "first_name", "last_name", "email", "phone", "instagram",
  "organization", "pronouns", "referral_source", "date", "node", "interaction", "amount",
  "tip", "currency", "payment_reference", "tags", "notes", "tier",
  "consent", "provider_id", "display_name", "preferred_name", "occurred_at",
  "interaction_type", "node_id", "external_id",
]);
const IMPORT_FIELD_ALIASES = {
  display_name: "name",
  occurred_at: "date",
  interaction_type: "interaction",
  node_id: "node",
  external_id: "provider_id",
};

function nowIso() {
  return new Date().toISOString();
}

function asString(value, max = 5000) {
  return text(value, max);
}

function asNullableString(value, max = 5000) {
  const normalized = asString(value, max);
  return normalized || null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeEmail(value) {
  return asString(value, 320).toLowerCase();
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hasNameAndEmail(nameValue, emailValue) {
  const name = asString(nameValue, 200);
  const email = normalizeEmail(emailValue);
  return Boolean(name && email && name.toLowerCase() !== email && isLikelyEmail(email));
}

function normalizePhone(value) {
  const raw = asString(value, 80);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function normalizeInstagram(value) {
  return asString(value, 120).replace(/^@+/, "").toLowerCase();
}

function normalizeCurrency(value) {
  const currency = asString(value || "USD", 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function normalizeTier(value) {
  if (value === null || value === undefined || asString(value).toLowerCase() === "unrated") {
    return { value: null };
  }
  const source = asString(value, 40).toUpperCase().replace(/^TIER\s+/, "");
  const aliases = { I: 1, II: 2, III: 3, CORE: 1, RETURNING: 2, CONNECTED: 3 };
  const tier = aliases[source] || Number(source);
  return TIERS.has(tier) ? { value: tier } : { error: "Tier must be I, II, III, or Unrated." };
}

function personalContextView(note) {
  return {
    ...note,
    sensitive: true,
    visibility: "owner",
    provenance: PERSONAL_CONTEXT_PROVENANCE,
  };
}

function tagSlug(value) {
  return asString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function uniqueStrings(values, maxItems = 50) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = asString(value, 100);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function parseJsonObject(value, fallback = {}) {
  const parsed = typeof value === "string" ? parseJson(value, fallback) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function response405(...methods) {
  return json(
    { error: "Method not allowed." },
    { status: 405, headers: { allow: methods.join(", ") } }
  );
}

async function readObject(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > 256 * 1024) {
    return { error: failure("JSON payload cannot exceed 256 KB.", 413) };
  }
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: failure("Expected a JSON object.", 400) };
  }
  return { body };
}

function personView(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name || "",
    preferredName: row.preferred_name || "",
    organization: row.organization || "",
    pronouns: row.pronouns || "",
    instagram: row.instagram || "",
    relationshipStatus: row.relationship_status || "active",
    tier: row.tier === null || row.tier === undefined ? null : Number(row.tier),
    tierRationale: row.tier_rationale || "",
    tierReviewedAt: row.tier_reviewed_at || null,
    preferredContactMethod: row.preferred_contact_method || "",
    referralSource: row.referral_source || "",
    summary: row.summary || "",
    archivePersonId: row.archive_person_id || null,
    mergedIntoId: row.merged_into_id || null,
    eligibilityAt: row.eligibility_at || null,
    eligibilityReason: row.eligibility_reason || "",
    eligibilitySourceProvider: row.eligibility_source_provider || "",
    eligibilitySourceType: row.eligibility_source_type || "",
    eligibilitySourceId: row.eligibility_source_id || "",
    archivedAt: row.archived_at || null,
    anonymizedAt: row.anonymized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    primaryEmail: row.primary_email || "",
    primaryPhone: row.primary_phone || "",
    lastInteractionAt: row.last_interaction_at || null,
    nextInteractionAt: row.next_interaction_at || null,
    interactionCount: Number(row.interaction_count || 0),
    settledGrossCents: Number(row.settled_gross_cents || 0),
    refundCents: Number(row.refund_cents || 0),
    adjustmentCents: Number(row.adjustment_cents || 0),
    netSpendCents: Number(row.net_spend_cents || 0),
    tipCents: Number(row.tip_cents || 0),
    pendingCents: Number(row.pending_cents || 0),
    nodes: asString(row.nodes, 2000).split(",").filter(Boolean),
    tags: asString(row.tags, 2000).split(",").filter(Boolean),
    nextFollowupAt: row.next_followup_at || null,
  };
}

function logicalIdentityRows(rows, canonicalId) {
  const byValue = new Map();
  for (const row of rows || []) {
    const key = `${row.kind}\u0000${row.normalized_value}`;
    const current = byValue.get(key);
    if (!current) {
      byValue.set(key, { ...row });
      continue;
    }
    const rowScore = (row.person_id === canonicalId ? 8 : 0)
      + (row.is_primary ? 4 : 0)
      + (row.is_verified ? 2 : 0)
      + (row.external_id ? 1 : 0);
    const currentScore = (current.person_id === canonicalId ? 8 : 0)
      + (current.is_primary ? 4 : 0)
      + (current.is_verified ? 2 : 0)
      + (current.external_id ? 1 : 0);
    const retained = rowScore > currentScore ? { ...row } : current;
    retained.is_primary = Math.max(Number(current.is_primary), Number(row.is_primary));
    retained.is_verified = Math.max(Number(current.is_verified), Number(row.is_verified));
    retained.is_shared = Math.max(Number(current.is_shared), Number(row.is_shared));
    byValue.set(key, retained);
  }
  return [...byValue.values()];
}

const PERSON_SCOPE_SQL = `
  SELECT scoped_person.id
  FROM crm_people scoped_person
  WHERE scoped_person.id=p.id OR scoped_person.merged_into_id=p.id
`;

function personSelectSql(where = "1=1") {
  return `
    SELECT p.*,
      COALESCE(
        (SELECT i.value FROM crm_identities i
         WHERE i.person_id=p.id AND i.kind='email' AND i.active=1
         ORDER BY i.is_primary DESC,i.created_at LIMIT 1),
        (SELECT i.value FROM crm_identities i
         WHERE i.person_id IN (
           SELECT alias_person.id FROM crm_people alias_person
           WHERE alias_person.merged_into_id=p.id
         ) AND i.kind='email' AND i.active=1
         ORDER BY i.is_primary DESC,i.created_at LIMIT 1)
      ) primary_email,
      COALESCE(
        (SELECT i.value FROM crm_identities i
         WHERE i.person_id=p.id AND i.kind='phone' AND i.active=1
         ORDER BY i.is_primary DESC,i.created_at LIMIT 1),
        (SELECT i.value FROM crm_identities i
         WHERE i.person_id IN (
           SELECT alias_person.id FROM crm_people alias_person
           WHERE alias_person.merged_into_id=p.id
         ) AND i.kind='phone' AND i.active=1
         ORDER BY i.is_primary DESC,i.created_at LIMIT 1)
      ) primary_phone,
      (SELECT MAX(x.occurred_at) FROM crm_interactions x
       WHERE x.person_id IN (${PERSON_SCOPE_SQL}) AND x.active=1
         AND julianday(x.occurred_at)<=julianday('now')) last_interaction_at,
      (SELECT MIN(x.occurred_at) FROM crm_interactions x
       WHERE x.person_id IN (${PERSON_SCOPE_SQL}) AND x.active=1
         AND julianday(x.occurred_at)>julianday('now')
         AND LOWER(REPLACE(REPLACE(TRIM(x.status),'-','_'),' ','_')) NOT IN (
           'cancelled','canceled','completed','no_show','void','failed','refunded','expired'
         )) next_interaction_at,
      (SELECT COUNT(*) FROM crm_interactions x
       WHERE x.person_id IN (${PERSON_SCOPE_SQL}) AND x.active=1) interaction_count,
      (SELECT COALESCE(SUM(CASE WHEN t.transaction_type='charge' AND t.status='settled'
        THEN t.amount_cents ELSE 0 END),0) FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) settled_gross_cents,
      (SELECT COALESCE(SUM(CASE WHEN t.transaction_type='refund' AND t.status='settled'
        THEN t.amount_cents ELSE 0 END),0) FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) refund_cents,
      (SELECT COALESCE(SUM(CASE WHEN t.transaction_type='adjustment' AND t.status='settled'
        THEN t.amount_cents ELSE 0 END),0) FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) adjustment_cents,
      (SELECT COALESCE(SUM(CASE
        WHEN t.transaction_type='charge' AND t.status='settled' THEN t.amount_cents
        WHEN t.transaction_type='refund' AND t.status='settled' THEN -t.amount_cents
        WHEN t.transaction_type='adjustment' AND t.status='settled' THEN t.amount_cents
        ELSE 0 END),0) FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) net_spend_cents,
      (SELECT COALESCE(SUM(CASE WHEN t.status='settled' THEN t.tip_cents ELSE 0 END),0)
       FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) tip_cents,
      (SELECT COALESCE(SUM(CASE WHEN t.status='pending' AND t.transaction_type='refund'
        THEN -t.amount_cents WHEN t.status='pending' THEN t.amount_cents ELSE 0 END),0)
       FROM crm_transactions t
       WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1) pending_cents,
      (SELECT GROUP_CONCAT(DISTINCT node_id) FROM (
        SELECT x.node_id node_id FROM crm_interactions x
        WHERE x.person_id IN (${PERSON_SCOPE_SQL}) AND x.active=1
        UNION ALL
        SELECT t.node_id node_id FROM crm_transactions t
        WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1
        UNION ALL
        SELECT 'node-events' node_id FROM crm_attendance a
        WHERE a.person_id IN (${PERSON_SCOPE_SQL}) AND a.active=1
       ) scoped_nodes
       WHERE node_id IS NOT NULL AND node_id!='') nodes,
      (SELECT GROUP_CONCAT(DISTINCT tg.name) FROM crm_person_tags pt
       JOIN crm_tags tg ON tg.id=pt.tag_id
       WHERE pt.person_id IN (${PERSON_SCOPE_SQL})) tags,
      (SELECT MIN(f.due_at) FROM crm_followups f
       WHERE f.person_id IN (${PERSON_SCOPE_SQL})
         AND f.status='open' AND f.due_at IS NOT NULL) next_followup_at
    FROM crm_people p
    WHERE ${where}`;
}

async function canonicalPersonId(database, personId) {
  let current = asString(personId, 120);
  for (let depth = 0; depth < 10 && current; depth += 1) {
    const row = await database
      .prepare("SELECT id,merged_into_id FROM crm_people WHERE id=?")
      .bind(current)
      .first();
    if (!row) return null;
    if (!row.merged_into_id) return row.id;
    current = row.merged_into_id;
  }
  return null;
}

async function ensurePerson(database, personId) {
  const canonicalId = await canonicalPersonId(database, personId);
  if (!canonicalId) return null;
  return database.prepare(personSelectSql("p.id=?")).bind(canonicalId).first();
}

function auditStatement(database, {
  personId = null,
  action,
  resourceType,
  resourceId = null,
  before = null,
  after = null,
  importBatchId = null,
}) {
  return database.prepare(`
    INSERT INTO crm_audit_events(
      id,person_id,action,resource_type,resource_id,before_json,after_json,
      actor,import_batch_id,created_at
    ) VALUES(?,?,?,?,?,?,?,'studio',?,?)
  `).bind(
    id("crm-audit"),
    personId,
    action,
    resourceType,
    resourceId,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    importBatchId,
    nowIso(),
  );
}

function identityStatement(database, personId, kind, value, options = {}) {
  const normalized = kind === "email"
    ? normalizeEmail(value)
    : kind === "phone"
      ? normalizePhone(value)
      : kind === "instagram"
        ? normalizeInstagram(value)
        : asString(value, 500).toLowerCase();
  if (!normalized) return null;
  return database.prepare(`
    INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      import_batch_id,active,created_at,updated_at
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?
    WHERE NOT EXISTS(
      SELECT 1 FROM crm_identities
      WHERE person_id=? AND kind=? AND normalized_value=? AND active=1
    )
  `).bind(
    id("crm-identity"),
    personId,
    kind,
    asString(value, 500),
    normalized,
    options.provider || "manual",
    options.externalId || null,
    options.label || "",
    options.primary ? 1 : 0,
    options.verified ? 1 : 0,
    options.shared ? 1 : 0,
    options.sourceProvider || "manual",
    options.sourceType || "identity",
    options.sourceId || null,
    options.importBatchId || null,
    options.now || nowIso(),
    options.now || nowIso(),
    personId,
    kind,
    normalized,
  );
}

function ensurePrimaryIdentityStatement(database, personId, kind, now = nowIso()) {
  return database.prepare(`
    UPDATE crm_identities
    SET is_primary=1,updated_at=?
    WHERE id=(
      SELECT candidate.id
      FROM crm_identities candidate
      WHERE candidate.person_id=? AND candidate.kind=? AND candidate.active=1
      ORDER BY candidate.is_primary DESC,candidate.is_verified DESC,
        candidate.created_at,candidate.id
      LIMIT 1
    )
    AND NOT EXISTS(
      SELECT 1 FROM crm_identities current_primary
      WHERE current_primary.person_id=? AND current_primary.kind=?
        AND current_primary.active=1 AND current_primary.is_primary=1
    )
  `).bind(now, personId, kind, personId, kind);
}

function emailClaimStatement(database, personId, email, now, {
  ignoreConflict = false,
  importBatchId = null,
} = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return database.prepare(`
    INSERT ${ignoreConflict ? "OR IGNORE " : ""}INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      import_batch_id,active,created_at,updated_at
    ) VALUES(
      ?,?,'other',?,?,'crm_email_claim',?,'',0,0,0,
      'system','email_claim',NULL,?,0,?,?
    )
  `).bind(
    id("crm-identity"),
    personId,
    normalized,
    normalized,
    normalized,
    importBatchId,
    now,
    now,
  );
}

function reservationStatement(database, personId, provider, externalId, now, {
  ignoreConflict = false,
  importBatchId = null,
} = {}) {
  const normalizedProvider = asString(provider, 80);
  const normalizedExternalId = asString(externalId, 500);
  if (!normalizedProvider || !normalizedExternalId) return null;
  return database.prepare(`
    INSERT ${ignoreConflict ? "OR IGNORE " : ""}INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      import_batch_id,active,created_at,updated_at
    ) VALUES(
      ?,?,'other',?,?,?,?,'',0,0,0,
      'system','record_claim',NULL,?,0,?,?
    )
  `).bind(
    id("crm-identity"),
    personId,
    normalizedExternalId,
    normalizedExternalId,
    normalizedProvider,
    normalizedExternalId,
    importBatchId,
    now,
    now,
  );
}

async function reservationPersonId(database, provider, externalId) {
  const normalizedProvider = asString(provider, 80);
  const normalizedExternalId = asString(externalId, 500);
  if (!normalizedProvider || !normalizedExternalId) return null;
  const row = await database.prepare(`
    SELECT COALESCE(p.merged_into_id,p.id) person_id
    FROM crm_identities i
    JOIN crm_people p ON p.id=i.person_id
    WHERE i.provider=? AND i.external_id=? AND p.anonymized_at IS NULL
    LIMIT 1
  `).bind(normalizedProvider, normalizedExternalId).first();
  return row?.person_id || null;
}

async function emailClaimPersonId(database, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = await database.prepare(`
    SELECT COALESCE(p.merged_into_id,p.id) person_id
    FROM crm_identities i
    JOIN crm_people p ON p.id=i.person_id
    WHERE i.provider='crm_email_claim' AND i.external_id=?
    LIMIT 1
  `).bind(normalized).first();
  if (!row?.person_id) return null;
  const match = await uniqueEmailMatch(database, normalized);
  return match.personId === row.person_id ? row.person_id : null;
}

function tagStatements(database, personId, tags, options = {}) {
  const statements = [];
  const now = options.now || nowIso();
  for (const name of uniqueStrings(tags)) {
    const tag = tagSlug(name);
    if (!tag) continue;
    const tagId = `crm-tag-${tag}`;
    statements.push(database.prepare(`
      INSERT INTO crm_tags(id,name,slug,created_at,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at
    `).bind(tagId, name, tag, now, now));
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO crm_person_tags(person_id,tag_id,source,import_batch_id,created_at)
      VALUES(?,?,?,?,?)
    `).bind(personId, tagId, options.source || "manual", options.importBatchId || null, now));
  }
  return statements;
}

async function uniqueEmailMatch(database, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return {
      personId: null,
      count: 0,
      candidates: [],
      ambiguous: false,
      shared: false,
    };
  }
  const result = await database.prepare(`
    SELECT COALESCE(p.merged_into_id,p.id) person_id,i.is_shared
    FROM crm_identities i
    JOIN crm_people p ON p.id=i.person_id
    WHERE i.kind='email' AND i.normalized_value=? AND i.active=1
      AND p.anonymized_at IS NULL
  `).bind(normalized).all();
  const ids = [...new Set((result.results || []).map((row) => row.person_id).filter(Boolean))];
  const shared = (result.results || []).some((row) => Boolean(row.is_shared));
  return {
    personId: ids.length === 1 && !shared ? ids[0] : null,
    count: ids.length,
    candidates: ids,
    ambiguous: shared || ids.length > 1,
    shared,
  };
}

async function handleListPeople(request, database) {
  const url = new URL(request.url);
  const filters = [
    "p.merged_into_id IS NULL",
    "p.relationship_status!='merged'",
    "p.eligibility_at IS NOT NULL",
  ];
  const values = [];
  const q = asString(url.searchParams.get("q"), 200).toLowerCase();
  if (url.searchParams.get("includeArchived") !== "1") filters.push("p.archived_at IS NULL");
  if (q) {
    filters.push(`(
      LOWER(p.display_name) LIKE ? OR LOWER(p.preferred_name) LIKE ?
      OR EXISTS(SELECT 1 FROM crm_identities i
        WHERE i.person_id IN (${PERSON_SCOPE_SQL}) AND i.active=1
        AND (LOWER(i.value) LIKE ? OR i.normalized_value LIKE ?))
      OR EXISTS(SELECT 1 FROM crm_person_tags pt JOIN crm_tags tg ON tg.id=pt.tag_id
        WHERE pt.person_id IN (${PERSON_SCOPE_SQL}) AND LOWER(tg.name) LIKE ?)
    )`);
    const like = `%${q}%`;
    values.push(like, like, like, like, like);
  }
  const tier = asString(url.searchParams.get("tier"), 20).toLowerCase();
  if (tier === "unrated") filters.push("p.tier IS NULL");
  else if (TIERS.has(Number(tier))) {
    filters.push("p.tier=?");
    values.push(Number(tier));
  }
  const status = asString(url.searchParams.get("status"), 40);
  if (RELATIONSHIP_STATUSES.has(status)) {
    filters.push("p.relationship_status=?");
    values.push(status);
  }
  const node = asString(url.searchParams.get("nodeId") || url.searchParams.get("node"), 120);
  if (node) {
    filters.push(`(
      EXISTS(SELECT 1 FROM crm_interactions x
        WHERE x.person_id IN (${PERSON_SCOPE_SQL}) AND x.active=1 AND x.node_id=?)
      OR EXISTS(SELECT 1 FROM crm_transactions t
        WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1 AND t.node_id=?)
      OR (?='node-events' AND EXISTS(SELECT 1 FROM crm_attendance a
        WHERE a.person_id IN (${PERSON_SCOPE_SQL}) AND a.active=1))
    )`);
    values.push(node, node, node);
  }
  const interaction = asString(
    url.searchParams.get("interactionType") || url.searchParams.get("interaction"),
    120,
  );
  if (interaction) {
    filters.push(`EXISTS(SELECT 1 FROM crm_interactions x
      WHERE x.person_id IN (${PERSON_SCOPE_SQL})
        AND x.active=1 AND x.interaction_type=?)`);
    values.push(interaction);
  }
  const tag = asString(url.searchParams.get("tag"), 80).toLowerCase();
  if (tag) {
    filters.push(`EXISTS(SELECT 1 FROM crm_person_tags pt JOIN crm_tags tg ON tg.id=pt.tag_id
      WHERE pt.person_id IN (${PERSON_SCOPE_SQL})
        AND (tg.slug=? OR LOWER(tg.name)=?))`);
    values.push(tagSlug(tag), tag);
  }
  const consent = asString(url.searchParams.get("consent"), 40);
  if (consent === "subscribed") {
    filters.push(`EXISTS(
      SELECT 1 FROM crm_marketing_subscriptions s
      WHERE s.person_id IN (${PERSON_SCOPE_SQL}) AND s.active=1 AND s.status='subscribed'
    ) AND NOT EXISTS(
      SELECT 1 FROM crm_suppressions sp
      WHERE sp.person_id IN (${PERSON_SCOPE_SQL}) AND sp.active=1
    )`);
  } else if (consent === "unsubscribed") {
    filters.push(`(
      EXISTS(SELECT 1 FROM crm_marketing_subscriptions s
        WHERE s.person_id IN (${PERSON_SCOPE_SQL})
          AND s.active=1 AND s.status='unsubscribed')
      OR EXISTS(SELECT 1 FROM crm_suppressions sp
        WHERE sp.person_id IN (${PERSON_SCOPE_SQL}) AND sp.active=1)
    )`);
  } else if (SUBSCRIPTION_STATUSES.has(consent)) {
    filters.push(`EXISTS(SELECT 1 FROM crm_marketing_subscriptions s
      WHERE s.person_id IN (${PERSON_SCOPE_SQL}) AND s.active=1 AND s.status=?)`);
    values.push(consent);
  }
  const followup = asString(url.searchParams.get("followup"), 40);
  if (followup === "overdue") {
    filters.push(`EXISTS(SELECT 1 FROM crm_followups f
      WHERE f.person_id IN (${PERSON_SCOPE_SQL})
        AND f.status='open' AND f.due_at<datetime('now'))`);
  } else if (followup === "open") {
    filters.push(`EXISTS(SELECT 1 FROM crm_followups f
      WHERE f.person_id IN (${PERSON_SCOPE_SQL}) AND f.status='open')`);
  }
  const minSpendParam = url.searchParams.get("minSpendCents");
  const minSpend = minSpendParam === null || minSpendParam.trim() === "" ? NaN : Number(minSpendParam);
  if (Number.isFinite(minSpend)) {
    filters.push(`(SELECT COALESCE(SUM(CASE
      WHEN t.transaction_type='charge' AND t.status='settled' THEN t.amount_cents
      WHEN t.transaction_type='refund' AND t.status='settled' THEN -t.amount_cents
      WHEN t.transaction_type='adjustment' AND t.status='settled' THEN t.amount_cents ELSE 0 END),0)
      FROM crm_transactions t
      WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1)>=?`);
    values.push(Math.floor(minSpend));
  }
  const maxSpendParam = url.searchParams.get("maxSpendCents");
  const maxSpend = maxSpendParam === null || maxSpendParam.trim() === "" ? NaN : Number(maxSpendParam);
  if (Number.isFinite(maxSpend)) {
    filters.push(`(SELECT COALESCE(SUM(CASE
      WHEN t.transaction_type='charge' AND t.status='settled' THEN t.amount_cents
      WHEN t.transaction_type='refund' AND t.status='settled' THEN -t.amount_cents
      WHEN t.transaction_type='adjustment' AND t.status='settled' THEN t.amount_cents ELSE 0 END),0)
      FROM crm_transactions t
      WHERE t.person_id IN (${PERSON_SCOPE_SQL}) AND t.active=1)<=?`);
    values.push(Math.floor(maxSpend));
  }
  const limit = clampInteger(url.searchParams.get("limit"), 1, MAX_PAGE_SIZE, 50);
  const offset = clampInteger(url.searchParams.get("offset"), 0, 100_000, 0);
  const where = filters.join(" AND ");
  const [result, countRow] = await Promise.all([
    database.prepare(`${personSelectSql(where)}
      ORDER BY COALESCE(last_interaction_at,p.updated_at) DESC,p.display_name COLLATE NOCASE
      LIMIT ? OFFSET ?`).bind(...values, limit, offset).all(),
    database.prepare(`SELECT COUNT(*) count FROM crm_people p WHERE ${where}`).bind(...values).first(),
  ]);
  return json({
    people: (result.results || []).map(personView),
    count: Number(countRow?.count || 0),
    limit,
    offset,
  });
}

async function handleGetPerson(database, requestedId) {
  const canonicalId = await canonicalPersonId(database, requestedId);
  if (!canonicalId) return failure("Person not found.", 404);
  const row = await database.prepare(personSelectSql("p.id=?")).bind(canonicalId).first();
  if (!row) return failure("Person not found.", 404);
  const scope = "person_id IN (SELECT id FROM crm_people WHERE id=? OR merged_into_id=?)";
  const bindScope = (sql) => database.prepare(sql).bind(canonicalId, canonicalId).all();
  const [
    identitiesResult,
    tagsResult,
    interactionsResult,
    transactionsResult,
    notesResult,
    personalContextResult,
    followupsResult,
    subscriptionsResult,
    suppressionsResult,
    attendanceResult,
    tierHistoryResult,
    auditResult,
    aliasesResult,
    consentEventsResult,
    communicationsResult,
  ] = await Promise.all([
    bindScope(`SELECT * FROM crm_identities WHERE ${scope} AND active=1
      ORDER BY kind,is_primary DESC,created_at`),
    bindScope(`SELECT DISTINCT tg.* FROM crm_person_tags pt JOIN crm_tags tg ON tg.id=pt.tag_id
      WHERE ${scope.replace("person_id", "pt.person_id")} ORDER BY tg.name COLLATE NOCASE`),
    bindScope(`SELECT * FROM crm_interactions WHERE ${scope} AND active=1
      ORDER BY occurred_at DESC,created_at DESC LIMIT 500`),
    bindScope(`SELECT * FROM crm_transactions WHERE ${scope} AND active=1
      ORDER BY occurred_at DESC,created_at DESC LIMIT 500`),
    bindScope(`SELECT * FROM crm_notes WHERE ${scope} AND archived_at IS NULL
      AND category!='personal_context'
      ORDER BY pinned DESC,created_at DESC LIMIT 250`),
    bindScope(`SELECT * FROM crm_notes WHERE ${scope} AND archived_at IS NULL
      AND category='personal_context'
      ORDER BY pinned DESC,created_at DESC LIMIT 250`),
    bindScope(`SELECT * FROM crm_followups WHERE ${scope}
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,due_at,created_at DESC LIMIT 250`),
    bindScope(`SELECT * FROM crm_marketing_subscriptions WHERE ${scope} AND active=1
      ORDER BY provider,publication_id`),
    bindScope(`SELECT * FROM crm_suppressions WHERE ${scope} AND active=1
      ORDER BY identity_kind,updated_at DESC`),
    bindScope(`SELECT * FROM crm_attendance WHERE ${scope} AND active=1
      ORDER BY COALESCE(checked_in_at,created_at) DESC LIMIT 250`),
    bindScope(`SELECT * FROM crm_tier_history WHERE ${scope} ORDER BY created_at DESC LIMIT 100`),
    bindScope(`SELECT * FROM crm_audit_events WHERE ${scope} ORDER BY created_at DESC LIMIT 250`),
    database.prepare("SELECT id,display_name,merged_into_id,updated_at FROM crm_people WHERE merged_into_id=? ORDER BY display_name").bind(canonicalId).all(),
    bindScope(`SELECT * FROM crm_consent_events WHERE ${scope}
      ORDER BY occurred_at DESC,created_at DESC LIMIT 250`),
    bindScope(`SELECT * FROM crm_communications WHERE ${scope}
      ORDER BY created_at DESC LIMIT 250`),
  ]);
  return json({
    person: personView(row),
    requestedPersonId: requestedId,
    aliases: aliasesResult.results || [],
    identities: logicalIdentityRows(identitiesResult.results || [], canonicalId),
    tags: tagsResult.results || [],
    interactions: (interactionsResult.results || []).map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, {}),
    })),
    transactions: (transactionsResult.results || []).map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, {}),
    })),
    notes: notesResult.results || [],
    personalContext: (personalContextResult.results || []).map(personalContextView),
    followups: followupsResult.results || [],
    subscriptions: (subscriptionsResult.results || []).map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, {}),
    })),
    suppressions: suppressionsResult.results || [],
    attendance: (attendanceResult.results || []).map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, {}),
    })),
    tierHistory: tierHistoryResult.results || [],
    audit: auditResult.results || [],
    consentEvents: (consentEventsResult.results || []).map((item) => ({
      ...item,
      evidence: parseJson(item.evidence_json, {}),
    })),
    communications: communicationsResult.results || [],
  });
}

async function handleCreatePerson(request, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const displayName = asString(body.displayName || body.name, 200);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const instagram = normalizeInstagram(body.instagram);
  if (!displayName && !email && !phone && !instagram) {
    return failure("Provide a name, email, phone, or Instagram handle.", 400);
  }
  if (email && !isLikelyEmail(email)) return failure("Email is invalid.", 400);
  if (email) {
    const match = await uniqueEmailMatch(database, email);
    if (match.count) {
      return failure("That email is already connected to a CRM person.", 409, {
        code: "EMAIL_ALREADY_CONNECTED",
        personIds: match.candidates,
      });
    }
  }
  const tierResult = normalizeTier(body.tier);
  if (tierResult.error) return failure(tierResult.error, 400);
  const rationale = asString(body.tierRationale, 2000);
  const personId = id("crm-person");
  const now = nowIso();
  const statements = [
    database.prepare(`
      INSERT INTO crm_people(
        id,display_name,preferred_name,organization,pronouns,instagram,
        relationship_status,tier,tier_rationale,tier_reviewed_at,
        preferred_contact_method,referral_source,summary,archive_person_id,
        eligibility_at,eligibility_reason,eligibility_source_provider,
        eligibility_source_type,eligibility_source_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      personId,
      displayName || email || phone || `@${instagram}`,
      asString(body.preferredName, 200),
      asString(body.organization, 200),
      asString(body.pronouns, 100),
      instagram,
      tierResult.value,
      rationale,
      tierResult.value === null ? null : now,
      CONTACT_METHODS.has(asString(body.preferredContactMethod, 20))
        ? asString(body.preferredContactMethod, 20)
        : "",
      asString(body.referralSource, 120),
      asString(body.summary, 5000),
      asNullableString(body.archivePersonId, 120),
      now,
      "studio_manual_entry",
      "manual",
      "person_create",
      personId,
      now,
      now,
    ),
  ];
  const emailClaim = emailClaimStatement(database, personId, email, now);
  if (emailClaim) statements.push(emailClaim);
  for (const [kind, value] of [["email", email], ["phone", body.phone], ["instagram", instagram]]) {
    const statement = identityStatement(database, personId, kind, value, {
      primary: true,
      sourceProvider: "manual",
      sourceType: "person_create",
      sourceId: `${personId}:${kind}`,
      now,
    });
    if (statement) statements.push(statement);
  }
  statements.push(...tagStatements(database, personId, body.tags, { now }));
  if (tierResult.value !== null) {
    statements.push(database.prepare(`
      INSERT INTO crm_tier_history(id,person_id,previous_tier,new_tier,rationale,actor,created_at)
      VALUES(?,?,NULL,?,?,'studio',?)
    `).bind(id("crm-tier"), personId, tierResult.value, rationale, now));
  }
  statements.push(auditStatement(database, {
    personId,
    action: "person_created",
    resourceType: "person",
    resourceId: personId,
    after: { displayName, email, phone: phone ? "provided" : "", tier: tierResult.value },
  }));
  try {
    await database.batch(statements);
  } catch (error) {
    if (email && /UNIQUE constraint/i.test(error.message || "")) {
      const claimedPersonId = await emailClaimPersonId(database, email);
      if (claimedPersonId) {
        return failure("That email is already connected to a CRM person.", 409, {
          code: "EMAIL_ALREADY_CONNECTED",
          personIds: [claimedPersonId],
        });
      }
    }
    throw error;
  }
  const created = await database.prepare(personSelectSql("p.id=?")).bind(personId).first();
  return json({ person: personView(created) }, { status: 201 });
}

async function handleUpdatePerson(request, database, requestedId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const current = await ensurePerson(database, requestedId);
  if (!current) return failure("Person not found.", 404);
  const personId = current.id;
  const fields = [];
  const values = [];
  const set = (column, value) => {
    fields.push(`${column}=?`);
    values.push(value);
  };
  if (hasOwn(body, "displayName") || hasOwn(body, "name")) {
    const value = asString(body.displayName || body.name, 200);
    if (!value) return failure("Display name cannot be blank.", 400);
    set("display_name", value);
  }
  if (hasOwn(body, "preferredName")) set("preferred_name", asString(body.preferredName, 200));
  if (hasOwn(body, "organization")) set("organization", asString(body.organization, 200));
  if (hasOwn(body, "pronouns")) set("pronouns", asString(body.pronouns, 100));
  if (hasOwn(body, "instagram")) set("instagram", normalizeInstagram(body.instagram));
  if (hasOwn(body, "referralSource")) set("referral_source", asString(body.referralSource, 120));
  if (hasOwn(body, "summary")) set("summary", asString(body.summary, 5000));
  if (hasOwn(body, "archivePersonId")) set("archive_person_id", asNullableString(body.archivePersonId, 120));
  if (hasOwn(body, "preferredContactMethod")) {
    const method = asString(body.preferredContactMethod, 20);
    if (!CONTACT_METHODS.has(method)) {
      return failure("Preferred contact method is invalid.", 400);
    }
    set("preferred_contact_method", method);
  }
  if (hasOwn(body, "relationshipStatus")) {
    const status = asString(body.relationshipStatus, 40);
    if (!RELATIONSHIP_STATUSES.has(status)) {
      return failure("Relationship status is invalid.", 400);
    }
    set("relationship_status", status);
    set("archived_at", status === "archived" ? nowIso() : null);
  } else if (hasOwn(body, "archived")) {
    set("relationship_status", body.archived ? "archived" : "active");
    set("archived_at", body.archived ? nowIso() : null);
  }

  let tierChange = null;
  if (hasOwn(body, "tier")) {
    const normalized = normalizeTier(body.tier);
    if (normalized.error) return failure(normalized.error, 400);
    const currentTier = current.tier === null || current.tier === undefined ? null : Number(current.tier);
    if (normalized.value !== currentTier) {
      const rationale = asString(body.tierRationale, 2000);
      set("tier", normalized.value);
      set("tier_rationale", rationale);
      set("tier_reviewed_at", nowIso());
      tierChange = { previous: currentTier, next: normalized.value, rationale };
    }
  } else if (hasOwn(body, "tierRationale")) {
    set("tier_rationale", asString(body.tierRationale, 2000));
  }

  const now = nowIso();
  if (fields.length) {
    fields.push("updated_at=?");
    values.push(now, personId);
  }
  const statements = [];
  if (fields.length) {
    statements.push(database.prepare(`UPDATE crm_people SET ${fields.join(",")} WHERE id=?`).bind(...values));
  }
  if (tierChange) {
    statements.push(database.prepare(`
      INSERT INTO crm_tier_history(id,person_id,previous_tier,new_tier,rationale,actor,created_at)
      VALUES(?,?,?,?,?,'studio',?)
    `).bind(id("crm-tier"), personId, tierChange.previous, tierChange.next, tierChange.rationale, now));
  }

  for (const [kind, value] of [
    ["email", body.email],
    ["phone", body.phone],
    ["instagram", body.instagram],
  ]) {
    if (!hasOwn(body, kind)) continue;
    if (kind === "email" && value && !isLikelyEmail(normalizeEmail(value))) {
      return failure("Email is invalid.", 400);
    }
    const existingPrimary = await database.prepare(`
      SELECT COUNT(*) count FROM crm_identities
      WHERE person_id=? AND kind=? AND active=1
    `).bind(personId, kind).first();
    const statement = identityStatement(database, personId, kind, value, {
      primary: Number(existingPrimary?.count || 0) === 0,
      sourceProvider: "manual",
      sourceType: "person_update",
      sourceId: `${personId}:${kind}:${kind === "email" ? normalizeEmail(value) : kind === "phone" ? normalizePhone(value) : normalizeInstagram(value)}`,
      now,
    });
    if (statement) statements.push(statement);
  }

  if (Array.isArray(body.tags)) {
    statements.push(database.prepare(`
      DELETE FROM crm_person_tags WHERE person_id=? AND source='manual'
    `).bind(personId));
    statements.push(...tagStatements(database, personId, body.tags, { now }));
  }
  if (!statements.length) return failure("No supported fields to update.", 400);
  statements.push(auditStatement(database, {
    personId,
    action: tierChange ? "tier_changed" : "person_updated",
    resourceType: "person",
    resourceId: personId,
    before: personView(current),
    after: {
      fields: Object.keys(body).filter((key) => key !== "tierRationale"),
      tier: tierChange?.next,
    },
  }));
  await database.batch(statements);
  const updated = await database.prepare(personSelectSql("p.id=?")).bind(personId).first();
  return json({ person: personView(updated) });
}

async function handleDeletePerson(request, database, requestedId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const current = await ensurePerson(database, requestedId);
  if (!current) return failure("Person not found.", 404);
  const confirmedName = asString(parsed.body.confirmDisplayName, 200);
  if (!confirmedName || confirmedName !== current.display_name) {
    return failure("Type the person's exact display name to confirm deletion.", 400);
  }

  const personId = current.id;
  const scopeResult = await database.prepare(`
    SELECT id FROM crm_people WHERE id=? OR merged_into_id=?
  `).bind(personId, personId).all();
  const personIds = (scopeResult.results || []).map((row) => row.id).filter(Boolean);
  if (!personIds.length) return failure("Person not found.", 404);
  const placeholders = personIds.map(() => "?").join(",");
  const bindScope = (sql, repetitions = 1, prefix = []) => database
    .prepare(sql)
    .bind(
      ...prefix,
      ...Array.from({ length: repetitions }, () => personIds).flat(),
    );
  const now = nowIso();
  const statements = [
    bindScope(`
      INSERT OR IGNORE INTO crm_deleted_person_sources(
        source_provider,source_type,source_id,deleted_at
      )
      SELECT eligibility_source_provider,eligibility_source_type,
        eligibility_source_id,?
      FROM crm_people
      WHERE id IN (${placeholders})
        AND eligibility_source_provider!=''
        AND eligibility_source_type!=''
        AND eligibility_source_id!=''
    `, 1, [now]),
  ];
  for (const table of ["crm_interactions", "crm_transactions", "crm_attendance"]) {
    statements.push(bindScope(`
      INSERT OR IGNORE INTO crm_deleted_person_sources(
        source_provider,source_type,source_id,deleted_at
      )
      SELECT source_provider,source_type,source_id,?
      FROM ${table}
      WHERE person_id IN (${placeholders})
        AND source_provider!=''
        AND source_type!=''
        AND source_id IS NOT NULL
        AND source_id!=''
    `, 1, [now]));
  }
  statements.push(
    bindScope(`UPDATE crm_consent_events SET person_id=NULL
      WHERE person_id IN (${placeholders})`),
    bindScope(`UPDATE crm_outreach_recipients SET person_id=NULL
      WHERE person_id IN (${placeholders})`),
    bindScope(`UPDATE crm_communications SET person_id=NULL
      WHERE person_id IN (${placeholders})`),
    bindScope(`UPDATE crm_marketing_subscriptions SET person_id=NULL
      WHERE person_id IN (${placeholders})`),
    bindScope(`UPDATE crm_suppressions SET person_id=NULL
      WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_import_rows
      WHERE matched_person_id IN (${placeholders})
         OR target_person_id IN (${placeholders})
         OR applied_person_id IN (${placeholders})`, 3),
    bindScope(`DELETE FROM crm_merges
      WHERE survivor_person_id IN (${placeholders})
         OR duplicate_person_id IN (${placeholders})`, 2),
    bindScope(`DELETE FROM crm_audit_events
      WHERE person_id IN (${placeholders})
         OR (resource_type='person' AND resource_id IN (${placeholders}))`, 2),
    bindScope(`DELETE FROM crm_tier_history WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_person_tags WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_attendance WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_followups WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_notes WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_transactions WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_interactions WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_identities WHERE person_id IN (${placeholders})`),
    bindScope(`DELETE FROM crm_people WHERE id IN (${placeholders})`),
    database.prepare(`DELETE FROM crm_tags
      WHERE NOT EXISTS(
        SELECT 1 FROM crm_person_tags pt WHERE pt.tag_id=crm_tags.id
      )`),
  );

  await database.batch(statements);
  return json({
    ok: true,
    deleted: true,
    personId,
  });
}

async function handleCreateNote(request, database, requestedId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const body = parsed.body;
  const note = asString(body.body || body.note, 10_000);
  if (!note) return failure("Note body is required.", 400);
  const category = asString(body.category || "relationship", 80);
  if (category === PERSONAL_CONTEXT_CATEGORY) {
    return failure("Use the Personal Context form for client-shared personal details.", 400);
  }
  if (!NOTE_CATEGORIES.has(category)) return failure("Note category is invalid.", 400);
  const noteId = id("crm-note");
  const now = nowIso();
  await database.batch([
    database.prepare(`
      INSERT INTO crm_notes(
        id,person_id,category,body,pinned,source_label,source_provider,source_type,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,'','manual','note',?,?)
    `).bind(
      noteId,
      person.id,
      category,
      note,
      body.pinned ? 1 : 0,
      now,
      now,
    ),
    auditStatement(database, {
      personId: person.id,
      action: "note_created",
      resourceType: "note",
      resourceId: noteId,
      after: { category, pinned: Boolean(body.pinned) },
    }),
  ]);
  const created = await database.prepare("SELECT * FROM crm_notes WHERE id=?").bind(noteId).first();
  return json({ note: created }, { status: 201 });
}

async function handleCreatePersonalContext(request, database, requestedId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const body = parsed.body;
  if (asString(body.provenance, 80) !== PERSONAL_CONTEXT_PROVENANCE) {
    return failure("Confirm that this context was shared directly by the client.", 400);
  }
  const rawNote = String(body.body ?? body.note ?? "");
  if (rawNote.length > 10_000) return failure("Personal Context notes are limited to 10,000 characters.", 400);
  const note = asString(rawNote, 10_000);
  if (!note) return failure("Personal Context note is required.", 400);
  const noteId = id("crm-context");
  const now = nowIso();
  await database.batch([
    database.prepare(`
      INSERT INTO crm_notes(
        id,person_id,category,body,pinned,source_label,source_provider,source_type,
        created_at,updated_at
      ) VALUES(?,?,?, ?,?,'Shared by client','manual','shared_by_client',?,?)
    `).bind(
      noteId,
      person.id,
      PERSONAL_CONTEXT_CATEGORY,
      note,
      body.pinned ? 1 : 0,
      now,
      now,
    ),
    auditStatement(database, {
      personId: person.id,
      action: "personal_context_created",
      resourceType: "personal_context",
      resourceId: noteId,
      after: {
        category: PERSONAL_CONTEXT_CATEGORY,
        provenance: PERSONAL_CONTEXT_PROVENANCE,
        pinned: Boolean(body.pinned),
        sensitive: true,
      },
    }),
  ]);
  const created = await database.prepare("SELECT * FROM crm_notes WHERE id=?").bind(noteId).first();
  return json({ personalContext: personalContextView(created) }, { status: 201 });
}

async function handlePersonalContextRecord(request, database, requestedId, noteId) {
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const current = await database.prepare(`
    SELECT n.* FROM crm_notes n
    WHERE n.id=? AND n.category='personal_context' AND n.archived_at IS NULL
      AND n.person_id IN (
        SELECT id FROM crm_people WHERE id=? OR merged_into_id=?
      )
  `).bind(noteId, person.id, person.id).first();
  if (!current) return failure("Personal Context note not found.", 404);
  const now = nowIso();

  if (request.method === "DELETE") {
    await database.batch([
      database.prepare(`
        UPDATE crm_notes SET body='',archived_at=?,updated_at=?
        WHERE id=? AND archived_at IS NULL
      `).bind(now, now, current.id),
      auditStatement(database, {
        personId: person.id,
        action: "personal_context_removed",
        resourceType: "personal_context",
        resourceId: current.id,
        before: {
          category: current.category,
          provenance: PERSONAL_CONTEXT_PROVENANCE,
          pinned: Boolean(current.pinned),
          sensitive: true,
        },
        after: { removed: true, sensitiveBodyScrubbed: true },
      }),
    ]);
    return json({ ok: true, removed: true, noteId: current.id });
  }

  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasOwn(body, "provenance")
    && asString(body.provenance, 80) !== PERSONAL_CONTEXT_PROVENANCE) {
    return failure("Personal Context provenance cannot be changed.", 400);
  }
  const hasBody = hasOwn(body, "body") || hasOwn(body, "note");
  const hasPinned = hasOwn(body, "pinned");
  if (!hasBody && !hasPinned && !hasOwn(body, "provenance")) {
    return failure("No supported Personal Context fields to update.", 400);
  }
  const rawNote = hasBody ? String(body.body ?? body.note ?? "") : current.body;
  if (rawNote.length > 10_000) return failure("Personal Context notes are limited to 10,000 characters.", 400);
  const note = asString(rawNote, 10_000);
  if (!note) return failure("Personal Context note is required.", 400);
  const pinned = hasPinned ? Boolean(body.pinned) : Boolean(current.pinned);
  await database.batch([
    database.prepare(`
      UPDATE crm_notes SET body=?,pinned=?,updated_at=?
      WHERE id=? AND archived_at IS NULL
    `).bind(note, pinned ? 1 : 0, now, current.id),
    auditStatement(database, {
      personId: person.id,
      action: "personal_context_updated",
      resourceType: "personal_context",
      resourceId: current.id,
      before: {
        category: current.category,
        provenance: PERSONAL_CONTEXT_PROVENANCE,
        pinned: Boolean(current.pinned),
        sensitive: true,
      },
      after: {
        category: PERSONAL_CONTEXT_CATEGORY,
        provenance: PERSONAL_CONTEXT_PROVENANCE,
        pinned,
        sensitive: true,
        bodyChanged: note !== current.body,
      },
    }),
  ]);
  const updated = await database.prepare("SELECT * FROM crm_notes WHERE id=?").bind(current.id).first();
  return json({ personalContext: personalContextView(updated) });
}

async function handleCreateIdentity(request, database, requestedId) {
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const kind = asString(body.kind, 40);
  const allowed = new Set(["email", "phone", "instagram", "shopify_customer", "square_customer", "beehiiv_subscription", "substack_subscriber", "other"]);
  if (!allowed.has(kind)) return failure("Identity kind is invalid.", 400);
  const value = asString(body.value, 500);
  if (!value) return failure("Identity value is required.", 400);
  if (kind === "email" && !isLikelyEmail(normalizeEmail(value))) return failure("Email is invalid.", 400);
  if (kind === "phone" && !normalizePhone(value)) return failure("Phone is invalid.", 400);
  const identityId = id("crm-identity");
  const normalized = kind === "email"
    ? normalizeEmail(value)
    : kind === "phone"
      ? normalizePhone(value)
      : kind === "instagram"
        ? normalizeInstagram(value)
        : value.toLowerCase();
  const provider = asString(body.provider || "manual", 80) || "manual";
  const now = nowIso();
  const wantsPrimary = Boolean(body.isPrimary || body.primary);
  const existing = CONTACT_IDENTITY_KINDS.has(kind)
    ? await database.prepare(`
        SELECT * FROM crm_identities
        WHERE person_id=? AND kind=? AND normalized_value=? AND active=1
        LIMIT 1
      `).bind(person.id, kind, normalized).first()
    : null;
  if (existing) {
    const statements = [];
    if (wantsPrimary) {
      statements.push(database.prepare(`
        UPDATE crm_identities SET is_primary=0,updated_at=?
        WHERE person_id=? AND kind=? AND active=1
      `).bind(now, person.id, kind));
    }
    statements.push(database.prepare(`
      UPDATE crm_identities
      SET
        is_primary=CASE WHEN ?=1 THEN 1 ELSE is_primary END,
        is_verified=MAX(is_verified,?),
        is_shared=MAX(is_shared,?),
        label=CASE WHEN label='' AND ?!='' THEN ? ELSE label END,
        updated_at=?
      WHERE id=?
    `).bind(
      wantsPrimary ? 1 : 0,
      body.verified || body.isVerified ? 1 : 0,
      body.shared || body.isShared ? 1 : 0,
      asString(body.label, 100),
      asString(body.label, 100),
      now,
      existing.id,
    ));
    statements.push(ensurePrimaryIdentityStatement(database, person.id, kind, now));
    statements.push(auditStatement(database, {
      personId: person.id,
      action: "duplicate_identity_ignored",
      resourceType: "identity",
      resourceId: existing.id,
      after: { kind, primary: wantsPrimary, deduplicated: true },
    }));
    await database.batch(statements);
    const retained = await database.prepare(
      "SELECT * FROM crm_identities WHERE id=?"
    ).bind(existing.id).first();
    return json({ identity: retained, deduplicated: true });
  }
  const statements = [];
  if (wantsPrimary) {
    statements.push(database.prepare(`
      UPDATE crm_identities SET is_primary=0,updated_at=?
      WHERE person_id=? AND kind=? AND active=1
    `).bind(now, person.id, kind));
  }
  statements.push(database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).bind(
    identityId,
    person.id,
    kind,
    value,
    normalized,
    provider,
    asNullableString(body.externalId || body.external_id, 200),
    asString(body.label, 100),
    wantsPrimary ? 1 : 0,
    body.verified || body.isVerified ? 1 : 0,
    body.shared || body.isShared ? 1 : 0,
    "manual",
    "identity",
    `manual:${identityId}`,
    now,
    now,
  ));
  statements.push(ensurePrimaryIdentityStatement(database, person.id, kind, now));
  statements.push(auditStatement(database, {
    personId: person.id,
    action: "identity_created",
    resourceType: "identity",
    resourceId: identityId,
    after: { kind, provider, primary: wantsPrimary },
  }));
  try {
    await database.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint/i.test(error.message || "")) {
      if (CONTACT_IDENTITY_KINDS.has(kind)) {
        const retained = await database.prepare(`
          SELECT * FROM crm_identities
          WHERE person_id=? AND kind=? AND normalized_value=? AND active=1
          LIMIT 1
        `).bind(person.id, kind, normalized).first();
        if (retained) return json({ identity: retained, deduplicated: true });
      }
      return failure(
        CONTACT_IDENTITY_KINDS.has(kind)
          ? "That contact value is already recorded for this person."
          : "That provider identity is already connected to another person.",
        409,
      );
    }
    throw error;
  }
  const created = await database.prepare("SELECT * FROM crm_identities WHERE id=?").bind(identityId).first();
  return json({ identity: created }, { status: 201 });
}

async function handleFollowups(request, database, requestedId) {
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const now = nowIso();
  if (request.method === "POST") {
    const action = asString(body.action, 500);
    if (!action) return failure("Follow-up action is required.", 400);
    const priority = ["low", "normal", "high"].includes(asString(body.priority, 20))
      ? asString(body.priority, 20)
      : "normal";
    const followupId = id("crm-followup");
    await database.batch([
      database.prepare(`
        INSERT INTO crm_followups(
          id,person_id,action,note,due_at,priority,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,'open',?,?)
      `).bind(
        followupId,
        person.id,
        action,
        asString(body.note, 3000),
        asNullableString(body.dueAt || body.due_at, 80),
        priority,
        now,
        now,
      ),
      auditStatement(database, {
        personId: person.id,
        action: "followup_created",
        resourceType: "followup",
        resourceId: followupId,
        after: { action, dueAt: body.dueAt || null, priority },
      }),
    ]);
    const created = await database.prepare("SELECT * FROM crm_followups WHERE id=?").bind(followupId).first();
    return json({ followup: created }, { status: 201 });
  }
  const followupId = asString(body.id || body.followupId, 120);
  if (!followupId) return failure("Follow-up id is required.", 400);
  const current = await database.prepare(`
    SELECT * FROM crm_followups WHERE id=? AND person_id=?
  `).bind(followupId, person.id).first();
  if (!current) return failure("Follow-up not found.", 404);
  const status = hasOwn(body, "status") ? asString(body.status, 20) : current.status;
  if (!["open", "done", "cancelled"].includes(status)) {
    return failure("Follow-up status is invalid.", 400);
  }
  const action = hasOwn(body, "action") ? asString(body.action, 500) : current.action;
  if (!action) return failure("Follow-up action is required.", 400);
  const priority = hasOwn(body, "priority") ? asString(body.priority, 20) : current.priority;
  if (!["low", "normal", "high"].includes(priority)) {
    return failure("Follow-up priority is invalid.", 400);
  }
  await database.batch([
    database.prepare(`
      UPDATE crm_followups SET action=?,note=?,due_at=?,priority=?,status=?,
        completed_at=?,updated_at=? WHERE id=? AND person_id=?
    `).bind(
      action,
      hasOwn(body, "note") ? asString(body.note, 3000) : current.note,
      hasOwn(body, "dueAt") || hasOwn(body, "due_at")
        ? asNullableString(body.dueAt || body.due_at, 80)
        : current.due_at,
      priority,
      status,
      status === "done" ? current.completed_at || now : null,
      now,
      followupId,
      person.id,
    ),
    auditStatement(database, {
      personId: person.id,
      action: "followup_updated",
      resourceType: "followup",
      resourceId: followupId,
      before: current,
      after: { action, status, priority },
    }),
  ]);
  const updated = await database.prepare("SELECT * FROM crm_followups WHERE id=?").bind(followupId).first();
  return json({ followup: updated });
}

async function handleCreateInteraction(request, database, requestedId) {
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const interactionType = asString(body.interactionType || body.type, 120);
  if (!interactionType) return failure("Interaction type is required.", 400);
  const interactionId = id("crm-interaction");
  const now = nowIso();
  await database.batch([
    database.prepare(`
      INSERT INTO crm_interactions(
        id,person_id,node_id,channel,interaction_type,label,status,quantity,
        occurred_at,source_provider,source_type,source_id,metadata_json,
        active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'manual','interaction',?,?,1,?,?)
    `).bind(
      interactionId,
      person.id,
      asNullableString(body.nodeId || body.node_id, 120),
      asString(body.channel, 120),
      interactionType,
      asString(body.label, 500),
      asString(body.status, 80),
      clampInteger(body.quantity, 1, 100_000, 1),
      asNullableString(body.occurredAt || body.occurred_at, 80) || now,
      asNullableString(body.sourceId, 200),
      JSON.stringify({
        ...parseJsonObject(body.metadata),
        ...(body.details ? { details: asString(body.details, 5000) } : {}),
      }),
      now,
      now,
    ),
    auditStatement(database, {
      personId: person.id,
      action: "interaction_created",
      resourceType: "interaction",
      resourceId: interactionId,
      after: { interactionType, nodeId: body.nodeId || null },
    }),
  ]);
  const created = await database.prepare("SELECT * FROM crm_interactions WHERE id=?").bind(interactionId).first();
  return json({ interaction: { ...created, metadata: parseJson(created.metadata_json, {}) } }, { status: 201 });
}

async function handleCreateTransaction(request, database, requestedId) {
  const person = await ensurePerson(database, requestedId);
  if (!person) return failure("Person not found.", 404);
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const transactionType = asString(body.transactionType || body.type || "charge", 40);
  const status = asString(body.status || "settled", 40);
  if (!TRANSACTION_TYPES.has(transactionType)) return failure("Transaction type is invalid.", 400);
  if (!TRANSACTION_STATUSES.has(status)) return failure("Transaction status is invalid.", 400);
  const amountCents = Math.trunc(Number(body.amountCents ?? body.amount_cents));
  const tipCents = Math.max(0, Math.trunc(Number(body.tipCents ?? body.tip_cents ?? 0)));
  if (!Number.isSafeInteger(amountCents)) return failure("Amount cents must be an integer.", 400);
  if (transactionType !== "adjustment" && amountCents < 0) {
    return failure("Charges and refunds use a non-negative amount.", 400);
  }
  const requestId = asString(
    request.headers.get("Idempotency-Key") || body.requestId || body.idempotencyKey,
    200,
  );
  if (!requestId) {
    return failure("A transaction request id is required.", 400, {
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  const transactionId = id("crm-transaction");
  const now = nowIso();
  const sourceId = `studio:${requestId}`;
  const nodeId = asNullableString(body.nodeId || body.node_id, 120);
  const currency = normalizeCurrency(body.currency);
  const requestedOccurredAt = asNullableString(body.occurredAt || body.occurred_at, 80);
  const occurredAt = requestedOccurredAt || now;
  const note = asString(body.note || body.label || body.reference, 2000);
  const metadataJson = JSON.stringify({
    ...parseJsonObject(body.metadata),
    ...(body.label ? { label: asString(body.label, 500) } : {}),
    ...(body.reference ? { reference: asString(body.reference, 500) } : {}),
  });
  const replayResponse = async () => {
    const existing = await database.prepare(`
      SELECT * FROM crm_transactions
      WHERE source_provider='manual' AND source_type='transaction' AND source_id=?
      LIMIT 1
    `).bind(sourceId).first();
    if (!existing) return null;
    const existingPersonId = existing.person_id
      ? await canonicalPersonId(database, existing.person_id)
      : null;
    const sameRequest = existingPersonId === person.id
      && existing.transaction_type === transactionType
      && existing.status === status
      && Number(existing.amount_cents) === amountCents
      && Number(existing.tip_cents) === tipCents
      && existing.currency === currency
      && (existing.node_id || null) === nodeId
      && (!requestedOccurredAt || existing.occurred_at === occurredAt)
      && existing.note === note
      && existing.metadata_json === metadataJson;
    if (!sameRequest) {
      return failure("That transaction request id was already used for different data.", 409, {
        code: "IDEMPOTENCY_KEY_REUSED",
        transactionId: existing.id,
      });
    }
    return json({
      transaction: { ...existing, metadata: parseJson(existing.metadata_json, {}) },
      idempotent: true,
    });
  };
  const replay = await replayResponse();
  if (replay) return replay;
  try {
    await database.batch([
      database.prepare(`
        INSERT INTO crm_transactions(
          id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,currency,
          occurred_at,source_provider,source_type,source_id,note,metadata_json,
          active,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,'manual','transaction',?,?,?,1,?,?)
      `).bind(
        transactionId,
        person.id,
        nodeId,
        transactionType,
        status,
        amountCents,
        tipCents,
        currency,
        occurredAt,
        sourceId,
        note,
        metadataJson,
        now,
        now,
      ),
      auditStatement(database, {
        personId: person.id,
        action: "transaction_created",
        resourceType: "transaction",
        resourceId: transactionId,
        after: { transactionType, status, amountCents, currency },
      }),
    ]);
  } catch (error) {
    if (/UNIQUE constraint/i.test(error.message || "")) {
      const concurrentReplay = await replayResponse();
      if (concurrentReplay) return concurrentReplay;
    }
    throw error;
  }
  const created = await database.prepare("SELECT * FROM crm_transactions WHERE id=?").bind(transactionId).first();
  return json({ transaction: { ...created, metadata: parseJson(created.metadata_json, {}) } }, { status: 201 });
}

async function handleMergePeople(request, database) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const survivorId = await canonicalPersonId(database, body.survivorPersonId || body.survivor_id);
  const duplicateId = await canonicalPersonId(database, body.duplicatePersonId || body.duplicate_id);
  if (!survivorId || !duplicateId) return failure("Both people must exist.", 404);
  if (survivorId === duplicateId) return failure("Select two different people.", 409);
  const duplicate = await database.prepare("SELECT * FROM crm_people WHERE id=?").bind(duplicateId).first();
  if (duplicate.merged_into_id) return failure("The duplicate is already merged.", 409);
  const reason = asString(body.reason, 2000);
  if (!reason) return failure("A merge reason is required.", 400);
  const dependentAlias = await database.prepare(`
    SELECT id FROM crm_people WHERE merged_into_id=? LIMIT 1
  `).bind(duplicateId).first();
  if (dependentAlias) {
    return failure("Unmerge this person's aliases before merging it into another person.", 409, {
      code: "MERGE_CHAIN_NOT_ALLOWED",
      aliasPersonId: dependentAlias.id,
    });
  }
  const mergeId = id("crm-merge");
  const now = nowIso();
  await database.batch([
    database.prepare(`
      UPDATE crm_people SET merged_into_id=?,relationship_status='merged',updated_at=? WHERE id=?
    `).bind(survivorId, now, duplicateId),
    database.prepare(`
      INSERT INTO crm_merges(id,survivor_person_id,duplicate_person_id,reason,actor,merged_at)
      VALUES(?,?,?,?,'studio',?)
    `).bind(mergeId, survivorId, duplicateId, reason, now),
    auditStatement(database, {
      personId: survivorId,
      action: "people_merged",
      resourceType: "merge",
      resourceId: mergeId,
      after: { survivorPersonId: survivorId, duplicatePersonId: duplicateId, reason },
    }),
  ]);
  return json({ ok: true, mergeId, survivorPersonId: survivorId, duplicatePersonId: duplicateId });
}

async function handleUnmergePerson(database, duplicateId) {
  const duplicate = await database.prepare("SELECT * FROM crm_people WHERE id=?").bind(duplicateId).first();
  if (!duplicate) return failure("Person not found.", 404);
  if (!duplicate.merged_into_id) return failure("This person is not merged.", 409);
  const merge = await database.prepare(`
    SELECT * FROM crm_merges WHERE duplicate_person_id=? AND unmerged_at IS NULL
    ORDER BY merged_at DESC LIMIT 1
  `).bind(duplicateId).first();
  const now = nowIso();
  const statements = [
    database.prepare(`
      UPDATE crm_people SET merged_into_id=NULL,relationship_status='active',updated_at=? WHERE id=?
    `).bind(now, duplicateId),
  ];
  if (merge) {
    statements.push(database.prepare("UPDATE crm_merges SET unmerged_at=? WHERE id=?").bind(now, merge.id));
  }
  statements.push(auditStatement(database, {
    personId: duplicateId,
    action: "person_unmerged",
    resourceType: "merge",
    resourceId: merge?.id || null,
    before: { mergedIntoId: duplicate.merged_into_id },
    after: { mergedIntoId: null },
  }));
  await database.batch(statements);
  return json({ ok: true, personId: duplicateId });
}

class ImportInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readBoundedBytes(request, maximum = MAX_IMPORT_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximum) {
    throw new ImportInputError("Import payload exceeds the 5 MB file limit.", 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel("Import payload too large.").catch(() => {});
      throw new ImportInputError("Import payload exceeds the 5 MB file limit.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseEmbeddedJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function extractImportFile(request) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const bodyBytes = await readBoundedBytes(request);
  let filename = "";
  let fileBytes = null;
  let config = {};
  let requestedDelimiter = "";

  if (contentType.includes("multipart/form-data")) {
    let formData;
    try {
      formData = await new Response(bodyBytes, {
        headers: { "content-type": request.headers.get("content-type") },
      }).formData();
    } catch {
      throw new ImportInputError("Unable to read the uploaded form.");
    }
    const file = formData.get("file");
    if (!(typeof File !== "undefined" && file instanceof File)) {
      throw new ImportInputError("Choose a CSV or TSV file.");
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ImportInputError("Import file cannot exceed 5 MB.", 413);
    }
    filename = asString(file.name, 255);
    fileBytes = new Uint8Array(await file.arrayBuffer());
    config = parseEmbeddedJson(formData.get("config"), {});
    for (const key of [
      "sourceLabel", "sourcePeriodStart", "sourcePeriodEnd", "defaultInteractionType",
      "defaultNodeId", "dateFormat", "currency", "moneyMode", "newsletterProvider",
      "subscriptionStatus",
    ]) {
      const value = formData.get(key);
      if (value !== null && value !== "") config[key] = value;
    }
    if (formData.has("newsletterExport")) {
      config.newsletterExport = ["1", "true", "yes", "on"].includes(
        asString(formData.get("newsletterExport")).toLowerCase()
      );
    }
    requestedDelimiter = asString(formData.get("delimiter"), 4);
  } else if (contentType.includes("application/json")) {
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      throw new ImportInputError("Expected a valid JSON import payload.");
    }
    filename = asString(payload.filename, 255);
    config = parseEmbeddedJson(payload.config, {});
    requestedDelimiter = asString(payload.delimiter, 4);
    if (typeof payload.content !== "string") {
      throw new ImportInputError("JSON imports require a string content field.");
    }
    fileBytes = new TextEncoder().encode(payload.content);
  } else if (contentType.includes("text/csv") || contentType.includes("text/tab-separated-values")) {
    filename = asString(request.headers.get("x-filename"), 255)
      || (contentType.includes("tab-separated") ? "import.tsv" : "import.csv");
    fileBytes = bodyBytes;
  } else {
    throw new ImportInputError("Use multipart/form-data, application/json, text/csv, or text/tab-separated-values.", 415);
  }

  if (!filename || !/\.(csv|tsv)$/i.test(filename)) {
    throw new ImportInputError("Only .csv and .tsv files are accepted.");
  }
  if (!fileBytes || !fileBytes.byteLength) throw new ImportInputError("The import file is empty.");
  if (fileBytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportInputError("Import file cannot exceed 5 MB.", 413);
  }
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes).replace(/^\uFEFF/, "");
  } catch {
    throw new ImportInputError("Import files must be UTF-8 encoded.");
  }
  return { filename, fileBytes, content, config, requestedDelimiter };
}

function inferDelimiter(content, filename, requested = "") {
  if (requested === "\\t" || requested === "\t" || requested.toLowerCase() === "tab") return "\t";
  if (requested === ",") return ",";
  if (/\.tsv$/i.test(filename)) return "\t";
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  for (let index = 0; index < Math.min(content.length, 20_000); index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      break;
    } else if (!quoted && char === ",") commas += 1;
    else if (!quoted && char === "\t") tabs += 1;
  }
  return tabs > commas ? "\t" : ",";
}

function parseDelimited(content, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let rowStartLine = 1;
  let line = 1;
  const pushField = () => {
    row.push(field);
    field = "";
    if (row.length > MAX_IMPORT_COLUMNS) {
      throw new ImportInputError(`Import files can contain at most ${MAX_IMPORT_COLUMNS} columns.`, 413);
    }
  };
  const pushRow = () => {
    pushField();
    rows.push({ cells: row, sourceLine: rowStartLine });
    if (rows.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportInputError(`Import files can contain at most ${MAX_IMPORT_ROWS} data rows.`, 413);
    }
    row = [];
    rowStartLine = line + 1;
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
        if (char === "\n") line += 1;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      pushRow();
      line += 1;
      rowStartLine = line;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new ImportInputError("The file ends inside a quoted field.");
  if (field !== "" || row.length) pushRow();
  const nonEmpty = rows.filter(({ cells }) => cells.some((cell) => asString(cell)));
  if (nonEmpty.length < 2) throw new ImportInputError("The file must include a header and at least one data row.");
  return nonEmpty;
}

function normalizedHeaders(cells) {
  const used = new Map();
  return cells.map((cell, index) => {
    const base = asString(cell, 200) || `Column ${index + 1}`;
    const key = base.toLowerCase();
    const occurrence = (used.get(key) || 0) + 1;
    used.set(key, occurrence);
    return occurrence === 1 ? base : `${base} (${occurrence})`;
  });
}

function canonicalHeader(value) {
  return asString(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function suggestMapping(headers) {
  const suggestions = {};
  const rules = [
    ["name", /^(full )?name$|client name|customer name|subscriber name/],
    ["first_name", /^first name$|^firstname$/],
    ["last_name", /^last name$|^lastname$|^surname$/],
    ["email", /e ?mail/],
    ["phone", /phone|mobile|cell/],
    ["instagram", /instagram|insta|ig handle|social handle/],
    ["organization", /organization|organisation|company|business/],
    ["pronouns", /pronouns?/],
    ["referral_source", /referral|heard|how.*find|source/],
    ["date", /^date$|created|booking date|appointment date|purchase date|joined/],
    ["node", /^node$|venture|construct node/],
    ["interaction", /interaction|engagement|service|booking type|client type/],
    ["amount", /amount paid|paid amount|total spent|lifetime spend|spend|price|amount/],
    ["tip", /^tip|gratuity/],
    ["currency", /currency/],
    ["payment_reference", /payment.*(id|reference)|transaction.*(id|reference)|order id|receipt/],
    ["tags", /^tags?$|labels?|interests?/],
    ["notes", /notes?|comments?|memo/],
    ["tier", /^tier$|client tier|relationship tier/],
    ["consent", /consent|subscription status|newsletter status|subscribed|unsubscribed/],
    ["provider_id", /customer id|subscriber id|provider id|external id/],
  ];
  for (const [field, rule] of rules) {
    const match = headers.find((header) => rule.test(canonicalHeader(header)));
    if (match && !Object.values(suggestions).includes(match)) suggestions[field] = match;
  }
  return suggestions;
}

function normalizeMapping(mapping, headers) {
  const source = parseJsonObject(mapping);
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    let field = key;
    let header = value;
    if (!IMPORT_FIELDS.has(field) && IMPORT_FIELDS.has(asString(value))) {
      field = asString(value);
      header = key;
    }
    if (!IMPORT_FIELDS.has(field)) continue;
    field = IMPORT_FIELD_ALIASES[field] || field;
    if (Number.isInteger(header) && headers[header]) output[field] = headers[header];
    else {
      const resolved = headers.find((candidate) => candidate === header)
        || headers.find((candidate) => candidate.toLowerCase() === asString(header).toLowerCase());
      if (resolved) output[field] = resolved;
    }
  }
  return output;
}

function normalizedImportConfig(value = {}) {
  const config = parseJsonObject(value);
  const moneyMode = ["none", "transaction", "aggregate", "estimate", "unpaid"]
    .includes(asString(config.moneyMode || config.money_mode, 20))
    ? asString(config.moneyMode || config.money_mode, 20)
    : "none";
  return {
    sourceLabel: asString(config.sourceLabel || config.source_label, 200),
    sourcePeriodStart: asNullableString(config.sourcePeriodStart || config.source_period_start, 40),
    sourcePeriodEnd: asNullableString(config.sourcePeriodEnd || config.source_period_end, 40),
    defaultInteractionType: asString(
      config.defaultInteractionType || config.default_interaction_type || "legacy_contact",
      120,
    ) || "legacy_contact",
    defaultNodeId: asNullableString(config.defaultNodeId || config.default_node_id, 120),
    dateFormat: asString(config.dateFormat || config.date_format || "auto", 30) || "auto",
    currency: normalizeCurrency(config.currency),
    moneyMode,
    amountUnit: asString(config.amountUnit || config.amount_unit || "major", 20) === "cents" ? "cents" : "major",
    newsletterExport: Boolean(config.newsletterExport ?? config.newsletter_export),
    newsletterProvider: asString(config.newsletterProvider || config.newsletter_provider, 80).toLowerCase(),
    subscriptionStatus: SUBSCRIPTION_STATUSES.has(asString(config.subscriptionStatus, 30))
      ? asString(config.subscriptionStatus, 30)
      : "unknown",
    confirmImportedTiers: Boolean(
      config.confirmImportedTiers
      ?? config.confirm_imported_tiers
      ?? config.confirmTierProposals
      ?? config.confirm_tier_proposals,
    ),
    aggregateConfirmed: Boolean(
      config.aggregateConfirmed
      ?? config.aggregate_confirmed
      ?? config.confirmAggregateSpend
      ?? config.confirm_aggregate_spend,
    ),
    completeSubscriberExport: Boolean(
      config.completeSubscriberExport
      ?? config.complete_subscriber_export,
    ),
  };
}

function mappedCell(rowObject, mapping, field) {
  const header = mapping[field];
  return header ? rowObject[header] : "";
}

function parseMoney(value, unit = "major") {
  const source = asString(value, 100);
  if (!source) return { cents: null };
  const negative = /^\(.*\)$/.test(source) || /^-/.test(source);
  const cleaned = source.replace(/[,$£€¥\s()]/g, "").replace(/^[A-Z]{3}/i, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) return { cents: null, error: "Money value is invalid." };
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return { cents: null, error: "Money value is invalid." };
  const cents = unit === "cents" ? Math.trunc(number) : Math.round(Math.abs(number) * 100);
  return { cents: negative ? -Math.abs(cents) : cents };
}

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseHistoricalDate(value, format = "auto") {
  const source = asString(value, 100);
  if (!source) return { value: null };
  let match;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(source))) {
    const [, year, month, day] = match.map(Number);
    return validCalendarDate(year, month, day)
      ? { value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z` }
      : { value: null, error: "Date is invalid." };
  }
  if ((match = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/.exec(source))) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const dayFirst = /^(dmy|dd\/mm\/yyyy)$/i.test(format);
    const month = dayFirst ? second : first;
    const day = dayFirst ? first : second;
    return validCalendarDate(year, month, day)
      ? { value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z` }
      : { value: null, error: "Date is invalid." };
  }
  if ((match = /^(\d{4})$/.exec(source))) {
    return { value: `${match[1]}-07-01T12:00:00.000Z`, approximate: true };
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime())
    ? { value: null, error: "Date is invalid." }
    : { value: parsed.toISOString() };
}

function splitTags(value) {
  return uniqueStrings(asString(value, 2000).split(/[,;|]/), 50);
}

function normalizedImportRow(rowObject, mapping, config) {
  const firstName = asString(mappedCell(rowObject, mapping, "first_name"), 120);
  const lastName = asString(mappedCell(rowObject, mapping, "last_name"), 120);
  const name = asString(mappedCell(rowObject, mapping, "name"), 200)
    || [firstName, lastName].filter(Boolean).join(" ");
  const rawEmail = asString(mappedCell(rowObject, mapping, "email"), 320);
  const rawPhone = asString(mappedCell(rowObject, mapping, "phone"), 80);
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  const instagram = normalizeInstagram(mappedCell(rowObject, mapping, "instagram"));
  const date = parseHistoricalDate(mappedCell(rowObject, mapping, "date"), config.dateFormat);
  const amount = parseMoney(mappedCell(rowObject, mapping, "amount"), config.amountUnit);
  const tip = parseMoney(mappedCell(rowObject, mapping, "tip"), config.amountUnit);
  const tier = normalizeTier(mappedCell(rowObject, mapping, "tier"));
  const consentRaw = asString(mappedCell(rowObject, mapping, "consent"), 100).toLowerCase();
  let consent = "unknown";
  if (/^(yes|true|1|subscribed|active|confirmed|opted in)$/.test(consentRaw)) consent = "subscribed";
  if (/^(no|false|0|unsubscribed|inactive|deleted|opted out|suppressed)$/.test(consentRaw)) consent = "unsubscribed";
  if (/^paused$/.test(consentRaw)) consent = "paused";
  const errors = [];
  const warnings = [];
  if (rawEmail && (!email || !isLikelyEmail(email))) errors.push("Email is invalid.");
  if (rawPhone && !phone) errors.push("Phone is invalid.");
  if (date.error) errors.push(date.error);
  if (amount.error) errors.push(amount.error);
  if (tip.error) errors.push(`Tip: ${tip.error}`);
  if (tier.error && asString(mappedCell(rowObject, mapping, "tier"))) errors.push(tier.error);
  if (!name && !email && !phone && !instagram) errors.push("No usable identity was found.");
  if (config.newsletterExport && !email) warnings.push("Newsletter row has no valid email.");
  return {
    name,
    preferredName: asString(mappedCell(rowObject, mapping, "preferred_name"), 200),
    firstName,
    lastName,
    email,
    phone,
    phoneDisplay: rawPhone,
    instagram,
    organization: asString(mappedCell(rowObject, mapping, "organization"), 200),
    pronouns: asString(mappedCell(rowObject, mapping, "pronouns"), 100),
    referralSource: asString(mappedCell(rowObject, mapping, "referral_source"), 120),
    occurredAt: date.value || config.sourcePeriodEnd || config.sourcePeriodStart || null,
    approximateDate: Boolean(date.approximate || (!date.value && (config.sourcePeriodStart || config.sourcePeriodEnd))),
    nodeId: asString(mappedCell(rowObject, mapping, "node"), 120) || config.defaultNodeId,
    interactionType: asString(mappedCell(rowObject, mapping, "interaction"), 120) || config.defaultInteractionType,
    amountCents: amount.cents,
    tipCents: tip.cents || 0,
    currency: normalizeCurrency(mappedCell(rowObject, mapping, "currency") || config.currency),
    paymentReference: asString(mappedCell(rowObject, mapping, "payment_reference"), 200),
    tags: splitTags(mappedCell(rowObject, mapping, "tags")),
    notes: asString(mappedCell(rowObject, mapping, "notes"), 10_000),
    tier: tier.error ? null : tier.value,
    consent,
    providerId: asString(mappedCell(rowObject, mapping, "provider_id"), 200),
    errors,
    warnings,
  };
}

function chunks(values, size = 50) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function loadIdentityMatches(database, kind, values) {
  const map = new Map();
  const unique = [...new Set(values.filter(Boolean))];
  for (const group of chunks(unique, 50)) {
    const placeholders = group.map(() => "?").join(",");
    const result = await database.prepare(`
      SELECT i.normalized_value,COALESCE(p.merged_into_id,p.id) person_id,i.is_shared
      FROM crm_identities i JOIN crm_people p ON p.id=i.person_id
      WHERE i.kind=? AND i.active=1 AND p.anonymized_at IS NULL
        AND i.normalized_value IN (${placeholders})
    `).bind(kind, ...group).all();
    for (const row of result.results || []) {
      if (!map.has(row.normalized_value)) {
        map.set(row.normalized_value, { personIds: new Set(), anyShared: false });
      }
      const entry = map.get(row.normalized_value);
      entry.personIds.add(row.person_id);
      entry.anyShared ||= Boolean(row.is_shared);
    }
  }
  return map;
}

async function loadNameMatches(database, names) {
  const map = new Map();
  const unique = [...new Set(names.map((value) => value.toLowerCase()).filter(Boolean))];
  for (const group of chunks(unique, 50)) {
    const placeholders = group.map(() => "?").join(",");
    const result = await database.prepare(`
      SELECT LOWER(display_name) normalized_name,COALESCE(merged_into_id,id) person_id
      FROM crm_people
      WHERE anonymized_at IS NULL AND LOWER(display_name) IN (${placeholders})
    `).bind(...group).all();
    for (const row of result.results || []) {
      if (!map.has(row.normalized_name)) map.set(row.normalized_name, new Set());
      map.get(row.normalized_name).add(row.person_id);
    }
  }
  return map;
}

async function loadImportedFingerprints(database, fingerprints) {
  const found = new Set();
  for (const group of chunks([...new Set(fingerprints)], 50)) {
    const placeholders = group.map(() => "?").join(",");
    const result = await database.prepare(`
      SELECT source_id FROM crm_interactions
      WHERE source_provider='legacy_import' AND source_type='legacy_row'
        AND source_id IN (${placeholders})
      UNION
      SELECT row_fingerprint source_id FROM crm_import_rows
      WHERE apply_state='applied' AND row_fingerprint IN (${placeholders})
    `).bind(...group, ...group).all();
    for (const row of result.results || []) found.add(row.source_id);
  }
  return found;
}

async function loadPersonSpend(database, personIds) {
  const map = new Map();
  const unique = [...new Set(personIds.filter(Boolean))];
  for (const group of chunks(unique, 50)) {
    const placeholders = group.map(() => "?").join(",");
    const result = await database.prepare(`
      SELECT person_id,COALESCE(SUM(CASE
        WHEN transaction_type='charge' AND status='settled' THEN amount_cents
        WHEN transaction_type='refund' AND status='settled' THEN -amount_cents
        WHEN transaction_type='adjustment' AND status='settled' THEN amount_cents
        ELSE 0 END),0) net_cents
      FROM crm_transactions
      WHERE active=1 AND person_id IN (${placeholders})
      GROUP BY person_id
    `).bind(...group).all();
    for (const row of result.results || []) map.set(row.person_id, Number(row.net_cents || 0));
  }
  return map;
}

async function fingerprintRows(rows) {
  const output = [];
  for (const group of chunks(rows, 100)) {
    const fingerprints = await Promise.all(
      group.map((row) => sha256Hex(JSON.stringify(stableValue(row))))
    );
    output.push(...fingerprints);
  }
  return output;
}

async function classifyImportRows(database, normalizedRows, fingerprints, config) {
  const emailMap = await loadIdentityMatches(database, "email", normalizedRows.map((row) => row.email));
  const phoneMap = await loadIdentityMatches(database, "phone", normalizedRows.map((row) => row.phone));
  const nameMap = await loadNameMatches(database, normalizedRows.map((row) => row.name));
  const imported = await loadImportedFingerprints(database, fingerprints);
  const exactIds = normalizedRows.map((row) => {
    const entry = emailMap.get(row.email);
    const matches = [...(entry?.personIds || [])];
    return matches.length === 1 && !entry?.anyShared ? matches[0] : null;
  });
  const spend = await loadPersonSpend(database, exactIds);
  const seen = new Set();
  return normalizedRows.map((row, index) => {
    const fingerprint = fingerprints[index];
    const emailEntry = emailMap.get(row.email);
    const phoneEntry = phoneMap.get(row.phone);
    const emailCandidates = [...(emailEntry?.personIds || [])];
    const phoneCandidates = [...(phoneEntry?.personIds || [])];
    const nameCandidates = [...(nameMap.get((row.name || "").toLowerCase()) || [])];
    const possibleCandidates = [...new Set([...phoneCandidates, ...nameCandidates])];
    let classification = "new_person";
    let matchedPersonId = null;
    let decision = "create";
    if (seen.has(fingerprint)) {
      classification = "duplicate_in_file";
      decision = "skip";
    } else if (imported.has(fingerprint)) {
      classification = "already_imported";
      decision = "skip";
    } else if (row.errors.length) {
      classification = "invalid";
      decision = "skip";
    } else if (emailCandidates.length === 1 && !emailEntry?.anyShared) {
      matchedPersonId = emailCandidates[0];
      if (
        config.moneyMode === "aggregate"
        && row.amountCents !== null
        && Number(spend.get(matchedPersonId) || 0) !== 0
        && !config.aggregateConfirmed
      ) {
        classification = "money_conflict";
        decision = "review";
      } else {
        classification = "exact_match";
        decision = "link";
      }
    } else if (emailCandidates.length || emailEntry?.anyShared || possibleCandidates.length) {
      classification = "possible_match";
      decision = "review";
    }
    seen.add(fingerprint);
    return {
      classification,
      matchedPersonId,
      matchDetail: {
        emailCandidates,
        emailShared: Boolean(emailEntry?.anyShared),
        phoneCandidates,
        nameCandidates,
      },
      decision,
      fingerprint,
    };
  });
}

function importBatchView(row) {
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    fileHash: row.file_hash,
    sourceLabel: row.source_label || "",
    sourcePeriodStart: row.source_period_start || null,
    sourcePeriodEnd: row.source_period_end || null,
    defaultInteractionType: row.default_interaction_type,
    defaultNodeId: row.default_node_id || null,
    dateFormat: row.date_format,
    currency: row.currency,
    moneyMode: row.money_mode,
    newsletterExport: Boolean(row.newsletter_export),
    newsletterProvider: row.newsletter_provider || "",
    delimiter: row.delimiter,
    headers: parseJson(row.header_json, []),
    mapping: parseJson(row.mapping_json, {}),
    config: parseJson(row.config_json, {}),
    status: row.status,
    rowCount: Number(row.row_count || 0),
    columnCount: Number(row.column_count || 0),
    summary: parseJson(row.summary_json, {}),
    error: row.error || "",
    stagingExpiresAt: row.staging_expires_at || null,
    appliedAt: row.applied_at || null,
    rolledBackAt: row.rolled_back_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summarizeClassifications(classified) {
  const summary = {
    total: classified.length,
    newPerson: 0,
    exactMatch: 0,
    possibleMatch: 0,
    duplicateInFile: 0,
    alreadyImported: 0,
    moneyConflict: 0,
    invalid: 0,
    reviewRequired: 0,
  };
  const keys = {
    new_person: "newPerson",
    exact_match: "exactMatch",
    possible_match: "possibleMatch",
    duplicate_in_file: "duplicateInFile",
    already_imported: "alreadyImported",
    money_conflict: "moneyConflict",
    invalid: "invalid",
  };
  for (const row of classified) {
    summary[keys[row.classification]] += 1;
    if (row.decision === "review") summary.reviewRequired += 1;
  }
  return summary;
}

function importPreviewRow(row) {
  return {
    id: row.id,
    rowNumber: Number(row.row_number),
    rowFingerprint: row.row_fingerprint,
    raw: parseJson(row.raw_json, {}),
    normalized: parseJson(row.normalized_json, {}),
    classification: row.classification,
    matchedPersonId: row.matched_person_id || null,
    matchDetail: parseJson(row.match_detail_json, {}),
    validationErrors: parseJson(row.validation_errors_json, []),
    warnings: parseJson(row.warnings_json, []),
    decision: row.decision,
    targetPersonId: row.target_person_id || null,
    applyState: row.apply_state,
    appliedPersonId: row.applied_person_id || null,
    error: row.error || "",
  };
}

async function importMatchCandidates(database, rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row.matchedPersonId) ids.add(row.matchedPersonId);
    if (row.targetPersonId) ids.add(row.targetPersonId);
    const detail = row.matchDetail || {};
    for (const key of ["emailCandidates", "phoneCandidates", "nameCandidates"]) {
      for (const personId of Array.isArray(detail[key]) ? detail[key] : []) {
        if (personId) ids.add(personId);
      }
    }
  }
  const candidates = [];
  for (const group of chunks([...ids], 50)) {
    const placeholders = group.map(() => "?").join(",");
    const result = await database.prepare(`${personSelectSql(`p.id IN (${placeholders})`)}
      ORDER BY p.display_name COLLATE NOCASE
    `).bind(...group).all();
    candidates.push(...(result.results || []).map(personView));
  }
  return candidates;
}

async function purgeExpiredStaging(database) {
  await database.prepare(`
    UPDATE crm_import_rows
    SET raw_json='{}',normalized_json='{}',updated_at=datetime('now')
    WHERE import_batch_id IN (
      SELECT id FROM crm_import_batches
      WHERE staging_expires_at IS NOT NULL AND staging_expires_at<datetime('now')
        AND status IN ('applied','rolled_back')
    ) AND (raw_json!='{}' OR normalized_json!='{}')
  `).run();
}

async function existingImportResponse(database, row) {
  const preview = await database.prepare(`
    SELECT * FROM crm_import_rows WHERE import_batch_id=? ORDER BY row_number LIMIT 50
  `).bind(row.id).all();
  return json({
    importBatch: importBatchView(row),
    columns: parseJson(row.header_json, []),
    mapping: parseJson(row.mapping_json, {}),
    preview: (preview.results || []).map(importPreviewRow),
    summary: parseJson(row.summary_json, {}),
    idempotent: true,
  });
}

async function handleAnalyzeImport(request, database) {
  await purgeExpiredStaging(database);
  let extracted;
  try {
    extracted = await extractImportFile(request);
  } catch (error) {
    if (error instanceof ImportInputError) return failure(error.message, error.status);
    throw error;
  }
  const fileHash = await sha256Hex(extracted.fileBytes);
  const prior = await database.prepare("SELECT * FROM crm_import_batches WHERE file_hash=?").bind(fileHash).first();
  if (prior) return existingImportResponse(database, prior);

  let parsedRows;
  try {
    const delimiter = inferDelimiter(extracted.content, extracted.filename, extracted.requestedDelimiter);
    parsedRows = { delimiter, rows: parseDelimited(extracted.content, delimiter) };
  } catch (error) {
    if (error instanceof ImportInputError) return failure(error.message, error.status);
    throw error;
  }
  const headers = normalizedHeaders(parsedRows.rows[0].cells);
  if (headers.length > MAX_IMPORT_COLUMNS) {
    return failure(`Import files can contain at most ${MAX_IMPORT_COLUMNS} columns.`, 413);
  }
  const config = normalizedImportConfig(extracted.config);
  const suppliedMapping = extracted.config.mapping || extracted.config.columnMapping;
  const mapping = Object.keys(parseJsonObject(suppliedMapping)).length
    ? normalizeMapping(suppliedMapping, headers)
    : suggestMapping(headers);
  const sourceRows = parsedRows.rows.slice(1).map((entry) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = asString(entry.cells[index], 20_000);
    });
    return { rowNumber: entry.sourceLine, raw: object };
  });
  const normalizedRows = sourceRows.map(({ raw }) => normalizedImportRow(raw, mapping, config));
  const fingerprints = await fingerprintRows(sourceRows.map(({ raw }) => raw));
  const classified = await classifyImportRows(database, normalizedRows, fingerprints, config);
  const summary = summarizeClassifications(classified);
  const batchId = id("crm-import");
  const now = nowIso();
  const expires = new Date(Date.now() + STAGING_RETENTION_DAYS * 86400000).toISOString();
  const configJson = { ...config };
  const batchStatement = database.prepare(`
    INSERT INTO crm_import_batches(
      id,filename,file_hash,source_label,source_period_start,source_period_end,
      default_interaction_type,default_node_id,date_format,currency,money_mode,
      newsletter_export,newsletter_provider,delimiter,header_json,mapping_json,
      config_json,status,row_count,column_count,summary_json,staging_expires_at,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'analyzed',?,?,?,?,?,?)
  `).bind(
    batchId,
    extracted.filename,
    fileHash,
    config.sourceLabel,
    config.sourcePeriodStart,
    config.sourcePeriodEnd,
    config.defaultInteractionType,
    config.defaultNodeId,
    config.dateFormat,
    config.currency,
    config.moneyMode,
    config.newsletterExport ? 1 : 0,
    config.newsletterProvider || null,
    parsedRows.delimiter,
    JSON.stringify(headers),
    JSON.stringify(mapping),
    JSON.stringify(configJson),
    sourceRows.length,
    headers.length,
    JSON.stringify(summary),
    expires,
    now,
    now,
  );
  try {
    await batchStatement.run();
  } catch (error) {
    if (/UNIQUE constraint/i.test(error.message || "")) {
      const raced = await database.prepare("SELECT * FROM crm_import_batches WHERE file_hash=?").bind(fileHash).first();
      if (raced) return existingImportResponse(database, raced);
    }
    throw error;
  }
  for (const group of chunks(sourceRows.map((source, index) => ({ source, index })), 75)) {
    await database.batch(group.map(({ source, index }) => {
      const match = classified[index];
      const normalized = normalizedRows[index];
      return database.prepare(`
        INSERT INTO crm_import_rows(
          id,import_batch_id,row_number,row_fingerprint,raw_json,normalized_json,
          classification,matched_person_id,match_detail_json,validation_errors_json,
          warnings_json,decision,apply_state,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
      `).bind(
        id("crm-import-row"),
        batchId,
        source.rowNumber,
        match.fingerprint,
        JSON.stringify(source.raw),
        JSON.stringify(normalized),
        match.classification,
        match.matchedPersonId,
        JSON.stringify(match.matchDetail),
        JSON.stringify(normalized.errors),
        JSON.stringify(normalized.warnings),
        match.decision,
        now,
        now,
      );
    }));
  }
  await auditStatement(database, {
    action: "import_analyzed",
    resourceType: "import_batch",
    resourceId: batchId,
    after: { filename: extracted.filename, rowCount: sourceRows.length, summary },
    importBatchId: batchId,
  }).run();
  const batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(batchId).first();
  const preview = await database.prepare(`
    SELECT * FROM crm_import_rows WHERE import_batch_id=? ORDER BY row_number LIMIT 50
  `).bind(batchId).all();
  return json({
    importBatch: importBatchView(batch),
    columns: headers,
    mapping,
    preview: (preview.results || []).map(importPreviewRow),
    summary,
  }, { status: 201 });
}

async function handleListImports(request, database) {
  await purgeExpiredStaging(database);
  const url = new URL(request.url);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 100, 50);
  const result = await database.prepare(`
    SELECT * FROM crm_import_batches ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all();
  return json({ imports: (result.results || []).map(importBatchView) });
}

async function handleImportRows(request, database, importId) {
  await purgeExpiredStaging(database);
  const batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  if (!batch) return failure("Import not found.", 404);
  const url = new URL(request.url);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 250, 100);
  const offset = clampInteger(url.searchParams.get("offset"), 0, MAX_IMPORT_ROWS, 0);
  const classification = asString(url.searchParams.get("classification"), 40);
  const filters = ["import_batch_id=?"];
  const values = [importId];
  if (IMPORT_CLASSIFICATIONS.has(classification)) {
    filters.push("classification=?");
    values.push(classification);
  }
  const result = await database.prepare(`
    SELECT * FROM crm_import_rows WHERE ${filters.join(" AND ")}
    ORDER BY row_number LIMIT ? OFFSET ?
  `).bind(...values, limit, offset).all();
  const rows = (result.results || []).map(importPreviewRow);
  return json({
    importBatch: importBatchView(batch),
    rows,
    candidates: await importMatchCandidates(database, rows),
    summary: parseJson(batch.summary_json, {}),
    limit,
    offset,
  });
}

async function handlePatchImport(request, database, importId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  if (!batch) return failure("Import not found.", 404);
  if (["applying", "applied"].includes(batch.status)) {
    return failure("Applied imports cannot be remapped. Roll back the batch first.", 409);
  }
  const headers = parseJson(batch.header_json, []);
  const oldConfig = parseJson(batch.config_json, {});
  const config = normalizedImportConfig({
    ...oldConfig,
    ...parseJsonObject(body.config),
    ...body,
  });
  const mapping = hasOwn(body, "mapping")
    ? normalizeMapping(body.mapping, headers)
    : parseJson(batch.mapping_json, {});
  const staged = await database.prepare(`
    SELECT * FROM crm_import_rows WHERE import_batch_id=? ORDER BY row_number
  `).bind(importId).all();
  const stagedRows = staged.results || [];
  const shouldReclassify = hasOwn(body, "mapping") || hasOwn(body, "config")
    || [
      "sourceLabel", "sourcePeriodStart", "sourcePeriodEnd", "defaultInteractionType",
      "defaultNodeId", "dateFormat", "currency", "moneyMode", "newsletterExport",
      "newsletterProvider", "subscriptionStatus", "aggregateConfirmed",
      "confirmAggregateSpend", "confirmImportedTiers", "confirmTierProposals",
      "completeSubscriberExport",
    ].some((key) => hasOwn(body, key));
  let classified = null;
  let normalizedRows = null;
  if (shouldReclassify) {
    if (stagedRows.some((row) => row.raw_json === "{}")) {
      return failure("Private staging rows have expired; upload the source file again.", 410);
    }
    normalizedRows = stagedRows.map((row) => normalizedImportRow(
      parseJson(row.raw_json, {}),
      mapping,
      config,
    ));
    classified = await classifyImportRows(
      database,
      normalizedRows,
      stagedRows.map((row) => row.row_fingerprint),
      config,
    );
  }
  const now = nowIso();
  if (classified) {
    for (const group of chunks(stagedRows.map((row, index) => ({ row, index })), 75)) {
      await database.batch(group.map(({ row, index }) => database.prepare(`
        UPDATE crm_import_rows SET normalized_json=?,classification=?,matched_person_id=?,
          match_detail_json=?,validation_errors_json=?,warnings_json=?,decision=?,
          target_person_id=NULL,apply_state='pending',error='',updated_at=?
        WHERE id=? AND import_batch_id=?
      `).bind(
        JSON.stringify(normalizedRows[index]),
        classified[index].classification,
        classified[index].matchedPersonId,
        JSON.stringify(classified[index].matchDetail),
        JSON.stringify(normalizedRows[index].errors),
        JSON.stringify(normalizedRows[index].warnings),
        classified[index].decision,
        now,
        row.id,
        importId,
      )));
    }
  }
  for (const decision of Array.isArray(body.rowDecisions) ? body.rowDecisions : []) {
    const rowId = asString(decision.id || decision.rowId, 120);
    const choice = asString(decision.decision, 20);
    if (!rowId || !IMPORT_DECISIONS.has(choice)) continue;
    const currentRow = await database.prepare(`
      SELECT classification FROM crm_import_rows WHERE id=? AND import_batch_id=?
    `).bind(rowId, importId).first();
    if (!currentRow) continue;
    if (
      ["invalid", "duplicate_in_file", "already_imported"].includes(currentRow.classification)
      && !["skip", "review"].includes(choice)
    ) {
      return failure("Invalid, duplicate, and already-imported rows must be skipped or remapped.", 409);
    }
    let targetPersonId = asNullableString(decision.targetPersonId || decision.personId, 120);
    if (choice === "link") {
      targetPersonId = await canonicalPersonId(database, targetPersonId);
      if (!targetPersonId) return failure(`A selected person for row ${rowId} no longer exists.`, 409);
    } else if (choice !== "link") {
      targetPersonId = null;
    }
    await database.prepare(`
      UPDATE crm_import_rows SET decision=?,target_person_id=?,updated_at=?
      WHERE id=? AND import_batch_id=?
    `).bind(choice, targetPersonId, now, rowId, importId).run();
  }
  const summaryRows = await database.prepare(`
    SELECT classification,decision,COUNT(*) count FROM crm_import_rows
    WHERE import_batch_id=? GROUP BY classification,decision
  `).bind(importId).all();
  const summary = {
    total: Number(batch.row_count || 0),
    newPerson: 0,
    exactMatch: 0,
    possibleMatch: 0,
    duplicateInFile: 0,
    alreadyImported: 0,
    moneyConflict: 0,
    invalid: 0,
    reviewRequired: 0,
  };
  const summaryKeys = {
    new_person: "newPerson",
    exact_match: "exactMatch",
    possible_match: "possibleMatch",
    duplicate_in_file: "duplicateInFile",
    already_imported: "alreadyImported",
    money_conflict: "moneyConflict",
    invalid: "invalid",
  };
  for (const row of summaryRows.results || []) {
    summary[summaryKeys[row.classification]] += Number(row.count || 0);
    if (row.decision === "review") summary.reviewRequired += Number(row.count || 0);
  }
  await database.prepare(`
    UPDATE crm_import_batches SET source_label=?,source_period_start=?,source_period_end=?,
      default_interaction_type=?,default_node_id=?,date_format=?,currency=?,money_mode=?,
      newsletter_export=?,newsletter_provider=?,mapping_json=?,config_json=?,
      status='configured',summary_json=?,updated_at=?
    WHERE id=?
  `).bind(
    config.sourceLabel,
    config.sourcePeriodStart,
    config.sourcePeriodEnd,
    config.defaultInteractionType,
    config.defaultNodeId,
    config.dateFormat,
    config.currency,
    config.moneyMode,
    config.newsletterExport ? 1 : 0,
    config.newsletterProvider || null,
    JSON.stringify(mapping),
    JSON.stringify(config),
    JSON.stringify(summary),
    now,
    importId,
  ).run();
  const updated = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  return json({ importBatch: importBatchView(updated), summary });
}

async function createOrResolveImportPerson(database, batch, row, normalized) {
  if (row.decision === "link") {
    const requested = row.target_person_id || row.matched_person_id;
    return { personId: await canonicalPersonId(database, requested), created: false };
  }
  if (row.decision !== "create") return { personId: null, created: false };
  const reservedPersonId = await reservationPersonId(
    database,
    "crm_import_row_claim",
    row.row_fingerprint,
  );
  if (reservedPersonId) {
    return { personId: reservedPersonId, created: false, concurrentClaim: true };
  }
  if (normalized.email) {
    const exact = await uniqueEmailMatch(database, normalized.email);
    if (exact.personId) return { personId: exact.personId, created: false };
    if (exact.ambiguous || exact.count) {
      throw new Error("Email became ambiguous after review.");
    }
  }
  const personId = id("crm-person");
  const now = nowIso();
  const personInsert = database.prepare(`
    INSERT INTO crm_people(
      id,display_name,preferred_name,organization,pronouns,instagram,
      relationship_status,preferred_contact_method,referral_source,import_batch_id,
      eligibility_at,eligibility_reason,eligibility_source_provider,
      eligibility_source_type,eligibility_source_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?)
  `).bind(
    personId,
    normalized.name || normalized.email || normalized.phoneDisplay || `@${normalized.instagram}` || "Legacy contact",
    normalized.preferredName || "",
    normalized.organization || "",
    normalized.pronouns || "",
    normalized.instagram || "",
    normalized.email ? "email" : normalized.phone ? "phone" : normalized.instagram ? "instagram" : "",
    normalized.referralSource || "",
    batch.id,
    now,
    "studio_csv_import",
    "legacy_import",
    "legacy_row",
    row.row_fingerprint,
    now,
    now,
  );
  const claim = emailClaimStatement(database, personId, normalized.email, now, {
    importBatchId: batch.id,
  });
  const rowClaim = reservationStatement(
    database,
    personId,
    "crm_import_row_claim",
    row.row_fingerprint,
    now,
    { importBatchId: batch.id },
  );
  const initialEmail = identityStatement(database, personId, "email", normalized.email, {
    primary: true,
    provider: "legacy_import",
    sourceProvider: "legacy_import",
    sourceType: "legacy_row_identity",
    sourceId: `${row.row_fingerprint}:email`,
    importBatchId: batch.id,
    now,
  });
  try {
    await database.batch([
      personInsert,
      ...(rowClaim ? [rowClaim] : []),
      ...(claim ? [claim] : []),
      ...(initialEmail ? [initialEmail] : []),
    ]);
  } catch (error) {
    if (/UNIQUE constraint/i.test(error.message || "")) {
      const rowClaimPersonId = await reservationPersonId(
        database,
        "crm_import_row_claim",
        row.row_fingerprint,
      );
      if (rowClaimPersonId) {
        return { personId: rowClaimPersonId, created: false, concurrentClaim: true };
      }
      const claimedPersonId = await emailClaimPersonId(database, normalized.email);
      if (claimedPersonId) {
        return { personId: claimedPersonId, created: false, concurrentClaim: true };
      }
    }
    throw error;
  }
  return { personId, created: true };
}

async function applyImportRow(database, batch, row) {
  const normalized = parseJson(row.normalized_json, {});
  const config = normalizedImportConfig(parseJson(batch.config_json, {}));
  const resolved = await createOrResolveImportPerson(database, batch, row, normalized);
  if (!resolved.personId) throw new Error("No person was selected for this row.");
  const person = await database.prepare("SELECT * FROM crm_people WHERE id=?").bind(resolved.personId).first();
  if (!person) throw new Error("The selected person no longer exists.");
  const now = nowIso();
  const occurredAt = normalized.occurredAt || batch.source_period_end
    || batch.source_period_start || batch.created_at;
  const statements = [
    database.prepare(`
      UPDATE crm_people SET
        organization=CASE WHEN organization='' THEN ? ELSE organization END,
        pronouns=CASE WHEN pronouns='' THEN ? ELSE pronouns END,
        instagram=CASE WHEN instagram='' THEN ? ELSE instagram END,
        preferred_name=CASE WHEN preferred_name='' THEN ? ELSE preferred_name END,
        referral_source=CASE WHEN referral_source='' THEN ? ELSE referral_source END,
        updated_at=?
      WHERE id=?
    `).bind(
      normalized.organization || "",
      normalized.pronouns || "",
      normalized.instagram || "",
      normalized.preferredName || "",
      normalized.referralSource || "",
      now,
      resolved.personId,
    ),
  ];
  for (const [kind, value] of [
    ["email", normalized.email],
    ["phone", normalized.phoneDisplay || normalized.phone],
    ["instagram", normalized.instagram],
  ]) {
    const statement = identityStatement(database, resolved.personId, kind, value, {
      primary: resolved.created,
      provider: "legacy_import",
      sourceProvider: "legacy_import",
      sourceType: "legacy_row_identity",
      sourceId: `${row.row_fingerprint}:${kind}`,
      importBatchId: batch.id,
      now,
    });
    if (statement) {
      statements.push(statement);
      statements.push(ensurePrimaryIdentityStatement(
        database,
        resolved.personId,
        kind,
        now,
      ));
    }
  }
  statements.push(database.prepare(`
    INSERT OR IGNORE INTO crm_interactions(
      id,person_id,node_id,channel,interaction_type,label,status,quantity,occurred_at,
      source_provider,source_type,source_id,metadata_json,import_batch_id,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'legacy_import','legacy_row',?,?,?,1,?,?)
  `).bind(
    id("crm-interaction"),
    resolved.personId,
    normalized.nodeId || batch.default_node_id,
    "legacy_list",
    normalized.interactionType || batch.default_interaction_type || "legacy_contact",
    batch.source_label,
    "recorded",
    1,
    occurredAt,
    row.row_fingerprint,
    JSON.stringify({
      importBatchId: batch.id,
      rowNumber: row.row_number,
      approximateDate: Boolean(normalized.approximateDate),
      paymentReference: normalized.paymentReference || "",
    }),
    batch.id,
    now,
    now,
  ));

  const canCountTransaction = normalized.amountCents !== null
    && (config.moneyMode === "transaction"
      || (config.moneyMode === "aggregate" && config.aggregateConfirmed));
  if (canCountTransaction) {
    const amount = Number(normalized.amountCents || 0);
    const transactionType = amount < 0 ? "refund" : "charge";
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO crm_transactions(
        id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,currency,
        occurred_at,source_provider,source_type,source_id,note,metadata_json,
        import_batch_id,active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'legacy_import',?,?,?,?,?,1,?,?)
    `).bind(
      id("crm-transaction"),
      resolved.personId,
      normalized.nodeId || batch.default_node_id,
      transactionType,
      "settled",
      Math.abs(amount),
      Math.max(0, Number(normalized.tipCents || 0)),
      normalizeCurrency(normalized.currency || batch.currency),
      occurredAt,
      config.moneyMode === "aggregate" ? "legacy_aggregate_confirmed" : "legacy_payment",
      `${row.row_fingerprint}:money`,
      normalized.paymentReference || batch.source_label,
      JSON.stringify({ importBatchId: batch.id, rowNumber: row.row_number }),
      batch.id,
      now,
      now,
    ));
  }
  if (normalized.notes) {
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO crm_notes(
        id,person_id,category,body,pinned,source_label,source_provider,source_type,
        source_id,import_batch_id,created_at,updated_at
      ) VALUES(?,?, 'legacy',?,0,?,'legacy_import','legacy_row_note',?,?,?,?)
    `).bind(
      id("crm-note"),
      resolved.personId,
      normalized.notes,
      batch.source_label,
      `${row.row_fingerprint}:note`,
      batch.id,
      now,
      now,
    ));
  }
  statements.push(...tagStatements(database, resolved.personId, normalized.tags, {
    source: "legacy_import",
    importBatchId: batch.id,
    now,
  }));
  if (config.confirmImportedTiers && normalized.tier && !person.tier) {
    const rationale = `Imported from ${batch.source_label || batch.filename} after explicit confirmation.`;
    statements.push(database.prepare(`
      UPDATE crm_people SET tier=?,tier_rationale=?,tier_reviewed_at=?,updated_at=?
      WHERE id=? AND tier IS NULL
    `).bind(normalized.tier, rationale, now, now, resolved.personId));
    statements.push(database.prepare(`
      INSERT INTO crm_tier_history(
        id,person_id,previous_tier,new_tier,rationale,actor,import_batch_id,created_at
      ) VALUES(?,?,NULL,?,?,'studio',?,?)
    `).bind(id("crm-tier"), resolved.personId, normalized.tier, rationale, batch.id, now));
  }
  if (config.newsletterExport && normalized.email && config.newsletterProvider) {
    let subscriptionStatus = normalized.consent !== "unknown"
      ? normalized.consent
      : config.subscriptionStatus;
    const suppressed = await database.prepare(`
      SELECT id FROM crm_suppressions WHERE identity_kind='email' AND normalized_value=? AND active=1
    `).bind(normalized.email).first();
    if (suppressed) subscriptionStatus = "unsubscribed";
    const existingSubscription = await database.prepare(`
      SELECT * FROM crm_marketing_subscriptions
      WHERE person_id=? AND provider=? AND publication_id='' AND active=1
    `).bind(resolved.personId, config.newsletterProvider).first();
    if (existingSubscription) {
      const finalStatus = existingSubscription.status === "unsubscribed"
        ? "unsubscribed"
        : subscriptionStatus;
      statements.push(database.prepare(`
        UPDATE crm_marketing_subscriptions SET email=?,status=?,
          unsubscribed_at=CASE WHEN ?='unsubscribed' THEN COALESCE(unsubscribed_at,?) ELSE unsubscribed_at END,
          consent_source=?,updated_at=? WHERE id=?
      `).bind(
        normalized.email,
        finalStatus,
        finalStatus,
        now,
        batch.source_label,
        now,
        existingSubscription.id,
      ));
    } else {
      statements.push(database.prepare(`
        INSERT INTO crm_marketing_subscriptions(
          id,person_id,provider,publication_id,external_id,email,status,tier,
          consent_source,subscribed_at,unsubscribed_at,last_synced_at,
          metadata_json,import_batch_id,active,created_at,updated_at
        ) VALUES(?,?,?,'',?,?,?,'',?,?,?,?,?,?,1,?,?)
      `).bind(
        id("crm-subscription"),
        resolved.personId,
        config.newsletterProvider,
        normalized.providerId || null,
        normalized.email,
        subscriptionStatus,
        batch.source_label,
        subscriptionStatus === "subscribed" ? occurredAt : null,
        subscriptionStatus === "unsubscribed" ? occurredAt : null,
        now,
        JSON.stringify({ importBatchId: batch.id, rowNumber: row.row_number }),
        batch.id,
        now,
        now,
      ));
    }
    if (subscriptionStatus === "unsubscribed") {
      statements.push(database.prepare(`
        INSERT INTO crm_suppressions(
          id,person_id,identity_kind,normalized_value,reason,provider,source_id,
          import_batch_id,active,created_at,updated_at
        ) VALUES(?,?,'email',?,?,?,?,?,1,?,?)
        ON CONFLICT(identity_kind,normalized_value) DO UPDATE SET
          active=1,person_id=COALESCE(crm_suppressions.person_id,excluded.person_id),
          reason=excluded.reason,provider=excluded.provider,updated_at=excluded.updated_at
      `).bind(
        id("crm-suppression"),
        resolved.personId,
        normalized.email,
        `Unsubscribed in ${batch.source_label || batch.filename}`,
        config.newsletterProvider,
        row.row_fingerprint,
        batch.id,
        now,
        now,
      ));
    }
  }
  statements.push(database.prepare(`
    UPDATE crm_import_rows SET apply_state='applied',applied_person_id=?,error='',
      applied_at=?,updated_at=? WHERE id=? AND import_batch_id=?
  `).bind(resolved.personId, now, now, row.id, batch.id));
  statements.push(auditStatement(database, {
    personId: resolved.personId,
    action: "import_row_applied",
    resourceType: "import_row",
    resourceId: row.id,
    after: {
      rowNumber: row.row_number,
      createdPerson: resolved.created,
      interactionType: normalized.interactionType,
      countedMoney: canCountTransaction,
    },
    importBatchId: batch.id,
  }));
  await database.batch(statements);
  return { personId: resolved.personId, created: resolved.created };
}

async function handleApplyImport(request, database, importId) {
  const parsed = await readObject(request);
  if (parsed.error) return parsed.error;
  let batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  if (!batch) return failure("Import not found.", 404);
  if (batch.status === "applied") {
    return json({ ok: true, idempotent: true, importBatch: importBatchView(batch) });
  }
  if (batch.status === "rolled_back") return failure("Rolled-back imports cannot be applied again.", 409);
  if (!asString(batch.source_label)) return failure("Describe the source before applying this import.", 409);
  if (
    hasOwn(parsed.body, "confirmTierProposals")
    || hasOwn(parsed.body, "confirmImportedTiers")
    || hasOwn(parsed.body, "confirmAggregateSpend")
    || hasOwn(parsed.body, "aggregateConfirmed")
    || hasOwn(parsed.body, "completeSubscriberExport")
  ) {
    const config = normalizedImportConfig({
      ...parseJson(batch.config_json, {}),
      ...(hasOwn(parsed.body, "confirmTierProposals")
        ? { confirmImportedTiers: parsed.body.confirmTierProposals }
        : {}),
      ...(hasOwn(parsed.body, "confirmImportedTiers")
        ? { confirmImportedTiers: parsed.body.confirmImportedTiers }
        : {}),
      ...(hasOwn(parsed.body, "confirmAggregateSpend")
        ? { aggregateConfirmed: parsed.body.confirmAggregateSpend }
        : {}),
      ...(hasOwn(parsed.body, "aggregateConfirmed")
        ? { aggregateConfirmed: parsed.body.aggregateConfirmed }
        : {}),
      ...(hasOwn(parsed.body, "completeSubscriberExport")
        ? { completeSubscriberExport: parsed.body.completeSubscriberExport }
        : {}),
    });
    await database.prepare(`
      UPDATE crm_import_batches SET config_json=?,updated_at=? WHERE id=?
    `).bind(JSON.stringify(config), nowIso(), importId).run();
    batch = { ...batch, config_json: JSON.stringify(config) };
  }
  const unresolved = await database.prepare(`
    SELECT COUNT(*) count FROM crm_import_rows
    WHERE import_batch_id=? AND apply_state='pending' AND decision='review'
  `).bind(importId).first();
  if (Number(unresolved?.count || 0) > 0) {
    return failure("Resolve all possible matches and money conflicts before applying.", 409, {
      code: "IMPORT_REVIEW_REQUIRED",
      unresolved: Number(unresolved.count),
    });
  }
  const limit = clampInteger(parsed.body.limit, 1, IMPORT_APPLY_LIMIT, 100);
  const now = nowIso();
  await database.prepare(`
    UPDATE crm_import_batches SET status='applying',error='',updated_at=? WHERE id=?
  `).bind(now, importId).run();
  await database.prepare(`
    UPDATE crm_import_rows SET apply_state='skipped',updated_at=?
    WHERE import_batch_id=? AND apply_state='pending' AND decision='skip'
  `).bind(now, importId).run();
  const pending = await database.prepare(`
    SELECT * FROM crm_import_rows
    WHERE import_batch_id=? AND apply_state IN ('pending','error')
      AND decision IN ('create','link')
    ORDER BY row_number LIMIT ?
  `).bind(importId, limit).all();
  let applied = 0;
  let failed = 0;
  const createdPersonIds = [];
  for (const row of pending.results || []) {
    try {
      const result = await applyImportRow(database, batch, row);
      applied += 1;
      if (result.created) createdPersonIds.push(result.personId);
    } catch (error) {
      failed += 1;
      await database.prepare(`
        UPDATE crm_import_rows SET apply_state='error',error=?,updated_at=?
        WHERE id=? AND import_batch_id=?
      `).bind(asString(error.message || "Unable to apply row.", 500), nowIso(), row.id, importId).run();
    }
  }
  const remaining = await database.prepare(`
    SELECT COUNT(*) count FROM crm_import_rows
    WHERE import_batch_id=? AND apply_state IN ('pending','error')
      AND decision IN ('create','link','review')
  `).bind(importId).first();
  const complete = Number(remaining?.count || 0) === 0;
  const status = complete ? "applied" : "applying";
  const finished = nowIso();
  const stateCounts = await database.prepare(`
    SELECT apply_state,COUNT(*) count FROM crm_import_rows
    WHERE import_batch_id=? GROUP BY apply_state
  `).bind(importId).all();
  const summary = {
    ...parseJson(batch.summary_json, {}),
    applyStates: Object.fromEntries((stateCounts.results || []).map((row) => [row.apply_state, Number(row.count)])),
  };
  const completedConfig = normalizedImportConfig(parseJson(batch.config_json, {}));
  if (
    complete
    && completedConfig.newsletterExport
    && completedConfig.completeSubscriberExport
    && completedConfig.newsletterProvider
  ) {
    await database.prepare(`
      UPDATE crm_marketing_subscriptions
      SET status='unsubscribed',active=0,unsubscribed_at=COALESCE(unsubscribed_at,?),
        updated_at=?
      WHERE provider=? AND publication_id='' AND active=1
        AND email NOT IN (
          SELECT json_extract(normalized_json,'$.email')
          FROM crm_import_rows
          WHERE import_batch_id=?
            AND COALESCE(json_extract(normalized_json,'$.email'),'')!=''
        )
    `).bind(
      finished,
      finished,
      completedConfig.newsletterProvider,
      importId,
    ).run();
  }
  await database.prepare(`
    UPDATE crm_import_batches SET status=?,summary_json=?,applied_at=CASE WHEN ?='applied' THEN ? ELSE applied_at END,
      staging_expires_at=CASE WHEN ?='applied' THEN ? ELSE staging_expires_at END,
      error=?,updated_at=? WHERE id=?
  `).bind(
    status,
    JSON.stringify(summary),
    status,
    finished,
    status,
    new Date(Date.now() + STAGING_RETENTION_DAYS * 86400000).toISOString(),
    failed ? `${failed} row(s) need attention.` : "",
    finished,
    importId,
  ).run();
  const updated = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  return json({
    ok: complete,
    importBatch: importBatchView(updated),
    applied,
    failed,
    remaining: Number(remaining?.count || 0),
    createdPersonIds,
  }, { status: failed ? 207 : 200 });
}

async function handleRollbackImport(database, importId) {
  const batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  if (!batch) return failure("Import not found.", 404);
  if (batch.status === "rolled_back") {
    return json({ ok: true, idempotent: true, importBatch: importBatchView(batch) });
  }
  if (!["applying", "applied", "failed"].includes(batch.status)) {
    return failure("Only applied imports can be rolled back.", 409);
  }
  const now = nowIso();
  const statements = [
    database.prepare("UPDATE crm_interactions SET active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare("UPDATE crm_transactions SET status='void',active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare("UPDATE crm_notes SET archived_at=?,updated_at=? WHERE import_batch_id=? AND archived_at IS NULL").bind(now, now, importId),
    database.prepare("UPDATE crm_followups SET status='cancelled',updated_at=? WHERE import_batch_id=? AND status='open'").bind(now, importId),
    database.prepare("UPDATE crm_attendance SET active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare("UPDATE crm_marketing_subscriptions SET active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare("UPDATE crm_suppressions SET active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare("UPDATE crm_identities SET active=0,updated_at=? WHERE import_batch_id=?").bind(now, importId),
    database.prepare(`
      DELETE FROM crm_identities
      WHERE provider='crm_email_claim'
        AND person_id IN (SELECT id FROM crm_people WHERE import_batch_id=?)
        AND NOT EXISTS (
          SELECT 1
          FROM crm_identities email_identity
          JOIN crm_people email_person ON email_person.id=email_identity.person_id
          JOIN crm_people claim_person ON claim_person.id=crm_identities.person_id
          WHERE email_identity.kind='email'
            AND email_identity.active=1
            AND email_identity.normalized_value=crm_identities.external_id
            AND COALESCE(email_person.merged_into_id,email_person.id)
              =COALESCE(claim_person.merged_into_id,claim_person.id)
        )
    `).bind(importId),
    database.prepare(`
      DELETE FROM crm_identities
      WHERE provider='crm_import_row_claim' AND import_batch_id=?
    `).bind(importId),
    database.prepare("DELETE FROM crm_person_tags WHERE import_batch_id=?").bind(importId),
    database.prepare(`
      UPDATE crm_people SET tier=NULL,tier_rationale='',tier_reviewed_at=NULL,updated_at=?
      WHERE id IN (
        SELECT h.person_id FROM crm_tier_history h WHERE h.import_batch_id=?
      ) AND NOT EXISTS (
        SELECT 1 FROM crm_tier_history later
        WHERE later.person_id=crm_people.id
          AND later.import_batch_id IS NULL
          AND later.created_at>(
            SELECT MIN(imported.created_at) FROM crm_tier_history imported
            WHERE imported.person_id=crm_people.id AND imported.import_batch_id=?
          )
      )
    `).bind(now, importId, importId),
    database.prepare(`
      UPDATE crm_people SET relationship_status='archived',archived_at=?,updated_at=?
      WHERE import_batch_id=? AND NOT EXISTS(
        SELECT 1 FROM crm_interactions x WHERE x.person_id=crm_people.id AND x.active=1
      ) AND NOT EXISTS(
        SELECT 1 FROM crm_transactions t WHERE t.person_id=crm_people.id AND t.active=1
      ) AND NOT EXISTS(
        SELECT 1 FROM crm_identities i WHERE i.person_id=crm_people.id AND i.active=1
      )
    `).bind(now, now, importId),
    database.prepare(`
      UPDATE crm_import_rows SET apply_state=CASE WHEN apply_state='applied' THEN 'rolled_back' ELSE apply_state END,
        rolled_back_at=CASE WHEN apply_state='applied' THEN ? ELSE rolled_back_at END,updated_at=?
      WHERE import_batch_id=?
    `).bind(now, now, importId),
    database.prepare(`
      UPDATE crm_import_batches SET status='rolled_back',rolled_back_at=?,updated_at=? WHERE id=?
    `).bind(now, now, importId),
    auditStatement(database, {
      action: "import_rolled_back",
      resourceType: "import_batch",
      resourceId: importId,
      after: { rolledBackAt: now },
      importBatchId: importId,
    }),
  ];
  await database.batch(statements);
  const updated = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  return json({ ok: true, importBatch: importBatchView(updated) });
}

function safeCsvCell(value) {
  let string = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  if (/^[=+\-@\t\r]/.test(string)) string = `'${string}`;
  return `"${string.replace(/"/g, '""')}"`;
}

async function handleImportExceptions(database, importId) {
  const batch = await database.prepare("SELECT * FROM crm_import_batches WHERE id=?").bind(importId).first();
  if (!batch) return failure("Import not found.", 404);
  const result = await database.prepare(`
    SELECT * FROM crm_import_rows
    WHERE import_batch_id=? AND (
      classification IN ('possible_match','money_conflict','invalid')
      OR apply_state='error'
    ) ORDER BY row_number
  `).bind(importId).all();
  const lines = [[
    "row_number", "classification", "decision", "apply_state", "matched_person_id",
    "validation_errors", "warnings", "error",
  ].map(safeCsvCell).join(",")];
  for (const row of result.results || []) {
    lines.push([
      row.row_number,
      row.classification,
      row.decision,
      row.apply_state,
      row.matched_person_id || "",
      parseJson(row.validation_errors_json, []),
      parseJson(row.warnings_json, []),
      row.error || "",
    ].map(safeCsvCell).join(","));
  }
  const filename = `${asString(batch.filename, 180).replace(/\.(csv|tsv)$/i, "") || "import"}-exceptions.csv`;
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/["\r\n]/g, "")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function nodeForSubmissionType(type) {
  if (["tattoo_inquiry", "flash_claim", "special_project", "build_brief", "maze_design"].includes(type)) {
    return "node-tattoos";
  }
  if (type === "art_acquisition") return "node-art";
  if (/event|rsvp|waitlist|open_mic/.test(type)) return "node-events";
  if (/merch|shop|order/.test(type)) return "node-merch";
  return null;
}

async function findOrCreateLocalPerson(database, {
  sourceType,
  sourceId,
  name,
  email,
  phone,
  instagram = "",
  organization = "",
  pronouns = "",
  occurredAt,
  eligibilityReason,
}) {
  const existing = await database.prepare(`
    SELECT person_id FROM crm_interactions
    WHERE source_provider='local' AND source_type=? AND source_id=? LIMIT 1
  `).bind(sourceType, sourceId).first();
  if (existing?.person_id) {
    return { personId: await canonicalPersonId(database, existing.person_id), created: false };
  }
  const sourceClaimKey = `${asString(sourceType, 120)}:${asString(sourceId, 300)}`;
  let personId = await reservationPersonId(database, "crm_local_source_claim", sourceClaimKey);
  if (!personId && email) {
    const match = await uniqueEmailMatch(database, email);
    if (match.personId) personId = match.personId;
    if (!match.personId && (match.ambiguous || match.count)) {
      return { personId: null, created: false, ambiguous: true };
    }
  }
  let created = false;
  const now = nowIso();
  if (!personId) {
    personId = id("crm-person");
    const personInsert = database.prepare(`
      INSERT INTO crm_people(
        id,display_name,organization,pronouns,instagram,relationship_status,
        preferred_contact_method,eligibility_at,eligibility_reason,
        eligibility_source_provider,eligibility_source_type,
        eligibility_source_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,'active',?,?,?,?,?,?,?,?)
    `).bind(
      personId,
      asString(name, 200) || normalizeEmail(email) || asString(phone, 80) || "Construct contact",
      asString(organization, 200),
      asString(pronouns, 100),
      normalizeInstagram(instagram),
      email ? "email" : phone ? "phone" : instagram ? "instagram" : "",
      occurredAt || now,
      eligibilityReason,
      "local",
      sourceType,
      sourceId,
      occurredAt || now,
      now,
    );
    const claim = emailClaimStatement(database, personId, email, now);
    const sourceClaim = reservationStatement(
      database,
      personId,
      "crm_local_source_claim",
      sourceClaimKey,
      now,
    );
    const initialEmail = identityStatement(database, personId, "email", email, {
      primary: true,
      provider: "local",
      sourceProvider: "local",
      sourceType,
      sourceId: `${sourceType}:${sourceId}:email`,
      now,
    });
    try {
      await database.batch([
        personInsert,
        ...(sourceClaim ? [sourceClaim] : []),
        ...(claim ? [claim] : []),
        ...(initialEmail ? [initialEmail] : []),
      ]);
      created = true;
    } catch (error) {
      if (/UNIQUE constraint/i.test(error.message || "")) {
        const sourceClaimPersonId = await reservationPersonId(
          database,
          "crm_local_source_claim",
          sourceClaimKey,
        );
        const claimedPersonId = await emailClaimPersonId(database, email);
        if (sourceClaimPersonId && claimedPersonId && sourceClaimPersonId !== claimedPersonId) {
          return { personId: null, created: false, ambiguous: true };
        }
        if (sourceClaimPersonId || claimedPersonId) {
          personId = sourceClaimPersonId || claimedPersonId;
          created = false;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
  await database.prepare(`
    UPDATE crm_people
    SET eligibility_at=COALESCE(eligibility_at,?),
        eligibility_reason=CASE WHEN eligibility_at IS NULL THEN ? ELSE eligibility_reason END,
        eligibility_source_provider=CASE WHEN eligibility_at IS NULL THEN 'local' ELSE eligibility_source_provider END,
        eligibility_source_type=CASE WHEN eligibility_at IS NULL THEN ? ELSE eligibility_source_type END,
        eligibility_source_id=CASE WHEN eligibility_at IS NULL THEN ? ELSE eligibility_source_id END,
        updated_at=?
    WHERE id=?
  `).bind(
    occurredAt || now,
    eligibilityReason,
    sourceType,
    sourceId,
    now,
    personId,
  ).run();
  const statements = [];
  const sourceReservation = reservationStatement(
    database,
    personId,
    "crm_local_source_claim",
    sourceClaimKey,
    now,
    { ignoreConflict: true },
  );
  if (sourceReservation) statements.push(sourceReservation);
  for (const [kind, value] of [
    ["email", email],
    ["phone", phone],
    ["instagram", instagram],
  ]) {
    const identity = identityStatement(database, personId, kind, value, {
      primary: created,
      provider: "local",
      sourceProvider: "local",
      sourceType,
      sourceId: `${sourceType}:${sourceId}:${kind}`,
      now,
    });
    if (identity) {
      statements.push(identity);
      statements.push(ensurePrimaryIdentityStatement(database, personId, kind, now));
    }
  }
  const sourceIdentity = identityStatement(database, personId, "other", `${sourceType}:${sourceId}`, {
    provider: "local",
    externalId: `${sourceType}:${sourceId}`,
    sourceProvider: "local",
    sourceType,
    sourceId: `${sourceType}:${sourceId}:external`,
    now,
  });
  if (sourceIdentity) statements.push(sourceIdentity);
  if (statements.length) await database.batch(statements);
  return { personId, created };
}

async function insertLocalInteraction(database, personId, {
  sourceType,
  sourceId,
  nodeId,
  interactionType,
  label = "",
  status = "",
  quantity = 1,
  occurredAt,
  metadata = {},
}) {
  const now = nowIso();
  const normalizedQuantity = Math.max(1, Number(quantity || 1));
  const normalizedOccurredAt = occurredAt || now;
  const metadataJson = JSON.stringify(metadata);
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO crm_interactions(
        id,person_id,node_id,channel,interaction_type,label,status,quantity,occurred_at,
        source_provider,source_type,source_id,metadata_json,active,created_at,updated_at
      ) VALUES(?,?,?,'local',?,?,?,?,?,'local',?,?,?,1,?,?)
    `).bind(
      id("crm-interaction"),
      personId,
      nodeId,
      interactionType,
      label,
      status,
      normalizedQuantity,
      normalizedOccurredAt,
      sourceType,
      sourceId,
      metadataJson,
      now,
      now,
    ),
    database.prepare(`
      UPDATE crm_interactions
      SET person_id=COALESCE(person_id,?),node_id=COALESCE(?,node_id),
          channel='local',interaction_type=?,label=?,status=?,quantity=?,
          occurred_at=?,metadata_json=?,active=1,updated_at=?
      WHERE source_provider='local' AND source_type=? AND source_id=?
    `).bind(
      personId,
      nodeId,
      interactionType,
      label,
      status,
      normalizedQuantity,
      normalizedOccurredAt,
      metadataJson,
      now,
      sourceType,
      sourceId,
    ),
  ]);
}

async function insertLocalTransaction(database, personId, {
  sourceType,
  sourceId,
  nodeId,
  transactionType = "charge",
  status,
  amountCents,
  tipCents = 0,
  currency = "USD",
  occurredAt,
  externalOrderId = null,
  metadata = {},
}) {
  const now = nowIso();
  const normalizedAmountCents = Math.max(0, Number(amountCents || 0));
  const normalizedTipCents = Math.max(0, Number(tipCents || 0));
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedOccurredAt = occurredAt || now;
  const metadataJson = JSON.stringify(metadata);
  const providerPaymentId = text(metadata?.providerPaymentId, 300);
  const providerRefundId = text(metadata?.providerRefundId, 300);
  let providerOverlap = null;
  if (transactionType === "refund" && providerRefundId) {
    providerOverlap = await database.prepare(`
      SELECT id FROM crm_transactions
      WHERE source_provider='square' AND source_type='refund' AND source_id=?
        AND active=1
      LIMIT 1
    `).bind(providerRefundId).first();
  } else if (transactionType !== "refund" && providerPaymentId) {
    providerOverlap = await database.prepare(`
      SELECT id FROM crm_transactions
      WHERE source_provider='square' AND source_type='payment' AND source_id=?
        AND active=1
      LIMIT 1
    `).bind(providerPaymentId).first();
  }
  if (!providerOverlap && transactionType !== "refund" && externalOrderId) {
    providerOverlap = await database.prepare(`
      SELECT id FROM crm_transactions
      WHERE source_provider='square' AND transaction_type='charge'
        AND external_order_id=? AND amount_cents=? AND active=1
      LIMIT 1
    `).bind(externalOrderId, normalizedAmountCents).first();
  }
  if (providerOverlap) {
    await database.batch([
      database.prepare(`
        UPDATE crm_transactions
        SET person_id=COALESCE(person_id,?),updated_at=?
        WHERE id=?
      `).bind(personId, now, providerOverlap.id),
      database.prepare(`
        UPDATE crm_transactions
        SET active=0,updated_at=?
        WHERE source_provider='local' AND source_type=? AND source_id=?
      `).bind(now, sourceType, sourceId),
    ]);
    return;
  }
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO crm_transactions(
        id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,currency,
        occurred_at,source_provider,source_type,source_id,external_order_id,
        metadata_json,active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'local',?,?,?,?,1,?,?)
    `).bind(
      id("crm-transaction"),
      personId,
      nodeId,
      transactionType,
      status,
      normalizedAmountCents,
      normalizedTipCents,
      normalizedCurrency,
      normalizedOccurredAt,
      sourceType,
      sourceId,
      externalOrderId,
      metadataJson,
      now,
      now,
    ),
    database.prepare(`
      UPDATE crm_transactions
      SET person_id=COALESCE(person_id,?),node_id=COALESCE(?,node_id),
          transaction_type=?,status=?,amount_cents=?,tip_cents=?,currency=?,
          occurred_at=?,external_order_id=COALESCE(?,external_order_id),
          metadata_json=?,active=1,updated_at=?
      WHERE source_provider='local' AND source_type=? AND source_id=?
    `).bind(
      personId,
      nodeId,
      transactionType,
      status,
      normalizedAmountCents,
      normalizedTipCents,
      normalizedCurrency,
      normalizedOccurredAt,
      externalOrderId,
      metadataJson,
      now,
      sourceType,
      sourceId,
    ),
  ]);
}

async function localBackfillSources(database, limit, offsets) {
  const sourceQueries = {
    submissions: {
      sql: `SELECT * FROM submissions
        WHERE trim(contact_name)!='' AND trim(contact_email)!=''
          AND lower(trim(contact_name))!=lower(trim(contact_email))
        ORDER BY created_at,id LIMIT ? OFFSET ?`,
      count: `SELECT COUNT(*) count FROM submissions
        WHERE trim(contact_name)!='' AND trim(contact_email)!=''
          AND lower(trim(contact_name))!=lower(trim(contact_email))`,
    },
    appointments: {
      sql: "SELECT * FROM appointments ORDER BY created_at,id LIMIT ? OFFSET ?",
      count: "SELECT COUNT(*) count FROM appointments",
    },
    depositPayments: {
      sql: `SELECT d.*,a.client_name,a.client_email,a.client_phone,a.purpose,
          a.booking_type_id,a.submission_id
        FROM deposit_payments d JOIN appointments a ON a.id=d.appointment_id
        WHERE lower(d.status) IN ('paid','completed','settled','payment_attention')
        ORDER BY d.created_at,d.id LIMIT ? OFFSET ?`,
      count: `SELECT COUNT(*) count FROM deposit_payments
        WHERE lower(status) IN ('paid','completed','settled','payment_attention')`,
    },
    eventTickets: {
      sql: `SELECT t.*,e.title event_title,e.slug event_slug
        FROM event_tickets t JOIN events e ON e.id=t.event_id
        WHERE (
          trim(t.contact_name)!='' AND trim(t.contact_email)!=''
          AND lower(trim(t.contact_name))!=lower(trim(t.contact_email))
        ) OR t.status='paid' OR t.paid_at IS NOT NULL
          OR t.square_payment_id IS NOT NULL OR t.refund_id IS NOT NULL
        ORDER BY t.created_at,t.id LIMIT ? OFFSET ?`,
      count: `SELECT COUNT(*) count FROM event_tickets
        WHERE (
          trim(contact_name)!='' AND trim(contact_email)!=''
          AND lower(trim(contact_name))!=lower(trim(contact_email))
        ) OR status='paid' OR paid_at IS NOT NULL
          OR square_payment_id IS NOT NULL OR refund_id IS NOT NULL`,
    },
    eventWaitlist: {
      sql: `SELECT w.*,e.title event_title,e.slug event_slug
        FROM event_waitlist w JOIN events e ON e.id=w.event_id
        WHERE trim(w.contact_name)!='' AND trim(w.contact_email)!=''
          AND lower(trim(w.contact_name))!=lower(trim(w.contact_email))
        ORDER BY w.created_at,w.id LIMIT ? OFFSET ?`,
      count: `SELECT COUNT(*) count FROM event_waitlist
        WHERE trim(contact_name)!='' AND trim(contact_email)!=''
          AND lower(trim(contact_name))!=lower(trim(contact_email))`,
    },
    eventOpenMic: {
      sql: `SELECT o.*,e.title event_title,e.slug event_slug
        FROM event_open_mic_signups o JOIN events e ON e.id=o.event_id
        WHERE trim(o.performer_name)!='' AND trim(o.performer_email)!=''
          AND lower(trim(o.performer_name))!=lower(trim(o.performer_email))
        ORDER BY o.created_at,o.id LIMIT ? OFFSET ?`,
      count: `SELECT COUNT(*) count FROM event_open_mic_signups
        WHERE trim(performer_name)!='' AND trim(performer_email)!=''
          AND lower(trim(performer_name))!=lower(trim(performer_email))`,
    },
  };
  const data = {};
  const totals = {};
  for (const [key, source] of Object.entries(sourceQueries)) {
    const offset = clampInteger(offsets[key], 0, 1_000_000, 0);
    const [rows, count] = await Promise.all([
      database.prepare(source.sql).bind(limit, offset).all(),
      database.prepare(source.count).first(),
    ]);
    data[key] = rows.results || [];
    totals[key] = Number(count?.count || 0);
  }
  return { data, totals };
}

async function handleBackfill(request, database) {
  const body = await readJson(request).catch?.(() => null);
  const options = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const limit = clampInteger(options.limit, 1, MAX_BACKFILL_PAGE_SIZE, 250);
  const offsets = parseJsonObject(options.offsets);
  const dryRun = Boolean(options.dryRun);
  const { data, totals } = await localBackfillSources(database, limit, offsets);
  const processed = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  const nextOffsets = Object.fromEntries(Object.entries(data).map(([key, rows]) => [
    key,
    clampInteger(offsets[key], 0, 1_000_000, 0) + rows.length,
  ]));
  const hasMore = Object.keys(data).some((key) => nextOffsets[key] < totals[key]);
  if (dryRun) {
    return json({ ok: true, dryRun: true, processed, totals, nextOffsets, hasMore });
  }
  let createdPeople = 0;
  let unmatched = 0;
  const processPerson = async (identity) => {
    const resolved = await findOrCreateLocalPerson(database, identity);
    if (resolved.created) createdPeople += 1;
    if (!resolved.personId) unmatched += 1;
    return resolved.personId;
  };

  for (const row of data.submissions) {
    const personId = await processPerson({
      sourceType: "submission",
      sourceId: row.id,
      name: row.contact_name,
      email: row.contact_email,
      phone: row.contact_phone,
      occurredAt: row.created_at,
      eligibilityReason: "website_booking",
    });
    await insertLocalInteraction(database, personId, {
      sourceType: "submission",
      sourceId: row.id,
      nodeId: nodeForSubmissionType(row.type),
      interactionType: row.type || "submission",
      label: row.subject || row.type || "Website submission",
      status: row.status || "new",
      occurredAt: row.created_at,
      metadata: { submissionId: row.id, sourcePath: row.source_path || "" },
    });
    const contact = parseJson(row.contact_json, {});
    const participants = Array.isArray(contact.participants) ? contact.participants : [];
    for (let index = 1; index < participants.length; index += 1) {
      const participant = participants[index] || {};
      if (!hasNameAndEmail(participant.name, participant.email)) continue;
      const participantSourceId = `${row.id}:${index + 1}`;
      const participantId = await processPerson({
        sourceType: "submission_participant",
        sourceId: participantSourceId,
        name: participant.name,
        email: participant.email,
        phone: participant.phone,
        occurredAt: row.created_at,
        eligibilityReason: "website_booking",
      });
      await insertLocalInteraction(database, participantId, {
        sourceType: "submission_participant",
        sourceId: participantSourceId,
        nodeId: nodeForSubmissionType(row.type),
        interactionType: "tattoo_special_participant",
        label: `${row.subject || "Tattoo Special"} participant`,
        status: row.status || "new",
        occurredAt: row.created_at,
        metadata: { submissionId: row.id, participantIndex: index },
      });
    }
  }

  for (const row of data.appointments) {
    const personId = await processPerson({
      sourceType: "appointment",
      sourceId: row.id,
      name: row.client_name,
      email: row.client_email,
      phone: row.client_phone,
      occurredAt: row.start_at || row.created_at,
      eligibilityReason: "website_booking",
    });
    await insertLocalInteraction(database, personId, {
      sourceType: "appointment",
      sourceId: row.id,
      nodeId: row.booking_type_id === "studio_visit"
        ? "node-art"
        : row.purpose === "studio"
          ? "node-events"
          : "node-tattoos",
      interactionType: "appointment",
      label: row.purpose || row.booking_type_id,
      status: row.status,
      occurredAt: row.start_at || row.created_at,
      metadata: { appointmentId: row.id, submissionId: row.submission_id || "" },
    });
  }
  for (const row of data.depositPayments) {
    const personId = await processPerson({
      sourceType: "deposit_payment",
      sourceId: row.id,
      name: row.client_name,
      email: row.client_email,
      phone: row.client_phone,
      occurredAt: row.updated_at || row.created_at,
      eligibilityReason: "settled_booking_payment",
    });
    const settled = ["paid", "completed", "settled", "payment_attention"].includes(
      String(row.status || "").toLowerCase()
    );
    await insertLocalTransaction(database, personId, {
      sourceType: "deposit_payment",
      sourceId: row.id,
      nodeId: row.booking_type_id === "studio_visit"
        ? "node-art"
        : row.purpose === "studio"
          ? "node-events"
          : "node-tattoos",
      status: settled
        ? "settled"
        : row.status === "failed"
          ? "failed"
          : ["cancelled", "void"].includes(String(row.status || "").toLowerCase())
            ? "void"
            : "pending",
      amountCents: row.amount_cents,
      tipCents: row.tip_cents,
      currency: row.currency,
      occurredAt: row.updated_at || row.created_at,
      externalOrderId: row.provider_order_id,
      metadata: { appointmentId: row.appointment_id, providerPaymentId: row.provider_payment_id || "" },
    });
  }
  for (const row of data.eventTickets) {
    const hasSettledPayment = row.status === "paid"
      || Boolean(row.paid_at)
      || Boolean(row.square_payment_id)
      || Boolean(row.refund_id);
    const personId = await processPerson({
      sourceType: "event_ticket",
      sourceId: row.id,
      name: row.contact_name,
      email: row.contact_email,
      phone: row.contact_phone,
      occurredAt: row.paid_at || row.created_at,
      eligibilityReason: hasSettledPayment ? "paid_event_ticket" : "website_booking",
    });
    await insertLocalInteraction(database, personId, {
      sourceType: "event_ticket",
      sourceId: row.id,
      nodeId: "node-events",
      interactionType: "event_ticket_purchase",
      label: row.event_title,
      status: row.status,
      quantity: row.seats,
      occurredAt: row.paid_at || row.created_at,
      metadata: { eventId: row.event_id, eventSlug: row.event_slug, purchaserNotAttendee: true },
    });
    await insertLocalTransaction(database, personId, {
      sourceType: "event_ticket_payment",
      sourceId: row.id,
      nodeId: "node-events",
      status: hasSettledPayment
        ? "settled"
        : row.status === "cancelled"
          ? "void"
          : "pending",
      amountCents: row.amount_cents,
      currency: row.currency,
      occurredAt: row.paid_at || row.created_at,
      externalOrderId: row.square_order_id,
      metadata: {
        eventId: row.event_id,
        ticketId: row.id,
        providerPaymentId: row.square_payment_id || "",
      },
    });
    const eventRefund = parseJson(row.raw_json, {}).eventRefund || {};
    if (row.refund_id) {
      const providerRefundStatus = String(eventRefund.status || "").toUpperCase();
      await insertLocalTransaction(database, personId, {
        sourceType: "event_ticket_refund",
        sourceId: row.refund_id,
        nodeId: "node-events",
        transactionType: "refund",
        status: providerRefundStatus === "COMPLETED"
          ? "settled"
          : ["FAILED", "REJECTED"].includes(providerRefundStatus)
            ? "failed"
            : "pending",
        amountCents: row.amount_cents,
        currency: row.currency,
        occurredAt: eventRefund.updatedAt || eventRefund.createdAt
          || row.cancelled_at || row.updated_at || row.paid_at || row.created_at,
        externalOrderId: row.square_order_id,
        metadata: {
          eventId: row.event_id,
          ticketId: row.id,
          providerPaymentId: row.square_payment_id || "",
          providerRefundId: row.refund_id,
      },
    });
  }
  for (const row of data.eventWaitlist) {
    const personId = await processPerson({
      sourceType: "event_waitlist",
      sourceId: row.id,
      name: row.contact_name,
      email: row.contact_email,
      phone: row.contact_phone,
      occurredAt: row.created_at,
      eligibilityReason: "website_booking",
    });
    await insertLocalInteraction(database, personId, {
      sourceType: "event_waitlist",
      sourceId: row.id,
      nodeId: "node-events",
      interactionType: "event_waitlist",
      label: row.event_title || "Event waitlist",
      status: row.status || "new",
      quantity: row.seats_requested,
      occurredAt: row.created_at,
      metadata: { eventId: row.event_id, eventSlug: row.event_slug || "" },
    });
  }
  for (const row of data.eventOpenMic) {
    const personId = await processPerson({
      sourceType: "event_open_mic",
      sourceId: row.id,
      name: row.performer_name,
      email: row.performer_email,
      phone: row.performer_phone,
      occurredAt: row.created_at,
      eligibilityReason: "website_booking",
    });
    await insertLocalInteraction(database, personId, {
      sourceType: "event_open_mic",
      sourceId: row.id,
      nodeId: "node-events",
      interactionType: "performance",
      label: row.piece_title || row.act_type || row.event_title || "Open mic signup",
      status: row.status || "requested",
      occurredAt: row.created_at,
      metadata: {
        eventId: row.event_id,
        eventSlug: row.event_slug || "",
        actType: row.act_type || "",
      },
    });
  }
  }
  const now = nowIso();
  await auditStatement(database, {
    action: "local_backfill_run",
    resourceType: "backfill",
    resourceId: `local:${now}`,
    after: { processed, createdPeople, unmatched, nextOffsets, hasMore },
  }).run();
  return json({
    ok: true,
    dryRun: false,
    processed,
    totals,
    createdPeople,
    unmatched,
    nextOffsets,
    hasMore,
  });
}

async function handleNeedsAttention(database) {
  const [
    duplicateResult,
    unmatchedInteractions,
    unmatchedTransactions,
    overdueFollowups,
    importRows,
    failedSyncs,
    spendingConflicts,
    consentConflicts,
  ] = await Promise.all([
    database.prepare(`
      SELECT i.kind,i.normalized_value,
        COUNT(DISTINCT COALESCE(p.merged_into_id,p.id)) person_count,
        GROUP_CONCAT(DISTINCT COALESCE(p.merged_into_id,p.id)) person_ids
      FROM crm_identities i JOIN crm_people p ON p.id=i.person_id
      WHERE i.kind IN ('email','phone','instagram')
        AND i.active=1 AND p.anonymized_at IS NULL
      GROUP BY i.kind,i.normalized_value
      HAVING COUNT(DISTINCT COALESCE(p.merged_into_id,p.id))>1
      ORDER BY person_count DESC LIMIT 100
    `).all(),
    database.prepare(`
      SELECT * FROM crm_interactions WHERE person_id IS NULL AND active=1
      ORDER BY occurred_at DESC LIMIT 100
    `).all(),
    database.prepare(`
      SELECT * FROM crm_transactions WHERE person_id IS NULL AND active=1
      ORDER BY occurred_at DESC LIMIT 100
    `).all(),
    database.prepare(`
      SELECT f.*,p.display_name FROM crm_followups f JOIN crm_people p ON p.id=f.person_id
      WHERE f.status='open' AND f.due_at<datetime('now')
      ORDER BY f.due_at LIMIT 100
    `).all(),
    database.prepare(`
      SELECT r.*,b.filename,b.source_label FROM crm_import_rows r
      JOIN crm_import_batches b ON b.id=r.import_batch_id
      WHERE (r.decision='review' OR r.apply_state='error')
      ORDER BY r.updated_at DESC LIMIT 100
    `).all(),
    database.prepare(`
      SELECT * FROM crm_sync_jobs WHERE status='failed'
      ORDER BY updated_at DESC LIMIT 50
    `).all(),
    database.prepare(`
      SELECT a.id first_transaction_id,b.id second_transaction_id,
        COALESCE(a.person_id,b.person_id) person_id,
        a.external_order_id,a.amount_cents,a.currency,
        a.source_provider first_provider,b.source_provider second_provider,
        a.occurred_at
      FROM crm_transactions a
      JOIN crm_transactions b ON a.id<b.id
        AND a.active=1 AND b.active=1
        AND a.status='settled' AND b.status='settled'
        AND a.transaction_type=b.transaction_type
        AND a.amount_cents=b.amount_cents
        AND a.currency=b.currency
        AND a.source_provider!=b.source_provider
        AND COALESCE(a.external_order_id,'')!=''
        AND a.external_order_id=b.external_order_id
      ORDER BY a.occurred_at DESC LIMIT 100
    `).all(),
    database.prepare(`
      SELECT DISTINCT p.id person_id,p.display_name,sp.normalized_value,
        sp.provider suppression_provider,s.provider subscription_provider,
        s.publication_id,s.updated_at
      FROM crm_people p
      JOIN crm_suppressions sp ON sp.person_id=p.id AND sp.active=1
      JOIN crm_marketing_subscriptions s ON s.person_id=p.id
        AND s.active=1 AND s.status='subscribed'
        AND s.email=sp.normalized_value
      ORDER BY s.updated_at DESC LIMIT 100
    `).all(),
  ]);
  const duplicates = (duplicateResult.results || []).map((row) => ({
    identityKind: row.kind,
    normalizedValue: row.normalized_value,
    normalizedEmail: row.kind === "email" ? row.normalized_value : null,
    personCount: Number(row.person_count),
    personIds: asString(row.person_ids, 5000).split(",").filter(Boolean),
  }));
  const imports = (importRows.results || []).map(importPreviewRow);
  const items = [
    ...duplicates.map((item) => ({
      type: "possible_duplicate",
      title: `Shared ${item.identityKind} needs review`,
      message: `This ${item.identityKind} is connected to ${item.personCount} people. Keep it shared or merge only after confirming they are the same person.`,
      ...item,
    })),
    ...(unmatchedInteractions.results || []).map((item) => ({ type: "unmatched_interaction", record: item })),
    ...(unmatchedTransactions.results || []).map((item) => ({ type: "unmatched_transaction", record: item })),
    ...(overdueFollowups.results || []).map((item) => ({ type: "overdue_followup", record: item })),
    ...imports.map((item) => ({ type: "import_review", record: item })),
    ...(failedSyncs.results || []).map((item) => ({ type: "failed_sync", record: item })),
    ...(spendingConflicts.results || []).map((item) => ({
      type: "money_conflict",
      personId: item.person_id,
      title: "Possible duplicate settled payment",
      message: `${item.first_provider} and ${item.second_provider} share the same order reference and amount.`,
      amountCents: item.amount_cents,
      currency: item.currency,
      occurredAt: item.occurred_at,
      record: item,
    })),
    ...(consentConflicts.results || []).map((item) => ({
      type: "consent_conflict",
      personId: item.person_id,
      title: "Suppression overrides subscribed status",
      message: `${item.suppression_provider || "Suppression"} opt-out overrides ${item.subscription_provider || "newsletter"} subscribed status.`,
      record: item,
    })),
  ];
  return json({
    summary: {
      duplicates: duplicates.length,
      unmatchedInteractions: (unmatchedInteractions.results || []).length,
      unmatchedTransactions: (unmatchedTransactions.results || []).length,
      overdueFollowups: (overdueFollowups.results || []).length,
      importRows: imports.length,
      failedSyncs: (failedSyncs.results || []).length,
      spendingConflicts: (spendingConflicts.results || []).length,
      consentConflicts: (consentConflicts.results || []).length,
      total: items.length,
    },
    duplicates,
    unmatchedInteractions: unmatchedInteractions.results || [],
    unmatchedTransactions: unmatchedTransactions.results || [],
    overdueFollowups: overdueFollowups.results || [],
    importRows: imports,
    failedSyncs: failedSyncs.results || [],
    spendingConflicts: spendingConflicts.results || [],
    consentConflicts: consentConflicts.results || [],
    items,
  });
}

async function handlePeopleExport(database) {
  const [peopleResult, consentResult] = await Promise.all([
    database.prepare(`${personSelectSql(`
      p.merged_into_id IS NULL
      AND p.relationship_status!='merged'
      AND p.eligibility_at IS NOT NULL
      AND p.archived_at IS NULL
    `)}
      ORDER BY p.display_name COLLATE NOCASE
      LIMIT 10000
    `).all(),
    database.prepare(`
      SELECT p.id,
        CASE
          WHEN EXISTS(SELECT 1 FROM crm_suppressions sp
            WHERE sp.person_id=p.id AND sp.active=1) THEN 'unsubscribed'
          WHEN EXISTS(SELECT 1 FROM crm_marketing_subscriptions s
            WHERE s.person_id=p.id AND s.active=1 AND s.status='subscribed') THEN 'subscribed'
          WHEN EXISTS(SELECT 1 FROM crm_marketing_subscriptions s
            WHERE s.person_id=p.id AND s.active=1 AND s.status='paused') THEN 'paused'
          WHEN EXISTS(SELECT 1 FROM crm_marketing_subscriptions s
            WHERE s.person_id=p.id AND s.active=1 AND s.status='unsubscribed') THEN 'unsubscribed'
          ELSE 'unknown'
        END effective_consent
      FROM crm_people p
      WHERE p.merged_into_id IS NULL AND p.relationship_status!='merged'
        AND p.eligibility_at IS NOT NULL
        AND p.archived_at IS NULL
    `).all(),
  ]);
  const consent = new Map((consentResult.results || [])
    .map((row) => [row.id, row.effective_consent]));
  const tierLabels = new Map([[1, "Tier I: Core"], [2, "Tier II: Returning"], [3, "Tier III: Connected"]]);
  const headers = [
    "person_id", "display_name", "preferred_name", "organization", "pronouns",
    "relationship_status", "tier", "tier_rationale", "primary_email",
    "primary_phone", "preferred_contact_method", "referral_source", "effective_consent", "tags",
    "nodes", "interaction_count", "last_interaction_at", "next_interaction_at", "settled_gross_cents",
    "refund_cents", "net_spend_cents", "tip_cents", "pending_cents",
    "next_followup_at", "relationship_summary",
  ];
  const lines = [headers.map(safeCsvCell).join(",")];
  for (const raw of peopleResult.results || []) {
    const person = personView(raw);
    lines.push([
      person.id,
      person.displayName,
      person.preferredName,
      person.organization,
      person.pronouns,
      person.relationshipStatus,
      person.tier ? tierLabels.get(person.tier) : "Unrated",
      person.tierRationale,
      person.primaryEmail,
      person.primaryPhone,
      person.preferredContactMethod,
      person.referralSource,
      consent.get(person.id) || "unknown",
      person.tags.join(", "),
      person.nodes.join(", "),
      person.interactionCount,
      person.lastInteractionAt || "",
      person.nextInteractionAt || "",
      person.settledGrossCents,
      person.refundCents,
      person.netSpendCents,
      person.tipCents,
      person.pendingCents,
      person.nextFollowupAt || "",
      person.summary,
    ].map(safeCsvCell).join(","));
  }
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"construct-people.csv\"",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleIntegrations(env, database) {
  return handleCrmProviderStatus(database, env);
}

export async function handleAdminCrmApi(request, env) {
  const authError = requireStudioAdmin(request, env);
  if (authError) return authError;
  let database;
  try {
    database = requireCrmDb(env);
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const route = parts.slice(3);
    const method = request.method.toUpperCase();

    if (route[0] === "people" && !route[1]) {
      if (method === "GET") return handleListPeople(request, database);
      if (method === "POST") return handleCreatePerson(request, database);
      return response405("GET", "POST");
    }
    if (route[0] === "people" && route[1] === "merge" && !route[2]) {
      if (method !== "POST") return response405("POST");
      return handleMergePeople(request, database);
    }
    if (route[0] === "people" && route[1]) {
      const personId = route[1];
      const action = route[2];
      if (!action) {
        if (method === "GET") return handleGetPerson(database, personId);
        if (method === "PATCH") return handleUpdatePerson(request, database, personId);
        if (method === "DELETE") return handleDeletePerson(request, database, personId);
        return response405("GET", "PATCH", "DELETE");
      }
      if (action === "identities") {
        if (method !== "POST") return response405("POST");
        return handleCreateIdentity(request, database, personId);
      }
      if (action === "notes") {
        if (method !== "POST") return response405("POST");
        return handleCreateNote(request, database, personId);
      }
      if (action === "personal-context") {
        const contextId = route[3];
        if (!contextId) {
          if (method !== "POST") return response405("POST");
          return handleCreatePersonalContext(request, database, personId);
        }
        if (!["PATCH", "DELETE"].includes(method)) return response405("PATCH", "DELETE");
        return handlePersonalContextRecord(request, database, personId, contextId);
      }
      if (action === "followups") {
        if (!["POST", "PATCH"].includes(method)) return response405("POST", "PATCH");
        return handleFollowups(request, database, personId);
      }
      if (action === "interactions") {
        if (method !== "POST") return response405("POST");
        return handleCreateInteraction(request, database, personId);
      }
      if (action === "transactions") {
        if (method !== "POST") return response405("POST");
        return handleCreateTransaction(request, database, personId);
      }
      if (action === "unmerge") {
        if (method !== "POST") return response405("POST");
        return handleUnmergePerson(database, personId);
      }
      return failure("Unknown CRM people route.", 404);
    }
    if (route[0] === "needs-attention" && !route[1]) {
      if (method !== "GET") return response405("GET");
      return handleNeedsAttention(database);
    }
    if (route[0] === "exports" && route[1] === "people.csv" && !route[2]) {
      if (method !== "GET") return response405("GET");
      return handlePeopleExport(database);
    }
    if (route[0] === "integrations" && !route[1]) {
      if (method !== "GET") return response405("GET");
      return handleIntegrations(env, database);
    }
    if (route[0] === "sync" && route[1] === "status" && !route[2]) {
      if (method !== "GET") return response405("GET");
      return handleCrmProviderStatus(database, env);
    }
    if (route[0] === "sync" && route[1] && !route[2]) {
      if (method !== "POST") return response405("POST");
      return handleCrmProviderSync(request, database, env, route[1]);
    }
    if (route[0] === "backfill" && !route[1]) {
      if (method !== "POST") return response405("POST");
      return handleBackfill(request, database);
    }
    if (route[0] === "imports" && !route[1]) {
      if (method !== "GET") return response405("GET");
      return handleListImports(request, database);
    }
    if (route[0] === "imports" && route[1] === "analyze" && !route[2]) {
      if (method !== "POST") return response405("POST");
      return handleAnalyzeImport(request, database);
    }
    if (route[0] === "imports" && route[1]) {
      const importId = route[1];
      const action = route[2];
      if (!action) {
        if (method !== "PATCH") return response405("PATCH");
        return handlePatchImport(request, database, importId);
      }
      if (action === "rows") {
        if (method !== "GET") return response405("GET");
        return handleImportRows(request, database, importId);
      }
      if (action === "apply") {
        if (method !== "POST") return response405("POST");
        return handleApplyImport(request, database, importId);
      }
      if (action === "rollback") {
        if (method !== "POST") return response405("POST");
        return handleRollbackImport(database, importId);
      }
      if (action === "exceptions.csv") {
        if (method !== "GET") return response405("GET");
        return handleImportExceptions(database, importId);
      }
      return failure("Unknown CRM import route.", 404);
    }
    return failure("Unknown CRM API route.", 404);
  } catch (error) {
    if (error instanceof ImportInputError) return failure(error.message, error.status);
    return failure("Unable to complete the CRM request.", 500, {
      code: "CRM_INTERNAL_ERROR",
    });
  }
}
