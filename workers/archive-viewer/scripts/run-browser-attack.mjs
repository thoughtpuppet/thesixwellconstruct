#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { playwrightInvocation } from "../../../tools/archive-web-history.mjs";
import { historicalViewerShell, rewriteJavaScriptForViewer, viewerGuardScript, viewerHeaders } from "../src/lib.js";

const WORKER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES = join(WORKER_ROOT, "fixtures");
const APPROVED_PARENT_PORTS = [8787, 4173];
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outputDirectory = resolve(argument("--out", join("output", "playwright", "archive-viewer-attack")));
if (existsSync(outputDirectory)) throw new Error(`Attack output already exists: ${outputDirectory}`);
mkdirSync(outputDirectory, { recursive: true });

let origin = "";
let topOrigin = "";
let approvedParentPort = 0;
let probeOrigin = "";
let probeHits = 0;
let websocketHits = 0;
let recursionRequests = 0;
const probePaths = [];
let outer = "";
const fixtureSource = readFileSync(join(FIXTURES, "browser-attack.html"), "utf8");
const escapeAttribute = (value) => String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
let fixture = "";

const probeServer = createServer((request, response) => {
  const path = new URL(request.url || "/", probeOrigin || "http://127.0.0.1").pathname;
  probeHits += 1;
  probePaths.push(path);
  response.writeHead(204);
  response.end();
});

