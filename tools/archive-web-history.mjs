#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, posix, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SEED_COMMIT = "11cf57741bc8c03bfca3412e56090591b9abdcdc";
export const SEED_ENTRY_PATH = "index.html";
export const SEED_SHA256 = "08c1ecfb9851ecaf6c54164285a94865c4d7c0ccc72faee0bf518cf8405ac78c";
export const TREE_HASH_ALGORITHM = "archive-web-tree-v1";

export const INITIAL_REVIEW_GROUPS = Object.freeze([
  {
    id: "first-system-refinement",
    commits: ["6ace78c", "df16adf"],
    representative: "df16adf",
    reason: "A temporary mobile/touch excursion at 6ace78c was restored to the inaugural graph at df16adf.",
    proposed_lineage_role: "restoration",
  },
  {
    id: "landing-page-redirection",
    commits: ["97aa62f"],
    representative: "97aa62f",
    reason: "A commit explicitly identified as an updated landing-page design.",
  },
  {
    id: "new-home-system",
    commits: ["478f243"],
    representative: "478f243",
    reason: "A new homepage direction changed the root experience and its supporting systems.",
  },
  {
    id: "puzzle-entry-room-introduced",
    title: "Puzzle / Entry Room introduced",
    commits: ["ba4ff83564f2828f9e6deb2f4d6e84a56acdf609"],
    representative: "ba4ff83564f2828f9e6deb2f4d6e84a56acdf609",
    reason: "The Puzzle first appeared at /entry-room/ while the existing root landing page remained byte-identical.",
    proposed_lineage_role: "exploratory-branch",
    entry_path: "entry-room/index.html",
  },
  {
    id: "entry-room-home-split",
    commits: ["da31b71"],
    representative: "da31b71",
    reason: "The former homepage moved to /home/ while the root became an entry threshold.",
    entry_path: "home/index.html",
  },
  {
    id: "entry-threshold-eye-direction",
    commits: ["0ec9801"],
    representative: "0ec9801",
    reason: "The entry threshold gained the eye assets and a distinct navigation direction.",
  },
]);

const TEXT_EXTENSIONS = new Set([".css", ".html", ".htm", ".js", ".mjs", ".cjs", ".json", ".svg", ".txt", ".md", ".xml"]);
const CSS_EXTENSIONS = new Set([".css"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const UNSUPPORTED_BUNDLE_EXTENSIONS = new Set([
  ".7z", ".bat", ".bz2", ".cgi", ".cmd", ".com", ".dll", ".exe", ".gz", ".msi", ".php", ".pl", ".ps1", ".py",
  ".rar", ".rb", ".sh", ".tar", ".tgz", ".wasm", ".xz", ".zip",
]);
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(args, { encoding = "utf8", allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding,
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr || "");
    throw new Error(`git ${args[0]} failed: ${detail.trim() || `exit ${result.status}`}`);
  }
  return result;
}

export function resolveCommit(reference = "HEAD") {
  if (!reference || reference.startsWith("-")) throw new Error("Invalid Git reference.");
  const result = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`]);
  const commit = result.stdout.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Git did not resolve ${reference} to a commit.`);
  return commit;
}

