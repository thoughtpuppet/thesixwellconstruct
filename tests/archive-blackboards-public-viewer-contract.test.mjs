import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(ROOT, "archive", "blackboards", "index.html"), "utf8");
const script = readFileSync(join(ROOT, "js", "archive-blackboards.js"), "utf8");
const styles = readFileSync(join(ROOT, "css", "archive-blackboards.css"), "utf8");
const ambient = readFileSync(join(ROOT, "js", "construct-ambient-field.js"), "utf8");

test("Blackboard fragments use a bounded non-baked eyes presentation", () => {
  assert.match(html, /construct-ambient-field\.js/);
  assert.match(html, /data-blackboard-zoom-stage/);
  assert.match(script, /data-fragment-presentation/);
  assert.match(script, /animateEyes:\s*false/);
  assert.match(script, /eyeTint:\s*"#6D3D15"/);
  assert.match(script, /particleCount:\s*0/);
  assert.match(styles, /\.blackboard-fragment-presentation[\s\S]*?aspect-ratio:\s*1/);
  assert.match(styles, /\.blackboard-fragment-presentation\s*>\s*img[\s\S]*?object-fit:\s*contain/);
  assert.match(ambient, /var animateEyes = options\.animateEyes !== false/);
  assert.match(ambient, /!animateEyes && particleCount === 0/);
});

test("Blackboard fragment view filters states and supports masked hotspots with rectangle fallback", () => {
  assert.match(script, /hotspotMask \|\| placement\.hotspot_mask/);
  assert.match(script, /placement\.x_pct/);
  assert.match(script, /bounds\.x_pct/);
  assert.match(script, /placement\.maskUrl \|\| placement\.mask_url/);
  assert.match(script, /loadMaskPixels/);
  assert.match(script, /mask\.data\[\(y \* mask\.width \+ x\) \* 4 \+ 3\]/);
  assert.match(script, /if \(!maskUrl\) return true/);
  assert.match(script, /data-fragment-state-filter/);
  assert.match(script, /if \(states\.length < 2\) return ""/);
  assert.match(script, /states\.map\(\(state\)/);
  assert.match(script, /No mapped fragments are confirmed for this state/);
  assert.match(script, /if \(!state\) return;\s+renderFragmentView\(state, entries\)/);
  assert.match(script, /data-fragment-rail-button/);
  assert.match(script, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(script, /function showFullBoard/);
  assert.match(script, />Return to Full View</);
  assert.match(script, /delete stage\.dataset\.fragmentId/);
  assert.match(styles, /\.blackboard-hotspot-region button[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.blackboard-fragment-rail \.blackboard-fragment-presentation[\s\S]*?aspect-ratio:\s*1/);
});
