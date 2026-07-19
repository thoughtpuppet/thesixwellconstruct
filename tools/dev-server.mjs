import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clientEmailPreviewCatalog,
  renderClientEmailPreview,
} from "../functions/api/notifications/_email-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const apiProxyOrigin = (process.env.SWC_API_ORIGIN || "https://thesixwellconstruct.com").replace(/\/+$/g, "");

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
  if (localUrl.pathname === "/api/admin/notifications/preview") {
    if (req.method !== "GET") {
      res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Allow": "GET",
      });
      res.end(JSON.stringify({ error: "Method not allowed." }));
      return true;
    }
    const catalog = clientEmailPreviewCatalog();
    const templateKey = String(localUrl.searchParams.get("templateKey") || "").trim();
    const requestedVariant = String(localUrl.searchParams.get("variant") || "").trim();
    if (!templateKey) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-SWC-Local-Preview": "1",
      });
      res.end(JSON.stringify({ templates: catalog }));
      return true;
    }
    const matches = catalog.filter((entry) => entry.templateKey === templateKey);
    const selected = requestedVariant
      ? matches.find((entry) => entry.variant === requestedVariant)
      : matches[0];
    const rendered = selected
      ? renderClientEmailPreview(selected.templateKey, selected.variant)
      : null;
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

async function resolveFile(urlPath) {
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
