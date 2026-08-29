import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SEED_COMMIT,
  SEED_SHA256,
  buildInitialReviewQueue,
  classifyTextTransition,
  discoverIndexHistory,
  inspectCommit,
  normalizeArchivePath,
  normalizeText,
  scanFileGraph,
  seedStudioArchive,
  writeBundle,
} from "../tools/archive-web-history.mjs";

test("the inaugural committed index is exact and has the approved dependency profile", () => {
  const seed = inspectCommit(SEED_COMMIT, "index.html");
  assert.equal(seed.entry_sha256, SEED_SHA256);
  assert.equal(seed.seed_validation.matches_expected_sha256, true);
  assert.equal(seed.commit, SEED_COMMIT);
  assert.equal(seed.authored_at, "2026-04-15T20:30:19-04:00");
  assert.equal(seed.tree_hash_algorithm, "archive-web-tree-v1");
  assert.deepEqual(seed.dependency_report.summary, {
    total: 48,
    resolved: 0,
    missing: 0,
    external_blocked: 1,
    navigation: 45,
    embedded: 2,
    case_mismatch: 0,
    unverifiable: 0,
    accepted_missing: 0,
  });
  assert.deepEqual(seed.files.map((file) => file.path), ["index.html"]);
});

test("dependency traversal knows binary tree paths and recursively follows CSS", () => {
  const files = new Map([
    ["index.html", '<link rel="stylesheet" href="css/site.css"><img src="Assets/Eye.PNG"><a href="/about">About</a>'],
    ["css/site.css", '@import "nested.css"; .eye{background:url(../assets/eye.png)}'],
    ["css/nested.css", '.font{src:url(../fonts/archive.woff2)}'],
    ["assets/eye.png", Buffer.from([0, 1, 2])],
    ["fonts/archive.woff2", Buffer.from([3, 4, 5])],
  ]);
  const report = scanFileGraph(files, "index.html");
  assert.equal(report.summary.missing, 0);
  assert.equal(report.summary.case_mismatch, 1);
  assert.equal(report.summary.navigation, 1);
  assert.ok(report.included_files.includes("assets/eye.png"));
  assert.ok(report.included_files.includes("fonts/archive.woff2"));
  assert.ok(report.included_files.includes("css/nested.css"));
});

test("normalization suppresses EOL-only changes and recognizes restorations", () => {
  assert.equal(normalizeText("a\r\nb\r\n"), "a\nb\n");
  assert.equal(classifyTextTransition("a\r\nb\r\n", "a\nb\n").classification, "cosmetic-only");
  const prior = new Map([[classifyTextTransition(null, "original").normalized_sha256, "first-commit"]]);
  assert.deepEqual(classifyTextTransition("temporary", "original", prior), {
    classification: "restoration",
    normalized_sha256: classifyTextTransition(null, "original").normalized_sha256,
    restores_commit: "first-commit",
  });
  assert.throws(() => normalizeArchivePath("../outside"), /escapes/);
});

test("initial review queue groups the approved high-signal directions", () => {
  const queue = buildInitialReviewQueue();
  assert.deepEqual(queue.map((candidate) => candidate.id), [
    "first-system-refinement",
    "landing-page-redirection",
    "new-home-system",
    "entry-room-home-split",
    "entry-threshold-eye-direction",
  ]);
  assert.deepEqual(queue[0].commits.map((commit) => commit.commit.slice(0, 7)), ["6ace78c", "df16adf"]);
  assert.match(queue[0].reason, /temporary mobile\/touch excursion[\s\S]*restored/i);
  assert.equal(queue[0].proposed_lineage_role, "restoration");
  assert.equal(queue.find((candidate) => candidate.id === "entry-room-home-split").entry_path, "home/index.html");
  assert.ok(queue.every((candidate) => candidate.review_decision === "pending"));
});

test("the entry-threshold bundle keeps unsupported WASM as missing review evidence", () => {
  const candidate = buildInitialReviewQueue().find((entry) => entry.id === "entry-threshold-eye-direction");
  const inspection = inspectCommit(candidate.representative, candidate.entry_path || "index.html");
  const wasm = inspection.dependency_report.dependencies.find((dependency) => dependency.normalized_path.endsWith("rapier_wasm3d_bg.wasm"));
  assert.equal(wasm.status, "missing");
  assert.equal(inspection.files.some((file) => file.path.endsWith(".wasm")), false);
  assert.ok(inspection.dependency_report.summary.unverifiable > 0, "dynamic JavaScript remains explicit review evidence");
});

