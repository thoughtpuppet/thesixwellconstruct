import { db, failure, id, json, readJson, text } from "../_shared/construct.js";
import { unrewritableJavaScriptNavigationFindings } from "../../../shared/archive-viewer-javascript.js";

export const ARCHIVE_WEB_SNAPSHOT_LIMITS = Object.freeze({
  files: 500,
  totalBytes: 100 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  assetBytes: 15 * 1024 * 1024,
  mediaBytes: 50 * 1024 * 1024,
  dependencies: 5000,
});

const SOURCE_KINDS = new Set(["git", "upload"]);
const LINEAGE_ROLES = new Set(["canonical-state", "exploratory-branch", "restoration"]);
const SNAPSHOT_STATES = new Set(["draft", "published", "archived"]);
const REVIEW_DECISIONS = new Set(["pending", "approved-version", "approved-state", "preserved-branch", "merged", "skipped"]);
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const CAPTURE_VIEWPORTS = new Set(["desktop", "mobile"]);
const CAPTURE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SNAPSHOT_MUTATION_KINDS = new Set(["upload", "finalize", "review", "dependency", "capture"]);
const SNAPSHOT_BEHAVIOR_KEYS = new Set(["ring-node-opening", "breathing-eyes", "node-orbits-pathways", "six-living-cultures"]);
const SNAPSHOT_BEHAVIOR_EVOLUTION_ROLES = new Set(["introduced", "refined", "transformed", "disabled", "restored", "observed"]);
const SNAPSHOT_BEHAVIOR_MEANING_STATUSES = new Set(["curator-authored", "code-inferred", "pending-interpretation"]);
const EXTERNAL_REPLACEMENT_NOTE = "local-external-replacement";
const TREE_HASH_ALGORITHM = "archive-web-tree-v1";
const JAVASCRIPT_FULL_SCAN_MAX_CHARS = 512 * 1024;
const JAVASCRIPT_EDGE_SCAN_CHARS = 64 * 1024;
const TEXT_EXTENSIONS = new Set(["html", "htm", "css", "js", "mjs", "cjs", "json", "map", "txt", "md", "xml", "svg", "webmanifest"]);
const MEDIA_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "oga", "mp4", "webm"]);
const BLOCKED_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
  "exe", "dll", "com", "msi", "scr", "bat", "cmd", "ps1", "sh",
  "php", "phtml", "asp", "aspx", "jsp", "cgi", "pl", "py", "rb", "wasm",
]);
const MIME_BY_EXTENSION = Object.freeze({
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", map: "application/json", txt: "text/plain", md: "text/markdown", xml: "application/xml", svg: "image/svg+xml",
  webmanifest: "application/manifest+json", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
  pdf: "application/pdf",
});

const CREDENTIAL_RULES = Object.freeze([
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,255}\b/],
  ["stripe-secret-key", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ["openai-secret-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
]);

function bool(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function safeJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function extension(path) {
  const name = String(path || "").split("/").pop() || "";
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeArchiveWebPath(value) {
  const original = String(value || "").trim().normalize("NFC");
  if (!original || original.length > 1024) throw new Error("Use a relative file path no longer than 1,024 characters.");
  if (/^[a-zA-Z]:[\\/]/.test(original) || /^[/\\]/.test(original) || /^\\\\/.test(original)) throw new Error("Absolute and UNC paths are not allowed.");
  if (/[\u0000-\u001f\u007f]/.test(original) || /%(?:2e|2f|5c)/i.test(original)) throw new Error("The file path contains unsupported control or encoded traversal characters.");
  const parts = original.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes(":"))) throw new Error("The file path must stay inside the snapshot folder.");
  const normalized = parts.join("/");
  if (normalized.length > 1024) throw new Error("Use a relative file path no longer than 1,024 characters.");
  return normalized;
}

function classifyFile(path, suppliedMime = "") {
  const ext = extension(path);
  if (BLOCKED_EXTENSIONS.has(ext)) throw new Error("Archives, executables, scripts for the host system, and server-side code are not supported.");
  const mime = MIME_BY_EXTENSION[ext] || text(suppliedMime, 160).toLowerCase() || "application/octet-stream";
  let role = "other";
  if (["html", "htm"].includes(ext)) role = "html";
  else if (ext === "css") role = "stylesheet";
  else if (["js", "mjs", "cjs"].includes(ext)) role = "script";
  else if (["json", "map", "xml", "webmanifest"].includes(ext)) role = "data";
  else if (mime.startsWith("image/")) role = "image";
  else if (mime.startsWith("font/") || ["woff", "woff2", "ttf", "otf"].includes(ext)) role = "font";
  else if (mime.startsWith("audio/")) role = "audio";
  else if (mime.startsWith("video/")) role = "video";
  else if (mime === "application/pdf") role = "document";
  const viewerEligible = role !== "other" || TEXT_EXTENSIONS.has(ext);
  const maximumBytes = TEXT_EXTENSIONS.has(ext)
    ? ARCHIVE_WEB_SNAPSHOT_LIMITS.textBytes
    : MEDIA_EXTENSIONS.has(ext) ? ARCHIVE_WEB_SNAPSHOT_LIMITS.mediaBytes : ARCHIVE_WEB_SNAPSHOT_LIMITS.assetBytes;
  return { ext, mime, role, viewerEligible, maximumBytes, text: TEXT_EXTENSIONS.has(ext) };
}

function decodeHtmlReference(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_match, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&#(\d+);?/g, (_match, number) => String.fromCodePoint(Number(number)))
    .replace(/&(colon|period|lpar|rpar|comma|sol|bsol|equals|tab|newline);/gi, (_match, name) => ({
      colon: ":", period: ".", lpar: "(", rpar: ")", comma: ",", sol: "/", bsol: "\\", equals: "=", tab: "\t", newline: "\n",
    })[name.toLowerCase()])
    .trim();
}

function dirname(path) {
  const parts = String(path || "").split("/");
  parts.pop();
  return parts;
}

function resolveReference(fromPath, reference) {
  const stripped = String(reference || "").split("#")[0].split("?")[0];
  if (!stripped) return "";
  const parts = stripped.startsWith("/") ? [] : dirname(fromPath);
  for (const part of stripped.replace(/^\/+/, "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dependencyStatus(reference, kind, fromPath, exactPaths, foldedPaths) {
  const raw = decodeHtmlReference(reference);
  if (!raw) return null;
  if (raw.startsWith("#")) return { status: kind === "navigation" ? "navigation" : "embedded", resolvedPath: "", critical: 0 };
  if (/^data:/i.test(raw)) return { status: "embedded", resolvedPath: "", critical: 0 };
  if (/^blob:/i.test(raw)) return { status: "unverifiable", resolvedPath: "", critical: 0 };
  if (/^(?:https?:)?\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return { status: kind === "navigation" ? "navigation" : "external-blocked", resolvedPath: "", critical: 0 };
  }
  if (kind === "navigation" && (raw.startsWith("#") || raw.startsWith("?"))) return { status: "navigation", resolvedPath: "", critical: 0 };
  const resolved = resolveReference(fromPath, raw);
  if (!resolved) return { status: kind === "navigation" ? "navigation" : "missing", resolvedPath: "", critical: kind === "navigation" ? 0 : 1 };
  if (kind === "navigation") {
    const actual = exactPaths.has(resolved) ? resolved : foldedPaths.get(resolved.toLowerCase()) || resolved;
    return { status: "navigation", resolvedPath: actual, critical: 0 };
  }
  if (BLOCKED_EXTENSIONS.has(extension(resolved))) return { status: "missing", resolvedPath: resolved, critical: 1 };
  if (exactPaths.has(resolved)) return { status: "resolved", resolvedPath: resolved, critical: 0 };
  const folded = foldedPaths.get(resolved.toLowerCase());
  if (folded) return { status: "case-mismatch", resolvedPath: folded, critical: 1 };
  return { status: "missing", resolvedPath: resolved, critical: 1 };
}

function extractCssReferences(source) {
  const references = [];
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi)) references.push({ reference: match[1], kind: "stylesheet" });
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) references.push({ reference: match[2], kind: "asset" });
  return references;
}

function extractSrcset(value) {
  const raw = decodeHtmlReference(value);
  if (!raw) return [];
  if (/^data:/i.test(raw)) return [raw];
  return raw.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}

function parseHtmlAttributes(source) {
  const attributes = [], attrs = new Map();
  let index = 0;
  while (index < source.length) {
    while (index < source.length && (/[\s/]/.test(source[index]))) index += 1;
    if (index >= source.length) break;
    const nameStart = index;
    while (index < source.length && !/[\s=<>`"']/.test(source[index])) index += 1;
    if (index === nameStart) { index += 1; continue; }
    const name = source.slice(nameStart, index).toLowerCase();
    while (index < source.length && /\s/.test(source[index])) index += 1;
    let value = "";
    if (source[index] === "=") {
      index += 1;
      while (index < source.length && /\s/.test(source[index])) index += 1;
      const quote = source[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (source[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/[\s<>`"']/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    attributes.push([name, value]);
    if (!attrs.has(name)) attrs.set(name, value);
  }
  return { attributes, attrs };
}

function nextHtmlStartTag(source, fromIndex) {
  let search = fromIndex;
  while (search < source.length) {
    const start = source.indexOf("<", search);
    if (start < 0) return null;
    if (source.startsWith("<!--", start)) {
      const commentEnd = source.indexOf("-->", start + 4);
      search = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    let index = start + 1;
    if (!/[A-Za-z]/.test(source[index] || "")) { search = start + 1; continue; }
    const nameStart = index;
    while (index < source.length && /[A-Za-z0-9:-]/.test(source[index])) index += 1;
    const tag = source.slice(nameStart, index).toLowerCase();
    const attributesStart = index;
    let quote = "";
    while (index < source.length) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === "\"" || character === "'") quote = character;
      else if (character === ">") {
        const parsed = parseHtmlAttributes(source.slice(attributesStart, index));
        return { start, end: index + 1, tag, ...parsed };
      }
      index += 1;
    }
    const parsed = parseHtmlAttributes(source.slice(attributesStart));
    return { start, end: source.length, tag, ...parsed };
  }
  return null;
}

function extractHtmlReferences(source) {
  const references = [], lowerSource = source.toLowerCase();
  let cursor = 0;
  while (cursor < source.length) {
    const startTag = nextHtmlStartTag(source, cursor);
    if (!startTag) break;
    const { tag, attrs, attributes } = startTag;
    const add = (name, kind) => { if (attrs.has(name)) references.push({ reference: attrs.get(name), kind }); };
    if (["a", "area"].includes(tag)) add("href", "navigation");
    else if (tag === "link") {
      const rel = String(attrs.get("rel") || "").toLowerCase();
      if (rel.includes("stylesheet")) add("href", "stylesheet");
      else if (!/(?:^|\s)(?:preconnect|dns-prefetch)(?:\s|$)/.test(rel)) add("href", "asset");
    }
    else if (tag === "script") add("src", "script");
    else if (tag === "img") { add("src", "image"); for (const reference of extractSrcset(attrs.get("srcset"))) references.push({ reference, kind: "image" }); }
    else if (tag === "source") { add("src", "media"); for (const reference of extractSrcset(attrs.get("srcset"))) references.push({ reference, kind: "media" }); }
    else if (tag === "video") { add("src", "video"); add("poster", "image"); }
    else if (tag === "audio") add("src", "audio");
    else if (tag === "track") add("src", "asset");
    else if (tag === "input") add("src", "image");
    else if (["iframe", "embed"].includes(tag)) add("src", "frame");
    else if (tag === "object") add("data", "frame");
    else if (tag === "form") add("action", "navigation");
    else if (tag === "base") add("href", "base");
    if (attrs.has("style")) references.push(...extractCssReferences(attrs.get("style")));
    for (const [name, value] of attributes) {
      if (/^on/i.test(name) && value) references.push(...extractJavaScriptReferences(decodeHtmlReference(value)));
    }
    if (["script", "style", "textarea", "title"].includes(tag)) {
      const closingStart = lowerSource.indexOf(`</${tag}`, startTag.end);
      const contentEnd = closingStart < 0 ? source.length : closingStart;
      const content = source.slice(startTag.end, contentEnd);
      if (tag === "script") references.push(...extractJavaScriptReferences(content));
      else if (tag === "style") references.push(...extractCssReferences(content));
      if (closingStart < 0) break;
      const closingEnd = source.indexOf(">", closingStart + tag.length + 2);
      cursor = closingEnd < 0 ? source.length : closingEnd + 1;
    } else cursor = startTag.end;
  }
  return references;
}

function hasStaticLeadingStringArgument(value, allowTrailingArguments = false) {
  const source = String(value || "").trim();
  const quote = source[0];
  if (quote !== "\"" && quote !== "'") return false;
  let escaped = false;
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character !== quote) continue;
    const remainder = source.slice(index + 1).trim();
    return !remainder || (allowTrailingArguments && remainder.startsWith(","));
  }
  return false;
}

function boundedJavaScriptInspectionSource(value) {
  const source = String(value || "");
  if (source.length <= JAVASCRIPT_FULL_SCAN_MAX_CHARS) return { source, truncated: false };
  return {
    source: `${source.slice(0, JAVASCRIPT_EDGE_SCAN_CHARS)}\n/* archive static analysis omitted the middle of this large script */\n${source.slice(-JAVASCRIPT_EDGE_SCAN_CHARS)}`,
    truncated: true,
  };
}

