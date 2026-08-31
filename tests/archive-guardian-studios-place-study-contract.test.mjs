import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pagePath = join(ROOT, "archive", "places", "guardian-studios", "index.html");
const placesIndexPath = join(ROOT, "archive", "places", "index.html");
const uiGuideRegistryPath = join(ROOT, "tools", "ui-guide-system.js");
const placeCssPath = join(ROOT, "css", "archive-place-study.css");
const archiveCssPath = join(ROOT, "css", "archive-public.css");
const assetRoot = join(ROOT, "assets", "archive", "guardian-studios");

function text(path) {
  return readFileSync(path, "utf8");
}

function prose(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("Guardian Studios dossier is indexable at its stable public Archive route", () => {
  assert.ok(existsSync(pagePath));
  const page = text(pagePath);

  assert.match(page, /<meta name="robots" content="index,follow">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/thesixwellconstruct\.com\/archive\/places\/guardian-studios\/">/);
  assert.match(page, /<title>Guardian Studios at Echo Street West · Six\.Well Archive<\/title>/);
  assert.match(page, /<h1 class="archive-record-title hero-title">Guardian Studios\.<\/h1>/);
  assert.match(page, /<link rel="stylesheet" href="\/css\/archive-public\.css">/);
  assert.match(page, /<link rel="stylesheet" href="\/css\/archive-place-study\.css">/);
  assert.match(page, /src="\/js\/construct-wayfinding\.js"/);
  assert.doesNotMatch(page, /noindex|prototype|temporary place dossier|>\s*draft\s*</i);
});

test("place, gallery, campus, and address identities remain distinct", () => {
  const copy = prose(text(pagePath));

  assert.match(copy, /Guardian Studios is the artist-studio building within the wider Echo Street West development/i);
  assert.match(copy, /Echo Contemporary Art is the gallery housed inside Guardian Studios/i);
  assert.match(copy, /not an alternate name for the whole studio building/i);
  assert.match(copy, /Current Echo Contemporary pages give the studio and gallery address as 785 Echo Street NW/i);
  assert.match(copy, /campus pages use 765 Echo Street NW/i);
  assert.match(copy, /uses 785 for the specific place and preserves 765 as the broader campus address/i);
  assert.match(copy, /No separate Echo Contemporary place entity is created here/i);
});

test("institutional chronology and unresolved industrial claims stay source-bounded", () => {
  const copy = prose(text(pagePath));

  assert.match(copy, /Guardian Studios launched summer 2021/i);
  assert.match(copy, /Black Women in Visual Arts managed the studios during the first year/i);
  assert.match(copy, /July 2022[^.]{0,160}studio manager/i);
  assert.match(copy, /August 19, 2022/i);
  assert.match(copy, /31 studios/i);
  assert.match(copy, /3,000-square-foot (?:open )?gallery/i);
  assert.match(copy, /active studio and gallery building/i);
  assert.match(copy, /chemical company and perfumery/i);
  assert.match(copy, /marketing record does not establish that every part of the former complex/i);
  assert.match(copy, /Not yet building-specific/i);
  assert.match(copy, /Sanborn, directory, deed, or environmental-record sequence/i);
  assert.doesNotMatch(copy, /Guardian Studios (?:was|operated as|served as) (?:a )?(?:chemical company|perfumery)/i);
});

test("firsthand studio history preserves both phases without financial or residency inference", () => {
  const page = text(pagePath);
  const section = page.match(/<section class="archive-document-section" id="lived-studio">([\s\S]*?)<\/section>/)?.[1] || "";
  const copy = prose(section);

  assert.match(copy, /entered Studio 30 around April 29, 2023/i);
  assert.match(copy, /241-square-foot workspace rented for \$588\.04 per month/i);
  assert.match(copy, /through approximately May 31, 2023/i);
  assert.match(copy, /Around June 1, 2023[^.]*moved directly into the larger Studio 20/i);
  assert.match(copy, /380-square-foot workspace rented for \$927\.70 per month/i);
  assert.match(copy, /continued until approximately January 7, 2025/i);
  assert.match(copy, /firsthand account/i);
  assert.match(copy, /No lease or payment record is required/i);
  assert.match(copy, /does not infer total rent paid, deposits, lease terms, payment history, residential occupancy, or live\/work use/i);
  assert.match(section, /href="\/archive\/records\/saiel-guardian-studios-years\/"/);
  assert.match(section, /href="\/archive\/timelines\/saiel-dauhn-solehman\/"/);
  assert.doesNotMatch(section, /<img\b/i);
});

test("claims expose a contiguous numbered source register with safe external links", () => {
  const page = text(pagePath);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "page IDs must remain unique");
  for (const [, target] of page.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `internal link target #${target} must exist`);
  }

  const sourceNumbers = [...page.matchAll(/\sid="source-(\d{2})"/g)].map((match) => Number(match[1]));
  assert.deepEqual(sourceNumbers, Array.from({ length: 13 }, (_, index) => index + 1));

  for (const expected of [
    "echostreetwest.com/guardian-studios/",
    "lincoln-property-company-breaks-ground-today-on-echo-street-west/",
    "roughdraftatlanta.com/2024/10/30/echo-contemporary-art-presents-1st-annual-open-call-exhibition/",
    "grand-opening-of-echo-contemporary-art-8-12-2022/",
    "echocontemporary.com/about",
    "rios.com/projects/echo-street-west/",
  ]) assert.ok(page.includes(expected), `source register must retain ${expected}`);

  const externalAnchors = [...page.matchAll(/<a href="https?:\/\/[^\"]+"([^>]*)>/g)];
  assert.ok(externalAnchors.length >= 12);
  for (const [, attributes] of externalAnchors) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
});

