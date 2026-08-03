import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { handleAdminCrmApi } from "../functions/api/crm/_lib.js";
import { ingestCrmSourceRecord } from "../functions/api/crm/ingest.js";
import {
  captureMarketingConsent,
  handleAdminOutreachApi,
} from "../functions/api/outreach/_lib.js";
import {
  handleAdminEventTicketCancel,
  handleEventCheckout,
  handleEventOpenMicSignup,
  handleEventWaitlist,
  handleEventsSquareWebhook,
  reapStalePendingTickets,
} from "../functions/api/events/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "crm-contract-token";

function peopleActivityRenderer() {
  const source = readFileSync(join(ROOT, "studio", "people-manager.js"), "utf8")
    .replace(
      "  window.PeopleManager = {",
      "  window.__activityRecords = activityRecords;\n  window.PeopleManager = {",
    );
  const window = {};
  const document = { getElementById: () => null };
  runInNewContext(source, {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
    Map,
    Set,
    URL,
    Blob,
    FormData,
    Headers,
    AbortController,
    fetch: async () => new Response(),
    localStorage: { getItem: () => "" },
    confirm: () => false,
    alert: () => {},
  });
  return window.__activityRecords;
}

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
    this.batchQueue = Promise.resolve();
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    const execute = async () => {
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
    };
    const result = this.batchQueue.then(execute, execute);
    this.batchQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function migratedDatabase(throughMigration = "") {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    if (throughMigration && migration > throughMigration) break;
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

async function outreachApi(database, path, options = {}) {
  return handleAdminOutreachApi(
    request(path, { ...options, admin: options.admin ?? true }),
    env(database, options.env),
  );
}

async function responseJson(response) {
  const payload = await response.json();
  return { response, payload };
}

async function withMockFetch(mockFetch, action) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function eventsWebhookSignature(rawBody, signatureKey, notificationUrl) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${notificationUrl}${rawBody}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function addSquareCustomerIdentity(database, personId, externalId) {
  const now = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,
      source_provider,source_type,source_id,created_at,updated_at
    ) VALUES(
      ?,?,'square_customer',?,?,'square',?,
      'square','provider_contact',?,?,?
    )
  `).run(
    `test-square-identity-${externalId}`,
    personId,
    externalId,
    externalId,
    externalId,
    `square:${externalId}`,
    now,
    now,
  );
}

test("People directory SQL avoids D1-incompatible correlated sort expressions", () => {
  const source = readFileSync(join(ROOT, "functions", "api", "crm", "_lib.js"), "utf8");
  assert.doesNotMatch(source, /ORDER BY\s+\(i\.person_id\s*=\s*p\.id\)/);
  assert.match(source, /COALESCE\(\s*\(SELECT i\.value FROM crm_identities i/);
});

test("People UI gives canonical Construct nodes their source colors", () => {
  const source = readFileSync(join(ROOT, "studio", "people-manager.js"), "utf8");
  const styles = readFileSync(join(ROOT, "studio", "people-manager.css"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const expectedNodes = [
    ["node-tattoos", "--color-tattooing", "#6E0404"],
    ["node-art", "--color-art", "#0039BD"],
    ["node-merch", "--color-merch", "#F08000"],
    ["node-about", "--color-about", "#FCB467"],
    ["node-events", "--color-events", "#005D25"],
    ["node-music", "--color-music", "#A22F8D"],
    ["node-writings", "--color-writings", "#FFE7CA"],
    ["node-archive", "--color-archive", "#6D3D15"],
    ["node-film", "--color-film", "#00857A"],
    ["node-legend", "--color-about", "#FCB467"],
  ];

  assert.match(source, /function canonicalNodeId/);
  assert.match(source, /function nodeChip/);
  assert.match(source, /function emptyState/);
  assert.match(source, /nodeChips\(nodes, \{ limit: 3 \}\)/);
  assert.match(source, /nodeChips\(totals\.nodes\)/);
  assert.match(source, /function activityNodeId/);
  for (const [nodeId, token, fallback] of expectedNodes) {
    assert.ok(source.includes(`["${nodeId}", "${nodeId}"]`));
    assert.ok(styles.includes(`[data-people-node="${nodeId}"]`));
    assert.ok(styles.includes(`var(${token},${fallback})`));
  }
  assert.match(styles, /\.people-record\[data-people-node\]/);
  assert.match(studio, /people-manager\.css\?v=4/);
  assert.match(studio, /people-manager\.js\?v=11/);
  assert.match(source, /data-delete-person/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.doesNotMatch(source, /A rationale is required/);
  assert.match(source, /<span>Next interaction<\/span><strong>\$\{esc\(interactionDates\.next \? formatDate\(interactionDates\.next\) : "NONE"\)\}<\/strong>/);
  const directoryRenderer = source.slice(
    source.indexOf("function renderPeopleList"),
    source.indexOf("async function selectPerson"),
  );
  assert.doesNotMatch(directoryRenderer, /updatedAt|updated_at/);
  assert.match(directoryRenderer, /Last \$\{esc\(formatDate\(last\)\)\} · Next \$\{esc\(next \? formatDate\(next\) : "NONE"\)\}/);
});

test("Studio console titles follow the active Construct node at hero weight", () => {
  const styles = readFileSync(join(ROOT, "studio", "console-titles.css"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const expectedTabs = [
    ["tattoo", "--color-tattooing", "#6E0404"],
    ["art", "--color-art", "#0039BD"],
    ["merch", "--color-merch", "#F08000"],
    ["events", "--color-events", "#005D25"],
    ["archive", "--color-archive", "#6D3D15"],
  ];

  assert.match(studio, /console-titles\.css\?v=1/);
  assert.match(studio, /<body class="studio-console">/);
  assert.match(styles, /--console-title-color:var\(--accent\)/);
  assert.match(styles, /font-weight:900/);
  assert.match(styles, /\.studio-console \.tab\.is-active/);
  for (const [tab, token, fallback] of expectedTabs) {
    assert.ok(styles.includes(`.tab[data-tab="${tab}"].is-active`));
    assert.ok(styles.includes(`var(${token},${fallback})`));
  }
});

test("People UI separates contacts, system links, activities, and money", () => {
  const source = readFileSync(join(ROOT, "studio", "people-manager.js"), "utf8");
  const addContactSource = source.slice(
    source.indexOf("function addIdentityForm"),
    source.indexOf("function addInteractionForm"),
  );

  assert.match(source, /CONTACT_IDENTITY_KINDS = new Set\(\["email", "phone", "instagram"\]\)/);
  assert.match(source, /identityRecords\(contactIdentities\)/);
  assert.match(source, /systemLinkRecords\(systemLinks\)/);
  assert.match(source, /data-admin-section-title="System links" data-admin-default="closed"/);
  assert.match(source, /activityRecords\(interactions, attendance\)/);
  assert.doesNotMatch(source, /activityRecords\(interactions, transactions, attendance\)/);
  assert.match(source, /moneyRecords\(transactions\)/);
  assert.match(addContactSource, /\["email", "Email"\]/);
  assert.match(addContactSource, /\["phone", "Phone"\]/);
  assert.match(addContactSource, /\["instagram", "Instagram"\]/);
  assert.doesNotMatch(addContactSource, /shopify_customer|square_customer|beehiiv_subscription|substack_subscriber/);
});

test("People UI groups customer-facing Construct milestones by node", () => {
  const renderActivity = peopleActivityRenderer();
  const appointment = {
    source_provider: "local",
    source_type: "appointment",
    source_id: "appointment-1",
    interaction_type: "appointment",
    node_id: "node-tattoos",
    label: "Half Session",
    status: "confirmed",
    occurred_at: "2026-08-01T15:00:00.000Z",
    metadata: { submissionId: "submission-1" },
  };
  const html = renderActivity([
    {
      source_provider: "local",
      source_type: "submission",
      source_id: "submission-1",
      interaction_type: "tattoo_inquiry",
      node_id: "node-tattoos",
      label: "<Dragon inquiry>",
      status: "new",
      occurred_at: "2026-07-01T15:00:00.000Z",
    },
    appointment,
    { ...appointment },
    {
      source_provider: "shopify",
      source_type: "order",
      source_id: "order-1",
      interaction_type: "merch_order",
      node_id: "node-merch",
      label: "#1001",
      status: "paid",
      quantity: 2,
      occurred_at: "2026-07-10T15:00:00.000Z",
    },
    {
      source_provider: "local",
      source_type: "event_ticket",
      source_id: "ticket-1",
      interaction_type: "event_ticket_purchase",
      node_id: "node-events",
      label: "Cult & Shift",
      status: "paid",
      quantity: 2,
      occurred_at: "2026-07-12T15:00:00.000Z",
      metadata: { eventId: "event-1", ticketId: "ticket-1" },
    },
    {
      source_provider: "beehiiv",
      source_type: "newsletter",
      source_id: "newsletter-1",
      interaction_type: "newsletter_signup",
      label: "Newsletter",
      status: "subscribed",
      occurred_at: "2026-07-13T15:00:00.000Z",
    },
    {
      source_provider: "square",
      source_type: "deposit_payment",
      source_id: "payment-1",
      interaction_type: "payment",
      node_id: "node-tattoos",
      label: "Deposit payment",
      status: "settled",
      occurred_at: "2026-07-14T15:00:00.000Z",
    },
    {
      source_provider: "manual",
      source_type: "interaction",
      source_id: "manual-1",
      interaction_type: "collaboration",
      label: "Studio planning call",
      status: "completed",
      occurred_at: "2026-07-15T15:00:00.000Z",
    },
  ], [{
    id: "attendance-1",
    event_id: "event-1",
    event_ticket_id: "ticket-1",
    status: "checked_in",
    checked_in_at: "2026-07-20T15:00:00.000Z",
  }]);

  assert.equal((html.match(/class="people-activity-card"/g) || []).length, 4);
  assert.equal((html.match(/class="people-activity-milestone"/g) || []).length, 6);
  assert.match(html, /data-people-node="node-tattoos"[\s\S]*Inquired[\s\S]*Booked/);
  assert.match(html, /&lt;Dragon inquiry&gt;/);
  assert.match(html, /data-people-node="node-merch"[\s\S]*Ordered[\s\S]*#1001[\s\S]*2 items/);
  assert.match(html, /data-people-node="node-events"[\s\S]*Ticketed[\s\S]*Cult &amp; Shift[\s\S]*2 tickets[\s\S]*Attended/);
  assert.match(html, /data-people-activity-node="studio"[\s\S]*Studio planning call/);
  assert.doesNotMatch(html, /Newsletter|Deposit payment|shopify|square|beehiiv/i);
  assert.doesNotMatch(html, /\bpaid\b/i);
});

test("People UI normalizes appointment lifecycle states and keeps empty activity quiet", () => {
  const renderActivity = peopleActivityRenderer();
  const appointment = (id, status, occurredAt, metadata = {}) => ({
    source_type: "appointment",
    source_id: id,
    interaction_type: "appointment",
    node_id: "node-tattoos",
    label: `${id} appointment`,
    status,
    occurred_at: occurredAt,
    metadata,
  });
  const html = renderActivity([
    appointment("pending", "deposit_pending", "2026-07-01T15:00:00.000Z"),
    appointment("booked", "confirmed", "2026-07-02T15:00:00.000Z"),
    appointment("completed", "completed", "2026-07-03T15:00:00.000Z"),
    appointment("cancelled", "cancelled", "2026-07-04T15:00:00.000Z"),
    appointment("rescheduled", "confirmed", "2026-07-05T15:00:00.000Z", { rescheduleCount: 1 }),
    appointment("no-show", "no_show", "2026-07-06T15:00:00.000Z"),
  ], []);

  for (const label of ["Booking started", "Booked", "Completed", "Cancelled", "Rescheduled", "No-show"]) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/class="people-activity-card"/g) || []).length, 1);

  const empty = renderActivity([{
    source_type: "newsletter",
    source_id: "newsletter-only",
    interaction_type: "newsletter_signup",
    status: "subscribed",
  }], []);
  assert.match(empty, /No Construct activity yet/);
  assert.doesNotMatch(empty, /people-activity-card/);
});

test("outreach consent capture is email-only and replay-safe", async () => {
  const database = migratedDatabase();
  const runtime = env(database);
  const firstCapture = await captureMarketingConsent(runtime, {
    email: "updates@example.test",
    phone: "(404) 555-0123",
    emailOptIn: "yes",
    source: "submission_form",
    sourceId: "submission-consent-1",
    formPath: "/tattoos/inquire/custom/",
    occurredAt: "2026-07-18T14:00:00.000Z",
  });
  assert.equal(firstCapture.email.recorded, true);
  assert.equal(firstCapture.sms, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.deepEqual(
    database.prepare("SELECT channel,status FROM crm_consent_events ORDER BY channel").all()
      .map((row) => ({ channel: row.channel, status: row.status })),
    [{ channel: "email", status: "pending" }],
  );

  const replay = await captureMarketingConsent(runtime, {
    email: "updates@example.test",
    phone: "+1 404 555 0123",
    emailOptIn: true,
    source: "submission_form",
    sourceId: "submission-consent-1",
    formPath: "/tattoos/inquire/custom/",
  });
  assert.equal(replay.email.replayed, true);
  assert.equal(replay.sms, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_consent_events").get().count, 1);
});

test("audience preview requires consent, provider confirmation, valid contact, and no suppression", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Outreach Customer",
    email: "outreach@example.test",
    phone: "404-555-0199",
  });
  let result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/interactions`, {
    method: "POST",
    body: {
      interactionType: "appointment",
      nodeId: "node-tattoos",
      channel: "website",
      label: "Booked session",
      status: "completed",
      occurredAt: "2026-07-18T15:00:00.000Z",
    },
  }));
  assert.equal(result.response.status, 201);

  result = await responseJson(await outreachApi(database, `/api/admin/crm/outreach/people/${person.id}/consents`, {
    method: "POST",
    body: {
      channel: "sms",
      sourceMethod: "in_person",
      value: "404-555-0199",
      consentAt: "2026-07-18T15:05:00.000Z",
      confirmed: true,
      requestId: "manual-sms-consent-1",
    },
  }));
  assert.equal(result.response.status, 400, JSON.stringify(result.payload));
  assert.match(result.payload.error, /read-only/i);

  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/audience/preview", {
    method: "POST",
    body: { channel: "sms" },
  }));
  assert.equal(result.response.status, 400);

  result = await responseJson(await outreachApi(database, `/api/admin/crm/outreach/people/${person.id}/consents`, {
    method: "POST",
    body: {
      channel: "email",
      sourceMethod: "paper",
      value: "outreach@example.test",
      consentAt: "2026-07-18T15:06:00.000Z",
      confirmed: true,
      requestId: "manual-email-consent-1",
    },
  }));
  assert.equal(result.response.status, 201);
  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/audience/preview", {
    method: "POST",
    body: { channel: "email" },
  }));
  assert.equal(result.payload.eligibleCount, 0);
  assert.equal(result.payload.exclusions.pending_confirmation, 1);

  const now = "2026-07-18T15:10:00.000Z";
  database.prepare(`
    INSERT INTO crm_marketing_subscriptions(
      id,person_id,provider,publication_id,external_id,email,status,
      subscribed_at,last_synced_at,created_at,updated_at
    ) VALUES('sub-confirmed',?,'beehiiv','pub_test','bee-sub-1',?,'subscribed',?,?,?,?)
  `).run(person.id, "outreach@example.test", now, now, now, now);
  database.prepare(`
    INSERT INTO crm_consent_events(
      id,person_id,channel,purpose,status,normalized_value,source,provider,
      provider_reference,occurred_at,created_at
    ) VALUES('email-confirmed',?,'email','newsletter','granted',?,'beehiiv_confirmation',
      'beehiiv','bee-confirmed-1',?,?)
  `).run(person.id, "outreach@example.test", now, now);
  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/audience/preview", {
    method: "POST",
    body: { channel: "email" },
  }));
  assert.equal(result.payload.eligibleCount, 1);

  database.prepare(`
    INSERT INTO crm_suppressions(
      id,person_id,identity_kind,normalized_value,reason,provider,active,created_at,updated_at
    ) VALUES('email-suppression',?,'email',?,'unsubscribe','beehiiv',1,?,?)
  `).run(person.id, "outreach@example.test", now, now);
  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/audience/preview", {
    method: "POST",
    body: { channel: "email" },
  }));
  assert.equal(result.payload.eligibleCount, 0);
  assert.equal(result.payload.exclusions.suppressed, 1);
});

test("automated SMS remains unavailable while person deletion preserves legacy opt-out evidence", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Deletion Outreach Customer",
    email: "deletion-outreach@example.test",
    phone: "404-555-0177",
  });
  let result = await responseJson(await outreachApi(database, `/api/admin/crm/outreach/people/${person.id}/consents`, {
    method: "POST",
    body: {
      channel: "sms",
      sourceMethod: "phone",
      value: "404-555-0177",
      consentAt: "2026-07-18T16:00:00.000Z",
      confirmed: true,
      requestId: "delete-sms-consent",
    },
  }));
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /read-only/i);

  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/campaigns", {
    method: "POST",
    body: { name: "Consent drift", channel: "sms", bodyText: "A reviewed update." },
  }));
  assert.equal(result.response.status, 400);

  const now = "2026-07-18T16:05:00.000Z";
  database.prepare(`
    INSERT INTO crm_consent_events(
      id,person_id,channel,purpose,status,normalized_value,source,provider,
      provider_reference,occurred_at,created_at
    ) VALUES('legacy-sms-consent',?,'sms','marketing','revoked',?,'legacy_import',
      'twilio','legacy-sms-consent',?,?)
  `).run(person.id, "+14045550177", now, now);
  database.prepare(`
    INSERT INTO crm_suppressions(
      id,person_id,identity_kind,normalized_value,reason,provider,active,created_at,updated_at
    ) VALUES('sms-suppression',?,'phone',?,'STOP','twilio',1,?,?)
  `).run(person.id, "+14045550177", now, now);
  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "DELETE",
    body: { confirmDisplayName: "Deletion Outreach Customer" },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT person_id FROM crm_consent_events LIMIT 1").get().person_id, null);
  assert.equal(database.prepare("SELECT person_id FROM crm_suppressions LIMIT 1").get().person_id, null);
  assert.equal(database.prepare("SELECT active FROM crm_suppressions LIMIT 1").get().active, 1);
});

test("individual follow-up email completes its task only after provider acceptance and replays idempotently", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Follow-up Customer",
    email: "followup@example.test",
  });
  let result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/interactions`, {
    method: "POST",
    body: {
      interactionType: "appointment",
      nodeId: "node-tattoos",
      channel: "website",
      label: "Completed appointment",
      status: "completed",
      occurredAt: "2026-07-18T17:00:00.000Z",
    },
  }));
  assert.equal(result.response.status, 201);
  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/followups`, {
    method: "POST",
    body: {
      action: "Check healed work",
      dueAt: "2026-07-19T17:00:00.000Z",
      priority: "normal",
    },
  }));
  assert.equal(result.response.status, 201);
  const followupId = result.payload.followup.id;

  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/followups/preview", {
    method: "POST",
    body: { personId: person.id, channel: "email" },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.eligible, true);
  assert.equal(result.payload.destination, "followup@example.test");

  let sends = 0;
  const outreachEnv = {
    OUTREACH_INDIVIDUAL_EMAIL_ENABLED: "true",
    EMAIL: {
      async send(message) {
        sends += 1;
        assert.equal(message.to, "followup@example.test");
        assert.match(message.html, /art\.pill TATTOO HOUSE/);
        assert.match(message.html, /Inbox preview for the healed-work note/);
        assert.match(message.text, /Reply if you would like me/);
        return { messageId: "email-message-1" };
      },
    },
  };
  const sendBody = {
    personId: person.id,
    channel: "email",
    followupId,
    subject: "How is everything healing?",
    preheader: "Inbox preview for the healed-work note",
    emailTheme: "tattoo",
    bodyText: "Reply if you would like me to look at anything.",
    requestId: "followup-request-1",
  };
  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/followups/send", {
    method: "POST",
    body: sendBody,
    env: outreachEnv,
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.communication.status, "accepted");
  assert.equal(result.payload.communication.preheader, sendBody.preheader);
  assert.equal(result.payload.communication.email_theme, "tattoo");
  assert.equal(database.prepare("SELECT status FROM crm_followups WHERE id=?").get(followupId).status, "done");
  assert.equal(sends, 1);

  result = await responseJson(await outreachApi(database, "/api/admin/crm/outreach/followups/send", {
    method: "POST",
    body: sendBody,
    env: outreachEnv,
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.replayed, true);
  assert.equal(sends, 1);
});

