import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clientEmailPreviewCatalog,
  emailTemplateDefinition,
  renderEmailTemplateContent,
  renderClientEmailPreview,
} from "../functions/api/notifications/_email-templates.js";
import { renderEmailContent } from "../functions/api/notifications/_email-content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const apiProxyOrigin = (process.env.SWC_API_ORIGIN || "https://thesixwellconstruct.com").replace(/\/+$/g, "");
const localEmailTemplates = new Map();

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
  ["/about/visual-language/", 200],
  ["/about/legend/open-eye/", 200],
  ["/about/breakdown/", 200],
  ["/about/founder/", 200],
  ["/about/mediums/", 200],
  ["/about/six-well/", 200],
  ["/about/ways-in/", 200],
  ["/about/current-state/", 200],
  ["/about/contact-press/", 200],
  ["/construct-map/", 200],
  ["/events/", 200],
  ["/events/calendar/", 200],
  ["/events/cultandshift/", 200],
  ["/events/open-studios/", 200],
  ["/events/solehmans-new-year/", 200],
  ["/events/signal-symbol/", 200],
  ["/events/ss-and-f-live-audience/", 200],
  ["/events/confirmed/", 200],
  ["/music/", 302],
  ["/film/", 302],
  ["/writings/", 302],
  ["/archive/", 200],
  ["/archive/guide/", 200],
  ["/archive/compare/", 200],
  ["/archive/collections/", 200],
  ["/archive/about/", 200],
  ["/archive/art/", 200],
  ["/archive/events/", 200],
  ["/archive/film/", 200],
  ["/archive/merch/", 200],
  ["/archive/music/", 200],
  ["/archive/sixwell-construct/", 200],
  ["/archive/tattoos/", 200],
  ["/archive/writings/", 200],
  ["/archive/records/lostmarbles/", 200],
  ["/archive/timelines/art/", 200],
  ["/tattoos/", 200],
  ["/tattoos/special-projects/", 200],
  ["/tattoos/inquire/", 200],
  ["/tattoos/inquire/custom/", 200],
  ["/tattoos/flash/claim/", 200],
  ["/tattoos/build/", 200],
  ["/tattoos/special-projects/apply/", 200],
  ["/tattoos/policies/", 200],
  ["/tattoos/day-of/", 200],
  ["/tattoos/location-parking/", 200],
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

const hiddenPublicPaths = new Set([
  "/film",
  "/music",
  "/writings",
]);
const hidePublicPagesExceptHome = false;
const publicFrontDoorPaths = new Set(["/", "/index", "/index/", "/index.html"]);
const publicEntryRoomAliasPaths = new Set(["/entry-room", "/entry-room/", "/entry-room/index.html"]);
const publicHomePaths = new Set(["/home", "/home/", "/home/index.html"]);
const publicErrorPaths = new Set(["/404", "/404.html"]);
const publicArchivePaths = new Set([
  "/archive",
  "/archive/",
  "/archive/index.html",
  "/archive/guide",
  "/archive/guide/",
  "/archive/guide/index.html",
  "/archive/compare",
  "/archive/compare/",
  "/archive/compare/index.html",
  "/archive/collections",
  "/archive/collections/",
  "/archive/collections/index.html",
  "/archive/about",
  "/archive/about/",
  "/archive/about/index.html",
  "/archive/art",
  "/archive/art/",
  "/archive/art/index.html",
  "/archive/events",
  "/archive/events/",
  "/archive/events/index.html",
  "/archive/film",
  "/archive/film/",
  "/archive/film/index.html",
  "/archive/merch",
  "/archive/merch/",
  "/archive/merch/index.html",
  "/archive/music",
  "/archive/music/",
  "/archive/music/index.html",
  "/archive/sixwell-construct",
  "/archive/sixwell-construct/",
  "/archive/sixwell-construct/index.html",
  "/archive/tattoos",
  "/archive/tattoos/",
  "/archive/tattoos/index.html",
  "/archive/writings",
  "/archive/writings/",
  "/archive/writings/index.html",
]);
const publicConstructMapPaths = new Set(["/construct-map", "/construct-map/", "/construct-map/index.html"]);

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
  if (parts.length !== 3 || parts[0] !== "archive" || !["records", "timelines"].includes(parts[1])) return null;
  return path.resolve(root, "archive", parts[1], "index.html");
}

