import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

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
]);

const checkRoutes = [
  ["/", 200],
  ["/edit-links.html", 200],
  ["/edit-links", 200],
  ["/events/", 404],
  ["/music/", 404],
  ["/film/", 404],
  ["/writings/", 404],
  ["/archive/", 404],
  ["/tattoos/", 200],
  ["/tattoos/special-projects/", 200],
  ["/merch/", 200],
  ["/art/", 200],
  ["/js/live-text-editor.js", 200],
];

const localOnlyRoutes = new Map([
  ["/edit-links", "tools/edit-links.html"],
  ["/edit-links/", "tools/edit-links.html"],
  ["/edit-links.html", "tools/edit-links.html"],
  ["/js/live-text-editor.js", "tools/live-text-editor.js"],
]);

const hiddenPublicPaths = new Set([
  "/about",
  "/archive",
  "/events",
  "/film",
  "/music",
  "/writings",
]);

function normalizeRoute(urlPath) {
  let normalized = decodeURIComponent(urlPath.split("?")[0].split("#")[0]) || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  return normalized || "/";
}

function isHiddenPublicRoute(urlPath) {
  const normalized = normalizeRoute(urlPath);
  for (const hiddenPath of hiddenPublicPaths) {
    if (normalized === hiddenPath || normalized.startsWith(`${hiddenPath}/`)) return true;
  }
  return false;
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const localOnlyFile = localOnlyRoutes.get(decoded);
  if (localOnlyFile) return path.resolve(root, localOnlyFile);

  const clean = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(root, "." + clean);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

async function resolveFile(urlPath) {
  let file = safePath(urlPath);
  if (!file) return null;

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
  } catch {
    if (!path.extname(file)) file = path.join(file, "index.html");
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
  if (!showHidden && isHiddenPublicRoute(req.url || "/")) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(path.resolve(root, "404.html")).pipe(res);
    return;
  }

  const file = await resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": types.get(ext) || "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});

async function runCheck() {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  const testPort = typeof address === "object" && address ? address.port : port;
  let failed = false;

  try {
    for (const [route, expectedStatus] of checkRoutes) {
      const response = await fetch(`http://${host}:${testPort}${route}`);
      console.log(`${route} ${response.status}`);
      if (response.status !== expectedStatus) failed = true;
      await response.arrayBuffer();
    }
  } finally {
    server.close();
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
