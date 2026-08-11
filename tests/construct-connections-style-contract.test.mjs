import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(ROOT, "css", "construct-connections.css"), "utf8");

test("connection component structural strokes use the shared 5px standard", () => {
  assert.match(css, /\.cc-toggle button\s*\{[\s\S]*border-bottom:\s*5px solid transparent/);
  assert.match(css, /\.cc-card\s*\{[\s\S]*border:\s*5px solid var\(--ring-faint/);
  assert.match(css, /\.cc-card-media\s*\{[\s\S]*border:\s*5px solid/);
  assert.match(css, /\.cc-map\s*\{[\s\S]*border:\s*5px solid/);
  assert.match(css, /\.cc-map-line\s*\{\s*stroke-width:\s*5px/);
  assert.match(css, /\.cc-map-dot\s*\{[^}]*border:\s*5px solid var\(--node\)/);
});

test("connection cards use the shared section-title role and a compact vertical grid", () => {
  assert.match(css, /\.cc-head \.cc-section-title\s*\{[\s\S]*font-weight:\s*var\(--type-section-weight,\s*900\)/);
  assert.match(css, /\.cc-groups\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--cc-card-min\),\s*1fr\)\)/);
  assert.match(css, /\.cc-group:has\(\.cc-card:nth-child\(2\)\)\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.cc-card\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.cc-card-media\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*3/);
});

test("connection component does not reintroduce sub-5px structural borders or graph strokes", () => {
  assert.doesNotMatch(css, /border(?:-(?:top|right|bottom|left))?:\s*[1-4](?:\.\d+)?px\s+solid/);
  assert.doesNotMatch(css, /stroke-width:\s*[1-4](?:\.\d+)?(?:px)?\s*;/);
});

test("the Archive group uses the same related-group rhythm without one-off card spacing", () => {
  assert.match(css, /\.cc-groups\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*14px/);
  assert.match(css, /\.cc-group\s*\{\s*display:\s*grid;\s*gap:\s*9px/);
  assert.doesNotMatch(css, /\.cc-card--archive/);
  assert.doesNotMatch(css, /\.cc-group--symbols \.cc-card-meta \.cc-badge:nth-child/);
});

test("the Archive card uses the shared framed bold serif A treatment", () => {
  assert.match(css, /\.cc-card-media--monogram\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.cc-card-media--monogram\s*\{[\s\S]*font:\s*900 32px\/1 Georgia/);
  assert.match(css, /\.cc-card-media--monogram\s*\{[\s\S]*text-transform:\s*uppercase/);
});

test("canonical Legend SVG artwork fills the shared media frame", () => {
  assert.match(css, /\.cc-card-media--symbol\s*\{[\s\S]*padding:\s*2px[\s\S]*color:\s*var\(--cc-target\)/);
  assert.match(css, /\.cc-card-media--symbol svg\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100%/);
});

test("mobile connection cards keep the desktop hover treatment at rest without changing the graph", () => {
  const start = css.indexOf("@media (max-width: 640px)");
  const end = css.indexOf("@media (prefers-reduced-motion: reduce)", start);
  const mobile = css.slice(start, end);

  assert.ok(start >= 0 && end > start, "mobile connection block is missing");
  assert.match(mobile, /\.cc-card\s*\{[\s\S]*border-color:\s*var\(--cc-target\)[\s\S]*background:\s*rgba\(0,\s*0,\s*0,\s*\.12\)/);
  assert.match(mobile, /\.cc-card::after\s*\{[\s\S]*color:\s*var\(--cc-target\)[\s\S]*transform:\s*translateX\(3px\)/);
  assert.match(mobile, /\.cc-card-media\s*\{[^}]*border-color:\s*var\(--cc-target\)/);
  assert.doesNotMatch(mobile, /\.cc-map(?:-dot|-node)?\s*\{/);
});