test("dossier and index remain text-led without unlicensed imagery", () => {
  const page = text(pagePath);
  const placesIndex = text(placesIndexPath);
  const manifestPath = join(assetRoot, "SOURCES.md");

  assert.ok(existsSync(manifestPath));
  assert.deepEqual(readdirSync(assetRoot).sort(), ["SOURCES.md"]);
  assert.doesNotMatch(page, /<img\b|og:image|twitter:image/i);
  assert.doesNotMatch(page, /<(?:img|source)[^>]+src(?:set)?="https?:\/\//i);
  assert.match(page, /href="\/assets\/archive\/guardian-studios\/SOURCES\.md" download/);
  assert.match(text(manifestPath), /no copied photographs, maps, lease records,\s*payment records, or other documentary attachments/i);

  assert.match(placesIndex, /class="place-index-card place-index-card--text-only" href="\/archive\/places\/guardian-studios\/"/);
  const card = placesIndex.match(/<a class="place-index-card place-index-card--text-only"[\s\S]*?<\/a>/)?.[0] || "";
  assert.match(card, /Guardian Studios\./);
  assert.doesNotMatch(card, /<img\b|place-index-card-media/);
});

test("Places registry and responsive presentation reuse the bounded five-pixel system", () => {
  const registry = text(uiGuideRegistryPath);
  const placeCss = text(placeCssPath);
  const archiveCss = text(archiveCssPath);

  assert.match(registry, /"\/archive\/places\/guardian-studios\/"/);
  assert.match(registry, /"archive\/places\/guardian-studios\/index\.html"/);
  assert.match(archiveCss, /--archive-rule:\s*5px/);
  assert.match(archiveCss, /--archive-record-gap:\s*clamp\(0\.75rem, 1\.5vw, 1rem\)/);
  assert.match(placeCss, /\.place-index-card\s*\{[^}]*border:\s*var\(--archive-rule\) solid/s);
  assert.match(placeCss, /\.place-index-card--text-only\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(placeCss, /\.place-index-card--text-only \.place-index-card-copy\s*\{[^}]*min-height:\s*23rem[^}]*border-left:\s*0/s);
  assert.match(placeCss, /@media \(max-width: 820px\)[\s\S]*\.place-index-card[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(`${archiveCss}\n${placeCss}`, /(?:html|body)\s*::(?:before|after)/);
});