function extractJavaScriptReferences(value) {
  const inspection = boundedJavaScriptInspectionSource(value), source = inspection.source;
  const references = [];
  for (const match of source.matchAll(/["'](data:[^"']+)["']/gi)) references.push({ reference: match[1], kind: "embedded" });
  for (const match of source.matchAll(/\b(?:url|href)\s*:\s*["']([^"']+)["']/gi)) references.push({ reference: match[1], kind: "navigation" });
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) references.push({ reference: match[1], kind: "script" });
  for (const match of source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) references.push({ reference: match[1], kind: "script" });
  for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g)) references.push({ reference: match[1], kind: "asset" });
  for (const match of source.matchAll(/\bfetch\(\s*["']([^"']+)["']/g)) references.push({ reference: match[1], kind: "asset" });
  for (const match of source.matchAll(/\bfetch\s*\(([^)]*)\)/g)) {
    if (!hasStaticLeadingStringArgument(match[1], true)) references.push({ reference: "dynamic-fetch(...)", kind: "dynamic" });
  }
  for (const match of source.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
    if (!hasStaticLeadingStringArgument(match[1])) references.push({ reference: "dynamic-import(...)", kind: "dynamic" });
  }
  for (const match of source.matchAll(/\bnew\s+URL\s*\(([^)]*)\)/g)) {
    if (!hasStaticLeadingStringArgument(match[1], true)) references.push({ reference: "dynamic-url(...)", kind: "dynamic" });
  }
  const dynamic = [
    ["xhr", /\bXMLHttpRequest\b/], ["websocket", /\bWebSocket\s*\(/], ["event-source", /\bEventSource\s*\(/],
    ["send-beacon", /\bsendBeacon\s*\(/], ["worker", /\b(?:Shared)?Worker\s*\(/],
  ];
  for (const [reference, pattern] of dynamic) if (pattern.test(source)) references.push({ reference: `${reference}(...)`, kind: "dynamic" });
  if (!inspection.truncated) {
    for (const finding of unrewritableJavaScriptNavigationFindings(source)) {
      references.push({ reference: `unrewritable-script-navigation:${finding}`, kind: "dynamic", critical: 1 });
    }
  }
  if (inspection.truncated) {
    references.push({ reference: "large-script-static-analysis(...)", kind: "dynamic", critical: 1 });
  }
  return references;
}

function credentialFindings(path, source) {
  const findings = [];
  for (const [rule, pattern] of CREDENTIAL_RULES) if (pattern.test(source)) findings.push({ path, rule });
  return findings;
}

const DEFAULT_VIEWER_ORIGIN = "https://archive-viewer.thesixwellconstruct.com";

export function archiveViewerOrigin(value = "") {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  if (!candidate) return DEFAULT_VIEWER_ORIGIN;
  try {
    const parsed = new URL(candidate);
    if (parsed.origin !== candidate || parsed.username || parsed.password || parsed.search || parsed.hash) return DEFAULT_VIEWER_ORIGIN;
    if (parsed.protocol === "https:" && parsed.hostname === "archive-viewer.thesixwellconstruct.com") return candidate;
    if (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return candidate;
  } catch { /* Fall through to the production origin. */ }
  return DEFAULT_VIEWER_ORIGIN;
}

function snapshotViewerUrl(snapshotId, entryPath, token = "", viewerOrigin = DEFAULT_VIEWER_ORIGIN) {
  const encodedPath = String(entryPath || "index.html").split("/").map(encodeURIComponent).join("/");
  const origin = archiveViewerOrigin(viewerOrigin);
  return token
    ? `${origin}/p/${encodeURIComponent(token)}/s/${encodeURIComponent(snapshotId)}/${encodedPath}`
    : `${origin}/s/${encodeURIComponent(snapshotId)}/${encodedPath}`;
}

function captureViewerUrl(snapshotId, captureId, token = "", viewerOrigin = DEFAULT_VIEWER_ORIGIN) {
  const origin = archiveViewerOrigin(viewerOrigin);
  const base = token
    ? `${origin}/p/${encodeURIComponent(token)}/s/${encodeURIComponent(snapshotId)}`
    : `${origin}/s/${encodeURIComponent(snapshotId)}`;
  return `${base}/__archive_capture__/${encodeURIComponent(captureId)}`;
}

async function previewCapability(secret, snapshotId) {
  if (!secret || !SNAPSHOT_ID_PATTERN.test(snapshotId)) throw new Error("Archive viewer preview signing is unavailable for this snapshot.");
  const expires = Math.floor(Date.now() / 1000) + 10 * 60, message = `v1\n${snapshotId}\n${expires}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return { token: `v1.${expires}.${base64Url(signature)}`, expires };
}

function dependencySummary(value) {
  const parsed = safeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function presentSnapshot(row, { admin = false, viewerOrigin = DEFAULT_VIEWER_ORIGIN } = {}) {
  if (!row) return null;
  const record = {
    id: row.id,
    title: row.title || "",
    dossier_entity_id: row.dossier_entity_id,
    dossierEntityId: row.dossier_entity_id,
    material_id: row.material_id || null,
    materialId: row.material_id || null,
    state_id: row.state_id || null,
    stateId: row.state_id || null,
    source_kind: row.source_kind,
    sourceKind: row.source_kind,
    lineage_role: row.lineage_role,
    lineageRole: row.lineage_role,
    entry_path: row.entry_path,
    entryPath: row.entry_path,
    git_commit_sha: row.git_commit_sha || "",
    gitCommitSha: row.git_commit_sha || "",
    git_commit_date: row.git_commit_date || null,
    gitCommitDate: row.git_commit_date || null,
    git_author: row.git_author || "",
    gitAuthor: row.git_author || "",
    git_message: row.git_message || "",
    gitMessage: row.git_message || "",
    scan_status: row.scan_status,
    scanStatus: row.scan_status,
    viewer_approved: Number(row.viewer_approved) === 1,
    viewerApproved: Number(row.viewer_approved) === 1,
    publication_state: row.publication_state,
    publicationState: row.publication_state,
    public_visible: Number(row.public_visible) === 1,
    publicVisible: Number(row.public_visible) === 1,
    tree_hash: row.tree_sha256 || "",
    treeHash: row.tree_sha256 || "",
    tree_sha256: row.tree_sha256 || "",
    tree_hash_algorithm: TREE_HASH_ALGORITHM,
    treeHashAlgorithm: TREE_HASH_ALGORITHM,
    file_count: Number(row.file_count || 0),
    fileCount: Number(row.file_count || 0),
    total_bytes: Number(row.total_bytes || 0),
    totalBytes: Number(row.total_bytes || 0),
    dependency_summary: dependencySummary(row.dependency_summary_json),
    dependencySummary: dependencySummary(row.dependency_summary_json),
    screenshot_url: row.screenshot_url || "",
    screenshotUrl: row.screenshot_url || "",
    viewer_url: snapshotViewerUrl(row.id, row.entry_path, "", viewerOrigin),
    viewerUrl: snapshotViewerUrl(row.id, row.entry_path, "", viewerOrigin),
    version_number: row.version_number ? Number(row.version_number) : null,
    versionNumber: row.version_number ? Number(row.version_number) : null,
    version_title: row.version_title || "",
    versionTitle: row.version_title || "",
    state_roman: row.state_roman || "",
    stateRoman: row.state_roman || "",
    state_title: row.state_title || "",
    stateTitle: row.state_title || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (admin) {
    record.git_parent_sha = row.git_parent_sha || "";
    record.gitParentSha = row.git_parent_sha || "";
    record.credential_findings = safeJson(row.credential_findings_json, []);
    record.credentialFindings = record.credential_findings;
    record.sort_order = Number(row.sort_order || 0);
    record.reviewed_by = row.reviewed_by || "";
    record.reviewed_at = row.reviewed_at || null;
    record.expected_tree_sha256 = row.expected_tree_sha256 || "";
    record.expectedTreeSha256 = row.expected_tree_sha256 || "";
    record.source_revision = Number(row.source_revision || 0);
    record.sourceRevision = Number(row.source_revision || 0);
    record.scan_revision = Number(row.scan_revision ?? -1);
    record.scanRevision = Number(row.scan_revision ?? -1);
    record.mutation_kind = row.mutation_kind || "";
    record.mutationKind = row.mutation_kind || "";
  }
  return record;
}

function presentBehavior(row) {
  if (!row) return null;
  return {
    id: row.id,
    snapshot_id: row.snapshot_id,
    snapshotId: row.snapshot_id,
    behavior_key: row.behavior_key,
    behaviorKey: row.behavior_key,
    title: row.title || "",
    evolution_role: row.evolution_role,
    evolutionRole: row.evolution_role,
    interaction_prompt: row.interaction_prompt || "",
    interactionPrompt: row.interaction_prompt || "",
    observed_behavior: row.observed_behavior || "",
    observedBehavior: row.observed_behavior || "",
    authored_meaning: row.authored_meaning || "",
    authoredMeaning: row.authored_meaning || "",
    meaning_status: row.meaning_status,
    meaningStatus: row.meaning_status,
    source_path: row.source_path || "",
    sourcePath: row.source_path || "",
    source_symbol: row.source_symbol || "",
    sourceSymbol: row.source_symbol || "",
    public_visible: Number(row.public_visible) === 1,
    publicVisible: Number(row.public_visible) === 1,
    sort_order: Number(row.sort_order || 0),
    sortOrder: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function snapshotAdminSql(where = "1=1") {
  return `SELECT snapshot.*,version.version_number,version.title version_title,
    state.state_roman,state.title state_title
    FROM archive_web_snapshots snapshot
    LEFT JOIN archive_object_states state ON state.id=snapshot.state_id
    LEFT JOIN archive_object_versions version ON version.id=state.version_id
    WHERE ${where}`;
}

export const ARCHIVE_WEB_SNAPSHOT_PUBLIC_GATE_SQL = `
  snapshot.publication_state='published' AND snapshot.public_visible=1
  AND snapshot.scan_status='ready' AND snapshot.scan_revision=snapshot.source_revision
  AND snapshot.mutation_token='' AND snapshot.viewer_approved=1
  AND entity.visibility='public'
  AND dossier.state='published' AND dossier.public_visible=1
  AND owner.state='published'
  AND snapshot.material_id IS NOT NULL AND material.dossier_entity_id=snapshot.dossier_entity_id
  AND material.state='published' AND material.visibility='public'
  AND snapshot.state_id IS NOT NULL AND material.state_id=snapshot.state_id
  AND state.publication_state='published' AND state.public_visible=1
  AND version.entity_id=snapshot.dossier_entity_id
  AND version.publication_state='published' AND version.public_visible=1`;

export async function loadPublicArchiveWebSnapshots(database, entityId, viewerOrigin = DEFAULT_VIEWER_ORIGIN) {
  const rows = (await database.prepare(`SELECT snapshot.id,snapshot.title,snapshot.dossier_entity_id,snapshot.material_id,snapshot.state_id,
      snapshot.source_kind,snapshot.lineage_role,snapshot.entry_path,snapshot.git_commit_sha,snapshot.git_commit_date,
      snapshot.git_author,snapshot.git_message,snapshot.scan_status,snapshot.viewer_approved,snapshot.publication_state,
      snapshot.public_visible,snapshot.tree_sha256,snapshot.file_count,snapshot.total_bytes,snapshot.dependency_summary_json,
      snapshot.screenshot_url,snapshot.sort_order,snapshot.created_at,snapshot.updated_at,
      version.version_number,version.title version_title,state.state_roman,state.title state_title
    FROM archive_web_snapshots snapshot
    JOIN archive_dossiers dossier ON dossier.entity_id=snapshot.dossier_entity_id
    JOIN content_entities entity ON entity.id=dossier.entity_id
    JOIN archive_records owner ON owner.id=entity.id
    JOIN archive_materials material ON material.id=snapshot.material_id
    JOIN archive_object_states state ON state.id=snapshot.state_id
    JOIN archive_object_versions version ON version.id=state.version_id
    WHERE snapshot.dossier_entity_id=? AND ${ARCHIVE_WEB_SNAPSHOT_PUBLIC_GATE_SQL}
    ORDER BY version.sort_order,version.version_number,state.sort_order,state.state_order,snapshot.sort_order,snapshot.created_at`).bind(entityId).all()).results || [];
  if (!rows.length) return [];
  const snapshotIds = rows.map((row) => row.id);
  const behaviorRows = (await database.prepare(`SELECT * FROM archive_web_snapshot_behaviors
    WHERE public_visible=1 AND snapshot_id IN (${snapshotIds.map(() => "?").join(",")})
    ORDER BY snapshot_id,sort_order,behavior_key`).bind(...snapshotIds).all()).results || [];
  const behaviorMap = new Map(snapshotIds.map((snapshotId) => [snapshotId, []]));
  behaviorRows.forEach((row) => behaviorMap.get(row.snapshot_id)?.push(presentBehavior(row)));
  return rows.map((row) => ({
    ...presentSnapshot(row, { viewerOrigin }),
    behaviors: behaviorMap.get(row.id) || [],
    interaction_behaviors: behaviorMap.get(row.id) || [],
  }));
}

async function snapshotAdminRecord(database, snapshotId) {
  return database.prepare(snapshotAdminSql("snapshot.id=?")).bind(snapshotId).first();
}

async function snapshotEvidenceLocked(database, snapshotId) {
  return Boolean(await database.prepare(`SELECT id FROM archive_web_history_candidates
    WHERE snapshot_id=? AND (decision<>'pending' OR reviewed_by LIKE 'archive-web-%-claim-%') LIMIT 1`).bind(snapshotId).first());
}

async function claimSnapshotMutation(database, snapshotId, kind, candidateClaimToken = "") {
  if (!SNAPSHOT_MUTATION_KINDS.has(kind)) throw new Error("Choose a valid website snapshot mutation kind.");
  const token = id("archive-web-snapshot-mutation");
  const record = await database.prepare(`UPDATE archive_web_snapshots
    SET mutation_token=?,mutation_kind=?,mutation_started_at=datetime('now'),updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND publication_state='draft' AND viewer_approved=0
      AND (mutation_token='' OR mutation_started_at<datetime('now','-1 hour'))
      AND NOT EXISTS(
        SELECT 1 FROM archive_web_history_candidates candidate
        WHERE candidate.snapshot_id=archive_web_snapshots.id
          AND (candidate.decision<>'pending' OR (
            candidate.reviewed_by LIKE 'archive-web-%-claim-%' AND candidate.reviewed_by<>?
          ))
      )
    RETURNING *`).bind(token, kind, snapshotId, candidateClaimToken).first();
  return record ? { token, record } : null;
}

async function releaseSnapshotMutation(database, snapshotId, token) {
  if (!token) return;
  await database.prepare(`UPDATE archive_web_snapshots
    SET mutation_token='',mutation_kind='',mutation_started_at=NULL,updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND mutation_token=?`).bind(snapshotId, token).run();
}

async function failSnapshotFinalization(database, snapshotId, token, message) {
  const summary = { finalization_failed: true, error: text(message, 1000) || "Snapshot finalization did not complete." };
  await database.prepare(`UPDATE archive_web_snapshots
    SET scan_status='blocked',scan_revision=-1,viewer_approved=0,viewer_approved_at=NULL,
      dependency_summary_json=?,updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND mutation_token=?`).bind(JSON.stringify(summary), snapshotId, token).run();
}

async function snapshotAdminDetail(database, snapshotId, viewerOrigin = DEFAULT_VIEWER_ORIGIN) {
  const record = await snapshotAdminRecord(database, snapshotId);
  if (!record) return null;
  const [filesResult, dependenciesResult, candidatesResult, capturesResult, replacementsResult, behaviorsResult] = await database.batch([
    database.prepare(`SELECT id,snapshot_id,normalized_path,mime_type,byte_size,source_sha256,derivative_sha256,
      file_role,viewer_eligible,created_at,updated_at FROM archive_web_snapshot_files
      WHERE snapshot_id=? ORDER BY normalized_path`).bind(snapshotId),
    database.prepare(`SELECT id,snapshot_id,dependency_key,referring_path,original_reference,resolved_path,
      dependency_kind,status,critical,notes,created_at,updated_at FROM archive_web_snapshot_dependencies
      WHERE snapshot_id=? ORDER BY critical DESC,status,referring_path,original_reference`).bind(snapshotId),
    database.prepare("SELECT * FROM archive_web_history_candidates WHERE snapshot_id=? ORDER BY created_at,id").bind(snapshotId),
    database.prepare("SELECT * FROM archive_web_snapshot_captures WHERE snapshot_id=? ORDER BY CASE viewport WHEN 'desktop' THEN 0 ELSE 1 END,created_at").bind(snapshotId),
    database.prepare(`SELECT id,snapshot_id,dependency_key,local_path,mime_type,byte_size,sha256,derivative_role,created_by,created_at,updated_at
      FROM archive_web_snapshot_replacements WHERE snapshot_id=? ORDER BY local_path,id`).bind(snapshotId),
    database.prepare(`SELECT * FROM archive_web_snapshot_behaviors
      WHERE snapshot_id=? ORDER BY sort_order,behavior_key`).bind(snapshotId),
  ]);
  return {
    ...presentSnapshot(record, { admin: true, viewerOrigin }),
    files: (filesResult.results || []).map((file) => ({ ...file, viewer_eligible: Number(file.viewer_eligible) === 1 })),
    dependencies: (dependenciesResult.results || []).map((dependency) => ({ ...dependency, critical: Number(dependency.critical) === 1 })),
    candidates: (candidatesResult.results || []).map(presentCandidate),
    captures: (capturesResult.results || []).map((capture) => presentCapture(capture, { viewerOrigin })),
    capture_derivatives: (capturesResult.results || []).map((capture) => presentCapture(capture, { viewerOrigin })),
    replacements: (replacementsResult.results || []).map(presentReplacement),
    external_replacements: (replacementsResult.results || []).map(presentReplacement),
    behaviors: (behaviorsResult.results || []).map(presentBehavior),
    interaction_behaviors: (behaviorsResult.results || []).map(presentBehavior),
  };
}

async function snapshotBehaviorsApi(request, env, snapshotId) {
  if (request.method !== "PUT") return failure("Method not allowed.", 405);
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) return failure("Choose a valid website snapshot.", 409);
  const database = db(env);
  const snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot) return failure("Website snapshot not found.", 404);
  const payload = await readJson(request);
  const records = Array.isArray(payload?.records) ? payload.records : Array.isArray(payload?.behaviors) ? payload.behaviors : null;
  if (!records) return failure("Supply a behavior records array.", 409);
  const normalized = [];
  const keys = new Set();
  for (const [index, record] of records.entries()) {
    const behaviorKey = text(record?.behavior_key || record?.behaviorKey, 80);
    const evolutionRole = text(record?.evolution_role || record?.evolutionRole || "observed", 40);
    const meaningStatus = text(record?.meaning_status || record?.meaningStatus || "pending-interpretation", 40);
    if (!SNAPSHOT_BEHAVIOR_KEYS.has(behaviorKey)) return failure("Choose a supported archived interaction.", 409);
    if (keys.has(behaviorKey)) return failure("Each archived interaction can appear only once per snapshot.", 409);
    if (!SNAPSHOT_BEHAVIOR_EVOLUTION_ROLES.has(evolutionRole)) return failure("Choose a valid interaction evolution role.", 409);
    if (!SNAPSHOT_BEHAVIOR_MEANING_STATUSES.has(meaningStatus)) return failure("Choose a valid meaning source.", 409);
    keys.add(behaviorKey);
    normalized.push({
      behaviorKey,
      title: text(record?.title, 160),
      evolutionRole,
      interactionPrompt: text(record?.interaction_prompt || record?.interactionPrompt, 1200),
      observedBehavior: text(record?.observed_behavior || record?.observedBehavior, 6000),
      authoredMeaning: text(record?.authored_meaning || record?.authoredMeaning, 6000),
      meaningStatus,
      sourcePath: text(record?.source_path || record?.sourcePath, 1024),
      sourceSymbol: text(record?.source_symbol || record?.sourceSymbol, 1000),
      publicVisible: bool(record?.public_visible ?? record?.publicVisible),
      sortOrder: Number.isFinite(Number(record?.sort_order ?? record?.sortOrder)) ? Math.trunc(Number(record?.sort_order ?? record?.sortOrder)) : (index + 1) * 10,
    });
  }
  const existingRows = (await database.prepare("SELECT id,behavior_key FROM archive_web_snapshot_behaviors WHERE snapshot_id=?").bind(snapshotId).all()).results || [];
  const existingIds = new Map(existingRows.map((row) => [row.behavior_key, row.id]));
  await database.batch([
    database.prepare("DELETE FROM archive_web_snapshot_behaviors WHERE snapshot_id=?").bind(snapshotId),
    ...normalized.map((record) => database.prepare(`INSERT INTO archive_web_snapshot_behaviors
      (id,snapshot_id,behavior_key,title,evolution_role,interaction_prompt,observed_behavior,authored_meaning,
       meaning_status,source_path,source_symbol,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(
      existingIds.get(record.behaviorKey) || id("archive-web-snapshot-behavior"), snapshotId, record.behaviorKey, record.title,
      record.evolutionRole, record.interactionPrompt, record.observedBehavior, record.authoredMeaning, record.meaningStatus,
      record.sourcePath, record.sourceSymbol, record.publicVisible ? 1 : 0, record.sortOrder,
    )),
  ]);
  return json({ ok: true, record: await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN) });
}

function presentCapture(row, { viewerOrigin = DEFAULT_VIEWER_ORIGIN, token = "" } = {}) {
  if (!row) return null;
  const publicUrl = captureViewerUrl(row.snapshot_id, row.id, "", viewerOrigin);
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    candidateId: row.candidate_id,
    snapshot_id: row.snapshot_id,
    snapshotId: row.snapshot_id,
    viewport: row.viewport,
    mime_type: row.mime_type,
    mimeType: row.mime_type,
    byte_size: Number(row.byte_size || 0),
    byteSize: Number(row.byte_size || 0),
    sha256: row.sha256,
    derivative_role: row.derivative_role,
    derivativeRole: row.derivative_role,
    public_url: publicUrl,
    publicUrl,
    ...(token ? { preview_url: captureViewerUrl(row.snapshot_id, row.id, token, viewerOrigin), previewUrl: captureViewerUrl(row.snapshot_id, row.id, token, viewerOrigin) } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function presentReplacement(row) {
  if (!row) return null;
  return {
    id: row.id,
    snapshot_id: row.snapshot_id,
    snapshotId: row.snapshot_id,
    dependency_key: row.dependency_key,
    dependencyKey: row.dependency_key,
    local_path: row.local_path,
    localPath: row.local_path,
    mime_type: row.mime_type,
    mimeType: row.mime_type,
    byte_size: Number(row.byte_size || 0),
    byteSize: Number(row.byte_size || 0),
    sha256: row.sha256,
    derivative_role: row.derivative_role,
    derivativeRole: row.derivative_role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function presentCandidate(row, captures = []) {
  if (!row) return null;
  const captureRecords = Array.isArray(captures) ? captures : [];
  return {
    ...row,
    score: Number(row.score || 0),
    commit_group: safeJson(row.commit_group_json, []),
    commitGroup: safeJson(row.commit_group_json, []),
    reasons: safeJson(row.reasons_json, []),
    changed_paths: safeJson(row.changed_paths_json, []),
    changedPaths: safeJson(row.changed_paths_json, []),
    captures: captureRecords,
    capture_derivatives: captureRecords,
    captureDerivatives: captureRecords,
  };
}

async function presentCandidatesWithCaptures(database, rows, viewerOrigin = DEFAULT_VIEWER_ORIGIN) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => "?").join(",");
  const captureRows = (await database.prepare(`SELECT * FROM archive_web_snapshot_captures
    WHERE candidate_id IN (${placeholders}) ORDER BY candidate_id,CASE viewport WHEN 'desktop' THEN 0 ELSE 1 END,created_at`).bind(...rows.map((row) => row.id)).all()).results || [];
  const capturesByCandidate = new Map();
  for (const capture of captureRows) {
    if (!capturesByCandidate.has(capture.candidate_id)) capturesByCandidate.set(capture.candidate_id, []);
    capturesByCandidate.get(capture.candidate_id).push(presentCapture(capture, { viewerOrigin }));
  }
  return rows.map((row) => presentCandidate(row, capturesByCandidate.get(row.id) || []));
}

async function ensureWebsiteArchiveRecord(database) {
  const existing = await database.prepare(`SELECT records.*,dossier.archive_slug,catalogue.catalogue_id,catalogue.current_state_id
    FROM archive_records records
    JOIN archive_dossiers dossier ON dossier.entity_id=records.id
    JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=records.id
    WHERE dossier.archive_slug='the-six-well-construct-website'`).first();
  let record = existing, created = false;
  if (record && record.cultural_object_type_id !== "other-website") throw new Error("The website Archive slug already belongs to a different cultural-object type.");
  if (!record) {
    const objectType = await database.prepare("SELECT * FROM archive_cultural_object_types WHERE id='other-website'").first();
    if (!objectType) throw new Error("Run the Archive web snapshot migration before starting this record.");
    const recordId = id("archive-record"), versionId = id("archive-version"), stateId = id("archive-state");
    for (let attempt = 0; attempt < 3 && !record; attempt += 1) {
      const numberRow = await database.prepare("SELECT COALESCE(MAX(catalogue_number),0)+1 next_number FROM archive_catalogue_entries WHERE catalogue_prefix='OBJ'").first();
      const number = Number(numberRow?.next_number || 1), catalogueId = `OBJ-${String(number).padStart(3, "0")}`;
      try {
        await database.batch([
          database.prepare(`INSERT INTO content_entities
            (id,entity_type,node_id,visibility,search_visibility,internal_notes,created_by,updated_by,created_at,updated_at)
            VALUES(?,'archive_record','node-archive','internal',0,'Website inception Archive record.','studio','studio',datetime('now'),datetime('now'))`).bind(recordId),
          database.prepare(`INSERT INTO archive_records
            (id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,sort_order,
             cultural_object_type_id,medium_label,creator_entity_id,creator_label,date_precision,created_at,updated_at)
            VALUES(?,'the-six-well-construct-website','The Six.Well Construct Website','The Six.Well Construct','cultural-object','Archive',
             'April 15, 2026','2026','The evolving website and digital system of The Six.Well Construct.',
             'A record of the website from its inception through meaningful structural and creative directions.',
             'private cultural-object draft','draft',0,'other-website','HTML, CSS, JavaScript and digital system',NULL,'The Six.Well Construct','exact',datetime('now'),datetime('now'))`).bind(recordId),
          database.prepare(`INSERT INTO archive_dossiers
            (entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
            VALUES(?,'the-six-well-construct-website','Follow the website as an authored system rather than a sequence of disconnected files.',
             'This dossier preserves canonical directions, exploratory branches, source bundles, and their provenance.',
             'No reviewed public website snapshots are available yet.','cultural-object','draft',0,0,0,NULL,'studio','studio',datetime('now'),datetime('now'))`).bind(recordId),
          database.prepare(`INSERT INTO archive_catalogue_entries
            (entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at)
            VALUES(?,'other','other-website','OBJ',?,?,1,'I','',?,'studio','studio',datetime('now'),datetime('now'))`).bind(recordId, number, catalogueId, stateId),
          database.prepare(`INSERT INTO archive_object_versions
            (id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
            VALUES(?,?,1,'Original landing-page system','The first committed direction for the website.','2026-04-15T20:30:19-04:00','exact',
             'April 15, 2026 at 8:30 PM EDT',1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(versionId, recordId),
          database.prepare(`INSERT INTO archive_object_states
            (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
            VALUES(?,?,'I',1,'First committed landing page','The earliest meaningful committed index.html.','',
             '2026-04-15T20:30:19-04:00','exact','April 15, 2026 at 8:30 PM EDT',1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(stateId, versionId),
        ]);
        created = true;
      } catch (error) {
        const message = String(error?.message || error);
        if (/UNIQUE constraint failed.*(?:catalogue|OBJ)/i.test(message) && attempt < 2) continue;
        throw error;
      }
      record = await database.prepare(`SELECT records.*,dossier.archive_slug,catalogue.catalogue_id,catalogue.current_state_id
        FROM archive_records records JOIN archive_dossiers dossier ON dossier.entity_id=records.id
        JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=records.id WHERE records.id=?`).bind(recordId).first();
    }
  }
  if (!record) throw new Error("A unique website catalogue identity could not be allocated.");

  let thread = await database.prepare("SELECT * FROM archive_origin_threads WHERE slug='inception-of-the-six-well-construct-website'").first();
  if (!thread) {
    const threadId = id("origin-thread");
    await database.prepare(`INSERT INTO archive_origin_threads
      (id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,'inception-of-the-six-well-construct-website','Inception of The Six.Well Construct Website',
       'The notes, sketches, systems, and early files from which the website developed.','draft',0,0,'studio','studio',datetime('now'),datetime('now'))`).bind(threadId).run();
    thread = await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(threadId).first();
  }
  const existingPrimary = await database.prepare("SELECT thread_id FROM archive_origin_thread_entities WHERE entity_id=? AND is_primary=1").bind(record.id).first();
  await database.prepare(`INSERT OR IGNORE INTO archive_origin_thread_entities(thread_id,entity_id,is_primary,sort_order,created_at)
    VALUES(?,?,?,?,datetime('now'))`).bind(thread.id, record.id, existingPrimary && existingPrimary.thread_id !== thread.id ? 0 : 1, 1).run();

  const southWall = await database.prepare("SELECT id FROM archive_records WHERE slug='studio-blackboard-south-wall' AND record_type='blackboard'").first();
  let blackboardLinked = false;
  if (southWall) {
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO archive_origin_thread_entities(thread_id,entity_id,is_primary,sort_order,created_at)
        VALUES(?,?,0,2,datetime('now'))`).bind(thread.id, southWall.id),
      database.prepare(`INSERT OR IGNORE INTO entity_relationships
        (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
        VALUES(?,?,?,'rel-informed',0,
         'The original landing-page sketch is visible on this whole-board record. Retain this contextual relationship when a closer Blackboard fragment is added later.',
         0,'studio',datetime('now'),datetime('now'))`).bind(id("relationship"), southWall.id, record.id),
    ]);
    blackboardLinked = true;
  }
  const [dossier, catalogue, version, state] = await Promise.all([
    database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(record.id).first(),
    database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(record.id).first(),
    database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=? AND version_number=1").bind(record.id).first(),
    database.prepare(`SELECT state.* FROM archive_object_states state JOIN archive_object_versions version ON version.id=state.version_id
      WHERE version.entity_id=? AND version.version_number=1 AND state.state_order=1`).bind(record.id).first(),
  ]);
  return { created, record, dossier, catalogue, version, state, origin_thread: thread, blackboard_linked: blackboardLinked };
}

async function startWebsiteArchive(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  try {
    const result = await ensureWebsiteArchiveRecord(db(env));
    return json({ ...result, website_record: result.record, websiteRecord: result.record, snapshot: null }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = String(error?.message || error);
    return failure(message, /different cultural-object type/i.test(message) ? 409 : 400);
  }
}

async function createSnapshot(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env), dossierEntityId = text(body.dossier_entity_id ?? body.entity_id ?? body.entityId, 200);
  const sourceKind = text(body.source_kind ?? body.sourceKind, 30) || "upload", lineageRole = text(body.lineage_role ?? body.lineageRole, 40) || "canonical-state";
  let entryPath;
  try { entryPath = normalizeArchiveWebPath(body.entry_path ?? body.entryPath ?? "index.html"); } catch (error) { return failure(error.message, 409); }
  if (!dossierEntityId) return failure("Choose an Archive dossier.", 409);
  if (!SOURCE_KINDS.has(sourceKind) || !LINEAGE_ROLES.has(lineageRole)) return failure("Choose valid source and lineage roles.", 409);
  const dossier = await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(dossierEntityId).first();
  if (!dossier) return failure("Archive dossier not found.", 404);
  const stateId = text(body.state_id ?? body.stateId, 200) || null;
  if (stateId) {
    const state = await database.prepare(`SELECT state.id FROM archive_object_states state JOIN archive_object_versions version ON version.id=state.version_id
      WHERE state.id=? AND version.entity_id=?`).bind(stateId, dossierEntityId).first();
    if (!state) return failure("Choose a State from this Archive dossier.", 409);
  }
  const expectedTreeHash = text(body.expected_tree_sha256 ?? body.expectedTreeSha256 ?? body.tree_sha256 ?? body.treeHash, 64).toLowerCase();
  if (expectedTreeHash && !/^[a-f0-9]{64}$/.test(expectedTreeHash)) return failure("Expected tree SHA-256 must contain exactly 64 hexadecimal characters.", 409);
  const snapshotId = text(body.id, 200) || id("archive-web-snapshot");
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) return failure("Use a snapshot ID containing only letters, numbers, underscores, or hyphens.", 409);
  try {
    await database.prepare(`INSERT INTO archive_web_snapshots
      (id,dossier_entity_id,state_id,title,source_kind,lineage_role,entry_path,git_commit_sha,git_parent_sha,git_commit_date,
       git_author,git_message,expected_tree_sha256,scan_status,viewer_approved,publication_state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',0,'draft',0,?,'studio','studio',datetime('now'),datetime('now'))`).bind(
      snapshotId, dossierEntityId, stateId, text(body.title, 300) || "Untitled website snapshot", sourceKind, lineageRole, entryPath,
      text(body.git_commit_sha ?? body.gitCommitSha, 100), text(body.git_parent_sha ?? body.gitParentSha, 100), text(body.git_commit_date ?? body.gitCommitDate ?? body.git_commit_at, 80) || null,
      text(body.git_author ?? body.gitAuthor, 300), text(body.git_message ?? body.gitMessage, 3000), expectedTreeHash, Number(body.sort_order ?? body.sortOrder) || 0,
    ).run();
  } catch (error) {
    return failure(/UNIQUE constraint failed/i.test(String(error?.message || error)) ? "That snapshot ID already exists." : String(error?.message || error), 409);
  }
  const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
  return json({ record, snapshot: record }, { status: 201 });
}

function hexDigest(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function countedStream(stream, maximumBytes, counter) {
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const size = chunk?.byteLength ?? chunk?.length ?? 0;
      counter.value += Number(size || 0);
      if (counter.value > maximumBytes) throw new Error("File exceeds the allowed size.");
      controller.enqueue(chunk);
    },
  }));
}

async function digestOnly(stream, maximumBytes) {
  const counter = { value: 0 }, source = countedStream(stream, maximumBytes, counter);
  if (typeof crypto.DigestStream === "function") {
    const digestStream = new crypto.DigestStream("SHA-256");
    await source.pipeTo(digestStream);
    return { hash: hexDigest(await digestStream.digest), byteSize: counter.value };
  }
  const bytes = await new Response(source).arrayBuffer();
  return { hash: await sha256(bytes), byteSize: counter.value };
}

async function storeSnapshotFile(bucket, stream, { sourceKey, viewerKey, mime, maximumBytes }) {
  const counter = { value: 0 }, counted = countedStream(stream, maximumBytes, counter);
  // R2 requires a known-length stream. Transforming and teeing a request body
  // removes that property, so keep the single-file V1 limit as the memory bound
  // and write identical bytes to the private source and viewer derivative.
  const bytes = await new Response(counted).arrayBuffer();
  await bucket.put(sourceKey, bytes, { httpMetadata: { contentType: mime } });
  if (viewerKey) await bucket.put(viewerKey, bytes, { httpMetadata: { contentType: mime } });
  return { hash: await sha256(bytes), byteSize: counter.value };
}

async function uploadSnapshotFile(request, env, snapshotId, rawPath = "") {
  const database = db(env), snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot) return failure("Website snapshot not found.", 404);
  if (snapshot.publication_state !== "draft" || Number(snapshot.viewer_approved)) return failure("Return this snapshot to an unapproved draft before adding files.", 409);
  if (await snapshotEvidenceLocked(database, snapshotId)) return failure("Reviewed history evidence is immutable; create a restoration snapshot instead of changing this source bundle.", 409);
  if (snapshot.material_id) {
    const material = await database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").bind(snapshot.material_id).first();
    if (material && (material.state !== "draft" || material.visibility !== "internal")) {
      return failure("Return the linked Archive Material to an internal draft before changing this source bundle.", 409);
    }
  }
  if (!env.SUBMISSION_FILES) return failure("Archive snapshot storage is unavailable.", 503);

  let suppliedPath = rawPath, suppliedMime = request.headers.get("content-type") || "application/octet-stream", sizeHint = null, stream = request.body;
  if (!rawPath) {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > ARCHIVE_WEB_SNAPSHOT_LIMITS.mediaBytes + 1024 * 1024) return failure("File exceeds the allowed size.", 413);
    let form;
    try { form = await request.formData(); } catch { return failure("Send multipart form data with file and path fields."); }
    const file = form.get("file");
    if (!file || typeof file.stream !== "function") return failure("Choose a file to upload.");
    suppliedPath = text(form.get("path"), 1200) || file.webkitRelativePath || file.name;
    suppliedMime = file.type || suppliedMime;
    sizeHint = Number(file.size || 0);
    stream = file.stream();
  }
  if (!stream) stream = new Blob([]).stream();
  let normalizedPath, classification;
  try {
    normalizedPath = normalizeArchiveWebPath(suppliedPath);
    classification = classifyFile(normalizedPath, suppliedMime);
  } catch (error) { return failure(error.message, 415); }
  const claim = await claimSnapshotMutation(database, snapshotId, "upload");
  if (!claim) return failure("This source bundle is being scanned or reviewed, or its evidence is already immutable.", 409);
  try {
    const totals = await database.prepare(`SELECT COUNT(*) file_count,COALESCE(SUM(byte_size),0) total_bytes
      FROM archive_web_snapshot_files WHERE snapshot_id=?`).bind(snapshotId).first();
    const existing = await database.prepare("SELECT * FROM archive_web_snapshot_files WHERE snapshot_id=? AND path_folded=?").bind(snapshotId, normalizedPath.toLowerCase()).first();
    const maximumBytes = Math.min(classification.maximumBytes, ARCHIVE_WEB_SNAPSHOT_LIMITS.totalBytes - Number(totals?.total_bytes || 0));
    if (!existing && Number(totals?.file_count || 0) >= ARCHIVE_WEB_SNAPSHOT_LIMITS.files) return failure("A snapshot can contain at most 500 files.", 413);
    if (maximumBytes < 0 || (sizeHint !== null && sizeHint > maximumBytes)) return failure("File or snapshot exceeds the allowed size.", 413);
    if (existing) {
      if (existing.normalized_path !== normalizedPath) return failure(`The path ${normalizedPath} collides by letter case with immutable source path ${existing.normalized_path}.`, 409);
      try {
        const digest = await digestOnly(stream, Math.min(classification.maximumBytes, ARCHIVE_WEB_SNAPSHOT_LIMITS.totalBytes));
        if (digest.hash !== existing.source_sha256 || digest.byteSize !== Number(existing.byte_size)) return failure("That path already contains a different immutable source file.", 409);
        return json({ record: await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN), file: { ...existing, viewer_eligible: Number(existing.viewer_eligible) === 1 }, unchanged: true });
      } catch (error) { return failure(error.message, /allowed size/i.test(error.message) ? 413 : 400); }
    }

    const invalidated = await database.prepare(`UPDATE archive_web_snapshots
      SET scan_status='draft',scan_revision=-1,viewer_approved=0,viewer_approved_at=NULL,
        dependency_summary_json='{}',credential_findings_json='[]',updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND mutation_token=? AND source_revision=? RETURNING id`).bind(
      snapshotId, claim.token, Number(claim.record.source_revision || 0),
    ).first();
    if (!invalidated) return failure("The source bundle changed before this upload could begin.", 409);
    const fileId = id("archive-web-file"), sourceKey = `archive/web-snapshots/${snapshotId}/source/${fileId}`;
    const viewerKey = classification.viewerEligible ? `archive/web-snapshots/${snapshotId}/viewer/${fileId}` : "";
    try {
      const stored = await storeSnapshotFile(env.SUBMISSION_FILES, stream, { sourceKey, viewerKey, mime: classification.mime, maximumBytes });
      const results = await database.batch([
        database.prepare(`INSERT INTO archive_web_snapshot_files
          (id,snapshot_id,normalized_path,path_folded,source_storage_key,viewer_storage_key,mime_type,byte_size,source_sha256,derivative_sha256,
           file_role,viewer_eligible,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now')
          WHERE EXISTS(SELECT 1 FROM archive_web_snapshots
            WHERE id=? AND mutation_token=? AND source_revision=?)`).bind(
          fileId, snapshotId, normalizedPath, normalizedPath.toLowerCase(), sourceKey, viewerKey, classification.mime, stored.byteSize, stored.hash,
          viewerKey ? stored.hash : "", normalizedPath === claim.record.entry_path ? "entry-html" : classification.role, classification.viewerEligible ? 1 : 0,
          snapshotId, claim.token, Number(claim.record.source_revision || 0),
        ),
        database.prepare(`UPDATE archive_web_snapshots SET source_revision=source_revision+1,scan_revision=-1,
          scan_status='draft',viewer_approved=0,viewer_approved_at=NULL,tree_sha256='',file_count=0,total_bytes=0,
          dependency_summary_json='{}',credential_findings_json='[]',mutation_token='',mutation_kind='',mutation_started_at=NULL,
          updated_by='studio',updated_at=datetime('now')
          WHERE id=? AND mutation_token=? AND source_revision=?`).bind(snapshotId, claim.token, Number(claim.record.source_revision || 0)),
        database.prepare(`UPDATE archive_web_snapshots SET updated_by=CASE
            WHEN source_revision=? AND mutation_token='' AND EXISTS(
              SELECT 1 FROM archive_web_snapshot_files file WHERE file.id=? AND file.snapshot_id=archive_web_snapshots.id
            ) THEN updated_by ELSE NULL END
          WHERE id=?`).bind(Number(claim.record.source_revision || 0) + 1, fileId, snapshotId),
      ]);
      if (results.some((result) => Number(result?.meta?.changes || 0) !== 1)) {
        await Promise.allSettled([env.SUBMISSION_FILES.delete(sourceKey), viewerKey ? env.SUBMISSION_FILES.delete(viewerKey) : Promise.resolve()]);
        return failure("The source bundle changed while this file was being stored; retry the upload.", 409);
      }
    } catch (error) {
      await Promise.allSettled([env.SUBMISSION_FILES.delete(sourceKey), viewerKey ? env.SUBMISSION_FILES.delete(viewerKey) : Promise.resolve()]);
      const message = String(error?.message || error);
      return failure(/allowed size/i.test(message) ? message : "The source file could not be stored.", /allowed size/i.test(message) ? 413 : 502);
    }
    const file = await database.prepare(`SELECT id,snapshot_id,normalized_path,mime_type,byte_size,source_sha256,derivative_sha256,
      file_role,viewer_eligible,created_at,updated_at FROM archive_web_snapshot_files WHERE id=?`).bind(fileId).first();
    return json({ record: await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN), file: { ...file, viewer_eligible: Number(file.viewer_eligible) === 1 } }, { status: 201 });
  } finally {
    await releaseSnapshotMutation(database, snapshotId, claim.token);
  }
}

