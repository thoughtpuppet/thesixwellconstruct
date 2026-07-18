import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  buildCrmSiteCustomerCleanupSql,
} from "../tools/crm-site-customer-policy.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of readdirSync(join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(ROOT, "migrations", migration), "utf8"));
  }
  return database;
}

function insertPerson(database, id, eligibility = null) {
  database.prepare(`
    INSERT INTO crm_people(
      id,display_name,relationship_status,preferred_contact_method,
      eligibility_at,eligibility_reason,eligibility_source_provider,
      eligibility_source_type,eligibility_source_id,created_at,updated_at
    ) VALUES(?,?,'active','email',?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(
    id,
    id,
    eligibility?.at || null,
    eligibility?.reason || "",
    eligibility?.provider || "",
    eligibility?.type || "",
    eligibility?.sourceId || "",
  );
}

test("site-customer cleanup removes excluded CRM history and preserves eligible people", () => {
  const database = migratedDatabase();
  insertPerson(database, "eligible-booking", {
    at: "2026-07-17T12:00:00.000Z",
    reason: "website_booking",
    provider: "local",
    type: "appointment",
    sourceId: "appointment-1",
  });
  insertPerson(database, "eligible-manual", {
    at: "2026-07-17T13:00:00.000Z",
    reason: "studio_manual_entry",
    provider: "manual",
    type: "person_create",
    sourceId: "eligible-manual",
  });
  insertPerson(database, "square-only");
  insertPerson(database, "submission-only");

  database.prepare(`
    INSERT INTO crm_identities(
      id,person_id,kind,value,normalized_value,provider,label,
      source_provider,source_type,active,created_at,updated_at
    ) VALUES(?,?,'email',?,?,'square','','square','provider_email',1,datetime('now'),datetime('now'))
  `).run(
    "excluded-identity",
    "square-only",
    "legacy@example.test",
    "legacy@example.test",
  );
  database.prepare(`
    INSERT INTO crm_interactions(
      id,person_id,interaction_type,occurred_at,source_provider,source_type,
      source_id,active,created_at,updated_at
    ) VALUES('excluded-interaction','submission-only','tattoo_inquiry',
      datetime('now'),'local','submission','submission-1',1,datetime('now'),datetime('now'))
  `).run();
  database.prepare(`
    INSERT INTO crm_transactions(
      id,person_id,transaction_type,status,amount_cents,currency,occurred_at,
      source_provider,source_type,source_id,active,created_at,updated_at
    ) VALUES('excluded-transaction','square-only','charge','settled',5000,'USD',
      datetime('now'),'square','payment','payment-1',1,datetime('now'),datetime('now'))
  `).run();
  database.prepare(`
    INSERT INTO crm_notes(
      id,person_id,body,created_at,updated_at
    ) VALUES('excluded-note','square-only','legacy note',datetime('now'),datetime('now'))
  `).run();
  database.prepare(`
    INSERT INTO crm_audit_events(
      id,person_id,action,resource_type,created_at
    ) VALUES('excluded-audit','submission-only','test','person',datetime('now'))
  `).run();
  database.prepare(`
    INSERT INTO crm_audit_events(
      id,person_id,action,resource_type,resource_id,created_at
    ) VALUES(
      'excluded-audit-resource',NULL,'test','person','square-only',datetime('now')
    )
  `).run();

  const sourceCounts = {
    submissions: database.prepare("SELECT COUNT(*) count FROM submissions").get().count,
    appointments: database.prepare("SELECT COUNT(*) count FROM appointments").get().count,
    tickets: database.prepare("SELECT COUNT(*) count FROM event_tickets").get().count,
  };
  const cleanupSql = buildCrmSiteCustomerCleanupSql();
  assert.doesNotMatch(cleanupSql, /DELETE FROM (submissions|appointments|event_tickets)/);
  database.exec(cleanupSql);

  assert.deepEqual(
    database.prepare("SELECT id FROM crm_people ORDER BY id").all().map((row) => row.id),
    ["eligible-booking", "eligible-manual"],
  );
  for (const table of [
    "crm_identities",
    "crm_interactions",
    "crm_transactions",
    "crm_notes",
    "crm_audit_events",
  ]) {
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0);
  }
  assert.deepEqual({
    submissions: database.prepare("SELECT COUNT(*) count FROM submissions").get().count,
    appointments: database.prepare("SELECT COUNT(*) count FROM appointments").get().count,
    tickets: database.prepare("SELECT COUNT(*) count FROM event_tickets").get().count,
  }, sourceCounts);
});
