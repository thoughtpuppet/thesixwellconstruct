const REQUIRED_CRM_TABLES = [
  "crm_people",
  "crm_identities",
  "crm_interactions",
  "crm_transactions",
];

function valueString(value, maxLength = 500) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return valueString(value, 320).toLowerCase();
}

function normalizePhone(value) {
  const raw = valueString(value, 80);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function normalizeInstagram(value) {
  return valueString(value, 100).replace(/^@+/, "").toLowerCase();
}

function normalizedIdentity(kind, value) {
  if (kind === "email") return normalizeEmail(value);
  if (kind === "phone") return normalizePhone(value);
  if (kind === "instagram") return normalizeInstagram(value);
  return valueString(value, 500).toLowerCase();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sourceTuple(value, fallbackType) {
  const source = safeObject(value);
  const sourceProvider = valueString(source.sourceProvider || "local", 80) || "local";
  const sourceType = valueString(source.sourceType || fallbackType, 120);
  const sourceId = valueString(source.sourceId, 300);
  if (!sourceType || !sourceId) return null;
  return { sourceProvider, sourceType, sourceId };
}

function recordId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

const DURABLE_INGEST_CONFLICTS = new Set([
  "source_person_conflict",
  "provider_identity_conflict",
  "shared_email",
  "ambiguous_email",
  "email_owned_by_another_person",
  "provider_transaction_person_conflict",
]);

async function conflictSourceId(tuple) {
  const source = [
    tuple.sourceProvider,
    tuple.sourceType,
    tuple.sourceId,
  ].join("\u001f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `crm-ingest-conflict-${fingerprint}`;
}

async function conflictAttentionStatements(
  database,
  tuples,
  warnings,
  transactionTuple,
  now,
) {
  const conflicts = [...new Set(warnings.filter((warning) => (
    DURABLE_INGEST_CONFLICTS.has(warning)
  )))];
  const tupleEntries = await Promise.all(tuples.map(async (tuple) => ({
    tuple,
    sourceId: await conflictSourceId(tuple),
  })));
  const statements = [];
  const attentionTuple = conflicts.includes("provider_transaction_person_conflict")
    && transactionTuple
    ? transactionTuple
    : tuples[0];
  const activeSourceId = conflicts.length && attentionTuple
    ? await conflictSourceId(attentionTuple)
    : "";

  for (const entry of tupleEntries) {
    if (!conflicts.length || entry.sourceId !== activeSourceId) {
      statements.push(database.prepare(
        `UPDATE crm_interactions
         SET status='resolved',active=0,updated_at=?
         WHERE source_provider='system'
           AND source_type='crm_ingest_conflict' AND source_id=?`
      ).bind(now, entry.sourceId));
      continue;
    }

    const metadataJson = JSON.stringify({
      conflicts,
      source: {
        provider: entry.tuple.sourceProvider,
        type: entry.tuple.sourceType,
        id: entry.tuple.sourceId,
      },
    });
    statements.push(
      database.prepare(
        `INSERT OR IGNORE INTO crm_interactions(
          id,person_id,node_id,channel,interaction_type,label,status,quantity,
          occurred_at,source_provider,source_type,source_id,metadata_json,
          active,created_at,updated_at
        ) VALUES(?,NULL,NULL,'system','crm_ingest_conflict',
          'Live CRM identity or payment conflict','needs_review',1,?,
          'system','crm_ingest_conflict',?,?,1,?,?)`
      ).bind(
        recordId("crm-interaction"),
        now,
        entry.sourceId,
        metadataJson,
        now,
        now,
      ),
      database.prepare(
        `UPDATE crm_interactions
         SET person_id=NULL,node_id=NULL,channel='system',
             interaction_type='crm_ingest_conflict',
             label='Live CRM identity or payment conflict',
             status='needs_review',quantity=1,occurred_at=?,
             metadata_json=?,active=1,updated_at=?
         WHERE source_provider='system'
           AND source_type='crm_ingest_conflict' AND source_id=?`
      ).bind(now, metadataJson, now, entry.sourceId),
    );
  }
  return statements;
}

async function crmSchemaAvailable(database) {
  if (!database?.prepare || !database?.batch) return false;
  try {
    const placeholders = REQUIRED_CRM_TABLES.map(() => "?").join(",");
    const result = await database.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type='table' AND name IN (${placeholders})`
    ).bind(...REQUIRED_CRM_TABLES).all();
    return new Set((result.results || []).map((row) => row.name)).size === REQUIRED_CRM_TABLES.length;
  } catch {
    return false;
  }
}

async function canonicalPersonId(database, personId) {
  let currentId = valueString(personId, 200);
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const person = await database.prepare(
      "SELECT id,merged_into_id FROM crm_people WHERE id=? LIMIT 1"
    ).bind(currentId).first();
    if (!person) return "";
    if (!person.merged_into_id) return person.id;
    currentId = valueString(person.merged_into_id, 200);
  }
  return "";
}

async function sourcePersonIds(database, tuples) {
  const ids = new Set();
  for (const tuple of tuples) {
    for (const table of ["crm_interactions", "crm_transactions"]) {
      const row = await database.prepare(
        `SELECT person_id FROM ${table}
         WHERE source_provider=? AND source_type=? AND source_id=?
         LIMIT 1`
      ).bind(tuple.sourceProvider, tuple.sourceType, tuple.sourceId).first();
      if (!row?.person_id) continue;
      const canonicalId = await canonicalPersonId(database, row.person_id);
      if (canonicalId) ids.add(canonicalId);
    }
    const identity = await database.prepare(
      `SELECT person_id FROM crm_identities
       WHERE provider=? AND external_id=? AND active=1
       LIMIT 1`
    ).bind(tuple.sourceProvider, `${tuple.sourceType}:${tuple.sourceId}`).first();
    if (identity?.person_id) {
      const canonicalId = await canonicalPersonId(database, identity.person_id);
      if (canonicalId) ids.add(canonicalId);
    }
  }
  return [...ids];
}

async function providerPersonIds(database, providerIdentity) {
  const provider = valueString(providerIdentity?.provider, 80);
  const externalId = valueString(providerIdentity?.externalId, 300);
  if (!provider || !externalId) return [];
  const result = await database.prepare(
    `SELECT person_id FROM crm_identities
     WHERE provider=? AND external_id=? AND active=1`
  ).bind(provider, externalId).all();
  const ids = new Set();
  for (const row of result.results || []) {
    const canonicalId = await canonicalPersonId(database, row.person_id);
    if (canonicalId) ids.add(canonicalId);
  }
  return [...ids];
}

async function emailOwners(database, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ids: [], shared: false };
  const result = await database.prepare(
    `SELECT person_id,is_shared FROM crm_identities
     WHERE kind='email' AND normalized_value=? AND active=1`
  ).bind(normalized).all();
  const ids = new Set();
  let shared = false;
  for (const row of result.results || []) {
    shared ||= Boolean(row.is_shared);
    const canonicalId = await canonicalPersonId(database, row.person_id);
    if (canonicalId) ids.add(canonicalId);
  }
  return { ids: [...ids], shared };
}

async function providerTransactionOverlap(database, transactionValue) {
  const transaction = safeObject(transactionValue);
  const metadata = safeObject(transaction.metadata);
  const transactionType = valueString(transaction.transactionType, 40);
  const providerPaymentId = valueString(metadata.providerPaymentId, 300);
  const providerRefundId = valueString(metadata.providerRefundId, 300);
  let row = null;

  if (transactionType === "refund" && providerRefundId) {
    row = await database.prepare(
      `SELECT id,person_id FROM crm_transactions
       WHERE source_provider='square' AND source_type='refund' AND source_id=?
         AND active=1
       LIMIT 1`
    ).bind(providerRefundId).first();
  } else if (transactionType !== "refund" && providerPaymentId) {
    row = await database.prepare(
      `SELECT id,person_id FROM crm_transactions
       WHERE source_provider='square' AND source_type='payment' AND source_id=?
         AND active=1
       LIMIT 1`
    ).bind(providerPaymentId).first();
  }

  const externalOrderId = valueString(transaction.externalOrderId, 300);
  const amountCents = Math.max(0, Math.trunc(Number(transaction.amountCents || 0)));
  if (!row && transactionType !== "refund" && externalOrderId) {
    row = await database.prepare(
      `SELECT id,person_id FROM crm_transactions
       WHERE source_provider='square' AND transaction_type='charge'
         AND external_order_id=? AND amount_cents=? AND active=1
       LIMIT 1`
    ).bind(externalOrderId, amountCents).first();
  }
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id
      ? await canonicalPersonId(database, row.person_id)
      : "",
  };
}

function personInsert(database, personId, contact, now) {
  const displayName = valueString(
    contact.displayName || contact.name || contact.email || contact.phone || contact.instagram,
    200,
  ) || "Construct contact";
  const preferredContactMethod = contact.email
    ? "email"
    : contact.phone
      ? "phone"
      : contact.instagram
        ? "instagram"
        : "";
  return database.prepare(
    `INSERT INTO crm_people(
      id,display_name,organization,pronouns,instagram,relationship_status,
      preferred_contact_method,created_at,updated_at
    ) VALUES(?,?,?,?,?,'active',?,?,?)`
  ).bind(
    personId,
    displayName,
    valueString(contact.organization, 200),
    valueString(contact.pronouns, 100),
    normalizeInstagram(contact.instagram),
    preferredContactMethod,
    now,
    now,
  );
}

function contactIdentityInsert(database, personId, kind, value, tuple, verified, now) {
  const rawValue = valueString(value, kind === "email" ? 320 : 100);
  const normalizedValue = normalizedIdentity(kind, rawValue);
  if (!rawValue || !normalizedValue) return null;
  return database.prepare(
    `INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    )
    SELECT ?,?,?,?,?,?,NULL,'',
      CASE WHEN EXISTS(
        SELECT 1 FROM crm_identities
        WHERE person_id=? AND kind=? AND active=1
      ) THEN 0 ELSE 1 END,
      ?,0,?,?,?,1,?,?
    WHERE NOT EXISTS(
      SELECT 1 FROM crm_identities
      WHERE person_id=? AND kind=? AND normalized_value=? AND active=1
    )`
  ).bind(
    recordId("crm-identity"),
    personId,
    kind,
    rawValue,
    normalizedValue,
    tuple.sourceProvider,
    personId,
    kind,
    verified ? 1 : 0,
    tuple.sourceProvider,
    tuple.sourceType,
    `${tuple.sourceType}:${tuple.sourceId}:${kind}`,
    now,
    now,
    personId,
    kind,
    normalizedValue,
  );
}

function sourceIdentityInsert(database, personId, tuple, now) {
  const externalId = `${tuple.sourceType}:${tuple.sourceId}`;
  return database.prepare(
    `INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,'other',?,?,?,?, '',0,1,0,?,?,?,1,?,?)`
  ).bind(
    recordId("crm-identity"),
    personId,
    externalId,
    externalId.toLowerCase(),
    tuple.sourceProvider,
    externalId,
    tuple.sourceProvider,
    tuple.sourceType,
    `${tuple.sourceType}:${tuple.sourceId}:external`,
    now,
    now,
  );
}

function emailClaimInsert(database, personId, email, now) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return database.prepare(
    `INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,'other',?,?, 'crm_email_claim',?,'',
      0,0,0,'system','email_claim',NULL,0,?,?)`
  ).bind(
    recordId("crm-identity"),
    personId,
    normalized,
    normalized,
    normalized,
    now,
    now,
  );
}

function personEnrichmentStatement(database, personId, contact, now) {
  const displayName = valueString(contact.displayName || contact.name, 200);
  const email = normalizeEmail(contact.email);
  const phone = valueString(contact.phone, 80);
  const organization = valueString(contact.organization, 200);
  const pronouns = valueString(contact.pronouns, 100);
  const instagram = normalizeInstagram(contact.instagram);
  const preferredContactMethod = email
    ? "email"
    : phone
      ? "phone"
      : instagram
        ? "instagram"
        : "";
  return database.prepare(
    `UPDATE crm_people
     SET display_name=CASE
           WHEN ?!='' AND (
             TRIM(display_name)=''
             OR display_name='Construct contact'
             OR LOWER(display_name) IN (
               'square contact',
               'shopify contact',
               'beehiiv contact',
               'substack contact'
             )
             OR LOWER(display_name)=LOWER(?)
             OR display_name=?
           ) THEN ?
           ELSE display_name
         END,
         organization=CASE WHEN organization='' AND ?!='' THEN ? ELSE organization END,
         pronouns=CASE WHEN pronouns='' AND ?!='' THEN ? ELSE pronouns END,
         instagram=CASE WHEN instagram='' AND ?!='' THEN ? ELSE instagram END,
         preferred_contact_method=CASE
           WHEN preferred_contact_method='' AND ?!='' THEN ?
           ELSE preferred_contact_method
         END,
         updated_at=?
     WHERE id=?`
  ).bind(
    displayName,
    email,
    phone,
    displayName,
    organization,
    organization,
    pronouns,
    pronouns,
    instagram,
    instagram,
    preferredContactMethod,
    preferredContactMethod,
    now,
    personId,
  );
}

async function emailClaimOwner(database, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const row = await database.prepare(
    `SELECT person_id FROM crm_identities
     WHERE provider='crm_email_claim' AND external_id=?
     LIMIT 1`
  ).bind(normalized).first();
  const claimedPersonId = row?.person_id
    ? await canonicalPersonId(database, row.person_id)
    : "";
  if (!claimedPersonId) return "";
  const owners = await emailOwners(database, normalized);
  return !owners.shared && owners.ids.includes(claimedPersonId)
    ? claimedPersonId
    : "";
}

async function convergeCreatedPerson(database, losingPersonId, winningPersonId, tuples) {
  if (!losingPersonId || !winningPersonId || losingPersonId === winningPersonId) return;
  const statements = [];
  for (const tuple of tuples) {
    statements.push(
      database.prepare(
        `UPDATE OR IGNORE crm_identities
         SET person_id=?,updated_at=?
         WHERE person_id=? AND provider=? AND external_id=?`
      ).bind(
        winningPersonId,
        new Date().toISOString(),
        losingPersonId,
        tuple.sourceProvider,
        `${tuple.sourceType}:${tuple.sourceId}`,
      ),
      database.prepare(
        `UPDATE crm_interactions
         SET person_id=?,updated_at=?
         WHERE source_provider=? AND source_type=? AND source_id=?
           AND (person_id=? OR person_id IS NULL)`
      ).bind(
        winningPersonId,
        new Date().toISOString(),
        tuple.sourceProvider,
        tuple.sourceType,
        tuple.sourceId,
        losingPersonId,
      ),
      database.prepare(
        `UPDATE crm_transactions
         SET person_id=?,updated_at=?
         WHERE source_provider=? AND source_type=? AND source_id=?
           AND (person_id=? OR person_id IS NULL)`
      ).bind(
        winningPersonId,
        new Date().toISOString(),
        tuple.sourceProvider,
        tuple.sourceType,
        tuple.sourceId,
        losingPersonId,
      ),
    );
  }
  statements.push(
    database.prepare("DELETE FROM crm_people WHERE id=?").bind(losingPersonId)
  );
  await database.batch(statements);
}

function providerIdentityInsert(database, personId, providerIdentity, tuple, now) {
  const provider = valueString(providerIdentity?.provider, 80);
  const externalId = valueString(providerIdentity?.externalId, 300);
  if (!provider || !externalId) return null;
  const kind = valueString(providerIdentity.kind, 80) || "other";
  const value = valueString(providerIdentity.value || externalId, 500);
  return database.prepare(
    `INSERT OR IGNORE INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'',0,1,0,?,?,?,1,?,?)`
  ).bind(
    recordId("crm-identity"),
    personId,
    kind,
    value,
    normalizedIdentity(kind, value),
    provider,
    externalId,
    tuple.sourceProvider,
    tuple.sourceType,
    `${tuple.sourceType}:${tuple.sourceId}:provider:${provider}`,
    now,
    now,
  );
}

function interactionStatements(database, personId, interaction, tuple, now) {
  const occurredAt = valueString(interaction.occurredAt, 80) || now;
  const quantity = Math.max(1, Math.trunc(Number(interaction.quantity || 1)));
  const metadataJson = JSON.stringify(safeObject(interaction.metadata));
  return [
    database.prepare(
      `INSERT OR IGNORE INTO crm_interactions(
        id,person_id,node_id,channel,interaction_type,label,status,quantity,
        occurred_at,source_provider,source_type,source_id,metadata_json,
        active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).bind(
      recordId("crm-interaction"),
      personId || null,
      valueString(interaction.nodeId, 120) || null,
      valueString(interaction.channel || tuple.sourceProvider, 80),
      valueString(interaction.interactionType || tuple.sourceType, 120),
      valueString(interaction.label, 500),
      valueString(interaction.status, 80),
      quantity,
      occurredAt,
      tuple.sourceProvider,
      tuple.sourceType,
      tuple.sourceId,
      metadataJson,
      now,
      now,
    ),
    database.prepare(
      `UPDATE crm_interactions
       SET person_id=COALESCE(person_id,?),
           node_id=COALESCE(?,node_id),
           channel=?,interaction_type=?,label=?,status=?,quantity=?,
           occurred_at=?,metadata_json=?,active=1,updated_at=?
       WHERE source_provider=? AND source_type=? AND source_id=?`
    ).bind(
      personId || null,
      valueString(interaction.nodeId, 120) || null,
      valueString(interaction.channel || tuple.sourceProvider, 80),
      valueString(interaction.interactionType || tuple.sourceType, 120),
      valueString(interaction.label, 500),
      valueString(interaction.status, 80),
      quantity,
      occurredAt,
      metadataJson,
      now,
      tuple.sourceProvider,
      tuple.sourceType,
      tuple.sourceId,
    ),
  ];
}