async function objectText(bucket, key) {
  const object = await bucket.get(key);
  if (!object) throw new Error("A private source object is missing from storage.");
  if (typeof object.text === "function") return object.text();
  if (object.body) return new Response(object.body).text();
  throw new Error("A private source object could not be read.");
}

async function nextSnapshotMaterialReference(database, stateId) {
  const row = await database.prepare(`SELECT COALESCE(MAX(CAST(substr(material_reference,2) AS INTEGER)),0)+1 next_number
    FROM archive_materials WHERE state_id=? AND material_reference GLOB 'D[0-9]*'`).bind(stateId).first();
  return `D${String(Number(row?.next_number || 1)).padStart(2, "0")}`;
}

async function ensureSnapshotMaterial(database, snapshotId, mutationToken = "") {
  const snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot?.state_id || snapshot.scan_status !== "ready"
    || Number(snapshot.scan_revision) !== Number(snapshot.source_revision)
    || String(snapshot.mutation_token || "") !== mutationToken) return snapshot;
  const body = `Interactive historical website source snapshot.${snapshot.git_commit_sha ? ` Git commit: ${snapshot.git_commit_sha}.` : ""}${snapshot.tree_sha256 ? ` Source tree SHA-256: ${snapshot.tree_sha256}.` : ""}`;
  if (snapshot.material_id) {
    await database.prepare(`UPDATE archive_materials SET title=?,body=?,occurred_at=?,date_precision=?,date_label=?,updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND dossier_entity_id=? AND state_id=? AND state='draft' AND visibility='internal'
        AND EXISTS(SELECT 1 FROM archive_web_snapshots owner
          WHERE owner.id=? AND owner.material_id=archive_materials.id AND owner.scan_status='ready'
            AND owner.scan_revision=owner.source_revision AND owner.source_revision=? AND owner.mutation_token=?)`).bind(
      snapshot.title, body, snapshot.git_commit_date || null, snapshot.git_commit_date ? "exact" : "undated",
      snapshot.git_commit_date ? snapshot.git_commit_date : "", snapshot.material_id, snapshot.dossier_entity_id, snapshot.state_id,
      snapshotId, Number(snapshot.source_revision || 0), mutationToken,
    ).run();
    return snapshotAdminRecord(database, snapshotId);
  }
  const state = await database.prepare(`SELECT state.id,version.entity_id FROM archive_object_states state
    JOIN archive_object_versions version ON version.id=state.version_id WHERE state.id=? AND version.entity_id=?`).bind(snapshot.state_id, snapshot.dossier_entity_id).first();
  if (!state) throw new Error("The selected Archive State no longer belongs to this dossier.");
  const materialId = id("archive-material"), reference = await nextSnapshotMaterialReference(database, snapshot.state_id);
  const thread = await database.prepare(`SELECT thread_id FROM archive_origin_thread_entities
    WHERE entity_id=? ORDER BY is_primary DESC,sort_order,thread_id LIMIT 1`).bind(snapshot.dossier_entity_id).first();
  const statements = [
    database.prepare(`INSERT INTO archive_materials
      (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,
       visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,NULL,'process','document',?,'',?,'website-development',?,NULL,?,?,
       'internal','draft',0,?,?,0,'studio','studio',datetime('now'),datetime('now'))`).bind(
      materialId, snapshot.dossier_entity_id, snapshot.title, body, snapshot.git_commit_date || null,
      snapshot.git_commit_date ? "exact" : "undated", snapshot.git_commit_date ? snapshot.git_commit_date : "", snapshot.state_id, reference,
    ),
    database.prepare(`UPDATE archive_web_snapshots SET material_id=?,updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND material_id IS NULL AND scan_status='ready' AND scan_revision=source_revision
        AND source_revision=? AND mutation_token=?`).bind(materialId, snapshotId, Number(snapshot.source_revision || 0), mutationToken),
  ];
  if (thread) statements.push(database.prepare(`INSERT OR IGNORE INTO archive_origin_thread_materials(thread_id,material_id,sort_order,created_at)
    VALUES(?,?,0,datetime('now'))`).bind(thread.thread_id, materialId));
  statements.push(database.prepare(`UPDATE archive_materials SET updated_by=CASE WHEN EXISTS(
      SELECT 1 FROM archive_web_snapshots owner
      WHERE owner.id=? AND owner.material_id=archive_materials.id AND owner.scan_status='ready'
        AND owner.scan_revision=owner.source_revision AND owner.source_revision=? AND owner.mutation_token=?
    ) THEN updated_by ELSE NULL END WHERE id=?`).bind(
    snapshotId, Number(snapshot.source_revision || 0), mutationToken, materialId,
  ));
  await database.batch(statements);
  return snapshotAdminRecord(database, snapshotId);
}

