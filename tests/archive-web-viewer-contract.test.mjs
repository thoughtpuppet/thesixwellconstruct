import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import viewer from "../workers/archive-viewer/src/index.js";
import { unrewritableJavaScriptNavigationFindings } from "../shared/archive-viewer-javascript.js";
import {
  PREVIEW_SNAPSHOT_GATE_SQL,
  PREVIEW_CAPTURE_SQL,
  PUBLIC_CAPTURE_SQL,
  PUBLIC_SNAPSHOT_GATE_SQL,
  SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL,
  SNAPSHOT_REPLACEMENT_SQL,
  blockedNavigationHtml,
  createPreviewToken,
  handleArchiveViewerRequest,
  historicalViewerShell,
  loadExternalReplacementMappings,
  normalizeSnapshotPath,
  rewriteCssForViewer,
  rewriteJavaScriptForViewer,
  rewriteSrcsetForViewer,
  rewriteViewerReference,
  verifyPreviewToken,
  viewerGuardScript,
  viewerHeaders,
} from "../workers/archive-viewer/src/lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SECRET = "viewer-contract-secret-that-is-not-a-production-secret";

class FakeStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new FakeStatement(this.database, this.sql, values); }
  async first() { return this.database.first(this.sql, this.values); }
  async all() { return this.database.all(this.sql, this.values); }
}

class FakeD1 {
  constructor({ snapshot = { id: "snapshot-1", entry_path: "index.html" }, files = new Map(), replacements = [], replacementFiles = new Map(), captures = new Map() } = {}) {
    this.snapshot = snapshot;
    this.files = files;
    this.replacements = replacements;
    this.replacementFiles = replacementFiles;
    this.captures = captures;
    this.queries = [];
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  first(sql, values) {
    this.queries.push({ sql, values });
    if (sql === PREVIEW_CAPTURE_SQL || sql === PUBLIC_CAPTURE_SQL) return this.captures.get(values[0]) || null;
    if (sql === SNAPSHOT_REPLACEMENT_SQL) return this.replacementFiles.get(values[0]) || null;
    if (sql.includes("FROM archive_web_snapshot_files")) return this.files.get(values[1]) || null;
    return values[0] === this.snapshot?.id ? this.snapshot : null;
  }
  all(sql, values) {
    this.queries.push({ sql, values });
    return { results: sql === SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL ? this.replacements : [] };
  }
}

class FakeR2 {
  constructor(objects = new Map()) { this.objects = objects; }
  async get(key) {
    const value = this.objects.get(key);
    if (value == null) return null;
    return { body: new Blob([value]).stream(), httpEtag: '"viewer-etag"', size: Buffer.byteLength(value), text: async () => value };
  }
  async head(key) {
    const value = this.objects.get(key);
    return value == null ? null : { httpEtag: '"viewer-etag"', size: Buffer.byteLength(value) };
  }
}

function runtime({ body = "<!doctype html><html><head></head><body>historical</body></html>", includeFile = true, replacements = [] } = {}) {
  const key = "archive/web-snapshots/snapshot-1/viewer/index.html";
  const files = new Map(includeFile ? [["index.html", {
    normalized_path: "index.html",
    viewer_storage_key: key,
    mime_type: "text/html; charset=utf-8",
    byte_size: Buffer.byteLength(body),
  }]] : []);
  const database = new FakeD1({ files, replacements });
  return {
    database,
    env: {
      SUBMISSIONS_DB: database,
      SUBMISSION_FILES: new FakeR2(new Map([[key, body]])),
      ARCHIVE_VIEWER_SIGNING_KEY: SECRET,
    },
  };
}

test("viewer publication gate checks every Archive layer", () => {
  for (const fragment of [
    "snapshot.scan_status='ready'",
    "snapshot.scan_revision=snapshot.source_revision",
    "snapshot.mutation_token=''",
    "snapshot.viewer_approved=1",
    "snapshot.publication_state='published'",
    "snapshot.public_visible=1",
    "dossier.state='published'",
    "dossier.public_visible=1",
    "entity.visibility='public'",
    "owner.state='published'",
    "material.state='published'",
    "material.visibility='public'",
    "object_state.publication_state='published'",
    "object_state.public_visible=1",
    "object_version.publication_state='published'",
    "object_version.public_visible=1",
  ]) assert.ok(PUBLIC_SNAPSHOT_GATE_SQL.includes(fragment), `missing gate: ${fragment}`);
  assert.match(PREVIEW_SNAPSHOT_GATE_SQL, /snapshot\.scan_status='ready'/);
  assert.match(PREVIEW_SNAPSHOT_GATE_SQL, /snapshot\.scan_revision=snapshot\.source_revision/);
  assert.match(PREVIEW_SNAPSHOT_GATE_SQL, /snapshot\.mutation_token=''/);
  assert.doesNotMatch(PREVIEW_SNAPSHOT_GATE_SQL, /publication_state='published'/);
});

test("published snapshots stream only viewer derivatives under a response sandbox", async () => {
  const { database, env } = runtime();
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/"), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes("historical"), true);
  assert.match(body, /<iframe[^>]+sandbox="allow-scripts"[^>]+srcdoc="/);
  assert.doesNotMatch(body, /allow-same-origin/);
  assert.equal(response.headers.get("x-archive-viewer-shell"), "nested-srcdoc");
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /sandbox allow-scripts/);
  assert.match(csp, /frame-src https:\/\/archive-viewer\.thesixwellconstruct\.com/);
  const frameAncestors = csp.split(";").find((directive) => directive.trim().startsWith("frame-ancestors"));
  assert.doesNotMatch(frameAncestors, /archive-viewer\.thesixwellconstruct\.com/, "a shell cannot recursively frame another viewer shell");
  assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.match(response.headers.get("content-security-policy"), /form-action 'none'/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*\b(?:blob|data):/, "generated blob/data scripts are not executable");
  assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /navigate-to/, "unsupported CSP directives must not stand in for executable navigation containment");
  assert.equal(response.headers.get("x-frame-options"), null, "cross-subdomain Archive embedding must not be blocked by X-Frame-Options");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-length"), null, "HTMLRewriter responses cannot retain the source content length");
  assert.equal(database.queries[0].sql, PUBLIC_SNAPSHOT_GATE_SQL);
  assert.equal(database.queries[1].values[1], "index.html");
});

