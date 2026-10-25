// Read-only local preview. It never proxies API calls to the production site.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 4196);
const mime = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".mjs":"text/javascript", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".json":"application/json" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (!['GET','HEAD'].includes(req.method) || url.pathname.startsWith('/api/')) {
    const invalidPrivateLink = req.method === 'GET' && url.pathname === '/api/booking/context';
    res.writeHead(invalidPrivateLink ? 404 : 503, { "content-type":"application/json", "cache-control":"no-store" });
    res.end(JSON.stringify({ error:invalidPrivateLink
      ? "This booking link is invalid or no longer active. Local preview uses no private client data."
      : "Local review only. Live availability and submissions are disabled; no appointment or inquiry was created." }));
    return;
  }
  try {
    const route = /^\/b\/[A-Za-z0-9_-]{12}\/?$/.test(url.pathname) ? "/booking/index.html" : decodeURIComponent(url.pathname);
    let path = resolve(root, '.' + route);
    if (!path.startsWith(root + sep)) throw new Error('Outside preview root');
    // Never serve private tooling, databases, credentials, or source API modules.
    if (route.split('/').some((part) => part.startsWith('.')) || /\/(?:functions|migrations|tests)\//.test(route) || /\.(?:sqlite|toml|log)$/.test(route)) throw new Error('Private source');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const bytes = await readFile(path);
    res.writeHead(200, { "content-type":`${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8`, "cache-control":"no-store" });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404, { "content-type":"text/plain" }); res.end('Not found in the local review preview.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Read-only booking review: http://localhost:${port}/booking/`));
