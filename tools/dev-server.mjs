import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  clientEmailPreviewCatalog,
  emailTemplateDefinition,
  renderEmailTemplateContent,
  renderClientEmailPreview,
} from "../functions/api/notifications/_email-templates.js";
import { renderEmailContent } from "../functions/api/notifications/_email-content.js";
import { defaultEmailDesignProfile, validateEmailDesignProfile } from "../functions/api/notifications/_email-design.js";
import { CLIENT_EMAIL_THEMES } from "../functions/api/notifications/_email-renderer.js";
import { shortBookingTokenFromPath } from "../functions/api/booking-links.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { writingPageSlug, renderWritingPageTemplate } from "../functions/api/_shared/writing-pages.js";
import {
  PAGE_VISIBILITY_DEFAULT_RULES,
  isPageVisibilityOperationalExemptPath,
  resolvePageVisibility,
} from "../shared/page-visibility.js";
import { contentHash, readHtmlCopy, readSourceMarker, replaceHtmlCopy, replaceSourceMarker } from "./live-editor-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const apiProxyOrigin = (process.env.SWC_API_ORIGIN || "https://thesixwellconstruct.com").replace(/\/+$/g, "");
const localArchivePreviewEnabled = process.env.SWC_LOCAL_ARCHIVE_PREVIEW === "1";
const localEmailTemplates = new Map();
const localEmailDesign = { draft: null, published: null, history: [] };

class LocalPreviewStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new LocalPreviewStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalPreviewD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new LocalPreviewStatement(this.database, sql); }
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

let localArchiveDatabasePromise;
async function localArchiveDatabase() {
  if (!localArchiveDatabasePromise) {
    localArchiveDatabasePromise = (async () => {
      const database = new DatabaseSync(":memory:");
      database.exec("PRAGMA foreign_keys=ON");
      const migrationRoot = path.join(root, "migrations");
      const migrations = (await readdir(migrationRoot)).filter((name) => name.endsWith(".sql")).sort();
      for (const migration of migrations) database.exec(await readFile(path.join(migrationRoot, migration), "utf8"));
      return new LocalPreviewD1(database);
    })();
  }
  return localArchiveDatabasePromise;
}

async function handleLocalArchivePreview(req, res) {
  if (!localArchivePreviewEnabled || !(req.url || "").startsWith("/api/archive/")) return false;
  try {
    const response = await handleConstructApi(new Request(`http://${host}:${port}${req.url || "/"}`, {
      method: req.method || "GET",
      headers: req.headers,
    }), {
      SUBMISSIONS_DB: await localArchiveDatabase(),
      PUBLIC_SITE_URL: `http://${host}:${port}`,
    });
    const headers = Object.fromEntries(response.headers.entries());
    headers["cache-control"] = "no-store";
    headers["x-swc-local-archive-preview"] = "1";
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    localEmailResponse(res, 500, { ok: false, error: "Local Archive preview failed.", detail: error.message });
  }
  return true;
}

const localDesignRepresentatives = Object.freeze({
  tattoo: { node: "tattoo", label: "Tattoo", templateKey: "booking_link_created", variant: "tattoo" },
  art: { node: "art", label: "Art", templateKey: "appointment_rescheduled", variant: "studio_visit" },
  events: { node: "events", label: "Events", templateKey: "appointment_rescheduled", variant: "studio_space" },
  studio: { node: "studio", label: "Studio", templateKey: "admin_test", variant: "construct_studio" },
});

async function requestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

function localEmailKey(templateKey, variant) { return `${templateKey}:${variant}`; }
function localEmailResponse(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-SWC-Local-Preview": "1" });
  res.end(JSON.stringify(payload));
  return true;
}

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".wav", "audio/wav"],
]);

const checkRoutes = [
  ["/", 200],
  ["/index", 200],
  ["/index/", 200],
  ["/index.html", 200],
  ["/home", 200],
  ["/home/", 200],
  ["/entry-room", 200],
  ["/entry-room/", 200],
  ["/entry-room/index.html", 200],
  ["/edit-links.html", 200],
  ["/edit-links", 200],
  ["/edit-links-mac.html", 200],
  ["/edit-links-mac", 200],
  ["/page-visibility", 200],
  ["/about/", 200],
  ["/about/identities/", 200],
  ["/about/identities/thoughtpuppet/", 200],
  ["/about/visual-language/", 200],
  ["/about/legend/open-eye/", 200],
  ["/about/breakdown/", 200],
  ["/about/founder/", 200],
  ["/about/saieldauhnsolehman/", 200],
  ["/about/mediums/", 200],
  ["/about/six-well/", 200],
  ["/about/ways-in/", 200],
  ["/currently", 200],
  ["/currently/", 200],
  ["/about/contact-press/", 200],
  ["/about/exhibitions-appearances/", 200],
  ["/about/exhibitions-appearances/made-in-public/", 200],
  ["/construct-map/", 200],
  ["/adventure/", 200],
  ["/adventure", 308],
  ["/explore/", 308],
  ["/events/", 200],
  ["/events/calendar/", 200],
  ["/calendar/", 200],
  ["/studio/calendar/", 200],
  ["/events/greenfield/", 200],
  ["/events/open-studios/", 200],
  ["/events/solehmans-new-year/", 200],
  ["/events/signal-symbol/", 200],
  ["/events/ss-and-f-live-audience/", 200],
  ["/events/confirmed/", 200],
  ["/music/", 302],
  ["/film/", 302],
  ["/writings/", 200],
  ["/archive/", 200],
  ["/archive/guide/", 200],
  ["/archive/compare/", 200],
  ["/archive/collections/", 200],
  ["/archive/origin-threads/", 200],
  ["/archive/notes/", 200],
  ["/archive/timelines/", 200],
  ["/archive/about/", 200],
  ["/archive/art/", 200],
  ["/archive/events/", 200],
  ["/archive/film/", 200],
  ["/archive/merch/", 200],
  ["/archive/music/", 200],
  ["/archive/sixwell-construct/", 200],
  ["/archive/tattoos/", 200],
  ["/archive/writings/", 200],
  ["/archive/places/", 200],
  ["/archive/places/jr-erikson-building/", 200],
  ["/archive/records/lostmarbles/", 200],
  ["/archive/notes/lost-marbles-inception-note/", 200],
  ["/archive/records/made-in-public/", 200],
  ["/archive/records/thoughtpuppet/", 200],
  ["/archive/records/thought-puppet-puppet-thoughts/", 200],
  ["/archive/timelines/thoughtpuppet/", 200],
  ["/archive/timelines/art/", 200],
  ["/tattoos/", 200],
  ["/tattoos/special-projects/", 200],
  ["/tattoos/inquire/", 200],
  ["/tattoos/inquire/custom/", 200],
  ["/tattoos/flash/claim/", 200],
  ["/tattoos/build/", 302],
  ["/tattoos/build/in-person/", 302],
  ["/tattoos/build/maze/", 200],
  ["/tattoos/special-projects/apply/", 200],
  ["/tattoos/policies/", 200],
  ["/tattoos/day-of/", 200],
  ["/tattoos/location-parking/", 200],
  ["/tattoos/aftercare/", 200],
  ["/merch/", 200],
  ["/art/", 200],
  ["/art/lostmarblespainting", 200],
  ["/art/lustpainting", 200],
  ["/art/slothpainting", 200],
  ["/art/homelandsecuritypainting", 200],
  ["/art/thefrustrationsofinnercharospainting", 200],
  ["/art/paranoiafosteredtraumapainting", 200],
  ["/art/example-managed-work/", 200],
  ["/studio/art-preview/?work=example", 200],
  ["/js/live-text-editor.js", 200],
];