const topServer = createServer((request, response) => {
  const path = new URL(request.url || "/", topOrigin || `http://127.0.0.1:${approvedParentPort || APPROVED_PARENT_PORTS[0]}`).pathname;
  if (path !== "/") { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(outer);
});

async function listenOnApprovedParentPort() {
  for (const port of APPROVED_PARENT_PORTS) {
    try {
      await new Promise((resolveListen, reject) => {
        const onListening = () => { topServer.off("error", onError); resolveListen(); };
        const onError = (error) => { topServer.off("listening", onListening); reject(error); };
        topServer.once("error", onError);
        topServer.once("listening", onListening);
        topServer.listen(port, "127.0.0.1");
      });
      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`No approved local parent port is available: ${APPROVED_PARENT_PORTS.join(", ")}`);
}

const server = createServer((request, response) => {
  const path = new URL(request.url || "/", origin || "http://127.0.0.1").pathname;
  if (path.startsWith("/probe")) {
    probeHits += 1;
    probePaths.push(path);
    response.writeHead(204); response.end(); return;
  }
  let body;
  let mime = "text/html; charset=utf-8";
  let isolated = false;
  if (path === "/") body = outer;
  else if (path === "/s/attack/browser-attack.html") { body = historicalViewerShell(fixture); isolated = true; }
  else if (path === "/s/attack/same-origin-recursion.html") {
    recursionRequests += 1;
    body = historicalViewerShell(`<!doctype html><script>top.postMessage({type:'archive-viewer-recursion-attempt'},'*');setTimeout(()=>{location.href=${JSON.stringify(`${origin}/s/attack/same-origin-recursion.html`)}},0)</script>`);
    isolated = true;
  }
  else if (path === "/s/attack/browser-attack-local.js") { body = rewriteJavaScriptForViewer(readFileSync(join(FIXTURES, "browser-attack-local.js"), "utf8")); mime = "text/javascript; charset=utf-8"; }
  else if (path === "/s/attack/browser-attack-asset.svg") { body = readFileSync(join(FIXTURES, "browser-attack-asset.svg")); mime = "image/svg+xml"; }
  else { response.writeHead(404); response.end("Historical navigation blocked"); return; }
  const headers = isolated
    ? viewerHeaders({ origin, mimeType: mime, historicalShell: true })
    : new Headers({ "content-type": mime, "cache-control": "no-store" });
  response.writeHead(200, Object.fromEntries(headers));
  response.end(body);
});
server.on("upgrade", (request, socket) => { websocketHits += 1; socket.destroy(); });
approvedParentPort = await listenOnApprovedParentPort();
await new Promise((resolveListen, reject) => { probeServer.once("error", reject); probeServer.listen(0, "127.0.0.1", resolveListen); });
probeOrigin = `http://127.0.0.1:${probeServer.address().port}`;
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
origin = `http://127.0.0.1:${server.address().port}`;
topOrigin = `http://127.0.0.1:${approvedParentPort}`;
outer = `<!doctype html><title>Archive viewer attack harness</title><iframe title="attack fixture" sandbox="allow-scripts" src="${origin}/s/attack/browser-attack.html"></iframe><iframe title="same-origin recursion fixture" sandbox="allow-scripts" src="${origin}/s/attack/same-origin-recursion.html"></iframe><pre id="result">pending</pre><script>addEventListener('message',(event)=>{if(event.data&&event.data.type==='archive-viewer-attack-result')document.querySelector('#result').textContent=JSON.stringify(event.data.results);if(event.data&&event.data.type==='archive-viewer-recursion-attempt')document.documentElement.dataset.recursionAttempted='true'})</script>`;
fixture = fixtureSource
  .replace(/<meta\s+http-equiv=["']refresh["'][^>]*>/i, "")
  .replace("https://example.com/archive-viewer-navigation-probe", "/s/attack/__archive_blocked_navigation__?target=external")
  .replace(/\b(on[a-z0-9:_-]+)="([^"]*)"/gi, (_whole, name, source) => `${name}="${escapeAttribute(rewriteJavaScriptForViewer(source))}"`)
  .replace(/(<script\b(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, source, close) => {
    if (/\bdata-archive-attack-controller\b/i.test(open)) return whole;
    return `${open}${rewriteJavaScriptForViewer(source)}${close}`;
  })
  .replace("<head>", `<head>${viewerGuardScript("/s/attack")}`)
  .replace("__ARCHIVE_UNREWRITTEN_NAVIGATION_PROBE__()", `((globalObject,propertyName,target)=>{const {[propertyName]:capability}=globalObject;capability.href=target})(globalThis,String.fromCharCode(108,111,99,97,116,105,111,110),${JSON.stringify(`${probeOrigin}/probe-nested-srcdoc-navigation`)})`);

const session = `archive-viewer-attack-${Date.now()}`;
let resultOutput = "";
try {
  await playwrightInvocation([`-s=${session}`, "open", topOrigin], outputDirectory);
  await playwrightInvocation([`-s=${session}`, "run-code", "async (page) => { await page.waitForTimeout(1500); }"], outputDirectory);
  resultOutput = (await playwrightInvocation([`-s=${session}`, "eval", "document.querySelector('#result').textContent"], outputDirectory)).stdout;
  await playwrightInvocation([`-s=${session}`, "screenshot", `--filename=${join(outputDirectory, "attack-harness.png")}`], outputDirectory);
} finally {
  try { await playwrightInvocation([`-s=${session}`, "close"], outputDirectory); } catch {}
  await new Promise((resolveClose) => topServer.close(resolveClose));
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveClose) => probeServer.close(resolveClose));
}

const match = /### Result\s*\r?\n([^\r\n]+)/.exec(resultOutput);
if (!match) throw new Error(`Playwright did not return the attack result: ${resultOutput.trim()}`);
const serializedResult = JSON.parse(match[1]);
const browser = JSON.parse(serializedResult);
browser.nested_srcdoc_cross_origin_navigation_blocked = !probePaths.includes("/probe-nested-srcdoc-navigation");
browser.nested_srcdoc_same_origin_recursion_attempted = recursionRequests >= 2;
browser.nested_srcdoc_same_origin_recursion_blocked = recursionRequests === 2;
writeFileSync(join(outputDirectory, "attack-browser-result.json"), `${JSON.stringify(browser, null, 2)}\n`, "utf8");
for (const key of ["local_script", "local_asset", "meta_refresh_removed", "external_navigation_rewritten", "parent_access_blocked", "storage_blocked", "popup_blocked", "fetch_blocked", "xhr_blocked", "websocket_blocked", "worker_blocked", "service_worker_blocked", "script_location_href_blocked", "script_location_assign_blocked", "script_location_replace_blocked", "external_script_navigation_blocked", "inline_handler_navigation_blocked", "inline_call_navigation_blocked", "inline_bind_navigation_blocked", "inline_passed_location_navigation_blocked", "inline_reflected_navigation_blocked", "inline_global_alias_navigation_blocked", "inline_carrier_function_navigation_blocked", "inline_escaped_navigation_blocked", "dynamic_script_navigation_blocked", "dynamic_handler_navigation_blocked", "script_navigation_reset", "nested_srcdoc_cross_origin_navigation_attempted", "nested_srcdoc_cross_origin_navigation_blocked", "nested_srcdoc_same_origin_recursion_attempted", "nested_srcdoc_same_origin_recursion_blocked"]) {
  assert.equal(browser[key], true, `${key} did not satisfy the isolated-viewer contract`);
}
assert.deepEqual(probePaths, [], `beacon, form, popup, worker, service-worker, download, fetch, XHR, and scripted navigation probes must not reach the server; reached ${probePaths.join(", ")}`);
assert.equal(websocketHits, 0, "WebSocket probe must not reach an upgrade request");
assert.equal(recursionRequests, 2, `same-origin inner navigation must receive one frame-ancestors-blocked shell response and never instantiate a third shell; saw ${recursionRequests} requests`);
const report = { passed: true, browser, server: { approved_parent_port: approvedParentPort, probe_hits: probeHits, probe_paths: probePaths, websocket_hits: websocketHits, same_origin_recursion_requests: recursionRequests }, screenshot: join(outputDirectory, "attack-harness.png") };
writeFileSync(join(outputDirectory, "attack-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
