import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("breadcrumb alignment uses sticky header viewport geometry instead of scroll-dependent offsetTop", () => {
  const source = readFileSync("js/construct-wayfinding.js", "utf8");

  assert.match(source, /topBarBottom = Math\.max\(topBarBottom, rect\.bottom\)/);
  assert.doesNotMatch(source, /header\.offsetTop \+ rect\.height/);
});

test("shared breadcrumb renderers use colon separators", () => {
  const sources = [
    "js/construct-wayfinding.js",
    "shared/writing-content.js",
    "js/gallery.js",
    "tools/ui-guide-system.js",
  ].map((path) => readFileSync(path, "utf8"));

  for (const source of sources) {
    assert.doesNotMatch(source, /breadcrumb-sep[^>]*>\/<\/span>|sep\.textContent\s*=\s*["']\/["']/);
  }
  assert.match(sources[0], /sep\.textContent\s*=\s*["']:["']/);
});