async function finalizeSnapshot(request, env, snapshotId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env), existingSnapshot = await snapshotAdminRecord(database, snapshotId);
  if (!existingSnapshot) return failure("Website snapshot not found.", 404);
  if (existingSnapshot.publication_state !== "draft" || Number(existingSnapshot.viewer_approved)) return failure("Return this snapshot to an unapproved draft before rescanning it.", 409);
  if (await snapshotEvidenceLocked(database, snapshotId)) return failure("Reviewed history evidence is immutable; create a restoration snapshot instead of rescanning this source bundle.", 409);
  if (!env.SUBMISSION_FILES) return failure("Archive snapshot storage is unavailable.", 503);
  const claim = await claimSnapshotMutation(database, snapshotId, "finalize");
  if (!claim) return failure("This source bundle is being changed or reviewed, or its evidence is already immutable.", 409);
  const snapshot = claim.record, sourceRevision = Number(snapshot.source_revision || 0);
  const blockedFailure = async (message, status = 409) => {
    await failSnapshotFinalization(database, snapshotId, claim.token, message);
    return failure(message, status);
  };
  try {
    const begun = await database.prepare(`UPDATE archive_web_snapshots
      SET scan_status='blocked',scan_revision=-1,viewer_approved=0,viewer_approved_at=NULL,
        dependency_summary_json='{"finalization_in_progress":true}',updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND mutation_token=? AND source_revision=? RETURNING id`).bind(snapshotId, claim.token, sourceRevision).first();
    if (!begun) return blockedFailure("The source bundle changed before its scan could begin.");
  if (snapshot.material_id) {
    const material = await database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").bind(snapshot.material_id).first();
    if (material && (material.state !== "draft" || material.visibility !== "internal")) {
      return blockedFailure("Return the linked Archive Material to an internal draft before rescanning this source bundle.");
    }
  }
  const files = (await database.prepare("SELECT * FROM archive_web_snapshot_files WHERE snapshot_id=? ORDER BY normalized_path").bind(snapshotId).all()).results || [];
  if (!files.length) return blockedFailure("Upload at least one source file before finalizing.");
  const exactPaths = new Set(files.map((file) => file.normalized_path)), foldedPaths = new Map(files.map((file) => [file.path_folded, file.normalized_path]));
  const entry = files.find((file) => file.normalized_path === snapshot.entry_path);
  if (!entry || !["html", "htm"].includes(extension(entry.normalized_path))) return blockedFailure("The configured entry_path must name an uploaded HTML file with matching case.");
  const acceptedRows = (await database.prepare("SELECT dependency_key FROM archive_web_snapshot_dependencies WHERE snapshot_id=? AND status='accepted-missing'").bind(snapshotId).all()).results || [];
  const replacementRows = (await database.prepare(`SELECT dependency_key,local_path resolved_path FROM archive_web_snapshot_replacements
    WHERE snapshot_id=?`).bind(snapshotId).all()).results || [];
  const acceptedKeys = new Set(acceptedRows.map((row) => row.dependency_key));
  const replacements = new Map(replacementRows.map((row) => [row.dependency_key, row.resolved_path]));
  const extracted = [], findings = [];
  try {
    for (const file of files) {
      const ext = extension(file.normalized_path);
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const source = await objectText(env.SUBMISSION_FILES, file.source_storage_key);
      findings.push(...credentialFindings(file.normalized_path, source));
      let references = [];
      if (["html", "htm"].includes(ext)) references = extractHtmlReferences(source);
      else if (ext === "css") references = extractCssReferences(source);
      else if (["js", "mjs", "cjs"].includes(ext)) references = extractJavaScriptReferences(source);
      for (const reference of references) {
        if (!reference.reference) continue;
        let resolved;
        if (["dynamic", "base"].includes(reference.kind)) resolved = { status: "unverifiable", resolvedPath: "", critical: Number(reference.critical || 0) };
        else if (reference.kind === "script" && !/^(?:\.{0,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(reference.reference) && !extension(reference.reference)) resolved = { status: "unverifiable", resolvedPath: "", critical: 0 };
        else resolved = dependencyStatus(reference.reference, reference.kind, file.normalized_path, exactPaths, foldedPaths);
        if (!resolved) continue;
        extracted.push({
          referringPath: file.normalized_path,
          originalReference: decodeHtmlReference(reference.reference).slice(0, 3000),
          resolvedPath: resolved.resolvedPath,
          dependencyKind: reference.kind,
          status: resolved.status,
          critical: resolved.critical,
          notes: reference.kind === "frame" ? "Frames and embedded browsing contexts are blocked by the historical viewer." : "",
        });
      }
    }
  } catch (error) { return blockedFailure(String(error?.message || error), 502); }

  const unique = new Map();
  for (const dependency of extracted) {
    const tuple = `${dependency.referringPath}\n${dependency.originalReference}\n${dependency.dependencyKind}`;
    if (!unique.has(tuple)) unique.set(tuple, dependency);
  }
  const dependencies = [];
  let truncated = false;
  for (const [tuple, dependency] of unique) {
    if (dependencies.length >= ARCHIVE_WEB_SNAPSHOT_LIMITS.dependencies) { truncated = true; break; }
    const key = await sha256(tuple);
    const replacementPath = replacements.get(key);
    if (dependency.status === "external-blocked" && replacementPath) {
      dependencies.push({ ...dependency, key, status: "resolved", resolvedPath: replacementPath, notes: EXTERNAL_REPLACEMENT_NOTE, critical: 0 });
    } else {
      dependencies.push({ ...dependency, key, status: acceptedKeys.has(key) && ["missing", "case-mismatch"].includes(dependency.status) ? "accepted-missing" : dependency.status });
    }
  }
  const counts = {};
  for (const dependency of dependencies) counts[dependency.status] = Number(counts[dependency.status] || 0) + 1;
  const missingCritical = dependencies.filter((dependency) => dependency.critical && ["missing", "case-mismatch", "unverifiable"].includes(dependency.status)).length;
  const summary = { total: dependencies.length, ...counts, missing_critical: missingCritical, truncated };
  const scanStatus = findings.length || truncated ? "blocked" : missingCritical ? "needs-files" : "ready";
  const treeSource = `${TREE_HASH_ALGORITHM}\n${files.map((file) => `${file.normalized_path}\0${file.source_sha256}\0${Number(file.byte_size)}\n`).join("")}`;
  const treeHash = await sha256(treeSource), totalBytes = files.reduce((sum, file) => sum + Number(file.byte_size || 0), 0);
  const expectedTreeHash = String(snapshot.expected_tree_sha256 || "").toLowerCase();
  if (expectedTreeHash && expectedTreeHash !== treeHash) {
    const mismatchSummary = { ...summary, tree_hash_mismatch: true, expected_tree_sha256: expectedTreeHash, actual_tree_sha256: treeHash };
    const mismatchStored = await database.prepare(`UPDATE archive_web_snapshots SET scan_status='blocked',scan_revision=-1,viewer_approved=0,viewer_approved_at=NULL,
      tree_sha256=?,file_count=?,total_bytes=?,dependency_summary_json=?,credential_findings_json=?,updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND mutation_token=? AND source_revision=? RETURNING id`).bind(
      treeHash, files.length, totalBytes, JSON.stringify(mismatchSummary), JSON.stringify(findings), snapshotId, claim.token, sourceRevision,
    ).first();
    if (!mismatchStored) return blockedFailure("The source bundle changed before its tree-hash mismatch could be recorded.");
    return failure(`Stored source tree SHA-256 ${treeHash} does not match the Git import manifest ${expectedTreeHash}.`, 409);
  }
  try {
    const stillOwned = await database.prepare(`SELECT id FROM archive_web_snapshots
      WHERE id=? AND mutation_token=? AND source_revision=?`).bind(snapshotId, claim.token, sourceRevision).first();
    if (!stillOwned) return blockedFailure("The source bundle changed before dependency persistence began.");
    await database.prepare(`DELETE FROM archive_web_snapshot_dependencies WHERE snapshot_id=?
      AND EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=? AND source_revision=?)`).bind(
      snapshotId, snapshotId, claim.token, sourceRevision,
    ).run();
    for (let index = 0; index < dependencies.length; index += 100) {
      const chunkResults = await database.batch(dependencies.slice(index, index + 100).map((dependency) => database.prepare(`INSERT INTO archive_web_snapshot_dependencies
        (id,snapshot_id,dependency_key,referring_path,original_reference,resolved_path,dependency_kind,status,critical,notes,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now')
        WHERE EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=? AND source_revision=?)`).bind(
        id("archive-web-dependency"), snapshotId, dependency.key, dependency.referringPath, dependency.originalReference, dependency.resolvedPath,
        dependency.dependencyKind, dependency.status, dependency.critical, dependency.notes, snapshotId, claim.token, sourceRevision,
      )));
      if (chunkResults.some((result) => Number(result?.meta?.changes || 0) !== 1)) {
        return blockedFailure("The source bundle changed while dependency evidence was being persisted.");
      }
    }
    const finalResults = await database.batch([
      database.prepare(`UPDATE archive_web_snapshot_files
        SET file_role=CASE WHEN normalized_path=? THEN 'entry-html' WHEN file_role='entry-html' THEN 'html' ELSE file_role END,updated_at=datetime('now')
        WHERE snapshot_id=? AND EXISTS(
          SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=? AND source_revision=?
        )`).bind(snapshot.entry_path, snapshotId, snapshotId, claim.token, sourceRevision),
      database.prepare(`UPDATE archive_web_snapshots SET scan_status=?,scan_revision=?,viewer_approved=0,viewer_approved_at=NULL,
        tree_sha256=?,file_count=?,total_bytes=?,dependency_summary_json=?,credential_findings_json=?,
        updated_by='studio',updated_at=datetime('now')
        WHERE id=? AND mutation_token=? AND source_revision=?`).bind(
        scanStatus, sourceRevision, treeHash, files.length, totalBytes, JSON.stringify(summary), JSON.stringify(findings),
        snapshotId, claim.token, sourceRevision,
      ),
    ]);
    if (Number(finalResults?.[1]?.meta?.changes || 0) !== 1) {
      return blockedFailure("The source bundle changed before its scan results could be committed.");
    }
    if (scanStatus === "ready") await ensureSnapshotMaterial(database, snapshotId, claim.token);
    await releaseSnapshotMutation(database, snapshotId, claim.token);
  } catch (error) { return blockedFailure(String(error?.message || error), 409); }
  const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
  return json({ record, snapshot: record, files: record.files, dependencies: record.dependencies });
  } finally {
    await releaseSnapshotMutation(database, snapshotId, claim.token);
  }
}

function safeScreenshotUrl(value) {
  const candidate = text(value, 2000);
  if (!candidate) return "";
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname === "archive-viewer.thesixwellconstruct.com" ? candidate : "";
  } catch { return ""; }
}

