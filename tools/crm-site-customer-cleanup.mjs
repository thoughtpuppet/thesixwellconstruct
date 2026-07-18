import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  buildCrmSiteCustomerCleanupSql,
  EXCLUDED_PEOPLE_SQL,
} from "./crm-site-customer-policy.mjs";

const DATABASE = "swc-submissions";
const APPLY_FLAG = "--apply";
const archiveArg = process.argv.find((value) => value.startsWith("--archive-dir="));
const archiveDir = resolve(
  archiveArg
    ? archiveArg.slice("--archive-dir=".length)
    : "crm-site-customer-archive",
);
const apply = process.argv.includes(APPLY_FLAG);
const expectedTotalArg = process.argv.find((value) => value.startsWith("--expect-total="));
const expectedEligibleArg = process.argv.find((value) => value.startsWith("--expect-eligible="));
const expectedExcludedArg = process.argv.find((value) => value.startsWith("--expect-excluded="));
const wranglerCliArg = process.argv.find((value) => value.startsWith("--wrangler-cli="));
const wranglerCli = wranglerCliArg
  ? resolve(wranglerCliArg.slice("--wrangler-cli=".length))
  : "";

function expectedNumber(argument) {
  if (!argument) return null;
  const value = Number(argument.split("=")[1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid expected count: ${argument}`);
  }
  return value;
}

const expected = {
  total: expectedNumber(expectedTotalArg),
  eligible: expectedNumber(expectedEligibleArg),
  excluded: expectedNumber(expectedExcludedArg),
};
const npxCli = process.platform === "win32"
  ? join(
      process.env.ProgramFiles || "C:\\Program Files",
      "nodejs",
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    )
  : "";

function wrangler(args, { json = false } = {}) {
  const executable = wranglerCli
    ? process.execPath
    : process.platform === "win32"
      ? process.execPath
      : "npx";
  const commandArgs = wranglerCli
    ? [wranglerCli, ...args]
    : [
        ...(npxCli ? [npxCli] : []),
        "--yes",
        "--package",
        "wrangler@latest",
        "wrangler",
        ...args,
      ];
  const result = spawnSync(
    executable,
    commandArgs,
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Wrangler failed (${args.join(" ")}): ${
        result.error?.message || result.stderr || result.stdout || `exit ${result.status}`
      }`,
    );
  }
  if (!json) return result.stdout;
  const payload = JSON.parse(result.stdout);
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first?.success) throw new Error(`D1 query failed: ${result.stdout}`);
  return first.results || [];
}

function query(sql) {
  return wrangler([
    "d1",
    "execute",
    DATABASE,
    "--remote",
    "--json",
    "--command",
    sql,
  ], { json: true });
}

