import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleAdminCrmApi } from "../functions/api/crm/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "crm-contract-token";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));
  }
  return database;
}

function env(database, overrides = {}) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    SUBMISSIONS_ADMIN_TOKEN: TOKEN,
    ...overrides,
  };
}

function request(path, {
  method = "GET",
  body,
  admin = false,
  headers = {},
} = {}) {
  const hasBody = body !== undefined;
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...headers,
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

async function api(database, path, options = {}) {
  return handleAdminCrmApi(
    request(path, { ...options, admin: options.admin ?? true }),
    env(database, options.env),
  );
}

async function responseJson(response) {
  const payload = await response.json();
  return { response, payload };
}

async function createPerson(database, values = {}) {
  const result = await responseJson(await api(database, "/api/admin/crm/people", {
    method: "POST",
    body: {
      displayName: "Alex Existing",
      email: "alex@example.com",
      ...values,
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.person;
}

function installSquareApiMock(testContext, {
  payments = [],
  refunds = [],
} = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method: String(init.method || "GET").toUpperCase(),
      headers,
    });

    assert.equal(url.origin, "https://connect.squareup.com");
    assert.equal(String(init.method || "GET").toUpperCase(), "GET");
    assert.equal(headers.get("authorization"), "Bearer square-test-token");
    assert.equal(headers.get("square-version"), "2026-05-20");
    assert.equal(url.searchParams.get("location_id"), "square-tattoo-location");

    if (url.pathname === "/v2/payments") {
      return Response.json({ payments });
    }
    if (url.pathname === "/v2/refunds") {
      return Response.json({ refunds });
    }
    throw new Error(`Unexpected Square request: ${url}`);
  };
  testContext.after(() => {
    globalThis.fetch = originalFetch;
  });
  return calls;
}

const SQUARE_SYNC_ENV = {
  SQUARE_ACCESS_TOKEN: "square-test-token",
  SQUARE_LOCATION_ID: "square-tattoo-location",
  SQUARE_ENVIRONMENT: "production",
};

test("CRM routes are owner-token protected", async () => {
  const database = migratedDatabase();

  let response = await handleAdminCrmApi(
    request("/api/admin/crm/people"),
    env(database),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Unauthorized.");

  response = await handleAdminCrmApi(
    request("/api/admin/crm/people", { admin: true }),
    env(database, { SUBMISSIONS_ADMIN_TOKEN: "" }),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("people profiles preserve manual tier judgment and calculate relationship activity and spend", async () => {
  const database = migratedDatabase();

  let result = await responseJson(await api(database, "/api/admin/crm/people", {
    method: "POST",
    body: {
      displayName: "Rationale Required",
      email: "rationale@example.com",
      tier: 1,
    },
  }));
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /rationale/i);

  const person = await createPerson(database, {
    preferredName: "Alex",
    tags: ["tattoo client", "Atlanta"],
  });
  assert.equal(person.tier, null);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "PATCH",
    body: { tier: 2 },
  }));
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /rationale/i);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "PATCH",
    body: {
      tier: 2,
      tierRationale: "Returns consistently and is generous with trust.",
      preferredContactMethod: "email",
    },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.tier, 2);
  assert.equal(result.payload.person.tierRationale, "Returns consistently and is generous with trust.");

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/identities`, {
    method: "POST",
    body: {
      kind: "phone",
      value: "+1 (404) 555-0199",
      label: "mobile",
      isPrimary: true,
      isVerified: true,
    },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.identity.normalized_value, "+14045550199");
  assert.equal(result.payload.identity.is_primary, 1);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/notes`, {
    method: "POST",
    body: {
      body: "Prefers quiet appointments and strong blackwork.",
      category: "relationship",
      pinned: true,
    },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.note.pinned, 1);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/followups`, {
    method: "POST",
    body: {
      action: "Send healed-photo check-in",
      dueAt: "2020-01-01T12:00:00.000Z",
      priority: "high",
      note: "Ask about the elbow detail.",
    },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.followup.status, "open");

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/interactions`, {
    method: "POST",
    body: {
      interactionType: "tattoo_appointment",
      nodeId: "node-tattoos",
      channel: "studio",
      label: "Half-day session",
      status: "completed",
      occurredAt: "2026-06-01T14:00:00.000Z",
      details: "Second session on the sleeve.",
    },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.interaction.metadata.details, "Second session on the sleeve.");

  for (const transaction of [
    {
      transactionType: "charge",
      status: "settled",
      amountCents: 10_000,
      tipCents: 2_000,
      nodeId: "node-tattoos",
      label: "Tattoo session",
      reference: "receipt-100",
    },
    {
      transactionType: "refund",
      status: "settled",
      amountCents: 2_500,
      nodeId: "node-tattoos",
      note: "Partial refund",
    },
    {
      transactionType: "charge",
      status: "pending",
      amountCents: 1_500,
      nodeId: "node-tattoos",
    },
  ]) {
    result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/transactions`, {
      method: "POST",
      body: transaction,
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  }

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.settledGrossCents, 10_000);
  assert.equal(result.payload.person.refundCents, 2_500);
  assert.equal(result.payload.person.netSpendCents, 7_500);
  assert.equal(result.payload.person.tipCents, 2_000);
  assert.equal(result.payload.person.pendingCents, 1_500);
  assert.deepEqual(result.payload.person.nodes, ["node-tattoos"]);
  assert.equal(result.payload.notes.length, 1);
  assert.equal(result.payload.followups.length, 1);
  assert.equal(result.payload.interactions.length, 1);
  assert.equal(result.payload.transactions.length, 3);
  assert.equal(result.payload.tierHistory.length, 1);
  assert.ok(result.payload.audit.some((entry) => entry.action === "tier_changed"));

  result = await responseJson(await api(
    database,
    "/api/admin/crm/people?tier=2&nodeId=node-tattoos&interactionType=tattoo_appointment"
      + "&tag=tattoo-client&followup=overdue&minSpendCents=7000",
  ));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.people.map((entry) => entry.id), [person.id]);

  result = await responseJson(await api(database, "/api/admin/crm/people", {
    method: "POST",
    body: { displayName: "Duplicate", email: "ALEX@example.com" },
  }));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.details.code, "EMAIL_ALREADY_CONNECTED");
});

test("Personal Context stays profile-only, client-shared, editable, scrub-removable, and tier-neutral", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Taylor Context",
    email: "taylor-context@example.com",
  });
  const otherPerson = await createPerson(database, {
    displayName: "Other Person",
    email: "other-context@example.com",
  });
  const originalBody = "PRIVATE_CONTEXT_SENTINEL_71c9 is a teacher.";
  const updatedBody = "PRIVATE_CONTEXT_UPDATED_98d2 is a teacher and volunteers locally.";

  let result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/notes`, {
    method: "POST",
    body: {
      category: "personal_context",
      body: originalBody,
    },
  }));
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /Personal Context/i);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/personal-context`, {
    method: "POST",
    body: { body: originalBody },
  }));
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /shared directly/i);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/personal-context`, {
    method: "POST",
    body: {
      body: originalBody,
      provenance: "third_party",
    },
  }));
  assert.equal(result.response.status, 400);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/personal-context`, {
    method: "POST",
    body: {
      body: originalBody,
      pinned: true,
      provenance: "shared_by_client",
      sourceProvider: "spoofed",
      sourceType: "spoofed",
      sourceLabel: "Spoofed",
      visibility: "public",
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const context = result.payload.personalContext;
  assert.equal(context.category, "personal_context");
  assert.equal(context.source_provider, "manual");
  assert.equal(context.source_type, "shared_by_client");
  assert.equal(context.source_label, "Shared by client");
  assert.equal(context.provenance, "shared_by_client");
  assert.equal(context.visibility, "owner");
  assert.equal(context.sensitive, true);
  assert.equal(context.pinned, 1);
  assert.ok(context.created_at);

  let response = await handleAdminCrmApi(
    request(`/api/admin/crm/people/${person.id}/personal-context/${context.id}`, {
      method: "PATCH",
      body: { body: "unauthorized" },
    }),
    env(database),
  );
  assert.equal(response.status, 401);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.notes.length, 0);
  assert.equal(result.payload.personalContext.length, 1);
  assert.equal(result.payload.personalContext[0].body, originalBody);
  assert.equal(result.payload.person.tier, null);
  assert.equal(result.payload.tierHistory.length, 0);

  result = await responseJson(await api(database, `/api/admin/crm/people?q=${encodeURIComponent("PRIVATE_CONTEXT_SENTINEL_71c9")}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.count, 0);

  result = await responseJson(await api(database, "/api/admin/crm/people?limit=100"));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.people.some((entry) => entry.id === person.id));
  assert.doesNotMatch(JSON.stringify(result.payload), /PRIVATE_CONTEXT_SENTINEL_71c9/);
  assert.doesNotMatch(JSON.stringify(result.payload), /personalContext/);

  response = await api(database, "/api/admin/crm/exports/people.csv");
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.match(csv, /taylor-context@example\.com/);
  assert.doesNotMatch(csv, /PRIVATE_CONTEXT_SENTINEL_71c9/);
  assert.doesNotMatch(csv, /personal.context/i);

  result = await responseJson(await api(database, `/api/admin/crm/people/${otherPerson.id}/personal-context/${context.id}`, {
    method: "PATCH",
    body: {
      body: "cross-person edit",
      provenance: "shared_by_client",
    },
  }));
  assert.equal(result.response.status, 404);

  result = await responseJson(await api(database, `/api/admin/crm/people/${otherPerson.id}/personal-context/${context.id}`, {
    method: "DELETE",
  }));
  assert.equal(result.response.status, 404);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/personal-context/${context.id}`, {
    method: "PATCH",
    body: {
      body: updatedBody,
      pinned: false,
      provenance: "shared_by_client",
    },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.personalContext.body, updatedBody);
  assert.equal(result.payload.personalContext.created_at, context.created_at);
  assert.equal(result.payload.personalContext.source_type, "shared_by_client");
  assert.equal(result.payload.personalContext.pinned, 0);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  const contextAudits = result.payload.audit.filter((entry) => entry.resource_id === context.id);
  assert.deepEqual(
    contextAudits.map((entry) => entry.action).sort(),
    ["personal_context_created", "personal_context_updated"],
  );
  assert.doesNotMatch(JSON.stringify(contextAudits), /PRIVATE_CONTEXT_SENTINEL_71c9/);
  assert.doesNotMatch(JSON.stringify(contextAudits), /PRIVATE_CONTEXT_UPDATED_98d2/);
  assert.equal(result.payload.person.tier, null);
  assert.equal(result.payload.tierHistory.length, 0);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "PATCH",
    body: {
      tier: 1,
      tierRationale: "Manual relationship judgment, independent of private context.",
    },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.tier, 1);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/personal-context/${context.id}`, {
    method: "DELETE",
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.removed, true);

  const scrubbed = database.prepare(`
    SELECT body,archived_at FROM crm_notes WHERE id=?
  `).get(context.id);
  assert.equal(scrubbed.body, "");
  assert.ok(scrubbed.archived_at);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.payload.personalContext.length, 0);
  assert.equal(result.payload.person.tier, 1);
  assert.equal(result.payload.tierHistory.length, 1);
  const finalContextAudits = result.payload.audit.filter((entry) => entry.resource_id === context.id);
  assert.ok(finalContextAudits.some((entry) => entry.action === "personal_context_removed"));
  assert.doesNotMatch(JSON.stringify(finalContextAudits), /PRIVATE_CONTEXT_/);
});