test("path-scoped preview capability authenticates inherited asset paths without cookies", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createPreviewToken(SECRET, "snapshot-1", now + 300);
  assert.equal(await verifyPreviewToken(token, SECRET, "snapshot-1", now), true);
  assert.equal(await verifyPreviewToken(`${token}x`, SECRET, "snapshot-1", now), false);
  assert.equal(await verifyPreviewToken(await createPreviewToken(SECRET, "snapshot-1", now - 1), SECRET, "snapshot-1", now), false);

  const { database, env } = runtime();
  const response = await viewer.fetch(new Request(`https://archive-viewer.thesixwellconstruct.com/p/${token}/s/snapshot-1/index.html`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-archive-viewer-mode"), "preview");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(database.queries[0].sql, PREVIEW_SNAPSHOT_GATE_SQL);

  const queryRuntime = runtime();
  const queryResponse = await viewer.fetch(new Request(`https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/index.html?preview=${token}`), queryRuntime.env);
  assert.equal(queryResponse.headers.get("x-archive-viewer-mode"), "published", "query tokens never grant preview access");
  assert.equal(queryRuntime.database.queries[0].sql, PUBLIC_SNAPSHOT_GATE_SQL);
});

test("missing local routes become a sandboxed blocked-navigation screen with a reset", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createPreviewToken(SECRET, "snapshot-1", now + 300);
  const { env } = runtime({ includeFile: false });
  const response = await handleArchiveViewerRequest(new Request(`https://archive-viewer.thesixwellconstruct.com/p/${token}/s/snapshot-1/tattoo`), env);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.match(body, /Historical navigation blocked/);
  assert.ok(body.includes(`/p/${token}/s/snapshot-1/index.html`), "preview reset retains its capability path");
  assert.match(blockedNavigationHtml("snapshot-1", "index.html", "<external>"), /&lt;external&gt;/);

  const rootNavigation = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/tattoo"), env);
  assert.equal(rootNavigation.status, 404);
  assert.match(await rootNavigation.text(), /Historical navigation blocked/);
});

