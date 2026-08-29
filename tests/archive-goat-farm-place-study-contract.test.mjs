import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pagePath = join(ROOT, "archive", "places", "goat-farm-arts-center", "index.html");
const placesIndexPath = join(ROOT, "archive", "places", "index.html");
const uiGuideRegistryPath = join(ROOT, "tools", "ui-guide-system.js");
const placeCssPath = join(ROOT, "css", "archive-place-study.css");
const archiveCssPath = join(ROOT, "css", "archive-public.css");
const assetRoot = join(ROOT, "assets", "archive", "goat-farm-arts-center");

const EXPECTED_ASSET_HASHES = Object.freeze({
  "goat-farm-exterior-2011.jpg": "0d0efdf518a45fc0e1cae15976680f7b5e99a633bc2987737a630bb4811ce5d6",
  "goat-farm-evening-event-2012.jpg": "cfb04bd975961be51bfbe71d33320c6ed113c8abd76d5c005d78729f572c49f9",
  "van-winkle-plant-1898.jpg": "fbd0914d54f69180c48981619593cb1efba972186ccc7aa0980fe68e34aca45e",
});

function text(path) {
  return readFileSync(path, "utf8");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function prose(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

test("Goat Farm Arts Center dossier is indexable at its stable public Archive route", () => {
  assert.ok(existsSync(pagePath), "the Goat Farm dossier must exist at its stable route");
  const page = text(pagePath);

  assert.match(page, /<meta name="robots" content="index,follow">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/thesixwellconstruct\.com\/archive\/places\/goat-farm-arts-center\/">/);
  assert.match(page, /<title>(?:The )?Goat Farm Arts Center · Six\.Well Archive<\/title>/);
  assert.match(page, /<h1 class="archive-record-title hero-title">(?:The )?Goat Farm Arts Center\.<\/h1>/);
  assert.match(page, /<link rel="stylesheet" href="\/css\/archive-public\.css">/);
  assert.match(page, /<link rel="stylesheet" href="\/css\/archive-place-study\.css">/);
  assert.match(page, /src="\/js\/construct-wayfinding\.js"/);
  assert.doesNotMatch(page, /noindex|prototype|temporary place dossier|\bDRAFT\b|not a published catalogue record/i);
});

test("Goat Farm claims preserve the industrial, ownership, redevelopment, and current-construction distinctions", () => {
  const page = text(pagePath);
  const copy = prose(page);

  assert.match(copy, /\b(?:not|never)\s+(?:(?:itself|historically)\s+)?(?:a\s+)?textile mill\b/i);
  assert.doesNotMatch(copy, /\b(?:former|historic|nineteenth-century) textile mill\b/i);
  assert.doesNotMatch(copy, /\b(?:operated|functioned|served) as (?:a )?textile mill\b/i);

  assert.match(copy, /\b1889\b.{0,220}\b(?:establish(?:ed|ment)|founded|began)\b|\b(?:establish(?:ed|ment)|founded|began)\b.{0,220}\b1889\b/i);
  assert.match(copy, /\b1889\s*(?:–|-|to)\s*1911\b/i);
  assert.match(copy, /\b(?:phased (?:construction|development|chronology)|built in (?:multiple |successive )?phases|major building campaign)\b/i);
  assert.doesNotMatch(copy, /\b(?:entire|whole|all of the) (?:present-day )?(?:complex|campus|site) (?:was|were) (?:built|constructed) in 1889\b/i);

  assert.match(copy, /\b2008\b.{0,220}\b(?:possession|development rights?|control|agreement)\b|\b(?:possession|development rights?|control|agreement)\b.{0,220}\b2008\b/i);
  assert.match(copy, /\b2010\b.{0,180}\b(?:purchase|purchased|sale|closed|acquired)\b|\b(?:purchase|purchased|sale|closed|acquired)\b.{0,180}\b2010\b/i);
  assert.doesNotMatch(copy, /\b(?:purchase|sale) (?:officially )?closed in 2008\b/i);
  assert.doesNotMatch(copy, /\b(?:Hallister|Goat Farm) (?:bought|purchased|acquired) (?:the )?(?:site|property) in 2008\b/i);

  assert.match(copy, /\bproposals?\b.{0,240}\b(?:not (?:completed|evidence of completed)|unbuilt|unrealized|remain(?:ed)? (?:proposals?|plans?))\b/i);
  assert.doesNotMatch(copy, /\b(?:renderings?|proposals?|master plans?) (?:prove|document|show) (?:the )?(?:completed|current|built) (?:condition|complex|campus|site)\b/i);

  for (const studioCount of ["45", "48", "51"]) {
    assert.match(copy, new RegExp(`\\b${studioCount}\\b[^.]{0,120}\\bstudios?\\b|\\bstudios?\\b[^.]{0,120}\\b${studioCount}\\b`, "i"));
  }
  assert.match(copy, /\bmore than 50\b[^.]{0,120}\bstudios?\b|\bstudios?\b[^.]{0,120}\bmore than 50\b/i);
  assert.match(copy, /\b(?:studio counts?|published counts?|reported counts?)\b.{0,180}\b(?:conflict|differ|vary|cannot be reconciled|unresolved)\b|\b(?:conflict|differ|vary|cannot be reconciled|unresolved)\b.{0,180}\b(?:studio counts?|published counts?|reported counts?)\b/i);
  assert.doesNotMatch(copy, /\b(?:definitive(?:ly)?|exactly) (?:45|48|51|more than 50) studios?\b/i);

  assert.match(copy, /\b(?:MOCA GA|Museum of Contemporary Art of Georgia)\b/i);
  assert.match(copy, /\b(?:officially broken ground|construction (?:is )?(?:now )?underway|under construction)\b/i);
  assert.match(copy, /\b26,?306\b.{0,80}\b(?:square feet|square-foot|sq\.?\s*ft\.?)\b/i);
  assert.match(copy, /\b(?:no confirmed opening|opening (?:date )?(?:remains|is) unconfirmed|has not yet opened)\b/i);
  assert.doesNotMatch(copy, /\b(?:MOCA GA|future MOCA home)\b.{0,120}\b(?:is now open|opened to the public)\b/i);

  const redevelopment = page.match(/<section class="archive-document-section" id="redevelopment">([\s\S]*?)<\/section>/)?.[1] || "";
  const redevelopmentCopy = prose(redevelopment);
  assert.match(redevelopment, /<h2 class="archive-section-title">Redevelopment, preservation, and support<\/h2>/);
  assert.ok(redevelopment.indexOf(">Before<") < redevelopment.indexOf(">Construction<"));
  assert.ok(redevelopment.indexOf(">Construction<") < redevelopment.indexOf(">Reopened<"));
  assert.ok(redevelopment.indexOf(">Reopened<") < redevelopment.indexOf(">Still evolving<"));
  assert.match(redevelopmentCopy, /\$250 million[^.]{0,220}\bvision\b/i);
  assert.match(redevelopmentCopy, /wider announced vision[^.]{0,220}do not establish a \$250 million City of Atlanta investment/i);
  assert.match(redevelopmentCopy, /\$55 million[^.]{0,220}\btaxable revenue bonds\b|\btaxable revenue bonds\b[^.]{0,220}\$55 million/i);
  assert.match(redevelopmentCopy, /rather than representing a \$55 million City or county expenditure/i);
  assert.match(redevelopmentCopy, /City of Atlanta[\s\S]{0,300}\bMOCA GA\b[\s\S]{0,300}\bseparate capital campaign\b/i);
  assert.match(redevelopmentCopy, /lists no ABI\/Invest Atlanta investment/i);
  assert.match(page, /ABI\/IA Investment \$0/);
  assert.doesNotMatch(copy, /who paid for what/i);
});

test("claims expose a contiguous numbered source register with safe external links", () => {
  const page = text(pagePath);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "page IDs must remain unique");
  for (const [, target] of page.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `internal link target #${target} must exist`);
  }

  const sourceNumbers = [...page.matchAll(/\sid="source-(\d{2})"/g)].map((match) => Number(match[1]));
  assert.ok(sourceNumbers.length >= 12, "a researched place dossier must expose a substantial source register");
  assert.deepEqual(
    sourceNumbers,
    Array.from({ length: sourceNumbers.length }, (_, index) => index + 1),
    "source IDs must be contiguous from source-01",
  );

  assert.match(page, /npgallery\.nps\.gov\/GetAsset\/e10dea10-f1cc-47ae-b12f-59e749061f50/);
  assert.match(page, /npgallery\.nps\.gov\/AssetDetail\/NRIS\/79000726/);
  assert.match(page, /govinfo\.gov\/content\/pkg\/USCOURTS-gand-1_11-cv-04396\/pdf\/USCOURTS-gand-1_11-cv-04396-0\.pdf/);
  assert.match(page, /artsatl\.org\/goat-farm-reopens-in-west-midtown-as-a-residential-space-for-arts-programming\//);
  assert.match(page, /tribridgeresidential\.com\/construct/);
  assert.match(page, /nilesbolton\.com\/news\/2024\/aia-atlanta-residential-hospitality-design-awards/);
  assert.match(page, /ajc\.com\/things-to-do\/move-in-day-marks-new-era-for-goat-farm\/ER2I35QDD5BFLF2U5MVKEE53FI\//);
  assert.match(page, /mocaga\.org\/moca_ga_future_home\//);
  assert.match(page, /gpb\.org\/news\/2019\/05\/31\/breaking-ground-on-the-future-of-georgia-arts-the-goat-farms-250-million/);
  assert.match(page, /a-us\.storyblok\.com\/f\/1020195\/x\/01bbdd6327\/2025-02-19_bahab-meeting\.pdf/);
  assert.match(page, /atlanta\.urbanize\.city\/post\/goat-farm-development-drone-photos-construction-arts-center/);
  assert.match(page, /commons\.wikimedia\.org\/wiki\/File:Goat_Farm_atlanta\.jpg/);

  const externalLinks = [...page.matchAll(/<a href="https?:\/\/[^\"]+"([^>]*)>/g)];
  assert.ok(externalLinks.length >= 15, "the source-led dossier should retain direct external evidence links");
  for (const [, attributes] of externalLinks) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
});

test("public Goat Farm visual evidence is locally archived with exact rights and privacy safeguards", () => {
  const page = text(pagePath);
  const manifestPath = join(assetRoot, "SOURCES.md");

  assert.ok(existsSync(manifestPath), "the local evidence folder must include SOURCES.md");
  const manifest = text(manifestPath);

  for (const [filename, expectedHash] of Object.entries(EXPECTED_ASSET_HASHES)) {
    const assetPath = join(assetRoot, filename);
    assert.ok(existsSync(assetPath), `${filename} must be stored in the public evidence folder`);
    assert.match(expectedHash, /^[a-f0-9]{64}$/, `${filename} still needs its final SHA-256 contract value`);
    assert.equal(sha256(assetPath), expectedHash);
    assert.ok(statSync(assetPath).size < 2 * 1024 * 1024, `${filename} must remain below 2 MB`);
    assert.equal(
      readFileSync(assetPath).includes(Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])),
      false,
      `${filename} must not contain an EXIF segment`,
    );
    assert.match(page, new RegExp(filename.replaceAll(".", "\\.")));
    assert.match(manifest, new RegExp(filename.replaceAll(".", "\\.")));
  }

  assert.match(page, /href="\/assets\/archive\/goat-farm-arts-center\/SOURCES\.md" download/);
  assert.match(manifest, /public Six\.Well Archive place dossier/i);
  assert.match(manifest, /Rights and attribution/i);
  assert.match(manifest, /Keizers[\s\S]*VanWinkle3\.jpg[\s\S]*(?:CC BY-SA|Creative Commons Attribution-ShareAlike) 3\.0(?: Unported)?/i);
  assert.match(manifest, /commons\.wikimedia\.org\/wiki\/File:VanWinkle3\.jpg/);
  assert.match(manifest, /before its recent redevelopment[\s\S]{0,180}must not be presented as evidence of current building condition/i);
  assert.match(manifest, /BurnAway[\s\S]*Goat Farm atlanta\.jpg[\s\S]*(?:CC BY|Creative Commons Attribution) 2\.0(?: Generic)?/i);
  assert.match(manifest, /commons\.wikimedia\.org\/wiki\/File:Goat_Farm_atlanta\.jpg/);
  assert.match(manifest, /goat-farm-evening-event-2012\.jpg[\s\S]{0,400}cfb04bd975961be51bfbe71d33320c6ed113c8abd76d5c005d78729f572c49f9/i);
  assert.match(manifest, /strongest construction, reopening, and current-condition photography[\s\S]{0,220}does\s+not carry an open reuse license/i);
  assert.match(page, /goat-farm-evening-event-2012\.jpg/);
  assert.doesNotMatch(page, /<img[^>]+src="https?:\/\//i);
  assert.match(manifest, /ATLGuidebook1898_0099[\s\S]*Georgia State University Library Digital Collections/i);
  assert.match(manifest, /dlg\.usg\.edu\/record\/gsu_guidebook_190/);
  assert.match(manifest, /believes[\s\S]{0,160}public domain[\s\S]{0,100}(?:U\.S\.|United States) law/i);
  assert.match(manifest, /(?:no determination|has not determined)[\s\S]{0,140}other countries/i);
  assert.match(manifest, /Retrieved[^\n]*2026-08-29/i);
  assert.match(manifest, /EXIF/i);
  assert.match(manifest, /XMP/i);
  assert.match(manifest, /(?:GPS|location) metadata/i);
  assert.match(manifest, /SHA-256/i);
});

test("Archive Places index discovers the Goat Farm dossier", () => {
  const placesIndex = text(placesIndexPath);
  const uiGuideRegistry = text(uiGuideRegistryPath);

  assert.match(placesIndex, /<h1 class="hero-title" id="places-title">Places\.<\/h1>/);
  assert.match(placesIndex, /href="\/archive\/places\/goat-farm-arts-center\/"/);
  assert.match(placesIndex, /(?:The )?Goat Farm Arts Center\./);
  assert.match(placesIndex, /goat-farm-exterior-2011\.jpg/);
  assert.match(placesIndex, /Place dossier · researched/);
  assert.match(uiGuideRegistry, /"\/archive\/places\/goat-farm-arts-center\/"/);
  assert.match(uiGuideRegistry, /"archive\/places\/goat-farm-arts-center\/index\.html"/);
});

test("Goat Farm presentation reuses the bounded five-pixel responsive Place system", () => {
  const placeCss = text(placeCssPath);
  const archiveCss = text(archiveCssPath);

  assert.match(archiveCss, /--archive-rule:\s*5px/);
  assert.match(placeCss, /\.place-evidence-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(placeCss, /\.place-evidence-figure\s*\{[^}]*border:\s*var\(--archive-rule\) solid/s);
  assert.match(placeCss, /\.place-evidence-figure figcaption\s*\{[^}]*border-top:\s*var\(--archive-rule\) solid/s);
  assert.match(placeCss, /\.place-evidence-grid--single\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(placeCss, /\.place-index-card\s*\{[^}]*border:\s*var\(--archive-rule\) solid/s);
  assert.match(placeCss, /@media \(max-width: 820px\)[\s\S]*\.place-evidence-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(placeCss, /@media \(max-width: 820px\)[\s\S]*\.place-index-card[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(placeCss, /(?:html|body)\s*::(?:before|after)/);
});