export function normalizeArchivePath(input) {
  const value = String(input || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value || value.includes("\0") || /^[a-z]:\//i.test(value) || value.startsWith("//")) {
    throw new Error(`Unsafe archive path: ${input}`);
  }
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Archive path escapes its snapshot: ${input}`);
  }
  return normalized.replace(/^\.\//, "");
}

export function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function normalizedSourceHash(value) {
  return sha256(Buffer.from(normalizeText(value), "utf8"));
}

function extension(path) {
  const match = /(?:^|\/)[^/]*(\.[a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "";
}

export function listCommitTree(reference) {
  const commit = resolveCommit(reference);
  const result = git(["ls-tree", "-r", "-z", "--name-only", commit], { encoding: null });
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeArchivePath);
}

export function readCommitFile(reference, archivePath) {
  const commit = resolveCommit(reference);
  const safePath = normalizeArchivePath(archivePath);
  const result = git(["show", `${commit}:${safePath}`], { encoding: null });
  return result.stdout;
}

export function readCommitMetadata(reference) {
  const commit = resolveCommit(reference);
  const format = "%H%x00%P%x00%aI%x00%an%x00%ae%x00%s";
  const fields = git(["show", "-s", `--format=${format}`, commit]).stdout.replace(/\r?\n$/, "").split("\0");
  return {
    commit: fields[0],
    parents: (fields[1] || "").split(" ").filter(Boolean),
    authored_at: fields[2] || "",
    author_name: fields[3] || "",
    author_email: fields[4] || "",
    subject: fields[5] || "",
  };
}

function summarizeDataReference(reference) {
  if (!reference.startsWith("data:")) return reference;
  const comma = reference.indexOf(",");
  const metadata = comma >= 0 ? reference.slice(0, comma) : reference.slice(0, 80);
  return `${metadata},[embedded ${reference.length} characters; sha256:${sha256(reference).slice(0, 16)}]`;
}

function stripQueryAndFragment(reference) {
  return reference.split("#", 1)[0].split("?", 1)[0];
}

function isExternalReference(reference) {
  return /^(?:https?:)?\/\//i.test(reference);
}

function isIgnoredReference(reference) {
  return !reference || reference.startsWith("#") || /^(?:mailto|tel):/i.test(reference);
}

function resolveReference(fromPath, reference) {
  const clean = stripQueryAndFragment(reference).replaceAll("\\", "/");
  const joined = clean.startsWith("/") ? clean.slice(1) : posix.join(posix.dirname(fromPath), clean);
  try {
    return normalizeArchivePath(joined);
  } catch {
    return null;
  }
}

function attributes(tagSource) {
  const found = new Map();
  const pattern = /([^\s=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tagSource.matchAll(pattern)) found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return found;
}

function srcsetReferences(value) {
  return value.split(",").map((part) => part.trim().split(/\s+/, 1)[0]).filter(Boolean);
}

function htmlReferences(source) {
  const references = [];
  const tagPattern = /<(a|link|script|img|source|video|audio|track|iframe|object|embed)\b[^>]*>/gi;
  for (const match of source.matchAll(tagPattern)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[0]);
    if (tag === "a" && attrs.has("href")) references.push({ reference: attrs.get("href"), kind: "navigation" });
    else if (tag === "link" && attrs.has("href")) {
      const rel = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
      if (rel.includes("stylesheet")) references.push({ reference: attrs.get("href"), kind: "stylesheet" });
      else if (rel.some((value) => value.includes("icon"))) references.push({ reference: attrs.get("href"), kind: "image" });
    } else if (tag === "object" && attrs.has("data")) references.push({ reference: attrs.get("data"), kind: "blocked-embed" });
    else if (attrs.has("src")) references.push({ reference: attrs.get("src"), kind: tag === "script" ? "script" : tag === "iframe" || tag === "embed" ? "blocked-embed" : "asset" });
    if ((tag === "video" || tag === "audio") && attrs.has("poster")) references.push({ reference: attrs.get("poster"), kind: "image" });
    if (attrs.has("srcset")) for (const reference of srcsetReferences(attrs.get("srcset"))) references.push({ reference, kind: "asset" });
  }
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    references.push(...cssReferences(match[1]));
  }
  for (const match of source.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    references.push(...javascriptReferences(match[1]));
  }
  for (const match of source.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    references.push(...cssReferences(match[1] ?? match[2] ?? ""));
  }
  // Early versions stored navigation destinations in JavaScript object literals.
  for (const match of source.matchAll(/\burl\s*:\s*(["'])([^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "navigation" });
  }
  // Canvas-era prototypes also assigned embedded images directly to Image.src.
  for (const match of source.matchAll(/\b(?:src|href)\s*=\s*(["'])(data:[^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "asset" });
  }
  return references;
}

function cssReferences(source) {
  const references = [];
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))/gi)) {
    references.push({ reference: match[1] ?? match[2] ?? match[3] ?? "", kind: "stylesheet" });
  }
  for (const match of source.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
    const reference = match[1] ?? match[2] ?? match[3] ?? "";
    if (!references.some((item) => item.reference === reference && item.kind === "stylesheet")) references.push({ reference, kind: "asset" });
  }
  return references;
}

function javascriptReferences(source) {
  const references = [];
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?(["'])([^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "script" });
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
    references.push({ reference: match[2], kind: "script" });
  }
  for (const match of source.matchAll(/\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(["'])([^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "script" });
  }
  for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*(["'])([^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "asset" });
  }
  for (const match of source.matchAll(/\b(?:fetch|sendBeacon)\s*\(\s*(["'])([^"']+)\1/g)) {
    references.push({ reference: match[2], kind: "network" });
  }
  const patterns = [
    /\bfetch\s*\(\s*([^\s"'][^,)]*)/g,
    /\bnew\s+(?:Request|Worker|SharedWorker)\s*\(\s*([^\s"'][^,)]*)/g,
    /\bimport\s*\(\s*([^\s"'][^)]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.push({ reference: match[1].trim().slice(0, 160), kind: "dynamic" });
  }
  return references;
}

function referenceStatus(fromPath, item, exactPaths, lowercasePaths) {
  const reference = String(item.reference || "").trim();
  if (isIgnoredReference(reference)) return null;
  if (reference.startsWith("data:")) return { status: "embedded", normalized_path: "", original_ref: summarizeDataReference(reference) };
  if (item.kind === "dynamic") return { status: "unverifiable", normalized_path: "", original_ref: reference };
  if (item.kind === "network") return { status: "external-blocked", normalized_path: "", original_ref: reference };
  if (/^(?:javascript|vbscript):/i.test(reference) || isExternalReference(reference)) {
    return { status: item.kind === "navigation" ? "navigation" : "external-blocked", normalized_path: "", original_ref: reference };
  }
  const normalized = resolveReference(fromPath, reference);
  if (item.kind === "navigation") return { status: "navigation", normalized_path: normalized || "", original_ref: reference };
  if (!normalized) return { status: "missing", normalized_path: "", original_ref: reference };
  if (UNSUPPORTED_BUNDLE_EXTENSIONS.has(extension(normalized))) return { status: "missing", normalized_path: normalized, original_ref: reference };
  if (exactPaths.has(normalized)) return { status: "resolved", normalized_path: normalized, original_ref: reference };
  const caseMatch = lowercasePaths.get(normalized.toLowerCase());
  if (caseMatch) return { status: "case-mismatch", normalized_path: caseMatch, original_ref: reference };
  return { status: "missing", normalized_path: normalized, original_ref: reference };
}

export function scanFileGraph(fileMap, entryPath = SEED_ENTRY_PATH, loadFile = null) {
  const normalizedEntry = normalizeArchivePath(entryPath);
  const normalizedFiles = new Map();
  for (const [path, value] of fileMap) {
    normalizedFiles.set(normalizeArchivePath(path), value == null ? null : Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  if (!normalizedFiles.has(normalizedEntry)) throw new Error(`Entry HTML does not exist: ${normalizedEntry}`);

  const content = (path) => {
    let value = normalizedFiles.get(path);
    if (value == null && loadFile) {
      const loaded = loadFile(path);
      value = Buffer.isBuffer(loaded) ? loaded : Buffer.from(loaded);
      normalizedFiles.set(path, value);
    }
    if (!Buffer.isBuffer(value)) throw new Error(`Snapshot file content is unavailable: ${path}`);
    return value;
  };

  const exactPaths = new Set(normalizedFiles.keys());
  const lowercasePaths = new Map();
  for (const path of exactPaths) {
    const key = path.toLowerCase();
    if (!lowercasePaths.has(key)) lowercasePaths.set(key, path);
  }

  const dependencies = [];
  const dependencyKeys = new Set();
  const includedFiles = new Set([normalizedEntry]);
  const queue = [normalizedEntry];
  const scanned = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (scanned.has(current)) continue;
    scanned.add(current);
    const ext = extension(current);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const source = content(current).toString("utf8");
    let references = [];
    if (HTML_EXTENSIONS.has(ext)) references = htmlReferences(source);
    else if (CSS_EXTENSIONS.has(ext)) references = cssReferences(source);
    else if (JS_EXTENSIONS.has(ext)) references = javascriptReferences(source);

    for (const item of references) {
      const resolved = referenceStatus(current, item, exactPaths, lowercasePaths);
      if (!resolved) continue;
      const dependency = { from_path: current, original_ref: resolved.original_ref, normalized_path: resolved.normalized_path, kind: item.kind, status: resolved.status };
      const key = JSON.stringify(dependency);
      if (!dependencyKeys.has(key)) {
        dependencyKeys.add(key);
        dependencies.push(dependency);
      }
      if ((resolved.status === "resolved" || resolved.status === "case-mismatch") && resolved.normalized_path) {
        includedFiles.add(resolved.normalized_path);
        if (TEXT_EXTENSIONS.has(extension(resolved.normalized_path))) queue.push(resolved.normalized_path);
      }
    }
  }

  dependencies.sort((a, b) => a.from_path.localeCompare(b.from_path) || a.status.localeCompare(b.status) || a.original_ref.localeCompare(b.original_ref));
  const statusCounts = Object.fromEntries(["resolved", "missing", "external-blocked", "navigation", "embedded", "case-mismatch", "unverifiable", "accepted-missing"].map((status) => [status, 0]));
  for (const dependency of dependencies) statusCounts[dependency.status] = (statusCounts[dependency.status] || 0) + 1;
  return {
    entry_path: normalizedEntry,
    included_files: [...includedFiles].sort(),
    dependencies,
    summary: {
      total: dependencies.length,
      resolved: statusCounts.resolved,
      missing: statusCounts.missing,
      external_blocked: statusCounts["external-blocked"],
      navigation: statusCounts.navigation,
      embedded: statusCounts.embedded,
      case_mismatch: statusCounts["case-mismatch"],
      unverifiable: statusCounts.unverifiable,
      accepted_missing: statusCounts["accepted-missing"],
    },
  };
}

function fileMapForCommit(reference) {
  const commit = resolveCommit(reference);
  // Keep every tree path (including binary media) available for exact and
  // case-insensitive dependency resolution. Bodies are loaded only when the
  // graph actually references them.
  const files = new Map(listCommitTree(commit).map((path) => [path, null]));
  const load = (path) => {
    const existing = files.get(path);
    if (Buffer.isBuffer(existing)) return existing;
    const value = readCommitFile(commit, path);
    files.set(path, value);
    return value;
  };
  return { files, load };
}

export function inspectCommit(reference, entryPath = SEED_ENTRY_PATH) {
  const commit = resolveCommit(reference);
  const entry = normalizeArchivePath(entryPath);
  const tree = fileMapForCommit(commit);
  const entryBuffer = tree.load(entry);
  const graph = scanFileGraph(tree.files, entry, tree.load);
  const bundleHashes = graph.included_files.map((path) => {
    const bytes = tree.load(path);
    return { path, sha256: sha256(bytes), byte_size: bytes.byteLength };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")));
  const treeHash = sha256(`${TREE_HASH_ALGORITHM}\n${bundleHashes.map((file) => `${file.path}\0${file.sha256}\0${file.byte_size}\n`).join("")}`);
  const seedValidation = commit === SEED_COMMIT ? {
    expected_sha256: SEED_SHA256,
    matches_expected_sha256: sha256(entryBuffer) === SEED_SHA256,
  } : null;
  if (seedValidation && !seedValidation.matches_expected_sha256) throw new Error("The inaugural index.html hash does not match the approved seed.");
  return {
    ...readCommitMetadata(commit),
    entry_path: entry,
    entry_sha256: sha256(entryBuffer),
    normalized_entry_sha256: normalizedSourceHash(entryBuffer.toString("utf8")),
    tree_sha256: treeHash,
    tree_hash_algorithm: TREE_HASH_ALGORITHM,
    files: bundleHashes,
    dependency_report: { summary: graph.summary, dependencies: graph.dependencies },
    seed_validation: seedValidation,
  };
}

function commitDiffStats(reference) {
  const commit = resolveCommit(reference);
  const lines = git(["diff-tree", "--root", "--no-commit-id", "--numstat", "-r", commit]).stdout.split(/\r?\n/).filter(Boolean);
  let added = 0;
  let deleted = 0;
  const paths = [];
  for (const line of lines) {
    const [rawAdded, rawDeleted, ...pathParts] = line.split("\t");
    if (/^\d+$/.test(rawAdded)) added += Number(rawAdded);
    if (/^\d+$/.test(rawDeleted)) deleted += Number(rawDeleted);
    paths.push(pathParts.join("\t"));
  }
  return { added, deleted, paths: paths.filter(Boolean) };
}

function fileAtCommitIfPresent(commit, path) {
  const result = git(["show", `${commit}:${path}`], { encoding: null, allowFailure: true });
  return result.status === 0 ? result.stdout : null;
}

export function classifyTextTransition(previous, next, priorNormalizedHashes = new Map()) {
  const nextNormalized = normalizedSourceHash(next);
  const previousNormalized = previous == null ? "" : normalizedSourceHash(previous);
  if (previous != null && nextNormalized === previousNormalized) return { classification: "cosmetic-only", normalized_sha256: nextNormalized };
  if (priorNormalizedHashes.has(nextNormalized)) return { classification: "restoration", normalized_sha256: nextNormalized, restores_commit: priorNormalizedHashes.get(nextNormalized) };
  return { classification: "changed", normalized_sha256: nextNormalized };
}

export function discoverIndexHistory() {
  const format = "%H%x00%P%x00%aI%x00%s";
  const raw = git(["log", "--reverse", `--format=${format}`, "--all", "--", "index.html", "home/index.html"]).stdout;
  const commits = raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, parents, authoredAt, subject] = line.split("\0");
    return { commit, parents: (parents || "").split(" ").filter(Boolean), authored_at: authoredAt, subject };
  });
  const priorHashes = new Map([["index.html", new Map()], ["home/index.html", new Map()]]);
  const history = [];
  for (const item of commits) {
    const stats = commitDiffStats(item.commit);
    const changedEntries = ["index.html", "home/index.html"].filter((path) => stats.paths.includes(path));
    for (const entryPath of changedEntries) {
      const next = fileAtCommitIfPresent(item.commit, entryPath);
      if (!next) {
        history.push({ ...item, entry_path: entryPath, classification: "removed", normalized_sha256: "", stats });
        continue;
      }
      const parent = item.parents[0] || "";
      const previous = parent ? fileAtCommitIfPresent(parent, entryPath) : null;
      const knownHashes = priorHashes.get(entryPath);
      const transition = classifyTextTransition(previous?.toString("utf8") ?? null, next.toString("utf8"), knownHashes);
      if (!knownHashes.has(transition.normalized_sha256)) knownHashes.set(transition.normalized_sha256, item.commit);
      if (transition.classification === "cosmetic-only") continue;
      history.push({ ...item, entry_path: entryPath, ...transition, stats });
    }
  }
  return history;
}

export function buildInitialReviewQueue() {
  return INITIAL_REVIEW_GROUPS.map((group) => {
    const commits = group.commits.map((reference) => ({ ...readCommitMetadata(reference), stats: commitDiffStats(reference) }));
    const representativeCommit = resolveCommit(group.representative);
    return {
      ...group,
      commits,
      representative: representativeCommit,
      review_decision: "pending",
      proposed_lineage_role: group.proposed_lineage_role || "canonical-state",
    };
  });
}

export function buildScanReport() {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    seed: inspectCommit(SEED_COMMIT, SEED_ENTRY_PATH),
    initial_review_queue: buildInitialReviewQueue(),
    history: discoverIndexHistory(),
  };
}

export function selectReviewCandidate(report, candidateId = "") {
  if (!candidateId) return report;
  const selected = (report.initial_review_queue || []).filter((candidate) => candidate.id === candidateId);
  if (selected.length !== 1) throw new Error(`Unknown history candidate: ${candidateId}`);
  return { ...report, initial_review_queue: selected };
}

function ensureEmptyBundleDirectory(outputDirectory) {
  const target = resolve(outputDirectory);
  if (existsSync(target) && readdirSync(target).length) throw new Error(`Bundle directory is not empty: ${target}`);
  mkdirSync(target, { recursive: true });
  return target;
}

export function writeBundle(reference, entryPath, outputDirectory) {
  const inspection = inspectCommit(reference, entryPath);
  const target = ensureEmptyBundleDirectory(outputDirectory);
  for (const file of inspection.files) {
    const destination = join(target, "source", ...file.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readCommitFile(inspection.commit, file.path));
  }
  const manifest = { schema_version: 1, source_kind: "git", lineage_role: inspection.commit === SEED_COMMIT ? "canonical-state" : "exploratory-branch", ...inspection };
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function captureMimeType(path) {
  return uploadMimeType(path).replace("text/javascript", "application/javascript");
}

function captureCsp(origin) {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin} blob:`,
    `style-src 'unsafe-inline' ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `media-src ${origin} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "sandbox allow-scripts",
  ].join("; ");
}

