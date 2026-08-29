import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const source = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

test("Studio exposes the Website Inception workspace and keeps creation private", () => {
  const page = source("studio", "submissions", "index.html");
  const host = source("studio", "construct-manager.js");
  const manager = source("studio", "archive-web-snapshots-manager.js");

  assert.match(page, /\["web-snapshots","Website Inception"\]/);
  assert.match(page, /archive-web-snapshots\.css\?v=1/);
  assert.match(host, /"web-snapshots"/);
  assert.match(host, /archive-web-snapshots-manager\.js\?v=1/);
  assert.match(host, /mountArchiveWebSnapshots\(root\(\),api,status\)/);
  assert.match(manager, /\/api\/admin\/archive-web-snapshots/);
  assert.match(manager, /\/api\/admin\/archive-web-history-candidates/);
  assert.match(manager, /data-start-website-record/);
  assert.match(manager, /Private working boundary/);
  assert.match(manager, /source_kind: "upload"/);
  assert.match(manager, /lineage_role: form\.elements\.lineage_role\.value/);
  assert.match(manager, /First committed landing page/);
  assert.match(manager, /Puzzle \/ Entry Room introduced/);
  assert.match(manager, /Puzzle \/ Entry Room becomes the root/);
  assert.match(manager, /Interaction evolution/);
  assert.match(manager, /97aa62f[\s\S]*ring moves to 17% viewport height[\s\S]*shrinks to 62%/);
  assert.match(manager, /70037f4[\s\S]*current 26% top and 93% bottom positions/);
  assert.match(manager, /The eyes alternate; they do not blink/);
  assert.match(manager, /data-snapshot-behaviors/);
  assert.match(manager, /six-living-cultures/);
  assert.match(manager, /curator-authored/);
  for (const sectionId of ["website-lineage-markers", "website-interaction-evolution", "website-snapshots", "website-history-review"]) {
    assert.match(page, new RegExp(sectionId));
    assert.match(manager, new RegExp(sectionId));
  }
  assert.match(page, /function activateWebsiteArchiveDeepLink\(\)/);
  assert.match(page, /activeTab = "archive";[\s\S]*subView = "web-snapshots";/);
  assert.match(page, /window\.addEventListener\("hashchange", activateWebsiteArchiveDeepLink\)/);
  assert.match(manager, /scrollToRequestedWebsiteSection\(\)/);
  assert.match(manager, /window\.addEventListener\("hashchange", \(\) => scrollToRequestedWebsiteSection/);
});

test("Studio stages entry, additional, and folder files with the bounded import contract", () => {
  const manager = source("studio", "archive-web-snapshots-manager.js");

  assert.match(manager, /name="entry_file"[^>]+accept="\.html,\.htm,text\/html"/);
  assert.match(manager, /name="files" type="file" multiple/);
  assert.match(manager, /name="folder" type="file" webkitdirectory directory multiple/);
  assert.match(manager, /form\.append\("file", entry\.file, entry\.file\.name\)/);
  assert.match(manager, /form\.append\("path", entry\.path\)/);
  assert.match(manager, /MAX_FILES = 500/);
  assert.match(manager, /MAX_TOTAL_BYTES = 100 \* 1024 \* 1024/);
  assert.match(manager, /MAX_TEXT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(manager, /MAX_ASSET_BYTES = 15 \* 1024 \* 1024/);
  assert.match(manager, /MAX_AV_BYTES = 50 \* 1024 \* 1024/);
  for (const extension of ["zip", "exe", "php", "py", "wasm"]) assert.match(manager, new RegExp(`REJECTED_EXTENSIONS[^\\n]+"${extension}"`));
  assert.match(manager, /case collides with/);
  assert.match(manager, /path traversal is not allowed/);
  assert.match(manager, /\/finalize/);
});

test("dependency findings and Git candidates stay actionable curatorial gates", () => {
  const manager = source("studio", "archive-web-snapshots-manager.js");

  for (const status of ["resolved", "missing", "case-mismatch", "external-blocked", "navigation", "embedded", "unverifiable", "accepted-missing"]) {
    assert.ok(manager.includes(`"${status}"`), `${status} is represented in Studio`);
  }
  assert.match(manager, /data-resolve-dependency/);
  assert.match(manager, /data-accept-dependency/);
  assert.match(manager, /Accept historical absence/);
  assert.match(manager, /accepted_missing_dependency_ids: \[accept\.dataset\.acceptDependency\]/);
  assert.match(manager, /Public viewer approval is blocked/);
  assert.match(manager, /viewer_approved: approved/);
  for (const decision of ["approved-version", "approved-state", "preserved-branch", "merged", "skipped"]) {
    assert.ok(manager.includes(`"${decision}"`), `${decision} is available to the curator`);
  }
  assert.match(manager, /curator_note: form\.elements\.curator_note\.value\.trim\(\)/);
  const replacementFlow = manager.slice(manager.indexOf("async function mapExternalDependency"), manager.indexOf("async function issuePreview"));
  assert.match(replacementFlow, /new FormData\(\)/);
  assert.match(replacementFlow, /method: "PUT", body: form/);
  assert.match(replacementFlow, /\/replacement/);
  assert.doesNotMatch(replacementFlow, /uploadEntries/, "external replacements never enter the immutable source-file uploader");
});

test("Studio keeps captures as secondary evidence beside the inline live specimen", () => {
  const manager = source("studio", "archive-web-snapshots-manager.js");
  assert.match(manager, /\$\{CANDIDATE_ENDPOINT\}\/\$\{encodeURIComponent\(candidateId\)\}\/captures\/\$\{viewport\}\/preview/);
  assert.match(manager, /loadCandidateCapturePreviews/);
  assert.match(manager, /loadSnapshotCapturePreviews/);
  assert.match(manager, /\/captures\/\$\{viewport\}\/preview/);
  assert.match(manager, /snapshotCaptureUrls\.get\(`\$\{id\}:\$\{viewport\}`\)/);
  assert.match(manager, /Generated viewer derivative/);
  assert.match(manager, /Inline live specimen/);
  assert.match(manager, /Live source is paused/);
  assert.doesNotMatch(manager.slice(manager.indexOf("function previewMarkup"), manager.indexOf("function snapshotCaptureMarkup")), /<img/);
  assert.match(manager, /Captured evidence · generated derivatives/);
});

test("the public dossier renders only isolated approved viewer URLs from its projection", () => {
  const page = source("archive", "records", "index.html");
  const publicJs = source("js", "archive-public.js");
  const safeViewerSource = publicJs.slice(publicJs.indexOf("function safeWebViewerUrl"), publicJs.indexOf("function webSnapshotSummary"));
  const webViewerSource = publicJs.slice(publicJs.indexOf("function webSnapshotViewerMarkup"), publicJs.indexOf("function setupArchiveWebSnapshots"));

  assert.match(page, /archive-web-snapshots\.css\?v=1/);
  assert.match(publicJs, /webSnapshots: list\(first\(payload && payload\.web_snapshots/);
  assert.match(publicJs, /parsed\.hostname === "archive-viewer\.thesixwellconstruct\.com"/);
  assert.match(publicJs, /if \(localHosts\.has\(location\.hostname\)\)/);
  assert.match(publicJs, /return localHosts\.has\(parsed\.hostname\).*\["http:", "https:"\]/);
  assert.doesNotMatch(safeViewerSource, /parsed\.origin === location\.origin/);
  assert.match(publicJs, /sandbox="allow-scripts"/);
  assert.doesNotMatch(publicJs, /sandbox="[^"]*allow-same-origin/);
  assert.match(publicJs, /referrerpolicy="no-referrer"/);
  assert.match(publicJs, /data-archive-web-viewport="mobile"/);
  assert.match(publicJs, /Reset snapshot/);
  assert.match(publicJs, /Live historical page/);
  assert.match(publicJs, /Captured evidence · generated derivative/);
  assert.match(publicJs, /frame\.removeAttribute\("src"\)/, "inactive snapshots stop running in the background");
  assert.match(publicJs, /webSnapshotBehaviorMarkup/);
  assert.match(publicJs, /setupArchiveWebSnapshots\(\)/);
  assert.doesNotMatch(webViewerSource, /preview_url|previewUrl/);
});

test("the snapshot surfaces use the Archive five-pixel structural rule", () => {
  const css = source("css", "archive-web-snapshots.css");

  assert.match(css, /\.aws-workspace[\s\S]*?border: 5px solid/);
  assert.match(css, /\.archive-web-stage[\s\S]*?border: 5px solid/);
  assert.match(css, /\.archive-web-provenance[\s\S]*?border: 5px solid/);
  assert.match(css, /#website-snapshots\.archive-document-section[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.archive-web-stage[\s\S]*?height: clamp\(34rem, 72dvh, 50rem\)/);
  assert.doesNotMatch(css, /border(?:-top|-right|-bottom|-left)?:\s*1px\b/);
  assert.doesNotMatch(css, /(?:html|body)\s*(?:,|\{)/);
});