const localOnlyRoutes = new Map([
  ["/edit-links", "tools/edit-links.html"],
  ["/edit-links/", "tools/edit-links.html"],
  ["/edit-links.html", "tools/edit-links.html"],
  ["/edit-links-mac", "tools/edit-links-mac.html"],
  ["/edit-links-mac/", "tools/edit-links-mac.html"],
  ["/edit-links-mac.html", "tools/edit-links-mac.html"],
  ["/page-visibility", "tools/page-visibility.html"],
  ["/page-visibility/", "tools/page-visibility.html"],
  ["/page-visibility.html", "tools/page-visibility.html"],
  ["/js/live-text-editor.js", "tools/live-text-editor.js"],
]);

const publicFrontDoorPaths = new Set(["/", "/index", "/index/", "/index.html"]);
const publicEntryRoomAliasPaths = new Set(["/entry-room", "/entry-room/", "/entry-room/index.html"]);
const publicHomePaths = new Set(["/home", "/home/", "/home/index.html"]);

function normalizeRoute(urlPath) {
  let normalized = decodeURIComponent(urlPath.split("?")[0].split("#")[0]) || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  return normalized || "/";
}

function hasFileExtension(urlPath) {
  return /\/[^/]+\.[^/]+$/.test(urlPath.split("?")[0].split("#")[0]);
}

function isLocalOnlyRoute(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  return localOnlyRoutes.has(decoded) || decoded.startsWith("/tools/");
}

function isPublicPageRoute(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const normalized = normalizeRoute(urlPath);
  return (
    publicFrontDoorPaths.has(decoded) ||
    publicEntryRoomAliasPaths.has(decoded) ||
    publicHomePaths.has(decoded) ||
    normalized === "/404" ||
    decoded.endsWith(".html") ||
    !hasFileExtension(decoded)
  );
}

function isEventDetailRoute(urlPath) {
  const normalized = normalizeRoute(urlPath);
  const parts = normalized.split("/").filter(Boolean);
  return (
    parts.length === 2 &&
    parts[0] === "events" &&
    parts[1] !== "confirmed" &&
    !hasFileExtension(requestPathname(urlPath))
  );
}

function eventDetailRouteFile(urlPath) {
  const normalized = normalizeRoute(urlPath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "events") return null;
  return path.resolve(root, "events", parts[1], "index.html");
}

function archiveDynamicRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "archive" || !["records", "timelines", "colors", "materials", "notes"].includes(parts[1])) return null;
  return path.resolve(root, "archive", parts[1], "index.html");
}

function specialProjectDetailRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "tattoos" || parts[1] !== "special-projects") return null;
  if (["apply", "healed"].includes(parts[2]) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2])) return null;
  return path.resolve(root, "tattoos", "special-projects", "index.html");
}

function legendRecordRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "legend") return null;
  if (["categories-managed-preview", "detail", "managed-preview"].includes(parts[2])) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2])) return null;
  return path.resolve(root, "about", "legend", "detail", "index.html");
}

function appearanceDetailRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "exhibitions-appearances") return null;
  if (parts[2] === "detail" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2])) return null;
  return path.resolve(root, "about", "exhibitions-appearances", "detail", "index.html");
}

function identityProfileRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "identities") return null;
  if (parts[2] === "detail" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2])) return null;
  return path.resolve(root, "about", "identities", "detail", "index.html");
}

async function isHiddenPublicRoute(urlPath) {
  const pathname = requestPathname(urlPath);
  if (!isPublicPageRoute(urlPath) || isLocalOnlyRoute(urlPath) || isPageVisibilityOperationalExemptPath(pathname)) return false;
  try {
    if (process.argv.includes("--check")) throw new Error("Use deterministic seeded visibility during route checks.");
    const endpoint = new URL("/api/site/visibility", apiProxyOrigin);
    endpoint.searchParams.set("path", pathname);
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, redirect: "manual" });
    if (response.ok) return Boolean((await response.json()).hidden);
  } catch {
    // Offline previews use the same seeded rules as the Worker fallback.
  }
  return resolvePageVisibility(pathname, PAGE_VISIBILITY_DEFAULT_RULES, false).hidden;
}

function requestPathname(urlPath) {
  return decodeURIComponent((urlPath || "/").split("?")[0].split("#")[0]) || "/";
}

function isFrontDoorRoute(pathname) {
  return publicFrontDoorPaths.has(pathname) || publicEntryRoomAliasPaths.has(pathname);
}

