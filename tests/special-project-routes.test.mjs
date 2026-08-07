import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import worker from "../_worker.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    if (row === undefined) return null;
    return column ? row[column] : row;
  }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function environment(database) {
  return {
    SUBMISSIONS_DB: new LocalD1(database),
    PUBLIC_SITE_URL: "https://example.test",
    ASSETS: {
      async fetch(assetRequest) {
        const pathname = new URL(assetRequest.url).pathname;
        const direct = join(ROOT, ...pathname.split("/").filter(Boolean));
        const file = pathname.endsWith("/") ? join(direct, "index.html") : direct;
        try {
          return new Response(readFileSync(file), {
            status: 200,
            headers: { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" },
          });
        } catch {
          return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
        }
      },
    },
  };
}

test("Special Project routes serve shared public details and closed documentation", async () => {
  const database = migratedDatabase();
  const env = environment(database);
  database.prepare("UPDATE special_project_calls SET status='closed' WHERE id='mythic-body-studies'").run();

  const response = await worker.fetch(new Request("https://example.test/tattoos/special-projects/mythic-body-studies/"), env, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /<title data-special-project-title>Mythic Body Studies · Special Projects · Art\.Pill Tattoo House<\/title>/);
  assert.match(html, /<meta data-special-project-description name="description" content="An open call for tattoos built around figures/);
  assert.match(html, /<link data-special-project-canonical rel="canonical" href="https:\/\/example\.test\/tattoos\/special-projects\/mythic-body-studies\/">/);
  assert.match(html, /data-project-detail-only/);
  assert.match(html, /id="projectConnections"/);
  assert.match(html, /id="application"/);

  database.prepare("UPDATE special_project_calls SET status='open', opens_at='2999-01-01T00:00:00.000Z' WHERE id='mythic-body-studies'").run();
  const openingSoon = await worker.fetch(new Request("https://example.test/tattoos/special-projects/mythic-body-studies/"), env, {});
  assert.equal(openingSoon.status, 200);
});

test("Special Project routes canonicalize legacy destinations and reject non-public records", async () => {
  const database = migratedDatabase();
  const env = environment(database);

  const slash = await worker.fetch(new Request("https://example.test/tattoos/special-projects/mythic-body-studies"), env, {});
  assert.equal(slash.status, 308);
  assert.equal(slash.headers.get("location"), "https://example.test/tattoos/special-projects/mythic-body-studies/");

  const query = await worker.fetch(new Request("https://example.test/tattoos/special-projects/?project=mythic-body-studies"), env, {});
  assert.equal(query.status, 308);
  assert.equal(query.headers.get("location"), "https://example.test/tattoos/special-projects/mythic-body-studies/");

  const apply = await worker.fetch(new Request("https://example.test/tattoos/special-projects/apply/?project=mythic-body-studies"), env, {});
  assert.equal(apply.status, 308);
  assert.equal(apply.headers.get("location"), "https://example.test/tattoos/special-projects/mythic-body-studies/#application");

  const emptyApply = await worker.fetch(new Request("https://example.test/tattoos/special-projects/apply/"), env, {});
  assert.equal(emptyApply.status, 308);
  assert.equal(emptyApply.headers.get("location"), "https://example.test/tattoos/special-projects/");

  const healed = await worker.fetch(new Request("https://example.test/tattoos/special-projects/healed/"), env, {});
  assert.equal(healed.status, 200);

  const unknown = await worker.fetch(new Request("https://example.test/tattoos/special-projects/not-a-project/"), env, {});
  assert.equal(unknown.status, 404);
  assert.match(await unknown.text(), /Not found/i);

  database.prepare("UPDATE content_entities SET visibility='internal' WHERE id='mythic-body-studies'").run();
  const privateRecord = await worker.fetch(new Request("https://example.test/tattoos/special-projects/mythic-body-studies/"), env, {});
  assert.equal(privateRecord.status, 404);
});
