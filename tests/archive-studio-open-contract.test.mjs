import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");

test("Studio inline scripts remain valid JavaScript", () => {
  const inlineScripts = [...studio.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length, "expected at least one inline Studio script");
  for (const [, script] of inlineScripts) assert.doesNotThrow(() => new Function(script));
});

test("Archive record actions preserve existing Portfolio controls and use canonical item IDs", () => {
  assert.match(studio, /data-portfolio-open="\$\{escapeHtml\(item\.id\)\}">Open<\/button>[\s\S]*?data-open-archive-record="\$\{escapeHtml\(item\.id\)\}">Open Archive Record<\/button>/);
  assert.match(studio, /group\.itemId \? `<div class="portfolio-batch-actions"><button class="button" type="button" data-open-archive-record="\$\{escapeHtml\(group\.itemId\)\}">Open Archive Record<\/button><\/div>`/);
  assert.match(studio, /\.portfolio-batch-actions \{ display:flex; gap:8px; flex-wrap:wrap; \}/);
  assert.match(studio, /data-portfolio-connections[\s\S]*?data-portfolio-delete/);
  assert.match(studio, /data-portfolio-back>← Back to Portfolio<\/button>/);
  assert.match(studio, /data-event-form="\$\{escapeHtml\(ev\.slug\)\}"[\s\S]*?data-open-archive-record="\$\{escapeHtml\(ev\.id\)\}">Open Archive Record<\/button>/);
  assert.match(studio, /data-copy-public-link=[\s\S]*?data-open-archive-record="\$\{escapeHtml\(ev\.id\)\}">Open Archive Record<\/button>/);
  assert.match(studio, /state === "promoted"[\s\S]*?data-open-archive-record="\$\{escapeHtml\(archive\.archiveEntityId\)\}">Open Archive Record<\/button>[\s\S]*?data-maze-archive-action="withdraw"/);
});

test("the Studio host ensures and opens the editable dossier through a durable direct URL", () => {
  assert.match(studio, /window\.openArchiveRecord = openArchiveRecord;/);
  assert.match(studio, /window\.StudioArchiveHost = \{ openArchiveRecord, showAllDossiers \};/);
  assert.match(studio, /api\(`\/api\/admin\/entities\/\$\{encodeURIComponent\(canonicalId\)\}\/archive-dossier`, \{ method: "POST" \}\)/);
  assert.match(studio, /await window\.ConstructManager\.openArchiveDossier\(canonicalId\)/);
  assert.match(studio, /url\.searchParams\.set\("archive", entityId\)/);
  assert.match(studio, /url\.searchParams\.delete\("archive"\)/);
  assert.match(studio, /window\.history\.replaceState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), studioView: sourceView \}/);
  assert.match(studio, /window\.history\.pushState\(\{ archiveEntityId: canonicalId \}/);
  assert.match(studio, /historyMode === "push" && archiveEntityIdFromLocation\(\) === canonicalId[\s\S]*?historyMode = "replace"/);
  assert.match(studio, /const openGeneration = \+\+archiveOpenGeneration[\s\S]*?openGeneration !== archiveOpenGeneration/);
  assert.match(studio, /archiveEntityIdFromLocation\(\) !== canonicalId/);
});

test("direct links survive authentication and browser history restores the source view", () => {
  assert.match(studio, /async function loadAndRender\(\)[\s\S]*?archiveEntityIdFromLocation\(\)[\s\S]*?openArchiveRecord\(archiveEntityId, \{ historyMode: "replace" \}\)/);
  assert.match(studio, /window\.addEventListener\("popstate"[\s\S]*?openArchiveRecord\(archiveEntityId, \{ historyMode: "none" \}\)[\s\S]*?restoreStudioViewHistoryState\(event\.state\?\.studioView\)/);
  assert.match(studio, /restoreStudioViewHistoryState[\s\S]*?cancelArchiveOpenNavigation/);
  assert.match(studio, /showAllDossiers[\s\S]*?cancelArchiveOpenNavigation/);
  assert.match(studio, /data-archive-all-dossiers>All dossiers<\/button>/);
  assert.match(studio, /renderArchiveOpenError\(canonicalId, error\)/);
  assert.match(studio, /if \(error\?\.status === 401 \|\| error\?\.status === 403\) throw error/);
  assert.match(studio, /construct-manager\.js\?v=20260829-publication-invariant/);
});