function isHomeRoute(pathname) {
  return publicHomePaths.has(pathname);
}

function shouldSkipCache(urlPath, ext) {
  const pathname = requestPathname(urlPath);
  return ext === ".html" || ext === ".js" || pathname.startsWith("/__tools/");
}

function safePath(urlPath) {
  const decoded = requestPathname(urlPath);
  const localOnlyFile = localOnlyRoutes.get(decoded);
  if (localOnlyFile) return path.resolve(root, localOnlyFile);

  if (shortBookingTokenFromPath(decoded)) return path.resolve(root, "booking", "index.html");

  if (isFrontDoorRoute(decoded)) return path.resolve(root, "index.html");
  if (isHomeRoute(decoded)) return path.resolve(root, "home", "index.html");
  const archiveDynamicFile = archiveDynamicRouteFile(decoded);
  if (archiveDynamicFile) return archiveDynamicFile;
  const specialProjectDetailFile = specialProjectDetailRouteFile(decoded);
  if (specialProjectDetailFile) return specialProjectDetailFile;
  const legendRecordFile = legendRecordRouteFile(decoded);
  if (legendRecordFile) return legendRecordFile;
  const appearanceDetailFile = appearanceDetailRouteFile(decoded);
  if (appearanceDetailFile) return appearanceDetailFile;
  const identityProfileFile = identityProfileRouteFile(decoded);
  if (identityProfileFile) return identityProfileFile;

  const clean = decoded === "/" ? "/index.html" : decoded;
  if (isEventDetailRoute(clean)) return eventDetailRouteFile(clean);
  const resolved = path.resolve(root, "." + clean);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function safeToolPath(pathSegments) {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) return null;
  if (!pathSegments.every((segment) => typeof segment === "string" && segment && !segment.includes("/") && segment !== "." && segment !== "..")) {
    return null;
  }
  const resolved = path.resolve(root, ...pathSegments);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function toolPathSegments(filePath) {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).filter(Boolean);
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.live-editor-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function toolJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
  return true;
}

async function liveEditorContext(body) {
  const pathname = typeof body.pathname === "string" ? body.pathname : "/";
  const pagePath = await resolveFile(pathname);
  if (!pagePath) throw Object.assign(new Error("No source file is mapped to this route."), { statusCode: 404 });
  const pageSegments = toolPathSegments(pagePath);
  if (!pageSegments) throw Object.assign(new Error("The route resolves outside the workspace."), { statusCode: 400 });
  const content = await readFile(pagePath, "utf8");
  return { page: { pathSegments: pageSegments, hash: contentHash(content) } };
}

const liveEditorHistoryRoot = path.join(root, ".codex-tmp", "live-editor-history");

function liveEditorPathname(value) {
  const pathname = String(value || "/");
  if (!pathname.startsWith("/") || pathname.length > 2048 || /[\u0000-\u001f]/.test(pathname)) {
    throw Object.assign(new Error("Invalid live-editor page path."), { statusCode: 400 });
  }
  return pathname;
}