function csvCell(value) {
  let text = "";
  if (value !== null && value !== undefined) {
    text = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

function writeCsv(filename, rows) {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const contents = [
    keys.map(csvCell).join(","),
    ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")),
  ].join("\r\n");
  const path = join(archiveDir, filename);
  writeFileSync(path, `\uFEFF${contents}`, "utf8");
  return { path, rowCount: rows.length };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function archiveQuery(table, where) {
  return `WITH excluded_people AS (${EXCLUDED_PEOPLE_SQL})
    SELECT * FROM ${table} WHERE ${where}`;
}

function captureBookmark() {
  const output = wrangler(["d1", "time-travel", "info", DATABASE, "--json"]);
  try {
    return JSON.parse(output)?.bookmark || "";
  } catch {
    return "";
  }
}

function assertExpected(label, actual, expectedValue) {
  if (expectedValue !== null && actual !== expectedValue) {
    throw new Error(
      `Preflight ${label} changed: expected ${expectedValue}, found ${actual}. No deletion was run.`,
    );
  }
}

mkdirSync(archiveDir, { recursive: true });

function productionCounts() {
  const counts = query(`
  SELECT
    COUNT(*) total,
    SUM(CASE WHEN eligibility_at IS NOT NULL THEN 1 ELSE 0 END) eligible,
    SUM(CASE WHEN id IN (${EXCLUDED_PEOPLE_SQL}) THEN 1 ELSE 0 END) excluded
  FROM crm_people
  WHERE merged_into_id IS NULL
`)[0] || {};
  counts.total = Number(counts.total || 0);
  counts.eligible = Number(counts.eligible || 0);
  counts.excluded = Number(counts.excluded || 0);
  return counts;
}

const preflight = productionCounts();
assertExpected("total", preflight.total, expected.total);
assertExpected("eligible", preflight.eligible, expected.eligible);
assertExpected("excluded", preflight.excluded, expected.excluded);
if (!preflight.eligible || !preflight.excluded) {
  throw new Error(`Unsafe preflight counts: ${JSON.stringify(preflight)}`);
}

const bookmark = captureBookmark();
if (!bookmark) {
  throw new Error("D1 Time Travel did not return a recovery bookmark. No deletion was run.");
}
const archiveFiles = [];
const exports = [
  ["excluded-people.csv", "crm_people", `id IN (SELECT id FROM excluded_people)`],
  ["excluded-identities.csv", "crm_identities", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-interactions.csv", "crm_interactions", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-transactions.csv", "crm_transactions", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-notes.csv", "crm_notes", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-followups.csv", "crm_followups", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-person-tags.csv", "crm_person_tags", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-attendance.csv", "crm_attendance", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-marketing-subscriptions.csv", "crm_marketing_subscriptions", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-suppressions.csv", "crm_suppressions", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-tier-history.csv", "crm_tier_history", `person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-audit-events.csv", "crm_audit_events", `person_id IN (SELECT id FROM excluded_people) OR (resource_type='person' AND resource_id IN (SELECT id FROM excluded_people))`],
  ["excluded-merges.csv", "crm_merges", `survivor_person_id IN (SELECT id FROM excluded_people) OR duplicate_person_id IN (SELECT id FROM excluded_people)`],
  ["excluded-import-rows.csv", "crm_import_rows", `matched_person_id IN (SELECT id FROM excluded_people) OR target_person_id IN (SELECT id FROM excluded_people) OR applied_person_id IN (SELECT id FROM excluded_people)`],
];
for (const [filename, table, where] of exports) {
  archiveFiles.push(writeCsv(filename, query(archiveQuery(table, where))));
}
archiveFiles.push(writeCsv(
  "excluded-source-references.csv",
  query(`WITH excluded_people AS (${EXCLUDED_PEOPLE_SQL})
    SELECT 'identity' resource_kind,person_id,source_provider,source_type,source_id,
      provider external_provider,external_id external_reference
    FROM crm_identities
    WHERE person_id IN (SELECT id FROM excluded_people)
    UNION ALL
    SELECT 'interaction',person_id,source_provider,source_type,source_id,'',''
    FROM crm_interactions
    WHERE person_id IN (SELECT id FROM excluded_people)
    UNION ALL
    SELECT 'transaction',person_id,source_provider,source_type,source_id,
      '',COALESCE(external_order_id,external_customer_id,'')
    FROM crm_transactions
    WHERE person_id IN (SELECT id FROM excluded_people)
    ORDER BY person_id,resource_kind,source_provider,source_type,source_id`),
));

const fullExportPath = join(archiveDir, "swc-submissions-pre-cleanup.sql");
const exportableTables = query(`
  SELECT name
  FROM sqlite_schema
  WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name!='_cf_KV'
    AND lower(COALESCE(sql,'')) NOT LIKE 'create virtual table%'
    AND name NOT LIKE '%_fts'
    AND name NOT GLOB '*_fts_*'
  ORDER BY name
`).map((row) => row.name);
const excludedSqlExportTables = query(`
  SELECT name
  FROM sqlite_schema
  WHERE type='table'
    AND (
      lower(COALESCE(sql,'')) LIKE 'create virtual table%'
      OR name LIKE '%_fts'
      OR name GLOB '*_fts_*'
    )
  ORDER BY name
`).map((row) => row.name);
if (!exportableTables.length) {
  throw new Error("No exportable D1 tables were found. No deletion was run.");
}
wrangler([
  "d1",
  "export",
  DATABASE,
  "--remote",
  "--output",
  fullExportPath,
  ...exportableTables.flatMap((table) => ["--table", table]),
]);
archiveFiles.push({ path: fullExportPath, rowCount: null });

const cleanupSql = buildCrmSiteCustomerCleanupSql();
const cleanupPath = join(archiveDir, "cleanup.sql");
writeFileSync(cleanupPath, cleanupSql, "utf8");
archiveFiles.push({ path: cleanupPath, rowCount: null });

const finalPreflight = productionCounts();
for (const key of ["total", "eligible", "excluded"]) {
  if (finalPreflight[key] !== preflight[key]) {
    throw new Error(
      `Production changed during export: ${JSON.stringify({ preflight, finalPreflight })}. No deletion was run.`,
    );
  }
}
assertExpected("final total", finalPreflight.total, expected.total);
assertExpected("final eligible", finalPreflight.eligible, expected.eligible);
assertExpected("final excluded", finalPreflight.excluded, expected.excluded);

const manifestPath = join(archiveDir, "manifest.json");
const manifest = {
  policy: "Restrict People to Site Customers",
  database: DATABASE,
  exportedAt: new Date().toISOString(),
  timeTravelBookmark: bookmark,
  preflight,
  finalPreflight,
  sqlExport: {
    mode: "selected_tables",
    tableCount: exportableTables.length,
    excludedRebuildableFtsTables: excludedSqlExportTables,
  },
  applied: false,
  archiveDirectory: archiveDir,
  files: archiveFiles.map((file) => ({
    name: basename(file.path),
    rowCount: file.rowCount,
    sha256: sha256(file.path),
  })),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    archiveDirectory: archiveDir,
    preflight,
    bookmarkCaptured: Boolean(bookmark),
  }));
  process.exit(0);
}

