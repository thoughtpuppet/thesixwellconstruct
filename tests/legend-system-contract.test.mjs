import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

const SHARED_STYLES = [
  "/css/tokens.css",
  "/css/transitions.css",
  "/about/section-page.css",
  "/about/legend/legend.css",
  "/css/mobile.css",
  "/css/site-typography.css",
  "/css/hero.css",
];

function assertSharedStyleOrder(html) {
  for (let index = 1; index < SHARED_STYLES.length; index += 1) {
    assert.ok(
      html.indexOf(SHARED_STYLES[index - 1]) < html.indexOf(SHARED_STYLES[index]),
      `${SHARED_STYLES[index - 1]} must load before ${SHARED_STYLES[index]}`,
    );
  }
}

test("Legend catalog remains the shared About doorway and links to canonical records", () => {
  const html = source("about/legend/index.html");
  const catalog = source("js/legend-catalog.js");

  assertSharedStyleOrder(html);
  assert.match(html, /<body data-venture="about">/);
  assert.match(html, /<main class="about-section-page legend-page entrance-fade">/);
  assert.match(html, /class="construct-breadcrumb"/);
  assert.match(html, /class="section-head site-hero site-hero--supporting"/);
  assert.match(html, /class="footer-links legend-footer"/);
  assert.match(html, /src="\/js\/legend-record-view\.js/);
  assert.ok(html.indexOf("/js/legend-record-view.js") < html.indexOf("/js/legend-catalog.js"));
  assert.doesNotMatch(html, /data-live-legend-detail|<style\b/);
  assert.doesNotMatch(html, /system-uses|Tattoo Build|Construct Connections|Archive Memory|Search \+ Themes|Future Works/);

  assert.match(catalog, /<a class="legend-card" href="\$\{legend\.escapeHtml\(legend\.canonicalRoute\(record\)\)\}"/);
  assert.match(catalog, /class="layer-count metadata legend-ghost"/);
  assert.match(catalog, /class="btn legend-filter"/);
  assert.doesNotMatch(catalog, /pushState|popstate|searchParams|data-close-symbol|aria-current/);
});

test("Legend record template is a normal shared About document", () => {
  const html = source("about/legend/detail/index.html");
  const renderer = source("js/legend-record-view.js");
  const record = source("js/legend-record.js");

  assertSharedStyleOrder(html);
  assert.match(html, /<main class="about-section-page legend-page legend-record-page entrance-fade">/);
  assert.match(html, /data-legend-record-title/);
  assert.match(html, /data-legend-record-description/);
  assert.match(html, /data-legend-record-canonical/);
  assert.match(html, /id="legend-record-data" type="application\/json"/);
  assert.match(html, /class="construct-breadcrumb-current" data-legend-breadcrumb-current aria-current="page"/);
  assert.match(html, /data-live-legend-record aria-live="polite"/);
  assert.match(html, /class="footer-links legend-footer"/);
  assert.ok(html.indexOf("/js/legend-record-view.js") < html.indexOf("/js/legend-record.js"));
  assert.doesNotMatch(html, /<style\b|aria-modal|role="dialog"/);

  assert.match(renderer, /class="legend-record-hero site-hero site-hero--supporting"/);
  assert.match(renderer, /class="hero-title detail-title"/);
  assert.match(renderer, /class="section-intro hero-descriptor"/);
  assert.match(renderer, /class="core-meaning"/);
  assert.match(renderer, /Influence &amp; relationship/);
  assert.match(renderer, /Meaning in application/);
  assert.match(renderer, /Visual versions/);
  assert.match(renderer, /Documented appearances/);
  assert.match(renderer, /Connected work/);
  assert.match(renderer, /class="legend-record-navigation"/);
  assert.match(renderer, /rel="\$\{relation\}"/);
  assert.match(renderer, /variant\.href/);
  assert.match(renderer, /safeSvg\(record\.svg_markup\)/);
  assert.match(renderer, /\[svg,\s*\.\.\.svg\.querySelectorAll\("\*"\)\]/);
  assert.doesNotMatch(renderer, /tabindex="-1"|data-close-symbol/);

  assert.match(record, /getElementById\("legend-record-data"\)/);
  assert.match(record, /fetch\(`\/api\/legend\/\$\{encodeURIComponent\(slug\)\}`/);
  assert.doesNotMatch(record, /searchParams|pushState|popstate/);
});

test("Legend component CSS consumes shared tokens and uses complete 5px frames", () => {
  const css = source("about/legend/legend.css");

  assert.match(css, /html,\s*body,\s*\.legend-page\s*\{\s*background:\s*var\(--color-bg\)/);
  assert.match(css, /--legend-rule:\s*var\(--color-archive-dim\)/);
  assert.match(css, /--legend-symbol:\s*var\(--color-archive\)/);
  assert.match(css, /\.legend-grid\s*\{[\s\S]*gap:\s*var\(--grid-gap\)/);
  assert.match(css, /\.legend-record-hero\s*\{[^}]*grid-template-columns:[^;]*1\.2fr[^;]*0\.8fr/s);

  for (const selector of [
    String.raw`\.legend-card`,
    String.raw`\.legend-record-hero`,
    String.raw`\.detail-layer`,
    String.raw`\.detail-connections`,
    String.raw`\.application`,
    String.raw`\.variant`,
    String.raw`\.appearance`,
    String.raw`\.influence-card`,
    String.raw`\.legend-record-back`,
    String.raw`\.legend-neighbor`,
  ]) {
    assert.match(css, new RegExp(`${selector}[^{]*\\{[^}]*border:\\s*5px solid`, "s"), `${selector} must own a complete 5px frame`);
  }

  assert.doesNotMatch(css, /(?:border|stroke)[^;{}]*1px/i);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(css, /\[aria-current="true"\]::after|\.legend-detail|\.legend-close/);
  assert.doesNotMatch(css, /\.(?:hero-title|hero-descriptor|kicker)\s*\{/);
  assert.doesNotMatch(css, /body\s*\{[^}]*(?:color|font(?:-family|-size|-weight|-style)?):/s);
  assert.match(css, /\.legend-search input::placeholder\s*\{[^}]*var\(--color-text-ghost\)[^}]*opacity:\s*1/s);
  assert.match(css, /\.legend-ghost\s*\{[^}]*--type-meta-color:\s*var\(--color-text-ghost\)/s);
});