async function startCaptureServer(sourceDirectory, entryPath) {
  let origin = "";
  const sourceRoot = resolve(sourceDirectory);
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", origin || "http://127.0.0.1");
    const rawPath = requestUrl.pathname === "/" ? entryPath : requestUrl.pathname.slice(1);
    let safePath;
    try { safePath = normalizeArchivePath(decodeURIComponent(rawPath)); } catch { safePath = ""; }
    const diskPath = safePath ? resolve(sourceRoot, ...safePath.split("/")) : "";
    const safeDiskPath = diskPath && (diskPath === sourceRoot || diskPath.startsWith(`${sourceRoot}\\`) || diskPath.startsWith(`${sourceRoot}/`));
    if (!safeDiskPath || !existsSync(diskPath) || !statSync(diskPath).isFile()) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-security-policy": captureCsp(origin), "cache-control": "no-store" });
      response.end("<!doctype html><title>Historical navigation blocked</title><h1>Historical navigation blocked</h1>");
      return;
    }
    const body = readFileSync(diskPath);
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-security-policy": captureCsp(origin),
      "content-type": captureMimeType(safePath),
      "content-length": String(body.length),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

export function playwrightInvocation(commandArgs, cwd) {
  const explicit = process.env.PLAYWRIGHT_CLI_PATH || "";
  let command;
  let args;
  if (explicit && /\.(?:cmd|bat)$/i.test(explicit)) {
    const cliModule = resolve(dirname(explicit), "..", "@playwright", "cli", "playwright-cli.js");
    if (!existsSync(cliModule)) throw new Error(`Cannot resolve the Playwright CLI module beside ${explicit}.`);
    command = process.execPath;
    args = [cliModule, ...commandArgs];
  } else if (explicit) {
    command = explicit;
    args = commandArgs;
  } else {
    const npxModule = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (existsSync(npxModule)) {
      command = process.execPath;
      args = [npxModule, "--yes", "--package", "@playwright/cli", "playwright-cli", ...commandArgs];
    } else {
      command = process.platform === "win32" ? "npx.cmd" : "npx";
      args = ["--yes", "--package", "@playwright/cli", "playwright-cli", ...commandArgs];
    }
  }
  return new Promise((resolveRun, reject) => {
    const needsWindowsShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
    const child = spawn(command, args, { cwd, windowsHide: true, shell: needsWindowsShell, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`playwright-cli ${commandArgs[1] || commandArgs[0]} failed (${code}): ${(stderr || stdout).trim()}`)));
  });
}