test("history suppresses unchanged entry files and recognizes the root/home lineage split", () => {
  const history = discoverIndexHistory();
  assert.ok(history.length > 0);
  assert.ok(history.every((item) => item.classification !== "cosmetic-only"));
  const split = history.filter((item) => item.commit.startsWith("da31b71"));
  assert.deepEqual(new Set(split.map((item) => item.entry_path)), new Set(["index.html", "home/index.html"]));
  assert.ok(history.some((item) => item.classification === "restoration"));
});

test("bundle writes the exact Git blob plus a provenance manifest without checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "sixwell-archive-web-"));
  try {
    const manifest = writeBundle(SEED_COMMIT, "index.html", directory);
    assert.equal(manifest.entry_sha256, SEED_SHA256);
    assert.equal(readFileSync(join(directory, "source", "index.html")).length, 88213);
    assert.equal(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).commit, SEED_COMMIT);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local Studio seed orchestrates start, exact source upload, finalize, and pending candidate sync", { concurrency: false }, async () => {
  const seed = inspectCommit(SEED_COMMIT, "index.html");
  const queue = buildInitialReviewQueue().slice(0, 1);
  const candidateInspection = inspectCommit(queue[0].representative, queue[0].entry_path || "index.html");
  const calls = [];
  const previousFetch = globalThis.fetch;
  let snapshotCreates = 0;
  const captureDirectory = mkdtempSync(join(tmpdir(), "sixwell-archive-captures-"));
  const capturePath = join(captureDirectory, "capture.png");
  const captureManifestPath = join(captureDirectory, "capture-manifest.json");
  writeFileSync(capturePath, Buffer.from([137,80,78,71,13,10,26,10,0]));
  writeFileSync(captureManifestPath, JSON.stringify({ captures: {
    seed: { desktop_capture_path: capturePath, mobile_capture_path: capturePath },
    "first-system-refinement": { desktop_capture_path: capturePath, mobile_capture_path: capturePath },
  } }));
  process.env.ARCHIVE_WEB_TEST_TOKEN = "local-contract-token";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    let payload;
    if (path.endsWith("/start")) payload = { record: { id: "website-record" }, state: { id: "state-I" } };
    else if (path === "/api/admin/archive-web-snapshots" && options.method === "GET") payload = { records: [] };
    else if (path === "/api/admin/archive-web-snapshots") payload = { record: { id: snapshotCreates++ === 0 ? "snapshot-seed" : "snapshot-candidate" } };
    else if (path.endsWith("/snapshot-seed/finalize")) payload = { record: { id: "snapshot-seed", scan_status: "ready", tree_sha256: seed.tree_sha256 } };
    else if (path.endsWith("/snapshot-candidate/finalize")) payload = { record: { id: "snapshot-candidate", scan_status: "ready", tree_sha256: candidateInspection.tree_sha256 } };
    else if (path.endsWith("/sync")) payload = { records: [{ id: "first-system-refinement" }], count: 1 };
    else if (path === "/api/admin/archive-web-history-candidates") payload = { records: [{ id: "first-system-refinement" }], count: 1 };
    else payload = { record: { id: "file-seed" } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await seedStudioArchive({ schema_version: 1, seed, initial_review_queue: queue }, "http://127.0.0.1:4173", "ARCHIVE_WEB_TEST_TOKEN", { captureManifest: captureManifestPath });
    assert.equal(result.seed.finalized.record.scan_status, "ready");
    assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.options.method]), [
      ["/api/admin/archive-web-snapshots/start", "POST"],
      ["/api/admin/archive-web-snapshots", "GET"],
      ["/api/admin/archive-web-snapshots", "POST"],
      ["/api/admin/archive-web-snapshots/snapshot-seed/files/index.html", "PUT"],
      ["/api/admin/archive-web-snapshots/snapshot-seed/finalize", "POST"],
      ["/api/admin/archive-web-snapshots/snapshot-seed/captures/desktop", "PUT"],
      ["/api/admin/archive-web-snapshots/snapshot-seed/captures/mobile", "PUT"],
      ["/api/admin/archive-web-snapshots", "GET"],
      ["/api/admin/archive-web-snapshots", "POST"],
      ["/api/admin/archive-web-snapshots/snapshot-candidate/files/index.html", "PUT"],
      ["/api/admin/archive-web-snapshots/snapshot-candidate/finalize", "POST"],
      ["/api/admin/archive-web-history-candidates/sync", "POST"],
      ["/api/admin/archive-web-history-candidates/first-system-refinement/captures/desktop", "PUT"],
      ["/api/admin/archive-web-history-candidates/first-system-refinement/captures/mobile", "PUT"],
      ["/api/admin/archive-web-history-candidates", "GET"],
    ]);
    const uploaded = Buffer.from(await new Response(calls[3].options.body).arrayBuffer());
    assert.equal(uploaded.length, 88213);
    const candidateCreate = JSON.parse(calls[8].options.body);
    assert.equal(Object.hasOwn(candidateCreate, "state_id"), false, "pending candidates are not assigned to State I before review");
    const synced = JSON.parse(calls[11].options.body);
    assert.equal(synced.records[0].review_decision, "pending");
    assert.equal(synced.records[0].snapshot_id, "snapshot-candidate", "a candidate points only at its own exact representative snapshot");
    assert.equal(synced.records[0].representative_commit.sha.slice(0, 7), "df16adf");
    assert.ok(synced.records[0].score > 0);
    assert.equal(Object.hasOwn(synced.records[0], "desktop_capture_path"), false);
    assert.equal(Object.hasOwn(synced.records[0], "mobile_capture_path"), false);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ARCHIVE_WEB_TEST_TOKEN;
    rmSync(captureDirectory, { recursive: true, force: true });
  }
});

