import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addLiveEditorCopyIds, analyzeLiveEditorHtml, auditLiveEditorCoverage } from "../tools/live-editor-coverage.mjs";

test("coverage annotator assigns stable owners to outer static copy", () => {
  const source = `<!doctype html><body><main><h1>Title</h1><p>Read <strong>this</strong>.</p><p><br></p></main><script>const fake = '<p>Not copy</p>';</script></body>`;
  const result = addLiveEditorCopyIds(source, "about/example/index.html");
  assert.equal(result.inserted, 2);
  assert.match(result.source, /<h1 data-copy-id="live-about-example-h1-1">Title<\/h1>/);
  assert.match(result.source, /<p data-copy-id="live-about-example-p-1">Read <strong>this<\/strong>\.<\/p>/);
  assert.doesNotMatch(result.source, /<strong data-copy-id/);
  assert.doesNotMatch(result.source, /<p data-copy-id[^>]*><br>/);
  assert.match(result.source, /const fake = '<p>Not copy<\/p>'/);
});

test("coverage annotator respects explicit and managed ownership", () => {
  const source = `<body><p data-copy-id="owned">Owned <em>copy</em></p><section data-live-edit-owner="managed"><h2>Managed title</h2></section><p data-live-edit-ignore>Ignored</p></body>`;
  const analysis = analyzeLiveEditorHtml(source, "index.html");
  assert.equal(analysis.candidates.length, 0);
  assert.deepEqual(analysis.existingIds, ["owned"]);
  assert.equal(analysis.ownedElements.length, 2);
});

test("coverage annotator is idempotent", () => {
  const source = `<body><h1>Title</h1><p>Copy</p></body>`;
  const first = addLiveEditorCopyIds(source, "index.html");
  const second = addLiveEditorCopyIds(first.source, "index.html");
  assert.equal(first.inserted, 2);
  assert.equal(second.inserted, 0);
  assert.equal(second.source, first.source);
});

test("the active public source inventory has complete live-editor ownership", async () => {
  const contract = readFileSync(new URL("../tools/live-editor-coverage.mjs", import.meta.url), "utf8");
  assert.match(contract, /data-live-text-editor/);
  assert.match(contract, /data-live-edit-owner/);
  assert.match(contract, /data-copy-id/);
  const audit = await auditLiveEditorCoverage();
  assert.equal(audit.totals.inserted, 0, "static public copy is missing stable source IDs");
  assert.equal(audit.totals.zeroOwnershipPages, 0, "an editor-loaded public page has no source ownership");
  assert.equal(audit.totals.duplicatePages, 0, "a public page has duplicate copy IDs");
});