test("public customer forms collect the optional People profile answers", () => {
  const formFiles = [
    ["tattoos", "inquire", "custom", "index.html"],
    ["tattoos", "flash", "claim", "index.html"],
    ["tattoos", "special-projects", "apply", "index.html"],
    ["tattoos", "inquire", "consultation", "index.html"],
    ["tattoos", "build", "in-person", "index.html"],
    ["booking", "studio", "index.html"],
    ["booking", "studio-visit", "index.html"],
    ["art", "acquisitioninquiry.html"],
    ["events", "cultandshift", "index.html"],
    ["events", "signal-symbol", "index.html"],
  ];
  for (const parts of formFiles) {
    const source = readFileSync(join(ROOT, ...parts), "utf8");
    for (const field of [
      "preferred_name",
      "pronouns",
      "instagram",
      "preferred_contact_method",
      "referral_source",
    ]) {
      assert.match(source, new RegExp(`name=[\"']${field}[\"']`), `${parts.join("/")} is missing ${field}`);
    }
  }
});

function installSquareApiMock(testContext, {
  payments = [],
  refunds = [],
  customers = [],
  customerLookupStatus = 200,
  customerLookupPayload = null,
} = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init.headers);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({
      url,
      method,
      headers,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });

    assert.equal(url.origin, "https://connect.squareup.com");
    assert.equal(headers.get("authorization"), "Bearer square-test-token");
    assert.equal(headers.get("square-version"), "2026-05-20");

    if (url.pathname === "/v2/payments") {
      assert.equal(method, "GET");
      assert.equal(url.searchParams.get("location_id"), "square-tattoo-location");
      return Response.json({ payments });
    }
    if (url.pathname === "/v2/refunds") {
      assert.equal(method, "GET");
      assert.equal(url.searchParams.get("location_id"), "square-tattoo-location");
      return Response.json({ refunds });
    }
    if (url.pathname === "/v2/customers/bulk-retrieve") {
      assert.equal(method, "POST");
      const customerIds = calls.at(-1).body?.customer_ids;
      assert.ok(Array.isArray(customerIds));
      assert.ok(customerIds.length > 0);
      assert.ok(customerIds.length <= 100);
      const payload = customerLookupPayload || (
        customerLookupStatus === 200
          ? {
              responses: Object.fromEntries(
                customers
                  .filter((customer) => customer?.id)
                  .map((customer) => [customer.id, { customer }]),
              ),
            }
          : { errors: [{ code: "FORBIDDEN", detail: "Customer lookup unavailable." }] }
      );
      return Response.json(payload, { status: customerLookupStatus });
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

test("live source ingestion is idempotent and advances pending activity to settled", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const base = {
    contact: {
      displayName: "Live Booking Client",
      email: "LIVE@example.test",
      phone: "(404) 555-0188",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "live-appointment-1",
      nodeId: "node-tattoos",
      channel: "website",
      interactionType: "appointment",
      label: "Half Session",
      status: "deposit_pending",
      occurredAt: "2026-08-01T15:00:00.000Z",
      metadata: { appointmentId: "live-appointment-1" },
    },
    transaction: {
      sourceProvider: "local",
      sourceType: "deposit_payment",
      sourceId: "live-payment-1",
      nodeId: "node-tattoos",
      transactionType: "charge",
      status: "pending",
      amountCents: 15000,
      tipCents: 5000,
      currency: "USD",
      occurredAt: "2026-07-17T15:00:00.000Z",
      externalOrderId: "square-order-live-1",
      metadata: { appointmentId: "live-appointment-1" },
    },
  };

  const first = await ingestCrmSourceRecord(d1, base);
  assert.equal(first.status, "applied");
  assert.equal(first.match, "new");
  assert.equal(first.createdPerson, true);

  const replay = await ingestCrmSourceRecord(d1, {
    ...base,
    interaction: { ...base.interaction, status: "confirmed" },
    transaction: { ...base.transaction, status: "settled" },
  });
  assert.equal(replay.status, "applied");
  assert.equal(replay.match, "source");
  assert.equal(replay.personId, first.personId);

  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_people WHERE id=?"
  ).get(first.personId).count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_identities WHERE person_id=? AND kind='email' AND active=1"
  ).get(first.personId).count, 1);
  assert.deepEqual(
    { ...database.prepare(
      "SELECT person_id,status FROM crm_interactions WHERE source_provider='local' AND source_type='appointment' AND source_id='live-appointment-1'"
    ).get() },
    { person_id: first.personId, status: "confirmed" },
  );
  assert.deepEqual(
    { ...database.prepare(
      "SELECT person_id,status,amount_cents,tip_cents FROM crm_transactions WHERE source_provider='local' AND source_type='deposit_payment' AND source_id='live-payment-1'"
    ).get() },
    {
      person_id: first.personId,
      status: "settled",
      amount_cents: 15000,
      tip_cents: 5000,
    },
  );
});

test("Studio can permanently delete a person without old source replays recreating them", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const source = {
    contact: {
      displayName: "Delete Me",
      email: "delete-me@example.test",
      phone: "(404) 555-0177",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "delete-appointment-1",
      nodeId: "node-tattoos",
      interactionType: "appointment",
      label: "Website appointment",
      status: "confirmed",
      occurredAt: "2026-08-01T15:00:00.000Z",
    },
    transaction: {
      sourceProvider: "local",
      sourceType: "deposit_payment",
      sourceId: "delete-payment-1",
      nodeId: "node-tattoos",
      transactionType: "charge",
      status: "settled",
      amountCents: 15000,
      currency: "USD",
      occurredAt: "2026-07-17T15:00:00.000Z",
    },
  };
  const created = await ingestCrmSourceRecord(d1, source);
  assert.equal(created.status, "applied");
  assert.equal(created.createdPerson, true);

  let result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${created.personId}`,
    {
      method: "PATCH",
      body: { tags: ["deletion-test"], summary: "CRM-only context" },
    },
  ));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${created.personId}/notes`,
    {
      method: "POST",
      body: { body: "Remove this note.", category: "relationship" },
    },
  ));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));

  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${created.personId}`,
    {
      method: "DELETE",
      body: { confirmDisplayName: "Wrong name" },
    },
  ));
  assert.equal(result.response.status, 400);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_people WHERE id=?"
  ).get(created.personId).count, 1);

  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${created.personId}`,
    {
      method: "DELETE",
      body: { confirmDisplayName: "Delete Me" },
    },
  ));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.deleted, true);
  for (const table of [
    "crm_people",
    "crm_identities",
    "crm_interactions",
    "crm_transactions",
    "crm_notes",
    "crm_person_tags",
    "crm_audit_events",
  ]) {
    assert.equal(
      database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,
      0,
      `${table} should be empty after deletion`,
    );
  }
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_tags"
  ).get().count, 0);
  assert.deepEqual(
    database.prepare(`
      SELECT source_type,source_id
      FROM crm_deleted_person_sources
      ORDER BY source_type,source_id
    `).all().map((row) => [row.source_type, row.source_id]),
    [
      ["appointment", "delete-appointment-1"],
      ["deposit_payment", "delete-payment-1"],
    ],
  );

  const replay = await ingestCrmSourceRecord(d1, source);
  assert.deepEqual(
    { status: replay.status, reason: replay.reason, personId: replay.personId },
    { status: "skipped", reason: "person_deleted", personId: null },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);

  const newBooking = await ingestCrmSourceRecord(d1, {
    ...source,
    interaction: {
      ...source.interaction,
      sourceId: "delete-appointment-2",
      occurredAt: "2026-09-01T15:00:00.000Z",
    },
    transaction: undefined,
  });
  assert.equal(newBooking.status, "applied");
  assert.equal(newBooking.createdPerson, true);
  assert.notEqual(newBooking.personId, created.personId);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
});

test("live identity conflicts remain visible in Needs Attention until a clean replay", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const source = {
    contact: {
      displayName: "Original Booking Client",
      email: "original-booking@example.test",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "attention-booking-1",
      nodeId: "node-tattoos",
      interactionType: "appointment",
      status: "confirmed",
    },
  };
  const original = await ingestCrmSourceRecord(d1, source);
  assert.equal(original.status, "applied");
  await createPerson(database, {
    displayName: "Different Email Owner",
    email: "different-owner@example.test",
  });

  const conflicted = await ingestCrmSourceRecord(d1, {
    ...source,
    contact: {
      displayName: "Original Booking Client",
      email: "different-owner@example.test",
    },
  });
  assert.equal(conflicted.personId, original.personId);
  assert.equal(conflicted.status, "needs_review");
  assert.ok(conflicted.warnings.includes("email_owned_by_another_person"));

  let attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  assert.equal(attention.response.status, 200);
  assert.equal(attention.payload.summary.unmatchedInteractions, 1);
  assert.equal(attention.payload.unmatchedInteractions[0].source_type, "crm_ingest_conflict");
  const metadata = JSON.parse(attention.payload.unmatchedInteractions[0].metadata_json);
  assert.deepEqual(metadata.conflicts, ["email_owned_by_another_person"]);
  assert.deepEqual(metadata.source, {
    provider: "local",
    type: "appointment",
    id: "attention-booking-1",
  });
  assert.equal(JSON.stringify(metadata).includes("different-owner@example.test"), false);

  const clean = await ingestCrmSourceRecord(d1, source);
  assert.equal(clean.status, "applied");
  attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  assert.equal(attention.payload.summary.unmatchedInteractions, 0);
});

test("live ingestion recognizes a provider transaction that arrived before its booking mirror", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Provider First Client",
    email: "provider-first@example.test",
  });
  const occurredAt = "2026-07-17T15:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      external_order_id,note,metadata_json,active,created_at,updated_at
    ) VALUES(
      'square-provider-first',?,'node-tattoos','charge','settled',15000,0,
      'USD',?,'square','payment','square-payment-provider-first',
      'square-order-provider-first','Square payment','{}',1,?,?
    )
  `).run(person.id, occurredAt, occurredAt, occurredAt);

  const result = await ingestCrmSourceRecord(new LocalD1(database), {
    contact: {
      displayName: "Provider First Client",
      email: "provider-first@example.test",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "appointment-provider-first",
      nodeId: "node-tattoos",
      interactionType: "appointment",
      status: "confirmed",
      occurredAt,
    },
    transaction: {
      sourceProvider: "local",
      sourceType: "deposit_payment",
      sourceId: "deposit-provider-first",
      nodeId: "node-tattoos",
      transactionType: "charge",
      status: "settled",
      amountCents: 15000,
      currency: "USD",
      occurredAt,
      externalOrderId: "square-order-provider-first",
      metadata: { providerPaymentId: "square-payment-provider-first" },
    },
  });

  assert.equal(result.status, "applied");
  assert.equal(result.personId, person.id);
  assert.equal(result.match, "provider_transaction");
  assert.equal(result.transactionOverlap, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions WHERE source_provider='local'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='local'
      AND external_id='deposit_payment:deposit-provider-first'
  `).get(person.id).count, 1);
});

test("live source ingestion skips cleanly before the CRM schema exists", async () => {
  const database = new DatabaseSync(":memory:");
  const result = await ingestCrmSourceRecord(new LocalD1(database), {
    contact: { displayName: "Pre-migration Client", email: "pre@example.test" },
    interaction: {
      sourceProvider: "local",
      sourceType: "submission",
      sourceId: "pre-migration-submission",
      interactionType: "tattoo_inquiry",
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "schema_unavailable");
});

test("noncustomer sources cannot create People but may enrich an eligible customer", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const excluded = [
    ["submission", "tattoo_inquiry", "new"],
    ["event_waitlist", "event_waitlist", "waiting"],
    ["event_open_mic", "open_mic_request", "pending"],
    ["newsletter", "newsletter_signup", "subscribed"],
    ["event_ticket", "event_ticket", "pending"],
    ["square_payment", "payment", "settled"],
  ];
  for (const [sourceType, interactionType, status] of excluded) {
    const result = await ingestCrmSourceRecord(d1, {
      contact: {
        displayName: `Excluded ${sourceType}`,
        email: `${sourceType}@example.test`,
      },
      interaction: {
        sourceProvider: sourceType === "square_payment" ? "square" : "local",
        sourceType,
        sourceId: `excluded-${sourceType}`,
        interactionType,
        status,
      },
    });
    assert.deepEqual(
      { status: result.status, reason: result.reason },
      { status: "skipped", reason: "not_directory_eligible" },
    );
  }
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 0);

  const booking = await ingestCrmSourceRecord(d1, {
    contact: {
      displayName: "Eligible Site Client",
      email: "eligible-site-client@example.test",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "eligible-site-appointment",
      interactionType: "appointment",
      status: "cancelled",
    },
  });
  assert.equal(booking.status, "applied");
  const newsletter = await ingestCrmSourceRecord(d1, {
    contact: {
      displayName: "Eligible Site Client",
      email: "eligible-site-client@example.test",
      phone: "(404) 555-0198",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "newsletter",
      sourceId: "eligible-client-newsletter",
      interactionType: "newsletter_signup",
      status: "subscribed",
    },
  });
  assert.equal(newsletter.status, "applied");
  assert.equal(newsletter.personId, booking.personId);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT eligibility_reason,eligibility_source_type
      FROM crm_people WHERE id=?
    `).get(booking.personId) },
    {
      eligibility_reason: "website_booking",
      eligibility_source_type: "appointment",
    },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_interactions WHERE person_id=?"
  ).get(booking.personId).count, 2);

  const manual = await createPerson(database, {
    displayName: "Studio Exception",
    email: "studio-exception@example.test",
  });
  const manualProfile = await responseJson(
    await api(database, `/api/admin/crm/people/${manual.id}`),
  );
  assert.equal(manualProfile.payload.person.eligibilityReason, "studio_manual_entry");
  assert.equal(manualProfile.payload.person.eligibilitySourceProvider, "manual");
});

test("concurrent qualifying bookings with one email converge without orphan people", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => ingestCrmSourceRecord(d1, {
      contact: {
        displayName: "Concurrent Client",
        email: "concurrent-crm@example.test",
      },
      interaction: {
        sourceProvider: "local",
        sourceType: "appointment",
        sourceId: `concurrent-appointment-${index}`,
        nodeId: "node-tattoos",
        interactionType: "appointment",
        status: "new",
      },
    })),
  );
  assert.ok(results.every((result) => result.status === "applied"));
  assert.equal(database.prepare(
    `SELECT COUNT(DISTINCT p.id) count
     FROM crm_people p
     JOIN crm_identities i ON i.person_id=p.id
     WHERE i.kind='email' AND i.normalized_value='concurrent-crm@example.test'`
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_people
     WHERE display_name='Concurrent Client'`
  ).get().count, 1);
  const interactionPeople = database.prepare(
    `SELECT DISTINCT person_id FROM crm_interactions
     WHERE source_provider='local' AND source_type='appointment'
       AND source_id LIKE 'concurrent-appointment-%'`
  ).all();
  assert.equal(interactionPeople.length, 1);
  assert.ok(interactionPeople[0].person_id);
  assert.equal(database.prepare(
    `SELECT COUNT(*) count FROM crm_interactions
     WHERE source_provider='local' AND source_type='appointment'
       AND source_id LIKE 'concurrent-appointment-%'`
  ).get().count, 8);
});

test("a real booking enriches only blank or placeholder person fields", async () => {
  const database = migratedDatabase();
  const d1 = new LocalD1(database);
  const initialPerson = await createPerson(database, {
    displayName: "square contact",
    email: "enrich@example.test",
  });

  await ingestCrmSourceRecord(d1, {
    contact: {
      displayName: "Actual Client Name",
      email: "enrich@example.test",
      preferredName: "Actual",
      organization: "Client Organization",
      pronouns: "they/them",
      instagram: "@actualclient",
      preferredContactMethod: "instagram",
      referralSource: "youtube",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "enrich-appointment",
      nodeId: "node-tattoos",
      interactionType: "appointment",
    },
  });
  assert.deepEqual(
    { ...database.prepare(
      `SELECT display_name,preferred_name,organization,pronouns,instagram,
              preferred_contact_method,referral_source
       FROM crm_people WHERE id=?`
    ).get(initialPerson.id) },
    {
      display_name: "Actual Client Name",
      preferred_name: "Actual",
      organization: "Client Organization",
      pronouns: "they/them",
      instagram: "actualclient",
      preferred_contact_method: "instagram",
      referral_source: "youtube",
    },
  );

  database.prepare(
    `UPDATE crm_people
     SET display_name='Studio Chosen Name',organization='Studio Organization'
     WHERE id=?`
  ).run(initialPerson.id);
  await ingestCrmSourceRecord(d1, {
    contact: {
      displayName: "Should Not Replace",
      email: "enrich@example.test",
      organization: "Should Not Replace",
    },
    interaction: {
      sourceProvider: "local",
      sourceType: "appointment",
      sourceId: "enrich-appointment-2",
      interactionType: "appointment",
    },
  });
  assert.deepEqual(
    { ...database.prepare(
      "SELECT display_name,organization FROM crm_people WHERE id=?"
    ).get(initialPerson.id) },
    {
      display_name: "Studio Chosen Name",
      organization: "Studio Organization",
    },
  );
});

