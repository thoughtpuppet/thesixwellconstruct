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
  "/",
  "/edit-links.html",
  "/events/",
  "/music/",
  "/film/",
  "/writings/",
  "/archive/",
  "/tattoos/",
  "/merch/",
  "/art/",
  "/js/live-text-editor.js",
];

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
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

const server = createServer(async (req, res) => {
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
    for (const route of checkRoutes) {
      const response = await fetch(`http://${host}:${testPort}${route}`);
      console.log(`${route} ${response.status}`);
      if (response.status !== 200) failed = true;
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