function rootRelativeCaptureUrl(path) {
  const repositoryRoot = resolve(git(["rev-parse", "--show-toplevel"]).stdout.trim());
  const relativePath = relative(repositoryRoot, resolve(path)).replaceAll("\\", "/");
  if (!relativePath || relativePath === ".." || relativePath.startsWith("../")) return "";
  return `/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export async function captureCommit(reference, entryPath, outputDirectory, { label = "snapshot", captureUrlBase = "" } = {}) {
  const target = ensureEmptyBundleDirectory(outputDirectory);
  if (process.platform === "win32" && /[&|<>^%!]/.test(target)) throw new Error("Capture output path contains characters unsafe for the Windows Playwright wrapper.");
  const bundleDirectory = join(target, "bundle");
  const manifest = writeBundle(reference, entryPath, bundleDirectory);
  const server = await startCaptureServer(join(bundleDirectory, "source"), manifest.entry_path);
  const session = `archive-web-${label.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}-${manifest.commit.slice(0, 7)}`;
  const desktopPath = join(target, "desktop-1440x1000.png");
  const mobilePath = join(target, "mobile-390x844.png");
  let network = "";
  let consoleOutput = "";
  try {
    const entryUrl = `${server.origin}/${manifest.entry_path.split("/").map(encodeURIComponent).join("/")}`;
    await playwrightInvocation([`-s=${session}`, "open", entryUrl], target);
    await playwrightInvocation([`-s=${session}`, "resize", "1440", "1000"], target);
    await playwrightInvocation([`-s=${session}`, "run-code", "async (page) => { const stage = page.locator('#stage'); if (await stage.count()) { const box = await stage.boundingBox(); if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); } await page.waitForTimeout(4200); }"], target);
    await playwrightInvocation([`-s=${session}`, "screenshot", `--filename=${desktopPath}`], target);
    await playwrightInvocation([`-s=${session}`, "resize", "390", "844"], target);
    await playwrightInvocation([`-s=${session}`, "run-code", "async (page) => { await page.waitForTimeout(500); }"], target);
    await playwrightInvocation([`-s=${session}`, "screenshot", `--filename=${mobilePath}`], target);
    network = (await playwrightInvocation([`-s=${session}`, "requests"], target)).stdout;
    consoleOutput = (await playwrightInvocation([`-s=${session}`, "console", "warning"], target)).stdout;
  } finally {
    try { await playwrightInvocation([`-s=${session}`, "close"], target); } catch {}
    await server.close();
  }
  writeFileSync(join(target, "network.txt"), network, "utf8");
  writeFileSync(join(target, "console-warnings.txt"), consoleOutput, "utf8");
  const capture = {
    commit: manifest.commit,
    entry_path: manifest.entry_path,
    desktop_capture_path: resolve(desktopPath),
    mobile_capture_path: resolve(mobilePath),
    desktop_capture_url: captureUrlBase ? `${captureUrlBase.replace(/\/$/, "")}/${encodeURIComponent(label)}/desktop-1440x1000.png` : rootRelativeCaptureUrl(desktopPath),
    mobile_capture_url: captureUrlBase ? `${captureUrlBase.replace(/\/$/, "")}/${encodeURIComponent(label)}/mobile-390x844.png` : rootRelativeCaptureUrl(mobilePath),
    network_log_path: resolve(join(target, "network.txt")),
    console_log_path: resolve(join(target, "console-warnings.txt")),
    network_policy: "CSP connect-src none; external styles, scripts, images, fonts, frames, workers, forms, and objects blocked",
  };
  writeFileSync(join(target, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  return capture;
}

export async function captureReviewQueue(outputDirectory, { includeSeed = true, captureUrlBase = "" } = {}) {
  const target = ensureEmptyBundleDirectory(outputDirectory);
  const captures = {};
  if (includeSeed) captures.seed = await captureCommit(SEED_COMMIT, SEED_ENTRY_PATH, join(target, "seed"), { label: "seed", captureUrlBase });
  for (const candidate of INITIAL_REVIEW_GROUPS) {
    captures[candidate.id] = await captureCommit(candidate.representative, candidate.entry_path || SEED_ENTRY_PATH, join(target, candidate.id), { label: candidate.id, captureUrlBase });
  }
  const manifest = { schema_version: 1, generated_at: new Date().toISOString(), captures };
  writeFileSync(join(target, "capture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function option(args, name, fallback = "") {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value.`);
  return args[index + 1];
}