async function refreshDependencyReadiness(database, snapshotId, mutationToken) {
  if (!mutationToken) return { ok: false, error: "Dependency readiness requires an active snapshot mutation claim." };
  const rows = (await database.prepare(`SELECT status,COUNT(*) count,SUM(critical) critical_count
    FROM archive_web_snapshot_dependencies WHERE snapshot_id=? GROUP BY status`).bind(snapshotId).all()).results || [];
  const snapshot = await database.prepare(`SELECT snapshot.dependency_summary_json,snapshot.credential_findings_json,
      snapshot.tree_sha256,snapshot.expected_tree_sha256,snapshot.file_count,snapshot.source_revision,snapshot.scan_revision,
      EXISTS(SELECT 1 FROM archive_web_snapshot_files file
        WHERE file.snapshot_id=snapshot.id AND file.normalized_path=snapshot.entry_path
          AND file.file_role='entry-html' AND file.source_sha256<>'' AND file.byte_size>=0) entry_present
    FROM archive_web_snapshots snapshot WHERE snapshot.id=?`).bind(snapshotId).first();
  if (!snapshot || !/^[a-f0-9]{64}$/i.test(String(snapshot.tree_sha256 || "")) || Number(snapshot.file_count || 0) < 1
    || Number(snapshot.scan_revision) !== Number(snapshot.source_revision) || !Number(snapshot.entry_present)) {
    return { ok: false, error: "Finalize and scan the immutable source bundle before changing dependency readiness." };
  }
  const previous = dependencySummary(snapshot?.dependency_summary_json), summary = { total: 0 };
  let missingCritical = 0;
  for (const row of rows) {
    summary[row.status] = Number(row.count || 0);
    summary.total += Number(row.count || 0);
    if (["missing", "case-mismatch", "unverifiable"].includes(row.status)) missingCritical += Number(row.critical_count || 0);
  }
  summary.missing_critical = missingCritical;
  summary.truncated = Boolean(previous.truncated);
  const expectedTreeHash = String(snapshot.expected_tree_sha256 || "").toLowerCase();
  const treeHashMismatch = Boolean(previous.tree_hash_mismatch) || Boolean(expectedTreeHash && expectedTreeHash !== String(snapshot.tree_sha256 || "").toLowerCase());
  if (treeHashMismatch) {
    summary.tree_hash_mismatch = true;
    summary.expected_tree_sha256 = expectedTreeHash || previous.expected_tree_sha256 || "";
    summary.actual_tree_sha256 = String(snapshot.tree_sha256 || previous.actual_tree_sha256 || "").toLowerCase();
  }
  const findings = safeJson(snapshot?.credential_findings_json, []);
  const scanStatus = findings.length || summary.truncated || treeHashMismatch ? "blocked" : missingCritical ? "needs-files" : "ready";
  const updated = await database.prepare(`UPDATE archive_web_snapshots SET scan_status=?,dependency_summary_json=?,viewer_approved=0,viewer_approved_at=NULL,
    updated_by='studio',updated_at=datetime('now') WHERE id=? AND mutation_token=? AND scan_revision=source_revision RETURNING id`).bind(
    scanStatus, JSON.stringify(summary), snapshotId, mutationToken,
  ).first();
  if (!updated) return { ok: false, error: "The source bundle changed before dependency readiness could be committed." };
  return { ok: true, scanStatus };
}

async function acceptMissingDependencies(database, snapshotId, values, mutationToken) {
  if (!Array.isArray(values) || !values.length) return { ok: false, error: "Choose at least one missing dependency from this finalized scan." };
  const ids = [...new Set(values.map((value) => text(typeof value === "object" ? (value.id || value.key) : value, 200)).filter(Boolean))].slice(0, 500);
  if (!ids.length) return { ok: false, error: "Choose at least one missing dependency from this finalized scan." };
  const rows = (await database.prepare(`SELECT id,dependency_key FROM archive_web_snapshot_dependencies
    WHERE snapshot_id=? AND status IN ('missing','case-mismatch')
      AND (id IN (${ids.map(() => "?").join(",")}) OR dependency_key IN (${ids.map(() => "?").join(",")}))`).bind(snapshotId, ...ids, ...ids).all()).results || [];
  if (ids.some((identifier) => !rows.some((row) => row.id === identifier || row.dependency_key === identifier))) {
    return { ok: false, error: "Every accepted dependency must identify a current missing or case-mismatched row from this finalized scan." };
  }
  const rowIds = [...new Set(rows.map((row) => row.id))];
  const changed = await database.prepare(`UPDATE archive_web_snapshot_dependencies SET status='accepted-missing',updated_at=datetime('now')
    WHERE snapshot_id=? AND status IN ('missing','case-mismatch')
      AND id IN (${rowIds.map(() => "?").join(",")})
      AND EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=? AND scan_revision=source_revision)`).bind(
    snapshotId, ...rowIds, snapshotId, mutationToken,
  ).run();
  if (Number(changed?.meta?.changes || 0) !== rowIds.length) {
    return { ok: false, error: "The source bundle changed before missing dependencies could be accepted." };
  }
  return refreshDependencyReadiness(database, snapshotId, mutationToken);
}

async function mapExternalDependency(request, env, snapshotId, dependencyIdentifier) {
  if (request.method !== "PUT") return failure("Method not allowed.", 405);
  const database = db(env), snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot) return failure("Website snapshot not found.", 404);
  if (snapshot.publication_state !== "draft" || Number(snapshot.viewer_approved)) {
    return failure("Return this snapshot to an unapproved draft before mapping an external replacement.", 409);
  }
  if (await snapshotEvidenceLocked(database, snapshotId)) return failure("Reviewed history evidence is immutable; create a restoration snapshot instead of changing its dependency record.", 409);
  const claim = await claimSnapshotMutation(database, snapshotId, "dependency");
  if (!claim) return failure("This source bundle is being changed or reviewed, or its evidence is already immutable.", 409);
  try {
  const lockedSnapshot = claim.record;
  if (lockedSnapshot.material_id) {
    const material = await database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").bind(lockedSnapshot.material_id).first();
    if (material && (material.state !== "draft" || material.visibility !== "internal")) {
      return failure("Return the linked Archive Material to an internal draft before changing its dependency record.", 409);
    }
  }
  const dependency = await database.prepare(`SELECT * FROM archive_web_snapshot_dependencies
    WHERE snapshot_id=? AND (id=? OR dependency_key=?) LIMIT 1`).bind(snapshotId, dependencyIdentifier, dependencyIdentifier).first();
  if (!dependency) return failure("Website snapshot dependency not found.", 404);
  const isExternal = /^(?:https?:)?\/\//i.test(dependency.original_reference) || /^[a-z][a-z0-9+.-]*:/i.test(dependency.original_reference);
  if (!isExternal || ["navigation", "frame", "base", "dynamic"].includes(dependency.dependency_kind)) {
    return failure("Only blocked external render dependencies can use a local replacement.", 409);
  }
  if (dependency.status !== "external-blocked" && dependency.notes !== EXTERNAL_REPLACEMENT_NOTE) {
    return failure("This dependency is not awaiting an external-resource replacement.", 409);
  }
  if (!env.SUBMISSION_FILES) return failure("Archive snapshot storage is unavailable.", 503);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > ARCHIVE_WEB_SNAPSHOT_LIMITS.mediaBytes + 1024 * 1024) return failure("Replacement file exceeds the allowed size.", 413);
  let form;
  try { form = await request.formData(); } catch { return failure("Send multipart form data with file and path fields."); }
  const file = form.get("file");
  if (!file || typeof file.stream !== "function") return failure("Choose a local replacement file.");
  let replacementPath, classification;
  try {
    replacementPath = normalizeArchiveWebPath(text(form.get("path"), 1200) || `external-replacements/${file.name}`);
    classification = classifyFile(replacementPath, file.type || "application/octet-stream");
  } catch (error) { return failure(error.message, 415); }
  if (!classification.viewerEligible || ["html", "document", "other"].includes(classification.role)) return failure("Choose a viewer-eligible image, font, stylesheet, script, data, audio, or video replacement.", 415);
  if (Number(file.size || 0) > classification.maximumBytes) return failure("Replacement file exceeds the allowed size.", 413);
  const sourceCollision = await database.prepare(`SELECT normalized_path FROM archive_web_snapshot_files
    WHERE snapshot_id=? AND path_folded=? LIMIT 1`).bind(snapshotId, replacementPath.toLowerCase()).first();
  if (sourceCollision) return failure(`Use a derivative-only path; ${replacementPath} collides with immutable source path ${sourceCollision.normalized_path}.`, 409);
  const pathCollision = await database.prepare(`SELECT dependency_key,local_path FROM archive_web_snapshot_replacements
    WHERE snapshot_id=? AND lower(local_path)=lower(?) AND dependency_key<>? LIMIT 1`).bind(snapshotId, replacementPath, dependency.dependency_key).first();
  if (pathCollision) return failure(`The derivative path ${replacementPath} collides with existing replacement ${pathCollision.local_path}.`, 409);
  let bytes;
  try {
    bytes = new Uint8Array(await new Response(countedStream(file.stream(), classification.maximumBytes, { value: 0 })).arrayBuffer());
  } catch (error) { return failure(String(error?.message || error), 413); }
  if (!bytes.byteLength) return failure("Choose a non-empty local replacement file.", 409);
  if (classification.text) {
    const findings = credentialFindings(replacementPath, new TextDecoder().decode(bytes));
    if (findings.length) return failure("The local replacement contains a suspected credential and cannot become a viewer derivative.", 409);
  }
  const hash = await sha256(bytes);
  const existing = await database.prepare(`SELECT * FROM archive_web_snapshot_replacements
    WHERE snapshot_id=? AND dependency_key=? LIMIT 1`).bind(snapshotId, dependency.dependency_key).first();
  if (existing) {
    if (existing.local_path !== replacementPath || existing.mime_type !== classification.mime
      || existing.sha256 !== hash || Number(existing.byte_size) !== bytes.byteLength) {
      return failure("This dependency already has a different immutable local replacement.", 409);
    }
    const restored = await database.prepare(`UPDATE archive_web_snapshot_dependencies SET resolved_path=?,status='resolved',critical=0,notes=?,updated_at=datetime('now')
      WHERE snapshot_id=? AND dependency_key=?
        AND EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=?) RETURNING id`).bind(
      replacementPath, EXTERNAL_REPLACEMENT_NOTE, snapshotId, dependency.dependency_key, snapshotId, claim.token,
    ).first();
    if (!restored) return failure("The source bundle changed before its replacement mapping could be restored.", 409);
    const readiness = await refreshDependencyReadiness(database, snapshotId, claim.token);
    if (!readiness.ok) return failure(readiness.error, 409);
    const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
    return json({ unchanged: true, record, snapshot: record, dependency: record.dependencies.find((entry) => entry.dependency_key === dependency.dependency_key) || null,
      replacement: presentReplacement(existing) });
  }

  const replacementId = id("archive-web-replacement"), storageKey = `archive/web-snapshot-replacements/${replacementId}`;
  try {
    await env.SUBMISSION_FILES.put(storageKey, bytes, { httpMetadata: { contentType: classification.mime } });
    const results = await database.batch([
      database.prepare(`INSERT INTO archive_web_snapshot_replacements
        (id,snapshot_id,dependency_key,local_path,storage_key,mime_type,byte_size,sha256,derivative_role,created_by,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now')
        WHERE EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=?)`).bind(
        replacementId, snapshotId, dependency.dependency_key, replacementPath, storageKey, classification.mime, bytes.byteLength, hash,
        "external-resource-replacement", snapshotId, claim.token,
      ),
      database.prepare(`UPDATE archive_web_snapshot_dependencies SET resolved_path=?,status='resolved',critical=0,notes=?,updated_at=datetime('now')
        WHERE snapshot_id=? AND dependency_key=?
          AND EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=?)`).bind(
        replacementPath, EXTERNAL_REPLACEMENT_NOTE, snapshotId, dependency.dependency_key, snapshotId, claim.token,
      ),
      database.prepare(`UPDATE archive_web_snapshots SET updated_by=CASE
          WHEN mutation_token=? AND EXISTS(
            SELECT 1 FROM archive_web_snapshot_replacements replacement
            WHERE replacement.id=? AND replacement.snapshot_id=archive_web_snapshots.id
          ) AND EXISTS(
            SELECT 1 FROM archive_web_snapshot_dependencies dependency
            WHERE dependency.snapshot_id=archive_web_snapshots.id AND dependency.dependency_key=?
              AND dependency.status='resolved' AND dependency.resolved_path=?
          ) THEN updated_by ELSE NULL END
        WHERE id=?`).bind(claim.token, replacementId, dependency.dependency_key, replacementPath, snapshotId),
    ]);
    if (results.some((result) => Number(result?.meta?.changes || 0) !== 1)) {
      await Promise.allSettled([
        database.prepare("DELETE FROM archive_web_snapshot_replacements WHERE id=?").bind(replacementId).run(),
        env.SUBMISSION_FILES.delete(storageKey),
      ]);
      return failure("The replacement mapping changed before it could be committed.", 409);
    }
  } catch (error) {
    await env.SUBMISSION_FILES.delete(storageKey);
    return failure(String(error?.message || error), 409);
  }
  const readiness = await refreshDependencyReadiness(database, snapshotId, claim.token);
  if (!readiness.ok) return failure(readiness.error, 409);
  const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
  const replacement = await database.prepare("SELECT * FROM archive_web_snapshot_replacements WHERE id=?").bind(replacementId).first();
  return json({ record, snapshot: record, dependency: record.dependencies.find((entry) => entry.dependency_key === dependency.dependency_key) || null,
    replacement: presentReplacement(replacement) }, { status: 201 });
  } finally {
    await releaseSnapshotMutation(database, snapshotId, claim.token);
  }
}

