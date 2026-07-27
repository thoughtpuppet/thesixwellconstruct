import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

test("identity-band landings share one stylesheet and explicit structure", async () => {
  const legendSlugs = ["thoughtpuppet", "six-well", "art-pill-tattoo-house"];
  const pages = await Promise.all([
    read("art/index.html"),
    read("merch/index.html"),
    read("tattoos/index.html"),
  ]);

  for (const html of pages) {
    const typographyIndex = html.indexOf('href="/css/site-typography.css"');
    const identityIndex = html.indexOf('href="/css/identity-bands.css"');
    const heroIndex = html.indexOf('href="/css/hero.css"');

    assert.ok(typographyIndex >= 0, "landing must load site typography");
    assert.ok(identityIndex > typographyIndex, "identity bands must load after site typography");
    assert.ok(heroIndex > identityIndex, "identity bands must load before hero styles");
    assert.match(html, /class="[^"]*\bbrand-band\b/);
    assert.match(html, /class="[^"]*\bband-identity\b/);
    assert.match(html, /class="[^"]*\bband-content\b/);
    assert.match(html, /class="[^"]*\bband-actions\b/);
    assert.match(html, /class="[^"]*\bbrand-band-link\b/);
    assert.match(html, /<div class="band-identity">\s*<a class="band-identity-link" href="\/about\/legend\/\?symbol=[^"]+" aria-label="[^"]+">\s*<img class="band-mark"[^>]*>\s*<\/a>\s*<\/div>\s*<div class="band-content">\s*<div class="band-lockup">\s*<p class="band-kicker"[\s\S]*?<h2 class="band-title"/);
    assert.doesNotMatch(html, /--band-/);
    for (const legacyClass of ["brand-kicker", "brand-title", "brand-copy", "brand-lockup", "venture-stamp", "brand-link"]) {
      assert.doesNotMatch(html, new RegExp(`(?:class="|\\s)${legacyClass}(?:\\s|")`));
    }
    assert.doesNotMatch(html, /(?:^|\n)\s*\.brand-band\s*\{/);
    assert.doesNotMatch(html, /(?:^|\n)\s*\.artist-band\s*\{/);
  }

  pages.forEach((html, index) => {
    assert.match(html, new RegExp(`href="/about/legend/\\?symbol=${legendSlugs[index]}"`));
  });

  assert.match(
    pages[2],
    /<section class="artist-band[^"]*"[\s\S]*?<div class="band-identity band-portrait">\s*<button class="band-portrait-trigger"[^>]*data-band-image-open="saiel-portrait-dialog"[^>]*>\s*<img[^>]*>\s*<\/button>\s*<\/div>\s*<div class="band-content">\s*<div class="band-lockup">\s*<p class="band-kicker"[\s\S]*?<h2 class="band-title"[\s\S]*?<p class="band-copy"/,
  );
});