test("event tickets, waitlists, and open-mic signups register the same person live", async () => {
  const database = migratedDatabase();
  database.prepare(
    `UPDATE events
     SET price_cents=0,status='open',waitlist_enabled=1
     WHERE slug='signal-symbol'`
  ).run();
  const runtime = env(database);

  const ticketResponse = await handleEventCheckout(request(
    "/api/events/signal-symbol/checkout",
    {
      method: "POST",
      body: {
        name: "Event Person",
        email: "event-person@example.test",
        phone: "404-555-0195",
        preferred_name: "Event",
        pronouns: "she/they",
        instagram: "@eventperson",
        preferred_contact_method: "instagram",
        referral_source: "friend_family",
        seats: 2,
      },
    },
  ), runtime, "signal-symbol");
  assert.equal(ticketResponse.status, 200, await ticketResponse.text());

  const waitlistResponse = await handleEventWaitlist(request(
    "/api/events/signal-symbol/waitlist",
    {
      method: "POST",
      body: {
        name: "Event Person",
        email: "event-person@example.test",
        phone: "404-555-0195",
        seats: 1,
      },
    },
  ), runtime, "signal-symbol");
  assert.equal(waitlistResponse.status, 200, await waitlistResponse.text());

  const openMicResponse = await handleEventOpenMicSignup(request(
    "/api/events/signal-symbol/open-mic",
    {
      method: "POST",
      body: {
        performerName: "Event Person",
        performerEmail: "event-person@example.test",
        performerPhone: "404-555-0195",
        actType: "poetry",
        pieceTitle: "Construct Poem",
      },
    },
  ), runtime, "signal-symbol");
  assert.equal(openMicResponse.status, 200, await openMicResponse.text());

  const person = database.prepare(
    `SELECT DISTINCT p.id
     FROM crm_people p
     JOIN crm_identities i ON i.person_id=p.id
     WHERE i.kind='email' AND i.normalized_value='event-person@example.test'`
  ).get();
  assert.ok(person?.id);
  assert.deepEqual(
    { ...database.prepare(
      `SELECT preferred_name,pronouns,instagram,preferred_contact_method,referral_source
       FROM crm_people WHERE id=?`
    ).get(person.id) },
    {
      preferred_name: "Event",
      pronouns: "she/they",
      instagram: "eventperson",
      preferred_contact_method: "instagram",
      referral_source: "friend_family",
    },
  );
  assert.deepEqual(
    database.prepare(
      `SELECT interaction_type,status
       FROM crm_interactions
       WHERE person_id=?
       ORDER BY interaction_type`
    ).all(person.id).map((row) => ({ ...row })),
    [
      { interaction_type: "event_ticket_purchase", status: "paid" },
      { interaction_type: "event_waitlist", status: "new" },
      { interaction_type: "performance", status: "requested" },
    ],
  );
  assert.deepEqual(
    { ...database.prepare(
      `SELECT status,amount_cents
       FROM crm_transactions
       WHERE person_id=? AND source_type='event_ticket_payment'`
    ).get(person.id) },
    { status: "settled", amount_cents: 0 },
  );
});

test("a late Square payment cannot resurrect a cancelled event ticket", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,created_at,updated_at,cancelled_at
    ) VALUES(
      'terminal-ticket','evt_signal_symbol','Terminal Guest',
      'terminal-guest@example.test',2,9000,'USD','cancelled',
      'terminal-ticket-order',?,?,?
    )
  `).run(createdAt, createdAt, createdAt);

  const notificationUrl = "https://example.test/api/square-events/webhook";
  const signatureKey = "events-terminal-webhook-key";
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "terminal-ticket-payment",
          order_id: "terminal-ticket-order",
          status: "COMPLETED",
        },
      },
    },
  });
  const signature = await eventsWebhookSignature(rawBody, signatureKey, notificationUrl);
  const webhookRequest = new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const response = await withMockFetch(async (input, options = {}) => {
    assert.equal(String(input), "https://connect.squareup.com/v2/orders/terminal-ticket-order");
    assert.equal(String(options.method || "GET").toUpperCase(), "GET");
    return Response.json({
      order: {
        id: "terminal-ticket-order",
        state: "COMPLETED",
        net_amount_due_money: { amount: 0, currency: "USD" },
      },
    });
  }, () => handleEventsSquareWebhook(webhookRequest, runtime));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.attention, true);
  assert.equal(payload.durableAttention, true);
  assert.equal(payload.ticketStatus, "cancelled");
  const terminalTicket = database.prepare(`
    SELECT status,square_payment_id,paid_at
    FROM event_tickets WHERE id='terminal-ticket'
  `).get();
  assert.equal(terminalTicket.status, "cancelled");
  assert.equal(terminalTicket.square_payment_id, "terminal-ticket-payment");
  assert.ok(terminalTicket.paid_at);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT i.status,t.status transaction_status,t.amount_cents
      FROM crm_interactions i
      JOIN crm_transactions t ON t.person_id=i.person_id
      WHERE i.source_type='event_ticket' AND i.source_id='terminal-ticket'
        AND t.source_type='event_ticket_payment' AND t.source_id='terminal-ticket'
    `).get() },
    { status: "cancelled", transaction_status: "settled", amount_cents: 9000 },
  );
  const attention = database.prepare(`
    SELECT person_id,status,metadata_json,active
    FROM crm_interactions
    WHERE source_provider='system'
      AND source_type='event_payment_attention'
      AND source_id='terminal-ticket'
  `).get();
  assert.deepEqual(
    {
      person_id: attention.person_id,
      status: attention.status,
      active: attention.active,
    },
    { person_id: null, status: "needs_review", active: 1 },
  );
  const attentionMetadata = JSON.parse(attention.metadata_json);
  assert.equal(attentionMetadata.ticketId, "terminal-ticket");
  assert.equal(attentionMetadata.providerPaymentId, "terminal-ticket-payment");
  assert.equal(attentionMetadata.reason, "payment_reported_after_terminal_status");
  assert.equal(attention.metadata_json.includes("terminal-guest@example.test"), false);
  assert.equal(attention.metadata_json.includes("Terminal Guest"), false);
});

test("concurrent terminal payment webhooks merge durable payment attention", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,raw_json,created_at,updated_at,cancelled_at
    ) VALUES(
      'terminal-concurrent-ticket','evt_signal_symbol','Concurrent Terminal Guest',
      'terminal-concurrent@example.test',1,4500,'USD','cancelled',
      'terminal-concurrent-order',
      '{"eventCancellation":{"refundRequested":true}}',?,?,?
    )
  `).run(createdAt, createdAt, createdAt);
  const notificationUrl = "https://example.test/api/square-events/webhook";
  const signatureKey = "events-terminal-concurrent-key";
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });
  const makeRequest = async (paymentId) => {
    const body = JSON.stringify({
      type: "payment.updated",
      data: {
        object: {
          payment: {
            id: paymentId,
            order_id: "terminal-concurrent-order",
            status: "COMPLETED",
          },
        },
      },
    });
    const signature = await eventsWebhookSignature(body, signatureKey, notificationUrl);
    return new Request(notificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": signature,
      },
      body,
    });
  };
  const requests = await Promise.all([
    makeRequest("terminal-concurrent-payment-one"),
    makeRequest("terminal-concurrent-payment-two"),
  ]);
  const responses = await withMockFetch(async () => Response.json({
    order: {
      id: "terminal-concurrent-order",
      state: "COMPLETED",
      net_amount_due_money: { amount: 0, currency: "USD" },
    },
  }), () => Promise.all(
    requests.map((webhookRequest) => handleEventsSquareWebhook(webhookRequest, runtime)),
  ));
  for (const response of responses) {
    assert.equal(response.status, 200, await response.text());
  }
  const attentionRows = database.prepare(`
    SELECT metadata_json FROM crm_interactions
    WHERE source_provider='system'
      AND source_type='event_payment_attention'
      AND source_id='terminal-concurrent-ticket'
  `).all();
  assert.equal(attentionRows.length, 1);
  const metadata = JSON.parse(attentionRows[0].metadata_json);
  assert.deepEqual(
    metadata.providerPaymentIds.sort(),
    [
      "terminal-concurrent-payment-one",
      "terminal-concurrent-payment-two",
    ],
  );
  assert.equal(metadata.refundRequested, true);
});

test("a repeated paid-ticket webhook repairs a missed CRM mirror without duplicates", async () => {
  const database = migratedDatabase();
  const paidAt = "2026-07-02T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_id,paid_at,created_at,updated_at
    ) VALUES(
      'paid-repair-ticket','evt_signal_symbol','Repair Guest',
      'repair-guest@example.test',1,4500,'USD','paid',
      'paid-repair-order','paid-repair-payment',?,?,?
    )
  `).run(paidAt, paidAt, paidAt);
  const notificationUrl = "https://example.test/api/square-events/webhook";
  const signatureKey = "events-repair-webhook-key";
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "paid-repair-payment",
          order_id: "paid-repair-order",
          status: "COMPLETED",
        },
      },
    },
  });
  const signature = await eventsWebhookSignature(rawBody, signatureKey, notificationUrl);
  const makeRequest = () => new Request(notificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });

  const responses = await withMockFetch(async () => Response.json({
    order: {
      id: "paid-repair-order",
      state: "COMPLETED",
      net_amount_due_money: { amount: 0, currency: "USD" },
    },
  }), async () => [
    await handleEventsSquareWebhook(makeRequest(), runtime),
    await handleEventsSquareWebhook(makeRequest(), runtime),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200, await response.text());
  }
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
    WHERE display_name='Repair Guest'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_type='event_ticket' AND source_id='paid-repair-ticket'
  `).get().count, 1);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT status,amount_cents FROM crm_transactions
      WHERE source_type='event_ticket_payment' AND source_id='paid-repair-ticket'
    `).get() },
    { status: "settled", amount_cents: 4500 },
  );
});

test("ticket cancellation reconciles a just-completed Square payment before refunding", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-02T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_link_id,square_checkout_url,
      raw_json,created_at,updated_at
    ) VALUES(
      'cancel-race-ticket','evt_signal_symbol','Cancellation Race Guest',
      'cancel-race@example.test',1,4500,'USD','pending',
      'cancel-race-order','cancel-race-link','https://square.test/cancel-race',
      '{}',?,?
    )
  `).run(createdAt, createdAt);
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
  });
  const cancelRequest = request(
    "/api/admin/events/tickets/cancel-race-ticket/cancel",
    { method: "POST", body: { refund: true }, admin: true },
  );
  const calls = [];
  const response = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = String(options.method || "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/v2/orders/cancel-race-order") {
      return Response.json({
        order: {
          id: "cancel-race-order",
          state: "COMPLETED",
          net_amount_due_money: { amount: 0, currency: "USD" },
          closed_at: "2026-07-02T12:05:00.000Z",
          tenders: [{
            payment_id: "cancel-race-payment",
            created_at: "2026-07-02T12:05:00.000Z",
          }],
        },
      });
    }
    if (url.pathname === "/v2/refunds") {
      assert.equal(method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.payment_id, "cancel-race-payment");
      assert.equal(body.amount_money.amount, 4500);
      return Response.json({
        refund: {
          id: "cancel-race-refund",
          status: "COMPLETED",
          payment_id: "cancel-race-payment",
          order_id: "cancel-race-order",
          amount_money: { amount: 4500, currency: "USD" },
          created_at: "2026-07-02T12:06:00.000Z",
          updated_at: "2026-07-02T12:06:00.000Z",
        },
      });
    }
    throw new Error(`Unexpected Square request: ${method} ${url.pathname}`);
  }, () => handleAdminEventTicketCancel(
    cancelRequest,
    runtime,
    "cancel-race-ticket",
  ));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.wasPaid, true);
  assert.equal(payload.refund.completed, true);
  assert.equal(payload.checkoutInvalidated, false);
  assert.deepEqual(calls, [
    "GET /v2/orders/cancel-race-order",
    "POST /v2/refunds",
  ]);
  const cancelledTicket = database.prepare(`
    SELECT status,square_payment_id,refund_id,raw_json
    FROM event_tickets WHERE id='cancel-race-ticket'
  `).get();
  assert.equal(cancelledTicket.status, "cancelled");
  assert.equal(cancelledTicket.square_payment_id, "cancel-race-payment");
  assert.equal(cancelledTicket.refund_id, "cancel-race-refund");
  assert.equal(JSON.parse(cancelledTicket.raw_json).eventCancellation.refundRequested, true);
  assert.deepEqual(
    database.prepare(`
      SELECT transaction_type,status,amount_cents
      FROM crm_transactions
      WHERE source_type IN ('event_ticket_payment','event_ticket_refund')
      ORDER BY transaction_type
    `).all().map((row) => ({ ...row })),
    [
      { transaction_type: "charge", status: "settled", amount_cents: 4500 },
      { transaction_type: "refund", status: "settled", amount_cents: 4500 },
    ],
  );
});

test("ticket cancellation refuses an unsafe multi-payment Square refund", async () => {
  const database = migratedDatabase();
  const paidAt = "2026-07-02T12:00:00.000Z";
  const notificationUrl = "https://example.test/api/square-events/webhook";
  const signatureKey = "events-multi-payment-webhook-key";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_id,raw_json,paid_at,created_at,updated_at
    ) VALUES(
      'multi-payment-ticket','evt_signal_symbol','Multi Payment Guest',
      'multi-payment@example.test',1,4500,'USD','paid',
      'multi-payment-order','multi-payment-one','{}',?,?,?
    )
  `).run(paidAt, paidAt, paidAt);
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });
  const calls = [];
  const responses = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = String(options.method || "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    assert.equal(url.pathname, "/v2/orders/multi-payment-order");
    assert.equal(method, "GET");
    return Response.json({
      order: {
        id: "multi-payment-order",
        state: "COMPLETED",
        net_amount_due_money: { amount: 0, currency: "USD" },
        tenders: [
          { payment_id: "multi-payment-one" },
          { payment_id: "multi-payment-two" },
        ],
      },
    });
  }, async () => {
    const cancel = () => handleAdminEventTicketCancel(
      request(
        "/api/admin/events/tickets/multi-payment-ticket/cancel",
        { method: "POST", body: { refund: true }, admin: true },
      ),
      runtime,
      "multi-payment-ticket",
    );
    return [await cancel(), await cancel()];
  });
  for (const response of responses) {
    const payload = await response.json();
    assert.equal(response.status, 409, JSON.stringify(payload));
    assert.match(payload.detail, /multiple payments/i);
  }
  assert.deepEqual(calls, [
    "GET /v2/orders/multi-payment-order",
    "GET /v2/orders/multi-payment-order",
  ]);
  assert.equal(database.prepare(`
    SELECT status FROM event_tickets WHERE id='multi-payment-ticket'
  `).get().status, "paid");
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_type='event_ticket_refund'
  `).get().count, 0);
  const attentionRows = database.prepare(`
    SELECT status,active,metadata_json FROM crm_interactions
    WHERE source_provider='system'
      AND source_type='event_payment_attention'
      AND source_id='multi-payment-ticket'
  `).all();
  assert.equal(attentionRows.length, 1);
  assert.equal(attentionRows[0].status, "needs_review");
  assert.equal(attentionRows[0].active, 1);
  const metadata = JSON.parse(attentionRows[0].metadata_json);
  assert.equal(metadata.reason, "multiple_payments_require_manual_refund");
  assert.deepEqual(
    metadata.providerPaymentIds.sort(),
    ["multi-payment-one", "multi-payment-two"],
  );
  assert.equal(attentionRows[0].metadata_json.includes("multi-payment@example.test"), false);

  const refundBody = JSON.stringify({
    type: "refund.updated",
    data: {
      object: {
        refund: {
          id: "multi-payment-first-refund",
          payment_id: "multi-payment-one",
          order_id: "multi-payment-order",
          status: "COMPLETED",
          amount_money: { amount: 2250, currency: "USD" },
          created_at: "2026-07-02T13:00:00.000Z",
          updated_at: "2026-07-02T13:00:00.000Z",
        },
      },
    },
  });
  const refundSignature = await eventsWebhookSignature(
    refundBody,
    signatureKey,
    notificationUrl,
  );
  const refundResponse = await handleEventsSquareWebhook(
    new Request(notificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": refundSignature,
      },
      body: refundBody,
    }),
    runtime,
  );
  assert.equal(refundResponse.status, 200, await refundResponse.text());
  const afterRefundAttention = database.prepare(`
    SELECT status,active,metadata_json FROM crm_interactions
    WHERE source_provider='system'
      AND source_type='event_payment_attention'
      AND source_id='multi-payment-ticket'
  `).get();
  assert.equal(afterRefundAttention.status, "needs_review");
  assert.equal(afterRefundAttention.active, 1);
  assert.equal(
    JSON.parse(afterRefundAttention.metadata_json).reason,
    "multiple_payments_require_manual_refund",
  );

  const secondRefundBody = JSON.stringify({
    type: "refund.updated",
    data: {
      object: {
        refund: {
          id: "multi-payment-second-refund",
          payment_id: "multi-payment-two",
          order_id: "multi-payment-order",
          status: "COMPLETED",
          amount_money: { amount: 2250, currency: "USD" },
          created_at: "2026-07-02T13:05:00.000Z",
          updated_at: "2026-07-02T13:05:00.000Z",
        },
      },
    },
  });
  const secondRefundSignature = await eventsWebhookSignature(
    secondRefundBody,
    signatureKey,
    notificationUrl,
  );
  const secondRefundResponse = await handleEventsSquareWebhook(
    new Request(notificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": secondRefundSignature,
      },
      body: secondRefundBody,
    }),
    runtime,
  );
  const secondRefundPayload = await secondRefundResponse.json();
  assert.equal(
    secondRefundResponse.status,
    200,
    JSON.stringify(secondRefundPayload),
  );
  assert.equal(secondRefundPayload.durableAttention, true);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_type='event_ticket_refund' AND status='settled'
      AND source_id IN (
        'multi-payment-first-refund',
        'multi-payment-second-refund'
      )
  `).get().count, 2);
  assert.equal(
    JSON.parse(database.prepare(`
      SELECT metadata_json FROM crm_transactions
      WHERE source_type='event_ticket_refund'
        AND source_id='multi-payment-second-refund'
    `).get().metadata_json).providerPaymentId,
    "multi-payment-two",
  );
  const finalAttention = database.prepare(`
    SELECT active,metadata_json FROM crm_interactions
    WHERE source_type='event_payment_attention'
      AND source_id='multi-payment-ticket'
  `).get();
  assert.equal(finalAttention.active, 1);
  const finalMetadata = JSON.parse(finalAttention.metadata_json);
  assert.deepEqual(
    finalMetadata.providerRefundIds.sort(),
    ["multi-payment-first-refund", "multi-payment-second-refund"],
  );
});