wrangler([
  "d1",
  "execute",
  DATABASE,
  "--remote",
  "--yes",
  "--file",
  cleanupPath,
]);

const postflight = query(`
  SELECT
    COUNT(*) total,
    SUM(CASE WHEN eligibility_at IS NOT NULL THEN 1 ELSE 0 END) eligible,
    SUM(CASE WHEN eligibility_at IS NULL THEN 1 ELSE 0 END) ineligible
  FROM crm_people
  WHERE merged_into_id IS NULL
`)[0] || {};
for (const key of ["total", "eligible", "ineligible"]) {
  postflight[key] = Number(postflight[key] || 0);
}
if (postflight.ineligible !== 0 || postflight.total !== preflight.eligible) {
  throw new Error(
    `Cleanup verification failed: ${JSON.stringify({ preflight, postflight })}`,
  );
}
const orphanCounts = query(`
  SELECT
    (SELECT COUNT(*) FROM crm_identities i LEFT JOIN crm_people p ON p.id=i.person_id
      WHERE p.id IS NULL) identities,
    (SELECT COUNT(*) FROM crm_interactions x LEFT JOIN crm_people p ON p.id=x.person_id
      WHERE x.person_id IS NOT NULL AND p.id IS NULL) interactions,
    (SELECT COUNT(*) FROM crm_transactions t LEFT JOIN crm_people p ON p.id=t.person_id
      WHERE t.person_id IS NOT NULL AND p.id IS NULL) transactions
`)[0] || {};
if (Object.values(orphanCounts).some((value) => Number(value || 0) !== 0)) {
  throw new Error(`Orphan verification failed: ${JSON.stringify(orphanCounts)}`);
}

manifest.applied = true;
manifest.appliedAt = new Date().toISOString();
manifest.postflight = postflight;
manifest.orphanCounts = orphanCounts;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  dryRun: false,
  archiveDirectory: archiveDir,
  preflight,
  postflight,
  bookmarkCaptured: Boolean(bookmark),
}));