test("viewer rejects traversal and non-read methods", async () => {
  assert.equal(normalizeSnapshotPath("../secret"), null);
  assert.equal(normalizeSnapshotPath("C:\\secret"), null);
  assert.equal(normalizeSnapshotPath("assets/../secret"), null);
  assert.equal(normalizeSnapshotPath("assets/image.png"), "assets/image.png");
  const { env } = runtime();
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/index.html", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("viewer rewriting keeps local files inside public and preview route roots", () => {
  const previewBase = "/p/token/s/snapshot-1";
  assert.equal(
    rewriteViewerReference("../assets/eye.png?v=2#focus", previewBase, "css/site.css"),
    "/p/token/s/snapshot-1/assets/eye.png?v=2#focus",
  );
  assert.equal(
    rewriteViewerReference("/fonts/archive.woff2?#iefix", previewBase, "css/site.css"),
    "/p/token/s/snapshot-1/fonts/archive.woff2?#iefix",
  );
  const css = rewriteCssForViewer('@import "/css/base.css?v=1"; .eye{background:url(/assets/eye.png#crop)}', previewBase, "css/site.css");
  assert.match(css, /@import "\/p\/token\/s\/snapshot-1\/css\/base\.css\?v=1"/);
  assert.match(css, /url\(\/p\/token\/s\/snapshot-1\/assets\/eye\.png#crop\)/);
  assert.equal(
    rewriteSrcsetForViewer("data:image/png;base64,AAAA 1x, /assets/eye.png?v=2#focus 2x", previewBase, "index.html"),
    "data:image/png;base64,AAAA 1x, /p/token/s/snapshot-1/assets/eye.png?v=2#focus 2x",
  );
});

test("external asset replacements resolve exact mapped references while navigation stays blocked", async () => {
  const previewBase = "/p/token/s/snapshot-1";
  const originalImage = "https://legacy.example/assets/eye.png?v=2#focus";
  const originalFont = "//legacy.example/fonts/archive.woff2?#iefix";
  const replacements = new Map([
    [originalImage, "replacements/eye.png"],
    [originalFont, "replacements/archive.woff2"],
  ]);

  assert.equal(
    rewriteViewerReference(originalImage, previewBase, "index.html", replacements),
    "/p/token/s/snapshot-1/replacements/eye.png?v=2#focus",
  );
  assert.match(
    rewriteViewerReference(originalImage, previewBase, "index.html", replacements, false),
    /__archive_blocked_navigation__/,
    "anchor and area navigation must ignore an otherwise valid asset mapping",
  );
  assert.match(
    rewriteViewerReference("https://legacy.example/unmapped.png", previewBase, "index.html", replacements),
    /__archive_blocked_navigation__/,
  );
  assert.equal(
    rewriteSrcsetForViewer(`${originalImage} 2x`, previewBase, "index.html", replacements),
    "/p/token/s/snapshot-1/replacements/eye.png?v=2#focus 2x",
  );
  assert.match(
    rewriteCssForViewer(`@font-face{src:url('${originalFont}')}`, previewBase, "css/site.css", replacements),
    /url\('\/p\/token\/s\/snapshot-1\/replacements\/archive\.woff2\?#iefix'\)/,
  );

  const database = new FakeD1({ replacements: [
    { original_reference: originalImage, resolved_path: "__archive_replacement__/replacement-eye" },
    { original_reference: originalImage, resolved_path: "__archive_replacement__/replacement-other" },
    { original_reference: "mailto:outside@example.com", resolved_path: "__archive_replacement__/replacement-mail" },
  ] });
  const loaded = await loadExternalReplacementMappings(database, "snapshot-1", "index.html");
  assert.equal(loaded.has(originalImage), false, "conflicting replacement rows fail closed");
  assert.equal(loaded.has("mailto:outside@example.com"), false);
  assert.equal(database.queries[0].sql, SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL);
  assert.deepEqual(database.queries[0].values, ["snapshot-1", "index.html"]);
  assert.match(SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL, /dependency\.notes='local-external-replacement'/);
  assert.match(SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL, /dependency\.dependency_kind<>'navigation'/);
  assert.match(SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL, /JOIN archive_web_snapshot_replacements replacement/);
  assert.doesNotMatch(SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL, /archive_web_snapshot_files/, "replacement bytes are not immutable source-tree files");
});

test("root-relative CSS is rewritten while it is served from the viewer", async () => {
  const key = "archive/web-snapshots/snapshot-1/viewer/css/site.css";
  const css = ".eye{background:url(/assets/eye.png?v=1#crop)}";
  const database = new FakeD1({ files: new Map([["css/site.css", { normalized_path: "css/site.css", viewer_storage_key: key, mime_type: "text/css; charset=utf-8", byte_size: Buffer.byteLength(css) }]]) });
  const env = { SUBMISSIONS_DB: database, SUBMISSION_FILES: new FakeR2(new Map([[key, css]])), ARCHIVE_VIEWER_SIGNING_KEY: SECRET };
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/css/site.css"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /url\(\/s\/snapshot-1\/assets\/eye\.png\?v=1#crop\)/);
  assert.equal(response.headers.get("content-length"), null);
});

test("served CSS loads referring-file replacement mappings from D1", async () => {
  const key = "archive/web-snapshots/snapshot-1/viewer/css/site.css";
  const original = "https://legacy.example/fonts/archive.woff2?#iefix";
  const css = `@font-face{src:url('${original}')}`;
  const database = new FakeD1({
    files: new Map([["css/site.css", { normalized_path: "css/site.css", viewer_storage_key: key, mime_type: "text/css; charset=utf-8", byte_size: Buffer.byteLength(css) }]]),
    replacements: [{ original_reference: original, resolved_path: "__archive_replacement__/replacement-font" }],
  });
  const env = { SUBMISSIONS_DB: database, SUBMISSION_FILES: new FakeR2(new Map([[key, css]])), ARCHIVE_VIEWER_SIGNING_KEY: SECRET };
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/css/site.css"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /url\('\/s\/snapshot-1\/__archive_replacement__\/replacement-font\?#iefix'\)/);
  const replacementQuery = database.queries.find((query) => query.sql === SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL);
  assert.deepEqual(replacementQuery?.values, ["snapshot-1", "css/site.css"]);
});

test("served JavaScript rewrites executable navigation without changing comments or strings", async () => {
  const key = "archive/web-snapshots/snapshot-1/viewer/js/site.js";
  const source = `const note="location.assign('/text')"; // location.href='/comment'\nwindow.location.href = next;`;
  const database = new FakeD1({ files: new Map([["js/site.js", {
    normalized_path: "js/site.js", viewer_storage_key: key, mime_type: "text/javascript; charset=utf-8", byte_size: Buffer.byteLength(source),
  }]]) });
  const env = { SUBMISSIONS_DB: database, SUBMISSION_FILES: new FakeR2(new Map([[key, source]])), ARCHIVE_VIEWER_SIGNING_KEY: SECRET };
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/js/site.js"), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /__archiveViewerNavigationTarget = next/);
  assert.match(body, /"location\.assign\('\/text'\)"/);
  assert.match(body, /\/\/ location\.href='\/comment'/);
  assert.equal(response.headers.get("content-length"), null);
});

test("legacy executable JavaScript MIME types receive the same navigation rewrite", async () => {
  const key = "archive/web-snapshots/snapshot-1/viewer/js/legacy.js";
  const source = "location.assign('/legacy-navigation')";
  const database = new FakeD1({ files: new Map([["js/legacy.js", {
    normalized_path: "js/legacy.js", viewer_storage_key: key, mime_type: "text/jscript", byte_size: Buffer.byteLength(source),
  }]]) });
  const env = { SUBMISSIONS_DB: database, SUBMISSION_FILES: new FakeR2(new Map([[key, source]])), ARCHIVE_VIEWER_SIGNING_KEY: SECRET };
  const response = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/js/legacy.js"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "globalThis.__archiveViewerBlockNavigation('/legacy-navigation')");
  assert.equal(response.headers.get("content-length"), null);
});

test("active non-HTML assets can render as assets but cannot become browsing documents", async () => {
  const key = "archive/web-snapshots/snapshot-1/viewer/assets/active.svg";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>location.href='https://example.com'</script><circle r="2"/></svg>`;
  const files = new Map([["assets/active.svg", {
    normalized_path: "assets/active.svg", viewer_storage_key: key, mime_type: "image/svg+xml", byte_size: Buffer.byteLength(svg),
  }]]);
  const database = new FakeD1({ files });
  const env = { SUBMISSIONS_DB: database, SUBMISSION_FILES: new FakeR2(new Map([[key, svg]])), ARCHIVE_VIEWER_SIGNING_KEY: SECRET };
  const documentResponse = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/assets/active.svg", {
    headers: { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
  }), env);
  assert.equal(documentResponse.status, 404);
  assert.match(await documentResponse.text(), /Historical navigation blocked/);
  const headerlessResponse = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/assets/active.svg"), env);
  assert.equal(headerlessResponse.status, 404, "active documents fail closed when Fetch Metadata is absent");
  const incompleteMetadataResponse = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/assets/active.svg", {
    headers: { "sec-fetch-dest": "image" },
  }), env);
  assert.equal(incompleteMetadataResponse.status, 404, "both destination and mode must identify a safe asset request");
  const imageResponse = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/assets/active.svg", {
    headers: { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" },
  }), env);
  assert.equal(imageResponse.status, 200);
});

test("replacement derivatives and seed captures stream from private R2 only through their viewer gates", async () => {
  const replacementKey = "archive/web-snapshot-replacements/replacement-eye";
  const captureKey = "archive/web-history-captures/capture-seed";
  const database = new FakeD1({
    replacementFiles: new Map([["replacement-eye", {
      id: "replacement-eye", local_path: "external-replacements/eye.png", storage_key: replacementKey,
      mime_type: "image/png", byte_size: 12, sha256: "a".repeat(64), derivative_role: "external-resource-replacement",
    }]]),
    captures: new Map([["capture-seed", {
      storage_key: captureKey, mime_type: "image/png", byte_size: 12, sha256: "b".repeat(64),
    }]]),
  });
  const env = {
    SUBMISSIONS_DB: database,
    SUBMISSION_FILES: new FakeR2(new Map([[replacementKey, Buffer.from("replacement")], [captureKey, Buffer.from("seed-capture")]])),
    ARCHIVE_VIEWER_SIGNING_KEY: SECRET,
  };
  const replacement = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/__archive_replacement__/replacement-eye"), env);
  assert.equal(replacement.status, 200);
  assert.equal(replacement.headers.get("x-archive-derivative-role"), "external-resource-replacement");
  assert.equal(database.queries[0].sql, PUBLIC_SNAPSHOT_GATE_SQL);
  assert.equal(database.queries[1].sql, SNAPSHOT_REPLACEMENT_SQL);

  database.queries.length = 0;
  const capture = await handleArchiveViewerRequest(new Request("https://archive-viewer.thesixwellconstruct.com/s/snapshot-1/__archive_capture__/capture-seed"), env);
  assert.equal(capture.status, 200);
  assert.equal(capture.headers.get("x-archive-derivative-role"), "generated-viewer-capture");
  assert.equal(database.queries[0].sql, PUBLIC_SNAPSHOT_GATE_SQL);
  assert.equal(database.queries[1].sql, PUBLIC_CAPTURE_SQL);
  assert.match(PUBLIC_CAPTURE_SQL, /capture\.candidate_id IS NULL OR/);
  assert.match(PUBLIC_CAPTURE_SQL, /candidate\.decision IN \('approved-version','approved-state','preserved-branch','merged'\)/);

  database.queries.length = 0;
  const token = await createPreviewToken(SECRET, "snapshot-1", Math.floor(Date.now() / 1000) + 300);
  const preview = await handleArchiveViewerRequest(new Request(`https://archive-viewer.thesixwellconstruct.com/p/${token}/s/snapshot-1/__archive_capture__/capture-seed`), env);
  assert.equal(preview.status, 200);
  assert.equal(database.queries[0].sql, PREVIEW_CAPTURE_SQL, "capture review does not require the ready-only code preview gate");
});

test("the injected guard fails closed for script-driven self navigation and resets to the initial historical document", () => {
  const guard = viewerGuardScript("/s/snapshot-1");
  assert.match(guard, /window\.navigation/);
  assert.match(guard, /addEventListener\('navigate'/);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(guard, /archiveScriptNavigationBlocked/);
  assert.match(guard, /Historical navigation blocked/);
  assert.match(guard, /const initialDocument=location\.href/);
  assert.match(guard, /reset\.href=initialDocument/);
  assert.match(guard, /__archiveViewerBlockNavigation/);
  assert.match(guard, /__archiveViewerNavigationTarget/);
  assert.match(guard, /showBlocked\(raw\)/, "ordinary historical anchors use the blocked-navigation screen instead of nesting another shell");
  const historical = `// location.href = '/comment-only';\nconst note = "location.assign('/string-only')";\nconst pattern = /location\\.replace\\(/;\nwindow.location.href = next; location.assign('/assign'); document.location.replace('/replace'); history.back();`;
  const rewritten = rewriteJavaScriptForViewer(historical);
  assert.match(rewritten, /__archiveViewerNavigationTarget = next/);
  assert.match(rewritten, /__archiveViewerBlockNavigation\('\/assign'\)/);
  assert.match(rewritten, /__archiveViewerBlockNavigation\('\/replace'\)/);
  assert.match(rewritten, /__archiveViewerBlockNavigation\(\)/);
  assert.match(rewritten, /\/\/ location\.href = '\/comment-only'/);
  assert.match(rewritten, /"location\.assign\('\/string-only'\)"/);
  assert.match(rewritten, /\/location\\\.replace\\\(\//);
  assert.deepEqual(unrewritableJavaScriptNavigationFindings("const host = window.location.hostname; window.location.href = next;"), []);
  assert.ok(unrewritableJavaScriptNavigationFindings("const locationAlias = location; locationAlias.href = next;").includes("location-alias"));
  for (const [source, finding] of [
    ["location.assign.call(location, '/call')", "location-method-indirection"],
    ["const replace = location.replace.bind(location); replace('/bound')", "location-method-indirection"],
    ["let target; target = location; target.replace('/assigned')", "location-alias-assignment"],
    ["((target) => target.assign('/passed'))(location)", "location-object-escape"],
    ["let assign; ({ assign } = location); assign('/destructured')", "location-method-destructure"],
    ["Reflect.get(window, 'location').assign('/reflected')", "location-reflection"],
    ["const root = window; root.location.assign('/global-alias')", "global-object-alias"],
    ["window['loc' + 'ation'].assign('/computed-global')", "computed-global-member"],
    ["const evaluate = eval; evaluate(code)", "dynamic-code-evaluation"],
    ["const text = `${(()=>{const target=location;target.assign('/nested')})()}`", "template-expression-navigation"],
    ["const text = `${document.createElement('script')}`", "template-expression-navigation"],
    ["function go(g){g.location.href=url} go(globalThis)", "indirect-location-object"],
    ["function go(g){g['location'].assign('/computed')} go(globalThis)", "computed-navigation-capability"],
    ["function go(g){g[key].href='/dynamic-computed'} go(globalThis)", "computed-navigation-capability"],
    ["function go(g=globalThis){g.history.back()}", "indirect-history-object"],
    ["function go(...roots){roots[0].navigation.navigate('/rest')}", "indirect-navigation-object"],
    ["function go({location}){location.href='/destructured'} go(globalThis)", "navigation-capability-destructure"],
    ["const go=({history:h})=>h.back(); go(globalThis)", "navigation-capability-destructure"],
    ["function root(){return globalThis} root().location.replace('/returned')", "indirect-location-object"],
    ["function getHistory(){return globalThis.history} getHistory().back()", "navigation-object-escape"],
    ["const carrier={root:globalThis};carrier.root.location.href='/container'", "indirect-location-object"],
    ["function go(){this.location.href='/bound-this'} go.call(globalThis)", "indirect-location-object"],
    ["function go(g,k){const {[k]:l}=g;l.href=url}go(globalThis,String.fromCharCode(108,111,99,97,116,105,111,110))", "computed-property-destructure"],
    ["function go({[key]:cap}){cap.href=url}go(globalThis)", "computed-property-destructure"],
    ["function go(g,k){Reflect.get(g,k).href=url}go(globalThis,key)", "dynamic-capability-reflection"],
    ["function go(g,k){Object.getOwnPropertyDescriptor(g,k).get.call(g).href=url}go(globalThis,key)", "dynamic-capability-reflection"],
    ["function tag(value){return value}const {[key]:cap}=tag(globalThis);cap.href=url", "computed-property-destructure"],
    ["function go(value=globalThis.location){value.href='/default-location'}", "unsupported-global-capability-context"],
    ["function go(value=globalThis.history){value.back()}", "unsupported-global-capability-context"],
    ["const root=event.view;root.location.href='/ui-event-view'", "indirect-global-source"],
    ["const root=frame.contentWindow;root.location.href='/frame-window'", "indirect-global-source"],
    ["import(moduleName)", "dynamic-global-construction"],
    [String.raw`loc\u0061tion.assign('/escaped')`, "escaped-navigation-identifier"],
    ["document.createElement('script')", "dynamic-script-construction"],
    ["document.body.setAttribute('onclick', code)", "dynamic-event-handler-construction"],
    ["document.body.insertAdjacentHTML('beforeend', markup)", "dynamic-markup-construction"],
    ["eval(code)", "dynamic-code-evaluation"],
  ]) {
    assert.ok(unrewritableJavaScriptNavigationFindings(source).includes(finding), `${finding} must block viewer approval`);
    const blocked = rewriteJavaScriptForViewer(source);
    assert.match(blocked, /^globalThis\.__archiveViewerBlockNavigation\(/);
    assert.ok(!blocked.includes(source), `${finding} must not survive in a served derivative`);
  }
  assert.deepEqual(unrewritableJavaScriptNavigationFindings("document.createElement('canvas')"), [], "the inaugural canvas construction stays compatible");
  assert.deepEqual(unrewritableJavaScriptNavigationFindings("const current = condition ? window.location.href : window.history.length; const entry = window.navigation.currentEntry;"), [], "direct read-only globals remain compatible");
  assert.match(rewriteJavaScriptForViewer("navigation.traverseTo(key)"), /__archiveViewerBlockNavigation\(key\)/);
  const attackFixture = readFileSync(join(ROOT, "workers", "archive-viewer", "fixtures", "browser-attack.html"), "utf8");
  for (const expression of ["location.href =", "__archiveViewerBlockNavigation(\"/probe-location-assign\")", "location.assign.call", "location.replace.bind", "loc\\u0061tion.assign", "createElement('script')", "setAttribute('onmouseover'", "script_navigation_reset", "__ARCHIVE_UNREWRITTEN_NAVIGATION_PROBE__"]) assert.ok(attackFixture.includes(expression));
});

test("historical source is escaped into one additional sandbox boundary", () => {
  const shell = historicalViewerShell(`<script>location.href='https://outside.example/'</script><p title="quoted">archive</p>`);
  assert.match(shell, /<iframe[^>]+sandbox="allow-scripts"[^>]+srcdoc="/);
  assert.match(shell, /&lt;script&gt;location\.href=&#39;https:\/\/outside\.example\/&#39;&lt;\/script&gt;/);
  assert.match(shell, /title=&quot;quoted&quot;/);
  assert.doesNotMatch(shell, /<iframe[^>]+allow-same-origin/);
  const productionLikeLocal = viewerHeaders({
    origin: "http://127.0.0.1:8788",
    historicalShell: true,
  }).get("content-security-policy");
  assert.match(productionLikeLocal, /frame-src http:\/\/127\.0\.0\.1:8788/);
  const localAncestors = productionLikeLocal.split(";").find((directive) => directive.trim().startsWith("frame-ancestors"));
  assert.match(localAncestors, /http:\/\/127\.0\.0\.1:4173/);
  assert.match(localAncestors, /http:\/\/127\.0\.0\.1:8787/);
  assert.doesNotMatch(localAncestors, /127\.0\.0\.1:8788|localhost:\*/, "the viewer origin and wildcard loopback ports cannot recursively embed another shell");
});

test("viewer config is isolated, observable, current, and contains no secret value", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "workers", "archive-viewer", "wrangler.jsonc"), "utf8"));
  assert.equal(config.compatibility_date, "2026-08-28");
  assert.ok(config.compatibility_flags.includes("nodejs_compat"));
  assert.equal(config.observability.enabled, true);
  assert.equal(config.routes[0].pattern, "archive-viewer.thesixwellconstruct.com");
  assert.equal(config.routes[0].custom_domain, true);
  assert.equal(config.d1_databases[0].binding, "SUBMISSIONS_DB");
  assert.equal(config.r2_buckets[0].binding, "SUBMISSION_FILES");
  assert.equal(JSON.stringify(config).includes("ARCHIVE_VIEWER_SIGNING_KEY"), false);

  const entrySource = readFileSync(join(ROOT, "workers", "archive-viewer", "src", "index.js"), "utf8");
  assert.doesNotMatch(entrySource, /export\s+(?:const|function|class)\s+/, "the workerd entry module exposes only its default handler");
  const source = readFileSync(join(ROOT, "workers", "archive-viewer", "src", "lib.js"), "utf8");
  assert.match(source, /__archive_blocked_navigation__/);
  assert.match(source, /data-archive-viewer-guard/);
  assert.match(source, /hrefMayReferenceAsset/, "historical href rewriting distinguishes assets from navigation");
  assert.match(source, /\.on\("html", injectGuard\)/, "the guard precedes authored historical scripts");
  assert.match(source, /text\.replace\(rewriteJavaScriptForViewer\(scriptBuffer\), \{ html: true \}\)/, "raw script text must not HTML-escape executable operators");
  assert.match(source, /meta\[http-equiv\][\s\S]*refresh[\s\S]*remove/);
  assert.match(source, /"sandbox allow-scripts"/);
  assert.doesNotMatch(source, /allow-downloads|allow-forms|allow-popups|allow-same-origin|allow-top-navigation/);
  assert.doesNotMatch(source, /passThroughOnException|Math\.random/);
  const headers = viewerHeaders();
  assert.equal(headers.get("set-cookie"), null);
});