test("ticket cancellation treats Square net amount due as authoritative", async () => {
  const database = migratedDatabase();
  const paidAt = "2026-07-02T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_id,raw_json,paid_at,created_at,updated_at
    ) VALUES(
      'partial-payment-ticket','evt_signal_symbol','Partial Payment Guest',
      'partial-payment@example.test',1,4500,'USD','paid',
      'partial-payment-order',NULL,'{}',?,?,?
    )
  `).run(paidAt, paidAt, paidAt);
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
  });
  let refundAttempted = false;
  const response = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/v2/refunds") {
      refundAttempted = true;
      throw new Error("A partial order must never reach refund creation.");
    }
    assert.equal(url.pathname, "/v2/orders/partial-payment-order");
    assert.equal(String(options.method || "GET").toUpperCase(), "GET");
    return Response.json({
      order: {
        id: "partial-payment-order",
        state: "COMPLETED",
        net_amount_due_money: { amount: 1000, currency: "USD" },
        tenders: [{ id: "tender-without-payment-id" }],
      },
    });
  }, () => handleAdminEventTicketCancel(
    request(
      "/api/admin/events/tickets/partial-payment-ticket/cancel",
      { method: "POST", body: { refund: true }, admin: true },
    ),
    runtime,
    "partial-payment-ticket",
  ));
  const payload = await response.json();
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.match(payload.detail, /partial payment/i);
  assert.equal(refundAttempted, false);
  assert.equal(database.prepare(`
    SELECT status FROM event_tickets WHERE id='partial-payment-ticket'
  `).get().status, "paid");
  const attention = database.prepare(`
    SELECT active,metadata_json FROM crm_interactions
    WHERE source_type='event_payment_attention'
      AND source_id='partial-payment-ticket'
  `).get();
  assert.equal(attention.active, 1);
  assert.equal(
    JSON.parse(attention.metadata_json).reason,
    "partial_payment_requires_review",
  );
});

test("a pending event refund is recorded but excluded from settled CRM refunds", async () => {
  const database = migratedDatabase();
  const paidAt = "2026-07-02T12:00:00.000Z";
  const notificationUrl = "https://example.test/api/square-events/webhook";
  const signatureKey = "events-refund-webhook-key";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_id,raw_json,paid_at,created_at,updated_at
    ) VALUES(
      'pending-refund-ticket','evt_signal_symbol','Pending Refund Guest',
      'pending-refund@example.test',1,4500,'USD','paid',
      'pending-refund-order','pending-refund-payment','{}',?,?,?
    )
  `).run(paidAt, paidAt, paidAt);
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_EVENTS_WEBHOOK_NOTIFICATION_URL: notificationUrl,
  });
  const cancelRequest = request(
    "/api/admin/events/tickets/pending-refund-ticket/cancel",
    { method: "POST", body: { refund: true }, admin: true },
  );

  const response = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/v2/orders/pending-refund-order") {
      assert.equal(method, "GET");
      return Response.json({
        order: {
          id: "pending-refund-order",
          state: "COMPLETED",
          net_amount_due_money: { amount: 0, currency: "USD" },
          tenders: [{ payment_id: "pending-refund-payment" }],
        },
      });
    }
    if (url.pathname === "/v2/refunds") {
      assert.equal(method, "POST");
      return Response.json({
        refund: {
          id: "pending-refund-id",
          status: "PENDING",
          created_at: "2026-07-03T12:00:00.000Z",
          updated_at: "2026-07-03T12:00:00.000Z",
        },
      });
    }
    throw new Error(`Unexpected Square request: ${method} ${url.pathname}`);
  }, () => handleAdminEventTicketCancel(cancelRequest, runtime, "pending-refund-ticket"));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.refund, {
    attempted: true,
    ok: false,
    accepted: true,
    completed: false,
    pending: true,
    status: "PENDING",
    refundId: "pending-refund-id",
    error: null,
  });
  const ticket = database.prepare(`
    SELECT status,refund_id,raw_json FROM event_tickets
    WHERE id='pending-refund-ticket'
  `).get();
  assert.equal(ticket.status, "cancelled");
  assert.equal(ticket.refund_id, "pending-refund-id");
  assert.equal(JSON.parse(ticket.raw_json).eventRefund.status, "PENDING");
  assert.deepEqual(
    { ...database.prepare(`
      SELECT transaction_type,status,amount_cents
      FROM crm_transactions
      WHERE source_type='event_ticket_refund'
        AND source_id='pending-refund-id'
    `).get() },
    { transaction_type: "refund", status: "pending", amount_cents: 4500 },
  );
  const personId = database.prepare(`
    SELECT person_id FROM crm_identities
    WHERE kind='email' AND normalized_value='pending-refund@example.test'
      AND active=1
  `).get().person_id;
  let profile = await responseJson(await api(database, `/api/admin/crm/people/${personId}`));
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.person.pendingCents, -4500);

  const backfill = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(backfill.response.status, 200, JSON.stringify(backfill.payload));
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE transaction_type='refund' AND status='settled'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE transaction_type='refund' AND status='pending'
  `).get().count, 1);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT transaction_type,status,amount_cents
      FROM crm_transactions WHERE source_type='event_ticket_payment'
        AND source_id='pending-refund-ticket'
    `).get() },
    { transaction_type: "charge", status: "settled", amount_cents: 4500 },
  );

  const refundBody = JSON.stringify({
    type: "refund.updated",
    data: {
      object: {
        refund: {
          id: "pending-refund-id",
          payment_id: "pending-refund-payment",
          order_id: "pending-refund-order",
          status: "COMPLETED",
          amount_money: { amount: 4500, currency: "USD" },
          created_at: "2026-07-03T12:00:00.000Z",
          updated_at: "2026-07-03T13:00:00.000Z",
        },
      },
    },
  });
  const refundSignature = await eventsWebhookSignature(
    refundBody,
    signatureKey,
    notificationUrl,
  );
  const webhookResponse = await handleEventsSquareWebhook(
    new Request(notificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": refundSignature,
      },
      body: refundBody,
    }),
    runtime,
  );
  const webhookPayload = await webhookResponse.json();
  assert.equal(webhookResponse.status, 200, JSON.stringify(webhookPayload));
  assert.equal(webhookPayload.refund, true);
  assert.equal(webhookPayload.ticketStatus, "cancelled");
  assert.equal(webhookPayload.refundStatus, "COMPLETED");
  assert.deepEqual(
    { ...database.prepare(`
      SELECT status,amount_cents
      FROM crm_transactions
      WHERE source_type='event_ticket_refund'
        AND source_id='pending-refund-id'
    `).get() },
    { status: "settled", amount_cents: 4500 },
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_type='event_ticket_refund'
      AND source_id='pending-refund-id'
  `).get().count, 1);
  profile = await responseJson(await api(database, `/api/admin/crm/people/${personId}`));
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.person.settledGrossCents, 4500);
  assert.equal(profile.payload.person.refundCents, 4500);
  assert.equal(profile.payload.person.netSpendCents, 0);
  assert.equal(profile.payload.person.pendingCents, 0);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT status,active FROM crm_interactions
      WHERE source_type='event_payment_attention'
        AND source_id='pending-refund-ticket'
    `).get() },
    { status: "resolved", active: 0 },
  );
});

test("the stale event ticket reaper keeps tickets pending on Square lookup errors", async () => {
  const database = migratedDatabase();
  const staleAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,created_at,updated_at
    ) VALUES(
      'stale-provider-error','evt_signal_symbol','Stale Guest',
      'stale-guest@example.test',1,4500,'USD','pending',
      'stale-provider-order',?,?
    )
  `).run(staleAt, staleAt);
  const runtime = env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
  });

  const result = await withMockFetch(
    async () => Response.json(
      { errors: [{ detail: "Temporary Square outage" }] },
      { status: 503 },
    ),
    () => reapStalePendingTickets(runtime),
  );
  assert.deepEqual(result, { reaped: 0, recovered: 0, failed: 1 });
  assert.equal(database.prepare(
    "SELECT status FROM event_tickets WHERE id='stale-provider-error'"
  ).get().status, "pending");
});

test("the stale event ticket reaper preserves partial tenders for review", async () => {
  const database = migratedDatabase();
  const staleAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_link_id,square_checkout_url,
      raw_json,created_at,updated_at
    ) VALUES(
      'stale-partial-ticket','evt_signal_symbol','Stale Partial Guest',
      'stale-partial@example.test',1,4500,'USD','pending',
      'stale-partial-order','stale-partial-link',
      'https://square.test/stale-partial','{}',?,?
    )
  `).run(staleAt, staleAt);
  const calls = [];
  const result = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(`${String(options.method || "GET").toUpperCase()} ${url.pathname}`);
    assert.equal(url.pathname, "/v2/orders/stale-partial-order");
    return Response.json({
      order: {
        id: "stale-partial-order",
        state: "OPEN",
        net_amount_due_money: { amount: 1000, currency: "USD" },
        tenders: [{ id: "partial-tender-without-payment-id" }],
      },
    });
  }, () => reapStalePendingTickets(env(database, {
    SQUARE_ACCESS_TOKEN: "events-square-token",
    SQUARE_EVENTS_LOCATION_ID: "events-location",
    SQUARE_ENVIRONMENT: "production",
  })));
  assert.deepEqual(result, { reaped: 0, recovered: 0, failed: 1 });
  assert.deepEqual(calls, ["GET /v2/orders/stale-partial-order"]);
  const ticket = database.prepare(`
    SELECT status,square_checkout_url
    FROM event_tickets WHERE id='stale-partial-ticket'
  `).get();
  assert.equal(ticket.status, "pending");
  assert.equal(ticket.square_checkout_url, "https://square.test/stale-partial");
  const attention = database.prepare(`
    SELECT active,metadata_json FROM crm_interactions
    WHERE source_type='event_payment_attention'
      AND source_id='stale-partial-ticket'
  `).get();
  assert.equal(attention.active, 1);
  assert.equal(
    JSON.parse(attention.metadata_json).reason,
    "partial_payment_requires_review",
  );
});

test("people profiles allow tier changes without explanations and calculate relationship activity and spend", async () => {
  const database = migratedDatabase();

  let result = await responseJson(await api(database, "/api/admin/crm/people", {
    method: "POST",
    body: {
      displayName: "Tier Without Explanation",
      email: "rationale@example.com",
      tier: 1,
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  assert.equal(result.payload.person.tier, 1);
  assert.equal(result.payload.person.tierRationale, "");

  const person = await createPerson(database, {
    preferredName: "Alex",
    tags: ["tattoo client", "Atlanta"],
  });
  assert.equal(person.tier, null);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "PATCH",
    body: { tier: 2, preferredContactMethod: "email" },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.person.tier, 2);
  assert.equal(result.payload.person.tierRationale, "");

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

  for (const [index, transaction] of [
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
  ].entries()) {
    result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}/transactions`, {
      method: "POST",
      body: { ...transaction, requestId: `profile-payment-${index}` },
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

test("People separates past last interaction from the next active interaction", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Interaction Timeline",
    email: "interaction-timeline@example.test",
  });
  const now = Date.now();
  const past = new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString();
  const cancelledFuture = new Date(now + (12 * 60 * 60 * 1000)).toISOString();
  const completedFuture = new Date(now + (24 * 60 * 60 * 1000)).toISOString();
  const activeFuture = new Date(now + (2 * 24 * 60 * 60 * 1000)).toISOString();
  const createdAt = new Date(now).toISOString();
  const insertInteraction = database.prepare(`
    INSERT INTO crm_interactions(
      id,person_id,node_id,channel,interaction_type,label,status,quantity,
      occurred_at,source_provider,source_type,source_id,metadata_json,
      active,created_at,updated_at
    ) VALUES(?,?,'node-tattoos','studio','appointment',?,?,1,?,'test','timeline',?,'{}',1,?,?)
  `);
  for (const [id, label, status, occurredAt] of [
    ["timeline-past", "Past appointment", "completed", past],
    ["timeline-cancelled", "Cancelled appointment", "cancelled", cancelledFuture],
    ["timeline-completed", "Future completed record", "completed", completedFuture],
    ["timeline-next", "Next appointment", "confirmed", activeFuture],
  ]) {
    insertInteraction.run(
      id,
      person.id,
      label,
      status,
      occurredAt,
      id,
      createdAt,
      createdAt,
    );
  }

  let result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.lastInteractionAt, past);
  assert.equal(result.payload.person.nextInteractionAt, activeFuture);

  result = await responseJson(await api(database, "/api/admin/crm/people?q=interaction%20timeline"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.people[0].lastInteractionAt, past);
  assert.equal(result.payload.people[0].nextInteractionAt, activeFuture);

  const futureOnly = await createPerson(database, {
    displayName: "Future Only Timeline",
    email: "future-only-timeline@example.test",
  });
  insertInteraction.run(
    "timeline-future-only",
    futureOnly.id,
    "First appointment",
    "confirmed",
    activeFuture,
    "timeline-future-only",
    createdAt,
    createdAt,
  );
  result = await responseJson(await api(database, `/api/admin/crm/people/${futureOnly.id}`));
  assert.equal(result.payload.person.lastInteractionAt, null);
  assert.equal(result.payload.person.nextInteractionAt, activeFuture);
});

test("People directory nodes include transaction and attendance-only involvement", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Cross Node Client",
    email: "cross-node@example.test",
  });
  const occurredAt = "2026-07-10T18:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,note,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'cross-node-merch',?,'node-merch','charge','settled',8500,0,
      'USD',?,'test','node_contract','cross-node-merch','Merch purchase',
      '{}',1,?,?
    )
  `).run(person.id, occurredAt, occurredAt, occurredAt);
  database.prepare(`
    INSERT INTO crm_attendance(
      id,person_id,status,checked_in_at,source_provider,source_type,source_id,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'cross-node-attendance',?,'checked_in',?,'test','node_contract',
      'cross-node-attendance','{}',1,?,?
    )
  `).run(person.id, occurredAt, occurredAt, occurredAt);

  let result = await responseJson(await api(
    database,
    "/api/admin/crm/people?q=cross%20node",
  ));
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    [...result.payload.people[0].nodes].sort(),
    ["node-events", "node-merch"],
  );

  result = await responseJson(await api(
    database,
    "/api/admin/crm/people?nodeId=node-merch",
  ));
  assert.deepEqual(result.payload.people.map((entry) => entry.id), [person.id]);

  result = await responseJson(await api(
    database,
    "/api/admin/crm/people?nodeId=node-events",
  ));
  assert.deepEqual(result.payload.people.map((entry) => entry.id), [person.id]);
});

test("manual transactions use request ids without treating human references as duplicates", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Idempotent Payments",
    email: "idempotent-payments@example.test",
  });
  const path = `/api/admin/crm/people/${person.id}/transactions`;
  const body = {
    requestId: "same-payment-request",
    transactionType: "charge",
    status: "settled",
    amountCents: 5_000,
    tipCents: 500,
    currency: "USD",
    occurredAt: "2026-07-17T18:00:00.000Z",
    reference: "cash",
    label: "Touch-up tip",
    note: "Touch-up tip · cash",
  };

  let result = await responseJson(await api(database, path, {
    method: "POST",
    body: { ...body, requestId: "" },
  }));
  assert.equal(result.response.status, 400);
  assert.equal(result.payload.details.code, "IDEMPOTENCY_KEY_REQUIRED");

  const sharedEnvironment = env(database);
  const attempts = await Promise.all([0, 1].map(async () => responseJson(
    await handleAdminCrmApi(request(path, {
      method: "POST",
      admin: true,
      body,
    }), sharedEnvironment),
  )));
  assert.deepEqual(
    attempts.map(({ response }) => response.status).sort((a, b) => a - b),
    [200, 201],
  );
  assert.equal(
    new Set(attempts.map(({ payload }) => payload.transaction.id)).size,
    1,
  );
  assert.equal(attempts.filter(({ payload }) => payload.idempotent).length, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='manual' AND source_type='transaction'
      AND source_id='studio:same-payment-request'
  `).get().count, 1);

  result = await responseJson(await api(database, path, {
    method: "POST",
    body: { ...body, amountCents: 6_000 },
  }));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.details.code, "IDEMPOTENCY_KEY_REUSED");

  for (const requestId of ["cash-payment-two", "cash-payment-three"]) {
    result = await responseJson(await api(database, path, {
      method: "POST",
      body: {
        ...body,
        requestId,
        amountCents: 2_500,
        tipCents: 0,
        reference: "cash",
        label: "",
        note: "cash",
      },
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  }
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='manual' AND source_type='transaction'
      AND json_extract(metadata_json,'$.reference')='cash'
  `).get().count, 3);
  const firstTransactionId = attempts[0].payload.transaction.id;
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_audit_events
    WHERE action='transaction_created' AND resource_id=?
  `).get(firstTransactionId).count, 1);
});

test("manual contact writes stay idempotent within one person", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Unique Contact",
    email: "unique-contact@example.test",
  });
  const originalEmail = database.prepare(`
    SELECT id FROM crm_identities
    WHERE person_id=? AND kind='email' AND active=1
  `).get(person.id);

  let result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${person.id}/identities`,
    {
      method: "POST",
      body: {
        kind: "email",
        value: "UNIQUE-CONTACT@example.test",
        isPrimary: true,
        isVerified: true,
      },
    },
  ));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.deduplicated, true);
  assert.equal(result.payload.identity.id, originalEmail.id);
  assert.equal(result.payload.identity.is_primary, 1);
  assert.equal(result.payload.identity.is_verified, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='email' AND active=1
  `).get(person.id).count, 1);

  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${person.id}/identities`,
    {
      method: "POST",
      body: {
        kind: "phone",
        value: "(404) 555-0199",
      },
    },
  ));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.identity.normalized_value, "+14045550199");

  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${person.id}/identities`,
    {
      method: "POST",
      body: {
        kind: "phone",
        value: "+14045550199",
      },
    },
  ));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.deduplicated, true);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='phone' AND active=1
  `).get(person.id).count, 1);

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`, {
    method: "PATCH",
    body: { email: "Unique-Contact@Example.Test" },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='email' AND active=1
  `).get(person.id).count, 1);

  assert.ok(database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index' AND name='idx_crm_identities_active_contact_value'
  `).get());
});

test("merges preserve alias spend, activity, contacts, tags, filters, and unmerge", async () => {
  const database = migratedDatabase();
  const survivor = await createPerson(database, {
    displayName: "Merge Survivor",
    email: "merge-survivor@example.test",
    tags: ["collector"],
  });
  const duplicate = await createPerson(database, {
    displayName: "Merge Duplicate",
    email: "merge-duplicate@example.test",
    tags: ["collector"],
  });
  const third = await createPerson(database, {
    displayName: "Merge Third",
    email: "merge-third@example.test",
  });

  for (const person of [survivor, duplicate]) {
    const contact = await responseJson(await api(
      database,
      `/api/admin/crm/people/${person.id}/identities`,
      {
        method: "POST",
        body: {
          kind: "phone",
          value: "(404) 555-0144",
          shared: true,
        },
      },
    ));
    assert.equal(contact.response.status, 201);
  }
  for (const [person, amountCents, requestId] of [
    [survivor, 4_000, "merge-survivor-payment"],
    [duplicate, 3_000, "merge-duplicate-payment"],
  ]) {
    const payment = await responseJson(await api(
      database,
      `/api/admin/crm/people/${person.id}/transactions`,
      {
        method: "POST",
        body: {
          requestId,
          transactionType: "charge",
          status: "settled",
          amountCents,
          currency: "USD",
          occurredAt: "2026-07-17T19:00:00.000Z",
        },
      },
    ));
    assert.equal(payment.response.status, 201, JSON.stringify(payment.payload));
  }
  let result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${duplicate.id}/interactions`,
    {
      method: "POST",
      body: {
        interactionType: "tattoo_appointment",
        nodeId: "node-tattoos",
        occurredAt: "2026-07-17T19:30:00.000Z",
      },
    },
  ));
  assert.equal(result.response.status, 201);

  result = await responseJson(await api(database, "/api/admin/crm/people/merge", {
    method: "POST",
    body: {
      survivorPersonId: survivor.id,
      duplicatePersonId: duplicate.id,
      reason: "Confirmed duplicate client records.",
    },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));

  result = await responseJson(await api(database, `/api/admin/crm/people/${survivor.id}`));
  assert.equal(result.payload.person.netSpendCents, 7_000);
  assert.equal(result.payload.person.interactionCount, 1);
  assert.equal(result.payload.transactions.length, 2);
  assert.equal(result.payload.interactions.length, 1);
  assert.equal(
    result.payload.identities.filter(
      (identity) => identity.kind === "phone"
        && identity.normalized_value === "+14045550144"
    ).length,
    1,
  );
  assert.equal(result.payload.tags.filter((tag) => tag.slug === "collector").length, 1);
  assert.deepEqual(result.payload.aliases.map((person) => person.id), [duplicate.id]);

  result = await responseJson(await api(
    database,
    "/api/admin/crm/people?minSpendCents=7000&nodeId=node-tattoos&tag=collector",
  ));
  assert.deepEqual(result.payload.people.map((person) => person.id), [survivor.id]);

  result = await responseJson(await api(database, "/api/admin/crm/people/merge", {
    method: "POST",
    body: {
      survivorPersonId: third.id,
      duplicatePersonId: survivor.id,
      reason: "This must be blocked because it would create a merge chain.",
    },
  }));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.details.code, "MERGE_CHAIN_NOT_ALLOWED");

  result = await responseJson(await api(
    database,
    `/api/admin/crm/people/${duplicate.id}/unmerge`,
    { method: "POST", body: {} },
  ));
  assert.equal(result.response.status, 200);
  const [survivorAfter, duplicateAfter] = await Promise.all([
    responseJson(await api(database, `/api/admin/crm/people/${survivor.id}`)),
    responseJson(await api(database, `/api/admin/crm/people/${duplicate.id}`)),
  ]);
  assert.equal(survivorAfter.payload.person.netSpendCents, 4_000);
  assert.equal(duplicateAfter.payload.person.netSpendCents, 3_000);
  assert.equal(duplicateAfter.payload.person.interactionCount, 1);
});

