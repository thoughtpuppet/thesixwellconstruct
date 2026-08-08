import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("breadcrumb alignment uses sticky header viewport geometry instead of scroll-dependent offsetTop", () => {
  const source = readFileSync("js/construct-wayfinding.js", "utf8");

  assert.match(source, /topBarBottom = Math\.max\(topBarBottom, rect\.bottom\)/);
  assert.doesNotMatch(source, /header\.offsetTop \+ rect\.height/);
});
