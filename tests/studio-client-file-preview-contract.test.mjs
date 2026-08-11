import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const studio = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");

test("stored client uploads provide distinct authenticated View and Download actions", () => {
  assert.match(studio, /function storedFileActions\(file, submissionId, mazeRevision = ""\)/);
  assert.match(studio, /data-view-file="\$\{escapeHtml\(file\.id\)\}"/);
  assert.match(studio, /data-download-file="\$\{escapeHtml\(file\.id\)\}"/);
  assert.match(studio, /function privateFileUrl\(button\)[\s\S]*?button\?\.dataset\.fileUrl/);
  assert.match(studio, /fetch\(fileUrl, \{[\s\S]*?authorization: `Bearer \$\{token\}`/);
  assert.match(studio, /downloadPrivateBlob\(await res\.blob\(\), fileName\)/);
});

test("the Studio viewer renders images, PDFs, and JSON without saving them", () => {
  assert.match(studio, /id="fileViewer" role="dialog" aria-modal="true"/);
  assert.match(studio, /privateFilePreviewKind[\s\S]*?return "image";[\s\S]*?return "pdf";[\s\S]*?return "json";/);
  assert.match(studio, /document\.createElement\("img"\)/);
  assert.match(studio, /document\.createElement\("iframe"\)/);
  assert.match(studio, /document\.createElement\("pre"\)/);
  assert.match(studio, /private, not saved/);
  assert.match(studio, /fileViewerAbortController\?\.abort\(\)/);
  assert.match(studio, /URL\.revokeObjectURL\(fileViewerObjectUrl\)/);
  assert.match(studio, /event\.key === "Escape"/);
});

test("Maze revisions and healed-photo returns use the shared in-Studio viewer", () => {
  assert.match(studio, /storedFileActions\(file, submission\.id, revision\.revision\)/);
  assert.match(studio, /function healedPhotoFileItem\(photo, followupId\)/);
  assert.match(studio, /special-projects\/healed\/\$\{encodeURIComponent\(followupId\)\}\/file\?photo=/);
  assert.match(studio, /followup\.photos\.map\(\(photo\) => healedPhotoFileItem\(photo, followup\.id\)\)/);
  assert.doesNotMatch(studio, /data-healed-photo=/);
  assert.doesNotMatch(studio, /window\.open\(objectUrl/);
});

test("the private viewer remains contained on mobile", () => {
  assert.match(studio, /\.file-viewer-card \{[^}]*border:5px solid/);
  assert.match(studio, /@media \(max-width:760px\)[\s\S]*?\.file-item \{ align-items:stretch; flex-direction:column; \}/);
  assert.match(studio, /\.file-viewer-card \{ width:100%; height:100%; \}/);
});
