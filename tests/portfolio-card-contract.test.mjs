import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_STYLESHEET = 'href="/css/portfolio-cards.css"';
const PORTFOLIO_PAGES = [
  "art/index.html",
  "tattoos/portfolio/index.html",
];

async function source(file) {
  return readFile(path.join(ROOT, file), "utf8");
}

function inlineStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
}

test("Art and Tattoo catalogs load the shared portfolio card layer in foundation order", async () => {
  for (const file of PORTFOLIO_PAGES) {
    const html = await source(file);
    const tokenIndex = html.indexOf('href="/css/tokens.css"');
    const transitionIndex = html.indexOf('href="/css/transitions.css"');
    const portfolioIndex = html.indexOf(SHARED_STYLESHEET);
    const firstInlineStyle = html.indexOf("<style>");

    assert.ok(tokenIndex >= 0, `${file} does not load tokens.css`);
    assert.ok(tokenIndex < transitionIndex, `${file} must load tokens before transitions`);
    assert.ok(transitionIndex < portfolioIndex, `${file} must load portfolio cards after transitions`);
    assert.ok(portfolioIndex < firstInlineStyle, `${file} must load portfolio cards before page-specific styles`);
    assert.equal(html.split(SHARED_STYLESHEET).length - 1, 1, `${file} must load portfolio cards once`);
  }
});

test("portfolio card anatomy and responsive gutters are owned by the shared stylesheet", async () => {
  const css = await source("css/portfolio-cards.css");

  assert.match(css, /\.work-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(css, /\.work-grid\s*\{[\s\S]*gap:\s*var\(--landing-grid-gap-active,\s*var\(--grid-gap,\s*16px\)\)/);
  assert.match(css, /\.work-card\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*5[\s\S]*border:\s*5px solid var\(--ring-faint\)/);
  assert.match(css, /\.work-card:hover,[\s\S]*\.work-card:focus-visible\s*\{[\s\S]*border-color:\s*var\(--venture-color\)/);

  for (const selector of [
    ".work-badge",
    ".work-project-badge",
    ".work-meta",
    ".work-title",
    ".work-info",
    ".work-card.placeholder",
    ".placeholder-label",
    ".work-card.hidden",
  ]) {
    assert.ok(css.includes(selector), `shared portfolio CSS is missing ${selector}`);
  }

  for (const [width, token, fallback] of [
    ["900", "--grid-gap-tablet", "14px"],
    ["700", "--grid-gap-mobile", "12px"],
    ["380", "--grid-gap-compact", "12px"],
  ]) {
    assert.match(
      css,
      new RegExp(`@media \\(max-width: ${width}px\\)[\\s\\S]*${token.replaceAll("-", "\\-")},\\s*${fallback}`),
      `shared portfolio CSS is missing the ${width}px gutter contract`,
    );
  }
});

test("catalog pages no longer duplicate the shared card rules inline", async () => {
  for (const file of PORTFOLIO_PAGES) {
    const styles = inlineStyles(await source(file));

    for (const selector of [
      ".work-grid",
      ".work-card",
      ".work-badge",
      ".work-project-badge",
      ".work-meta",
      ".work-title",
      ".work-info",
      ".placeholder-label",
    ]) {
      assert.ok(!styles.includes(selector), `${file} still defines ${selector} inline`);
    }
  }
});

test("Flash remains on the general media card system", async () => {
  const flash = await source("tattoos/flash/index.html");

  assert.match(flash, /href=["']\/css\/media\.css["']/);
  assert.doesNotMatch(flash, /href=["']\/css\/portfolio-cards\.css["']/);
});

test("Tattoo Portfolio uses newest-first API order in public and Studio surfaces", async () => {
  const api = await source("functions/api/portfolio/_lib.js");
  const studio = await source("studio/submissions/index.html");

  assert.match(api, /ORDER BY created_at DESC, rowid DESC/);
  assert.match(api, /CASE state WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, created_at DESC, rowid DESC/);
  assert.match(studio, /return portfolioItems\.filter\(\(item\) => item\.state === portfolioState\);/);
  assert.match(studio, /Newest entries appear first in Studio and on the public gallery\./);
  assert.doesNotMatch(studio, /data-portfolio-move|savePortfolioOrder|movePortfolioItem|draggable="true"/);
});

test("Studio Portfolio opens one item into the complete editor and returns to the list", async () => {
  const studio = await source("studio/submissions/index.html");

  assert.match(studio, /data-portfolio-open="\$\{escapeHtml\(item\.id\)\}">Open<\/button>/);
  assert.match(studio, /data-portfolio-back>← Back to Portfolio<\/button>/);
  assert.match(studio, /renderPortfolioCard\(item,index,stateItems\.length,\{editor:true\}\)/);
  assert.match(studio, /portfolio-card\$\{editor \? " is-open" : ""\}/);
  assert.match(studio, /window\.ConnectionsManager\?\.mount\(panel, \{ entityId: connections\.dataset\.id, originThreads: true \}\)/);
  assert.doesNotMatch(studio, /\.portfolio-card:not\(\.is-open\)/, "Open must not hide the existing card actions or editors");
});