function safeAdminBase(value) {
  const url = new URL(value);
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) throw new Error("Admin base URL must use HTTPS (or localhost for development).");
  return url.origin;
}

async function adminRequest(baseUrl, path, token, { method = "POST", body, contentType = "application/json" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(contentType ? { "content-type": contentType } : {}) },
    ...(body === undefined ? {} : { body: contentType === "application/json" ? JSON.stringify(body) : body }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}${payload?.error ? `: ${payload.error}` : ""}.`);
  return payload;
}

function uploadMimeType(path) {
  const ext = extension(path);
  return ({
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4",
    ".webm": "video/webm", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  })[ext] || "application/octet-stream";
}

async function importInspection(baseUrl, token, dossierEntityId, stateId, inspection, { title, lineageRole }) {
  const stateAssociation = stateId ? { state_id: stateId } : {};
  const listing = await adminRequest(baseUrl, `/api/admin/archive-web-snapshots?entity_id=${encodeURIComponent(dossierEntityId)}`, token, { method: "GET", contentType: "" });
  const existingMatches = (listing?.records || listing?.snapshots || []).filter((snapshot) => (
    snapshot.source_kind === "git"
    && snapshot.git_commit_sha === inspection.commit
    && snapshot.entry_path === inspection.entry_path
  ));
  if (existingMatches.length > 1) throw new Error(`Multiple Git snapshots already claim ${inspection.commit}:${inspection.entry_path}.`);
  let created = null;
  let snapshotId = existingMatches[0]?.id || "";
  if (!snapshotId) {
    created = await adminRequest(baseUrl, "/api/admin/archive-web-snapshots", token, {
      body: {
        dossier_entity_id: dossierEntityId,
        ...stateAssociation,
        title,
        source_kind: "git",
        lineage_role: lineageRole,
        entry_path: inspection.entry_path,
        git_commit_sha: inspection.commit,
        git_parent_sha: inspection.parents[0] || "",
        git_commit_at: inspection.authored_at,
        git_commit_date: inspection.authored_at,
        git_author: `${inspection.author_name} <${inspection.author_email}>`,
        git_message: inspection.subject,
        expected_tree_sha256: inspection.tree_sha256,
        tree_hash_algorithm: inspection.tree_hash_algorithm,
      },
    });
    snapshotId = created?.record?.id || created?.snapshot?.id;
    if (!snapshotId) throw new Error("Snapshot creation response did not include an ID.");
  } else {
    const detailPayload = await adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}`, token, { method: "GET", contentType: "" });
    const detail = detailPayload?.record || detailPayload?.snapshot || {};
    const actualFiles = new Map((detail.files || []).map((file) => [file.normalized_path, `${file.source_sha256}\0${Number(file.byte_size)}`]));
    const expectedFiles = new Map(inspection.files.map((file) => [file.path, `${file.sha256}\0${Number(file.byte_size)}`]));
    const matches = actualFiles.size === expectedFiles.size && [...expectedFiles].every(([path, signature]) => actualFiles.get(path) === signature);
    if (!matches) throw new Error(`Existing Git snapshot ${snapshotId} conflicts with ${inspection.commit}:${inspection.entry_path}; curate or remove the conflicting draft before resyncing.`);
    const storedExpectedHash = detail.expected_tree_sha256 || detail.expectedTreeSha256 || "";
    if (storedExpectedHash && storedExpectedHash !== inspection.tree_sha256) {
      throw new Error(`Existing Git snapshot ${snapshotId} declares expected tree SHA-256 ${storedExpectedHash}, not ${inspection.tree_sha256}.`);
    }
    if (!storedExpectedHash) {
      // Snapshots imported before archive-web-tree-v1 may still carry the
      // earlier aggregate checksum. Recompute from the already verified,
      // immutable file rows before asking the API to lock the Git manifest
      // hash; the API deliberately refuses to overwrite a conflicting hash.
      const rescanned = await adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/finalize`, token, { body: {} });
      const rescannedTreeHash = rescanned?.record?.tree_sha256 || rescanned?.snapshot?.tree_sha256;
      if (rescannedTreeHash !== inspection.tree_sha256) {
        throw new Error(`Existing Git snapshot ${snapshotId} rescanned to tree SHA-256 ${rescannedTreeHash || "missing"}, not ${inspection.tree_sha256}.`);
      }
      const verified = await adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}`, token, {
        method: "PATCH",
        body: { expected_tree_sha256: inspection.tree_sha256 },
      });
      const persisted = verified?.record?.expected_tree_sha256 || verified?.snapshot?.expected_tree_sha256;
      if (persisted !== inspection.tree_sha256) throw new Error(`Existing Git snapshot ${snapshotId} did not persist its verified expected tree SHA-256.`);
      created = { record: verified.record || verified.snapshot, snapshot: verified.snapshot || verified.record, unchanged: true };
    }
    if (!created) created = { record: detail, snapshot: detail, unchanged: true };
  }
  const uploaded = [];
  if (!existingMatches.length) {
    for (const file of inspection.files) {
      const encodedPath = file.path.split("/").map(encodeURIComponent).join("%2F");
      uploaded.push(await adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/files/${encodedPath}`, token, {
        method: "PUT",
        body: readCommitFile(inspection.commit, file.path),
        contentType: uploadMimeType(file.path),
      }));
    }
  }
  const finalized = await adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/finalize`, token, { body: {} });
  const finalizedTreeHash = finalized?.record?.tree_sha256 || finalized?.snapshot?.tree_sha256;
  if (finalizedTreeHash !== inspection.tree_sha256) throw new Error(`Finalized tree SHA-256 ${finalizedTreeHash || "missing"} did not match the Git manifest ${inspection.tree_sha256}.`);
  return { id: snapshotId, created, uploaded, finalized, reused: existingMatches.length === 1 };
}

async function uploadCandidateCapture(baseUrl, token, candidateId, viewport, path) {
  if (!path) return null;
  const resolvedPath = resolve(path);
  const mime = captureMimeType(resolvedPath);
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error(`Unsupported generated capture type: ${resolvedPath}`);
  return adminRequest(baseUrl, `/api/admin/archive-web-history-candidates/${encodeURIComponent(candidateId)}/captures/${viewport}`, token, {
    method: "PUT",
    body: readFileSync(resolvedPath),
    contentType: mime,
  });
}

async function uploadSnapshotCapture(baseUrl, token, snapshotId, viewport, path) {
  if (!path) return null;
  const resolvedPath = resolve(path);
  const mime = captureMimeType(resolvedPath);
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error(`Unsupported generated capture type: ${resolvedPath}`);
  return adminRequest(baseUrl, `/api/admin/archive-web-snapshots/${encodeURIComponent(snapshotId)}/captures/${viewport}`, token, {
    method: "PUT",
    body: readFileSync(resolvedPath),
    contentType: mime,
  });
}

function loadCaptureManifest(path, candidateId = "") {
  if (!path) return { captures: {} };
  const payload = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!payload || typeof payload !== "object") return { captures: {} };
  if (payload.captures && typeof payload.captures === "object") return payload;
  if (candidateId && (payload.desktop_capture_path || payload.mobile_capture_path)) {
    return { captures: { [candidateId]: payload } };
  }
  return { captures: {} };
}