test("concurrent manual people with one new email create exactly one person", async () => {
  const database = migratedDatabase();
  const sharedEnvironment = env(database);
  const attempts = await Promise.all(
    ["First Concurrent Person", "Second Concurrent Person"].map(async (displayName) => (
      responseJson(await handleAdminCrmApi(request("/api/admin/crm/people", {
        method: "POST",
        admin: true,
        body: {
          displayName,
          email: "manual-concurrent@example.test",
        },
      }), sharedEnvironment))
    )),
  );
  assert.deepEqual(
    attempts.map(({ response }) => response.status).sort((a, b) => a - b),
    [201, 409],
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
    WHERE display_name IN ('First Concurrent Person','Second Concurrent Person')
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE kind='email' AND normalized_value='manual-concurrent@example.test'
      AND active=1
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_email_claim'
      AND external_id='manual-concurrent@example.test'
  `).get().count, 1);
  const conflict = attempts.find(({ response }) => response.status === 409);
  assert.equal(conflict.payload.details.code, "EMAIL_ALREADY_CONNECTED");
  assert.equal(conflict.payload.details.personIds.length, 1);
});

test("the contact uniqueness guard never merges two people who share an email", async () => {
  const database = migratedDatabase();
  const first = await createPerson(database, {
    displayName: "First Household Contact",
    email: "household@example.test",
  });
  const second = await createPerson(database, {
    displayName: "Second Household Contact",
    email: "second-household@example.test",
  });

  database.prepare(`
    UPDATE crm_identities
    SET
      value='household@example.test',
      normalized_value='household@example.test',
      is_shared=1
    WHERE person_id=? AND kind='email'
  `).run(second.id);
  database.prepare(`
    UPDATE crm_identities SET is_shared=1
    WHERE person_id=? AND kind='email'
  `).run(first.id);

  assert.equal(database.prepare(`
    SELECT COUNT(DISTINCT person_id) count
    FROM crm_identities
    WHERE kind='email' AND normalized_value='household@example.test' AND active=1
  `).get().count, 2);
  for (const person of [first, second]) {
    const result = await responseJson(await api(
      database,
      `/api/admin/crm/people/${person.id}/identities`,
      {
        method: "POST",
        body: {
          kind: "phone",
          value: "(404) 555-0177",
          shared: true,
        },
      },
    ));
    assert.equal(result.response.status, 201);
  }
  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  assert.equal(attention.response.status, 200);
  const duplicate = attention.payload.duplicates.find(
    (item) => item.normalizedEmail === "household@example.test"
  );
  assert.ok(duplicate);
  assert.equal(duplicate.personCount, 2);
  const sharedPhone = attention.payload.duplicates.find(
    (item) => item.identityKind === "phone"
      && item.normalizedValue === "+14045550177"
  );
  assert.ok(sharedPhone);
  assert.equal(sharedPhone.personCount, 2);

  const importResult = await responseJson(await api(database, "/api/admin/crm/imports/analyze", {
    method: "POST",
    body: {
      filename: "shared-household.csv",
      content: "Name,Email\r\nHousehold Import,household@example.test",
      config: {
        sourceLabel: "Shared household check",
        defaultInteractionType: "legacy_contact",
        dateFormat: "ymd",
        currency: "USD",
        moneyMode: "none",
      },
    },
  }));
  assert.equal(importResult.response.status, 201, JSON.stringify(importResult.payload));
  assert.equal(importResult.payload.summary.exactMatch, 0);
  assert.equal(importResult.payload.summary.possibleMatch, 1);
  const importRows = await responseJson(await api(
    database,
    `/api/admin/crm/imports/${importResult.payload.importBatch.id}/rows?limit=10`,
  ));
  assert.equal(importRows.payload.rows[0].decision, "review");
  assert.equal(importRows.payload.rows[0].matchDetail.emailShared, true);
});

test("the contact dedupe migration preserves one preferred row and deactivates older copies", () => {
  const database = migratedDatabase("0050_tattoo_day_session_labels.sql");
  const now = "2026-07-17T12:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,created_at,updated_at
    ) VALUES('dedupe-person','Dedupe Person','active','email',?,?)
  `).run(now, now);
  const insertIdentity = database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES(
      ?,'dedupe-person','email',?,'same@example.test',?,'',
      ?,0,0,?,?,?,1,?,?
    )
  `);
  insertIdentity.run(
    "dedupe-local-one",
    "same@example.test",
    "local",
    0,
    "local",
    "submission",
    "submission:one:email",
    "2026-07-15T12:00:00.000Z",
    now,
  );
  insertIdentity.run(
    "dedupe-local-two",
    "SAME@example.test",
    "local",
    0,
    "local",
    "appointment",
    "appointment:two:email",
    "2026-07-16T12:00:00.000Z",
    now,
  );
  insertIdentity.run(
    "dedupe-square-primary",
    "same@example.test",
    "square",
    1,
    "square",
    "customer_profile",
    "square:customer:email",
    "2026-07-17T12:00:00.000Z",
    now,
  );
  database.prepare(`
    UPDATE crm_identities SET is_verified=1
    WHERE id='dedupe-local-one'
  `).run();
  database.prepare(`
    UPDATE crm_identities SET is_shared=1
    WHERE id='dedupe-local-two'
  `).run();

  database.exec(readFileSync(
    join(ROOT, "migrations", "0051_crm_contact_identity_dedupe.sql"),
    "utf8",
  ));

  assert.deepEqual(
    database.prepare(`
      SELECT
        id,provider,source_type,source_id,active,is_primary,is_verified,is_shared
      FROM crm_identities
      WHERE person_id='dedupe-person'
      ORDER BY id
    `).all().map((row) => ({ ...row })),
    [
      {
        id: "dedupe-local-one",
        provider: "local",
        source_type: "submission",
        source_id: "submission:one:email",
        active: 0,
        is_primary: 0,
        is_verified: 1,
        is_shared: 0,
      },
      {
        id: "dedupe-local-two",
        provider: "local",
        source_type: "appointment",
        source_id: "appointment:two:email",
        active: 0,
        is_primary: 0,
        is_verified: 0,
        is_shared: 1,
      },
      {
        id: "dedupe-square-primary",
        provider: "square",
        source_type: "customer_profile",
        source_id: "square:customer:email",
        active: 1,
        is_primary: 1,
        is_verified: 1,
        is_shared: 1,
      },
    ],
  );
  const audit = database.prepare(`
    SELECT action,resource_id,after_json
    FROM crm_audit_events
    WHERE actor='migration:0051'
  `).get();
  assert.equal(audit.action, "duplicate_contact_identities_consolidated");
  assert.equal(audit.resource_id, "dedupe-square-primary");
  assert.deepEqual(JSON.parse(audit.after_json), {
    kind: "email",
    retainedIdentityId: "dedupe-square-primary",
    deactivatedRows: 2,
  });
  assert.throws(() => {
    insertIdentity.run(
      "dedupe-blocked-copy",
      "same@example.test",
      "manual",
      0,
      "manual",
      "identity",
      "manual:copy",
      now,
      now,
    );
  }, /UNIQUE constraint/i);
});

test("phone normalization consolidates country-code formatting without losing source rows", () => {
  const database = migratedDatabase("0051_crm_contact_identity_dedupe.sql");
  const now = "2026-07-17T12:00:00.000Z";
  database.exec(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,created_at,updated_at
    ) VALUES
      ('phone-format-person','Phone Format Person','active','phone','${now}','${now}'),
      ('single-phone-person','Single Phone Person','active','phone','${now}','${now}');

    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES
      (
        'phone-format-local','phone-format-person','phone','(404) 555-0199',
        '4045550199','local','',0,0,0,'local','appointment',
        'appointment:phone-format:phone',1,
        '2026-07-15T12:00:00.000Z','${now}'
      ),
      (
        'phone-format-square','phone-format-person','phone','+1 404 555 0199',
        '+14045550199','square','',1,0,0,'square','customer_profile',
        'square:phone-format:phone',1,
        '2026-07-16T12:00:00.000Z','${now}'
      ),
      (
        'phone-format-single','single-phone-person','phone','404-555-0188',
        '4045550188','local','',1,0,0,'local','submission',
        'submission:single-phone:phone',1,
        '2026-07-16T12:00:00.000Z','${now}'
      );
  `);

  database.exec(readFileSync(
    join(ROOT, "migrations", "0052_crm_phone_normalization.sql"),
    "utf8",
  ));

  assert.deepEqual(
    database.prepare(`
      SELECT id,normalized_value,source_type,source_id,active,is_primary
      FROM crm_identities
      WHERE person_id='phone-format-person'
      ORDER BY id
    `).all().map((row) => ({ ...row })),
    [
      {
        id: "phone-format-local",
        normalized_value: "4045550199",
        source_type: "appointment",
        source_id: "appointment:phone-format:phone",
        active: 0,
        is_primary: 0,
      },
      {
        id: "phone-format-square",
        normalized_value: "+14045550199",
        source_type: "customer_profile",
        source_id: "square:phone-format:phone",
        active: 1,
        is_primary: 1,
      },
    ],
  );
  assert.equal(database.prepare(`
    SELECT normalized_value FROM crm_identities
    WHERE id='phone-format-single' AND active=1
  `).get().normalized_value, "+14045550188");
  const audit = database.prepare(`
    SELECT action,resource_id,after_json
    FROM crm_audit_events
    WHERE actor='migration:0052'
  `).get();
  assert.equal(audit.action, "duplicate_phone_formats_consolidated");
  assert.equal(audit.resource_id, "phone-format-square");
  assert.equal(JSON.parse(audit.after_json).deactivatedRows, 1);
});

test("email claim backfill reserves only unique non-shared email owners", () => {
  const database = migratedDatabase("0052_crm_phone_normalization.sql");
  const now = "2026-07-17T12:00:00.000Z";
  database.exec(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,created_at,updated_at
    ) VALUES
      ('unique-email-person','Unique Email','active','email','${now}','${now}'),
      ('shared-email-one','Shared Email One','active','email','${now}','${now}'),
      ('shared-email-two','Shared Email Two','active','email','${now}','${now}'),
      ('stale-claim-person','Stale Claim Person','active','','${now}','${now}'),
      ('orphan-claim-person','Orphan Claim Person','active','','${now}','${now}');

    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES
      (
        'unique-email-identity','unique-email-person','email',
        'unique-claim@example.test','unique-claim@example.test','manual','',
        1,0,0,'manual','person_create','unique-email:email',1,'${now}','${now}'
      ),
      (
        'shared-email-identity-one','shared-email-one','email',
        'shared-claim@example.test','shared-claim@example.test','manual','',
        1,0,1,'manual','person_create','shared-email-one:email',1,'${now}','${now}'
      ),
      (
        'shared-email-identity-two','shared-email-two','email',
        'shared-claim@example.test','shared-claim@example.test','manual','',
        1,0,1,'manual','person_create','shared-email-two:email',1,'${now}','${now}'
      );

    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES
      (
        'stale-unique-claim','stale-claim-person','other',
        'unique-claim@example.test','unique-claim@example.test',
        'crm_email_claim','unique-claim@example.test','',
        0,0,0,'system','email_claim',NULL,0,'${now}','${now}'
      ),
      (
        'stale-shared-claim','shared-email-one','other',
        'shared-claim@example.test','shared-claim@example.test',
        'crm_email_claim','shared-claim@example.test','',
        0,0,0,'system','email_claim',NULL,0,'${now}','${now}'
      ),
      (
        'orphan-email-claim','orphan-claim-person','other',
        'orphan-claim@example.test','orphan-claim@example.test',
        'crm_email_claim','orphan-claim@example.test','',
        0,0,0,'system','email_claim',NULL,0,'${now}','${now}'
      );
  `);
  const migration = readFileSync(
    join(ROOT, "migrations", "0053_crm_email_claim_backfill.sql"),
    "utf8",
  );
  database.exec(migration);
  database.exec(migration);

  assert.deepEqual(
    database.prepare(`
      SELECT person_id,external_id,active
      FROM crm_identities
      WHERE provider='crm_email_claim'
      ORDER BY external_id
    `).all().map((row) => ({ ...row })),
    [{
      person_id: "unique-email-person",
      external_id: "unique-claim@example.test",
      active: 0,
    }],
  );
});

test("single-primary migration preserves alternate identities and blocks primary races", () => {
  const database = migratedDatabase("0053_crm_email_claim_backfill.sql");
  const now = "2026-07-17T20:00:00.000Z";
  database.exec(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,created_at,updated_at
    ) VALUES('primary-person','Primary Person','active','email','${now}','${now}');

    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,label,
      is_primary,is_verified,is_shared,source_provider,source_type,source_id,
      active,created_at,updated_at
    ) VALUES
      (
        'primary-unverified','primary-person','email','first@example.test',
        'first@example.test','manual','',1,0,0,'manual','identity',
        'primary:first',1,'2026-07-16T20:00:00.000Z','${now}'
      ),
      (
        'primary-verified','primary-person','email','second@example.test',
        'second@example.test','square','',1,1,0,'square','customer_profile',
        'primary:second',1,'2026-07-17T20:00:00.000Z','${now}'
      );
  `);
  database.exec(readFileSync(
    join(ROOT, "migrations", "0054_crm_single_primary_identity.sql"),
    "utf8",
  ));

  assert.deepEqual(
    database.prepare(`
      SELECT id,is_primary FROM crm_identities
      WHERE person_id='primary-person' AND kind='email'
      ORDER BY id
    `).all().map((row) => ({ ...row })),
    [
      { id: "primary-unverified", is_primary: 0 },
      { id: "primary-verified", is_primary: 1 },
    ],
  );
  assert.equal(database.prepare(`
    SELECT action FROM crm_audit_events
    WHERE actor='migration:0054' AND person_id='primary-person'
  `).get().action, "multiple_primary_identities_repaired");
  assert.throws(() => {
    database.prepare(`
      INSERT INTO crm_identities(
        id,person_id,kind,value,normalized_value,provider,label,
        is_primary,is_verified,is_shared,source_provider,source_type,source_id,
        active,created_at,updated_at
      ) VALUES(
        'blocked-primary','primary-person','email','third@example.test',
        'third@example.test','manual','',1,0,0,'manual','identity',
        'primary:third',1,?,?
      )
    `).run(now, now);
  }, /UNIQUE constraint/i);
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
  assert.equal(importedPeople[0].eligibility_reason, "studio_csv_import");
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
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_email_claim' AND external_id='new@example.com'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_import_row_claim' AND import_batch_id=?
  `).get(importId).count, 0);

  result = await responseJson(await api(database, "/api/admin/crm/people", {
    method: "POST",
    body: {
      displayName: "Reused After Rollback",
      email: "new@example.com",
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));

  result = await responseJson(await api(database, `/api/admin/crm/imports/${importId}/rollback`, {
    method: "POST",
    body: {},
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.idempotent, true);
});

test("concurrent phone-only import apply calls create one person", async () => {
  const database = migratedDatabase();
  let result = await responseJson(await api(database, "/api/admin/crm/imports/analyze", {
    method: "POST",
    body: {
      filename: "phone-only-race.csv",
      content: "Name,Phone\r\nImport Race Person,4045550166",
      config: {
        sourceLabel: "Phone-only race",
        defaultInteractionType: "legacy_contact",
        defaultNodeId: "node-tattoos",
        dateFormat: "ymd",
        currency: "USD",
        moneyMode: "none",
      },
    },
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  assert.equal(result.payload.summary.newPerson, 1);
  const importId = result.payload.importBatch.id;
  const path = `/api/admin/crm/imports/${importId}/apply`;
  const sharedEnvironment = env(database);
  const attempts = await Promise.all([0, 1].map(async () => responseJson(
    await handleAdminCrmApi(request(path, {
      method: "POST",
      admin: true,
      body: { limit: 100 },
    }), sharedEnvironment),
  )));
  assert.ok(attempts.every(({ response }) => response.status === 200));
  assert.equal(
    attempts.reduce(
      (sum, { payload }) => sum + Number(payload.createdPersonIds?.length || 0),
      0,
    ),
    1,
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
    WHERE display_name='Import Race Person'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='legacy_import' AND source_type='legacy_row' AND active=1
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_import_row_claim' AND import_batch_id=?
  `).get(importId).count, 1);
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
  assert.equal("submissions" in result.payload.processed, false);
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

test("concurrent phone-only appointment backfills reserve one source owner", async () => {
  const database = migratedDatabase();
  const now = "2026-07-17T18:30:00.000Z";
  database.prepare(`
    INSERT INTO appointments(
      id,booking_type_id,status,purpose,client_name,client_email,client_phone,
      start_at,end_at,deposit_cents,currency,created_at,updated_at
    ) VALUES(
      'appointment-phone-only-race','tattoo_half','confirmed','tattoo',
      'Phone Only Person','','4045550123',
      '2026-08-01T12:00:00.000Z','2026-08-01T15:00:00.000Z',
      0,'USD',?,?
    )
  `).run(now, now);

  const sharedEnvironment = env(database);
  const attempts = await Promise.all([0, 1].map(async () => responseJson(
    await handleAdminCrmApi(request("/api/admin/crm/backfill", {
      method: "POST",
      admin: true,
      body: { limit: 100 },
    }), sharedEnvironment),
  )));
  assert.ok(attempts.every(({ response }) => response.status === 200));
  assert.equal(
    attempts.reduce((sum, { payload }) => sum + Number(payload.createdPeople || 0), 0),
    1,
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
    WHERE display_name='Phone Only Person'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='local' AND source_type='appointment'
      AND source_id='appointment-phone-only-race' AND active=1
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_local_source_claim'
      AND external_id='appointment:appointment-phone-only-race'
  `).get().count, 1);
});

test("historical backfill keeps cancelled appointments eligible without importing unpaid deposits", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO appointments(
      id,booking_type_id,status,purpose,client_name,client_email,
      start_at,end_at,deposit_cents,currency,created_at,updated_at
    ) VALUES(
      'cancelled-deposit-appointment','tattoo_half','cancelled','tattoo',
      'Cancelled Deposit Client','cancelled-deposit@example.test',
      '2026-08-01T12:00:00.000Z','2026-08-01T15:00:00.000Z',
      10000,'USD',?,?
    )
  `).run(createdAt, createdAt);
  database.prepare(`
    INSERT INTO deposit_payments(
      id,appointment_id,provider,amount_cents,currency,status,
      raw_json,created_at,updated_at
    ) VALUES(
      'cancelled-deposit-payment','cancelled-deposit-appointment','square',
      10000,'USD','cancelled','{}',?,?
    )
  `).run(createdAt, createdAt);

  const result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(database.prepare(`
    SELECT COUNT(*) count
    FROM crm_transactions
    WHERE source_provider='local' AND source_type='deposit_payment'
      AND source_id='cancelled-deposit-payment'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
    WHERE eligibility_reason='website_booking'
  `).get().count, 1);
});