test("Git sync reuses an exact legacy snapshot and persists its first expected tree hash", { concurrency: false }, async () => {
  const seed = inspectCommit(SEED_COMMIT, "index.html");
  const queue = buildInitialReviewQueue().slice(0, 1);
  const calls = [];
  const previousFetch = globalThis.fetch;
  process.env.ARCHIVE_WEB_REUSE_TOKEN = "local-reuse-token";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    let payload;
    if (path.endsWith("/start")) payload = { record: { id: "website-record" }, state: { id: "state-I" } };
    else if (path === "/api/admin/archive-web-snapshots" && options.method === "GET") payload = { records: [{
      id: "snapshot-existing", source_kind: "git", git_commit_sha: seed.commit, entry_path: seed.entry_path,
    }] };
    else if (path === "/api/admin/archive-web-snapshots/snapshot-existing" && options.method === "GET") payload = { record: {
      id: "snapshot-existing", expected_tree_sha256: "", tree_sha256: "0".repeat(64), files: seed.files.map((file) => ({
        normalized_path: file.path, source_sha256: file.sha256, byte_size: file.byte_size,
      })),
    } };
    else if (path === "/api/admin/archive-web-snapshots/snapshot-existing" && options.method === "PATCH") payload = { record: {
      id: "snapshot-existing", expected_tree_sha256: seed.tree_sha256,
    } };
    else if (path.endsWith("/snapshot-existing/finalize")) payload = { record: {
      id: "snapshot-existing", scan_status: "ready", tree_sha256: seed.tree_sha256,
    } };
    else if (path.endsWith("/sync")) payload = { records: [{ id: queue[0].id }], count: 1 };
    else payload = { records: [{ id: queue[0].id }], count: 1 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await seedStudioArchive({ schema_version: 1, seed, initial_review_queue: queue }, "http://127.0.0.1:4173", "ARCHIVE_WEB_REUSE_TOKEN", { importCandidates: false });
    assert.equal(result.seed.reused, true);
    assert.equal(calls.some((call) => new URL(call.url).pathname.includes("/files/")), false, "exact Git evidence is not uploaded again");
    assert.equal(calls.some((call) => new URL(call.url).pathname === "/api/admin/archive-web-snapshots" && call.options.method === "POST"), false);
    const verification = calls.find((call) => new URL(call.url).pathname === "/api/admin/archive-web-snapshots/snapshot-existing" && call.options.method === "PATCH");
    assert.deepEqual(JSON.parse(verification.options.body), { expected_tree_sha256: seed.tree_sha256 });
    const firstRescan = calls.findIndex((call) => new URL(call.url).pathname.endsWith("/snapshot-existing/finalize"));
    const hashLock = calls.findIndex((call) => new URL(call.url).pathname === "/api/admin/archive-web-snapshots/snapshot-existing" && call.options.method === "PATCH");
    assert.ok(firstRescan >= 0 && firstRescan < hashLock, "legacy checksums are recomputed before the canonical Git tree hash is locked");
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ARCHIVE_WEB_REUSE_TOKEN;
  }
});