function liveEditorRevisionId(value) {
  const id = String(value || "");
  if (!/^\d{10,}-[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error("Invalid revision ID."), { statusCode: 400 });
  return id;
}

function newLiveEditorRevisionId() {
  return `${Date.now()}-${randomUUID()}`;
}

async function readLiveEditorRevision(revisionId) {
  const id = liveEditorRevisionId(revisionId);
  try {
    return JSON.parse(await readFile(path.join(liveEditorHistoryRoot, id, "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw Object.assign(new Error("Live-editor revision not found."), { statusCode: 404 });
    throw error;
  }
}

async function liveEditorRevisionManifests(pathname = "") {
  let entries = [];
  try {
    entries = await readdir(liveEditorHistoryRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{10,}-[0-9a-f-]{36}$/i.test(entry.name)) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(liveEditorHistoryRoot, entry.name, "manifest.json"), "utf8"));
      if (!pathname || manifest.pathname === pathname) manifests.push(manifest);
    } catch {
      // An incomplete directory has no authority until its manifest is written.
    }
  }
  return manifests.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function liveEditorEditSummary(beforeSource, afterSource, edit) {
  if (edit.kind === "html") {
    return {
      kind: "html",
      copyId: edit.copyId,
      before: readHtmlCopy(beforeSource, edit.copyId),
      after: readHtmlCopy(afterSource, edit.copyId),
    };
  }
  if (edit.kind === "source-marker") {
    return {
      kind: "source-marker",
      marker: edit.marker,
      before: { text: readSourceMarker(beforeSource, edit.marker) },
      after: { text: readSourceMarker(afterSource, edit.marker) },
    };
  }
  throw Object.assign(new Error(`Unsupported live-editor target ${edit.kind || "unknown"}.`), { statusCode: 400 });
}

async function persistLiveEditorRevision({ revisionId, action, pathname, files, relatedRevisionId = "", restoreMode = "" }) {
  const id = liveEditorRevisionId(revisionId);
  const pagePathname = liveEditorPathname(pathname);
  const existing = await liveEditorRevisionManifests(pagePathname);
  const revisionNumber = existing.reduce((highest, item) => Math.max(highest, Number(item.revisionNumber) || 0), 0) + 1;
  const revisionRoot = path.join(liveEditorHistoryRoot, id);
  const manifest = {
    id,
    revisionNumber,
    createdAt: new Date().toISOString(),
    actor: "Local live editor",
    action,
    pathname: pagePathname,
    relatedRevisionId: relatedRevisionId || "",
    restoreMode: restoreMode || "",
    isOriginalBaseline: existing.length === 0,
    editCount: files.reduce((count, file) => count + file.edits.length, 0),
    files: files.map((file) => ({
      pathSegments: file.pathSegments,
      beforeHash: contentHash(file.original),
      afterHash: contentHash(file.next),
      edits: file.edits.map((edit) => liveEditorEditSummary(file.original, file.next, edit)),
    })),
  };

  try {
    for (const file of files) {
      const beforePath = path.join(revisionRoot, "before", ...file.pathSegments);
      const afterPath = path.join(revisionRoot, "after", ...file.pathSegments);
      await mkdir(path.dirname(beforePath), { recursive: true });
      await mkdir(path.dirname(afterPath), { recursive: true });
      await writeFile(beforePath, file.original, "utf8");
      await writeFile(afterPath, file.next, "utf8");
    }
    await writeFile(path.join(revisionRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    await rm(revisionRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function compactLiveEditorRevision(manifest) {
  return {
    id: manifest.id,
    revisionNumber: manifest.revisionNumber,
    createdAt: manifest.createdAt,
    actor: manifest.actor,
    action: manifest.action,
    pathname: manifest.pathname,
    relatedRevisionId: manifest.relatedRevisionId || "",
    restoreMode: manifest.restoreMode || "",
    isOriginalBaseline: Boolean(manifest.isOriginalBaseline),
    editCount: Number(manifest.editCount || 0),
    files: (manifest.files || []).map((file) => ({
      pathSegments: file.pathSegments,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      targets: (file.edits || []).map((edit) => ({ kind: edit.kind, id: edit.copyId || edit.marker || "" })),
    })),
  };
}

async function listLiveEditorHistory(body) {
  const pathname = liveEditorPathname(body.pathname);
  const revisions = await liveEditorRevisionManifests(pathname);
  return { ok: true, revisions: revisions.slice(0, 100).map(compactLiveEditorRevision) };
}

async function liveEditorHistoryDetail(body) {
  const manifest = await readLiveEditorRevision(body.revisionId);
  const pathname = liveEditorPathname(body.pathname);
  if (manifest.pathname !== pathname) throw Object.assign(new Error("That revision belongs to a different page."), { statusCode: 409 });
  return { ok: true, revision: manifest };
}

async function backupLiveEditorFiles(files, appliedHashes, metadata = {}) {
  const token = `${Date.now()}-${randomUUID()}`;
  const backupRoot = path.join(root, ".codex-tmp", "live-editor-backups", token);
  const manifest = {
    token,
    createdAt: new Date().toISOString(),
    sourceRevisionId: metadata.sourceRevisionId || "",
    pathname: metadata.pathname || "/",
    files: [],
  };
  await mkdir(backupRoot, { recursive: true });
  for (const file of files) {
    const backupPath = path.join(backupRoot, ...file.pathSegments);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, file.original, "utf8");
    manifest.files.push({ pathSegments: file.pathSegments, beforeHash: contentHash(file.original), appliedHash: appliedHashes[file.key] });
  }
  await writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return token;
}

async function commitLiveEditorFiles({ files, pathname, action, relatedRevisionId = "", restoreMode = "" }) {
  const pagePathname = liveEditorPathname(pathname);
  const revisionId = newLiveEditorRevisionId();
  const appliedHashes = Object.fromEntries(files.map((file) => [file.key, contentHash(file.next)]));
  const undoToken = await backupLiveEditorFiles(files, appliedHashes, { sourceRevisionId:revisionId, pathname:pagePathname });
  const backupRoot = path.join(root, ".codex-tmp", "live-editor-backups", undoToken);
  const written = [];
  let revision;
  try {
    for (const file of files) {
      await atomicWrite(file.filePath, file.next);
      written.push(file);
    }
    revision = await persistLiveEditorRevision({ revisionId, action, pathname:pagePathname, files, relatedRevisionId, restoreMode });
  } catch (error) {
    for (const file of written.reverse()) await atomicWrite(file.filePath, file.original).catch(() => {});
    await rm(backupRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    revision,
    undoToken,
    files: files.map((file) => ({ pathSegments:file.pathSegments, hash:appliedHashes[file.key] })),
  };
}

async function applyLiveEditorEdits(body) {
  const edits = Array.isArray(body.edits) ? body.edits : [];
  if (!edits.length || edits.length > 100) throw Object.assign(new Error("Choose between 1 and 100 edits to apply."), { statusCode: 400 });
  const grouped = new Map();

  for (const edit of edits) {
    const filePath = safeToolPath(edit.pathSegments);
    if (!filePath) throw Object.assign(new Error("An edit has an invalid source path."), { statusCode: 400 });
    const pathSegments = toolPathSegments(filePath);
    const key = pathSegments.join("/");
    if (!grouped.has(key)) grouped.set(key, { key, filePath, pathSegments, edits: [], expectedHash: String(edit.expectedHash || "") });
    const group = grouped.get(key);
    if (!group.expectedHash || group.expectedHash !== String(edit.expectedHash || "")) {
      throw Object.assign(new Error(`The edit set for ${key} does not share a valid source revision.`), { statusCode: 400 });
    }
    group.edits.push(edit);
  }

  const files = [];
  for (const group of grouped.values()) {
    const original = await readFile(group.filePath, "utf8");
    const actualHash = contentHash(original);
    if (actualHash !== group.expectedHash) {
      throw Object.assign(new Error(`${group.key} changed after editing began. Reload before applying.`), { statusCode: 409, file: group.key, expectedHash: group.expectedHash, actualHash });
    }
    let next = original;
    for (const edit of group.edits) {
      if (edit.kind === "html") next = replaceHtmlCopy(next, edit);
      else if (edit.kind === "source-marker") next = replaceSourceMarker(next, edit);
      else throw Object.assign(new Error(`Unsupported live-editor target ${edit.kind || "unknown"}.`), { statusCode: 400 });
    }
    files.push({ ...group, original, next });
  }

  const result = await commitLiveEditorFiles({ files, pathname:body.pathname, action:"apply" });
  return {
    ok: true,
    applied: edits.length,
    files: result.files,
    undoToken: result.undoToken,
    revisionId: result.revision.id,
    revisionNumber: result.revision.revisionNumber,
  };
}

function liveEditorRestoreEdit(summary, mode) {
  const state = summary[mode];
  if (!state) throw Object.assign(new Error("The selected revision does not contain that version."), { statusCode: 409 });
  if (summary.kind === "html") return { kind:"html", copyId:summary.copyId, html:state.html || "", styles:state.styles || {} };
  if (summary.kind === "source-marker") return { kind:"source-marker", marker:summary.marker, text:state.text || "" };
  throw Object.assign(new Error("The revision contains an unsupported target."), { statusCode: 409 });
}

async function restoreLiveEditorRevision(body) {
  const pathname = liveEditorPathname(body.pathname);
  const sourceRevision = await readLiveEditorRevision(body.revisionId);
  if (sourceRevision.pathname !== pathname) throw Object.assign(new Error("That revision belongs to a different page."), { statusCode: 409 });
  const mode = body.mode === "before" ? "before" : body.mode === "after" ? "after" : "";
  if (!mode) throw Object.assign(new Error("Choose the prior or saved version to restore."), { statusCode: 400 });
  const files = [];
  for (const sourceFile of sourceRevision.files || []) {
    const filePath = safeToolPath(sourceFile.pathSegments);
    if (!filePath) throw Object.assign(new Error("The revision contains an invalid source path."), { statusCode: 409 });
    const original = await readFile(filePath, "utf8");
    let next = original;
    const edits = (sourceFile.edits || []).map((summary) => liveEditorRestoreEdit(summary, mode));
    for (const edit of edits) {
      if (edit.kind === "html") next = replaceHtmlCopy(next, edit);
      else next = replaceSourceMarker(next, edit);
    }
    if (next !== original) {
      files.push({
        key: sourceFile.pathSegments.join("/"),
        filePath,
        pathSegments: sourceFile.pathSegments,
        edits,
        original,
        next,
      });
    }
  }
  if (!files.length) throw Object.assign(new Error("The source already matches that revision."), { statusCode: 409 });
  const result = await commitLiveEditorFiles({
    files,
    pathname,
    action:"restore",
    relatedRevisionId:sourceRevision.id,
    restoreMode:mode,
  });
  return {
    ok: true,
    restored: files.reduce((count, file) => count + file.edits.length, 0),
    files: result.files,
    undoToken: result.undoToken,
    revisionId: result.revision.id,
    revisionNumber: result.revision.revisionNumber,
  };
}

async function undoLiveEditorApply(body) {
  const token = String(body.undoToken || "");
  if (!/^\d{10,}-[0-9a-f-]{36}$/i.test(token)) throw Object.assign(new Error("Invalid undo token."), { statusCode: 400 });
  const backupRoot = path.join(root, ".codex-tmp", "live-editor-backups", token);
  const manifest = JSON.parse(await readFile(path.join(backupRoot, "manifest.json"), "utf8"));
  const sourceRevision = manifest.sourceRevisionId ? await readLiveEditorRevision(manifest.sourceRevisionId).catch(() => null) : null;
  const restore = [];
  for (const entry of manifest.files || []) {
    const filePath = safeToolPath(entry.pathSegments);
    if (!filePath) throw Object.assign(new Error("The undo record contains an invalid path."), { statusCode: 400 });
    const current = await readFile(filePath, "utf8");
    if (contentHash(current) !== entry.appliedHash) throw Object.assign(new Error(`${entry.pathSegments.join("/")} changed after the editor applied it. Undo was stopped.`), { statusCode: 409 });
    const original = await readFile(path.join(backupRoot, ...entry.pathSegments), "utf8");
    const sourceFile = sourceRevision?.files?.find((file) => file.pathSegments.join("/") === entry.pathSegments.join("/"));
    const edits = (sourceFile?.edits || []).map((summary) => liveEditorRestoreEdit(summary, "before"));
    restore.push({
      key: entry.pathSegments.join("/"),
      filePath,
      pathSegments:entry.pathSegments,
      original:current,
      next:original,
      applied:current,
      edits,
    });
  }
  const restored = [];
  let revision;
  try {
    for (const file of restore) {
      await atomicWrite(file.filePath, file.next);
      restored.push(file);
    }
    revision = await persistLiveEditorRevision({
      revisionId:newLiveEditorRevisionId(),
      action:"undo",
      pathname:manifest.pathname || sourceRevision?.pathname || "/",
      files:restore,
      relatedRevisionId:manifest.sourceRevisionId || "",
    });
  } catch (error) {
    for (const file of restored.reverse()) await atomicWrite(file.filePath, file.applied).catch(() => {});
    throw error;
  }
  await rm(backupRoot, { recursive: true, force: true });
  return {
    ok: true,
    restored:restore.map((file) => ({ pathSegments:file.pathSegments, hash:contentHash(file.next) })),
    revisionId:revision.id,
    revisionNumber:revision.revisionNumber,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleToolApi(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", "Allow": "POST" });
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return true;
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON." }));
    return true;
  }

  if (req.url === "/__tools/live-editor/context") {
    try {
      return toolJson(res, 200, await liveEditorContext(body));
    } catch (error) {
      return toolJson(res, error.statusCode || (error.code === "ENOENT" ? 404 : 500), { error: error.message });
    }
  }

  if (req.url === "/__tools/live-editor/apply") {
    try {
      return toolJson(res, 200, await applyLiveEditorEdits(body));
    } catch (error) {
      return toolJson(res, error.statusCode || 500, { error: error.message, file: error.file, expectedHash: error.expectedHash, actualHash: error.actualHash });
    }
  }

  if (req.url === "/__tools/live-editor/undo") {
    try {
      return toolJson(res, 200, await undoLiveEditorApply(body));
    } catch (error) {
      return toolJson(res, error.statusCode || (error.code === "ENOENT" ? 404 : 500), { error: error.message });
    }
  }

  if (req.url === "/__tools/live-editor/history") {
    try {
      return toolJson(res, 200, await listLiveEditorHistory(body));
    } catch (error) {
      return toolJson(res, error.statusCode || 500, { error:error.message });
    }
  }

  if (req.url === "/__tools/live-editor/history/detail") {
    try {
      return toolJson(res, 200, await liveEditorHistoryDetail(body));
    } catch (error) {
      return toolJson(res, error.statusCode || 500, { error:error.message });
    }
  }

  if (req.url === "/__tools/live-editor/history/restore") {
    try {
      return toolJson(res, 200, await restoreLiveEditorRevision(body));
    } catch (error) {
      return toolJson(res, error.statusCode || 500, { error:error.message });
    }
  }

  const filePath = safeToolPath(body.pathSegments);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid file path." }));
    return true;
  }

  if (req.url === "/__tools/read-file") {
    try {
      const content = await readFile(filePath, "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ content, hash: contentHash(content), pathSegments: toolPathSegments(filePath) }));
    } catch (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.code === "ENOENT" ? "Not found." : error.message }));
    }
    return true;
  }

  if (req.url === "/__tools/write-file") {
    if (typeof body.content !== "string") {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing file content." }));
      return true;
    }
    try {
      if (body.expectedHash) {
        const current = await readFile(filePath, "utf8");
        if (contentHash(current) !== body.expectedHash) {
          return toolJson(res, 409, { error: "The source file changed. Reload before writing." });
        }
      }
      if (body.createDirs) await mkdir(path.dirname(filePath), { recursive: true });
      await atomicWrite(filePath, body.content);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return true;
  }

  return false;
}

function proxyHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (["connection", "host", "content-length", "accept-encoding"].includes(lower)) continue;
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

function localDesignScopes(scope) {
  if (scope === "global") return Object.values(localDesignRepresentatives);
  return localDesignRepresentatives[scope] ? [localDesignRepresentatives[scope]] : null;
}

function renderLocalDesignRepresentative(representative, profile) {
  const copyState = localEmailTemplates.get(localEmailKey(representative.templateKey, representative.variant));
  const result = copyState?.published?.content
    ? renderEmailTemplateContent(representative.templateKey, representative.variant, copyState.published.content, profile)
    : null;
  const rendered = result?.rendered || renderClientEmailPreview(representative.templateKey, representative.variant, profile);
  return {
    ...representative,
    ...rendered,
    templateRevision: copyState?.published?.revision || 0,
    copySource: copyState?.published ? "published" : "default",
  };
}

async function handleApiProxy(req, res) {
  const localUrl = new URL(req.url || "/", `http://${host}:${port}`);
  if (localUrl.pathname === "/api/admin/notifications/design" || localUrl.pathname.startsWith("/api/admin/notifications/design/")) {
    const action = localUrl.pathname.slice("/api/admin/notifications/design".length).split("/").filter(Boolean)[0] || "";
    if (req.method === "GET" && (!action || action === "history")) {
      return localEmailResponse(res, 200, {
        version: 1,
        roles: ["canvas", "panel", "title", "supporting", "descriptor", "signatureMark"],
        nodes: [
          { node: "tattoo", label: "Tattoo", accent: CLIENT_EMAIL_THEMES.tattoo.accentBright },
          { node: "art", label: "Art", accent: CLIENT_EMAIL_THEMES.construct_art.accentBright },
          { node: "events", label: "Events", accent: CLIENT_EMAIL_THEMES.construct_event.accentBright },
          { node: "studio", label: "Studio", accent: CLIENT_EMAIL_THEMES.construct_studio.accentBright },
        ],
        defaultProfile: defaultEmailDesignProfile(),
        draft: localEmailDesign.draft,
        published: localEmailDesign.published,
        history: action === "history" ? localEmailDesign.history : undefined,
      });
    }
    const body = await requestJson(req);
    if (!body) return localEmailResponse(res, 400, { error: "Expected JSON body." });
    if (req.method === "POST" && action === "preview") {
      const validation = validateEmailDesignProfile(body.profile);
      if (!validation.ok) return localEmailResponse(res, 422, { error: "Email design profile is invalid.", errors: validation.errors });
      const scopes = localDesignScopes(String(body.scope || "global"));
      if (!scopes) return localEmailResponse(res, 422, { error: "Invalid design scope." });
      return localEmailResponse(res, 200, { previews: scopes.map((entry) => renderLocalDesignRepresentative(entry, validation.profile)) });
    }
    if (req.method === "PUT" && action === "draft") {
      const validation = validateEmailDesignProfile(body.profile);
      if (!validation.ok) return localEmailResponse(res, 422, { error: "Email design profile is invalid.", errors: validation.errors });
      const expected = localEmailDesign.draft?.revision || localEmailDesign.published?.revision || 0;
      if (Number(body.baseRevision) !== expected) return localEmailResponse(res, 409, { error: "Email design draft is stale.", expectedRevision: expected });
      const revision = localEmailDesign.draft?.revision || Math.max(0, ...localEmailDesign.history.map((item) => item.revision)) + 1;
      localEmailDesign.draft = { revision, status: "draft", profile: validation.profile, updated_at: new Date().toISOString() };
      localEmailDesign.history = [localEmailDesign.draft, ...localEmailDesign.history.filter((item) => item.revision !== revision)];
      return localEmailResponse(res, 200, { draft: localEmailDesign.draft });
    }
    if (req.method === "POST" && action === "publish") {
      if (!localEmailDesign.draft || localEmailDesign.draft.revision !== Number(body.revision)) return localEmailResponse(res, 409, { error: "Email design draft is stale." });
      if (localEmailDesign.published) localEmailDesign.history = localEmailDesign.history.map((item) => item.revision === localEmailDesign.published.revision ? { ...item, status: "retired" } : item);
      localEmailDesign.published = { ...localEmailDesign.draft, status: "published" };
      localEmailDesign.draft = null;
      localEmailDesign.history = [localEmailDesign.published, ...localEmailDesign.history.filter((item) => item.revision !== localEmailDesign.published.revision)];
      return localEmailResponse(res, 200, { published: localEmailDesign.published });
    }
    if (req.method === "POST" && action === "restore") {
      const source = localEmailDesign.history.find((item) => item.revision === Number(body.revision));
      if (!source) return localEmailResponse(res, 404, { error: "Email design revision was not found." });
      const expected = localEmailDesign.draft?.revision || localEmailDesign.published?.revision || 0;
      if (Number(body.baseRevision) !== expected) return localEmailResponse(res, 409, { error: "Email design draft is stale.", expectedRevision: expected });
      const revision = Math.max(0, ...localEmailDesign.history.map((item) => item.revision)) + 1;
      localEmailDesign.draft = { revision, status: "draft", profile: cloneStructured(source.profile), updated_at: new Date().toISOString() };
      localEmailDesign.history.unshift(localEmailDesign.draft);
      return localEmailResponse(res, 200, { draft: localEmailDesign.draft });
    }
    if (req.method === "POST" && action === "test") {
      if (!localEmailDesign.draft || localEmailDesign.draft.revision !== Number(body.revision)) return localEmailResponse(res, 409, { error: "Save the current design draft before sending a test." });
      const scopes = localDesignScopes(String(body.scope || "global"));
      if (!scopes) return localEmailResponse(res, 422, { error: "Invalid design scope." });
      return localEmailResponse(res, 200, { ok: true, mocked: true, recipient: "local-preview@example.test", deliveries: scopes.map(() => ({ ok: true, mocked: true })) });
    }
    return localEmailResponse(res, 405, { error: "Method not allowed." });
  }
  if (localUrl.pathname === "/api/admin/notifications/templates" || localUrl.pathname.startsWith("/api/admin/notifications/templates/")) {
    const parts = localUrl.pathname.slice("/api/admin/notifications/templates".length).split("/").filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return localEmailResponse(res, 200, { templates: clientEmailPreviewCatalog().map((entry) => ({ ...entry, status: localEmailTemplates.get(localEmailKey(entry.templateKey, entry.variant))?.published ? "published" : localEmailTemplates.get(localEmailKey(entry.templateKey, entry.variant))?.draft ? "draft" : "default" })) });
    const [templateKey, action] = parts;
    const variant = String(localUrl.searchParams.get("variant") || "");
    const definition = emailTemplateDefinition(templateKey, variant);
    if (!definition) return localEmailResponse(res, 404, { error: "Unsupported email template." });
    const key = localEmailKey(definition.templateKey, definition.variant);
    const state = localEmailTemplates.get(key) || { draft: null, published: null, history: [] };
    if (req.method === "GET") return localEmailResponse(res, 200, action === "history" ? { history: state.history } : { ...definition, rendered: undefined, draft: state.draft, published: state.published });
    const body = await requestJson(req);
    if (!body) return localEmailResponse(res, 400, { error: "Expected JSON body." });
    if (req.method === "PUT" && action === "draft") {
      const rendered = renderEmailTemplateContent(templateKey, variant, body.content);
      if (!rendered?.validation.ok) return localEmailResponse(res, 422, { error: "Template copy is invalid.", errors: rendered?.validation?.errors || [] });
      const expected = state.draft?.revision || state.published?.revision || 0;
      if (Number(body.baseRevision) !== expected) return localEmailResponse(res, 409, { error: "Template draft is stale.", expectedRevision: expected });
      state.draft = { revision: state.draft?.revision || expected + 1, status: "draft", content: body.content, updated_at: new Date().toISOString() };
      state.history = [state.draft, ...state.history.filter((item) => item.revision !== state.draft.revision)]; localEmailTemplates.set(key, state);
      return localEmailResponse(res, 200, { draft: state.draft });
    }
    if (req.method === "POST" && action === "publish") {
      if (!state.draft || state.draft.revision !== Number(body.revision)) return localEmailResponse(res, 409, { error: "Template draft is stale." });
      if (state.published) state.history = state.history.map((item) => item.revision === state.published.revision ? { ...item, status: "retired" } : item);
      state.published = { ...state.draft, status: "published" }; state.draft = null;
      state.history = [state.published, ...state.history.filter((item) => item.revision !== state.published.revision)]; localEmailTemplates.set(key, state);
      return localEmailResponse(res, 200, { published: state.published });
    }
    if (req.method === "POST" && action === "restore") {
      const source = state.history.find((item) => item.revision === Number(body.revision));
      if (!source) return localEmailResponse(res, 404, { error: "Template revision was not found." });
      const next = Math.max(0, ...state.history.map((item) => item.revision)) + 1;
      state.draft = { revision: next, status: "draft", content: source.content, updated_at: new Date().toISOString() }; state.history.unshift(state.draft); localEmailTemplates.set(key, state);
      return localEmailResponse(res, 200, { draft: state.draft });
    }
    if (req.method === "POST" && action === "test") return localEmailResponse(res, 200, { ok: true, mocked: true });
    return localEmailResponse(res, 405, { error: "Method not allowed." });
  }
  if (localUrl.pathname === "/api/admin/notifications/preview") {
    if (!["GET", "POST"].includes(req.method)) return localEmailResponse(res, 405, { error: "Method not allowed." });
    const catalog = clientEmailPreviewCatalog();
    const body = req.method === "POST" ? await requestJson(req) : null;
    const templateKey = String(body?.templateKey || localUrl.searchParams.get("templateKey") || "").trim();
    const requestedVariant = String(body?.variant || localUrl.searchParams.get("variant") || "").trim();
    if (!templateKey) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-SWC-Local-Preview": "1",
      });
      res.end(JSON.stringify({ templates: catalog.map((entry) => ({ ...entry, status: localEmailTemplates.get(localEmailKey(entry.templateKey, entry.variant))?.published ? "published" : localEmailTemplates.get(localEmailKey(entry.templateKey, entry.variant))?.draft ? "draft" : "default" })) }));
      return true;
    }
    const matches = catalog.filter((entry) => entry.templateKey === templateKey);
    const selected = requestedVariant
      ? matches.find((entry) => entry.variant === requestedVariant)
      : matches[0];
    const state = selected ? localEmailTemplates.get(localEmailKey(selected.templateKey, selected.variant)) : null;
    const chosenContent = body?.content || (localUrl.searchParams.get("source") === "draft" ? state?.draft?.content : state?.published?.content);
    const designProfile = localEmailDesign.published?.profile || defaultEmailDesignProfile();
    let rendered = selected ? (chosenContent ? renderEmailTemplateContent(selected.templateKey, selected.variant, chosenContent, designProfile)?.rendered : renderClientEmailPreview(selected.templateKey, selected.variant, designProfile)) : null;
    if (selected?.templateKey === "crm_relationship_followup" && body?.compose) {
      const composeDefinition = emailTemplateDefinition(selected.templateKey, selected.variant);
      const semantic = cloneStructured(composeDefinition.rendered.semantic);
      semantic.subject = String(body.compose.subject || ""); semantic.preheader = String(body.compose.preheader || ""); semantic.intro = String(body.compose.body || "").split(/\n\s*\n/); rendered = renderClientEmailPreview(selected.templateKey, selected.variant);
      rendered = state?.published?.content
        ? renderEmailContent(semantic, state.published.content, composeDefinition.options, designProfile)
        : (await import("../functions/api/notifications/_email-renderer.js")).renderClientEmail(semantic, designProfile);
    }
    if (!selected || !rendered) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-SWC-Local-Preview": "1",
      });
      res.end(JSON.stringify({ error: "Unsupported client email preview." }));
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-SWC-Local-Preview": "1",
    });
    res.end(JSON.stringify({ ...selected, ...rendered }));
    return true;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const target = `${apiProxyOrigin}${req.url || "/"}`;

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: proxyHeaders(req),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      redirect: "manual",
    });
    const headers = {};
    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding"].includes(lower)) continue;
      headers[key] = value;
    }
    headers["x-swc-api-proxy"] = apiProxyOrigin;
    res.writeHead(response.status, headers);
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
    return true;
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      error: "Local API proxy failed.",
      detail: error.message,
      origin: apiProxyOrigin,
    }));
    return true;
  }
}

