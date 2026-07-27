import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

test("Legend follows the shared About page anatomy and stylesheet order", () => {
  const html = source("about/legend/index.html");
  const orderedAssets = [
    "/css/tokens.css",
    "/css/transitions.css",
    "/about/section-page.css",
    "/about/legend/legend.css",
    "/css/mobile.css",
    "/css/site-typography.css",
    "/css/hero.css",
  ];

  for (let index = 1; index < orderedAssets.length; index += 1) {
    assert.ok(
      html.indexOf(orderedAssets[index - 1]) < html.indexOf(orderedAssets[index]),
      `${orderedAssets[index - 1]} must load before ${orderedAssets[index]}`,
    );
  }

  assert.match(html, /<body data-venture="about">/);
  assert.match(html, /<main class="about-section-page legend-page entrance-fade">/);
  assert.match(html, /class="construct-breadcrumb"/);
  assert.match(html, /class="construct-breadcrumb-current" aria-current="page">Legend</);
  assert.match(html, /class="section-head site-hero site-hero--supporting"/);
  assert.match(html, /class="hero-title"/);
  assert.match(html, /class="section-intro hero-descriptor"/);
  assert.match(html, /class="section-nav"/);
  assert.match(html, /class="footer-links legend-footer"/);
  assert.match(html, /src="\/js\/construct-wayfinding\.js"/);
  assert.ok(
    html.indexOf("/js/construct-nav.js") < html.indexOf("/js/construct-wayfinding.js"),
    "shared navigation must load before wayfinding",
  );
  assert.ok(
    html.indexOf("/js/construct-wayfinding.js") < html.indexOf("/js/legend-catalog.js"),
    "shared wayfinding must load before the Legend catalog",
  );
  assert.doesNotMatch(html, /<style\b/);
  assert.doesNotMatch(html, /system-uses|Tattoo Build|Construct Connections|Archive Memory|Search \+ Themes|Future Works/);
});

test("Legend component CSS consumes shared tokens and uses complete 5px frames", () => {
  const css = source("about/legend/legend.css");

  assert.match(css, /html,\s*body,\s*\.legend-page\s*\{\s*background:\s*var\(--color-bg\)/);
  assert.match(css, /--legend-rule:\s*var\(--color-archive-dim\)/);
  assert.match(css, /--legend-symbol:\s*var\(--color-archive\)/);
  assert.match(css, /\.legend-grid\s*\{[\s\S]*gap:\s*var\(--grid-gap\)/);

  for (const selector of [
    String.raw`\.legend-card`,
    String.raw`\.legend-detail`,
    String.raw`\.application`,
    String.raw`\.variant`,
    String.raw`\.appearance`,
    String.raw`\.influence-card`,
  ]) {
    assert.match(css, new RegExp(`${selector}[^{]*\\{[^}]*border:\\s*5px solid`, "s"), `${selector} must own a complete 5px frame`);
  }

  assert.doesNotMatch(css, /(?:border|stroke)[^;{}]*1px/i);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(css, /\[aria-current="true"\]::after/);
  assert.doesNotMatch(css, /\.(?:hero-title|hero-descriptor|kicker)\s*\{/);
  assert.doesNotMatch(css, /body\s*\{[^}]*(?:color|font(?:-family|-size|-weight|-style)?):/s);
  assert.match(css, /\.legend-search input::placeholder\s*\{[^}]*var\(--color-text-ghost\)[^}]*opacity:\s*1/s);
  assert.match(css, /\.legend-ghost\s*\{[^}]*--type-meta-color:\s*var\(--color-text-ghost\)/s);
  assert.match(css, /\.detail-title:focus\s*\{\s*outline:\s*none/);
});

test("Legend generated markup opts into shared roles without changing behavior hooks", () => {
  const catalog = source("js/legend-catalog.js");

  assert.match(catalog, /class="btn legend-filter"/);
  assert.match(catalog, /class="btn legend-close"/);
  assert.match(catalog, /class="band-title section-title detail-title"/);
  assert.match(catalog, /class="layer-count metadata legend-ghost"/);
  assert.match(catalog, /class="metadata legend-accent-meta"/);
  assert.match(catalog, /class="kicker"/);
  assert.doesNotMatch(catalog, /class="(?:index|section-index)"/);

  for (const hook of [
    "data-live-legend",
    "data-live-legend-filters",
    "data-live-legend-detail",
    "data-live-legend-search",
    "data-symbol",
    "data-close-symbol",
  ]) {
    assert.match(catalog, new RegExp(hook));
  }

  assert.match(catalog, /searchParams\.set\("symbol"/);
  assert.match(catalog, /searchParams\.get\("symbol"\)/);
  assert.match(catalog, /safeSvg\(record\.svg_markup\)/);
  assert.match(catalog, /variant\.href/);
});
