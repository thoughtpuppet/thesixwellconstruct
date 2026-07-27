import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../_worker.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  batch(statements) {
    return statements.map((statement) => statement.run());
  }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(source(path.join("migrations", migration)));
  }
  return database;
}

function apiEnv(database) {
  return { SUBMISSIONS_DB: new LocalD1(database) };
}

function workerEnv(database) {
  const detail = source("about/legend/detail/index.html");
  const catalog = source("about/legend/index.html");
  const managed = source("about/legend/managed-preview/index.html");
  return {
    ...apiEnv(database),
    PUBLIC_SITE_URL: "https://thesixwellconstruct.com",
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const body = pathname === "/about/legend/detail/index.html"
          ? detail
          : pathname === "/about/legend/index.html"
            ? catalog
            : pathname === "/about/legend/managed-preview/index.html"
              ? managed
              : "<!DOCTYPE html><html><body>Not found.</body></html>";
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

test("Legend APIs publish clean routes, category identity, and deterministic whole-catalog neighbors", async () => {
  const database = migratedDatabase();
  const env = apiEnv(database);
  const listResponse = await handleConstructApi(
    new Request("https://example.test/api/legend"),
    env,
  );
  const list = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.ok(list.records.length > 2);
  for (const record of list.records) {
    assert.equal(record.canonicalRoute, `/about/legend/${encodeURIComponent(record.slug)}/`);
    assert.equal(record.canonical_route, record.canonicalRoute);
  }

  const detailResponse = await handleConstructApi(
    new Request("https://example.test/api/legend/open-eye"),
    env,
  );
  const payload = await detailResponse.json();
  const ordered = database.prepare(
    "SELECT id,slug,name FROM visual_symbols WHERE state='published' ORDER BY sort_order,id",
  ).all();
  const index = ordered.findIndex((record) => record.id === payload.record.id);

  assert.equal(detailResponse.status, 200);
  assert.equal(payload.record.slug, "open-eye");
  assert.equal(payload.record.canonicalRoute, "/about/legend/open-eye/");
  assert.equal(payload.category.id, payload.record.category_id);
  assert.equal(payload.category.state, "published");
  assert.deepEqual(payload.navigation.previous && {
    id: payload.navigation.previous.id,
    slug: payload.navigation.previous.slug,
    name: payload.navigation.previous.name,
  }, index > 0 ? { ...ordered[index - 1] } : null);
  assert.deepEqual(payload.navigation.next && {
    id: payload.navigation.next.id,
    slug: payload.navigation.next.slug,
    name: payload.navigation.next.name,
  }, index < ordered.length - 1 ? { ...ordered[index + 1] } : null);
  assert.match(payload.navigation.previous?.canonicalRoute || payload.navigation.next.canonicalRoute, /^\/about\/legend\/[^/?]+\/$/);
});

test("canonical route migration leaves every managed symbol and its FTS row live", () => {
  const database = migratedDatabase();
  const routes = database.prepare(
    "SELECT entity_id,route FROM search_documents WHERE entity_type='visual_symbol' ORDER BY entity_id",
  ).all();
  const indexed = database.prepare(
    "SELECT COUNT(*) count FROM search_documents_fts WHERE entity_id IN (SELECT entity_id FROM search_documents WHERE entity_type='visual_symbol')",
  ).get();

  assert.ok(routes.length > 0);
  routes.forEach((record) => assert.match(record.route, /^\/about\/legend\/[^/?]+\/$/));
  assert.equal(indexed.count, routes.length);
});

test("Worker serves exact canonical Legend documents and leaves the old query unsupported", async () => {
  const database = migratedDatabase();
  const env = workerEnv(database);

  const recordResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/open-eye/"),
    env,
    { waitUntil() {} },
  );
  const recordHtml = await recordResponse.text();
  assert.equal(recordResponse.status, 200);
  assert.match(recordHtml, /<title data-legend-record-title>OPEN EYE · The Legend · the six\.well construct<\/title>/);
  assert.match(recordHtml, /rel="canonical" href="https:\/\/thesixwellconstruct\.com\/about\/legend\/open-eye\/"/);
  assert.match(recordHtml, /"canonicalRoute":"\/about\/legend\/open-eye\/"/);
  assert.match(recordHtml, /\\u003csvg/);

  const slashResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/open-eye?source=test"),
    env,
    { waitUntil() {} },
  );
  assert.equal(slashResponse.status, 308);
  assert.equal(slashResponse.headers.get("location"), "https://thesixwellconstruct.com/about/legend/open-eye/");

  const legacyQueryUrl = new URL("https://thesixwellconstruct.com/about/legend/");
  legacyQueryUrl.search = `?${["sym", "bol"].join("")}=open-eye`;
  const oldQueryResponse = await worker.fetch(
    new Request(legacyQueryUrl),
    env,
    { waitUntil() {} },
  );
  const oldQueryHtml = await oldQueryResponse.text();
  assert.equal(oldQueryResponse.status, 200);
  assert.match(oldQueryHtml, /data-live-legend/);
  assert.doesNotMatch(oldQueryHtml, /data-live-legend-record/);

  const idAliasResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/fig-eye/"),
    env,
    { waitUntil() {} },
  );
  assert.equal(idAliasResponse.status, 404);

  const missingResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/not-a-symbol/"),
    env,
    { waitUntil() {} },
  );
  assert.equal(missingResponse.status, 404);

  const internalTemplateResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/detail/"),
    env,
    { waitUntil() {} },
  );
  assert.equal(internalTemplateResponse.status, 404);

  const previewResponse = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/managed-preview/"),
    env,
    { waitUntil() {} },
  );
  assert.equal(previewResponse.status, 200);
  assert.match(await previewResponse.text(), /data-managed-catalog="legend"/);
});

test("editing a published slug moves the canonical page without retaining an alias", async () => {
  const database = migratedDatabase();
  database.prepare(
    "UPDATE visual_symbols SET slug='watching-eye',updated_at=datetime('now') WHERE slug='open-eye'",
  ).run();
  const env = workerEnv(database);

  const previous = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/open-eye/"),
    env,
    { waitUntil() {} },
  );
  const current = await worker.fetch(
    new Request("https://thesixwellconstruct.com/about/legend/watching-eye/"),
    env,
    { waitUntil() {} },
  );

  assert.equal(previous.status, 404);
  assert.equal(current.status, 200);
  assert.match(await current.text(), /\/about\/legend\/watching-eye\//);
});