function cloneStructured(value) { return JSON.parse(JSON.stringify(value)); }

async function resolveFile(urlPath) {
  const decodedPath = requestPathname(urlPath);
  const normalizedPath = normalizeRoute(decodedPath);
  const artParts = normalizedPath.split("/").filter(Boolean);
  if (artParts.length === 3 && artParts[0] === "archive" && artParts[1] === "blackboards" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artParts[2])) {
    return path.join(root, "archive", "blackboards", "index.html");
  }
  const legacyArtPages = new Set([
    "homelandsecuritypainting",
    "lostmarblespainting",
    "lustpainting",
    "paranoiafosteredtraumapainting",
    "slothpainting",
    "thefrustrationsofinnercharospainting",
  ]);
  if (
    normalizedPath === "/studio/art-preview" ||
    (
      artParts.length === 2 &&
      artParts[0] === "art" &&
      !new Set(["acquisitioninquiry", "detail", "index"]).has(artParts[1]) &&
      !legacyArtPages.has(artParts[1]) &&
      /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(artParts[1])
    )
  ) {
    return path.join(root, "art", "detail", "index.html");
  }

  let file = safePath(urlPath);
  if (!file) return null;

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
  } catch {
    const decoded = requestPathname(urlPath);
    if (!path.extname(file) && decoded.startsWith("/art/")) {
      file = `${file}.html`;
    } else if (!path.extname(file)) {
      file = path.join(file, "index.html");
    }
  }

  try {
    const info = await stat(file);
    return info.isFile() ? file : null;
  } catch {
    return null;
  }
}