function legendRecordRouteFile(urlPath) {
  const parts = normalizeRoute(urlPath).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "legend") return null;
  if (["categories-managed-preview", "detail", "managed-preview"].includes(parts[2])) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2])) return null;
  return path.resolve(root, "about", "legend", "detail", "index.html");
}

function isHiddenByHomeOnlyMode(urlPath) {
  if (!hidePublicPagesExceptHome) return false;
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const normalized = normalizeRoute(urlPath);
  if (publicFrontDoorPaths.has(decoded)) return false;
  if (publicEntryRoomAliasPaths.has(decoded)) return false;
  if (publicHomePaths.has(decoded)) return false;
  if (publicErrorPaths.has(decoded) || publicErrorPaths.has(normalized)) return false;
  if (publicArchivePaths.has(decoded) || normalized === "/archive") return false;
  if (normalized.startsWith("/archive/records/") || normalized.startsWith("/archive/timelines/")) return false;
  if (publicConstructMapPaths.has(decoded) || normalized === "/construct-map") return false;
  if (decoded.startsWith("/api/")) return false;
  if (isLocalOnlyRoute(urlPath)) return false;
  return isPublicPageRoute(urlPath);
}

function isHiddenPublicRoute(urlPath) {
  if (isHiddenByHomeOnlyMode(urlPath)) return true;
  const normalized = normalizeRoute(urlPath);
  for (const hiddenPath of hiddenPublicPaths) {
    if (normalized === hiddenPath || normalized.startsWith(`${hiddenPath}/`)) return true;
  }
  return false;
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

  if (isFrontDoorRoute(decoded)) return path.resolve(root, "index.html");
  if (isHomeRoute(decoded)) return path.resolve(root, "home", "index.html");
  const archiveDynamicFile = archiveDynamicRouteFile(decoded);
  if (archiveDynamicFile) return archiveDynamicFile;
  const legendRecordFile = legendRecordRouteFile(decoded);
  if (legendRecordFile) return legendRecordFile;

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
  return resolved.startsWith(root) ? resolved : null;
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
      res.end(JSON.stringify({ content }));
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
      if (body.createDirs) await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body.content, "utf8");
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

async function handleApiProxy(req, res) {
  const localUrl = new URL(req.url || "/", `http://${host}:${port}`);
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
    let rendered = selected ? (chosenContent ? renderEmailTemplateContent(selected.templateKey, selected.variant, chosenContent)?.rendered : renderClientEmailPreview(selected.templateKey, selected.variant)) : null;
    if (selected?.templateKey === "crm_relationship_followup" && body?.compose) {
      const composeDefinition = emailTemplateDefinition(selected.templateKey, selected.variant);
      const semantic = cloneStructured(composeDefinition.rendered.semantic);
      semantic.subject = String(body.compose.subject || ""); semantic.preheader = String(body.compose.preheader || ""); semantic.intro = String(body.compose.body || "").split(/\n\s*\n/); rendered = renderClientEmailPreview(selected.templateKey, selected.variant);
      rendered = state?.published?.content
        ? renderEmailContent(semantic, state.published.content, composeDefinition.options)
        : (await import("../functions/api/notifications/_email-renderer.js")).renderClientEmail(semantic);
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
  if ((req.url || "").startsWith("/__tools/") && await handleToolApi(req, res)) {
    return;
  }

  if ((req.url || "").startsWith("/api/") && await handleApiProxy(req, res)) {
    return;
  }

  if (!showHidden && isHiddenPublicRoute(req.url || "/")) {
    res.writeHead(302, { "Location": "/404.html" });
    res.end();
    return;
  }

  const file = await resolveFile(req.url || "/");
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