async function publicationGateReady(database, snapshotId) {
  return database.prepare(`SELECT snapshot.id FROM archive_web_snapshots snapshot
    JOIN archive_dossiers dossier ON dossier.entity_id=snapshot.dossier_entity_id
    JOIN content_entities entity ON entity.id=dossier.entity_id
    JOIN archive_records owner ON owner.id=entity.id
    JOIN archive_materials material ON material.id=snapshot.material_id
    JOIN archive_object_states state ON state.id=snapshot.state_id AND material.state_id=state.id
    JOIN archive_object_versions version ON version.id=state.version_id AND version.entity_id=snapshot.dossier_entity_id
    WHERE snapshot.id=?
      AND entity.visibility='public' AND dossier.state='published' AND dossier.public_visible=1 AND owner.state='published'
      AND material.dossier_entity_id=snapshot.dossier_entity_id AND material.state='published' AND material.visibility='public'
      AND state.publication_state='published' AND state.public_visible=1
      AND version.publication_state='published' AND version.public_visible=1`).bind(snapshotId).first();
}

async function updateSnapshot(request, env, snapshotId) {
  const database = db(env), existing = await snapshotAdminRecord(database, snapshotId);
  if (!existing) return failure("Website snapshot not found.", 404);
  if (existing.mutation_token) return failure("This website snapshot is being changed, scanned, or reviewed. Retry after that operation finishes.", 409);
  if (request.method === "DELETE") {
    const archived = await database.prepare(`UPDATE archive_web_snapshots SET publication_state='archived',public_visible=0,viewer_approved=0,viewer_approved_at=NULL,
      updated_by='studio',updated_at=datetime('now') WHERE id=? AND mutation_token='' RETURNING id`).bind(snapshotId).first();
    if (!archived) return failure("This website snapshot changed before it could be archived.", 409);
    return json({ ok: true, archived: true, record: await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN) });
  }
  if (request.method !== "PATCH") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const linkedMaterial = existing.material_id
    ? await database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").bind(existing.material_id).first()
    : null;
  const linkedMaterialLocked = linkedMaterial && (linkedMaterial.state !== "draft" || linkedMaterial.visibility !== "internal");
  if (body.accepted_missing_dependency_ids || body.acceptedMissingDependencyIds) {
    const dependencyClaim = await claimSnapshotMutation(database, snapshotId, "dependency");
    if (!dependencyClaim) return failure("This source bundle is being changed or reviewed, or its evidence is already immutable.", 409);
    try {
      const lockedSnapshot = dependencyClaim.record;
      if (lockedSnapshot.material_id) {
        const material = await database.prepare("SELECT state,visibility FROM archive_materials WHERE id=?").bind(lockedSnapshot.material_id).first();
        if (material && (material.state !== "draft" || material.visibility !== "internal")) {
          return failure("Return the linked Archive Material to an internal draft before changing its dependency record.", 409);
        }
      }
      const readiness = await acceptMissingDependencies(
        database,
        snapshotId,
        body.accepted_missing_dependency_ids ?? body.acceptedMissingDependencyIds,
        dependencyClaim.token,
      );
      if (!readiness.ok) return failure(readiness.error, 409);
    } finally {
      await releaseSnapshotMutation(database, snapshotId, dependencyClaim.token);
    }
  }
  const current = await snapshotAdminRecord(database, snapshotId);
  const expectedHashSupplied = Object.prototype.hasOwnProperty.call(body, "expected_tree_sha256")
    || Object.prototype.hasOwnProperty.call(body, "expectedTreeSha256");
  const expectedTreeHash = expectedHashSupplied
    ? text(body.expected_tree_sha256 ?? body.expectedTreeSha256, 64).toLowerCase()
    : String(current.expected_tree_sha256 || "").toLowerCase();
  if (expectedHashSupplied) {
    if (!/^[a-f0-9]{64}$/.test(expectedTreeHash)) return failure("Expected tree SHA-256 must contain exactly 64 hexadecimal characters.", 409);
    if (current.source_kind !== "git") return failure("Only Git imports can declare an expected source-tree hash.", 409);
    if (current.expected_tree_sha256 && current.expected_tree_sha256 !== expectedTreeHash) return failure("A non-empty expected source-tree hash is immutable.", 409);
    if (current.tree_sha256 && current.tree_sha256 !== expectedTreeHash) return failure("The expected source-tree hash does not match the already finalized immutable source files.", 409);
    if (!current.expected_tree_sha256 && (current.publication_state !== "draft" || Number(current.viewer_approved))) {
      return failure("Return this Git snapshot to an unapproved draft before recording its expected source-tree hash.", 409);
    }
    if (!current.expected_tree_sha256 && linkedMaterialLocked) {
      return failure("Return the linked Archive Material to an internal draft before recording its expected source-tree hash.", 409);
    }
  }
  let entryPath;
  try { entryPath = normalizeArchiveWebPath(body.entry_path ?? body.entryPath ?? current.entry_path); } catch (error) { return failure(error.message, 409); }
  const lineageRole = text(body.lineage_role ?? body.lineageRole ?? current.lineage_role, 40);
  if (!LINEAGE_ROLES.has(lineageRole)) return failure("Choose a valid lineage role.", 409);
  const stateId = text(body.state_id ?? body.stateId ?? current.state_id, 200) || null;
  if (stateId) {
    const valid = await database.prepare(`SELECT state.id FROM archive_object_states state JOIN archive_object_versions version ON version.id=state.version_id
      WHERE state.id=? AND version.entity_id=?`).bind(stateId, current.dossier_entity_id).first();
    if (!valid) return failure("Choose a State from this Archive dossier.", 409);
  }
  if (current.material_id && stateId !== current.state_id) return failure("A snapshot with a linked Archive Material cannot be moved to another State.", 409);
  const metadataChanged = entryPath !== current.entry_path || stateId !== current.state_id || lineageRole !== current.lineage_role
    || Object.prototype.hasOwnProperty.call(body, "title")
    || Object.prototype.hasOwnProperty.call(body, "git_commit_sha") || Object.prototype.hasOwnProperty.call(body, "gitCommitSha")
    || Object.prototype.hasOwnProperty.call(body, "git_parent_sha") || Object.prototype.hasOwnProperty.call(body, "gitParentSha")
    || Object.prototype.hasOwnProperty.call(body, "git_commit_date") || Object.prototype.hasOwnProperty.call(body, "gitCommitDate")
    || Object.prototype.hasOwnProperty.call(body, "git_commit_at")
    || Object.prototype.hasOwnProperty.call(body, "git_author") || Object.prototype.hasOwnProperty.call(body, "gitAuthor")
    || Object.prototype.hasOwnProperty.call(body, "git_message") || Object.prototype.hasOwnProperty.call(body, "gitMessage");
  const evidenceChanged = metadataChanged || (expectedHashSupplied && !current.expected_tree_sha256)
    || Object.prototype.hasOwnProperty.call(body, "screenshot_url") || Object.prototype.hasOwnProperty.call(body, "screenshotUrl");
  if (evidenceChanged && await snapshotEvidenceLocked(database, snapshotId)) return failure("Reviewed history evidence is immutable; create a restoration snapshot instead of changing its source or provenance.", 409);
  if (metadataChanged && current.publication_state !== "draft") return failure("Return this snapshot to draft before changing its historical metadata.", 409);
  if (metadataChanged && linkedMaterialLocked) return failure("Return the linked Archive Material to an internal draft before changing historical metadata.", 409);
  let scanStatus = current.scan_status, viewerApproved = Object.prototype.hasOwnProperty.call(body, "viewer_approved") || Object.prototype.hasOwnProperty.call(body, "viewerApproved")
    ? bool(body.viewer_approved ?? body.viewerApproved) : Number(current.viewer_approved) === 1;
  if (entryPath !== current.entry_path) { scanStatus = "draft"; viewerApproved = false; }
  if (viewerApproved && scanStatus !== "ready") return failure("Resolve or explicitly accept critical dependencies and clear credential findings before approving the viewer.", 409);
  const publicationState = text(body.publication_state ?? body.publicationState ?? current.publication_state, 30);
  if (!SNAPSHOT_STATES.has(publicationState)) return failure("Choose a valid snapshot publication state.", 409);
  let publicVisible = Object.prototype.hasOwnProperty.call(body, "public_visible") || Object.prototype.hasOwnProperty.call(body, "publicVisible")
    ? bool(body.public_visible ?? body.publicVisible) : Number(current.public_visible) === 1;
  if (publicationState !== "published") publicVisible = false;
  if (publicationState === "archived") viewerApproved = false;
  if (publicationState === "published") {
    if (!publicVisible || !viewerApproved || scanStatus !== "ready") return failure("A public snapshot must be ready, viewer-approved, and explicitly public.", 409);
    if (!await publicationGateReady(database, snapshotId)) return failure("Publish the canonical record, dossier, Version, State, and linked Material before publishing this snapshot.", 409);
  }
  const screenshot = body.screenshot_url === undefined && body.screenshotUrl === undefined ? current.screenshot_url : safeScreenshotUrl(body.screenshot_url ?? body.screenshotUrl);
  if ((body.screenshot_url || body.screenshotUrl) && !screenshot) return failure("Use a screenshot route from the Archive viewer.", 409);
  const updated = await database.prepare(`UPDATE archive_web_snapshots SET title=?,state_id=?,lineage_role=?,entry_path=?,git_commit_sha=?,git_parent_sha=?,git_commit_date=?,
    git_author=?,git_message=?,expected_tree_sha256=?,scan_status=?,viewer_approved=?,viewer_approved_at=CASE WHEN ?=1 THEN COALESCE(viewer_approved_at,datetime('now')) ELSE NULL END,
    publication_state=?,public_visible=?,screenshot_url=?,sort_order=?,reviewed_by=CASE WHEN ?=1 THEN 'studio' ELSE reviewed_by END,
    reviewed_at=CASE WHEN ?=1 THEN COALESCE(reviewed_at,datetime('now')) ELSE reviewed_at END,updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND mutation_token='' AND source_revision=? AND scan_revision=? AND (
      ?=0 OR NOT EXISTS(SELECT 1 FROM archive_web_history_candidates candidate
        WHERE candidate.snapshot_id=archive_web_snapshots.id
          AND (candidate.decision<>'pending' OR candidate.reviewed_by LIKE 'archive-web-%-claim-%'))
    ) RETURNING id`).bind(
    text(body.title ?? current.title, 300), stateId, lineageRole, entryPath,
    text(body.git_commit_sha ?? body.gitCommitSha ?? current.git_commit_sha, 100), text(body.git_parent_sha ?? body.gitParentSha ?? current.git_parent_sha, 100),
    text(body.git_commit_date ?? body.gitCommitDate ?? body.git_commit_at ?? current.git_commit_date, 80) || null,
    text(body.git_author ?? body.gitAuthor ?? current.git_author, 300), text(body.git_message ?? body.gitMessage ?? current.git_message, 3000),
    expectedTreeHash, scanStatus, viewerApproved ? 1 : 0, viewerApproved ? 1 : 0, publicationState, publicVisible ? 1 : 0, screenshot,
    Number(body.sort_order ?? body.sortOrder ?? current.sort_order) || 0, viewerApproved ? 1 : 0, viewerApproved ? 1 : 0,
    snapshotId, Number(current.source_revision || 0), Number(current.scan_revision ?? -1), evidenceChanged ? 1 : 0,
  ).first();
  if (!updated) return failure("This website snapshot changed or became immutable before the update could be committed.", 409);
  if (scanStatus === "ready" && stateId) await ensureSnapshotMaterial(database, snapshotId);
  const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
  return json({ record, snapshot: record });
}

async function previewSnapshot(request, env, snapshotId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env), snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot) return failure("Website snapshot not found.", 404);
  if (snapshot.mutation_token || snapshot.scan_status !== "ready"
    || Number(snapshot.scan_revision) !== Number(snapshot.source_revision)) {
    return failure("Finalize a stable, ready source generation before opening its isolated preview.", 409);
  }
  const secret = String(env.ARCHIVE_VIEWER_SIGNING_KEY || "");
  if (!secret) return failure("Archive viewer preview signing is unavailable.", 503);
  try {
    const { token, expires } = await previewCapability(secret, snapshotId);
    const viewerUrl = snapshotViewerUrl(snapshotId, snapshot.entry_path, token, env.ARCHIVE_VIEWER_ORIGIN);
    return json({ preview: { snapshot_id: snapshotId, snapshotId, token, expires_at: new Date(expires * 1000).toISOString(), viewer_url: viewerUrl, viewerUrl } });
  } catch (error) { return failure(String(error?.message || error), 409); }
}

async function listSnapshots(request, env, snapshotId = "") {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  if (snapshotId) {
    const record = await snapshotAdminDetail(database, snapshotId, env.ARCHIVE_VIEWER_ORIGIN);
    return record ? json({ record, snapshot: record }) : failure("Website snapshot not found.", 404);
  }
  const url = new URL(request.url), entityId = text(url.searchParams.get("entity_id") || url.searchParams.get("entityId"), 200);
  const rows = entityId
    ? (await database.prepare(`${snapshotAdminSql("snapshot.dossier_entity_id=?")} ORDER BY snapshot.sort_order,snapshot.created_at,snapshot.id`).bind(entityId).all()).results || []
    : (await database.prepare(`${snapshotAdminSql()} ORDER BY snapshot.dossier_entity_id,snapshot.sort_order,snapshot.created_at,snapshot.id`).all()).results || [];
  const records = rows.map((row) => presentSnapshot(row, { admin: true, viewerOrigin: env.ARCHIVE_VIEWER_ORIGIN }));
  return json({ records, snapshots: records, count: records.length });
}

function stringList(value, limit = 500) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(source.map((item) => text(typeof item === "object" ? (item.sha || item.path || item.id || JSON.stringify(item)) : item, 1000)).filter(Boolean))].slice(0, limit);
}

async function defaultWebsiteEntityId(database) {
  const row = await database.prepare("SELECT entity_id FROM archive_dossiers WHERE archive_slug='the-six-well-construct-website'").first();
  return row?.entity_id || "";
}

async function normalizeCandidate(database, body) {
  const representative = body.representative_commit && typeof body.representative_commit === "object" ? body.representative_commit : {};
  const dossierEntityId = text(body.dossier_entity_id ?? body.entity_id ?? body.entityId, 200) || await defaultWebsiteEntityId(database);
  if (!dossierEntityId || !await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(dossierEntityId).first()) throw new Error("Choose an Archive dossier for this history candidate.");
  const snapshotId = text(body.snapshot_id ?? body.snapshotId, 200) || null;
  if (snapshotId) {
    const snapshot = await database.prepare("SELECT dossier_entity_id FROM archive_web_snapshots WHERE id=?").bind(snapshotId).first();
    if (!snapshot || snapshot.dossier_entity_id !== dossierEntityId) throw new Error("Choose a snapshot from this candidate's Archive dossier.");
  }
  const commitGroup = stringList(body.commits ?? body.commit_group ?? body.commitGroup, 100);
  const commitSha = text(body.commit_sha ?? body.commitSha ?? body.representative_commit_sha ?? representative.sha ?? (typeof body.representative_commit === "string" ? body.representative_commit : commitGroup[0]), 100);
  const decision = text(body.review_decision ?? body.decision, 40) || "pending";
  if (!REVIEW_DECISIONS.has(decision)) throw new Error("Choose a valid history-candidate review decision.");
  if (decision !== "pending") throw new Error("Synchronize history candidates as pending, then record the curator decision through the review endpoint.");
  const reasons = Array.isArray(body.reasons) ? body.reasons : body.reason ? [body.reason] : [];
  return {
    id: text(body.id, 200) || id("archive-web-candidate"),
    snapshotId,
    dossierEntityId,
    commitSha,
    parentSha: text(body.parent_sha ?? body.parentSha ?? representative.parent_sha, 100),
    commitGroup,
    groupKey: text(body.group_key ?? body.groupKey, 300),
    title: text(body.title ?? representative.title ?? body.message ?? representative.message, 300) || (commitSha ? `Commit ${commitSha.slice(0, 7)}` : "Website history candidate"),
    commitDate: text(body.commit_date ?? body.commitDate ?? body.commit_at ?? representative.date, 80) || null,
    author: text(body.author ?? representative.author, 300),
    message: text(body.message ?? representative.message, 3000),
    score: Number(body.score) || 0,
    reasons: reasons.map((reason) => text(reason, 1000)).filter(Boolean).slice(0, 100),
    changedPaths: stringList(body.changed_paths ?? body.changedPaths, 500),
    desktopCaptureUrl: safeScreenshotUrl(body.desktop_capture_url ?? body.desktopCaptureUrl),
    mobileCaptureUrl: safeScreenshotUrl(body.mobile_capture_url ?? body.mobileCaptureUrl),
    decision,
    curatorNote: text(body.curator_note ?? body.curatorNote, 10000),
  };
}