test("artist portrait opens an accessible full-size identity dialog", async () => {
  const [tattoos, identityCss, lightbox] = await Promise.all([
    read("tattoos/index.html"),
    read("css/identity-bands.css"),
    read("js/identity-band-lightbox.js"),
  ]);

  assert.match(tattoos, /class="band-portrait-trigger"[^>]*aria-controls="saiel-portrait-dialog"[^>]*aria-haspopup="dialog"/);
  assert.match(tattoos, /<dialog class="band-image-dialog" id="saiel-portrait-dialog"[^>]*aria-label="Full-size portrait of Saiel Solehman"/);
  assert.match(tattoos, /class="band-image-dialog__close"[^>]*data-band-image-close[^>]*aria-label="Close enlarged portrait"/);
  assert.match(tattoos, /<script src="\/js\/identity-band-lightbox\.js"><\/script>/);
  assert.match(identityCss, /\.band-portrait-trigger\s*\{[\s\S]*cursor:\s*zoom-in/);
  assert.match(identityCss, /\.band-portrait-trigger:focus-visible\s*\{[\s\S]*outline:\s*5px solid/);
  assert.match(identityCss, /\.band-image-dialog\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*border:\s*0[\s\S]*background:\s*rgba\(8,\s*8,\s*8,\s*0\.97\)/);
  assert.match(identityCss, /\.band-image-dialog::backdrop\s*\{/);
  assert.match(identityCss, /\.band-image-dialog__image\s*\{[\s\S]*max-width:\s*92vw[\s\S]*max-height:\s*92vh/);
  assert.match(identityCss, /\.band-image-dialog__close\s*\{[\s\S]*position:\s*fixed[\s\S]*top:\s*24px[\s\S]*right:\s*40px[\s\S]*border:\s*0[\s\S]*background:\s*transparent/);
  assert.match(lightbox, /\.showModal\(\)/);
  assert.match(lightbox, /data-band-image-close/);
  assert.match(lightbox, /event\.target\s*===\s*dialog\s*\|\|\s*event\.target\s*===\s*frame/);
  assert.match(lightbox, /dialog\.addEventListener\("cancel"/);
  assert.match(lightbox, /dialog\.addEventListener\("close"/);
});

test("brand-band marks share the Legend symbol color and accessible link treatment", async () => {
  const [art, legend, legendCss, tokens, identityCss, thoughtPuppetSvg, sixWellSvg, tattooHouseSvg] = await Promise.all([
    read("art/index.html"),
    read("about/legend/index.html"),
    read("about/legend/legend.css"),
    read("css/tokens.css"),
    read("css/identity-bands.css"),
    read("assets/brand/thoughtpuppet-question-mark.svg"),
    read("assets/brand/six-well-clothing.svg.svg"),
    read("assets/brand/art-pill-tattoo-house.svg.svg"),
  ]);
  const legendSymbolToken = legendCss.match(/--legend-symbol:\s*var\((--[\w-]+)\)/)?.[1];
  const legendSymbolColor = legendSymbolToken
    ? tokens.match(new RegExp(`${legendSymbolToken}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]
    : undefined;

  assert.match(legend, /href="\/about\/legend\/legend\.css"/);
  assert.equal(legendSymbolToken, "--color-archive");
  assert.ok(legendSymbolColor, "the Legend must define its symbol color");
  assert.match(art, /src="\/assets\/brand\/thoughtpuppet-question-mark\.svg"/);
  assert.match(art, /class="[^"]*\bband-mark\b/);
  assert.match(art, />ThoughtPuppet<\/h2>/);
  assert.doesNotMatch(art, /Thought<wbr>Puppet/);
  assert.match(thoughtPuppetSvg, /viewBox="0 0 72 112"/);
  assert.match(thoughtPuppetSvg, new RegExp(`<path fill="${legendSymbolColor}"`, "i"));
  assert.match(sixWellSvg, new RegExp(`fill:\\s*${legendSymbolColor}`, "i"));
  assert.match(tattooHouseSvg, new RegExp(`fill:\\s*${legendSymbolColor}`, "i"));
  assert.match(identityCss, /\.band-mark\s*\{[\s\S]*opacity:\s*1/);
  assert.match(identityCss, /\.band-identity-link:focus-visible\s*\{[\s\S]*outline:\s*5px solid/);
  assert.doesNotMatch(thoughtPuppetSvg, /<text\b/i);
});

test("Tattoo availability is a standalone live region between identity bands", async () => {
  const [html, renderer] = await Promise.all([
    read("tattoos/index.html"),
    read("js/walk-in-windows.js"),
  ]);

  const brandIndex = html.indexOf('class="brand-band ');
  const availabilityIndex = html.indexOf('class="walkin-section"');
  const artistIndex = html.indexOf('class="artist-band ');

  assert.ok(brandIndex >= 0 && availabilityIndex > brandIndex && artistIndex > availabilityIndex);
  assert.match(html, /class="walkin-section" id="walk-in-windows"/);
  assert.match(html, /class="walkin-section__windows"/);
  assert.match(html, /class="walkin-section__hours"/);
  assert.match(html, /id="walkInCards"/);
  assert.match(html, /id="displayedStudioHours" aria-live="polite"/);
  assert.doesNotMatch(html, /brand-band-walkin|brand-band-hours/);

  for (const state of ["loading", "ready", "empty", "error"]) {
    assert.match(renderer, new RegExp(`walkInState = "${state}"`));
  }
});

test("shared identity actions are filled, accessible, responsive controls", async () => {
  const [identityCss, walkinCss, guide] = await Promise.all([
    read("css/identity-bands.css"),
    read("css/walk-in-windows.css"),
    read("tools/ui-guide.html"),
  ]);

  assert.match(identityCss, /\.brand-band-link\s*\{[\s\S]*min-height:\s*48px/);
  assert.match(identityCss, /\.brand-band-link\s*\{[\s\S]*border:\s*5px solid/);
  assert.match(identityCss, /\.brand-band-link\s*\{[\s\S]*background:\s*var\(--band-action-fill/);
  assert.match(identityCss, /\.brand-band-link\s*\{[\s\S]*color:\s*var\(--band-action-ink,\s*var\(--color-bg\)\)/);
  assert.match(
    identityCss,
    /\.band-actions \.brand-band-link\[href\^="\/about\/"\]\s*\{[\s\S]*border-color:\s*var\(--color-accent-dim\)[\s\S]*background:\s*transparent[\s\S]*color:\s*var\(--color-accent-dim\)/,
  );
  assert.match(
    identityCss,
    /\.band-actions \.brand-band-link\[href\^="\/about\/"\]:is\(:hover,\s*:focus-visible\)\s*\{[\s\S]*border-color:\s*var\(--color-accent\)[\s\S]*color:\s*var\(--color-accent\)[\s\S]*opacity:\s*1/,
  );
  assert.match(identityCss, /\.brand-band-link:focus-visible\s*\{[\s\S]*outline:\s*5px solid/);
  assert.match(identityCss, /@media \(max-width:\s*640px\)[\s\S]*\.brand-band-link\s*\{[\s\S]*width:\s*100%/);
  assert.match(identityCss, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(identityCss, /\.brand-band\s*\{[\s\S]*--band-title-size:\s*clamp\(34px,\s*8vw,\s*112px\)/);
  assert.doesNotMatch(identityCss, /--band-title-size-mobile/);
  assert.match(identityCss, /--band-copy-color:\s*rgba\(252,\s*184,\s*103,\s*0\.64\)/);
  assert.match(identityCss, /--band-copy-size:\s*14px/);
  assert.match(identityCss, /--band-identity-column:\s*minmax\(160px,\s*0\.26fr\)/);
  assert.match(identityCss, /--band-content-column:\s*minmax\(0,\s*0\.74fr\)/);
  assert.match(identityCss, /--band-column-gap:\s*12px/);
  assert.match(identityCss, /--band-block-padding:\s*36px/);
  assert.match(identityCss, /--band-inline-padding:\s*36px/);
  assert.match(identityCss, /column-gap:\s*var\(--band-column-gap\)/);
  assert.match(identityCss, /padding:\s*var\(--band-block-padding\)\s+var\(--band-inline-padding\)/);
  assert.match(
    identityCss,
    /\.brand-band\s*\{[\s\S]*--band-logo-aspect:\s*0\.642857[\s\S]*--band-identity-column:\s*minmax\(160px,\s*0\.2fr\)[\s\S]*--band-content-column:\s*minmax\(0,\s*0\.8fr\)[\s\S]*--band-column-gap:\s*12px[\s\S]*--band-inline-padding:\s*8px/,
  );
  assert.match(
    identityCss,
    /\.brand-band--tattoo-house\s*\{[\s\S]*--band-logo-aspect:\s*0\.5523[\s\S]*--band-identity-column:\s*minmax\(160px,\s*0\.175fr\)[\s\S]*--band-content-column:\s*minmax\(0,\s*0\.825fr\)/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band\s*\{[\s\S]*--band-inline-padding:\s*16px[\s\S]*--band-column-gap:\s*4px[\s\S]*grid-template-columns:\s*minmax\(88px,\s*min\(32%,\s*200px\)\)\s+minmax\(0,\s*1fr\)[\s\S]*align-items:\s*center[\s\S]*padding-inline-start:\s*8px/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-identity\s*\{[\s\S]*align-self:\s*center[\s\S]*width:\s*100%/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-mark\s*\{[\s\S]*object-position:\s*calc\(100%\s*-\s*20px\)\s+center/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-identity\s*\{[\s\S]*grid-row:\s*1\s*\/\s*span\s*2/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-content\s*\{[\s\S]*display:\s*contents/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-lockup\s*\{[\s\S]*grid-column:\s*2[\s\S]*grid-row:\s*1/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-actions\s*\{[\s\S]*grid-column:\s*2[\s\S]*grid-row:\s*2/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-copy\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*grid-row:\s*3/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band\s*\{[\s\S]*--band-inline-padding:\s*16px[\s\S]*--band-column-gap:\s*4px[\s\S]*grid-template-columns:\s*minmax\(88px,\s*min\(32%,\s*200px\)\)\s+minmax\(0,\s*1fr\)[\s\S]*align-items:\s*start[\s\S]*padding-inline-start:\s*8px/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-identity\s*\{[\s\S]*align-self:\s*start[\s\S]*margin-top:\s*calc\(var\(--band-kicker-line-height\)\s*\+\s*var\(--band-title-gap\)\)/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-content\s*\{[\s\S]*display:\s*contents/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-lockup\s*\{[\s\S]*grid-column:\s*2[\s\S]*grid-row:\s*1/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-actions\s*\{[\s\S]*grid-column:\s*2[\s\S]*grid-row:\s*2/,
  );
  assert.match(
    identityCss,
    /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-copy\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*grid-row:\s*3/,
  );
  assert.match(identityCss, /@media \(max-width:\s*768px\)[\s\S]*\.artist-band \.band-portrait\s*\{[\s\S]*width:\s*100%/);
  assert.match(identityCss, /\.band-content\s*\{[\s\S]*container-type:\s*inline-size/);
  assert.doesNotMatch(identityCss, /--band-mark-height/);
  assert.match(identityCss, /\.brand-band \.band-identity\s*\{[\s\S]*aspect-ratio:\s*var\(--band-logo-aspect\)/);
  assert.match(identityCss, /@media \(max-width:\s*768px\)[\s\S]*\.brand-band \.band-identity\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(identityCss, /\.brand-band \.band-mark\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0[\s\S]*object-position:\s*right center/);
  assert.match(identityCss, /\.band-mark\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100%[\s\S]*object-fit:\s*contain[\s\S]*opacity:\s*1/);
  assert.match(identityCss, /\.band-portrait\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(identityCss, /\.brand-band--thoughtpuppet \.band-title\s*\{[\s\S]*font-size:\s*clamp\(16px,\s*10\.8cqi,\s*var\(--band-title-size\)\)[\s\S]*white-space:\s*nowrap/);
  assert.match(identityCss, /@media \(max-width:\s*640px\)[\s\S]*\.brand-band--tattoo-house \.band-title\s*\{[\s\S]*font-size:\s*clamp\(20px,\s*12cqi,\s*32px\)[\s\S]*white-space:\s*normal/);
  assert.match(identityCss, /\.brand-band--sixwell/);
  assert.match(identityCss, /\.brand-band--tattoo-house/);
  assert.match(identityCss, /\.brand-band \.band-actions\s*\{[\s\S]*justify-content:\s*flex-start/);
  assert.match(identityCss, /\.artist-band \.band-kicker\s*\{[\s\S]*color:\s*var\(--color-body\)\s*!important[\s\S]*opacity:\s*1/);
  const desktopBandMedia = identityCss.slice(
    identityCss.indexOf("@media (max-width: 1024px)"),
    identityCss.indexOf("@media (max-width: 768px)"),
  );
  assert.doesNotMatch(desktopBandMedia, /grid-template-columns/);
  assert.match(identityCss, /@media \(max-width:\s*768px\)[\s\S]*:where\(\.brand-band,\s*\.artist-band\)\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  assert.match(walkinCss, /\.walkin-section\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*0\.72fr\)\s*minmax\(240px,\s*0\.28fr\)/);
  assert.doesNotMatch(walkinCss, /\.walkin-section\s*\{[^}]*background\s*:/);
  assert.match(walkinCss, /\.walkin-section__hours\s*\{[\s\S]*border-top:\s*5px solid/);
  assert.match(walkinCss, /@media \(max-width:\s*768px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  assert.match(guide, /css\/identity-bands\.css/);
  assert.match(guide, /Standalone availability/);
  assert.match(guide, /Operational availability is never placed inside an identity band/);
});
