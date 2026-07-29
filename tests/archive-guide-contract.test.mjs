import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("Archive index exposes the guide at the top of the explorer", async () => {
  const source = await read("js/archive-public.js");
  const heroStart = source.indexOf('<section class="archive-hero');
  const heroEnd = source.indexOf("</section>", heroStart);
  const guideLink = source.indexOf('href="/archive/guide/"', heroStart);

  assert.ok(heroStart >= 0 && heroEnd > heroStart, "archive explorer hero must exist");
  assert.ok(guideLink > heroStart && guideLink < heroEnd, "Archive Guide link must appear inside the top hero");
});

test("Archive Guide explains current use and developing catalogue language", async () => {
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
  assert.match(html, /separate privacy, consent, public-presentation, and transcript controls/);
  assert.match(html, /ART-042/);
  assert.match(html, /Roman numerals/);
  assert.match(html, /Cultural object/);
  assert.match(html, /ART-042\.1\/II/);
  assert.match(html, /M01 — process photograph/);
  assert.match(html, /S01 — physical sample/);
  assert.match(html, /TAT-DES-012/);
  assert.match(html, /TAT-EXE-031/);
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
  assert.match(html, /Document 01/);
  assert.match(html, /Sample 01/);
  assert.match(html, /Lost Marbles Hoodie/);
  assert.match(html, /Concept or theme/);
  assert.match(html, /Framework in development/);
  assert.match(html, /Relationships and origin threads/);
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
  assert.match(html, /Material visibility/);
  assert.match(html, /Presentation/);
  assert.match(html, /Consent/);
  assert.match(html, /Inline note text is visible/);
});