function candidateEvidenceConflicts(existing, candidate) {
  return [
      [candidate.snapshotId || null, existing.snapshot_id || null],
      [candidate.dossierEntityId, existing.dossier_entity_id],
      [candidate.commitSha, existing.commit_sha],
      [candidate.parentSha, existing.parent_sha],
      [JSON.stringify(candidate.commitGroup), existing.commit_group_json],
      [candidate.groupKey, existing.group_key],
      [candidate.title, existing.title],
      [candidate.commitDate || null, existing.commit_date || null],
      [candidate.author, existing.author],
      [candidate.message, existing.message],
      [Number(candidate.score), Number(existing.score)],
      [JSON.stringify(candidate.reasons), existing.reasons_json],
      [JSON.stringify(candidate.changedPaths), existing.changed_paths_json],
    ].some(([next, prior]) => next !== prior)
    || (candidate.desktopCaptureUrl && candidate.desktopCaptureUrl !== existing.desktop_capture_url)
    || (candidate.mobileCaptureUrl && candidate.mobileCaptureUrl !== existing.mobile_capture_url);
}

function candidateClaimActive(value) {
  return /^archive-web-(?:review|capture)-claim-/.test(String(value || ""));
}

async function upsertCandidate(database, candidate) {
  const existing = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidate.id).first();
  if (existing?.decision === "pending" && candidateClaimActive(existing.reviewed_by)) {
    throw new Error("This history candidate is currently being reviewed; synchronize it after the curator decision completes.");
  }
  if (existing && existing.decision !== "pending") {
    if (candidateEvidenceConflicts(existing, candidate)) throw new Error("Reviewed history-candidate evidence is immutable; the synchronized snapshot, commit group, and captures must match the recorded decision.");
    return existing;
  }
  const stored = await database.prepare(`INSERT INTO archive_web_history_candidates
    (id,snapshot_id,dossier_entity_id,commit_sha,parent_sha,commit_group_json,group_key,title,commit_date,author,message,score,
     reasons_json,changed_paths_json,desktop_capture_url,mobile_capture_url,decision,curator_note,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      snapshot_id=COALESCE(excluded.snapshot_id,archive_web_history_candidates.snapshot_id),
      dossier_entity_id=excluded.dossier_entity_id,commit_sha=excluded.commit_sha,parent_sha=excluded.parent_sha,
      commit_group_json=excluded.commit_group_json,group_key=excluded.group_key,title=excluded.title,commit_date=excluded.commit_date,
      author=excluded.author,message=excluded.message,score=excluded.score,reasons_json=excluded.reasons_json,
      changed_paths_json=excluded.changed_paths_json,
      desktop_capture_url=CASE WHEN excluded.desktop_capture_url<>'' THEN excluded.desktop_capture_url ELSE archive_web_history_candidates.desktop_capture_url END,
      mobile_capture_url=CASE WHEN excluded.mobile_capture_url<>'' THEN excluded.mobile_capture_url ELSE archive_web_history_candidates.mobile_capture_url END,
      decision=CASE WHEN archive_web_history_candidates.decision='pending' THEN excluded.decision ELSE archive_web_history_candidates.decision END,
      curator_note=CASE WHEN archive_web_history_candidates.decision='pending' THEN excluded.curator_note ELSE archive_web_history_candidates.curator_note END,
      updated_by='studio',updated_at=datetime('now')
    WHERE archive_web_history_candidates.decision='pending'
      AND archive_web_history_candidates.reviewed_by NOT LIKE 'archive-web-%-claim-%'
    RETURNING *`).bind(
    candidate.id, candidate.snapshotId, candidate.dossierEntityId, candidate.commitSha, candidate.parentSha, JSON.stringify(candidate.commitGroup),
    candidate.groupKey, candidate.title, candidate.commitDate, candidate.author, candidate.message, candidate.score, JSON.stringify(candidate.reasons),
    JSON.stringify(candidate.changedPaths), candidate.desktopCaptureUrl, candidate.mobileCaptureUrl, candidate.decision, candidate.curatorNote,
  ).first();
  if (stored) return stored;
  const latest = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidate.id).first();
  if (latest?.decision === "pending" && candidateClaimActive(latest.reviewed_by)) {
    throw new Error("This history candidate is currently being reviewed; synchronize it after the curator decision completes.");
  }
  if (latest && latest.decision !== "pending") {
    if (candidateEvidenceConflicts(latest, candidate)) throw new Error("Reviewed history-candidate evidence is immutable; the synchronized snapshot, commit group, and captures must match the recorded decision.");
    return latest;
  }
  throw new Error("The history candidate changed before its synchronized evidence could be committed.");
}

function captureBytesMatchMime(bytes, mimeType) {
  if (mimeType === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mimeType === "image/webp") return bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function snapshotCaptureApi(request, env, snapshotId, viewport, action = "", candidateId = "") {
  if (!CAPTURE_VIEWPORTS.has(viewport)) return failure("Choose a valid capture viewport.", 409);
  const database = db(env);
  const snapshot = await snapshotAdminRecord(database, snapshotId);
  if (!snapshot) return failure("Website snapshot not found.", 404);
  let candidate = candidateId
    ? await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=? AND snapshot_id=?").bind(candidateId, snapshotId).first()
    : null;
  if (candidateId && !candidate) return failure("History candidate not found for this snapshot.", 404);
  let existing = await database.prepare(`SELECT * FROM archive_web_snapshot_captures
    WHERE snapshot_id=? AND viewport=?`).bind(snapshotId, viewport).first();

  if (action === "preview") {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    if (!existing) return failure("Generated capture not found.", 404);
    const secret = String(env.ARCHIVE_VIEWER_SIGNING_KEY || "");
    if (!secret) return failure("Archive viewer preview signing is unavailable.", 503);
    try {
      const capability = await previewCapability(secret, snapshotId);
      const capture = presentCapture(existing, { viewerOrigin: env.ARCHIVE_VIEWER_ORIGIN, token: capability.token });
      return json({ capture, preview: { ...capture, token: capability.token, expires_at: new Date(capability.expires * 1000).toISOString() } });
    } catch (error) { return failure(String(error?.message || error), 409); }
  }
  if (request.method === "GET") {
    return existing ? json({ capture: presentCapture(existing, { viewerOrigin: env.ARCHIVE_VIEWER_ORIGIN }) }) : failure("Generated capture not found.", 404);
  }
  if (request.method !== "PUT") return failure("Method not allowed.", 405);
  if (candidate && (candidate.decision !== "pending" || candidateClaimActive(candidate.reviewed_by))) {
    return failure("Captures are immutable while or after the curator records a history decision.", 409);
  }
  if (snapshot.publication_state !== "draft" || Number(snapshot.viewer_approved)) {
    return failure("Return the snapshot to an unapproved draft before attaching captures.", 409);
  }
  if (!env.SUBMISSION_FILES || !request.body) return failure("Archive capture storage is unavailable.", 503);
  const previewSecret = String(env.ARCHIVE_VIEWER_SIGNING_KEY || "");
  if (!previewSecret) return failure("Archive viewer preview signing is unavailable.", 503);
  const mimeType = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!CAPTURE_MIME_TYPES.has(mimeType)) return failure("Generated captures must be PNG, JPEG, or WebP images.", 415);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > ARCHIVE_WEB_SNAPSHOT_LIMITS.assetBytes) return failure("Generated capture exceeds the 15 MB image limit.", 413);
  let candidateClaim = null, snapshotClaim = null;
  try {
    if (candidateId) {
      candidateClaim = await claimPendingCandidate(database, candidateId, "capture");
      if (!candidateClaim) return failure("Captures are immutable while or after the curator records a history decision.", 409);
      candidate = candidateClaim.record;
    }
    snapshotClaim = await claimSnapshotMutation(database, snapshotId, "capture", candidateClaim?.token || "");
    if (!snapshotClaim) return failure("This source bundle is being changed or reviewed, or its evidence is already immutable.", 409);
    existing = await database.prepare(`SELECT * FROM archive_web_snapshot_captures
      WHERE snapshot_id=? AND viewport=?`).bind(snapshotId, viewport).first();
    let bytes;
    try {
      bytes = new Uint8Array(await new Response(countedStream(request.body, ARCHIVE_WEB_SNAPSHOT_LIMITS.assetBytes, { value: 0 })).arrayBuffer());
    } catch (error) { return failure(String(error?.message || error), 413); }
    if (!bytes.length || !captureBytesMatchMime(bytes, mimeType)) return failure("Generated capture bytes do not match the declared image type.", 415);
    const hash = await sha256(bytes);
    if (existing) {
      if (existing.sha256 !== hash || Number(existing.byte_size) !== bytes.byteLength || existing.mime_type !== mimeType) {
        return failure("That viewport already has a different immutable generated capture.", 409);
      }
      const capability = await previewCapability(previewSecret, snapshotId);
      return json({ unchanged: true, capture: presentCapture(existing, { viewerOrigin: env.ARCHIVE_VIEWER_ORIGIN, token: capability.token }) });
    }

    const captureId = id("archive-web-capture"), storageKey = `archive/web-history-captures/${captureId}`;
    const publicUrl = captureViewerUrl(snapshotId, captureId, "", env.ARCHIVE_VIEWER_ORIGIN);
    await env.SUBMISSION_FILES.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });
    const statements = [
      database.prepare(`INSERT INTO archive_web_snapshot_captures
        (id,candidate_id,snapshot_id,viewport,storage_key,mime_type,byte_size,sha256,derivative_role,created_by,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now')
        WHERE EXISTS(SELECT 1 FROM archive_web_snapshots WHERE id=? AND mutation_token=?)`).bind(
        captureId, candidateId || null, snapshotId, viewport, storageKey, mimeType, bytes.byteLength, hash, "generated-viewer-capture",
        snapshotId, snapshotClaim.token,
      ),
    ];
    if (candidate) statements.push(database.prepare(`UPDATE archive_web_history_candidates SET
        desktop_capture_url=CASE WHEN ?='desktop' THEN ? ELSE desktop_capture_url END,
        mobile_capture_url=CASE WHEN ?='mobile' THEN ? ELSE mobile_capture_url END,
        reviewed_by='',updated_by='studio',updated_at=datetime('now')
        WHERE id=? AND decision='pending' AND reviewed_by=?`).bind(
      viewport, publicUrl, viewport, publicUrl, candidateId, candidateClaim.token,
    ));
    else if (viewport === "desktop") statements.push(database.prepare(`UPDATE archive_web_snapshots SET screenshot_url=?,updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND mutation_token=?`).bind(publicUrl, snapshotId, snapshotClaim.token));
    statements.push(database.prepare(`UPDATE archive_web_snapshots SET updated_by=CASE
        WHEN mutation_token=? AND EXISTS(
          SELECT 1 FROM archive_web_snapshot_captures capture
          WHERE capture.id=? AND capture.snapshot_id=archive_web_snapshots.id
        ) AND (?<>'desktop' OR ?<>'' OR screenshot_url=?) THEN updated_by ELSE NULL END
      WHERE id=?`).bind(snapshotClaim.token, captureId, viewport, candidateId, publicUrl, snapshotId));
    if (candidate) statements.push(database.prepare(`UPDATE archive_web_history_candidates SET updated_by=CASE
        WHEN decision='pending' AND reviewed_by='' AND (
          (?='desktop' AND desktop_capture_url=?) OR (?='mobile' AND mobile_capture_url=?)
        ) THEN updated_by ELSE NULL END
      WHERE id=?`).bind(viewport, publicUrl, viewport, publicUrl, candidateId));
    try {
      const results = await database.batch(statements);
      if (results.some((result) => Number(result?.meta?.changes || 0) !== 1)) {
        await Promise.allSettled([
          database.prepare("DELETE FROM archive_web_snapshot_captures WHERE id=?").bind(captureId).run(),
          env.SUBMISSION_FILES.delete(storageKey),
        ]);
        return failure("The capture evidence changed before it could be committed.", 409);
      }
    } catch (error) {
      await env.SUBMISSION_FILES.delete(storageKey);
      return failure(String(error?.message || error), 409);
    }
    const row = await database.prepare("SELECT * FROM archive_web_snapshot_captures WHERE id=?").bind(captureId).first();
    const capability = await previewCapability(previewSecret, snapshotId);
    return json({ capture: presentCapture(row, { viewerOrigin: env.ARCHIVE_VIEWER_ORIGIN, token: capability.token }) }, { status: 201 });
  } finally {
    await Promise.allSettled([
      snapshotClaim ? releaseSnapshotMutation(database, snapshotId, snapshotClaim.token) : Promise.resolve(),
      candidateClaim ? releasePendingCandidate(database, candidateId, candidateClaim.token) : Promise.resolve(),
    ]);
  }
}

async function candidateCaptureApi(request, env, candidateId, viewport, action = "") {
  const database = db(env);
  const candidate = await database.prepare("SELECT snapshot_id FROM archive_web_history_candidates WHERE id=?").bind(candidateId).first();
  if (!candidate) return failure("History candidate not found.", 404);
  if (!candidate.snapshot_id) return failure("Import the candidate snapshot before attaching captures.", 409);
  return snapshotCaptureApi(request, env, candidate.snapshot_id, viewport, action, candidateId);
}

async function candidatesApi(request, env, { candidateId = "", action = "" } = {}) {
  const database = db(env);
  if (action === "review") return reviewCandidate(request, env, candidateId);
  if (action === "sync") {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    const body = await readJson(request), source = Array.isArray(body?.records) ? body.records : [];
    if (!source.length || source.length > 250) return failure("Send between one and 250 history candidates.", 409);
    const rows = [];
    try {
      for (const entry of source) rows.push(await upsertCandidate(database, await normalizeCandidate(database, entry)));
    } catch (error) { return failure(String(error?.message || error), 409); }
    const records = await presentCandidatesWithCaptures(database, rows, env.ARCHIVE_VIEWER_ORIGIN);
    return json({ records, candidates: records, count: records.length });
  }
  if (request.method === "GET") {
    if (candidateId) {
      const row = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidateId).first();
      if (!row) return failure("History candidate not found.", 404);
      const [record] = await presentCandidatesWithCaptures(database, [row], env.ARCHIVE_VIEWER_ORIGIN);
      return json({ record, candidate: record });
    }
    const url = new URL(request.url), entityId = text(url.searchParams.get("entity_id") || url.searchParams.get("entityId"), 200);
    const decision = text(url.searchParams.get("decision"), 40), conditions = [], values = [];
    if (entityId) { conditions.push("dossier_entity_id=?"); values.push(entityId); }
    if (decision) { if (!REVIEW_DECISIONS.has(decision)) return failure("Choose a valid review decision.", 409); conditions.push("decision=?"); values.push(decision); }
    const rows = (await database.prepare(`SELECT * FROM archive_web_history_candidates ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY CASE WHEN decision='pending' THEN 0 ELSE 1 END,commit_date,created_at,id`).bind(...values).all()).results || [];
    const records = await presentCandidatesWithCaptures(database, rows, env.ARCHIVE_VIEWER_ORIGIN);
    return json({ records, candidates: records, count: records.length });
  }
  if (request.method === "POST" && !candidateId) {
    const body = await readJson(request);
    if (!body) return failure("Send a JSON object.");
    try {
      const row = await upsertCandidate(database, await normalizeCandidate(database, body));
      const [record] = await presentCandidatesWithCaptures(database, [row], env.ARCHIVE_VIEWER_ORIGIN);
      return json({ record, candidate: record }, { status: 201 });
    } catch (error) { return failure(String(error?.message || error), 409); }
  }
  return failure("Method not allowed.", 405);
}

function romanNumeral(value) {
  let number = Math.max(1, Math.min(3999, Number(value) || 1)), result = "";
  for (const [amount, token] of [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]]) {
    while (number >= amount) { result += token; number -= amount; }
  }
  return result;
}

async function claimPendingCandidate(database, candidateId, claimKind) {
  if (!new Set(["review", "capture"]).has(claimKind)) throw new Error("Choose a valid history-candidate claim kind.");
  const token = id(`archive-web-${claimKind}-claim`);
  const record = await database.prepare(`UPDATE archive_web_history_candidates
    SET reviewed_by=?,updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND decision='pending' AND (
      reviewed_by='' OR (reviewed_by LIKE 'archive-web-%-claim-%' AND updated_at<datetime('now','-15 minutes'))
    ) RETURNING *`).bind(token, candidateId).first();
  return record ? { token, record } : null;
}

async function releasePendingCandidate(database, candidateId, token) {
  await database.prepare(`UPDATE archive_web_history_candidates SET reviewed_by='',updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND decision='pending' AND reviewed_by=?`).bind(candidateId, token).run();
}

const claimReviewCandidate = (database, candidateId) => claimPendingCandidate(database, candidateId, "review");
const releaseReviewCandidate = releasePendingCandidate;