export async function seedStudioArchive(report, adminBase, tokenEnvironment = "SUBMISSIONS_ADMIN_TOKEN", options = {}) {
  const baseUrl = safeAdminBase(adminBase);
  const token = process.env[tokenEnvironment];
  if (!token) throw new Error(`Missing admin token environment variable: ${tokenEnvironment}`);

  let started;
  try {
    started = await adminRequest(baseUrl, "/api/admin/archive-web-snapshots/start", token, { body: {} });
  } catch (error) {
    if (!/HTTP 404/.test(error.message)) throw error;
    started = await adminRequest(baseUrl, "/api/admin/archive-web/start", token, { body: {} });
  }
  const dossierEntityId = started?.record?.id || started?.record?.entity_id || started?.dossier?.entity_id;
  const stateId = started?.state?.id;
  if (!dossierEntityId || !stateId) throw new Error("Start Website Archive response did not include its dossier record and State I.");

  const seedImport = await importInspection(baseUrl, token, dossierEntityId, stateId, report.seed, {
    title: "First committed landing page",
    lineageRole: "canonical-state",
  });
  const captureManifest = loadCaptureManifest(options.captureManifest || "", options.candidateId || "");
  const seedCapture = captureManifest.captures?.seed || {};
  const captureUploads = {
    seed: {
      desktop: await uploadSnapshotCapture(baseUrl, token, seedImport.id, "desktop", seedCapture.desktop_capture_path || ""),
      mobile: await uploadSnapshotCapture(baseUrl, token, seedImport.id, "mobile", seedCapture.mobile_capture_path || ""),
    },
  };
  const importCandidates = options.importCandidates !== false;
  const candidateImports = new Map();
  if (importCandidates) {
    for (const candidate of report.initial_review_queue) {
      const inspection = inspectCommit(candidate.representative, candidate.entry_path || SEED_ENTRY_PATH);
      candidateImports.set(candidate.id, await importInspection(baseUrl, token, dossierEntityId, null, inspection, {
        title: candidate.title || candidate.id.replaceAll("-", " "),
        lineageRole: candidate.proposed_lineage_role || "canonical-state",
      }));
    }
  }
  const records = report.initial_review_queue.map((candidate) => {
    const capture = captureManifest.captures?.[candidate.id] || {};
    const representative = candidate.commits.find((commit) => commit.commit === candidate.representative) || readCommitMetadata(candidate.representative);
    const changedPaths = [...new Set(candidate.commits.flatMap((commit) => commit.stats?.paths || []))];
    const changeVolume = candidate.commits.reduce((total, commit) => total + Number(commit.stats?.added || 0) + Number(commit.stats?.deleted || 0), 0);
    return {
      id: candidate.id,
      dossier_entity_id: dossierEntityId,
      snapshot_id: candidateImports.get(candidate.id)?.id || null,
      commits: candidate.commits.map((commit) => commit.commit),
      title: candidate.title || candidate.id.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase()),
      representative_commit: {
        sha: representative.commit,
        date: representative.authored_at,
        author: `${representative.author_name} <${representative.author_email}>`,
        message: representative.subject,
      },
      reason: candidate.reason,
      reasons: [candidate.reason],
      changed_paths: changedPaths,
      score: Math.max(1, Math.min(100, Math.round(Math.log10(1 + changedPaths.length + changeVolume) * 25))),
      proposed_lineage_role: candidate.proposed_lineage_role,
      review_decision: "pending",
    };
  });
  await adminRequest(baseUrl, "/api/admin/archive-web-history-candidates/sync", token, { body: { records } });
  for (const candidate of report.initial_review_queue) {
    const capture = captureManifest.captures?.[candidate.id] || {};
    captureUploads[candidate.id] = {
      desktop: await uploadCandidateCapture(baseUrl, token, candidate.id, "desktop", capture.desktop_capture_path || ""),
      mobile: await uploadCandidateCapture(baseUrl, token, candidate.id, "mobile", capture.mobile_capture_path || ""),
    };
  }
  const candidates = await adminRequest(baseUrl, `/api/admin/archive-web-history-candidates?entity_id=${encodeURIComponent(dossierEntityId)}`, token, { method: "GET", contentType: "" });
  return { started, seed: seedImport, candidate_imports: Object.fromEntries(candidateImports), capture_uploads: captureUploads, candidates };
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "scan";
  let payload;
  if (command === "inspect") {
    payload = inspectCommit(option(args, "--commit", SEED_COMMIT), option(args, "--entry", SEED_ENTRY_PATH));
  } else if (command === "bundle") {
    const output = option(args, "--out");
    if (!output) throw new Error("bundle requires --out <empty-directory>.");
    payload = writeBundle(option(args, "--commit", SEED_COMMIT), option(args, "--entry", SEED_ENTRY_PATH), output);
  } else if (command === "capture") {
    const output = option(args, "--out");
    if (!output) throw new Error("capture requires --out <empty-directory>.");
    payload = await captureCommit(option(args, "--commit", SEED_COMMIT), option(args, "--entry", SEED_ENTRY_PATH), output, { label: option(args, "--label", "snapshot"), captureUrlBase: option(args, "--capture-url-base", "") });
  } else if (command === "capture-queue") {
    const output = option(args, "--out");
    if (!output) throw new Error("capture-queue requires --out <empty-directory>.");
    payload = await captureReviewQueue(output, { includeSeed: !args.includes("--no-seed"), captureUrlBase: option(args, "--capture-url-base", "") });
  } else if (command === "scan" || command === "sync" || command === "seed") {
    const candidateId = option(args, "--candidate", "");
    const report = selectReviewCandidate(buildScanReport(), candidateId);
    payload = command === "sync" || command === "seed"
      ? await seedStudioArchive(report, option(args, "--base-url", "http://127.0.0.1:4173"), option(args, "--token-env", "SUBMISSIONS_ADMIN_TOKEN"), {
          importCandidates: !args.includes("--metadata-only"),
          captureManifest: option(args, "--capture-manifest", ""),
          candidateId,
        })
      : report;
  } else {
    throw new Error("Usage: archive-web-history.mjs [scan|inspect|bundle|capture|capture-queue|seed|sync] [options]");
  }
  process.stdout.write(`${JSON.stringify(payload, null, args.includes("--compact") ? 0 : 2)}\n`);
  return payload;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`archive-web-history: ${error.message}\n`);
    process.exitCode = 1;
  });
}
