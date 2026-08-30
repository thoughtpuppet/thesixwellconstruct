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
  "saiel-goat-farm-work-studio-2019-09-24.jpg": "6f8dfb3eb459d9c066bc571adefa51c057f7ff878223e9c3cdc3ee2efe8c2ea2",
  "saiel-goat-farm-work-studio-2019-11-13.jpg": "cf99ee6af689e77ab1bf5016f54b82c97c61e2ad587daf388af57171a814b49e",
  "saiel-goat-farm-live-work-studio-2020-01-25.jpg": "51d17cdfa2b506ae38b8dbaa0ea647c5a5a7c82b220eb320b3226e9ae65625fb",
  "saiel-goat-farm-live-work-studio-2021-05-11.jpg": "1a8085446b774e0c61871679d8cd956124047022ae6dc08f667ced491461f379",
});

const PLACE_PAGE_ASSETS = new Set([
  "goat-farm-exterior-2011.jpg",
  "goat-farm-evening-event-2012.jpg",
  "van-winkle-plant-1898.jpg",
  "saiel-goat-farm-work-studio-2019-09-24.jpg",
  "saiel-goat-farm-live-work-studio-2020-01-25.jpg",
]);

const PERSONAL_ARCHIVE_ASSETS = new Set([
  "saiel-goat-farm-work-studio-2019-09-24.jpg",
  "saiel-goat-farm-work-studio-2019-11-13.jpg",
  "saiel-goat-farm-live-work-studio-2020-01-25.jpg",
  "saiel-goat-farm-live-work-studio-2021-05-11.jpg",
]);

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

test("firsthand studio history distinguishes phase dates, capture dates, and individual scope", () => {
  const page = text(pagePath);
  const section = page.match(/<section class="archive-document-section" id="lived-studio">([\s\S]*?)<\/section>/)?.[1] || "";
  const copy = prose(section);

  assert.match(section, /06 \/ Firsthand/);
  assert.match(section, /A lived studio thread, 2018–2021/);
  assert.match(copy, /work-only studio[^.]{0,160}2018/i);
  assert.match(copy, /September 24[^.]{0,120}November 13[^.]{0,80}2019/i);
  assert.match(copy, /live\/work studio[^.]{0,160}2019/i);
  assert.match(copy, /January 25, 2020[^.]{0,120}May 11, 2021/i);
  assert.match(copy, /J\.R\. Erikson Co\. Building[^.]{0,120}364 Nelson Street/i);
  assert.match(copy, /one artist[\s\S]{0,320}(?:not|without)[\s\S]{0,220}(?:every tenant|every part|campus-wide)/i);
  assert.match(section, /saiel-goat-farm-work-studio-2019-09-24\.jpg/);
  assert.match(section, /saiel-goat-farm-live-work-studio-2020-01-25\.jpg/);
  assert.doesNotMatch(section, /saiel-goat-farm-work-studio-2019-11-13\.jpg/);
  assert.doesNotMatch(section, /saiel-goat-farm-live-work-studio-2021-05-11\.jpg/);
  assert.match(section, /Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license\./);
  assert.match(section, /href="\/archive\/records\/saiel-goat-farm-studio-years\/"/);
  assert.match(section, /href="\/archive\/timelines\/saiel-dauhn-solehman\/"/);
  assert.match(section, /href="\/archive\/places\/jr-erikson-building\/"/);

  const redevelopment = prose(page.match(/<section class="archive-document-section" id="redevelopment">([\s\S]*?)<\/section>/)?.[1] || "");
  assert.match(redevelopment, /announced transition[^.]{0,220}(?:not|rather than) proof that every tenant vacated/i);
  assert.match(redevelopment, /firsthand archive[^.]{0,160}occupancy through 2021/i);
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
    const asset = readFileSync(assetPath);
    assert.ok(existsSync(assetPath), `${filename} must be stored in the public evidence folder`);
    assert.match(expectedHash, /^[a-f0-9]{64}$/, `${filename} still needs its final SHA-256 contract value`);
    assert.equal(sha256(assetPath), expectedHash);
    assert.ok(statSync(assetPath).size < 2 * 1024 * 1024, `${filename} must remain below 2 MB`);
    assert.equal(
      asset.includes(Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])),
      false,
      `${filename} must not contain an EXIF segment`,
    );
    assert.equal(asset.includes(Buffer.from("http://ns.adobe.com/xap/1.0/")), false, `${filename} must not contain XMP metadata`);
    if (PERSONAL_ARCHIVE_ASSETS.has(filename)) {
      assert.equal(asset.includes(Buffer.from([0xff, 0xc2])), true, `${filename} must remain a progressive JPEG`);
    }
    if (PLACE_PAGE_ASSETS.has(filename)) assert.match(page, new RegExp(filename.replaceAll(".", "\\.")));
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
  assert.match(manifest, /Saiel Dauhn Solehman personal archive/);
  assert.match(manifest, /IMG_7607_Original\.JPG[\s\S]*d39fde57591d4b6b395b8fc9a0421c87b2ed17b7e66c456fd58eeba457392a6d/i);
  assert.match(manifest, /IMG_9038_Original\.JPG[\s\S]*63740cf89b2b89a4cd73664450ab00e921633708a859a168000238979e3cb46e/i);
  assert.match(manifest, /IMG_1784\.HEIC[\s\S]*2020-01-25 22:47:16 -05:00[\s\S]*ad13484db6f66c345ea864953641eac613dc77a5bdfc51e8cadc66d60445f8a5/i);
  assert.match(manifest, /IMG_9533_Original\.JPG[\s\S]*79edcf4d3e20aa04b342b7d3cf68b9a0cfa16a751114390af47d88caf3870a08/i);
  assert.match(manifest, /no Creative Commons or other third-party reuse\s+license is granted/i);
  assert.match(manifest, /Saiel Dauhn Solehman · personal archive · © Saiel Dauhn Solehman · no third-party reuse license\./);
  assert.match(manifest, /maximum 2400-pixel long edge[\s\S]*progressive JPEGs/i);
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
