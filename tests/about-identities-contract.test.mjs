import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

test("public Creative Identities shells load safely and expose gated ThoughtPuppet history paths", async () => {
  const [
    indexHtml,
    detailHtml,
    identityCss,
    identityJs,
    publicationGate,
    artHtml,
    currentWorksHtml,
    currentWorksJs,
    archiveJs,
    devServer,
    worker,
  ] = await Promise.all([
    read("about/identities/index.html"),
    read("about/identities/detail/index.html"),
    read("css/about-identities.css"),
    read("js/about-identities.js"),
    read("js/thoughtpuppet-public-links.js"),
    read("art/index.html"),
    read("currently/index.html"),
    read("currently/current-works.js"),
    read("js/archive-public.js"),
    read("tools/dev-server.mjs"),
    read("_worker.js"),
  ]);

  for (const html of [indexHtml, detailHtml]) {
    assert.match(html, /<main class="about-section-page identity-page [^"]*entrance-fade">/);
    assert.match(html, /<nav class="construct-breadcrumb" aria-label="Breadcrumb">/);
    assert.match(html, /href="\/about\/section-page\.css"/);
    assert.match(html, /href="\/css\/about-identities\.css"/);
    assert.match(html, /href="\/css\/hero\.css"/);
    assert.match(html, /<script src="\/js\/about-identities\.js"><\/script>/);
  }
  assert.match(indexHtml, /<header class="section-head site-hero site-hero--supporting"[^>]*>/);
  assert.match(indexHtml, /<p class="section-intro hero-descriptor">[^<]+<\/p>/);
  assert.match(indexHtml, /data-identity-index aria-live="polite" aria-busy="true"/);
  assert.match(detailHtml, /data-identity-detail aria-live="polite" aria-busy="true"/);
  assert.match(detailHtml, /<dialog class="identity-media-dialog" data-identity-media-dialog aria-labelledby="identity-media-dialog-title">/);
  assert.match(detailHtml, /<button type="button" data-identity-media-close>Close<\/button>/);
  assert.match(detailHtml, /<img data-identity-media-image src="" alt="">/);

  assert.match(devServer, /\["\/about\/identities\/",\s*200\]/);
  assert.match(devServer, /\["\/about\/identities\/thoughtpuppet\/",\s*200\]/);
  assert.match(devServer, /function identityProfileRouteFile\(urlPath\)[\s\S]*?parts\[0\]\s*!==\s*"about"[\s\S]*?parts\[1\]\s*!==\s*"identities"[\s\S]*?"about",\s*"identities",\s*"detail",\s*"index\.html"/);
  assert.match(worker, /function identityProfileSlug\(pathname\)[\s\S]*?parts\[0\]\s*!==\s*"about"[\s\S]*?parts\[1\]\s*!==\s*"identities"/);
  assert.match(worker, /new URL\(`\/api\/identities\/\$\{encodeURIComponent\(slug\)\}`,[^;]+\);/);
  assert.match(worker, /apiResponse\.status\s*===\s*404[\s\S]*?notFoundPage\(request, env\)[\s\S]*?servePublicAsset\(request, env, "\/about\/identities\/detail\/index\.html"\)/);

  assert.match(identityJs, /fetch\("\/api\/identities",\s*\{[\s\S]*?cache:\s*"no-store"[\s\S]*?accept:\s*"application\/json"/);
  assert.match(identityJs, /if \(!response\.ok\) throw new Error\("Creative identities unavailable\."\)/);
  assert.match(identityJs, /The published identity index is temporarily unavailable\./);
  assert.match(identityJs, /fetch\(`\/api\/identities\/\$\{encodeURIComponent\(slug\)\}`,\s*\{[\s\S]*?cache:\s*"no-store"/);
  assert.match(identityJs, /if \(!response\.ok\) throw new Error\("Creative identity unavailable\."\)/);
  assert.match(identityJs, /catch\s*\{\s*detailUnavailable\(\);\s*\}/);
  assert.match(identityJs, /visibility\s*&&\s*!\["public",\s*"published"\]\.includes\(visibility\)[\s\S]*?return null/);
  assert.match(identityJs, /"public_visible" in media\s*&&\s*!truthy\(media\.public_visible\)/);

  assert.match(identityCss, /\.identity-page\s*\{[\s\S]*?background:\s*var\(--color-bg\)/);
  assert.doesNotMatch(identityCss, /\.identity-profile-hero\s+\.hero-descriptor\s*\{/);
  assert.match(identityCss, /\.identity-section-heading\s*\{[\s\S]*?border-top:\s*5px solid/);
  assert.match(identityCss, /\.identity-grid\s*\{[\s\S]*?gap:\s*16px/);
  assert.match(identityCss, /@media \(max-width:\s*700px\)[\s\S]*?\.identity-grid,[\s\S]*?gap:\s*12px/);
  assert.match(identityCss, /\.identity-origin-media\s*\{[\s\S]*?border:\s*5px solid/);
  assert.match(identityCss, /\.identity-origin-trigger img\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*auto[\s\S]*?object-fit:\s*contain/);
  assert.match(identityCss, /\.identity-media-dialog\s*\{[\s\S]*?border:\s*5px solid[\s\S]*?background:\s*var\(--color-bg\)/);
  assert.match(identityCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.identity-origin-trigger img,[\s\S]*?transition:\s*none/);

  assert.match(identityJs, /<button class="identity-origin-trigger" type="button" data-origin-media aria-label="Enlarge \$\{escapeHtml\(title\)\}">/);
  assert.match(identityJs, /dialogReturnTarget\s*=\s*trigger/);
  assert.match(identityJs, /typeof dialog\.showModal\s*===\s*"function"[\s\S]*?dialog\.showModal\(\)/);
  assert.match(identityJs, /dialog\.addEventListener\("click",[\s\S]*?event\.target\s*===\s*dialog[\s\S]*?dialog\.close\(\)/);
  assert.match(identityJs, /dialog\.addEventListener\("close",[\s\S]*?classList\.remove\("identity-dialog-open"\)[\s\S]*?target\?\.isConnected[\s\S]*?target\.focus\(\)/);
  assert.match(identityJs, /function inlineEmphasis[\s\S]*?<figcaption>\$\{inlineEmphasis\(caption\)\}<\/figcaption>/);
  assert.match(archiveJs, /const inlineEmphasis[\s\S]*?archive-record-figure[\s\S]*?<figcaption><span>\$\{inlineEmphasis\(/);
  assert.match(archiveJs, /archive-timeline-media[\s\S]*?<figcaption>\$\{inlineEmphasis\(/);

  const profileRoute = "/about/identities/thoughtpuppet/";
  const historyRoute = "/archive/timelines/thoughtpuppet/";
  assert.match(artHtml, new RegExp(`data-thoughtpuppet-public-links hidden[\\s\\S]*?href="${profileRoute}"[\\s\\S]*?data-copy-id="art-brand-action-about"[\\s\\S]*?href="${historyRoute}"[\\s\\S]*?data-copy-id="art-brand-action-history"`));
  assert.match(artHtml, /<script src="\/js\/thoughtpuppet-public-links\.js"><\/script>/);
  assert.match(currentWorksJs, new RegExp(`label:"Identity profile",url:"${profileRoute}",publicationGate:"thoughtpuppet"`));
  assert.match(currentWorksJs, new RegExp(`label:"Full Archive history",url:"${historyRoute}",publicationGate:"thoughtpuppet"`));
  assert.match(currentWorksJs, /data-thoughtpuppet-public-link hidden/);
  assert.match(currentWorksHtml, /<script src="\/currently\/current-works\.js"><\/script>\s*<script src="\/js\/thoughtpuppet-public-links\.js"><\/script>/);
  assert.match(publicationGate, /const profileRoute\s*=\s*"\/about\/identities\/thoughtpuppet\/"/);
  assert.match(publicationGate, /fetch\("\/api\/identities",/);
  assert.match(publicationGate, /String\(record\?\.slug \|\| ""\)\s*===\s*"thoughtpuppet"[\s\S]*?String\(record\?\.canonical_route \|\| record\?\.canonicalRoute \|\| ""\)\s*===\s*profileRoute/);
  assert.match(publicationGate, /\.catch\(\(\)\s*=>\s*\{\s*published\s*=\s*false;\s*synchronize\(\);\s*\}\)/);
});