test("legacy list imports analyze, review, resume, apply idempotently, export safe exceptions, and roll back", async () => {
  const database = migratedDatabase();
  const existing = await createPerson(database, {
    phone: "(404) 555-0100",
  });
  const content = [
    "\uFEFFName,Email,Phone,Date,Amount Paid,Tip,Notes,Notes,Tags,Tier,Consent",
    "\"Existing, Alex\",alex@example.com,,01/15/2020,\"$120.50\",\"$20.00\",\"first line",
    "second line\",shadowed,\"returning;tattoo\",II,subscribed",
    "New Person,new@example.com,,2021-02-03,75,5,\"=HYPERLINK(\"\"https://evil.test\"\")\",shadowed,new-client,I,subscribed",
    "Phone Match,,\"(404) 555-0100\",2020,50,,\"Phone-only rows require review\",shadowed,legacy,,unknown",
    "New Person,new@example.com,,2021-02-03,75,5,\"=HYPERLINK(\"\"https://evil.test\"\")\",shadowed,new-client,I,subscribed",
    "Invalid Email,not-an-email,,not-a-date,abc,,\"unsafe\",shadowed,,,unknown",
  ].join("\r\n");

  let result = await responseJson(await api(database, "/api/admin/crm/imports/analyze", {
    method: "POST",
    body: {
      filename: "tattoo-clients.csv",
      content,
      config: {
        sourceLabel: "2018-2021 tattoo clients",
        sourcePeriodStart: "2018-01-01",
        sourcePeriodEnd: "2021-12-31",
        defaultInteractionType: "tattoo_client",
        defaultNodeId: "node-tattoos",
        dateFormat: "mdy",
        currency: "USD",
        moneyMode: "transaction",
        newsletterExport: true,
        newsletterProvider: "substack",
        subscriptionStatus: "unknown",
      },
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const importId = result.payload.importBatch.id;
  assert.ok(importId);
  assert.deepEqual(result.payload.columns.slice(-5), ["Notes", "Notes (2)", "Tags", "Tier", "Consent"]);
  assert.equal(result.payload.summary.total, 5);
  assert.equal(result.payload.summary.exactMatch, 1);
  assert.equal(result.payload.summary.newPerson, 1);
  assert.equal(result.payload.summary.possibleMatch, 1);
  assert.equal(result.payload.summary.duplicateInFile, 1);
  assert.equal(result.payload.summary.invalid, 1);
  assert.equal(result.payload.summary.reviewRequired, 1);

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/rows?limit=100`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.rows.length, 5);
  const possible = result.payload.rows.find((row) => row.classification === "possible_match");
  const invalid = result.payload.rows.find((row) => row.classification === "invalid");
  assert.ok(possible);
  assert.ok(invalid);
  assert.ok(possible.matchDetail.phoneCandidates.includes(existing.id));
  assert.equal(
    result.payload.rows
      .find((row) => row.classification === "exact_match")
      .normalized.notes.replace(/\r\n/g, "\n"),
    "first line\nsecond line",
  );

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/apply`, {
    method: "POST",
    body: {},
  }));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.details.code, "IMPORT_REVIEW_REQUIRED");

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}`, {
    method: "PATCH",
    body: {
      config: { confirmImportedTiers: true },
      rowDecisions: [{
        id: possible.id,
        decision: "link",
        targetPersonId: existing.id,
      }],
    },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.importBatch.status, "configured");
  assert.equal(result.payload.summary.reviewRequired, 0);

  database.prepare(`
    UPDATE crm_import_rows SET error=?,apply_state='error'
    WHERE id=? AND import_batch_id=?
  `).run("=cmd|' /C calc'!A0", invalid.id, importId);
  let response = await api(database, `/api/admin/crm/imports/${importId}/exceptions.csv`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/);
  const exceptionBytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...exceptionBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const exceptionCsv = new TextDecoder().decode(exceptionBytes);
  assert.match(exceptionCsv, /"'=cmd\|' \/C calc'!A0"/);
  assert.doesNotMatch(exceptionCsv, /,"=cmd\|/);

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/apply`, {
    method: "POST",
    body: { limit: 1 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.applied, 1);
  assert.equal(result.payload.importBatch.status, "applying");

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/apply`, {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.applied, 2);
  assert.equal(result.payload.importBatch.status, "applied");

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/apply`, {
    method: "POST",
    body: {},
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.idempotent, true);

  const importRows = database.prepare(`
    SELECT classification,decision,apply_state,applied_person_id
    FROM crm_import_rows WHERE import_batch_id=? ORDER BY row_number
  `).all(importId);
  assert.equal(importRows.filter((row) => row.apply_state === "applied").length, 3);
  assert.equal(importRows.filter((row) => row.apply_state === "skipped").length, 1);
  assert.equal(importRows.filter((row) => row.apply_state === "error").length, 1);

  const importedPeople = database.prepare(`
    SELECT * FROM crm_people WHERE import_batch_id=?
  `).all(importId);
  assert.equal(importedPeople.length, 1);
  const newPersonId = importedPeople[0].id;

  result = await responseJson(await api(database, `/api/admin/crm/people/${existing.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.netSpendCents, 17_050);
  assert.equal(result.payload.person.tipCents, 2_000);
  assert.equal(result.payload.person.tier, 2);
  assert.equal(result.payload.notes.length, 2);
  assert.equal(result.payload.interactions.length, 2);
  assert.equal(result.payload.transactions.length, 2);

  result = await responseJson(await api(database, `/api/admin/crm/people/${newPersonId}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.netSpendCents, 7_500);
  assert.equal(result.payload.person.tipCents, 500);
  assert.equal(result.payload.person.tier, 1);
  assert.equal(result.payload.notes[0].body, "=HYPERLINK(\"https://evil.test\")");
  assert.equal(result.payload.notes[0].source_label, "2018-2021 tattoo clients");
  assert.equal(result.payload.subscriptions[0].status, "subscribed");

  result = await responseJson(await api(database, "/api/admin/crm/imports/analyze", {
    method: "POST",
    body: {
      filename: "same-file-again.csv",
      content,
      config: { sourceLabel: "Ignored duplicate upload" },
    },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.idempotent, true);
  assert.equal(result.payload.importBatch.id, importId);

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/rollback`, {
    method: "POST",
    body: {},
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.importBatch.status, "rolled_back");

  assert.deepEqual(
    { ...database.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) inactive
      FROM crm_interactions WHERE import_batch_id=?
    `).get(importId) },
    { total: 3, inactive: 3 },
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN active=0 AND status='void' THEN 1 ELSE 0 END) voided
      FROM crm_transactions WHERE import_batch_id=?
    `).get(importId) },
    { total: 3, voided: 3 },
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_notes
    WHERE import_batch_id=? AND archived_at IS NOT NULL
  `).get(importId).count, 3);
  assert.equal(database.prepare(`
    SELECT relationship_status FROM crm_people WHERE id=?
  `).get(newPersonId).relationship_status, "archived");
  assert.equal(database.prepare(`
    SELECT relationship_status FROM crm_people WHERE id=?
  `).get(existing.id).relationship_status, "active");

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/rollback`, {
    method: "POST",
    body: {},
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.idempotent, true);
});

test("local historical backfill ignores mirrored event submissions and is repeat-safe", async () => {
  const database = migratedDatabase();
  const now = "2026-07-01T12:00:00.000Z";

  database.prepare(`
    INSERT INTO submissions(
      id,type,status,source_path,subject,contact_name,contact_email,contact_phone,
      contact_json,payload_json,request_meta_json,files_json,internal_notes,
      booking_url,created_at,updated_at
    ) VALUES(
      'submission-event-mirror','event_rsvp','new','/events/signal-symbol/',
      'Signal & Symbol RSVP','Event Friend','event@example.com','4045550110',
      '{}','{}','{}','[]','','',?,?
    )
  `).run(now, now);
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,contact_phone,seats,amount_cents,
      currency,status,square_order_id,square_payment_link_id,square_checkout_url,
      square_payment_id,raw_json,paid_at,created_at,updated_at
    ) VALUES(
      'ticket-paid','evt_signal_symbol','Event Friend','event@example.com',
      '4045550110',1,4500,'USD','paid','order-event-1','link-event-1',
      'https://square.example/checkout','payment-event-1','{}',?,?,?
    )
  `).run(now, now, now);

  let result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.createdPeople, 1);
  assert.equal(result.payload.processed.submissions, 0);
  assert.equal(result.payload.processed.eventTickets, 1);

  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='local' AND source_type='event_ticket'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='local' AND source_type='submission'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='local' AND source_type='event_ticket_payment'
  `).get().count, 1);

  result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.createdPeople, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 1);

  const personId = database.prepare("SELECT id FROM crm_people").get().id;
  result = await responseJson(await api(database, `/api/admin/crm/people/${personId}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.netSpendCents, 4_500);
  assert.equal(result.payload.person.interactionCount, 1);
});