test("historical backfill does not duplicate a Square transaction imported first", async () => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Square First Guest",
    email: "square-first-guest@example.test",
  });
  const paidAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      external_order_id,note,metadata_json,active,created_at,updated_at
    ) VALUES(
      'square-first-event-payment',?,'node-events','charge','settled',4500,0,
      'USD',?,'square','payment','square-first-payment',
      'square-first-order','Square ticket payment','{}',1,?,?
    )
  `).run(person.id, paidAt, paidAt, paidAt);
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      square_order_id,square_payment_id,paid_at,created_at,updated_at
    ) VALUES(
      'square-first-ticket','evt_signal_symbol','Square First Guest',
      'square-first-guest@example.test',1,4500,'USD','paid',
      'square-first-order','square-first-payment',?,?,?
    )
  `).run(paidAt, paidAt, paidAt);

  const result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions WHERE active=1
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='local' AND active=1
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions WHERE id='square-first-event-payment'
  `).get().person_id, person.id);

  const profile = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.person.netSpendCents, 4_500);
});

test("historical backfill repairs a cancelled ticket after paid and refunded evidence arrives", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-01T15:00:00.000Z";
  const paidAt = "2026-07-02T15:00:00.000Z";
  const cancelledAt = "2026-07-03T15:00:00.000Z";
  database.prepare(`
    INSERT INTO event_tickets(
      id,event_id,contact_name,contact_email,seats,amount_cents,currency,status,
      created_at,updated_at,cancelled_at
    ) VALUES(
      'ticket-lifecycle-backfill','evt_signal_symbol','Refunded Guest',
      'refunded-guest@example.test',1,5000,'USD','cancelled',?,?,?
    )
  `).run(createdAt, createdAt, createdAt);

  let result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count
    FROM crm_transactions
    WHERE source_provider='local' AND source_type='event_ticket_payment'
      AND source_id='ticket-lifecycle-backfill'
  `).get().count, 0);

  database.prepare(`
    UPDATE event_tickets
    SET paid_at=?,square_payment_id='square-ticket-lifecycle-payment',
        refund_id='square-ticket-lifecycle-refund',
        raw_json='{"eventRefund":{"id":"square-ticket-lifecycle-refund","status":"COMPLETED"}}',
        cancelled_at=?,updated_at=?
    WHERE id='ticket-lifecycle-backfill'
  `).run(paidAt, cancelledAt, cancelledAt);
  result = await responseJson(await api(database, "/api/admin/crm/backfill", {
    method: "POST",
    body: { limit: 100 },
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));

  assert.deepEqual(
    database.prepare(`
      SELECT transaction_type,status,amount_cents,source_type,source_id
      FROM crm_transactions
      WHERE source_provider='local' AND person_id IS NOT NULL
      ORDER BY transaction_type
    `).all().map((row) => ({ ...row })),
    [
      {
        transaction_type: "charge",
        status: "settled",
        amount_cents: 5000,
        source_type: "event_ticket_payment",
        source_id: "ticket-lifecycle-backfill",
      },
      {
        transaction_type: "refund",
        status: "settled",
        amount_cents: 5000,
        source_type: "event_ticket_refund",
        source_id: "square-ticket-lifecycle-refund",
      },
    ],
  );
  const person = database.prepare(
    "SELECT id FROM crm_people WHERE display_name='Refunded Guest'"
  ).get();
  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.settledGrossCents, 5_000);
  assert.equal(result.payload.person.refundCents, 5_000);
  assert.equal(result.payload.person.netSpendCents, 0);
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

test("Shopify customer profiles alone cannot create People records", async () => {
  const database = migratedDatabase();
  const shopifyEnv = {
    SHOPIFY_STORE_DOMAIN: "construct-test.myshopify.com",
    SHOPIFY_ADMIN_ACCESS_TOKEN: "shopify-test-token",
  };
  const result = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, "construct-test.myshopify.com");
    const body = JSON.parse(options.body);
    if (body.query.includes("CrmOrders")) {
      return Response.json({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    if (body.query.includes("CrmCustomers")) {
      return Response.json({
        data: {
          customers: {
            nodes: [{
              id: "gid://shopify/Customer/profile-only",
              displayName: "Profile Only",
              email: "profile-only@example.test",
              phone: "+14045550111",
              createdAt: "2026-07-01T12:00:00.000Z",
              updatedAt: "2026-07-01T12:00:00.000Z",
              tags: [],
              emailMarketingConsent: null,
              smsMarketingConsent: null,
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    throw new Error(`Unexpected Shopify query at ${url}`);
  }, async () => responseJson(await api(database, "/api/admin/crm/sync/shopify", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: shopifyEnv,
  })));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.status, "complete");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_identities").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
});

test("phone-only paid Shopify orders create one eligible replay-safe person", async () => {
  const database = migratedDatabase();
  const shopifyEnv = {
    SHOPIFY_STORE_DOMAIN: "construct-test.myshopify.com",
    SHOPIFY_ADMIN_ACCESS_TOKEN: "shopify-test-token",
  };
  const order = {
    id: "gid://shopify/Order/phone-only",
    name: "#PHONE",
    email: null,
    phone: "+1 (404) 555-0199",
    customer: null,
    processedAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:01:00.000Z",
    displayFinancialStatus: "PAID",
    fullyPaid: true,
    unpaid: false,
    test: false,
    sourceName: "web",
    tags: [],
    currentTotalPriceSet: {
      shopMoney: { amount: "45.00", currencyCode: "USD" },
    },
    totalReceivedSet: {
      shopMoney: { amount: "45.00", currencyCode: "USD" },
    },
    totalRefundedSet: {
      shopMoney: { amount: "0.00", currencyCode: "USD" },
    },
    totalTipReceivedSet: {
      shopMoney: { amount: "0.00", currencyCode: "USD" },
    },
    transactions: [{
      id: "gid://shopify/OrderTransaction/phone-only",
      kind: "SALE",
      status: "SUCCESS",
      gateway: "shopify_payments",
      processedAt: "2026-07-10T15:00:00.000Z",
      amountSet: {
        shopMoney: { amount: "45.00", currencyCode: "USD" },
      },
    }],
    refunds: [],
    lineItems: {
      nodes: [],
      pageInfo: { hasNextPage: false },
    },
  };
  const responses = await withMockFetch(async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, "construct-test.myshopify.com");
    const body = JSON.parse(options.body);
    if (body.query.includes("CrmOrders")) {
      return Response.json({
        data: {
          orders: {
            nodes: [order],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    if (body.query.includes("CrmCustomers")) {
      return Response.json({
        data: {
          customers: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    throw new Error(`Unexpected Shopify query at ${url}`);
  }, async () => [
    await responseJson(await api(database, "/api/admin/crm/sync/shopify", {
      method: "POST",
      body: { mode: "full", maxPages: 4 },
      env: shopifyEnv,
    })),
    await responseJson(await api(database, "/api/admin/crm/sync/shopify", {
      method: "POST",
      body: { mode: "full", maxPages: 4 },
      env: shopifyEnv,
    })),
  ]);
  for (const result of responses) {
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.status, "complete");
  }
  assert.deepEqual(
    { ...database.prepare(`
      SELECT eligibility_reason,eligibility_source_provider,eligibility_source_type
      FROM crm_people
    `).get() },
    {
      eligibility_reason: "paid_shopify_order",
      eligibility_source_provider: "shopify",
      eligibility_source_type: "order",
    },
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='shopify' AND person_id IS NOT NULL
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='shopify' AND source_type='order'
  `).get().count, 1);
});

test("Square sync persists normalized CRM records and repeats idempotently", async (t) => {
  const database = migratedDatabase();
  await createPerson(database, {
    displayName: "square.friend@example.com",
    email: "square.friend@example.com",
  });
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
    ["/v2/payments", "/v2/customers/bulk-retrieve", "/v2/refunds"],
  );

  const person = database.prepare("SELECT * FROM crm_people").get();
  assert.equal(person.display_name, "square.friend@example.com");
  assert.equal(person.preferred_contact_method, "email");
  assert.deepEqual(
    database.prepare(`
      SELECT kind,value,normalized_value,provider,external_id
      FROM crm_identities WHERE person_id=? AND active=1 ORDER BY kind
    `).all(person.id).map((row) => ({ ...row })),
    [
      {
        kind: "email",
        value: "square.friend@example.com",
        normalized_value: "square.friend@example.com",
        provider: "manual",
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
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_identities WHERE active=1"
  ).get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 1);
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/v2/payments",
      "/v2/customers/bulk-retrieve",
      "/v2/refunds",
      "/v2/payments",
      "/v2/customers/bulk-retrieve",
      "/v2/refunds",
    ],
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

test("Square sync enriches linked payments from customer profiles", async (t) => {
  const database = migratedDatabase();
  const placeholderPersonId = "square-profile-placeholder-person";
  const placeholderCreatedAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,
      eligibility_at,eligibility_reason,eligibility_source_provider,
      eligibility_source_type,eligibility_source_id,created_at,updated_at
    ) VALUES(?,'square contact','active','',?,'studio_manual_entry','studio',
      'manual_entry',?, ?,?)
  `).run(
    placeholderPersonId,
    placeholderCreatedAt,
    placeholderPersonId,
    placeholderCreatedAt,
    placeholderCreatedAt,
  );
  database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,
      source_provider,source_type,source_id,created_at,updated_at
    ) VALUES(
      'square-profile-placeholder-identity',?,'square_customer',
      'square-customer-profile-enrichment',
      'square-customer-profile-enrichment','square',
      'square-customer-profile-enrichment','square','provider_contact',
      'square:square-customer-profile-enrichment',?,?
    )
  `).run(placeholderPersonId, placeholderCreatedAt, placeholderCreatedAt);
  const calls = installSquareApiMock(t, {
    payments: [{
      id: "square-payment-profile-enrichment",
      status: "COMPLETED",
      customer_id: "square-customer-profile-enrichment",
      order_id: "square-order-profile-enrichment",
      location_id: "square-tattoo-location",
      total_money: { amount: 15_000, currency: "USD" },
      tip_money: { amount: 2_500, currency: "USD" },
      source_type: "CARD",
      reference_id: "Customer profile enrichment",
      created_at: "2026-07-13T15:00:00.000Z",
      updated_at: "2026-07-13T15:01:00.000Z",
    }],
    customers: [{
      id: "square-customer-profile-enrichment",
      given_name: "Morgan",
      family_name: "Rivera",
      email_address: "Morgan.Rivera@example.test",
      phone_number: "(404) 555-0176",
      created_at: "2025-02-01T12:00:00.000Z",
      updated_at: "2026-07-12T12:00:00.000Z",
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");

  const customerLookup = calls.find(
    (call) => call.url.pathname === "/v2/customers/bulk-retrieve"
  );
  assert.ok(customerLookup);
  assert.deepEqual(
    customerLookup.body,
    { customer_ids: ["square-customer-profile-enrichment"] },
  );

  const person = database.prepare(`
    SELECT id,display_name,preferred_contact_method FROM crm_people
  `).get();
  assert.equal(person.id, placeholderPersonId);
  assert.deepEqual(
    {
      display_name: person.display_name,
      preferred_contact_method: person.preferred_contact_method,
    },
    {
      display_name: "Morgan Rivera",
      preferred_contact_method: "email",
    },
  );
  assert.deepEqual(
    database.prepare(`
      SELECT kind,normalized_value,provider,external_id
      FROM crm_identities
      WHERE person_id=? AND active=1
      ORDER BY kind
    `).all(person.id).map((row) => ({ ...row })),
    [
      {
        kind: "email",
        normalized_value: "morgan.rivera@example.test",
        provider: "square",
        external_id: null,
      },
      {
        kind: "phone",
        normalized_value: "+14045550176",
        provider: "square",
        external_id: null,
      },
      {
        kind: "square_customer",
        normalized_value: "square-customer-profile-enrichment",
        provider: "square",
        external_id: "square-customer-profile-enrichment",
      },
    ],
  );
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square'
      AND source_id='square-payment-profile-enrichment'
  `).get().person_id, person.id);
});

test("Square customer contact changes are retained on a later full sync", async (t) => {
  const database = migratedDatabase();
  const customer = {
    id: "square-customer-contact-change",
    given_name: "Jordan",
    family_name: "Lee",
    email_address: "jordan.old@example.test",
    phone_number: "(404) 555-0101",
    created_at: "2025-02-01T12:00:00.000Z",
    updated_at: "2026-07-12T12:00:00.000Z",
  };
  await createPerson(database, {
    displayName: "Jordan Lee",
    email: customer.email_address,
  });
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-contact-change",
      status: "COMPLETED",
      customer_id: customer.id,
      location_id: "square-tattoo-location",
      total_money: { amount: 11_000, currency: "USD" },
      tip_money: { amount: 1_000, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T15:00:00.000Z",
      updated_at: "2026-07-13T15:01:00.000Z",
    }],
    customers: [customer],
  });

  let sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));

  customer.email_address = "jordan.new@example.test";
  customer.phone_number = "(404) 555-0202";
  customer.updated_at = "2026-07-14T12:00:00.000Z";
  sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");

  const person = database.prepare(`
    SELECT person_id FROM crm_identities
    WHERE provider='square' AND external_id=?
  `).get(customer.id);
  assert.ok(person?.person_id);
  assert.deepEqual(
    database.prepare(`
      SELECT kind,normalized_value FROM crm_identities
      WHERE person_id=? AND kind IN ('email','phone') AND active=1
      ORDER BY kind,normalized_value
    `).all(person.person_id).map((row) => ({ ...row })),
    [
      { kind: "email", normalized_value: "jordan.new@example.test" },
      { kind: "email", normalized_value: "jordan.old@example.test" },
      { kind: "phone", normalized_value: "+14045550101" },
      { kind: "phone", normalized_value: "+14045550202" },
    ],
  );
});

test("Square payments still import when customer profile lookup is unavailable", async (t) => {
  const database = migratedDatabase();
  const eligible = await createPerson(database, {
    displayName: "Known Square Client",
    email: "known-square-client@example.test",
  });
  const linkedAt = "2026-07-01T12:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,
      source_provider,source_type,source_id,created_at,updated_at
    ) VALUES(
      'square-profile-unavailable-identity',?,'square_customer',
      'square-customer-profile-unavailable','square-customer-profile-unavailable',
      'square','square-customer-profile-unavailable','square','provider_contact',
      'square:square-customer-profile-unavailable',?,?
    )
  `).run(eligible.id, linkedAt, linkedAt);
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-profile-unavailable",
      status: "COMPLETED",
      customer_id: "square-customer-profile-unavailable",
      order_id: "square-order-profile-unavailable",
      location_id: "square-tattoo-location",
      total_money: { amount: 9_500, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Payment without customer permission",
      created_at: "2026-07-13T16:00:00.000Z",
      updated_at: "2026-07-13T16:01:00.000Z",
    }],
    customerLookupStatus: 403,
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");
  assert.ok(sync.payload.warnings.some((warning) => /customer/i.test(warning)));

  const transaction = database.prepare(`
    SELECT person_id,status,amount_cents
    FROM crm_transactions
    WHERE source_provider='square'
      AND source_id='square-payment-profile-unavailable'
  `).get();
  assert.ok(transaction?.person_id);
  assert.equal(transaction.status, "settled");
  assert.equal(transaction.amount_cents, 9_500);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='square'
      AND source_id='square-payment-profile-unavailable'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='square'
      AND external_id='square-customer-profile-unavailable'
  `).get(transaction.person_id).count, 1);
});

test("a resumed Square sync preserves earlier customer-profile warnings and stats", async (t) => {
  const database = migratedDatabase();
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-resumed-warning",
      status: "COMPLETED",
      customer_id: "square-customer-resumed-warning",
      location_id: "square-tattoo-location",
      total_money: { amount: 6_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:10:00.000Z",
      updated_at: "2026-07-13T16:11:00.000Z",
    }],
    customerLookupStatus: 403,
  });

  const first = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 1 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.status, "pending");
  assert.equal(first.payload.stats.customerProfilesRequested, 1);
  assert.ok(first.payload.warnings.some((warning) => /CUSTOMERS_READ/.test(warning)));

  const second = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 1 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.status, "complete");
  assert.equal(second.payload.stats.customerProfilesRequested, 1);
  assert.equal(second.payload.stats.accepted, 1);
  assert.ok(second.payload.warnings.some((warning) => /CUSTOMERS_READ/.test(warning)));

  const status = await responseJson(await api(database, "/api/admin/crm/sync/status", {
    env: SQUARE_SYNC_ENV,
  }));
  const square = status.payload.providers.find((provider) => provider.id === "square");
  assert.equal(square.lastSync.status, "complete");
  assert.ok(square.lastSync.warnings.some((warning) => /CUSTOMERS_READ/.test(warning)));
});

test("Square customer-profile authentication failures do not advance or import the page", async (t) => {
  const database = migratedDatabase();
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-profile-auth-failure",
      status: "COMPLETED",
      customer_id: "square-customer-profile-auth-failure",
      location_id: "square-tattoo-location",
      total_money: { amount: 11_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:20:00.000Z",
      updated_at: "2026-07-13T16:21:00.000Z",
    }],
    customerLookupStatus: 401,
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 502, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "failed");
  assert.equal(sync.payload.error.code, "square_http_error");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
  const checkpoint = JSON.parse(database.prepare(`
    SELECT checkpoint_json FROM crm_sync_jobs WHERE provider='square'
  `).get().checkpoint_json);
  assert.equal(checkpoint.taskIndex, 0);
});

test("retryable per-customer Square errors keep the payment page resumable", async (t) => {
  const database = migratedDatabase();
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-profile-retry",
      status: "COMPLETED",
      customer_id: "square-customer-profile-retry",
      location_id: "square-tattoo-location",
      total_money: { amount: 12_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:25:00.000Z",
      updated_at: "2026-07-13T16:26:00.000Z",
    }],
    customerLookupPayload: {
      responses: {
        "square-customer-profile-retry": {
          errors: [{
            category: "API_ERROR",
            code: "INTERNAL_SERVER_ERROR",
            detail: "Temporary customer service error.",
          }],
        },
      },
    },
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 502, JSON.stringify(sync.payload));
  assert.equal(sync.payload.error.code, "square_customer_profile_retryable_error");
  assert.equal(sync.payload.error.retryable, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
});

