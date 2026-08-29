import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("Archive index exposes the guide before the explorer", async () => {
  const source = await read("js/archive-public.js");
  const resourcesStart = source.indexOf('<section class="archive-search-panel');
  const resourcesEnd = source.indexOf("</section>", resourcesStart);
  const explorerStart = source.indexOf('<section class="archive-explorer');
  const guideLink = source.indexOf('href="/archive/guide/"', resourcesStart);

  assert.ok(resourcesStart >= 0 && resourcesEnd > resourcesStart, "archive resources panel must exist");
  assert.ok(guideLink > resourcesStart && guideLink < resourcesEnd, "Archive Guide link must appear inside the top resources panel");
  assert.ok(guideLink < explorerStart, "Archive Guide link must appear before the explorer");
});

test("Archive Guide explains the live catalogue and comparison system", async () => {
  const html = await read("archive/guide/index.html");

  assert.match(html, /class="archive-guide-masthead"/);
  assert.match(html, /class="archive-guide-notice-copy"/);
  assert.match(html, /class="archive-guide-nav-label">Contents/);
  assert.match(html, /The guide changes with the Archive\./);
  assert.match(html, /Ways into the Archive/);
  assert.match(html, /Anatomy of a record/);
  assert.match(html, /Materials and documentation/);
  assert.match(html, /Archive dossier/);
  assert.match(html, /Digital asset/);
  assert.match(html, /separate privacy, public-presentation, and transcript controls/);
  assert.match(html, /ART-004/);
  assert.match(html, /Roman numerals/);
  assert.match(html, /Cultural object/);
  assert.match(html, /ART-004\.1\/I/);
  assert.match(html, /current public condition/);
  assert.match(html, /state lead/);
  assert.match(html, /S01 — physical sample/);
  assert.match(html, /TAT-DES-001/);
  assert.match(html, /TAT-EXE-001/);
  assert.match(html, /FLM-001/);
  assert.match(html, /MUS-001/);
  assert.match(html, /WRI-001/);
  assert.match(html, /LEG-001/);
  assert.match(html, /OBJ-001/);
  assert.match(html, /EVT-001/);
  assert.match(html, /Contextual Archive record/);
  assert.match(html, /not a cultural-object catalogue family/);
  assert.match(html, /Media 01/);
  assert.match(html, /Note 01/);
  assert.match(html, /Document or source set 01/);
  assert.match(html, /Sample 01/);
  assert.match(html, /Three documentary roles/);
  assert.match(html, /Source material/);
  assert.match(html, /Client correspondence/);
  assert.match(html, /Public attribution is always “Client.”/);
  assert.match(html, /original filenames are never shown publicly/);
  assert.match(html, /linked to several states receives the next available D-number independently in each state/);
  assert.match(html, /Lost Marbles Hoodie/);
  assert.match(html, /Concept or theme/);
  assert.match(html, /Live system/);
  assert.match(html, /Adaptive documentation/);
  assert.match(html, /Physical object/);
  assert.match(html, /Institutional history/);
  assert.match(html, /Relationships and origin threads/);
  assert.match(html, /Comparing public records and states/);
  assert.match(html, /Comparison workspace/);
  assert.match(html, /Compare records action at the top of the Archive explorer/);
  assert.match(html, /individual record, state, and related-work cards do not carry comparison buttons/);
  assert.doesNotMatch(html, /c\|c/);
  assert.match(html, /\/archive\/compare\//);
  assert.match(html, /left_state/);
  assert.match(html, /right_state/);
  assert.match(html, /one public-record selector for each side/);
  assert.match(html, /em dash/);
  assert.match(html, /at least two evidence-backed public states/);
  assert.match(html, /What becomes public/);
  assert.match(html, /Working glossary/);
});

test("Archive Guide keeps its editorial layer scoped and authoritative", async () => {
  const [html, css] = await Promise.all([
    read("archive/guide/index.html"),
    read("css/archive-guide.css"),
  ]);

  assert.ok(
    html.indexOf("/css/archive-guide.css") > html.indexOf("/css/hero.css"),
    "guide-specific editorial CSS must load after the shared typography and hero layers",
  );
  assert.match(css, /\.archive-guide-page \.archive-guide-notice p::first-letter/);
  assert.match(css, /--guide-reading-measure:\s*43rem/);
  assert.match(css, /--guide-body-ink:\s*color-mix\(in srgb, var\(--color-archive-bright\) 72%, transparent\)/);
  assert.match(css, /\.archive-guide-page \.archive-guide-nav-links/);
  assert.match(css, /text-transform:\s*none !important/);
  assert.doesNotMatch(css, /body:not\(\.archive-guide-page\)/);
});

test("Archive Guide keeps creative state separate from publication controls", async () => {
  const html = await read("archive/guide/index.html");

  assert.match(html, /Creative state/);
  assert.match(html, /Record publication/);
  assert.match(html, /Version publication/);
  assert.match(html, /State publication/);
  assert.match(html, /Material visibility/);
  assert.match(html, /Source-material publication/);
  assert.match(html, /Documentation visibility/);
  assert.match(html, /Presentation/);
  assert.doesNotMatch(html, /Consent/);
  assert.match(html, /Inline note text is visible/);
  assert.match(html, /Public client correspondence rule/);
  assert.match(html, /Contextual Event records are exempt/);
  assert.match(html, /omitted from public APIs/);
});