const showHidden = process.argv.includes("--show-hidden");

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${host}`);
  if (requestUrl.pathname === "/explore" || requestUrl.pathname === "/explore/" || requestUrl.pathname === "/explore/index.html") {
    requestUrl.pathname = "/adventure/";
    res.writeHead(308, { "Location": `${requestUrl.pathname}${requestUrl.search}` });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/adventure" || requestUrl.pathname === "/adventure/index.html") {
    requestUrl.pathname = "/adventure/";
    res.writeHead(308, { "Location": `${requestUrl.pathname}${requestUrl.search}` });
    res.end();
    return;
  }

  if ((req.url || "").startsWith("/__tools/") && await handleToolApi(req, res)) {
    return;
  }

  if (await handleLocalArchivePreview(req, res)) {
    return;
  }

  if ((req.url || "").startsWith("/api/") && await handleApiProxy(req, res)) {
    return;
  }

  if (!showHidden && await isHiddenPublicRoute(req.url || "/")) {
    res.writeHead(302, { "Location": "/404.html" });
    res.end();
    return;
  }

  const file = await resolveFile(req.url || "/");
  const writingSlug = writingPageSlug(requestUrl.pathname);
  if (writingSlug !== null) {
    try {
      if (!writingSlug) { res.writeHead(404);res.end("Entry not found.");return; }
      if(!requestUrl.pathname.endsWith("/")){res.writeHead(301,{Location:`${requestUrl.pathname}/${requestUrl.search}`});res.end();return;}
      const response = await fetch(`${apiProxyOrigin}/api/writings/entries/${encodeURIComponent(writingSlug)}`,{headers:{accept:"application/json"}});
      if (!response.ok) { res.writeHead(response.status,{"content-type":"text/plain","cache-control":"no-store"});res.end(response.status === 404 ? "Entry not found." : "The entry could not be loaded.");return; }
      const {entry} = await response.json();
      const template = await readFile(path.join(root,"writings/mindful-darkness/wrkng/detail/index.html"),"utf8");
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
      res.end(req.method === "HEAD" ? "" : renderWritingPageTemplate(template,entry,`http://${host}:${port}`));return;
    } catch {res.writeHead(503);res.end("The entry could not be loaded.");return;}
  }
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": types.get(ext) || "application/octet-stream",
  };
  if (shouldSkipCache(req.url || "/", ext)) {
    headers["Cache-Control"] = "no-store";
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});

async function runCheck() {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  const testPort = typeof address === "object" && address ? address.port : port;
  let failed = false;

  try {
    for (const [route, expectedStatus] of checkRoutes) {
      const response = await fetch(`http://${host}:${testPort}${route}`, { redirect: "manual" });
      console.log(`${route} ${response.status}`);
      if (response.status !== expectedStatus) failed = true;
      await response.arrayBuffer();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) process.exit(1);
}

if (process.argv.includes("--check")) {
  await runCheck();
} else {
  server.listen(port, host, () => {
    console.log(`the six.well construct is running at http://${host}:${port}/`);
  });
}