test("Square sync accepts Square's canonical customer id after a profile merge", async (t) => {
  const database = migratedDatabase();
  await createPerson(database, {
    displayName: "square contact",
    email: "morgan-merged@example.test",
  });
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-merged-profile",
      status: "COMPLETED",
      customer_id: "square-customer-merged-old",
      location_id: "square-tattoo-location",
      total_money: { amount: 7_500, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:30:00.000Z",
      updated_at: "2026-07-13T16:31:00.000Z",
    }],
    customerLookupPayload: {
      responses: {
        "square-customer-merged-old": {
          customer: {
            id: "square-customer-merged-canonical",
            given_name: "Morgan",
            family_name: "Merged",
            email_address: "morgan-merged@example.test",
          },
        },
      },
    },
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");
  assert.equal(sync.payload.stats.customerProfilesReceived, 1);
  assert.equal(sync.payload.stats.customerProfilesCanonicalized, 1);
  assert.equal(sync.payload.stats.customerProfilesUnavailable, 0);
  const person = database.prepare(
    "SELECT id,display_name FROM crm_people"
  ).get();
  assert.equal(person.display_name, "Morgan Merged");
  assert.deepEqual(
    database.prepare(`
      SELECT external_id FROM crm_identities
      WHERE person_id=? AND kind='square_customer'
      ORDER BY external_id
    `).all(person.id).map((row) => row.external_id),
    [
      "square-customer-merged-canonical",
      "square-customer-merged-old",
    ],
  );
  const transaction = database.prepare(`
    SELECT external_customer_id,metadata_json FROM crm_transactions
    WHERE source_provider='square' AND source_type='payment'
  `).get();
  assert.equal(transaction.external_customer_id, "square-customer-merged-old");
  assert.equal(
    JSON.parse(transaction.metadata_json).canonicalCustomerExternalId,
    "square-customer-merged-canonical",
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='email'
  `).get(person.id).count, 1);
});

test("a merged Square customer id conflict remains separated for owner review", async (t) => {
  const database = migratedDatabase();
  const oldIdOwner = await createPerson(database, {
    displayName: "Old Square Id Owner",
    email: "old-square-id-owner@example.test",
  });
  const canonicalIdOwner = await createPerson(database, {
    displayName: "Canonical Square Id Owner",
    email: "canonical-square-id-owner@example.test",
  });
  const occurredAt = "2026-07-13T16:35:00.000Z";
  for (const [identityId, personId, externalId] of [
    ["square-merged-old-owner", oldIdOwner.id, "square-customer-conflict-old"],
    [
      "square-merged-canonical-owner",
      canonicalIdOwner.id,
      "square-customer-conflict-canonical",
    ],
  ]) {
    database.prepare(`
      INSERT INTO crm_identities(
        id,person_id,kind,value,normalized_value,provider,external_id,
        source_provider,source_type,source_id,created_at,updated_at
      ) VALUES(
        ?,?,'square_customer',?,?, 'square',?,
        'square','provider_contact',?,?,?
      )
    `).run(
      identityId,
      personId,
      externalId,
      externalId,
      externalId,
      `square:${externalId}`,
      occurredAt,
      occurredAt,
    );
  }
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-merged-id-conflict",
      status: "COMPLETED",
      customer_id: "square-customer-conflict-old",
      location_id: "square-tattoo-location",
      total_money: { amount: 8_500, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
    customerLookupPayload: {
      responses: {
        "square-customer-conflict-old": {
          customer: {
            id: "square-customer-conflict-canonical",
            given_name: "Returned",
            family_name: "Merged Profile",
          },
        },
      },
    },
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.stats.customerProfilesCanonicalized, 1);
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square' AND source_id='square-payment-merged-id-conflict'
  `).get().person_id, oldIdOwner.id);
  assert.deepEqual(
    database.prepare(`
      SELECT external_id,person_id FROM crm_identities
      WHERE provider='square'
        AND external_id IN (
          'square-customer-conflict-old',
          'square-customer-conflict-canonical'
        )
      ORDER BY external_id
    `).all().map((row) => ({ ...row })),
    [
      {
        external_id: "square-customer-conflict-canonical",
        person_id: canonicalIdOwner.id,
      },
      {
        external_id: "square-customer-conflict-old",
        person_id: oldIdOwner.id,
      },
    ],
  );
  assert.equal(database.prepare(
    "SELECT display_name FROM crm_people WHERE id=?"
  ).get(oldIdOwner.id).display_name, "Old Square Id Owner");
  assert.equal(database.prepare(
    "SELECT display_name FROM crm_people WHERE id=?"
  ).get(canonicalIdOwner.id).display_name, "Canonical Square Id Owner");

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:payment:square-payment-merged-id-conflict"
  );
  assert.ok(conflict);
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).conflicts,
    ["exact_identity_anchor_disagreement"],
  );
});

test("an empty Square customer profile cannot create a People record", async (t) => {
  const database = migratedDatabase();
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-empty-profile",
      status: "COMPLETED",
      customer_id: "square-customer-empty-profile",
      location_id: "square-tattoo-location",
      total_money: { amount: 4_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      shipping_address: {
        first_name: "Shipping",
        last_name: "Recipient",
      },
      source_type: "CASH",
      created_at: "2026-07-13T16:40:00.000Z",
      updated_at: "2026-07-13T16:41:00.000Z",
    }],
    customers: [{ id: "square-customer-empty-profile" }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.stats.customerProfilesReceived, 0);
  assert.equal(sync.payload.stats.customerProfilesEmpty, 1);
  assert.equal(sync.payload.stats.customerProfilesUnavailable, 0);
  assert.equal(sync.payload.stats.paymentNameHintsReceived, 0);
  assert.ok(sync.payload.warnings.some((warning) => /no public name/i.test(warning)));
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
});

test("Square payment name hints label exact customers without matching people by name", async (t) => {
  const database = migratedDatabase();
  const existing = await createPerson(database, {
    displayName: "Alex Billing",
    email: "existing-alex-billing@example.test",
  });
  installSquareApiMock(t, {
    payments: [
      {
        id: "square-payment-billing-name",
        status: "COMPLETED",
        customer_id: "square-customer-billing-name",
        location_id: "square-tattoo-location",
        billing_address: {
          first_name: "Alex",
          last_name: "Billing",
        },
        card_details: {
          card: {
            cardholder_name: "Cardholder Name",
          },
        },
        shipping_address: {
          first_name: "Shipping",
          last_name: "Name",
        },
        total_money: { amount: 5_000, currency: "USD" },
        tip_money: { amount: 0, currency: "USD" },
        source_type: "CARD",
        created_at: "2026-07-13T16:45:00.000Z",
        updated_at: "2026-07-13T16:46:00.000Z",
      },
      {
        id: "square-payment-cardholder-name",
        status: "COMPLETED",
        customer_id: "square-customer-cardholder-name",
        location_id: "square-tattoo-location",
        card_details: {
          card: {
            cardholder_name: "Taylor Cardholder",
          },
        },
        total_money: { amount: 6_000, currency: "USD" },
        tip_money: { amount: 1_000, currency: "USD" },
        source_type: "CARD",
        created_at: "2026-07-13T16:50:00.000Z",
        updated_at: "2026-07-13T16:51:00.000Z",
      },
    ],
    customers: [
      { id: "square-customer-billing-name" },
      { id: "square-customer-cardholder-name" },
    ],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.stats.paymentNameHintsReceived, 2);
  assert.equal(sync.payload.stats.customerProfilesEmpty, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE kind='square_customer' OR provider='square_payer_label'
  `).get().count, 0);
  assert.equal(database.prepare(
    "SELECT display_name FROM crm_people WHERE id=?"
  ).get(existing.id).display_name, "Alex Billing");
});

test("a later Square customer profile replaces an unverified payer label", async (t) => {
  const database = migratedDatabase();
  const customer = {
    id: "square-customer-later-profile",
    email_address: "later-profile@example.test",
  };
  await createPerson(database, {
    displayName: "square contact",
    email: customer.email_address,
  });
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-later-profile",
      status: "COMPLETED",
      customer_id: customer.id,
      location_id: "square-tattoo-location",
      card_details: {
        card: {
          cardholder_name: "Unverified Card Name",
        },
      },
      total_money: { amount: 9_000, currency: "USD" },
      tip_money: { amount: 1_000, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:52:00.000Z",
      updated_at: "2026-07-13T16:53:00.000Z",
    }],
    customers: [customer],
  });

  let sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  const person = database.prepare("SELECT id,display_name FROM crm_people").get();
  assert.equal(person.display_name, "Unverified Card Name");
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='email'
      AND normalized_value='later-profile@example.test' AND active=1
  `).get(person.id).count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='square_payer_label'
      AND source_type='payment_name_hint' AND active=1
  `).get(person.id).count, 1);

  customer.given_name = "Authoritative";
  customer.family_name = "Directory Name";
  customer.updated_at = "2026-07-14T12:00:00.000Z";
  sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(
    "SELECT display_name FROM crm_people WHERE id=?"
  ).get(person.id).display_name, "Authoritative Directory Name");
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_people
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='square_payer_label'
      AND source_type='payment_name_hint' AND active=1
  `).get(person.id).count, 1);
});

test("conflicting Square payer labels stay on one exact customer and require review", async (t) => {
  const database = migratedDatabase();
  const existing = await createPerson(database, {
    displayName: "square contact",
    email: "payer-hints@example.test",
  });
  addSquareCustomerIdentity(
    database,
    existing.id,
    "square-customer-conflicting-payer-hints",
  );
  installSquareApiMock(t, {
    payments: [
      {
        id: "square-payment-payer-hint-one",
        status: "COMPLETED",
        customer_id: "square-customer-conflicting-payer-hints",
        location_id: "square-tattoo-location",
        card_details: {
          card: {
            cardholder_name: "First Payer Hint",
          },
        },
        total_money: { amount: 4_500, currency: "USD" },
        tip_money: { amount: 0, currency: "USD" },
        source_type: "CARD",
        created_at: "2026-07-13T16:53:00.000Z",
        updated_at: "2026-07-13T16:54:00.000Z",
      },
      {
        id: "square-payment-payer-hint-two",
        status: "COMPLETED",
        customer_id: "square-customer-conflicting-payer-hints",
        location_id: "square-tattoo-location",
        card_details: {
          card: {
            cardholder_name: "Second Payer Hint",
          },
        },
        total_money: { amount: 5_500, currency: "USD" },
        tip_money: { amount: 0, currency: "USD" },
        source_type: "CARD",
        created_at: "2026-07-13T16:54:00.000Z",
        updated_at: "2026-07-13T16:55:00.000Z",
      },
    ],
    customers: [{ id: "square-customer-conflicting-payer-hints" }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  const person = database.prepare("SELECT id,display_name FROM crm_people").get();
  assert.equal(person.display_name, "First Payer Hint");
  assert.deepEqual(
    database.prepare(`
      SELECT value FROM crm_identities
      WHERE person_id=? AND provider='square_payer_label' AND active=1
      ORDER BY value
    `).all(person.id).map((row) => row.value),
    ["First Payer Hint", "Second Payer Hint"],
  );

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id ===
        "crm-sync-conflict:square:payment_name_hint:square-payment-payer-hint-two"
  );
  assert.ok(conflict);
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).conflicts,
    ["payer_name_disagreement"],
  );
  assert.deepEqual(JSON.parse(conflict.metadata_json).personIds, [person.id]);
});

test("a changed payer label on the same Square payment preserves both hints for review", async (t) => {
  const database = migratedDatabase();
  const payment = {
    id: "square-payment-changing-payer-hint",
    status: "COMPLETED",
    customer_id: "square-customer-changing-payer-hint",
    location_id: "square-tattoo-location",
    card_details: {
      card: {
        cardholder_name: "Original Payer Hint",
      },
    },
    total_money: { amount: 7_000, currency: "USD" },
    tip_money: { amount: 0, currency: "USD" },
    source_type: "CARD",
    created_at: "2026-07-13T16:56:00.000Z",
    updated_at: "2026-07-13T16:57:00.000Z",
  };
  const existing = await createPerson(database, {
    displayName: "square contact",
    email: "changing-payer-hint@example.test",
  });
  addSquareCustomerIdentity(database, existing.id, payment.customer_id);
  installSquareApiMock(t, {
    payments: [payment],
    customers: [{ id: payment.customer_id }],
  });

  let sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  const person = database.prepare("SELECT id,display_name FROM crm_people").get();
  assert.equal(person.display_name, "Original Payer Hint");

  payment.card_details.card.cardholder_name = "Changed Payer Hint";
  payment.updated_at = "2026-07-14T12:00:00.000Z";
  sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(
    "SELECT display_name FROM crm_people WHERE id=?"
  ).get(person.id).display_name, "Original Payer Hint");
  assert.deepEqual(
    database.prepare(`
      SELECT value FROM crm_identities
      WHERE person_id=? AND provider='square_payer_label' AND active=1
      ORDER BY value
    `).all(person.id).map((row) => row.value),
    ["Changed Payer Hint", "Original Payer Hint"],
  );

  sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND provider='square_payer_label' AND active=1
  `).get(person.id).count, 2);
  const conflict = database.prepare(`
    SELECT metadata_json FROM crm_interactions
    WHERE source_provider='system' AND source_type='crm_sync_conflict'
      AND source_id=?
  `).get(
    "crm-sync-conflict:square:payment_name_hint:square-payment-changing-payer-hint"
  );
  assert.ok(conflict);
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).conflicts,
    ["payer_name_disagreement"],
  );
});

test("a Square payment name hint alone stays unmatched", async (t) => {
  const database = migratedDatabase();
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-name-only",
      status: "COMPLETED",
      location_id: "square-tattoo-location",
      card_details: {
        card: {
          cardholder_name: "Name Without Exact Anchor",
        },
      },
      total_money: { amount: 3_500, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: "2026-07-13T16:55:00.000Z",
      updated_at: "2026-07-13T16:56:00.000Z",
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.stats.paymentNameHintsReceived, 1);
  assert.equal(sync.payload.stats.persistence.unmatched, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 0);
  assert.equal(database.prepare(`
    SELECT external_id FROM crm_identities
    WHERE kind='square_customer'
  `).get(), undefined);
});

test("sparse Square profile data does not overwrite richer site client data", async (t) => {
  const database = migratedDatabase();
  const existing = await createPerson(database, {
    displayName: "Morgan Rivera — Returning Client",
    email: "morgan-rich-profile@example.test",
    phone: "(404) 555-0119",
    preferredContactMethod: "phone",
  });
  const existingPhone = database.prepare(`
    SELECT normalized_value FROM crm_identities
    WHERE person_id=? AND kind='phone' AND active=1
  `).get(existing.id).normalized_value;
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-sparse-profile",
      status: "COMPLETED",
      customer_id: "square-customer-sparse-profile",
      order_id: "square-order-sparse-profile",
      location_id: "square-tattoo-location",
      buyer_email_address: "morgan-rich-profile@example.test",
      total_money: { amount: 21_000, currency: "USD" },
      tip_money: { amount: 3_000, currency: "USD" },
      source_type: "CARD",
      reference_id: "Sparse customer profile payment",
      created_at: "2026-07-13T17:00:00.000Z",
      updated_at: "2026-07-13T17:01:00.000Z",
    }],
    customers: [{
      id: "square-customer-sparse-profile",
      given_name: "Morgan",
      email_address: "morgan-rich-profile@example.test",
      updated_at: "2026-07-13T17:01:00.000Z",
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT display_name,preferred_contact_method
      FROM crm_people WHERE id=?
    `).get(existing.id) },
    {
      display_name: "Morgan Rivera — Returning Client",
      preferred_contact_method: "phone",
    },
  );
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square' AND source_id='square-payment-sparse-profile'
  `).get().person_id, existing.id);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id=? AND kind='square_customer'
      AND external_id='square-customer-sparse-profile'
  `).get(existing.id).count, 1);
  assert.equal(database.prepare(`
    SELECT normalized_value FROM crm_identities
    WHERE person_id=? AND kind='phone' AND active=1
  `).get(existing.id).normalized_value, existingPhone);
});

test("anonymous direct Square payments do not create CRM records", async (t) => {
  const database = migratedDatabase();
  const calls = installSquareApiMock(t, {
    payments: [{
      id: "square-payment-anonymous",
      status: "COMPLETED",
      order_id: "square-order-anonymous",
      location_id: "square-tattoo-location",
      total_money: { amount: 5_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CASH",
      reference_id: "Anonymous counter payment",
      created_at: "2026-07-13T18:00:00.000Z",
      updated_at: "2026-07-13T18:01:00.000Z",
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(sync.payload.status, "complete");
  assert.equal(sync.payload.stats.persistence.unmatched, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 0);
  assert.equal(
    calls.some((call) => call.url.pathname === "/v2/customers/bulk-retrieve"),
    false,
  );

});

test("a fresh Square sync lease blocks a concurrent provider run", async () => {
  const database = migratedDatabase();
  await createPerson(database, {
    displayName: "Square Concurrent Client",
    email: "square-concurrent@example.test",
  });
  const occurredAt = "2026-07-11T16:00:00.000Z";
  const payments = [
    {
      id: "square-payment-concurrent",
      status: "COMPLETED",
      customer_id: "square-customer-concurrent",
      order_id: "square-order-concurrent",
      location_id: "square-tattoo-location",
      buyer_email_address: "square-concurrent@example.test",
      total_money: { amount: 18_000, currency: "USD" },
      tip_money: { amount: 2_000, currency: "USD" },
      source_type: "CARD",
      reference_id: "Concurrent Square payment",
      created_at: occurredAt,
      updated_at: occurredAt,
    },
    {
      id: "square-payment-concurrent-second",
      status: "COMPLETED",
      customer_id: "square-customer-concurrent-second",
      order_id: "square-order-concurrent-second",
      location_id: "square-tattoo-location",
      buyer_email_address: "square-concurrent@example.test",
      total_money: { amount: 9_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Second concurrent Square payment",
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  ];
  let releasePayments;
  const paymentsMayFinish = new Promise((resolve) => {
    releasePayments = resolve;
  });
  let reportPaymentsStarted;
  const paymentsStarted = new Promise((resolve) => {
    reportPaymentsStarted = resolve;
  });
  const calls = [];
  const completed = await withMockFetch(async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.pathname);
    if (url.pathname === "/v2/payments") {
      reportPaymentsStarted();
      await paymentsMayFinish;
      return Response.json({ payments });
    }
    if (url.pathname === "/v2/customers/bulk-retrieve") {
      assert.deepEqual(
        JSON.parse(String(init.body)).customer_ids,
        [
          "square-customer-concurrent",
          "square-customer-concurrent-second",
        ],
      );
      return Response.json({
        responses: {
          "square-customer-concurrent": {
            customer: {
              id: "square-customer-concurrent",
              email_address: "square-concurrent@example.test",
            },
          },
          "square-customer-concurrent-second": {
            customer: {
              id: "square-customer-concurrent-second",
              email_address: "square-concurrent@example.test",
            },
          },
        },
      });
    }
    if (url.pathname === "/v2/refunds") return Response.json({ refunds: [] });
    throw new Error(`Unexpected Square request: ${url}`);
  }, async () => {
    const firstPromise = api(database, "/api/admin/crm/sync/square", {
      method: "POST",
      body: { mode: "full", maxPages: 4 },
      env: SQUARE_SYNC_ENV,
    });
    await paymentsStarted;
    try {
      const blocked = await responseJson(await api(
        database,
        "/api/admin/crm/sync/square",
        {
          method: "POST",
          body: { mode: "full", maxPages: 4 },
          env: SQUARE_SYNC_ENV,
        },
      ));
      assert.equal(blocked.response.status, 409, JSON.stringify(blocked.payload));
      assert.equal(blocked.payload.details.code, "SYNC_ALREADY_RUNNING");
    } finally {
      releasePayments();
    }
    return responseJson(await firstPromise);
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  assert.equal(completed.payload.status, "complete");
  assert.deepEqual(
    calls,
    ["/v2/payments", "/v2/customers/bulk-retrieve", "/v2/refunds"],
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_sync_jobs
    WHERE provider='square'
  `).get().count, 1);

  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  const personId = database.prepare("SELECT id FROM crm_people").get().id;
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='square'
      AND external_id IN (
        'square-customer-concurrent',
        'square-customer-concurrent-second'
      )
      AND person_id=?
  `).get(personId).count, 2);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE kind='email' AND normalized_value='square-concurrent@example.test'
      AND person_id=?
  `).get(personId).count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_interactions
    WHERE source_provider='square' AND source_type='payment'
      AND source_id LIKE 'square-payment-concurrent%' AND person_id=?
  `).get(personId).count, 2);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE source_provider='square' AND source_type='payment'
      AND source_id LIKE 'square-payment-concurrent%' AND person_id=?
  `).get(personId).count, 2);
});

test("an active provider sync lease blocks a concurrent resume of the same job", async () => {
  const database = migratedDatabase();
  const createdAt = "2026-07-11T15:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_sync_jobs(
      id,provider,status,checkpoint_json,stats_json,warnings_json,error,
      created_at,updated_at
    ) VALUES(
      'square-resume-job','square','pending',
      '{"version":1,"provider":"square","mode":"full","complete":false,'
        || '"windowStart":"2009-01-01T00:00:00.000Z",'
        || '"windowEnd":"2026-07-11T16:00:00.000Z","taskIndex":0,"cursor":null}',
      '{}','[]','',?,?
    )
  `).run(createdAt, createdAt);

  let releasePayments;
  const paymentsMayFinish = new Promise((resolve) => {
    releasePayments = resolve;
  });
  let reportPaymentsStarted;
  const paymentsStarted = new Promise((resolve) => {
    reportPaymentsStarted = resolve;
  });
  const firstPromise = withMockFetch(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/v2/payments") {
      reportPaymentsStarted();
      await paymentsMayFinish;
      return Response.json({ payments: [] });
    }
    if (url.pathname === "/v2/refunds") return Response.json({ refunds: [] });
    throw new Error(`Unexpected Square request: ${url}`);
  }, async () => {
    const first = api(database, "/api/admin/crm/sync/square", {
      method: "POST",
      body: { mode: "full", maxPages: 4 },
      env: SQUARE_SYNC_ENV,
    });
    await paymentsStarted;
    const second = await responseJson(await api(database, "/api/admin/crm/sync/square", {
      method: "POST",
      body: { mode: "full", maxPages: 4 },
      env: SQUARE_SYNC_ENV,
    }));
    assert.equal(second.response.status, 409);
    assert.equal(second.payload.details.code, "SYNC_ALREADY_RUNNING");
    releasePayments();
    return first;
  });
  const first = await responseJson(await firstPromise);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.jobId, "square-resume-job");
  assert.equal(first.payload.status, "complete");
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM crm_sync_jobs WHERE provider='square'"
  ).get().count, 1);
});

