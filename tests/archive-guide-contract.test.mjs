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

  assert.match(html, /The guide changes with the Archive\./);
  assert.match(html, /Ways into the Archive/);
  assert.match(html, /Anatomy of a record/);
  assert.match(html, /Materials and documentation/);
  assert.match(html, /ART-042/);
  assert.match(html, /Roman numerals/);
  assert.match(html, /Framework in development/);
  assert.match(html, /Relationships and origin threads/);
  assert.match(html, /What becomes public/);
  assert.match(html, /Working glossary/);
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
