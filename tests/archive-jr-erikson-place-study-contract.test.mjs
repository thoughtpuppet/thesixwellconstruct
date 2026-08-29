import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pagePath = join(ROOT, "archive", "places", "jr-erikson-building", "index.html");
const placesIndexPath = join(ROOT, "archive", "places", "index.html");
const cssPath = join(ROOT, "css", "archive-place-study.css");
const assetRoot = join(ROOT, "assets", "archive", "jr-erikson-building");

function text(path) {
  return readFileSync(path, "utf8");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("364 Nelson place dossier is indexable at its stable public Archive route", () => {
  const page = text(pagePath);

  assert.match(page, /<meta name="robots" content="index,follow">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/thesixwellconstruct\.com\/archive\/places\/jr-erikson-building\/">/);
  assert.match(page, /<title>J\.R\. Erikson Co\. Building · Six\.Well Archive<\/title>/);
  assert.match(page, /<h1 class="archive-record-title hero-title">J\.R\. Erikson Co\. Building\.<\/h1>/);
  assert.match(page, /PLACE DOSSIER · 364 NELSON STREET/);
  assert.match(page, /Likely 1920s warehouse period · exact year unresolved/);
  assert.match(page, /By 2026, MASS Collective no longer occupied 364 Nelson/);
  assert.match(page, /final operating day on Nelson Street has not been independently documented/);
  assert.match(page, /commercial real-estate date of 1910 conflicts with the 1911 map/);
  assert.match(page, /href="\/tattoos\/location-parking\/"/);
  assert.match(page, /src="\/js\/construct-wayfinding\.js"/);
  assert.doesNotMatch(page, /noindex|prototype|temporary place dossier|DRAFT 02|not a published catalogue record/i);
  assert.doesNotMatch(page, /Goat Farm acquired the property in 2008/);
  assert.match(page, /name preserves one long chapter of this building’s life, not its origin/);
});

test("claims expose a numbered source register and an explicit 1985 photograph-set action", () => {
  const page = text(pagePath);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "page IDs must remain unique");
  for (const [, target] of page.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `internal link target #${target} must exist`);
  }

  for (let index = 1; index <= 16; index += 1) {
    const id = String(index).padStart(2, "0");
    assert.match(page, new RegExp(`id="source-${id}"`));
  }

  assert.match(page, /Linked source titles and resource labels open the original document, photograph set, or organization site/);
  assert.match(page, /View the 1985 National Register photograph set/);
  assert.ok((page.match(/8f9d1875-168f-4f93-b715-ac6728c3a0e1\//g) || []).length >= 2);
  assert.match(page, /dlg\.usg\.edu\/record\/dlg_sanb_atlanta-1911\?canvas=232/);
  assert.match(page, /archive\.org\/details\/atlantacitydirec1922atla/);
  assert.match(page, /npgallery\.nps\.gov\/GetAsset\/29da1298-2b84-4afc-9270-1cf70f2d3463/);
  assert.match(page, /atlantaga\.gov\/home\/showpublisheddocument\/3847/);
  assert.match(page, /loc\.gov\/resource\/gdcmassbookdig\.usteledirec06222/);
  assert.match(page, /books\.google\.com\/books\?id=sBhPAAAAYAAJ/);
  assert.match(page, /masscollective\.org\/about/);
  assert.match(page, /lifecyclebuildingcenter\.org\/rebuildatl/);
  assert.match(page, /famfam\.family\/contact/);
  assert.match(page, /gahistoricnewspapers\.galileo\.usg\.edu\/lccn\/sn82015425\/1933-08-26/);
  assert.match(page, /realtor\.com\/realestateandhomes-detail\/364-Nelson-St-SW/);

  const externalLinks = [...page.matchAll(/<a href="https:\/\/[^"]+"([^>]*)>/g)];
  assert.ok(externalLinks.length >= 20);
  for (const [, attributes] of externalLinks) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
});

test("public visual evidence is locally archived with rights and privacy safeguards", () => {
  const sheet308 = join(assetRoot, "1911-sanborn-atlanta-sheet-308-nelson-mangum.jpg");
  const sheet309 = join(assetRoot, "1911-sanborn-atlanta-sheet-309-nelson-mangum.jpg");
  const exterior = join(assetRoot, "jr-erikson-building-exterior.jpg");
  const manifest = join(assetRoot, "SOURCES.md");
  const page = text(pagePath);

  assert.equal(sha256(sheet308), "fab183e1e1df54ca525e983145ea19cac287f2dc37675a75f4e2abc35489fa64");
  assert.equal(sha256(sheet309), "2b8d7ea69647b91c80659c0a5dc2f4df809d2e6dfc093b53b230b917cd320262");
  assert.equal(sha256(exterior), "a0339c9438beefd68be07340941eb927961999f14a8673bad0f0dcc7a002a695");
  assert.ok(statSync(sheet308).size < 2 * 1024 * 1024);
  assert.ok(statSync(sheet309).size < 2 * 1024 * 1024);
  assert.ok(statSync(exterior).size < 2 * 1024 * 1024);
  assert.equal(readFileSync(exterior).includes(Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])), false, "public photograph must not contain an EXIF segment");
  assert.equal(existsSync(join(ROOT, "assets", "images", "archive-prototypes", "jr-erikson-building-original.jpg")), false, "GPS-bearing source master must not remain in public assets");
  assert.match(text(manifest), /public Six\.Well Archive place dossier/);
  assert.match(text(manifest), /No Copyright—United States/);
  assert.match(text(manifest), /Original master: retained privately by the artist/);
  assert.match(text(manifest), /Historic street numbering has not yet/);
  assert.match(page, /1911-sanborn-atlanta-sheet-308-nelson-mangum\.jpg/);
  assert.match(page, /1911-sanborn-atlanta-sheet-309-nelson-mangum\.jpg/);
  assert.match(page, /jr-erikson-building-exterior\.jpg/);
  assert.match(page, /href="\/assets\/archive\/jr-erikson-building\/SOURCES\.md" download/);
});

test("Archive and visitor resources discover the public Places lens", () => {
  const placesIndex = text(placesIndexPath);
  const archiveClient = text(join(ROOT, "js", "archive-public.js"));
  const parking = text(join(ROOT, "tattoos", "location-parking", "index.html"));

  assert.match(placesIndex, /<h1 class="hero-title" id="places-title">Places\.<\/h1>/);
  assert.match(placesIndex, /class="hero-descriptor"/);
  assert.match(placesIndex, /href="\/archive\/places\/jr-erikson-building\/"/);
  assert.match(placesIndex, /J\.R\. Erikson Co\. Building\./);
  assert.match(archiveClient, /\["places", "Places", "\/archive\/places\/"\]/);
  assert.match(archiveClient, /class="archive-button" href="\/archive\/places\/">Places<\/a>/);
  assert.match(parking, /href="\/archive\/places\/jr-erikson-building\/">Building history<\/a>/);
});

test("place presentation uses bounded five-pixel frames and responsive Archive structure", () => {
  const css = text(cssPath);

  assert.match(css, /\.place-evidence-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.place-evidence-figure\s*\{[^}]*border:\s*var\(--archive-rule\) solid/s);
  assert.match(css, /\.place-evidence-figure figcaption\s*\{[^}]*border-top:\s*var\(--archive-rule\) solid/s);
  assert.match(css, /\.place-index-card\s*\{[^}]*border:\s*var\(--archive-rule\) solid/s);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.place-evidence-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.place-index-card[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /(?:html|body)\s*::(?:before|after)/);
});