test("a provider sync that loses its lease cannot persist a stale page", async () => {
  const database = migratedDatabase();
  const occurredAt = "2026-07-11T16:00:00.000Z";
  const response = await withMockFetch(async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/v2/payments") {
      database.prepare(`
        UPDATE crm_sync_jobs
        SET lease_token='replacement-lease',updated_at=?
        WHERE provider='square' AND status='running'
      `).run(new Date().toISOString());
      return Response.json({
        payments: [{
          id: "stale-lease-payment",
          status: "COMPLETED",
          customer_id: "stale-lease-customer",
          order_id: "stale-lease-order",
          location_id: "square-tattoo-location",
          buyer_email_address: "stale-lease@example.test",
          total_money: { amount: 9000, currency: "USD" },
          tip_money: { amount: 0, currency: "USD" },
          source_type: "CARD",
          created_at: occurredAt,
          updated_at: occurredAt,
        }],
      });
    }
    if (url.pathname === "/v2/customers/bulk-retrieve") {
      assert.deepEqual(
        JSON.parse(String(init.body)),
        { customer_ids: ["stale-lease-customer"] },
      );
      return Response.json({
        responses: {
          "stale-lease-customer": {
            customer: {
              id: "stale-lease-customer",
              email_address: "stale-lease@example.test",
            },
          },
        },
      });
    }
    throw new Error(`Unexpected Square request: ${url}`);
  }, () => api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  const payload = await response.json();
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.equal(payload.details.code, "SYNC_LEASE_LOST");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_identities").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_interactions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);
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
      'local-mirrored-transaction',?,'node-tattoos','charge','pending',
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
  assert.equal(database.prepare(`
    SELECT status FROM crm_transactions WHERE id='local-mirrored-transaction'
  `).get().status, "settled");

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.settledGrossCents, 22_000);
  assert.equal(result.payload.person.netSpendCents, 22_000);
  assert.equal(result.payload.person.tipCents, 4_000);
});

test("Square payment sync never promotes a refund row that carries the same payment id", async (t) => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Refund Row Owner",
    email: "refund-row-owner@example.test",
  });
  const now = "2026-07-11T16:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,note,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'refund-row-with-payment-id',?,'node-events','refund','pending',
      5000,0,'USD',?,'local','event_ticket_refund','refund-row-source',
      'Pending partial refund',?,1,?,?
    )
  `).run(
    person.id,
    now,
    JSON.stringify({
      providerPaymentId: "square-payment-refund-row",
      providerRefundId: "square-refund-row",
    }),
    now,
    now,
  );
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-refund-row",
      status: "COMPLETED",
      customer_id: "square-customer-refund-row",
      order_id: "square-order-refund-row",
      location_id: "square-tattoo-location",
      buyer_email_address: "refund-row-owner@example.test",
      total_money: { amount: 12_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Payment sharing a refund metadata id",
      created_at: now,
      updated_at: now,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.deepEqual(
    { ...database.prepare(`
      SELECT transaction_type,status,amount_cents
      FROM crm_transactions WHERE id='refund-row-with-payment-id'
    `).get() },
    { transaction_type: "refund", status: "pending", amount_cents: 5000 },
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT transaction_type,status,amount_cents
      FROM crm_transactions
      WHERE source_provider='square' AND source_id='square-payment-refund-row'
    `).get() },
    { transaction_type: "charge", status: "settled", amount_cents: 12_000 },
  );
});

test("Square sync flags an ambiguous shared email without creating a provider person", async (t) => {
  const database = migratedDatabase();
  const first = await createPerson(database, {
    displayName: "First Shared Email Owner",
    email: "shared-sync@example.test",
  });
  const second = await createPerson(database, {
    displayName: "Second Shared Email Owner",
    email: "second-shared-sync@example.test",
  });
  const now = "2026-07-11T16:00:00.000Z";
  database.prepare(`
    UPDATE crm_identities
    SET value='shared-sync@example.test',
        normalized_value='shared-sync@example.test',
        is_shared=1,updated_at=?
    WHERE person_id=? AND kind='email'
  `).run(now, second.id);
  database.prepare(`
    UPDATE crm_identities
    SET is_shared=1,updated_at=?
    WHERE person_id=? AND kind='email'
  `).run(now, first.id);
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-shared-email",
      status: "COMPLETED",
      customer_id: "square-customer-shared-email",
      order_id: "square-order-shared-email",
      location_id: "square-tattoo-location",
      buyer_email_address: "shared-sync@example.test",
      total_money: { amount: 8_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Ambiguous shared email payment",
      created_at: now,
      updated_at: now,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  const providerIdentity = database.prepare(`
    SELECT person_id FROM crm_identities
    WHERE provider='square' AND external_id='square-customer-shared-email'
  `).get();
  assert.equal(providerIdentity, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 0);

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  assert.equal(attention.response.status, 200);
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:payment:square-payment-shared-email"
  );
  assert.ok(conflict);
  const metadata = JSON.parse(conflict.metadata_json);
  assert.deepEqual(metadata.conflicts, ["ambiguous_email"]);
  assert.deepEqual(
    [...metadata.personIds].sort(),
    [first.id, second.id].sort(),
  );
});

test("differing Square profile and buyer emails require review instead of guessing", async (t) => {
  const database = migratedDatabase();
  const profileEmailOwner = await createPerson(database, {
    displayName: "Profile Email Owner",
    email: "profile-email-owner@example.test",
  });
  const buyerEmailOwner = await createPerson(database, {
    displayName: "Buyer Email Owner",
    email: "buyer-email-owner@example.test",
  });
  const occurredAt = "2026-07-11T16:00:00.000Z";
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-email-disagreement",
      status: "COMPLETED",
      customer_id: "square-customer-email-disagreement",
      location_id: "square-tattoo-location",
      buyer_email_address: "buyer-email-owner@example.test",
      total_money: { amount: 10_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
    customers: [{
      id: "square-customer-email-disagreement",
      given_name: "Conflicting",
      family_name: "Profile",
      email_address: "profile-email-owner@example.test",
      phone_number: "(404) 555-0188",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square'
      AND source_id='square-payment-email-disagreement'
  `).get(), undefined);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='square'
      AND external_id='square-customer-email-disagreement'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE kind='phone' AND normalized_value='+14045550188'
  `).get().count, 0);

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:payment:square-payment-email-disagreement"
  );
  assert.ok(conflict);
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).conflicts,
    ["alternate_email_disagreement", "exact_identity_anchor_disagreement"],
  );
  assert.deepEqual(
    [...JSON.parse(conflict.metadata_json).personIds].sort(),
    [profileEmailOwner.id, buyerEmailOwner.id].sort(),
  );
});

test("a buyer-email owner cannot absorb a different unclaimed Square profile", async (t) => {
  const database = migratedDatabase();
  const buyerEmailOwner = await createPerson(database, {
    displayName: "Existing Buyer Email Owner",
    email: "known-buyer@example.test",
  });
  const occurredAt = "2026-07-11T17:00:00.000Z";
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-one-owned-email",
      status: "COMPLETED",
      customer_id: "square-customer-one-owned-email",
      location_id: "square-tattoo-location",
      buyer_email_address: "known-buyer@example.test",
      total_money: { amount: 8_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
    customers: [{
      id: "square-customer-one-owned-email",
      given_name: "Unclaimed",
      family_name: "Profile",
      email_address: "unclaimed-profile@example.test",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_people").get().count, 1);
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square'
      AND source_id='square-payment-one-owned-email'
  `).get(), undefined);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='square'
      AND external_id='square-customer-one-owned-email'
  `).get().count, 0);

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:payment:square-payment-one-owned-email"
  );
  assert.ok(conflict);
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).conflicts,
    ["alternate_email_disagreement"],
  );
  assert.deepEqual(
    JSON.parse(conflict.metadata_json).personIds,
    [buyerEmailOwner.id],
  );
});

test("a stale hidden email claim cannot override the current unique email owner", async (t) => {
  const database = migratedDatabase();
  const staleClaimOwner = await createPerson(database, {
    displayName: "Stale Claim Owner",
    email: "stale-claim-owner@example.test",
  });
  const currentEmailOwner = await createPerson(database, {
    displayName: "Current Email Owner",
    email: "current-owner@example.test",
  });
  const now = "2026-07-11T16:00:00.000Z";
  database.prepare(`
    DELETE FROM crm_identities
    WHERE person_id=? AND provider='crm_email_claim'
      AND external_id='current-owner@example.test'
  `).run(currentEmailOwner.id);
  database.prepare(`
    UPDATE crm_identities
    SET
      value='current-owner@example.test',
      normalized_value='current-owner@example.test',
      external_id='current-owner@example.test',
      updated_at=?
    WHERE person_id=? AND provider='crm_email_claim'
  `).run(now, staleClaimOwner.id);
  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-stale-claim",
      status: "COMPLETED",
      customer_id: "square-customer-stale-claim",
      order_id: "square-order-stale-claim",
      location_id: "square-tattoo-location",
      buyer_email_address: "current-owner@example.test",
      total_money: { amount: 7000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Current owner payment",
      created_at: now,
      updated_at: now,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_identities
    WHERE provider='square' AND external_id='square-customer-stale-claim'
  `).get().person_id, currentEmailOwner.id);
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE source_provider='square' AND source_id='square-payment-stale-claim'
  `).get().person_id, currentEmailOwner.id);
  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:payment:square-payment-stale-claim"
  );
  assert.equal(conflict, undefined);
});

test("Square sync surfaces exact person-anchor disagreements for owner review", async (t) => {
  const database = migratedDatabase();
  const localPerson = await createPerson(database, {
    displayName: "Local Booking Owner",
    email: "local-anchor@example.test",
  });
  const providerPerson = await createPerson(database, {
    displayName: "Provider Identity Owner",
    email: "provider-anchor@example.test",
  });
  const occurredAt = "2026-07-11T16:00:00.000Z";
  database.prepare(`
    DELETE FROM crm_identities
    WHERE provider='crm_email_claim'
      AND external_id='provider-anchor@example.test'
  `).run();
  database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,external_id,
      source_provider,source_type,source_id,created_at,updated_at
    ) VALUES(
      'square-conflicting-customer-identity',?,'square_customer',
      'square-customer-conflict','square-customer-conflict','square',
      'square-customer-conflict','square','provider_contact',
      'square:square-customer-conflict',?,?
    )
  `).run(providerPerson.id, occurredAt, occurredAt);
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'local-anchor-payment',?,'node-tattoos','charge','pending',12000,0,
      'USD',?,'local','deposit_payment','local-anchor-deposit',
      '{"providerPaymentId":"square-payment-anchor-conflict"}',1,?,?
    )
  `).run(localPerson.id, occurredAt, occurredAt, occurredAt);

  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-anchor-conflict",
      status: "COMPLETED",
      customer_id: "square-customer-conflict",
      order_id: "square-order-anchor-conflict",
      location_id: "square-tattoo-location",
      total_money: { amount: 12_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Conflicting anchor payment",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
    customers: [{
      id: "square-customer-conflict",
      given_name: "Wrong",
      family_name: "Profile",
      company_name: "Wrong Organization",
      email_address: "provider-anchor@example.test",
      phone_number: "(404) 555-0198",
      created_at: occurredAt,
      updated_at: occurredAt,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  assert.equal(database.prepare(
    "SELECT status FROM crm_transactions WHERE id='local-anchor-payment'"
  ).get().status, "settled");
  assert.equal(database.prepare(`
    SELECT person_id FROM crm_transactions
    WHERE id='local-anchor-payment'
  `).get().person_id, localPerson.id);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT display_name,organization,preferred_contact_method
      FROM crm_people WHERE id=?
    `).get(localPerson.id) },
    {
      display_name: "Local Booking Owner",
      organization: "",
      preferred_contact_method: "",
    },
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE person_id IN (?,?) AND kind='phone'
  `).get(localPerson.id, providerPerson.id).count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_identities
    WHERE provider='crm_email_claim'
      AND external_id='provider-anchor@example.test'
  `).get().count, 0);

  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  assert.equal(attention.response.status, 200);
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
  );
  assert.ok(conflict);
  const metadata = JSON.parse(conflict.metadata_json);
  assert.deepEqual(metadata.conflicts, ["exact_identity_anchor_disagreement"]);
  assert.deepEqual(
    [...metadata.personIds].sort(),
    [localPerson.id, providerPerson.id].sort(),
  );
});

test("Square sync recognizes a local providerRefundId mirror without double-counting refunds", async (t) => {
  const database = migratedDatabase();
  const person = await createPerson(database, {
    displayName: "Already Refunded Client",
    email: "already-refunded@example.com",
  });
  const paidAt = "2026-07-11T16:00:00.000Z";
  const refundedAt = "2026-07-12T17:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,note,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'local-refunded-charge',?,'node-events','charge','settled',
      12000,0,'USD',?,'local','event_ticket','event-ticket-12',
      'Settled event ticket',?,1,?,?
    )
  `).run(
    person.id,
    paidAt,
    JSON.stringify({ providerPaymentId: "square-payment-refunded" }),
    paidAt,
    paidAt,
  );
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,note,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'local-mirrored-refund',?,'node-events','refund','pending',
      5000,0,'USD',?,'local','event_ticket_refund','event-ticket-12-refund',
      'Settled event ticket refund',?,1,?,?
    )
  `).run(
    person.id,
    refundedAt,
    JSON.stringify({ providerRefundId: "square-refund-mirrored" }),
    refundedAt,
    refundedAt,
  );

  installSquareApiMock(t, {
    payments: [{
      id: "square-payment-refunded",
      status: "COMPLETED",
      customer_id: "square-customer-refunded",
      order_id: "square-order-refunded",
      location_id: "square-tattoo-location",
      buyer_email_address: "already-refunded@example.com",
      total_money: { amount: 12_000, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      source_type: "CARD",
      reference_id: "Mirrored event ticket payment",
      created_at: paidAt,
      updated_at: paidAt,
    }],
    refunds: [{
      id: "square-refund-mirrored",
      status: "COMPLETED",
      payment_id: "square-payment-refunded",
      order_id: "square-order-refunded",
      location_id: "square-tattoo-location",
      amount_money: { amount: 5_000, currency: "USD" },
      reason: "Partial ticket refund",
      created_at: refundedAt,
      updated_at: refundedAt,
    }],
  });

  let result = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload.stats.persistence, {
    interactions: 1,
    transactions: 0,
    unmatched: 0,
    overlapsSkipped: 2,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM crm_transactions").get().count, 2);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions WHERE source_provider='square'
  `).get().count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM crm_transactions
    WHERE transaction_type='refund' AND status='settled'
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT status FROM crm_transactions WHERE id='local-mirrored-refund'
  `).get().status, "settled");

  result = await responseJson(await api(database, `/api/admin/crm/people/${person.id}`));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.person.settledGrossCents, 12_000);
  assert.equal(result.payload.person.refundCents, 5_000);
  assert.equal(result.payload.person.netSpendCents, 7_000);
});

test("Square refund ownership uses the original charge rather than another refund row", async (t) => {
  const database = migratedDatabase();
  const refundOwner = await createPerson(database, {
    displayName: "Refund Row Person",
    email: "refund-row-person@example.test",
  });
  const chargeOwner = await createPerson(database, {
    displayName: "Charge Owner",
    email: "charge-owner@example.test",
  });
  const now = "2026-07-12T17:00:00.000Z";
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'refund-owner-row',?,'node-events','refund','pending',3000,0,'USD',?,
      'local','event_ticket_refund','refund-owner-source',
      '{"providerPaymentId":"refund-owner-payment","providerRefundId":"refund-owner-refund"}',
      1,?,?
    )
  `).run(refundOwner.id, now, now, now);
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,node_id,transaction_type,status,amount_cents,tip_cents,
      currency,occurred_at,source_provider,source_type,source_id,
      metadata_json,active,created_at,updated_at
    ) VALUES(
      'refund-owner-charge',?,'node-events','charge','settled',9000,0,'USD',?,
      'local','event_ticket_payment','charge-owner-source',
      '{"providerPaymentId":"refund-owner-payment"}',1,?,?
    )
  `).run(chargeOwner.id, now, now, now);
  installSquareApiMock(t, {
    refunds: [{
      id: "refund-owner-refund",
      status: "COMPLETED",
      payment_id: "refund-owner-payment",
      order_id: "refund-owner-order",
      location_id: "square-tattoo-location",
      amount_money: { amount: 3000, currency: "USD" },
      created_at: now,
      updated_at: now,
    }],
  });

  const sync = await responseJson(await api(database, "/api/admin/crm/sync/square", {
    method: "POST",
    body: { mode: "full", maxPages: 4 },
    env: SQUARE_SYNC_ENV,
  }));
  assert.equal(sync.response.status, 200, JSON.stringify(sync.payload));
  const attention = await responseJson(await api(database, "/api/admin/crm/needs-attention"));
  const conflict = attention.payload.unmatchedInteractions.find(
    (item) => item.source_type === "crm_sync_conflict"
      && item.source_id
        === "crm-sync-conflict:square:refund:refund-owner-refund"
  );
  assert.ok(conflict);
  const metadata = JSON.parse(conflict.metadata_json);
  assert.deepEqual(metadata.conflicts, ["payment_refund_person_disagreement"]);
  assert.deepEqual(
    [...metadata.personIds].sort(),
    [refundOwner.id, chargeOwner.id].sort(),
  );
});
