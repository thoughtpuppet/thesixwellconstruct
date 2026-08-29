import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const source = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

test("eligible construct records expose the idempotent editable Archive action", () => {
  const manager = source("studio", "construct-manager.js");

  assert.equal([...manager.matchAll(/archiveEligible:true/g)].length, 5);
  for (const endpoint of ["flash", "tattoo-designs", "legend", "art", "appearances"]) {
    assert.match(manager, new RegExp(`${endpoint.replace("-", "\\-")}[^\\n]+archiveEligible:true|archiveEligible:true[^\\n]+${endpoint.replace("-", "\\-")}`));
  }
  assert.match(manager, /data-open-archive-record="\$\{esc\(record\.id\)\}">Open Archive Record<\/button>/);
  assert.match(manager, /function showFlashBulkArchiveAction[\s\S]*?button\.textContent="Open Archive Record"/);
  assert.match(manager, /ensureDossier:entityId=>`\/api\/admin\/entities\/\$\{encodeURIComponent\(entityId\)\}\/archive-dossier`/);
  assert.match(manager, /async function ensureArchiveDossier[\s\S]*?method:"POST"/);
  assert.match(manager, /await ensureArchiveDossier\(entityId\);/);
  assert.doesNotMatch(manager, /archive_slug:record\.slug\|\|entityId/);
});

test("construct Archive opening delegates to Studio history and keeps a direct fallback", () => {
  const manager = source("studio", "construct-manager.js");

  assert.match(manager, /typeof window\.openArchiveRecord==="function"/);
  assert.match(manager, /window\.StudioArchiveHost\?\.openArchiveRecord/);
  assert.match(manager, /async function requestArchiveRecordOpen[\s\S]*?await ensureArchiveDossier\(id\);return openArchiveDossier\(id\)/);
  assert.match(manager, /async function openArchiveDossier[\s\S]*?loadArchiveDossier\(String\(entityId\),\{throwOnError:true\}\)/);
  assert.match(manager, /window\.ConstructManager=\{[^\n]+openArchiveDossier/);
  assert.match(manager, /window\.StudioArchiveHost\?\.showAllDossiers/);
  assert.match(manager, /if\(throwOnError\)throw error/);
  assert.match(manager, /data-dossier-open[\s\S]*?requestArchiveRecordOpen\(open\.dataset\.dossierOpen\)/);
  assert.match(manager, /requestGeneration!==archiveDossierRequestGeneration/);
  assert.match(manager, /cancelArchiveDossierOpen/);
  assert.match(manager, /data-appearance-open-archive[\s\S]*?Open Archive Record/);
  assert.match(manager, /archiveButton\.dataset\.openArchiveRecord=entityId;archiveButton\.hidden=false/);
});

test("Merch cards preserve their existing controls and add the same Archive action", () => {
  const manager = source("studio", "merch-manager.js");
  const constructManager = source("studio", "construct-manager.js");

  assert.match(manager, /data-merch-edit="\$\{esc\(record\.id\)\}">Edit<\/button><button class="button" type="button" data-merch-open-archive="\$\{esc\(record\.id\)\}">Open Archive Record<\/button>/);
  assert.match(manager, /data-merch-preview="\$\{esc\(record\.id\)\}">Launch review<\/button>/);
  assert.match(manager, /async function openArchiveRecord\(api,entityId\)[\s\S]*?window\.openArchiveRecord[\s\S]*?window\.StudioArchiveHost\?\.openArchiveRecord[\s\S]*?window\.ConstructManager\?\.openArchiveDossier[\s\S]*?\/api\/admin\/entities\/[\s\S]*?window\.ConstructManager\.openArchiveDossier/);
  assert.match(manager, /archiveRecord\.dataset\.merchOpenArchive/);
  assert.match(constructManager, /merch-manager\.js\?v=20260828-editable-archive-records/);
});