async function stagedCandidateActivity(database, candidate) {
  const activityId = text(candidate.activity_id, 200);
  if (!activityId) return null;
  const activity = await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(activityId).first();
  if (!activity || activity.entity_id !== candidate.dossier_entity_id || Number(activity.public_visible)) {
    throw new Error("The candidate's staged history activity must be a private activity owned by this Archive dossier.");
  }
  const otherCandidate = await database.prepare(`SELECT id FROM archive_web_history_candidates
    WHERE activity_id=? AND id<>? LIMIT 1`).bind(activityId, candidate.id).first();
  if (otherCandidate) throw new Error("The candidate's staged history activity is already assigned to another website-history candidate.");
  return activity;
}

async function reviewCandidate(request, env, candidateId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env);
  let candidate = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidateId).first();
  if (!candidate) return failure("History candidate not found.", 404);
  const decision = text(body.decision ?? body.review_decision, 40);
  if (!REVIEW_DECISIONS.has(decision) || decision === "pending") return failure("Choose a review outcome.", 409);
  if (candidate.decision !== "pending") {
    if (candidate.decision === decision) {
      const [record] = await presentCandidatesWithCaptures(database, [candidate], env.ARCHIVE_VIEWER_ORIGIN);
      return json({ record, candidate: record, unchanged: true });
    }
    return failure("This candidate already has a curator decision.", 409);
  }
  const curatorNote = text(body.curator_note ?? body.curatorNote, 10000);
  if (!curatorNote) return failure("Record a curator note for this history decision.", 409);
  if (decision === "skipped") {
    const claim = await claimReviewCandidate(database, candidateId);
    if (!claim) return failure("This candidate is already being reviewed or has a curator decision.", 409);
    let skipSnapshotClaim = null;
    try {
      candidate = claim.record;
      if (candidate.snapshot_id) {
        skipSnapshotClaim = await claimSnapshotMutation(database, candidate.snapshot_id, "review", claim.token);
        if (!skipSnapshotClaim) {
          const linkedSnapshot = await snapshotAdminRecord(database, candidate.snapshot_id);
          if (linkedSnapshot?.mutation_token) {
            return failure("The candidate source bundle is being changed; finish that operation before recording a skip decision.", 409);
          }
        }
      }
      const skipped = await database.prepare(`UPDATE archive_web_history_candidates SET decision='skipped',curator_note=?,reviewed_by='studio',reviewed_at=datetime('now'),
        updated_by='studio',updated_at=datetime('now') WHERE id=? AND decision='pending' AND reviewed_by=?`).bind(curatorNote, candidateId, claim.token).run();
      if (Number(skipped?.meta?.changes || 0) !== 1) {
        return failure("The candidate changed before its decision could be committed.", 409);
      }
    } catch (error) {
      return failure(String(error?.message || error), 409);
    } finally {
      await Promise.allSettled([
        skipSnapshotClaim ? releaseSnapshotMutation(database, candidate.snapshot_id, skipSnapshotClaim.token) : Promise.resolve(),
        releaseReviewCandidate(database, candidateId, claim.token),
      ]);
    }
    const row = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidateId).first();
    const [record] = await presentCandidatesWithCaptures(database, [row], env.ARCHIVE_VIEWER_ORIGIN);
    return json({ record, candidate: record });
  }
  const claim = await claimReviewCandidate(database, candidateId);
  if (!claim) return failure("This candidate is already being reviewed or has a curator decision.", 409);
  let snapshotClaim = null;
  try {
  candidate = claim.record;
  if (!candidate.snapshot_id) return failure("Import and finalize this candidate's source snapshot before approving it.", 409);
  snapshotClaim = await claimSnapshotMutation(database, candidate.snapshot_id, "review", claim.token);
  if (!snapshotClaim) return failure("The candidate source bundle is being changed, or its evidence is already immutable.", 409);
  const snapshot = snapshotClaim.record;
  if (!snapshot || snapshot.dossier_entity_id !== candidate.dossier_entity_id) return failure("The candidate snapshot is unavailable or belongs to another dossier.", 409);
  if (snapshot.scan_status !== "ready" || Number(snapshot.scan_revision) !== Number(snapshot.source_revision)) return failure("Finalize a ready source snapshot before approving this candidate.", 409);
  if (snapshot.publication_state !== "draft") return failure("Return the source snapshot to draft before changing its lineage decision.", 409);

  const occurredAt = candidate.commit_date || snapshot.git_commit_date || null, datePrecision = occurredAt ? "exact" : "undated";
  const dateLabel = text(body.date_label ?? body.dateLabel, 160) || (occurredAt || "");
  const statements = [], entityId = candidate.dossier_entity_id;
  let versionId = "", stateId = "", versionNumber = 0, stateOrder = 0;
  if (decision === "approved-version") {
    const next = await database.prepare("SELECT COALESCE(MAX(version_number),0)+1 next_number FROM archive_object_versions WHERE entity_id=?").bind(entityId).first();
    versionNumber = Number(next?.next_number || 1); versionId = id("archive-version"); stateId = id("archive-state"); stateOrder = 1;
    statements.push(
      database.prepare(`INSERT INTO archive_object_versions
        (id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(
        versionId, entityId, versionNumber, text(body.version_title ?? body.versionTitle, 300) || candidate.title,
        text(body.version_description ?? body.versionDescription, 8000) || candidate.message, occurredAt, datePrecision, dateLabel, versionNumber,
      ),
      database.prepare(`INSERT INTO archive_object_states
        (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,'I',1,?,?,'',?,?,?,?, 'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(
        stateId, versionId, text(body.state_title ?? body.stateTitle, 300) || candidate.title,
        text(body.state_description ?? body.stateDescription, 8000) || candidate.message, occurredAt, datePrecision, dateLabel, 1,
      ),
    );
  } else if (decision === "approved-state") {
    versionId = text(body.version_id ?? body.versionId, 200);
    let version = versionId
      ? await database.prepare("SELECT * FROM archive_object_versions WHERE id=? AND entity_id=?").bind(versionId, entityId).first()
      : await database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=? ORDER BY version_number DESC LIMIT 1").bind(entityId).first();
    if (!version) return failure("Choose a Version from this Archive dossier.", 409);
    versionId = version.id; versionNumber = Number(version.version_number);
    const next = await database.prepare("SELECT COALESCE(MAX(state_order),0)+1 next_order FROM archive_object_states WHERE version_id=?").bind(versionId).first();
    stateOrder = Number(next?.next_order || 1); stateId = id("archive-state");
    statements.push(database.prepare(`INSERT INTO archive_object_states
      (id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'',?,?,?,?, 'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(
      stateId, versionId, romanNumeral(stateOrder), stateOrder, text(body.state_title ?? body.stateTitle, 300) || candidate.title,
      text(body.state_description ?? body.stateDescription, 8000) || candidate.message, occurredAt, datePrecision, dateLabel, stateOrder,
    ));
  } else {
    stateId = text(body.state_id ?? body.stateId ?? candidate.state_id ?? snapshot.state_id, 200);
    let state = stateId ? await database.prepare(`SELECT state.*,version.version_number,version.entity_id FROM archive_object_states state
      JOIN archive_object_versions version ON version.id=state.version_id WHERE state.id=? AND version.entity_id=?`).bind(stateId, entityId).first() : null;
    if (!state) {
      state = await database.prepare(`SELECT state.*,version.version_number,version.entity_id FROM archive_object_states state
        JOIN archive_object_versions version ON version.id=state.version_id
        WHERE version.entity_id=? AND (? IS NULL OR state.occurred_at IS NULL OR state.occurred_at<=?)
        ORDER BY CASE WHEN state.occurred_at IS NULL THEN 1 ELSE 0 END,state.occurred_at DESC,
          version.version_number DESC,state.state_order DESC LIMIT 1`).bind(entityId, occurredAt, occurredAt).first();
      if (!state) state = await database.prepare(`SELECT state.*,version.version_number,version.entity_id FROM archive_object_states state
        JOIN archive_object_versions version ON version.id=state.version_id WHERE version.entity_id=?
        ORDER BY version.version_number DESC,state.state_order DESC LIMIT 1`).bind(entityId).first();
      stateId = state?.id || "";
    }
    if (!state) return failure("Choose the nearest canonical State for this branch or restoration.", 409);
    versionId = state.version_id; versionNumber = Number(state.version_number); stateOrder = Number(state.state_order);
  }

  let materialId = snapshot.material_id || "";
  if (materialId) {
    const material = await database.prepare("SELECT state_id,state,visibility FROM archive_materials WHERE id=? AND dossier_entity_id=?").bind(materialId, entityId).first();
    if (!material || material.state_id !== stateId) return failure("The snapshot's existing Archive Material belongs to another State.", 409);
    if (material.state !== "draft" || material.visibility !== "internal") return failure("Return the snapshot's Archive Material to an internal draft before recording a history decision.", 409);
  } else {
    materialId = id("archive-material");
    const reference = await nextSnapshotMaterialReference(database, stateId);
    const materialBody = `Interactive historical website source snapshot.${snapshot.git_commit_sha ? ` Git commit: ${snapshot.git_commit_sha}.` : ""}${snapshot.tree_sha256 ? ` Source tree SHA-256: ${snapshot.tree_sha256}.` : ""}`;
    statements.push(database.prepare(`INSERT INTO archive_materials
      (id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,
       visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,NULL,'process','document',?,'',?,'website-development',?,NULL,?,?,
       'internal','draft',0,?,?,0,'studio','studio',datetime('now'),datetime('now'))`).bind(
      materialId, entityId, snapshot.title, materialBody, occurredAt, datePrecision, dateLabel, stateId, reference,
    ));
    const thread = await database.prepare(`SELECT thread_id FROM archive_origin_thread_entities WHERE entity_id=?
      ORDER BY is_primary DESC,sort_order,thread_id LIMIT 1`).bind(entityId).first();
    if (thread) statements.push(database.prepare(`INSERT OR IGNORE INTO archive_origin_thread_materials(thread_id,material_id,sort_order,created_at)
      VALUES(?,?,0,datetime('now'))`).bind(thread.thread_id, materialId));
  }
  const desktopCapture = await database.prepare(`SELECT id FROM archive_web_snapshot_captures
    WHERE candidate_id=? AND viewport='desktop'`).bind(candidateId).first();
  const screenshotUrl = desktopCapture ? captureViewerUrl(snapshot.id, desktopCapture.id, "", env.ARCHIVE_VIEWER_ORIGIN) : "";
  let stagedActivity = null;
  try { stagedActivity = await stagedCandidateActivity(database, candidate); }
  catch (error) { return failure(String(error?.message || error), 409); }
  const activityId = stagedActivity?.id || id("activity"), lineageRole = decision === "preserved-branch" ? "exploratory-branch" : decision === "merged" ? "restoration" : "canonical-state";
  if (!stagedActivity) statements.push(database.prepare(`INSERT INTO entity_activity
      (id,entity_id,activity_type,title,notes,occurred_at,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
      VALUES(?,?,'website-snapshot-review',?,?,?,0,0,'studio',datetime('now'),datetime('now'),?,?,?,?,'Git history candidate reviewed in Studio.')`).bind(
      activityId, entityId, candidate.title, curatorNote || candidate.message, occurredAt, candidate.message, curatorNote, datePrecision, dateLabel,
    ));
  statements.push(
    database.prepare(`INSERT OR IGNORE INTO entity_activity_subjects
      (activity_id,subject_entity_id,public_visible,sort_order,created_at)
      VALUES(?,?,0,1,datetime('now'))`).bind(activityId, entityId),
    database.prepare(`UPDATE archive_web_snapshots SET state_id=?,material_id=?,lineage_role=?,
      screenshot_url=CASE WHEN screenshot_url='' AND ?<>'' THEN ? ELSE screenshot_url END,
      reviewed_by='studio',reviewed_at=datetime('now'),mutation_token='',mutation_kind='',mutation_started_at=NULL,
      updated_by='studio',updated_at=datetime('now')
      WHERE id=? AND mutation_token=? AND source_revision=? AND scan_revision=source_revision`).bind(
      stateId, materialId, lineageRole, screenshotUrl, screenshotUrl, snapshot.id, snapshotClaim.token, Number(snapshot.source_revision || 0),
    ),
  );
  if (["approved-version", "approved-state"].includes(decision)) statements.push(database.prepare(`UPDATE archive_catalogue_entries
    SET current_version=?,current_state=?,variant_label='',current_state_id=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(
    versionNumber, romanNumeral(stateOrder), stateId, entityId,
  ));
  statements.push(database.prepare(`UPDATE archive_web_history_candidates SET decision=?,curator_note=?,version_id=?,state_id=?,material_id=?,activity_id=?,
    reviewed_by=CASE WHEN EXISTS(
      SELECT 1 FROM archive_web_snapshots snapshot
      WHERE snapshot.id=? AND snapshot.mutation_token='' AND snapshot.state_id=? AND snapshot.material_id=?
        AND snapshot.reviewed_by='studio' AND snapshot.scan_revision=snapshot.source_revision
    ) THEN 'studio' ELSE NULL END,
    reviewed_at=datetime('now'),updated_by='studio',updated_at=datetime('now')
    WHERE id=? AND decision='pending' AND reviewed_by=?`).bind(
    decision, curatorNote, versionId, stateId, materialId, activityId,
    snapshot.id, stateId, materialId, candidateId, claim.token,
  ));
  try { await database.batch(statements); } catch (error) { return failure(String(error?.message || error), 409); }
  const row = await database.prepare("SELECT * FROM archive_web_history_candidates WHERE id=?").bind(candidateId).first();
  const [record] = await presentCandidatesWithCaptures(database, [row], env.ARCHIVE_VIEWER_ORIGIN);
  return json({ record, candidate: record, snapshot: await snapshotAdminDetail(database, snapshot.id, env.ARCHIVE_VIEWER_ORIGIN) });
  } finally {
    await Promise.allSettled([
      snapshotClaim ? releaseSnapshotMutation(database, candidate.snapshot_id, snapshotClaim.token) : Promise.resolve(),
      releaseReviewCandidate(database, candidateId, claim.token),
    ]);
  }
}

export async function handleArchiveWebSnapshotsAdmin(request, env, path = new URL(request.url).pathname) {
  if (path === "/api/admin/archive-web/start" || path === "/api/admin/archive-web-snapshots/start") return startWebsiteArchive(request, env);
  if (path === "/api/admin/archive-web-history-candidates/sync") return candidatesApi(request, env, { action: "sync" });
  const captureMatch = path.match(/^\/api\/admin\/archive-web-history-candidates\/([^/]+)\/captures\/(desktop|mobile)(?:\/(preview))?$/);
  if (captureMatch) return candidateCaptureApi(
    request,
    env,
    decodeURIComponent(captureMatch[1]),
    captureMatch[2],
    captureMatch[3] || "",
  );
  const reviewMatch = path.match(/^\/api\/admin\/archive-web-history-candidates\/([^/]+)\/review$/);
  if (reviewMatch) return candidatesApi(request, env, { candidateId: decodeURIComponent(reviewMatch[1]), action: "review" });
  const candidateMatch = path.match(/^\/api\/admin\/archive-web-history-candidates(?:\/([^/]+))?$/);
  if (candidateMatch) return candidatesApi(request, env, { candidateId: candidateMatch[1] ? decodeURIComponent(candidateMatch[1]) : "" });
  if (path === "/api/admin/archive-web-snapshots") return request.method === "POST" ? createSnapshot(request, env) : listSnapshots(request, env);
  const replacementMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)\/dependencies\/([^/]+)\/replacement$/);
  if (replacementMatch) return mapExternalDependency(
    request,
    env,
    decodeURIComponent(replacementMatch[1]),
    decodeURIComponent(replacementMatch[2]),
  );
  const snapshotCaptureMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)\/captures\/(desktop|mobile)(?:\/(preview))?$/);
  if (snapshotCaptureMatch) return snapshotCaptureApi(
    request,
    env,
    decodeURIComponent(snapshotCaptureMatch[1]),
    snapshotCaptureMatch[2],
    snapshotCaptureMatch[3] || "",
  );
  const rawFileMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)\/files\/(.+)$/);
  if (rawFileMatch) {
    if (request.method !== "PUT") return failure("Method not allowed.", 405);
    let rawPath;
    try { rawPath = decodeURIComponent(rawFileMatch[2]); } catch { return failure("The file path is not valid URL encoding.", 409); }
    return uploadSnapshotFile(request, env, decodeURIComponent(rawFileMatch[1]), rawPath);
  }
  const actionMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)\/(files|finalize|preview)$/);
  if (actionMatch) {
    const snapshotId = decodeURIComponent(actionMatch[1]);
    if (actionMatch[2] === "files") return request.method === "POST" ? uploadSnapshotFile(request, env, snapshotId) : failure("Method not allowed.", 405);
    if (actionMatch[2] === "finalize") return finalizeSnapshot(request, env, snapshotId);
    return previewSnapshot(request, env, snapshotId);
  }
  const behaviorsMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)\/behaviors$/);
  if (behaviorsMatch) return snapshotBehaviorsApi(request, env, decodeURIComponent(behaviorsMatch[1]));
  const snapshotMatch = path.match(/^\/api\/admin\/archive-web-snapshots\/([^/]+)$/);
  if (snapshotMatch) {
    const snapshotId = decodeURIComponent(snapshotMatch[1]);
    return request.method === "GET" ? listSnapshots(request, env, snapshotId) : updateSnapshot(request, env, snapshotId);
  }
  return null;
}