test("CRM provider status reports integration readiness without exposing credentials", async () => {
  const database = migratedDatabase();

  let result = await responseJson(await api(database, "/api/admin/crm/sync/status"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.readyCount, 1);
  assert.deepEqual(
    Object.fromEntries(result.payload.providers.map((provider) => [
      provider.id,
      {
        ready: provider.ready,
        status: provider.status,
      },
    ])),
    {
      square: { ready: false, status: "needs_attention" },
      shopify: { ready: false, status: "needs_attention" },
      beehiiv: { ready: false, status: "needs_attention" },
      substack: { ready: true, status: "manual" },
    },
  );
  assert.ok(
    result.payload.providers
      .find((provider) => provider.id === "square")
      .missing.includes("SQUARE_ACCESS_TOKEN"),
  );
  assert.equal(JSON.stringify(result.payload).includes("square-test-token"), false);
  assert.deepEqual(result.payload.local, {
    peopleCount: 0,
    interactionCount: 0,
    transactionCount: 0,
    importCount: 0,
    attentionCount: 0,
  });

  result = await responseJson(await api(database, "/api/admin/crm/integrations", {
    env: {
      ...SQUARE_SYNC_ENV,
      SHOPIFY_STORE_DOMAIN: "construct-test.myshopify.com",
      SHOPIFY_ADMIN_ACCESS_TOKEN: "shopify-test-token",
      BEEHIIV_API_KEY: "beehiiv-test-key",
      BEEHIIV_PUBLICATION_IDS: "publication-one,publication-two",
    },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.readyCount, 4);
  assert.ok(result.payload.providers.every((provider) => provider.ready));
  const square = result.payload.providers.find((provider) => provider.id === "square");
  assert.deepEqual(square.details.configuredLocations, ["tattoo"]);
  assert.equal(square.lastSync, null);
  const serialized = JSON.stringify(result.payload);
  assert.equal(serialized.includes("square-test-token"), false);
  assert.equal(serialized.includes("shopify-test-token"), false);
  assert.equal(serialized.includes("beehiiv-test-key"), false);
});

test("Square sync persists normalized CRM records and repeats idempotently", async (t) => {
  const database = migratedDatabase();
  const calls = installSquareApiMock(t, {
    payments: [{
      id: "square-payment-new",
      status: "COMPLETED",
      customer_id: "square-customer-new",
      order_id: "square-order-new",
      location_id: "square-tattoo-location",
      buyer_email_address: "square.friend@example.com",
      total_money: { amount: 18_500, currency: "USD" },
      tip_money: { amount: 3_000, currency: "USD" },
      refunded_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Tattoo session 422",
      receipt_url: "https://square.example/receipt/new",
      created_at: "2026-07-10T15:00:00.000Z",
      updated_at: "2026-07-10T15:01:00.000Z",
    }],
  });

  let result = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.provider, "square");
  assert.equal(result.payload.status, "complete");
  assert.equal(result.payload.stats.pages, 2);
  assert.equal(result.payload.stats.accepted, 1);
  assert.deepEqual(result.payload.stats.persistence, {
    interactions: 1,
    transactions: 1,
    unmatched: 0,
    overlapsSkipped: 0,
  });
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    ["/v2/payments", "/v2/refunds"],
  );

  const person = database.prepare("SELECT * FROM crm_people").get();
  assert.equal(person.display_name, "square.friend@example.com");
  assert.equal(person.preferred_contact_method, "email");
  assert.deepEqual(
    database.prepare(`
      SELECT kind,value,normalized_value,provider,external_id
      FROM crm_identities WHERE person_id=? ORDER BY kind
    `).all(person.id).map((row) => ({ ...row })),
    [
      {
        kind: "email",
        value: "square.friend@example.com",
        normalized_value: "square.friend@example.com",
        provider: "square",
        external_id: null,
      },
      {
        kind: "square_customer",
        value: "square-customer-new",
        normalized_value: "square-customer-new",
        provider: "square",
        external_id: "square-customer-new",
      },
    ],
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT person_id,node_id,channel,interaction_type,label,status,
        source_provider,source_type,source_id
      FROM crm_interactions
    `).get() },
    {
      person_id: person.id,
      node_id: "node-tattoos",
      channel: "square",
      interaction_type: "payment",
      label: "Tattoo session 422",
      status: "settled",
      source_provider: "square",
      source_type: "payment",
      source_id: "square-payment-new",
    },
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT person_id,node_id,transaction_type,status,amount_cents,tip_cents,
        currency,source_provider,source_type,source_id,external_customer_id,
        external_order_id
      FROM crm_transactions
    `).get() },
    {
      person_id: person.id,
      node_id: "node-tattoos",
      transaction_type: "charge",
      status: "settled",
      amount_cents: 18_500,
      tip_cents: 3_000,
      currency: "USD",
      source_provider: "square",
      source_type: "payment",
      source_id: "square-payment-new",
      external_customer_id: "square-customer-new",
      external_order_id: "square-order-new",
    },
  );

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.netSpendCents, 18_500);
  assert.equal(result.payload.person.tipCents, 3_000);

  result = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.status, "complete");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_identities").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 1);
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    ["/v2/payments", "/v2/refunds", "/v2/payments", "/v2/refunds"],
  );

  result = await responseJson(await api(database, "/api/admin/crm/sync/status", {
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(result.response.status, 200);
  const status = result.payload.providers.find((provider) => provider.id === "square");
  assert.equal(status.lastSync.status, "complete");
  assert.equal(status.lastSync.stats.accepted, 1);
  assert.equal(result.payload.local.peopleCount, 1);
  assert.equal(result.payload.local.interactionCount, 1);
  assert.equal(result.payload.local.transactionCount, 1);
});

test("Square sync recognizes a local providerPaymentId mirror without double-counting spend", async (t) => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Already Paid Client",
    email: "already-paid@example.com",
  });
  const now = "2026-07-11T16:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,note,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'local-mirrored-transaction',?,'node-tattoos','charge','settled',
      22000,4000,'USD',?,'local','appointment_payment','appointment-22',
      'Settled appointment payment',?,1,?,?
    )
  `).run(
    person.id,
    now,
    JSON.stringify({ providerPaymentId: "square-payment-mirrored" }),
    now,
    now,
  );

  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-mirrored",
      status: "COMPLETED",
      customer_id: "square-customer-mirrored",
      order_id: "square-order-mirrored",
      location_id: "square-tattoo-location",
      buyer_email_address: "already-paid@example.com",
      total_money: { amount: 22_000, currency: "USD" },
      tip_money: { amount: 4_000, currency: "USD" },
      source_type: "CARD",
      reference_id: "Mirrored appointment payment",
      created_at: now,
      updated_at: now,
    }],
  });

  let result = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.status, "complete");
  assert.deepEqual(result.payload.stats.persistence, {
    interactions: 1,
    transactions: 0,
    unmatched: 0,
    overlapsSkipped: 1,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions WHERE source_provider='square'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='square' AND source_id='square-payment-mirrored'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='square'
  `).get(person.id).count, 1);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.settledGrossCents, 22_000);
  assert.equal(result.payload.person.netSpendCents, 22_000);
  assert.equal(result.payload.person.tipCents, 4_000);
});