function transactionStatements(database, personId, transaction, tuple, now) {
  const transactionType = ["charge", "refund", "adjustment"].includes(transaction.transactionType)
    ? transaction.transactionType
    : "charge";
  const status = ["pending", "settled", "void", "failed"].includes(transaction.status)
    ? transaction.status
    : "pending";
  const amountCents = transactionType === "adjustment"
    ? Math.trunc(Number(transaction.amountCents || 0))
    : Math.max(0, Math.trunc(Number(transaction.amountCents || 0)));
  const tipCents = Math.max(0, Math.trunc(Number(transaction.tipCents || 0)));
  const occurredAt = valueString(transaction.occurredAt, 80) || now;
  const metadataJson = JSON.stringify(safeObject(transaction.metadata));
  return [
    database.prepare(
      `INSERT OR IGNORE INTO crm_transactions(
        id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
        currency,occurred_at,source_provider,source_type,source_id,
        external_customer_id,external_order_id,note,metadata_json,
        active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).bind(
      recordId("crm-transaction"),
      personId || null,
      valueString(transaction.nodeId, 120) || null,
      transactionType,
      status,
      amountCents,
      tipCents,
      valueString(transaction.currency || "USD", 12).toUpperCase(),
      occurredAt,
      tuple.sourceProvider,
      tuple.sourceType,
      tuple.sourceId,
      valueString(transaction.externalCustomerId, 300) || null,
      valueString(transaction.externalOrderId, 300) || null,
      valueString(transaction.note, 2000),
      metadataJson,
      now,
      now,
    ),
    database.prepare(
      `UPDATE crm_transactions
       SET person_id=COALESCE(person_id,?),
           node_id=COALESCE(?,node_id),
           transaction_type=?,status=?,amount_cents=?,tip_cents=?,currency=?,
           occurred_at=?,external_customer_id=COALESCE(?,external_customer_id),
           external_order_id=COALESCE(?,external_order_id),
           note=?,metadata_json=?,active=1,updated_at=?
       WHERE source_provider=? AND source_type=? AND source_id=?`
    ).bind(
      personId || null,
      valueString(transaction.nodeId, 120) || null,
      transactionType,
      status,
      amountCents,
      tipCents,
      valueString(transaction.currency || "USD", 12).toUpperCase(),
      occurredAt,
      valueString(transaction.externalCustomerId, 300) || null,
      valueString(transaction.externalOrderId, 300) || null,
      valueString(transaction.note, 2000),
      metadataJson,
      now,
      tuple.sourceProvider,
      tuple.sourceType,
      tuple.sourceId,
    ),
  ];
}

export async function ingestCrmSourceRecord(database, record = {}) {
  if (!(await crmSchemaAvailable(database))) {
    return {
      status: "skipped",
      reason: "schema_unavailable",
      personId: null,
      match: "none",
      createdPerson: false,
    };
  }

  const contact = safeObject(record.contact);
  const interactionTuple = record.interaction
    ? sourceTuple(record.interaction, "interaction")
    : null;
  const transactionTuple = record.transaction
    ? sourceTuple(record.transaction, "transaction")
    : null;
  const tuples = [interactionTuple, transactionTuple].filter(Boolean);
  if (!tuples.length) {
    return {
      status: "skipped",
      reason: "source_required",
      personId: null,
      match: "none",
      createdPerson: false,
    };
  }

  const existingSourceIds = await sourcePersonIds(database, tuples);
  const exactProviderIds = await providerPersonIds(database, record.providerIdentity);
  const transactionOverlap = record.transaction
    ? await providerTransactionOverlap(database, record.transaction)
    : null;
  const owners = await emailOwners(database, contact.email);
  const warnings = [];
  let personId = "";
  let match = "none";
  let needsReview = false;

  if (existingSourceIds.length === 1) {
    personId = existingSourceIds[0];
    match = "source";
  } else if (existingSourceIds.length > 1) {
    needsReview = true;
    warnings.push("source_person_conflict");
  } else if (exactProviderIds.length === 1) {
    personId = exactProviderIds[0];
    match = "provider";
  } else if (exactProviderIds.length > 1) {
    needsReview = true;
    warnings.push("provider_identity_conflict");
  } else if (transactionOverlap?.personId) {
    personId = transactionOverlap.personId;
    match = "provider_transaction";
  } else if (owners.shared || owners.ids.length > 1) {
    needsReview = true;
    warnings.push(owners.shared ? "shared_email" : "ambiguous_email");
  } else if (owners.ids.length === 1) {
    personId = owners.ids[0];
    match = "email";
  }

  if (personId && owners.ids.length && !owners.ids.includes(personId)) {
    needsReview = true;
    warnings.push("email_owned_by_another_person");
  }
  if (
    personId
    && transactionOverlap?.personId
    && transactionOverlap.personId !== personId
  ) {
    needsReview = true;
    warnings.push("provider_transaction_person_conflict");
  }

  let createdPerson = false;
  if (!personId && !needsReview) {
    personId = recordId("crm-person");
    match = "new";
    createdPerson = true;
  }

  const now = new Date().toISOString();
  const statements = [];
  statements.push(...await conflictAttentionStatements(
    database,
    tuples,
    warnings,
    transactionTuple,
    now,
  ));
  if (createdPerson) statements.push(personInsert(database, personId, contact, now));
  else if (personId) statements.push(personEnrichmentStatement(database, personId, contact, now));

  if (personId) {
    const identityTuple = tuples[0];
    const claimStatement = emailClaimInsert(database, personId, contact.email, now);
    if (claimStatement) statements.push(claimStatement);
    const emailMayAttach = !owners.ids.length || owners.ids.includes(personId);
    for (const [kind, value, verified] of [
      ["email", emailMayAttach ? contact.email : "", Boolean(contact.verifiedEmail)],
      ["phone", contact.phone, Boolean(contact.verifiedPhone)],
      ["instagram", contact.instagram, false],
    ]) {
      const statement = contactIdentityInsert(
        database,
        personId,
        kind,
        value,
        identityTuple,
        verified,
        now,
      );
      if (statement) statements.push(statement);
    }
    for (const tuple of tuples) {
      statements.push(sourceIdentityInsert(database, personId, tuple, now));
    }
    const providerStatement = providerIdentityInsert(
      database,
      personId,
      record.providerIdentity,
      identityTuple,
      now,
    );
    if (providerStatement) statements.push(providerStatement);
  }

  if (record.interaction && interactionTuple) {
    statements.push(...interactionStatements(
      database,
      personId,
      safeObject(record.interaction),
      interactionTuple,
      now,
    ));
  }
  if (record.transaction && transactionTuple) {
    if (transactionOverlap) {
      statements.push(
        database.prepare(
          `UPDATE crm_transactions
           SET person_id=COALESCE(person_id,?),updated_at=?
           WHERE id=?`
        ).bind(personId || null, now, transactionOverlap.id)
      );
    } else {
      statements.push(...transactionStatements(
        database,
        personId,
        safeObject(record.transaction),
        transactionTuple,
        now,
      ));
    }
  }

  await database.batch(statements);
  if (createdPerson) {
    const postSourceIds = await sourcePersonIds(database, tuples);
    const claimedEmailPersonId = await emailClaimOwner(database, contact.email);
    const winningPersonId = postSourceIds.length === 1 && postSourceIds[0] !== personId
      ? postSourceIds[0]
      : claimedEmailPersonId && claimedEmailPersonId !== personId
        ? claimedEmailPersonId
        : personId;
    if (winningPersonId !== personId) {
      await convergeCreatedPerson(database, personId, winningPersonId, tuples);
      const converged = await ingestCrmSourceRecord(database, record);
      return {
        ...converged,
        createdPerson: false,
        warnings: [...new Set([
          ...(converged.warnings || []),
          "concurrent_identity_converged",
        ])],
      };
    }
  }
  return {
    status: needsReview ? "needs_review" : "applied",
    reason: needsReview ? warnings[0] : "",
    personId: personId || null,
    match,
    createdPerson,
    interactionCreated: Boolean(record.interaction && interactionTuple),
    transactionCreated: Boolean(record.transaction && transactionTuple && !transactionOverlap),
    transactionOverlap: Boolean(transactionOverlap),
    warnings,
  };
}
