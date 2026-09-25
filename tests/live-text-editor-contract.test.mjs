import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentHash, readHtmlCopy, readSourceMarker, replaceHtmlCopy, replaceSourceMarker } from "../tools/live-editor-source.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const html = '<main><p class="copy" data-copy-id="hero-copy">Original <strong>copy</strong></p><section><p>Untargeted</p></section></main>';
const replacedHtml = replaceHtmlCopy(html, {
  copyId: "hero-copy",
  html: "Updated <em>copy</em>",
  styles: { color: "#FCB867", textAlign: "left" },
});
assert.match(replacedHtml, /<p class="copy" data-copy-id="hero-copy" style="color: #FCB867; text-align: left">Updated <em>copy<\/em><\/p>/);
assert.match(replacedHtml, /<section><p>Untargeted<\/p><\/section>/);
assert.deepEqual(readHtmlCopy(replacedHtml, "hero-copy"), {
  html: "Updated <em>copy</em>",
  styles: { color: "#FCB867", textAlign: "left" },
});
const preservedStyle = replaceHtmlCopy('<p data-copy-id="hero-copy" style="margin-top: 12px; color: red">Original</p>', {
  copyId: "hero-copy",
  html: "Updated",
  styles: { color: "#FCB867" },
});
assert.match(preservedStyle, /style="margin-top: 12px; color: #FCB867"/);
assert.throws(() => replaceHtmlCopy(html, { copyId: "missing", html: "No", styles: {} }), /was not found/);
assert.throws(() => replaceHtmlCopy('<p data-copy-id="same">A</p><p data-copy-id="same">B</p>', { copyId: "same", html: "No", styles: {} }), /duplicated/);
assert.throws(() => replaceHtmlCopy(html, { copyId: "hero-copy", html: '<script>alert(1)</script>', styles: {} }), /unsupported/);

const markedSource = 'const copy = /* live-copy:sample.copy */ "Original";';
assert.equal(replaceSourceMarker(markedSource, { marker: "sample.copy", text: 'New "copy"' }), 'const copy = /* live-copy:sample.copy */ "New \\"copy\\"";');
assert.equal(readSourceMarker(markedSource, "sample.copy"), "Original");
assert.equal(readSourceMarker("const copy = /* live-copy:sample.copy */ 'Line\\nTwo';", "sample.copy"), "Line\nTwo");
assert.throws(() => replaceSourceMarker(markedSource, { marker: "missing.copy", text: "No" }), /was not found/);
assert.equal(contentHash("same"), contentHash("same"));
assert.notEqual(contentHash("same"), contentHash("changed"));

const editor = read("tools/live-text-editor.js");
const server = read("tools/dev-server.mjs");
const storefront = read("js/shop-storefront.js");
const storefrontConfig = read("shared/storefront-config.js");
const wayfinding = read("js/construct-wayfinding.js");
const navigation = read("js/construct-nav.js");
const links = read("tools/edit-links.html");
const specialProjects = read("tattoos/special-projects/index.html");
const flashClaim = read("tattoos/flash/claim/index.html");
const booking = read("booking/index.html");
const studio = read("studio/submissions/index.html");

assert.match(editor, /__tools\/live-editor\/context/);
assert.match(editor, /__tools\/live-editor\/apply/);
assert.match(editor, /data-live-edit-apply-id/);
assert.match(editor, /MutationObserver/);
assert.match(editor, /var runtimeId = element\.getAttribute\('data-live-edit-id'\)/);
assert.match(editor, /data-live-edit-applyable/);
assert.match(editor, /function toggleCoverage\(/);
assert.match(editor, /Unsupported targets stay navigable and cannot be edited accidentally/);
assert.match(editor, /parentElement\.closest\('\[data-live-edit-owner="managed"\], \[data-live-edit-owner="preview"\]'\)/);
assert.match(editor, /data-live-edit-owner-href/);
assert.match(editor, /coverage-owner-link/);
assert.match(editor, /function toggleHistory\(/);
assert.match(editor, /__tools\/live-editor\/history\/restore/);
assert.match(editor, /Restore protected original/);
assert.match(editor, /rememberUndoToken/);
assert.match(editor, /if \(!editableLink \|\| !targetForElement\(editableLink\)\.applyable\) return/);
assert.match(editor, /Draft saved in this browser/);
assert.doesNotMatch(editor, /entry\.sourceBacked\s*=\s*true/);
assert.doesNotMatch(editor, /samePath\.length\s*===\s*1/);
assert.match(server, /replaceHtmlCopy/);
assert.match(server, /expectedHash/);
assert.match(server, /live-editor-backups/);
assert.match(server, /undoLiveEditorApply/);
assert.match(server, /persistLiveEditorRevision/);
assert.match(server, /live-editor-history/);
assert.match(server, /restoreLiveEditorRevision/);
assert.match(server, /isOriginalBaseline/);
assert.match(server, /resolved\.startsWith\(`\$\{root\}\$\{path\.sep\}`\)/);
assert.match(storefront, /data\.liveEditMarker|dataset\.liveEditMarker/);
assert.match(storefront, /live-copy:storefront\.all\.statement/);
assert.match(storefrontConfig, /live-copy:storefront\.source\.thoughtpuppet\.statement/);
assert.match(wayfinding, /live-copy:wayfinding\.medium\.merch\.label/);
assert.match(wayfinding, /data-live-edit-owner/);
assert.match(navigation, /data-live-edit-owner['"],\s*['"]managed/);
assert.match(links, /window\.location\.origin \+ target\.pathname/);
assert.match(links, /filter=thoughtpuppet/);
assert.match(specialProjects, /id="projectIndex"/);
assert.match(specialProjects, /data-live-edit-label="Studio-managed Special Project calls"/);
assert.match(specialProjects, /data-live-edit-owner-href="\/studio\/submissions\/#tattoo\/special-projects"/);
assert.match(specialProjects, /data-copy-id="special-projects-artist-led-intro"/);
assert.match(flashClaim, /data-live-edit-label="Studio-managed Flash design and session terms"/);
assert.match(flashClaim, /data-live-edit-owner-href="\/studio\/submissions\/#tattoo\/flash"/);
assert.match(flashClaim, /data-copy-id="flash-claim-descriptor"/);
assert.match(booking, /id="bookingApp"[^>]+data-live-edit-owner="managed"/);
assert.match(booking, /data-live-edit-owner-href="\/studio\/submissions\/#tattoo\/appointments"/);
assert.match(studio, /function studioOwnerViewFromLocation\(\)/);
assert.match(studio, /appointments\|flash\|special-projects/);

console.log("live text editor contract tests passed");
